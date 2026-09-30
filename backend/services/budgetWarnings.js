'use strict';

const { createNotification } = require('./notifications');
const { assertProjectInTenant } = require('./tenantGuard');

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

// Buchungsarten ohne Stundencharakter — dieselbe Menge wie in services/buchungen.js
const SPECIAL_KINDS = new Set(['UNIT', 'LUMP_COST', 'LUMP_REVENUE']);

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
  // Runde 12: Die Vorbelegungen speicherten „aktiv" als leere Zeile (VALUE
  // null). Hier galt nur 'true' als aktiv — nach dem ersten Speichern der
  // Einstellungsseite waren Budget-Warnungen, beide Empfänger und die
  // Standard-Schwellen still aus, während die Seite „aktiv" zeigte. Eine
  // leere Zeile ist jetzt „nicht gesetzt", abschalten kann nur 'false'.
  const map = Object.fromEntries((data || [])
    .filter(r => r.VALUE != null && String(r.VALUE).trim() !== '')
    .map(r => [r.KEY, r.VALUE]));
  const merged = { ...DEFAULT_SETTINGS, ...map };
  const pcts = String(merged.budget_warning_default_pcts || '')
    .split(/[;,\s]+/).map(s => Number(s.trim().replace(',', '.'))).filter(n => n > 0);
  return {
    enabled:        merged.budget_warning_enabled !== 'false',
    defaultPcts:    pcts.length ? pcts : [75, 90, 100],
    notifyPm:       merged.budget_warning_notify_pm !== 'false',
    notifyBooker:   merged.budget_warning_notify_booker !== 'false',
  };
}

// ── Budget + Verbrauch laden ────────────────────────────────────────────────

// Lädt rekursiv alle Strukturknoten eines Projekts und liefert Maps:
//   childrenOf:  Map<parentId(string), childIds[]>
//   nodes:       Map<id(string), { ID, FATHER_ID, REVENUE, COSTS, SURCHARGES_TOTAL,
//                                  BILLING_TYPE_ID, PLAN_REVENUE, BOOKED_REVENUE }>
//
// Plan (Migration 0173): ein Blatt nach Aufwand mit Plan aus dem Angebot hat
// als Budget den Plan und als Verbrauch das gebuchte Honorar. Sein REVENUE ist
// die Summe der Buchungen — als Budget waechst es mit jeder Buchung mit und
// koennte nie warnen. Gebucht = Σ HOURLY_RATE_TOTAL der bestaetigten
// Buchungen, dieselbe Quelle wie REVENUE (services/buchungen.js).
async function loadProjectTree(supabase, projectId) {
  // ABBR/NAME/SORT_ORDER nur fuer die Uebersicht im Reiter „Interne Budgets"
  // (Runde 6) — vorher stand dort „Struktur #412" statt des Elements.
  const COLS = 'ID, FATHER_ID, ABBR, NAME, SORT_ORDER, REVENUE, COSTS, SURCHARGES_TOTAL, BILLING_TYPE_ID';
  let { data, error } = await supabase
    .from('PROJECT_STRUCTURE')
    .select(`${COLS}, PLAN_HOURS, PLAN_REVENUE`)
    .eq('PROJECT_ID', projectId);
  // Schema-Cache ohne die neue Spalte (Deploy vor dem Reload): wie bisher rechnen
  if (error && /PLAN_/.test(String(error.message || ''))) {
    ({ data, error } = await supabase
      .from('PROJECT_STRUCTURE')
      .select(COLS)
      .eq('PROJECT_ID', projectId));
  }
  if (error) throw new Error(error.message);
  const nodes = new Map();
  const childrenOf = new Map();
  for (const n of data || []) {
    nodes.set(String(n.ID), { ...n });
    if (n.FATHER_ID != null) {
      const fid = String(n.FATHER_ID);
      const arr = childrenOf.get(fid) || [];
      arr.push(String(n.ID));
      childrenOf.set(fid, arr);
    }
  }
  const planIds = [...nodes.values()]
    .filter(n => hasPlan(n) && !(childrenOf.get(String(n.ID)) || []).length)
    .map(n => n.ID);
  if (planIds.length) {
    const { data: bk, error: bkErr } = await supabase
      .from('BOOKING')
      .select('STRUCTURE_ID, HOURLY_RATE_TOTAL, QUANTITY_INT, BOOKING_KIND')
      .in('STRUCTURE_ID', planIds)
      .neq('STATUS', 'DRAFT');
    if (bkErr) throw new Error(bkErr.message);
    for (const id of planIds) Object.assign(nodes.get(String(id)), { BOOKED_REVENUE: 0, BOOKED_HOURS: 0 });
    for (const r of bk || []) {
      const n = nodes.get(String(r.STRUCTURE_ID));
      if (!n) continue;
      n.BOOKED_REVENUE += Number(r.HOURLY_RATE_TOTAL ?? 0) || 0;
      // Stunden nur aus Zeitbuchungen — Pauschalen und Stueckleistungen
      // tragen QUANTITY_INT = 0 bzw. eine Stueckzahl (services/buchungen.js)
      if (!SPECIAL_KINDS.has(r.BOOKING_KIND)) n.BOOKED_HOURS += Number(r.QUANTITY_INT ?? 0) || 0;
    }
  }
  return { nodes, childrenOf };
}

