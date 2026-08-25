'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Service: Nachträge (Modul N1 — eigene Honorar-Nachträge)
// Ein Nachtrag ist strukturell ein projektgebundenes Mini-Angebot. Kopf +
// Struktur spiegeln OFFER / OFFER_STRUCTURE (siehe services/angebote.js). Bei
// Freigabe werden anerkannte Positionen — analog convertOfferToProject —
// inkrementell in PROJECT_STRUCTURE übernommen (Option A: ein „Nachträge"-
// Wurzelknoten je Projekt, darunter je Nachtrag ein Gruppenknoten). Danach
// greifen Buchungen (TEC) und Abrechnung (INVOICE) ohne Sonderpfad.
//
// Konzept: docs/NACHTRAG_CONCEPT.md · Migrationen: 0105 (Schema) / 0106 (RBAC)
// ─────────────────────────────────────────────────────────────────────────────

function fmt2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Zuschlagsberechnung — identisch zur Angebots-Logik (kumulativ optional).
function computeSurcharges(revenueBasis, settings) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const s1Label = settings?.SURCHARGE_1_LABEL ?? null;
  const s1Pct   = Number(settings?.SURCHARGE_1_PCT ?? 0);
  const s1Cumul = !!(settings?.SURCHARGE_1_CUMUL ?? true);
  const s2Label = settings?.SURCHARGE_2_LABEL ?? null;
  const s2Pct   = Number(settings?.SURCHARGE_2_PCT ?? 0);
  const s2Cumul = !!(settings?.SURCHARGE_2_CUMUL ?? true);
  const s3Label = settings?.SURCHARGE_3_LABEL ?? null;
  const s3Pct   = Number(settings?.SURCHARGE_3_PCT ?? 0);
  const s3Cumul = !!(settings?.SURCHARGE_3_CUMUL ?? true);

  const s1Active = s1Label !== null && s1Label !== '' && s1Pct !== 0;
  const s1Eur    = s1Active ? r2(revenueBasis * s1Pct / 100) : 0;
  const s1Sub    = revenueBasis + s1Eur;

  const s2Base   = s2Cumul ? s1Sub : revenueBasis;
  const s2Active = s2Label !== null && s2Label !== '' && s2Pct !== 0;
  const s2Eur    = s2Active ? r2(s2Base * s2Pct / 100) : 0;
  const s2Sub    = s1Sub + s2Eur;

  const s3Base   = s3Cumul ? s2Sub : revenueBasis;
  const s3Active = s3Label !== null && s3Label !== '' && s3Pct !== 0;
  const s3Eur    = s3Active ? r2(s3Base * s3Pct / 100) : 0;

  return { s1Eur, s2Eur, s3Eur, surchargesTotal: r2(s1Eur + s2Eur + s3Eur) };
}

const VALID_TYPES      = new Set(['OWN', 'MANAGED']);
const VALID_CATEGORIES = new Set(['CHANGED', 'ADDITIONAL', 'QUANTITY', 'SPECIAL', 'DISRUPTION', 'CONTENT', 'CIRCUMSTANCE']);
const VALID_RECOMMENDATIONS = new Set(['ACCEPT', 'REDUCE', 'REJECT', 'QUERY']);

// ── Status-Lookup (global) ───────────────────────────────────────────────────

