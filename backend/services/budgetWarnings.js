'use strict';

const { createNotification } = require('./notifications');

// Cooldown zwischen zwei Fires derselben Regel (auch nach Reset).
// Schützt gegen Schwingungen, wenn ein Verbrauchswert mehrfach am Tag knapp
// über/unter die Schwelle wackelt (z.B. Buchungs-Korrekturen).
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Default-Settings beim Lesen falls noch nicht persistiert
const DEFAULT_SETTINGS = {
  budget_warning_enabled:      'true',
  budget_warning_default_pcts: '75,90,100',
  budget_warning_notify_pm:    'true',
  budget_warning_notify_booker:'true',
};

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

function fmtEur(n) {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

async function getSettings(supabase, tenantId) {
  const { data } = await supabase
    .from('TENANT_SETTINGS')
    .select('KEY, VALUE')
    .eq('TENANT_ID', tenantId)
    .in('KEY', Object.keys(DEFAULT_SETTINGS));
  const map = Object.fromEntries((data || []).map(r => [r.KEY, r.VALUE]));
  const merged = { ...DEFAULT_SETTINGS, ...map };
  return {
    enabled:        merged.budget_warning_enabled === 'true',
    defaultPcts:    String(merged.budget_warning_default_pcts || '')
                      .split(',').map(s => Number(s.trim())).filter(n => n > 0),
    notifyPm:       merged.budget_warning_notify_pm === 'true',
    notifyBooker:   merged.budget_warning_notify_booker === 'true',
  };
}

// ── Budget + Verbrauch laden ────────────────────────────────────────────────

// Lädt rekursiv alle Strukturknoten eines Projekts und liefert Maps:
//   childrenOf:  Map<parentId(string), childIds[]>
//   nodes:       Map<id(string), { ID, FATHER_ID, REVENUE, COSTS, SURCHARGES_TOTAL }>
async function loadProjectTree(supabase, projectId) {
  const { data, error } = await supabase
    .from('PROJECT_STRUCTURE')
    .select('ID, FATHER_ID, REVENUE, COSTS, SURCHARGES_TOTAL')
    .eq('PROJECT_ID', projectId);
  if (error) throw new Error(error.message);
  const nodes = new Map();
  const childrenOf = new Map();
  for (const n of data || []) {
    nodes.set(String(n.ID), n);
    if (n.FATHER_ID != null) {
      const fid = String(n.FATHER_ID);
      const arr = childrenOf.get(fid) || [];
      arr.push(String(n.ID));
      childrenOf.set(fid, arr);
    }
  }
  return { nodes, childrenOf };
}

// Aggregat (rekursiv) eines Knotens:
//   - Budget = Σ REVENUE der Leaves im Subtree + eigene SURCHARGES_TOTAL der Parents
//   - Verbrauch = Σ COSTS der Leaves im Subtree
function aggregateSubtree(structureIdStr, nodes, childrenOf, cache = new Map()) {
  if (cache.has(structureIdStr)) return cache.get(structureIdStr);
  const node = nodes.get(structureIdStr);
  if (!node) { const r = { budget: 0, verbrauch: 0 }; cache.set(structureIdStr, r); return r; }
  const children = childrenOf.get(structureIdStr) || [];
  if (children.length === 0) {
    // Leaf: REVENUE als Budget, COSTS als Verbrauch
    const r = {
      budget:    Number(node.REVENUE ?? 0),
      verbrauch: Number(node.COSTS ?? 0),
    };
    cache.set(structureIdStr, r);
    return r;
  }
  let b = 0, v = 0;
  for (const cid of children) {
    const c = aggregateSubtree(cid, nodes, childrenOf, cache);
    b += c.budget;
    v += c.verbrauch;
  }
  // Parent: eigene SURCHARGES_TOTAL dazu (Aufschlag des Parents auf Children)
  b += Number(node.SURCHARGES_TOTAL ?? 0);
  const r = { budget: round2(b), verbrauch: round2(v) };
  cache.set(structureIdStr, r);
  return r;
}

// Liefert {budget, verbrauch} für ein Projekt insgesamt
async function projectAggregate(supabase, projectId) {
  const { nodes, childrenOf } = await loadProjectTree(supabase, projectId);
  const cache = new Map();
  let budget = 0, verbrauch = 0;
  for (const node of nodes.values()) {
    if (node.FATHER_ID == null) {
      const r = aggregateSubtree(String(node.ID), nodes, childrenOf, cache);
      budget += r.budget;
      verbrauch += r.verbrauch;
    }
  }
  // Projekt-Root-Surcharges drauf
  try {
    const { data: proj } = await supabase
      .from('PROJECT').select('SURCHARGES_TOTAL').eq('ID', projectId).maybeSingle();
    if (proj?.SURCHARGES_TOTAL) budget += Number(proj.SURCHARGES_TOTAL);
  } catch (_) { /* Spalte fehlt → ignorieren */ }
  return { budget: round2(budget), verbrauch: round2(verbrauch) };
}

// ── Notifications ───────────────────────────────────────────────────────────

async function loadProjectMeta(supabase, projectId) {
  const { data } = await supabase
    .from('PROJECT')
    .select('ID, NAME_SHORT, NAME_LONG, PROJECT_MANAGER_ID, BUDGET_WARNINGS_MUTED')
    .eq('ID', projectId)
    .maybeSingle();
  return data || null;
}

async function loadStructureName(supabase, structureId) {
  const { data } = await supabase
    .from('PROJECT_STRUCTURE')
    .select('ID, NAME_SHORT, NAME_LONG, PROJECT_ID')
    .eq('ID', structureId)
    .maybeSingle();
  return data || null;
}

async function notifyBudgetWarning(supabase, { rule, project, structure, budget, actual, limitEur, triggerEmployeeId, triggerTecId, tenantId }) {
  const recipients = new Set();
  if (rule.NOTIFY_PM && project?.PROJECT_MANAGER_ID) recipients.add(Number(project.PROJECT_MANAGER_ID));
  if (rule.NOTIFY_BOOKER && triggerEmployeeId)        recipients.add(Number(triggerEmployeeId));
  if (Array.isArray(rule.NOTIFY_CC)) {
    for (const eid of rule.NOTIFY_CC) if (eid) recipients.add(Number(eid));
  }
  if (recipients.size === 0) return;

  const scopeLabel = structure
    ? `${structure.NAME_SHORT ?? ''}${structure.NAME_LONG ? ' – ' + structure.NAME_LONG : ''}`
    : 'Projekt-Ebene';
  const projectLabel = `${project?.NAME_SHORT ?? ''}${project?.NAME_LONG ? ': ' + project.NAME_LONG : ''}`;

  const pctActual = budget > 0 ? round2(actual / budget * 100) : 0;
  const title = `Budget ${Number(rule.THRESHOLD_PCT)} % erreicht – ${scopeLabel}`;
  const body  = [
    `Projekt ${projectLabel}`,
    `Honorar + Zuschläge: ${fmtEur(budget)}`,
    `Schwellenwert: ${Number(rule.THRESHOLD_PCT)} % = ${fmtEur(limitEur)}`,
    `Verbraucht: ${fmtEur(actual)} (${pctActual.toFixed(1).replace('.', ',')} %)`,
  ].join('\n');

  const link = `/projekte?tab=budget&projectId=${rule.PROJECT_ID ?? (structure?.PROJECT_ID ?? project?.ID ?? '')}`;
  const meta = {
    ruleId: rule.ID,
    projectId: rule.PROJECT_ID ?? structure?.PROJECT_ID ?? project?.ID ?? null,
    structureId: rule.STRUCTURE_ID ?? null,
    thresholdPct: Number(rule.THRESHOLD_PCT),
    budget, actual, limitEur,
    triggerTecId: triggerTecId ?? null,
  };

  for (const empId of recipients) {
    try {
      await createNotification(supabase, {
        tenantId,
        userId: String(empId),
        type: 'budget_warning',
        title, body, link,
        metadata: meta,
      });
    } catch (e) {
      console.warn(`[BUDGET_WARNING] Notification an EMP ${empId} fehlgeschlagen: ${e?.message || e}`);
    }
  }
}

// ── Evaluation ──────────────────────────────────────────────────────────────

// Evaluiert alle Regeln für gegebene Strukturen + das Projekt.
// scopeIds = Set von STRUCTURE_IDs (z.B. Leaf + alle Ancestors)
// Wird vom Trigger-Hook befüllt.
async function evaluateScopes(supabase, { tenantId, projectId, structureIds, triggerEmployeeId, triggerTecId }) {
  const settings = await getSettings(supabase, tenantId);
  if (!settings.enabled) return;

  const project = await loadProjectMeta(supabase, projectId);
  if (!project) return;
  // Stumm-Schalter auf Projekt-Ebene: Tracking läuft, aber keine Notifications
  if (project.BUDGET_WARNINGS_MUTED) return;

  // Tree einmal laden, dann aggregieren
  const { nodes, childrenOf } = await loadProjectTree(supabase, projectId);
  const aggCache = new Map();

  // Regeln laden: Projekt-Regel + alle Strukturregeln für scopeIds
  const sidArr = Array.from(structureIds || []).filter(Boolean).map(Number).filter(Number.isFinite);
  const orParts = [`PROJECT_ID.eq.${projectId}`];
  if (sidArr.length > 0) orParts.push(`STRUCTURE_ID.in.(${sidArr.join(',')})`);
  const { data: rules } = await supabase
    .from('BUDGET_WARNING_RULE')
    .select('*')
    .eq('TENANT_ID', tenantId)
    .or(orParts.join(','));

  for (const rule of rules || []) {
    if (rule.MUTED) continue;
    try {
      await evaluateRule(supabase, {
        rule, project, nodes, childrenOf, aggCache,
        triggerEmployeeId, triggerTecId, tenantId,
      });
    } catch (e) {
      console.warn(`[BUDGET_WARNING] Rule ${rule.ID} eval fehlgeschlagen: ${e?.message || e}`);
    }
  }
}

async function evaluateRule(supabase, { rule, project, nodes, childrenOf, aggCache, triggerEmployeeId, triggerTecId, tenantId }) {
  // Budget + Verbrauch für den Scope der Regel
  let budget, verbrauch, structure = null;
  if (rule.STRUCTURE_ID) {
    const sid = String(rule.STRUCTURE_ID);
    if (!nodes.has(sid)) return; // Struktur gelöscht
    const agg = aggregateSubtree(sid, nodes, childrenOf, aggCache);
    budget = agg.budget;
    verbrauch = agg.verbrauch;
    structure = await loadStructureName(supabase, rule.STRUCTURE_ID);
  } else {
    // Projekt-Ebene
    let b = 0, v = 0;
    for (const node of nodes.values()) {
      if (node.FATHER_ID == null) {
        const r = aggregateSubtree(String(node.ID), nodes, childrenOf, aggCache);
        b += r.budget; v += r.verbrauch;
      }
    }
    try {
      const { data: proj } = await supabase
        .from('PROJECT').select('SURCHARGES_TOTAL').eq('ID', project.ID).maybeSingle();
      if (proj?.SURCHARGES_TOTAL) b += Number(proj.SURCHARGES_TOTAL);
    } catch (_) { /* */ }
    budget = round2(b);
    verbrauch = round2(v);
  }
  if (budget <= 0) return; // Sinnlos

  const limit = round2(budget * Number(rule.THRESHOLD_PCT) / 100);
  const breached = verbrauch >= limit;

  // Offenen Trigger laden (RESET_AT IS NULL)
  const { data: openRows } = await supabase
    .from('BUDGET_WARNING_FIRED')
    .select('*')
    .eq('RULE_ID', rule.ID)
    .is('RESET_AT', null)
    .limit(1);
  const open = openRows?.[0] || null;

  if (breached && !open) {
    // Cooldown: letzte FIRED-Zeile (auch reseted) — wenn < 24h, skip
    const { data: recent } = await supabase
      .from('BUDGET_WARNING_FIRED')
      .select('FIRED_AT')
      .eq('RULE_ID', rule.ID)
      .order('FIRED_AT', { ascending: false })
      .limit(1);
    if (recent && recent.length > 0) {
      const last = new Date(recent[0].FIRED_AT).getTime();
      if (Date.now() - last < COOLDOWN_MS) return;
    }

    const { error: insErr } = await supabase
      .from('BUDGET_WARNING_FIRED').insert([{
        RULE_ID:        rule.ID,
        BUDGET_EUR:     budget,
        ACTUAL_EUR:     verbrauch,
        TRIGGER_TEC_ID: triggerTecId ?? null,
      }]);
    if (insErr) {
      console.warn(`[BUDGET_WARNING] insert fired failed: ${insErr.message}`);
      return;
    }
    await notifyBudgetWarning(supabase, {
      rule, project, structure, budget, actual: verbrauch, limitEur: limit,
      triggerEmployeeId, triggerTecId, tenantId,
    });
  } else if (!breached && open) {
    // Reset — kein Ping
    await supabase
      .from('BUDGET_WARNING_FIRED')
      .update({ RESET_AT: new Date().toISOString() })
      .eq('ID', open.ID);
  }
  // Sonst: bleibt im aktuellen Zustand
}

// ── Convenience-Hooks für buchungen.js ──────────────────────────────────────

// Wird nach confirmDrafts / patchBuchung / deleteBuchung aufgerufen.
// Sammelt aus structureIds die Ancestor-Kette und das Projekt, dann
// evaluiert in einem Rutsch.
async function evaluateAfterTecChange(supabase, { tenantId, projectId, structureIds, triggerEmployeeId, triggerTecId }) {
  if (!projectId) return;
  if (!structureIds || structureIds.size === 0) {
    await evaluateScopes(supabase, { tenantId, projectId, structureIds: new Set(), triggerEmployeeId, triggerTecId });
    return;
  }
  // Ancestor-Kette über bestehenden Tree aufbauen
  const { nodes } = await loadProjectTree(supabase, projectId);
  const fullScope = new Set();
  for (const sid of structureIds) {
    let cur = nodes.get(String(sid));
    while (cur) {
      fullScope.add(Number(cur.ID));
      cur = cur.FATHER_ID != null ? nodes.get(String(cur.FATHER_ID)) : null;
    }
  }
  await evaluateScopes(supabase, { tenantId, projectId, structureIds: fullScope, triggerEmployeeId, triggerTecId });
}

module.exports = {
  // Public API für andere Services
  evaluateAfterTecChange,
  evaluateScopes,
  // Helpers (auch nützlich für Reporting/Tab)
  projectAggregate,
  loadProjectTree,
  aggregateSubtree,
  getSettings,
};