function hasPlan(n) {
  return Number(n.BILLING_TYPE_ID) === 2 && Number(n.PLAN_REVENUE ?? 0) > 0;
}

// Aggregat (rekursiv) eines Knotens:
//   - Budget = Σ REVENUE der Leaves im Subtree + eigene SURCHARGES_TOTAL der Parents
//   - Verbrauch = Σ COSTS der Leaves im Subtree
//   - Ausnahme Blatt nach Aufwand mit Plan: Budget = Plan, Verbrauch = gebucht
//   - plan: 'none' | 'some' | 'all' — wie viele Blaetter nach Plan rechnen
//     (fuer die Beschriftung in Uebersicht und Benachrichtigung)
function aggregateSubtree(structureIdStr, nodes, childrenOf, cache = new Map()) {
  if (cache.has(structureIdStr)) return cache.get(structureIdStr);
  const node = nodes.get(structureIdStr);
  if (!node) { const r = { budget: 0, verbrauch: 0, plan: 'none' }; cache.set(structureIdStr, r); return r; }
  const children = childrenOf.get(structureIdStr) || [];
  if (children.length === 0) {
    const r = hasPlan(node)
      ? { budget: round2(Number(node.PLAN_REVENUE)), verbrauch: round2(Number(node.BOOKED_REVENUE ?? 0)), plan: 'all' }
      // Leaf: REVENUE als Budget, COSTS als Verbrauch
      : { budget: Number(node.REVENUE ?? 0), verbrauch: Number(node.COSTS ?? 0), plan: 'none' };
    cache.set(structureIdStr, r);
    return r;
  }
  let b = 0, v = 0;
  const plans = new Set();
  for (const cid of children) {
    const c = aggregateSubtree(cid, nodes, childrenOf, cache);
    b += c.budget;
    v += c.verbrauch;
    plans.add(c.plan);
  }
  // Parent: eigene SURCHARGES_TOTAL dazu (Aufschlag des Parents auf Children)
  b += Number(node.SURCHARGES_TOTAL ?? 0);
  const plan = plans.size === 1 ? [...plans][0] : 'some';
  const r = { budget: round2(b), verbrauch: round2(v), plan };
  cache.set(structureIdStr, r);
  return r;
}

/** Beschriftung von Budget und Verbrauch je nach Plan-Anteil. */
function budgetLabels(plan) {
  if (plan === 'all')  return { budget: 'Plan aus dem Angebot', verbrauch: 'Gebucht' };
  if (plan === 'some') return { budget: 'Budget (Honorar bzw. Plan)', verbrauch: 'Verbraucht' };
  return { budget: 'Honorar + Zuschläge', verbrauch: 'Verbraucht' };
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
    .select('ID, ABBR, NAME, PROJECT_MANAGER_ID, BUDGET_WARNINGS_MUTED')
    .eq('ID', projectId)
    .maybeSingle();
  return data || null;
}

async function loadStructureName(supabase, structureId) {
  const { data } = await supabase
    .from('PROJECT_STRUCTURE')
    .select('ID, ABBR, NAME, PROJECT_ID')
    .eq('ID', structureId)
    .maybeSingle();
  return data || null;
}