async function listStatuses(supabase) {
  const { data, error } = await supabase
    .from('NACHTRAG_STATUS')
    .select('ID, CODE, NAME_SHORT, SORT_ORDER, IS_TERMINAL, ALLOWS_RELEASE')
    .order('SORT_ORDER', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function statusByCode(supabase, code) {
  const { data, error } = await supabase
    .from('NACHTRAG_STATUS').select('ID, CODE, ALLOWS_RELEASE').eq('CODE', code).maybeSingle();
  if (error) throw error;
  return data || null;
}

// ── Nachträge (Kopf) ─────────────────────────────────────────────────────────

async function list(supabase, { tenantId, projectId }) {
  let q = supabase
    .from('NACHTRAG')
    .select('ID, NAME_SHORT, NAME_LONG, NACHTRAG_TYPE, NACHTRAG_STATUS_ID, CATEGORY, PROJECT_ID, EMPLOYEE_ID, ADDRESS_ID, REVIEW_DUE_DATE, AMOUNT_CLAIMED_NET, AMOUNT_APPROVED_NET, CREATED_AT')
    .eq('TENANT_ID', tenantId);
  if (projectId) q = q.eq('PROJECT_ID', projectId);
  const { data, error } = await q.order('ID', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return [];

  const statusIds  = [...new Set(rows.map(r => r.NACHTRAG_STATUS_ID).filter(Boolean))];
  const projectIds = [...new Set(rows.map(r => r.PROJECT_ID).filter(Boolean))];
  const empIds     = [...new Set(rows.map(r => r.EMPLOYEE_ID).filter(Boolean))];
  const addrIds    = [...new Set(rows.map(r => r.ADDRESS_ID).filter(Boolean))];

  const [statusRes, projRes, empRes, addrRes] = await Promise.all([
    statusIds.length  ? supabase.from('NACHTRAG_STATUS').select('ID, CODE, NAME_SHORT').in('ID', statusIds) : Promise.resolve({ data: [] }),
    projectIds.length ? supabase.from('PROJECT').select('ID, NAME_SHORT, NAME_LONG').in('ID', projectIds)   : Promise.resolve({ data: [] }),
    empIds.length     ? supabase.from('EMPLOYEE').select('ID, SHORT_NAME, FIRST_NAME, LAST_NAME').in('ID', empIds) : Promise.resolve({ data: [] }),
    addrIds.length    ? supabase.from('ADDRESS').select('ID, ADDRESS_NAME_1').in('ID', addrIds)             : Promise.resolve({ data: [] }),
  ]);

  const statusMap = new Map((statusRes.data || []).map(r => [r.ID, r]));
  const projMap   = new Map((projRes.data   || []).map(r => [r.ID, r]));
  const empMap    = new Map((empRes.data    || []).map(r => [r.ID, r]));
  const addrMap   = new Map((addrRes.data   || []).map(r => [r.ID, r]));

  return rows.map(r => {
    const emp = empMap.get(r.EMPLOYEE_ID);
    const st  = statusMap.get(r.NACHTRAG_STATUS_ID);
    return {
      ID:                  r.ID,
      NAME_SHORT:          r.NAME_SHORT,
      NAME_LONG:           r.NAME_LONG,
      NACHTRAG_TYPE:       r.NACHTRAG_TYPE,
      CATEGORY:            r.CATEGORY,
      STATUS_CODE:         st?.CODE ?? null,
      STATUS_NAME:         st?.NAME_SHORT ?? null,
      NACHTRAG_STATUS_ID:  r.NACHTRAG_STATUS_ID,
      PROJECT_ID:          r.PROJECT_ID,
      PROJECT_NAME:        projMap.get(r.PROJECT_ID)?.NAME_SHORT ?? null,
      EMPLOYEE_NAME:       emp ? `${emp.SHORT_NAME ? emp.SHORT_NAME + ': ' : ''}${emp.FIRST_NAME ?? ''} ${emp.LAST_NAME ?? ''}`.trim() : null,
      ADDRESS_NAME:        addrMap.get(r.ADDRESS_ID)?.ADDRESS_NAME_1 ?? null,
      REVIEW_DUE_DATE:     r.REVIEW_DUE_DATE ?? null,
      AMOUNT_CLAIMED_NET:  fmt2(r.AMOUNT_CLAIMED_NET),
      AMOUNT_APPROVED_NET: fmt2(r.AMOUNT_APPROVED_NET),
      CREATED_AT:          r.CREATED_AT,
    };
  });
}

async function get(supabase, { tenantId, nachtragId }) {
  const { data, error } = await supabase
    .from('NACHTRAG').select('*').eq('ID', nachtragId).eq('TENANT_ID', tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw { status: 404, message: 'Nachtrag nicht gefunden' };
  return data;
}

async function create(supabase, { tenantId, body, employeeId }) {
  const b = body || {};
  if (!b.project_id)                       throw { status: 400, message: 'Projekt ist erforderlich' };
  if (!b.name_long || !String(b.name_long).trim()) throw { status: 400, message: 'Betreff (name_long) ist erforderlich' };

  const type = b.nachtrag_type && VALID_TYPES.has(String(b.nachtrag_type)) ? String(b.nachtrag_type) : 'OWN';
  const category = b.category && VALID_CATEGORIES.has(String(b.category)) ? String(b.category) : null;

  // Projekt laden (Firma für Nummernkreis, Gegenseite-Vorbelegung, Vertrag)
  const { data: project, error: projErr } = await supabase
    .from('PROJECT').select('ID, COMPANY_ID, ADDRESS_ID, CONTACT_ID').eq('ID', b.project_id).eq('TENANT_ID', tenantId).maybeSingle();
  if (projErr) throw projErr;
  if (!project) throw { status: 404, message: 'Projekt nicht gefunden' };
  const companyId = project.COMPANY_ID ? parseInt(String(project.COMPANY_ID), 10) : null;
  if (!companyId) throw { status: 400, message: 'Projekt hat keine Firma (Nummernkreis nicht möglich)' };

  // Nummer via RPC (NT-YY-NNN)
  const { data: num, error: numErr } = await supabase.rpc('next_nachtrag_number', { p_company_id: companyId });
  if (numErr || !num) throw { status: 500, message: 'Nummernkreis konnte nicht geladen werden: ' + (numErr?.message || 'kein Ergebnis') };

  // Zugehörigen Vertrag (optional) ermitteln
  const { data: contract } = await supabase.from('CONTRACT').select('ID').eq('PROJECT_ID', project.ID).eq('TENANT_ID', tenantId).limit(1).maybeSingle();

  // Default-USt aus Tenant-Settings
  const { data: settingsRows } = await supabase.from('TENANT_SETTINGS').select('KEY, VALUE').eq('TENANT_ID', tenantId);
  const defaults = {};
  for (const row of settingsRows || []) defaults[row.KEY] = row.VALUE;
  const vatId = b.vat_id ? parseInt(String(b.vat_id), 10) : (defaults.default_vat_id ? Number(defaults.default_vat_id) : null);

  const draft = await statusByCode(supabase, 'DRAFT');

  const insertRow = {
    TENANT_ID:          tenantId,
    PROJECT_ID:         project.ID,
    CONTRACT_ID:        contract?.ID ?? null,
    NAME_SHORT:         num,
    NAME_LONG:          String(b.name_long).trim(),
    NACHTRAG_TYPE:      type,
    NACHTRAG_STATUS_ID: draft?.ID ?? null,
    CATEGORY:           category,
    CLAIM_BASIS:        b.claim_basis ? String(b.claim_basis) : null,
    REASON:             b.reason ? String(b.reason) : null,
    EMPLOYEE_ID:        b.employee_id ? parseInt(String(b.employee_id), 10) : (employeeId ?? null),
    ADDRESS_ID:         b.address_id ? parseInt(String(b.address_id), 10) : (project.ADDRESS_ID ?? null),
    CONTACT_ID:         b.contact_id ? parseInt(String(b.contact_id), 10) : (project.CONTACT_ID ?? null),
    COMPANY_ID:         companyId,
    ...(vatId ? { VAT_ID: vatId } : {}),
    ANNOUNCED_DATE:     b.announced_date  || null,
    SUBMITTED_DATE:     b.submitted_date  || null,
    REVIEW_DUE_DATE:    b.review_due_date || null,
    AMOUNT_CLAIMED_NET: 0,
    AMOUNT_APPROVED_NET: 0,
  };

  const { data: created, error: insErr } = await supabase.from('NACHTRAG').insert([insertRow]).select('*').single();
  if (insErr) throw { status: 500, message: 'Nachtrag konnte nicht angelegt werden: ' + insErr.message };

  await writeAudit(supabase, { tenantId, nachtragId: created.ID, eventType: 'CREATED', actorId: employeeId, details: { number: num } });
  return created;
}

async function update(supabase, { tenantId, nachtragId, body, employeeId }) {
  const b = body || {};
  const cur = await get(supabase, { tenantId, nachtragId });

  // Struktur/Inhalt nach Beauftragung sperren (Freigabehistorie schützen)
  const st = cur.NACHTRAG_STATUS_ID ? (await supabase.from('NACHTRAG_STATUS').select('CODE').eq('ID', cur.NACHTRAG_STATUS_ID).maybeSingle()).data : null;
  if (st && (st.CODE === 'COMMISSIONED')) throw { status: 409, message: 'Beauftragte Nachträge können nicht mehr bearbeitet werden' };

  const patch = {};
  if (b.name_long        !== undefined) patch.NAME_LONG      = String(b.name_long).trim();
  if (b.nachtrag_type    !== undefined && VALID_TYPES.has(String(b.nachtrag_type)))      patch.NACHTRAG_TYPE = String(b.nachtrag_type);
  if (b.category         !== undefined) patch.CATEGORY       = b.category && VALID_CATEGORIES.has(String(b.category)) ? String(b.category) : null;
  if (b.claim_basis      !== undefined) patch.CLAIM_BASIS    = b.claim_basis || null;
  if (b.reason           !== undefined) patch.REASON         = b.reason || null;
  if (b.is_granted_basis !== undefined) patch.IS_GRANTED_BASIS = !!b.is_granted_basis;
  if (b.employee_id      !== undefined) patch.EMPLOYEE_ID    = b.employee_id ? parseInt(String(b.employee_id), 10) : null;
  if (b.address_id       !== undefined) patch.ADDRESS_ID     = b.address_id ? parseInt(String(b.address_id), 10) : null;
  if (b.contact_id       !== undefined) patch.CONTACT_ID     = b.contact_id ? parseInt(String(b.contact_id), 10) : null;
  if (b.vat_id           !== undefined) patch.VAT_ID         = b.vat_id ? parseInt(String(b.vat_id), 10) : null;
  if (b.announced_date   !== undefined) patch.ANNOUNCED_DATE  = b.announced_date  || null;
  if (b.submitted_date   !== undefined) patch.SUBMITTED_DATE  = b.submitted_date  || null;
  if (b.review_due_date  !== undefined) patch.REVIEW_DUE_DATE = b.review_due_date || null;
  if (b.decision_date    !== undefined) patch.DECISION_DATE   = b.decision_date   || null;

  // Statuswechsel (nur wenn explizit gesetzt; per Code für Stabilität)
  if (b.status_code !== undefined && b.status_code) {
    const target = await statusByCode(supabase, String(b.status_code));
    if (!target) throw { status: 400, message: 'Unbekannter Status: ' + b.status_code };
    patch.NACHTRAG_STATUS_ID = target.ID;
  }

  const { data, error } = await supabase.from('NACHTRAG').update(patch).eq('ID', nachtragId).eq('TENANT_ID', tenantId).select('*').single();
  if (error) throw error;

  if (patch.NACHTRAG_STATUS_ID && patch.NACHTRAG_STATUS_ID !== cur.NACHTRAG_STATUS_ID) {
    await writeAudit(supabase, { tenantId, nachtragId, eventType: 'STATUS_CHANGE', actorId: employeeId, details: { from: cur.NACHTRAG_STATUS_ID, to: patch.NACHTRAG_STATUS_ID } });
  }
  return data;
}

async function remove(supabase, { tenantId, nachtragId }) {
  const cur = await get(supabase, { tenantId, nachtragId });
  const st = cur.NACHTRAG_STATUS_ID ? (await supabase.from('NACHTRAG_STATUS').select('CODE').eq('ID', cur.NACHTRAG_STATUS_ID).maybeSingle()).data : null;
  if (st && st.CODE !== 'DRAFT') throw { status: 409, message: 'Nur Nachträge im Entwurf können gelöscht werden' };
  // Struktur zuerst
  await supabase.from('NACHTRAG_STRUCTURE').delete().eq('NACHTRAG_ID', nachtragId).eq('TENANT_ID', tenantId);
  const { error } = await supabase.from('NACHTRAG').delete().eq('ID', nachtragId).eq('TENANT_ID', tenantId);
  if (error) throw error;
}

// ── Struktur (baugleich zu OFFER_STRUCTURE) ──────────────────────────────────

async function getStructure(supabase, { tenantId, nachtragId }) {
  const { data, error } = await supabase
    .from('NACHTRAG_STRUCTURE').select('*').eq('NACHTRAG_ID', nachtragId).eq('TENANT_ID', tenantId)
    .order('SORT_ORDER', { ascending: true }).order('ID', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function addStructureNode(supabase, { tenantId, nachtragId, body }) {
  const b    = body || {};
  const btId = b.billing_type_id ? parseInt(String(b.billing_type_id), 10) : null;
  if (!btId) throw { status: 400, message: 'billing_type_id ist erforderlich' };

  const isHourly = btId === 2;
  const quantity = isHourly ? (Number(b.quantity) || 0) : null;
  const spRate   = isHourly ? (Number(b.sp_rate)  || 0) : null;
  const revenue  = isHourly ? fmt2((quantity || 0) * (spRate || 0)) : fmt2(Number(b.revenue) || 0);
  const extPct   = Number(b.extras_percent) || 0;
  const extras   = fmt2(revenue * extPct / 100);
  const fatherId = b.father_id ? parseInt(String(b.father_id), 10) : null;

  const sibQuery = supabase.from('NACHTRAG_STRUCTURE').select('SORT_ORDER').eq('NACHTRAG_ID', nachtragId);
  const { data: siblings } = fatherId !== null ? await sibQuery.eq('FATHER_ID', fatherId) : await sibQuery.is('FATHER_ID', null);
  const maxSort = siblings && siblings.length ? Math.max(...siblings.map(s => Number(s.SORT_ORDER ?? 0))) : -10;

  const { data, error } = await supabase.from('NACHTRAG_STRUCTURE').insert([{
    NAME_SHORT:      String(b.name_short || '').trim(),
    NAME_LONG:       String(b.name_long  || '').trim(),
    NACHTRAG_ID:     nachtragId,
    BILLING_TYPE_ID: btId,
    FATHER_ID:       fatherId,
    REVENUE_BASIS:   revenue,
    REVENUE:         revenue,
    SURCHARGES_TOTAL: 0,
    EXTRAS_PERCENT:  extPct,
    EXTRAS:          extras,
    SORT_ORDER:      maxSort + 10,
    QUANTITY:        quantity,
    SP_RATE:         spRate,
    APPROVAL_STATE:  'OPEN',
    ROLE_NAME_SHORT: b.role_name_short || null,
    ROLE_NAME_LONG:  b.role_name_long  || null,
    ROLE_ID:         b.role_id ? parseInt(String(b.role_id), 10) : null,
    TENANT_ID:       tenantId,
  }]).select('*').single();
  if (error) throw error;
  if (fatherId !== null) await recalcParent(supabase, { parentId: fatherId });
  await recomputeHeadTotals(supabase, { tenantId, nachtragId });
  return data;
}

async function updateStructureNode(supabase, { tenantId, nodeId, body }) {
  const b        = body || {};
  const r2       = (n) => Math.round(n * 100) / 100;
  const btId     = b.billing_type_id != null ? parseInt(String(b.billing_type_id), 10) : undefined;
  const isHourly = btId === 2;
  const patch    = {};

  if (b.name_short     !== undefined) patch.NAME_SHORT      = String(b.name_short).trim();
  if (b.name_long      !== undefined) patch.NAME_LONG       = String(b.name_long).trim();
  if (btId             !== undefined) patch.BILLING_TYPE_ID = btId;
  if (b.extras_percent !== undefined) patch.EXTRAS_PERCENT  = Number(b.extras_percent) || 0;
  if (b.role_name_short !== undefined) patch.ROLE_NAME_SHORT = b.role_name_short || null;
  if (b.role_name_long  !== undefined) patch.ROLE_NAME_LONG  = b.role_name_long  || null;
  if (b.role_id         !== undefined) patch.ROLE_ID         = b.role_id ? parseInt(String(b.role_id), 10) : null;

  for (const i of [1, 2, 3]) {
    if (b[`SURCHARGE_${i}_LABEL`] !== undefined) patch[`SURCHARGE_${i}_LABEL`] = b[`SURCHARGE_${i}_LABEL`];
    if (b[`SURCHARGE_${i}_PCT`]   !== undefined) patch[`SURCHARGE_${i}_PCT`]   = b[`SURCHARGE_${i}_PCT`] != null ? Number(b[`SURCHARGE_${i}_PCT`]) : null;
    if (b[`SURCHARGE_${i}_CUMUL`] !== undefined) patch[`SURCHARGE_${i}_CUMUL`] = !!b[`SURCHARGE_${i}_CUMUL`];
  }

  const hasSurchargeChange = [1, 2, 3].some(i => b[`SURCHARGE_${i}_LABEL`] !== undefined || b[`SURCHARGE_${i}_PCT`] !== undefined);
  const hasRevenueChange   = isHourly || b.quantity !== undefined || b.sp_rate !== undefined || b.revenue !== undefined;

  if (hasRevenueChange || hasSurchargeChange || patch.EXTRAS_PERCENT !== undefined) {
    const { data: c } = await supabase.from('NACHTRAG_STRUCTURE')
      .select('REVENUE_BASIS, REVENUE, EXTRAS_PERCENT, QUANTITY, SP_RATE, SURCHARGE_1_LABEL, SURCHARGE_1_PCT, SURCHARGE_1_CUMUL, SURCHARGE_2_LABEL, SURCHARGE_2_PCT, SURCHARGE_2_CUMUL, SURCHARGE_3_LABEL, SURCHARGE_3_PCT, SURCHARGE_3_CUMUL')
      .eq('ID', nodeId).maybeSingle();

    let revenueBasis;
    if (isHourly || b.quantity !== undefined || b.sp_rate !== undefined) {
      const q = Number(b.quantity ?? c?.QUANTITY ?? 0);
      const s = Number(b.sp_rate  ?? c?.SP_RATE  ?? 0);
      if (b.quantity !== undefined) patch.QUANTITY = q;
      if (b.sp_rate  !== undefined) patch.SP_RATE  = s;
      revenueBasis = r2(q * s);
    } else if (b.revenue !== undefined) {
      revenueBasis = r2(Number(b.revenue));
    } else {
      revenueBasis = Number(c?.REVENUE_BASIS ?? c?.REVENUE ?? 0);
    }

    const settings = {};
    for (const i of [1, 2, 3]) {
      settings[`SURCHARGE_${i}_LABEL`] = patch[`SURCHARGE_${i}_LABEL`] !== undefined ? patch[`SURCHARGE_${i}_LABEL`] : c?.[`SURCHARGE_${i}_LABEL`];
      settings[`SURCHARGE_${i}_PCT`]   = patch[`SURCHARGE_${i}_PCT`]   !== undefined ? patch[`SURCHARGE_${i}_PCT`]   : c?.[`SURCHARGE_${i}_PCT`];
      settings[`SURCHARGE_${i}_CUMUL`] = patch[`SURCHARGE_${i}_CUMUL`] !== undefined ? patch[`SURCHARGE_${i}_CUMUL`] : c?.[`SURCHARGE_${i}_CUMUL`];
    }
    const { s1Eur, s2Eur, s3Eur, surchargesTotal } = computeSurcharges(revenueBasis, settings);
    patch.REVENUE_BASIS   = revenueBasis;
    patch.SURCHARGES_TOTAL = surchargesTotal;
    patch.SURCHARGE_1_EUR  = r2(s1Eur);
    patch.SURCHARGE_2_EUR  = r2(s2Eur);
    patch.SURCHARGE_3_EUR  = r2(s3Eur);
    patch.REVENUE          = r2(revenueBasis + surchargesTotal);
    const extrasPct = patch.EXTRAS_PERCENT !== undefined ? patch.EXTRAS_PERCENT : Number(c?.EXTRAS_PERCENT || 0);
    patch.EXTRAS = r2(patch.REVENUE * extrasPct / 100);
  } else if (patch.EXTRAS_PERCENT !== undefined) {
    const { data: c2 } = await supabase.from('NACHTRAG_STRUCTURE').select('REVENUE').eq('ID', nodeId).maybeSingle();
    patch.EXTRAS = r2(Number(c2?.REVENUE || 0) * patch.EXTRAS_PERCENT / 100);
  }

  const { data, error } = await supabase.from('NACHTRAG_STRUCTURE').update(patch).eq('ID', nodeId).eq('TENANT_ID', tenantId).select('*').single();
  if (error) throw error;
  await propagateUpwards(supabase, { structureId: nodeId, tenantId });
  return data;
}

async function deleteStructureNode(supabase, { tenantId, nodeId }) {
  const { data: nd } = await supabase.from('NACHTRAG_STRUCTURE').select('FATHER_ID, NACHTRAG_ID').eq('ID', nodeId).eq('TENANT_ID', tenantId).maybeSingle();
  const fatherId  = nd?.FATHER_ID ?? null;
  const nachtragId = nd?.NACHTRAG_ID ?? null;
  await supabase.from('NACHTRAG_STRUCTURE').delete().eq('FATHER_ID', nodeId).eq('TENANT_ID', tenantId);
  const { error } = await supabase.from('NACHTRAG_STRUCTURE').delete().eq('ID', nodeId).eq('TENANT_ID', tenantId);
  if (error) throw error;
  if (fatherId != null) await recalcParent(supabase, { parentId: fatherId });
  if (nachtragId) await recomputeHeadTotals(supabase, { tenantId, nachtragId });
}

async function recalcParent(supabase, { parentId }) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const { data: children, error } = await supabase.from('NACHTRAG_STRUCTURE').select('REVENUE, EXTRAS').eq('FATHER_ID', parentId);
  if (error) throw error;
  if (!children || !children.length) return;
  const revenueBasis = children.reduce((s, c) => s + Number(c.REVENUE || 0), 0);
  const { data: parent } = await supabase.from('NACHTRAG_STRUCTURE')
    .select('EXTRAS_PERCENT, SURCHARGE_1_LABEL, SURCHARGE_1_PCT, SURCHARGE_1_CUMUL, SURCHARGE_2_LABEL, SURCHARGE_2_PCT, SURCHARGE_2_CUMUL, SURCHARGE_3_LABEL, SURCHARGE_3_PCT, SURCHARGE_3_CUMUL')
    .eq('ID', parentId).maybeSingle();
  const { s1Eur, s2Eur, s3Eur, surchargesTotal } = computeSurcharges(revenueBasis, parent);
  const revenue   = r2(revenueBasis + surchargesTotal);
  const extrasPct = Number(parent?.EXTRAS_PERCENT || 0);
  await supabase.from('NACHTRAG_STRUCTURE').update({
    REVENUE_BASIS: revenueBasis, REVENUE: revenue, EXTRAS: r2(revenue * extrasPct / 100),
    SURCHARGES_TOTAL: surchargesTotal, SURCHARGE_1_EUR: r2(s1Eur), SURCHARGE_2_EUR: r2(s2Eur), SURCHARGE_3_EUR: r2(s3Eur),
  }).eq('ID', parentId);
}

async function propagateUpwards(supabase, { structureId, tenantId }) {
  const { data: node } = await supabase.from('NACHTRAG_STRUCTURE').select('FATHER_ID, NACHTRAG_ID').eq('ID', structureId).maybeSingle();
  if (!node) return;
  if (node.FATHER_ID == null) {
    if (node.NACHTRAG_ID) await recomputeHeadTotals(supabase, { tenantId, nachtragId: node.NACHTRAG_ID });
    return;
  }
  await recalcParent(supabase, { parentId: node.FATHER_ID });
  await propagateUpwards(supabase, { structureId: node.FATHER_ID, tenantId });
}

// Kopf-Summe (gefordert) aus den Wurzel-Positionen ableiten.
async function recomputeHeadTotals(supabase, { tenantId, nachtragId }) {
  const { data: roots } = await supabase.from('NACHTRAG_STRUCTURE').select('REVENUE, EXTRAS').eq('NACHTRAG_ID', nachtragId).is('FATHER_ID', null);
  const claimed = (roots || []).reduce((s, r) => s + Number(r.REVENUE || 0) + Number(r.EXTRAS || 0), 0);
  await supabase.from('NACHTRAG').update({ AMOUNT_CLAIMED_NET: fmt2(claimed) }).eq('ID', nachtragId).eq('TENANT_ID', tenantId);
}

// ── Freigabe → Übernahme ins Projekt (Kernmechanik, analog convertOfferToProject)

// Findet/erzeugt den „Nachträge"-Container-Wurzelknoten eines Projekts (Option A).
async function ensureNachtragContainer(supabase, { tenantId, projectId }) {
  const { data: existing } = await supabase.from('PROJECT_STRUCTURE')
    .select('ID').eq('PROJECT_ID', projectId).is('FATHER_ID', null).eq('NAME_LONG', 'Nachträge').is('BILLING_TYPE_ID', null).limit(1).maybeSingle();
  if (existing) return existing.ID;
  const { data: created, error } = await supabase.from('PROJECT_STRUCTURE').insert([{
    NAME_SHORT: 'NT', NAME_LONG: 'Nachträge', PROJECT_ID: projectId, FATHER_ID: null,
    BILLING_TYPE_ID: null, REVENUE: 0, REVENUE_BASIS: 0, EXTRAS: 0, EXTRAS_PERCENT: 0, COSTS: 0,
    REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
    TENANT_ID: tenantId,
  }]).select('ID').single();
  if (error) throw { status: 500, message: '„Nachträge"-Knoten konnte nicht angelegt werden: ' + error.message };
  return created.ID;
}

/**
 * Gibt einen Nachtrag ganz oder teilweise frei und übernimmt die anerkannten
 * Positionen als Blätter in die PROJECT_STRUCTURE (unter einem Gruppenknoten
 * je Nachtrag, unterhalb des „Nachträge"-Containers).
 *
 * body = {
 *   release_kind:  'FULL' | 'PARTIAL' | 'PROVISIONAL',
 *   release_basis: 'WRITTEN' | 'ORAL' | 'ORDER',
 *   note: string,
 *   positions: [{ nachtrag_structure_id, approved_amount_net? }]   // Blatt-Positionen
 * }
 * Ohne positions + release_kind 'FULL' → alle offenen Blatt-Positionen voll.
 */
async function release(supabase, { tenantId, nachtragId, body, employeeId }) {
  const b = body || {};
  const nachtrag = await get(supabase, { tenantId, nachtragId });

  const st = nachtrag.NACHTRAG_STATUS_ID
    ? (await supabase.from('NACHTRAG_STATUS').select('CODE, ALLOWS_RELEASE').eq('ID', nachtrag.NACHTRAG_STATUS_ID).maybeSingle()).data
    : null;
  if (!st || !st.ALLOWS_RELEASE) {
    throw { status: 409, message: 'Freigabe aus dem aktuellen Status nicht möglich (erst einreichen/prüfen).' };
  }

  const kind  = ['FULL', 'PARTIAL', 'PROVISIONAL'].includes(String(b.release_kind)) ? String(b.release_kind) : 'PARTIAL';
  const basis = ['WRITTEN', 'ORAL', 'ORDER'].includes(String(b.release_basis)) ? String(b.release_basis) : null;

  // Struktur laden, Blätter bestimmen (Positionen ohne Kinder)
  const all = await getStructure(supabase, { tenantId, nachtragId });
  const withChildren = new Set(all.map(r => r.FATHER_ID).filter(Boolean));
  const leaves = all.filter(r => !withChildren.has(r.ID));
  if (!leaves.length) throw { status: 400, message: 'Der Nachtrag hat keine freigebbaren Positionen.' };

  // Auswahl der freizugebenden Positionen bestimmen
  let selection;
  if (Array.isArray(b.positions) && b.positions.length) {
    const byId = new Map(leaves.map(l => [l.ID, l]));
    selection = [];
    for (const p of b.positions) {
      const node = byId.get(parseInt(String(p.nachtrag_structure_id), 10));
      if (!node) continue;
      if (node.APPROVAL_STATE === 'APPROVED') continue; // schon übernommen
      const approvedAmount = p.approved_amount_net != null && p.approved_amount_net !== ''
        ? fmt2(Number(p.approved_amount_net)) : null;
      selection.push({ node, approvedAmount });
    }
  } else if (kind === 'FULL') {
    selection = leaves.filter(l => l.APPROVAL_STATE !== 'APPROVED').map(node => ({ node, approvedAmount: null }));
  } else {
    throw { status: 400, message: 'Bitte Positionen auswählen (oder Voll-Freigabe wählen).' };
  }
  if (!selection.length) throw { status: 400, message: 'Keine (offenen) Positionen zur Freigabe ausgewählt.' };

  // Container + Gruppenknoten je Nachtrag sicherstellen
  const containerId = await ensureNachtragContainer(supabase, { tenantId, projectId: nachtrag.PROJECT_ID });
  let groupId;
  {
    const { data: existingGroup } = await supabase.from('PROJECT_STRUCTURE')
      .select('ID').eq('PROJECT_ID', nachtrag.PROJECT_ID).eq('NACHTRAG_ID', nachtragId).is('BILLING_TYPE_ID', null).limit(1).maybeSingle();
    if (existingGroup) {
      groupId = existingGroup.ID;
    } else {
      const { data: g, error: gErr } = await supabase.from('PROJECT_STRUCTURE').insert([{
        NAME_SHORT: nachtrag.NAME_SHORT, NAME_LONG: nachtrag.NAME_LONG, PROJECT_ID: nachtrag.PROJECT_ID,
        FATHER_ID: containerId, BILLING_TYPE_ID: null, NACHTRAG_ID: nachtragId,
        REVENUE: 0, REVENUE_BASIS: 0, EXTRAS: 0, EXTRAS_PERCENT: 0, COSTS: 0,
        REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
        TENANT_ID: tenantId,
      }]).select('ID').single();
      if (gErr) throw { status: 500, message: 'Gruppenknoten konnte nicht angelegt werden: ' + gErr.message };
      groupId = g.ID;
    }
  }

  // Positionen als Blätter unter dem Gruppenknoten anlegen (BT1 mit Wert, BT2 startet bei 0)
  let releaseSum = 0;
  let sortOrder  = 0;
  for (const { node, approvedAmount } of selection) {
    const isBt1 = Number(node.BILLING_TYPE_ID) === 1;
    const fullRevenue = fmt2(Number(node.REVENUE || 0));
    const revenue = isBt1 ? (approvedAmount != null ? approvedAmount : fullRevenue) : 0;
    const extrasPct = Number(node.EXTRAS_PERCENT || 0);
    const extras = isBt1 ? fmt2(revenue * extrasPct / 100) : 0;
    releaseSum += isBt1 ? (revenue + extras) : 0;

    const { data: ps, error: psErr } = await supabase.from('PROJECT_STRUCTURE').insert([{
      NAME_SHORT: node.NAME_SHORT, NAME_LONG: node.NAME_LONG, PROJECT_ID: nachtrag.PROJECT_ID,
      FATHER_ID: groupId, BILLING_TYPE_ID: node.BILLING_TYPE_ID, NACHTRAG_ID: nachtragId,
      REVENUE_BASIS: isBt1 ? revenue : 0, REVENUE: revenue, EXTRAS_PERCENT: extrasPct, EXTRAS: extras, COSTS: 0,
      REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
      SORT_ORDER: (sortOrder += 10),
      ROLE_NAME_SHORT: node.ROLE_NAME_SHORT || null, ROLE_NAME_LONG: node.ROLE_NAME_LONG || null, ROLE_ID: node.ROLE_ID || null,
      TENANT_ID: tenantId,
    }]).select('ID').single();
    if (psErr) throw { status: 500, message: 'Position konnte nicht übernommen werden: ' + psErr.message };

    // PROJECT_PROGRESS-Zeile (soft)
    try {
      await supabase.from('PROJECT_PROGRESS').insert([{
        STRUCTURE_ID: ps.ID, TENANT_ID: tenantId,
        REVENUE: revenue, EXTRAS_PERCENT: extrasPct, EXTRAS: extras,
        REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
      }]);
    } catch (_) { /* ignore */ }

    // Quell-Position markieren
    await supabase.from('NACHTRAG_STRUCTURE').update({
      APPROVAL_STATE: (approvedAmount != null && isBt1 && approvedAmount < fullRevenue) ? 'PARTIAL' : 'APPROVED',
      APPROVED_AMOUNT_NET: isBt1 ? revenue : null,
      RELEASED_STRUCTURE_ID: ps.ID,
    }).eq('ID', node.ID).eq('TENANT_ID', tenantId);
  }
  releaseSum = fmt2(releaseSum);

  // NACHTRAG_RELEASE-Datensatz
  const { data: relRows } = await supabase.from('NACHTRAG_RELEASE').select('RELEASE_NO').eq('NACHTRAG_ID', nachtragId).order('RELEASE_NO', { ascending: false }).limit(1);
  const releaseNo = (relRows && relRows.length ? Number(relRows[0].RELEASE_NO) : 0) + 1;
  await supabase.from('NACHTRAG_RELEASE').insert([{
    TENANT_ID: tenantId, NACHTRAG_ID: nachtragId, RELEASE_NO: releaseNo,
    RELEASE_KIND: kind, RELEASE_BASIS: basis, AMOUNT_NET: releaseSum,
    RELEASED_BY: employeeId ?? null, NOTE: b.note ? String(b.note) : null,
  }]);

  // Kopf: freigegebene Summe fortschreiben + Status bestimmen
  const newApproved = fmt2(Number(nachtrag.AMOUNT_APPROVED_NET || 0) + releaseSum);
  const remainingOpen = leaves.filter(l => l.APPROVAL_STATE !== 'APPROVED' && !selection.find(s => s.node.ID === l.ID)).length;
  const targetCode = remainingOpen === 0 ? 'COMMISSIONED' : 'PARTIALLY_COMMISSIONED';
  const targetStatus = await statusByCode(supabase, targetCode);
  await supabase.from('NACHTRAG').update({
    AMOUNT_APPROVED_NET: newApproved,
    NACHTRAG_STATUS_ID: targetStatus?.ID ?? nachtrag.NACHTRAG_STATUS_ID,
    DECISION_DATE: nachtrag.DECISION_DATE || new Date().toISOString().slice(0, 10),
  }).eq('ID', nachtragId).eq('TENANT_ID', tenantId);

  await writeAudit(supabase, {
    tenantId, nachtragId, eventType: 'RELEASE', actorId: employeeId,
    details: { releaseNo, kind, basis, amountNet: releaseSum, positions: selection.length, statusTo: targetCode },
  });

  return { release_no: releaseNo, amount_net: releaseSum, approved_total_net: newApproved, status_code: targetCode, group_structure_id: groupId };
}

// ── Freigabe-Historie ────────────────────────────────────────────────────────

async function listReleases(supabase, { tenantId, nachtragId }) {
  const { data, error } = await supabase.from('NACHTRAG_RELEASE')
    .select('*').eq('NACHTRAG_ID', nachtragId).eq('TENANT_ID', tenantId).order('RELEASE_NO', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── Prüfbarkeit (reaktives NM) ───────────────────────────────────────────────

async function saveReview(supabase, { tenantId, nachtragId, body, employeeId }) {
  const b = body || {};
  await get(supabase, { tenantId, nachtragId }); // 404-Guard + Mandantentrennung
  const patch = {
    REVIEW_FORMAL:         !!b.review_formal,
    REVIEW_CONTENT:        !!b.review_content,
    REVIEW_CALCULATION:    !!b.review_calculation,
    REVIEW_NOTE:           b.review_note != null && b.review_note !== '' ? String(b.review_note) : null,
    REVIEW_RECOMMENDATION: b.review_recommendation && VALID_RECOMMENDATIONS.has(String(b.review_recommendation))
      ? String(b.review_recommendation) : null,
    REVIEWED_AT:           new Date().toISOString(),
    REVIEWED_BY:           employeeId ?? null,
  };
  const { data, error } = await supabase.from('NACHTRAG').update(patch)
    .eq('ID', nachtragId).eq('TENANT_ID', tenantId).select('*').single();
  if (error) throw error;
  await writeAudit(supabase, { tenantId, nachtragId, eventType: 'REVIEW', actorId: employeeId,
    details: { recommendation: patch.REVIEW_RECOMMENDATION, formal: patch.REVIEW_FORMAL, content: patch.REVIEW_CONTENT, calculation: patch.REVIEW_CALCULATION } });
  return data;
}

// ── Audit ────────────────────────────────────────────────────────────────────

async function writeAudit(supabase, { tenantId, nachtragId, eventType, actorId, details }) {
  try {
    await supabase.from('NACHTRAG_AUDIT').insert([{
      TENANT_ID: tenantId, NACHTRAG_ID: nachtragId, EVENT_TYPE: eventType,
      ACTOR_ID: actorId ?? null, DETAILS: details ?? null,
    }]);
  } catch (e) {
    console.warn('[nachtrag] audit write failed:', e?.message || e);
  }
}

// ── PDF-ViewModel (Nachtragsangebot) ─────────────────────────────────────────

const CATEGORY_LABELS_PDF = {
  CHANGED: 'Geänderte Leistung', ADDITIONAL: 'Zusätzliche Leistung', QUANTITY: 'Mengen-/Umfangsänderung',
  SPECIAL: 'Besondere Leistung', DISRUPTION: 'Gestörter Bauablauf', CONTENT: 'Bauinhaltsnachtrag', CIRCUMSTANCE: 'Bauumstandsnachtrag',
};

function flattenStructureTree(rows) {
  const children = new Map();
  for (const r of rows) {
    const pid = r.FATHER_ID ?? null;
    if (!children.has(pid)) children.set(pid, []);
    children.get(pid).push(r);
  }
  const sort = arr => [...arr].sort((a, b) => (Number(a.SORT_ORDER ?? 0) - Number(b.SORT_ORDER ?? 0)) || (a.ID - b.ID));
  const withChildren = new Set(rows.map(r => r.FATHER_ID).filter(Boolean));
  const result = [];
  (function walk(pid, depth) {
    for (const r of sort(children.get(pid) || [])) {
      result.push({ node: r, depth, isLeaf: !withChildren.has(r.ID) });
      walk(r.ID, depth + 1);
    }
  })(null, 0);
  return result;
}

async function buildNachtragPdfViewModel(supabase, { nachtragId, tenantId }) {
  const { data: nachtrag } = await supabase.from('NACHTRAG').select('*').eq('ID', nachtragId).eq('TENANT_ID', tenantId).maybeSingle();
  if (!nachtrag) throw { status: 404, message: 'Nachtrag nicht gefunden' };

  const [projectRes, companyRes, addressRes, contactRes, employeeRes, structRes] = await Promise.all([
    nachtrag.PROJECT_ID ? supabase.from('PROJECT').select('NAME_SHORT, NAME_LONG').eq('ID', nachtrag.PROJECT_ID).maybeSingle() : Promise.resolve({ data: null }),
    nachtrag.COMPANY_ID ? supabase.from('COMPANY').select('COMPANY_NAME_1, COMPANY_NAME_2, STREET, POST_CODE, CITY, POST_OFFICE_BOX, IBAN, BIC, "TAX-ID", TAX_NUMBER').eq('ID', nachtrag.COMPANY_ID).maybeSingle() : Promise.resolve({ data: null }),
    nachtrag.ADDRESS_ID ? supabase.from('ADDRESS').select('ADDRESS_NAME_1, ADDRESS_NAME_2, STREET, POST_CODE, CITY').eq('ID', nachtrag.ADDRESS_ID).maybeSingle() : Promise.resolve({ data: null }),
    nachtrag.CONTACT_ID ? supabase.from('CONTACT').select('FIRST_NAME, LAST_NAME, EMAIL, MOBILE').eq('ID', nachtrag.CONTACT_ID).maybeSingle() : Promise.resolve({ data: null }),
    nachtrag.EMPLOYEE_ID ? supabase.from('EMPLOYEE').select('SHORT_NAME, FIRST_NAME, LAST_NAME').eq('ID', nachtrag.EMPLOYEE_ID).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('NACHTRAG_STRUCTURE').select('*').eq('NACHTRAG_ID', nachtragId).order('SORT_ORDER', { ascending: true }).order('ID', { ascending: true }),
  ]);

  const company = companyRes.data, address = addressRes.data, contact = contactRes.data, employee = employeeRes.data, project = projectRes.data;
  const structRows = structRes.data || [];
  const flat = flattenStructureTree(structRows);
  const roots = structRows.filter(r => r.FATHER_ID == null);
  const structureRevenueSum = roots.reduce((s, r) => s + Number(r.REVENUE || 0), 0);
  const totalExtras = roots.reduce((s, r) => s + Number(r.EXTRAS || 0), 0);
  const totalNet = fmt2(structureRevenueSum + totalExtras);

  let vatPercent = 0;
  if (nachtrag.VAT_ID) {
    const { data: vatRow } = await supabase.from('VAT').select('VAT_PERCENT').eq('ID', nachtrag.VAT_ID).maybeSingle();
    vatPercent = Number(vatRow?.VAT_PERCENT || 0);
  }
  const vatAmount = fmt2(totalNet * vatPercent / 100);
  const grossTotal = fmt2(totalNet * (100 + vatPercent) / 100);

  const employeeName = employee ? `${employee.FIRST_NAME ?? ''} ${employee.LAST_NAME ?? ''}`.trim() : '';
  const sellerName = [company?.COMPANY_NAME_1, company?.COMPANY_NAME_2].filter(Boolean).join(' ');

  return {
    nachtrag,
    projectName:   project ? `${project.NAME_SHORT} — ${project.NAME_LONG}` : '',
    categoryLabel: nachtrag.CATEGORY ? (CATEGORY_LABELS_PDF[nachtrag.CATEGORY] || nachtrag.CATEGORY) : '',
    employeeName,
    seller: {
      name: sellerName || '', street: company?.STREET || '', postCode: company?.POST_CODE || '', city: company?.CITY || '',
      postOfficeBox: company?.POST_OFFICE_BOX || '', iban: company?.IBAN || '', bic: company?.BIC || '',
      taxId: company?.TAX_NUMBER || '', vatId: company?.['TAX-ID'] || '',
    },
    buyer: {
      name: address?.ADDRESS_NAME_1 || '', name2: address?.ADDRESS_NAME_2 || '',
      street: address?.STREET || '', postCode: address?.POST_CODE || '', city: address?.CITY || '',
    },
    contact: contact || null,
    structureRows: flat.map(({ node: n, depth, isLeaf }) => ({
      depth, isLeaf,
      nameShort: n.NAME_SHORT || '', nameLong: n.NAME_LONG || '',
      isHourly: Number(n.BILLING_TYPE_ID) === 2,
      quantity: Number(n.QUANTITY || 0), spRate: Number(n.SP_RATE || 0),
      revenue: Number(n.REVENUE || 0), extras: Number(n.EXTRAS || 0),
      total: fmt2(Number(n.REVENUE || 0) + Number(n.EXTRAS || 0)),
    })),
    hasExtras: structRows.some(r => Number(r.EXTRAS || 0) > 0),
    vatPercent, vatAmount, grossTotal,
    totals: { revenue: fmt2(structureRevenueSum), extras: fmt2(totalExtras), total: totalNet },
  };
}

module.exports = {
  listStatuses,
  list,
  get,
  buildNachtragPdfViewModel,
  create,
  update,
  remove,
  getStructure,
  addStructureNode,
  updateStructureNode,
  deleteStructureNode,
  release,
  listReleases,
  saveReview,
};