async function notifyBudgetWarning(supabase, { rule, project, structure, budget, actual, limitEur, plan = 'none', triggerEmployeeId, triggerTecId, tenantId }) {
  const recipients = new Set();
  if (rule.NOTIFY_PM && project?.PROJECT_MANAGER_ID) recipients.add(Number(project.PROJECT_MANAGER_ID));
  if (rule.NOTIFY_BOOKER && triggerEmployeeId)        recipients.add(Number(triggerEmployeeId));
  if (Array.isArray(rule.NOTIFY_CC)) {
    for (const eid of rule.NOTIFY_CC) if (eid) recipients.add(Number(eid));
  }
  if (recipients.size === 0) {
    console.warn(`[BUDGET_WARNING] rule ${rule.ID}: KEINE Empfaenger (PM=${rule.NOTIFY_PM}/PMSet=${!!project?.PROJECT_MANAGER_ID}, BOOKER=${rule.NOTIFY_BOOKER}/BookerSet=${!!triggerEmployeeId}, CC=${(rule.NOTIFY_CC||[]).length})`);
    return;
  }
  console.log(`[BUDGET_WARNING] rule ${rule.ID}: ${recipients.size} Empfaenger: ${Array.from(recipients).join(',')}`);

  const scopeLabel = structure
    ? `${structure.ABBR ?? ''}${structure.NAME ? ' – ' + structure.NAME : ''}`
    : 'Projekt-Ebene';
  const projectLabel = `${project?.ABBR ?? ''}${project?.NAME ? ': ' + project.NAME : ''}`;

  const pctActual = budget > 0 ? round2(actual / budget * 100) : 0;
  const labels = budgetLabels(plan);
  const title = `Budget ${Number(rule.THRESHOLD_PCT)} % erreicht – ${scopeLabel}`;
  const body  = [
    `Projekt ${projectLabel}`,
    `${labels.budget}: ${fmtEur(budget)}`,
    `Schwellenwert: ${Number(rule.THRESHOLD_PCT)} % = ${fmtEur(limitEur)}`,
    `${labels.verbrauch}: ${fmtEur(actual)} (${pctActual.toFixed(1).replace('.', ',')} %)`,
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
  let budget, verbrauch, structure = null, plan = 'none';
  if (rule.STRUCTURE_ID) {
    const sid = String(rule.STRUCTURE_ID);
    if (!nodes.has(sid)) {
      console.log(`[BUDGET_WARNING] rule ${rule.ID}: STRUCTURE ${rule.STRUCTURE_ID} nicht gefunden, skip`);
      return;
    }
    const agg = aggregateSubtree(sid, nodes, childrenOf, aggCache);
    budget = agg.budget;
    verbrauch = agg.verbrauch;
    plan = agg.plan;
    structure = await loadStructureName(supabase, rule.STRUCTURE_ID);
  } else {
    // Projekt-Ebene
    let b = 0, v = 0;
    const plans = new Set();
    for (const node of nodes.values()) {
      if (node.FATHER_ID == null) {
        const r = aggregateSubtree(String(node.ID), nodes, childrenOf, aggCache);
        b += r.budget; v += r.verbrauch; plans.add(r.plan);
      }
    }
    plan = plans.size === 1 ? [...plans][0] : plans.size ? 'some' : 'none';
    try {
      const { data: proj } = await supabase
        .from('PROJECT').select('SURCHARGES_TOTAL').eq('ID', project.ID).maybeSingle();
      if (proj?.SURCHARGES_TOTAL) b += Number(proj.SURCHARGES_TOTAL);
    } catch (_) { /* */ }
    budget = round2(b);
    verbrauch = round2(v);
  }
  if (budget <= 0) {
    console.log(`[BUDGET_WARNING] rule ${rule.ID}: Budget = 0, skip`);
    return;
  }

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

  console.log(`[BUDGET_WARNING] rule ${rule.ID} (proj=${project.ID}, struct=${rule.STRUCTURE_ID ?? '-'}, pct=${rule.THRESHOLD_PCT}): budget=${budget}, verbrauch=${verbrauch}, limit=${limit}, breached=${breached}, open=${!!open}`);

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
      const dtMs = Date.now() - last;
      if (dtMs < COOLDOWN_MS) {
        console.log(`[BUDGET_WARNING] rule ${rule.ID}: Cooldown aktiv (${Math.round(dtMs/60000)} min < 24h), skip`);
        return;
      }
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
    console.log(`[BUDGET_WARNING] rule ${rule.ID}: FIRE notification`);
    await notifyBudgetWarning(supabase, {
      rule, project, structure, budget, actual: verbrauch, limitEur: limit, plan,
      triggerEmployeeId, triggerTecId, tenantId,
    });
  } else if (!breached && open) {
    console.log(`[BUDGET_WARNING] rule ${rule.ID}: RESET open trigger`);
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

// ── CRUD / Tab-Daten ────────────────────────────────────────────────────────

async function listRulesForProject(supabase, { tenantId, projectId }) {
  // Alle Regeln dieses Projekts (Projekt-Ebene + alle Strukturen darunter)
  const { data: structures } = await supabase
    .from('PROJECT_STRUCTURE').select('ID').eq('PROJECT_ID', projectId);
  const sids = (structures || []).map(s => s.ID);
  const orParts = [`PROJECT_ID.eq.${projectId}`];
  if (sids.length > 0) orParts.push(`STRUCTURE_ID.in.(${sids.join(',')})`);
  const { data, error } = await supabase
    .from('BUDGET_WARNING_RULE').select('*')
    .eq('TENANT_ID', tenantId)
    .or(orParts.join(','))
    .order('STRUCTURE_ID', { ascending: true, nullsFirst: true })
    .order('THRESHOLD_PCT', { ascending: true });
  if (error) throw { status: 500, message: error.message };
  return data || [];
}

async function listRecentFiredForProject(supabase, { tenantId, projectId, limit = 20 }) {
  const rules = await listRulesForProject(supabase, { tenantId, projectId });
  const ids = rules.map(r => r.ID);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('BUDGET_WARNING_FIRED').select('*')
    .in('RULE_ID', ids)
    .order('FIRED_AT', { ascending: false })
    .limit(limit);
  if (error) throw { status: 500, message: error.message };
  return data || [];
}

async function getProjectOverview(supabase, { tenantId, projectId }) {
  // loadProjectMeta, projectAggregate und loadProjectTree filtern selbst nur
  // nach PROJECT_ID. Ohne diese Pruefung lieferte der Endpunkt Budget und
  // Verbrauch fremder Projekte aus (Pentest 2026-08-06).
  await assertProjectInTenant(supabase, projectId, tenantId);

  const project = await loadProjectMeta(supabase, projectId);
  if (!project) throw { status: 404, message: 'Projekt nicht gefunden' };

  const projAgg = await projectAggregate(supabase, projectId);
  const { nodes, childrenOf } = await loadProjectTree(supabase, projectId);
  const cache = new Map();
  const structures = Array.from(nodes.values()).map(n => {
    const agg = aggregateSubtree(String(n.ID), nodes, childrenOf, cache);
    const leaf = !(childrenOf.get(String(n.ID)) || []).length;
    return {
      ID:         n.ID,
      FATHER_ID:  n.FATHER_ID,
      ABBR:       n.ABBR ?? null,
      NAME:       n.NAME ?? null,
      SORT_ORDER: n.SORT_ORDER ?? null,
      leaf,
      budget:     agg.budget,
      verbrauch:  agg.verbrauch,
      plan:       agg.plan,
      // Blatt nach Plan: Stunden neben dem Honorar, damit der Reiter zeigen
      // kann, wie weit die geplanten Stunden verbraucht sind
      ...(leaf && hasPlan(n) ? {
        planHours:     n.PLAN_HOURS != null ? round2(n.PLAN_HOURS) : null,
        bookedHours:   round2(n.BOOKED_HOURS ?? 0),
      } : {}),
    };
  });

  const rules = await listRulesForProject(supabase, { tenantId, projectId });
  const fired = await listRecentFiredForProject(supabase, { tenantId, projectId, limit: 50 });

  return {
    project: {
      ID: project.ID,
      ABBR: project.ABBR,
      NAME:  project.NAME,
      PROJECT_MANAGER_ID: project.PROJECT_MANAGER_ID,
      BUDGET_WARNINGS_MUTED: !!project.BUDGET_WARNINGS_MUTED,
    },
    projectAggregate: projAgg,
    structures,
    rules,
    fired,
  };
}

async function createRule(supabase, { tenantId, projectId, body, employeeId }) {
  await assertProjectInTenant(supabase, projectId, tenantId);
  const b = body || {};
  const pct = Number(b.threshold_pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 500) {
    throw { status: 400, message: 'threshold_pct muss > 0 und <= 500 sein' };
  }
  const structureId = b.structure_id != null && b.structure_id !== '' ? Number(b.structure_id) : null;
  // Scope-Check: STRUCTURE_ID muss im Projekt liegen, sonst Projekt-Regel
  if (structureId != null) {
    const { data: s } = await supabase
      .from('PROJECT_STRUCTURE').select('ID, PROJECT_ID').eq('ID', structureId).maybeSingle();
    if (!s || Number(s.PROJECT_ID) !== Number(projectId)) {
      throw { status: 400, message: 'STRUCTURE_ID gehört nicht zum Projekt' };
    }
  }
  const row = {
    TENANT_ID:     tenantId,
    PROJECT_ID:    structureId == null ? Number(projectId) : null,
    STRUCTURE_ID:  structureId,
    THRESHOLD_PCT: pct,
    NOTIFY_PM:     b.notify_pm     !== false,
    NOTIFY_BOOKER: b.notify_booker !== false,
    NOTIFY_CC:     Array.isArray(b.notify_cc) ? b.notify_cc.map(Number).filter(Number.isFinite) : null,
    MUTED:         !!b.muted,
    CREATED_BY:    employeeId ?? null,
  };
  const { data, error } = await supabase
    .from('BUDGET_WARNING_RULE').insert([row]).select('*').single();
  if (error) throw { status: 500, message: error.message };

  // Sofort-Eval: wenn die neue Regel bereits ueberschritten ist, Notification
  // jetzt feuern (nicht erst beim naechsten BOOKING-Change warten)
  try {
    await evaluateAfterTecChange(supabase, {
      tenantId,
      projectId,
      structureIds: structureId != null ? new Set([Number(structureId)]) : new Set(),
      triggerEmployeeId: employeeId ?? null,
      triggerTecId: null,
    });
  } catch (e) {
    console.warn(`[BUDGET_WARNING] post-create eval failed: ${e?.message || e}`);
  }
  return data;
}

async function updateRule(supabase, { tenantId, ruleId, body }) {
  const b = body || {};
  const patch = {};
  let thresholdChanged = false;
  if (b.threshold_pct !== undefined) {
    const pct = Number(b.threshold_pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 500) {
      throw { status: 400, message: 'threshold_pct muss > 0 und <= 500 sein' };
    }
    patch.THRESHOLD_PCT = pct;
    thresholdChanged = true;
  }
  if (b.notify_pm     !== undefined) patch.NOTIFY_PM     = !!b.notify_pm;
  if (b.notify_booker !== undefined) patch.NOTIFY_BOOKER = !!b.notify_booker;
  if (b.notify_cc     !== undefined) {
    patch.NOTIFY_CC = Array.isArray(b.notify_cc)
      ? b.notify_cc.map(Number).filter(Number.isFinite) : null;
  }
  if (b.muted !== undefined) patch.MUTED = !!b.muted;
  if (Object.keys(patch).length === 0) {
    throw { status: 400, message: 'Keine Felder zum Aktualisieren' };
  }
  const { data, error } = await supabase
    .from('BUDGET_WARNING_RULE').update(patch)
    .eq('ID', ruleId).eq('TENANT_ID', tenantId)
    .select('*').single();
  if (error) throw { status: 500, message: error.message };

  // Schwellen-Aenderung: offenen Trigger schliessen, damit Sofort-Eval
  // mit der neuen Schwelle frisch entscheiden kann (Fire oder nicht).
  if (thresholdChanged) {
    try {
      await supabase
        .from('BUDGET_WARNING_FIRED')
        .update({ RESET_AT: new Date().toISOString() })
        .eq('RULE_ID', ruleId)
        .is('RESET_AT', null);
    } catch (e) {
      console.warn(`[BUDGET_WARNING] could not close open trigger on threshold change: ${e?.message || e}`);
    }
  }

  // Sofort-Eval auf die geaenderte Regel (Schwelle koennte jetzt
  // ueberschritten oder zurueckgesetzt sein)
  try {
    const projectId = data.PROJECT_ID
      ?? (data.STRUCTURE_ID ? await (async () => {
        const { data: s } = await supabase
          .from('PROJECT_STRUCTURE').select('PROJECT_ID').eq('ID', data.STRUCTURE_ID).maybeSingle();
        return s?.PROJECT_ID ?? null;
      })() : null);
    if (projectId) {
      await evaluateAfterTecChange(supabase, {
        tenantId,
        projectId,
        structureIds: data.STRUCTURE_ID ? new Set([Number(data.STRUCTURE_ID)]) : new Set(),
        triggerEmployeeId: null,
        triggerTecId: null,
      });
    }
  } catch (e) {
    console.warn(`[BUDGET_WARNING] post-update eval failed: ${e?.message || e}`);
  }
  return data;
}

async function deleteRule(supabase, { tenantId, ruleId }) {
  const { error } = await supabase
    .from('BUDGET_WARNING_RULE').delete()
    .eq('ID', ruleId).eq('TENANT_ID', tenantId);
  if (error) throw { status: 500, message: error.message };
  return { ok: true };
}

async function setProjectMute(supabase, { tenantId, projectId, muted }) {
  await assertProjectInTenant(supabase, projectId, tenantId);
  const { data, error } = await supabase
    .from('PROJECT').update({ BUDGET_WARNINGS_MUTED: !!muted })
    .eq('ID', projectId).eq('TENANT_ID', tenantId)
    .select('ID, BUDGET_WARNINGS_MUTED').single();
  if (error) throw { status: 500, message: error.message };
  return data;
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
  // CRUD / Tab-Daten
  getProjectOverview,
  listRulesForProject,
  listRecentFiredForProject,
  createRule,
  updateRule,
  deleteRule,
  setProjectMute,
};
