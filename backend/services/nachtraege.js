'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Service: Nachträge (Modul N1 — eigene Honorar-Nachträge)
// Ein Nachtrag ist strukturell ein projektgebundenes Mini-Angebot. Kopf +
// Struktur spiegeln OFFER / OFFER_STRUCTURE (siehe services/angebote.js). Bei
// Freigabe werden anerkannte Positionen — analog convertOfferToProject —
// inkrementell in PROJECT_STRUCTURE übernommen (Option A: ein „Nachträge"-
// Wurzelknoten je Projekt, darunter je Nachtrag ein Gruppenknoten). Danach
// greifen Buchungen (BOOKING) und Abrechnung (INVOICE) ohne Sonderpfad.
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

const projekte = require('./projekte');
const gesamtprojekte = require('./gesamtprojekte');
const { assertOwnAddress, assertContactOfAddress } = require('./adressen');
const { inheritedContractTerms, INHERITED_TERMS } = require('./contractDefaults');

const VALID_TYPES      = new Set(['OWN', 'MANAGED']);
const VALID_CATEGORIES = new Set(['CHANGED', 'ADDITIONAL', 'QUANTITY', 'SPECIAL', 'DISRUPTION', 'CONTENT', 'CIRCUMSTANCE']);
const VALID_RECOMMENDATIONS = new Set(['ACCEPT', 'REDUCE', 'REJECT', 'QUERY']);

// ── Status-Lookup (global) ───────────────────────────────────────────────────

async function listStatuses(supabase) {
  const { data, error } = await supabase
    .from('NACHTRAG_STATUS')
    .select('ID, CODE, ABBR, SORT_ORDER, IS_TERMINAL, ALLOWS_RELEASE')
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
    .select('ID, ABBR, NAME, NACHTRAG_TYPE, NACHTRAG_STATUS_ID, CATEGORY, PROJECT_ID, EMPLOYEE_ID, ADDRESS_ID, REVIEW_DUE_DATE, AMOUNT_CLAIMED_NET, AMOUNT_APPROVED_NET, CREATED_AT')
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
    statusIds.length  ? supabase.from('NACHTRAG_STATUS').select('ID, CODE, ABBR').in('ID', statusIds) : Promise.resolve({ data: [] }),
    projectIds.length ? supabase.from('PROJECT').select('ID, ABBR, NAME').in('ID', projectIds)   : Promise.resolve({ data: [] }),
    empIds.length     ? supabase.from('EMPLOYEE').select('ID, ABBR, FIRST_NAME, LAST_NAME').in('ID', empIds) : Promise.resolve({ data: [] }),
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
      ABBR:          r.ABBR,
      NAME:           r.NAME,
      NACHTRAG_TYPE:       r.NACHTRAG_TYPE,
      CATEGORY:            r.CATEGORY,
      STATUS_CODE:         st?.CODE ?? null,
      STATUS_NAME:         st?.ABBR ?? null,
      NACHTRAG_STATUS_ID:  r.NACHTRAG_STATUS_ID,
      PROJECT_ID:          r.PROJECT_ID,
      PROJECT_NAME:        projMap.get(r.PROJECT_ID)?.ABBR ?? null,
      EMPLOYEE_NAME:       emp ? `${emp.ABBR ? emp.ABBR + ': ' : ''}${emp.FIRST_NAME ?? ''} ${emp.LAST_NAME ?? ''}`.trim() : null,
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
  if (!b.name || !String(b.name).trim()) throw { status: 400, message: 'Betreff (name) ist erforderlich' };

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
    ABBR:         num,
    NAME:          String(b.name).trim(),
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
  if (b.name        !== undefined) patch.NAME      = String(b.name).trim();
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

/**
 * Ist eine Position schon freigegeben (steht als Knoten im Projekt)?
 * PARTIAL heisst „der Höhe nach gekürzt anerkannt" — ebenso erledigt. Vorher
 * galt nur APPROVED als erledigt: eine gekürzte Position liess sich ein
 * zweites Mal freigeben, legte einen zweiten Projektknoten an und zählte den
 * Betrag doppelt; der Nachtrag wurde nie „beauftragt".
 */
function isReleased(node) {
  return node?.RELEASED_STRUCTURE_ID != null || node?.APPROVAL_STATE === 'APPROVED' || node?.APPROVAL_STATE === 'PARTIAL';
}

const RELEASED_MSG = 'Diese Position ist schon freigegeben und steht im Projekt. Änderungen laufen dort, nicht mehr im Nachtrag.';

/** Position laden und prüfen, dass sie zu genau diesem Nachtrag gehört. */
async function loadNode(supabase, { tenantId, nachtragId, nodeId }) {
  const { data, error } = await supabase.from('NACHTRAG_STRUCTURE')
    .select('*').eq('ID', nodeId).eq('TENANT_ID', tenantId).maybeSingle();
  if (error) throw error;
  // Die Nachtrags-ID der URL wurde vorher nicht geprüft — jede Position des
  // Mandanten liess sich über jeden Nachtrag ändern.
  if (!data || (nachtragId != null && Number(data.NACHTRAG_ID) !== Number(nachtragId))) {
    throw { status: 404, message: 'Position nicht gefunden' };
  }
  return data;
}

async function addStructureNode(supabase, { tenantId, nachtragId, body }) {
  const b    = body || {};
  const btId = b.billing_type_id ? parseInt(String(b.billing_type_id), 10) : null;
  if (!btId) throw { status: 400, message: 'billing_type_id ist erforderlich' };
  await get(supabase, { tenantId, nachtragId }); // 404-Guard + Mandantentrennung

  const isHourly = btId === 2;
  const quantity = isHourly ? (Number(b.quantity) || 0) : null;
  const spRate   = isHourly ? (Number(b.hourly_rate)  || 0) : null;
  const revenue  = isHourly ? fmt2((quantity || 0) * (spRate || 0)) : fmt2(Number(b.revenue) || 0);
  const extPct   = Number(b.extras_percent) || 0;
  const extras   = fmt2(revenue * extPct / 100);
  const fatherId = b.father_id ? parseInt(String(b.father_id), 10) : null;
  if (fatherId !== null) {
    const father = await loadNode(supabase, { tenantId, nachtragId, nodeId: fatherId });
    // Unter einer freigegebenen Position würde sie zum Vater — ihr Wert im
    // Projekt stimmte dann nicht mehr mit dem Nachtrag überein.
    if (isReleased(father)) throw { status: 409, message: 'Unter einer freigegebenen Position lassen sich keine Positionen mehr anlegen.' };
  }

  const sibQuery = supabase.from('NACHTRAG_STRUCTURE').select('SORT_ORDER').eq('NACHTRAG_ID', nachtragId);
  const { data: siblings } = fatherId !== null ? await sibQuery.eq('FATHER_ID', fatherId) : await sibQuery.is('FATHER_ID', null);
  const maxSort = siblings && siblings.length ? Math.max(...siblings.map(s => Number(s.SORT_ORDER ?? 0))) : -10;

  const { data, error } = await supabase.from('NACHTRAG_STRUCTURE').insert([{
    ABBR:      String(b.abbr || '').trim(),
    NAME:       String(b.name  || '').trim(),
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
    HOURLY_RATE:         spRate,
    APPROVAL_STATE:  'OPEN',
    ROLE_ABBR: b.role_abbr || null,
    ROLE_NAME:  b.role_name  || null,
    ROLE_ID:         b.role_id ? parseInt(String(b.role_id), 10) : null,
    TENANT_ID:       tenantId,
  }]).select('*').single();
  if (error) throw error;
  if (fatherId !== null) await recalcParent(supabase, { parentId: fatherId });
  await recomputeHeadTotals(supabase, { tenantId, nachtragId });
  return data;
}

async function updateStructureNode(supabase, { tenantId, nachtragId, nodeId, body }) {
  const current = await loadNode(supabase, { tenantId, nachtragId, nodeId });
  if (isReleased(current)) throw { status: 409, message: RELEASED_MSG };
  const b        = body || {};
  const r2       = (n) => Math.round(n * 100) / 100;
  const btId     = b.billing_type_id != null ? parseInt(String(b.billing_type_id), 10) : undefined;
  const isHourly = btId === 2;
  const patch    = {};

  if (b.abbr     !== undefined) patch.ABBR      = String(b.abbr).trim();
  if (b.name      !== undefined) patch.NAME       = String(b.name).trim();
  if (btId             !== undefined) patch.BILLING_TYPE_ID = btId;
  if (b.extras_percent !== undefined) patch.EXTRAS_PERCENT  = Number(b.extras_percent) || 0;
  if (b.role_abbr !== undefined) patch.ROLE_ABBR = b.role_abbr || null;
  if (b.role_name  !== undefined) patch.ROLE_NAME  = b.role_name  || null;
  if (b.role_id         !== undefined) patch.ROLE_ID         = b.role_id ? parseInt(String(b.role_id), 10) : null;

  for (const i of [1, 2, 3]) {
    if (b[`SURCHARGE_${i}_LABEL`] !== undefined) patch[`SURCHARGE_${i}_LABEL`] = b[`SURCHARGE_${i}_LABEL`];
    if (b[`SURCHARGE_${i}_PCT`]   !== undefined) patch[`SURCHARGE_${i}_PCT`]   = b[`SURCHARGE_${i}_PCT`] != null ? Number(b[`SURCHARGE_${i}_PCT`]) : null;
    if (b[`SURCHARGE_${i}_CUMUL`] !== undefined) patch[`SURCHARGE_${i}_CUMUL`] = !!b[`SURCHARGE_${i}_CUMUL`];
  }

  const hasSurchargeChange = [1, 2, 3].some(i => b[`SURCHARGE_${i}_LABEL`] !== undefined || b[`SURCHARGE_${i}_PCT`] !== undefined);
  const hasRevenueChange   = isHourly || b.quantity !== undefined || b.hourly_rate !== undefined || b.revenue !== undefined;

  if (hasRevenueChange || hasSurchargeChange || patch.EXTRAS_PERCENT !== undefined) {
    const { data: c } = await supabase.from('NACHTRAG_STRUCTURE')
      .select('REVENUE_BASIS, REVENUE, EXTRAS_PERCENT, QUANTITY, HOURLY_RATE, SURCHARGE_1_LABEL, SURCHARGE_1_PCT, SURCHARGE_1_CUMUL, SURCHARGE_2_LABEL, SURCHARGE_2_PCT, SURCHARGE_2_CUMUL, SURCHARGE_3_LABEL, SURCHARGE_3_PCT, SURCHARGE_3_CUMUL')
      .eq('ID', nodeId).maybeSingle();

    let revenueBasis;
    if (isHourly || b.quantity !== undefined || b.hourly_rate !== undefined) {
      const q = Number(b.quantity ?? c?.QUANTITY ?? 0);
      const s = Number(b.hourly_rate  ?? c?.HOURLY_RATE  ?? 0);
      if (b.quantity !== undefined) patch.QUANTITY = q;
      if (b.hourly_rate  !== undefined) patch.HOURLY_RATE  = s;
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

async function deleteStructureNode(supabase, { tenantId, nachtragId, nodeId }) {
  const nd = await loadNode(supabase, { tenantId, nachtragId, nodeId });
  const fatherId = nd.FATHER_ID ?? null;
  const ownerId  = nd.NACHTRAG_ID;

  // Den ganzen Zweig einsammeln — vorher fiel nur eine Ebene darunter mit,
  // Enkel blieben ohne Vater zurück und zählten in keiner Summe mehr.
  const all = await getStructure(supabase, { tenantId, nachtragId: ownerId });
  const kids = new Map();
  for (const r of all) if (r.FATHER_ID != null) kids.set(r.FATHER_ID, [...(kids.get(r.FATHER_ID) || []), r]);
  const branch = [];
  const walk = (n) => { branch.push(n); for (const c of kids.get(n.ID) || []) walk(c); };
  walk(all.find(r => r.ID === nd.ID) || nd);
  if (branch.some(isReleased)) throw { status: 409, message: RELEASED_MSG };

  const ids = branch.map(n => n.ID);
  const { error } = await supabase.from('NACHTRAG_STRUCTURE').delete().in('ID', ids).eq('TENANT_ID', tenantId);
  if (error) throw error;
  if (fatherId != null) await recalcParent(supabase, { parentId: fatherId });
  await recomputeHeadTotals(supabase, { tenantId, nachtragId: ownerId });
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
    .select('ID').eq('PROJECT_ID', projectId).is('FATHER_ID', null).eq('NAME', 'Nachträge').is('BILLING_TYPE_ID', null).limit(1).maybeSingle();
  if (existing) return existing.ID;
  const { data: created, error } = await supabase.from('PROJECT_STRUCTURE').insert([{
    ABBR: 'NT', NAME: 'Nachträge', PROJECT_ID: projectId, FATHER_ID: null,
    BILLING_TYPE_ID: null, REVENUE: 0, REVENUE_BASIS: 0, EXTRAS: 0, EXTRAS_PERCENT: 0, COSTS: 0,
    REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
    TENANT_ID: tenantId,
  }]).select('ID').single();
  if (error) throw { status: 500, message: '„Nachträge"-Knoten konnte nicht angelegt werden: ' + error.message };
  return created.ID;
}

const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Nachtrag als eigenes Projekt (Migration 0182): legt ein Projekt im
 * Gesamtprojekt des Ursprungsprojekts an — eigener Vertrag, eigener
 * Rechnungsempfaenger. Vom Ursprungsprojekt kommen Firma, Typ, Abteilung,
 * Team (Stundensaetze) und die Vertragskonditionen (Steuer, Skonto,
 * Einbehalt); aus dem Dialog Name, Status, Leitung, Auftraggeber/Rechnungs-
 * empfaenger und die Art der Nummer.
 *
 * Gehoert das Ursprungsprojekt noch zu keinem Gesamtprojekt, entsteht eins
 * aus ihm (Name, Kuerzel, Auftraggeber, Leitung) — das aendert das
 * Ursprungsprojekt und braucht deshalb zusaetzlich projects.edit.
 *
 * Alles, was abgelehnt werden kann, wird VOR dem ersten Schreiben geprueft:
 * sonst stuende nach einem Fehler ein halbes Projekt da.
 */
async function createReleaseProject(supabase, { tenantId, nachtrag, target, can }) {
  if (!can('projects.create')) {
    throw { status: 403, message: 'Fehlende Berechtigung: projects.create — ein eigenes Projekt aus dem Nachtrag braucht das Recht, Projekte anzulegen.' };
  }
  const name      = String(target.name ?? '').trim() || nachtrag.NAME;
  const statusId  = toId(target.project_status_id);
  const managerId = toId(target.project_manager_id);
  const addressId = toId(target.address_id);
  const contactId = toId(target.contact_id);
  if (!statusId || !managerId) throw { status: 400, message: 'Für das neue Projekt fehlen Status oder Projektleitung.' };
  if (!addressId || !contactId) throw { status: 400, message: 'Für das neue Projekt fehlen Rechnungsempfänger oder Kontakt.' };
  await assertOwnAddress(supabase, { tenantId, addressId });
  await assertContactOfAddress(supabase, { tenantId, addressId, contactId });

  const { data: src, error: srcErr } = await supabase.from('PROJECT')
    .select('ID, ABBR, NAME, COMPANY_ID, PROJECT_TYPE_ID, DEPARTMENT_ID, PROJECT_MANAGER_ID, ADDRESS_ID, PROJECT_GROUP_ID')
    .eq('ID', nachtrag.PROJECT_ID).eq('TENANT_ID', tenantId).maybeSingle();
  if (srcErr) throw srcErr;
  if (!src) throw { status: 404, message: 'Das Projekt des Nachtrags gibt es nicht (mehr).' };
  if (!src.COMPANY_ID) throw { status: 400, message: 'Das Projekt des Nachtrags hat keine Firma — das neue Projekt kann keine Nummer bekommen.' };
  if (!src.PROJECT_GROUP_ID && !can('projects.edit')) {
    throw { status: 403, message: 'Das Projekt gehört noch zu keinem Gesamtprojekt. Es dafür anzulegen braucht das Recht „Projekte bearbeiten".' };
  }
  const { data: team, error: teamErr } = await supabase.from('EMPLOYEE2PROJECT')
    .select('EMPLOYEE_ID, ROLE_ID, ROLE_ABBR, ROLE_NAME, HOURLY_RATE')
    .eq('PROJECT_ID', src.ID).eq('TENANT_ID', tenantId);
  if (teamErr) throw teamErr;
  const { data: srcContract, error: cErr } = await supabase.from('CONTRACT')
    .select(INHERITED_TERMS.join(', ')).eq('PROJECT_ID', src.ID).eq('TENANT_ID', tenantId).limit(1).maybeSingle();
  if (cErr) throw cErr;

  // Ab hier wird geschrieben.
  let groupId = src.PROJECT_GROUP_ID;
  let groupCreated = false;
  if (!groupId) {
    const { group } = await gesamtprojekte.createGroup(supabase, { tenantId, body: {
      name: src.NAME || src.ABBR, abbr: src.ABBR,
      address_id: src.ADDRESS_ID, manager_id: src.PROJECT_MANAGER_ID, project_ids: [src.ID],
    } });
    groupId = group.ID;
    groupCreated = true;
  }
  // Abgeleitete Nummer erst jetzt — mit neuem Gesamtprojekt traegt das
  // Ursprungsprojekt dessen Kuerzel und zaehlt als 01. Ohne Kuerzel: Nummernkreis.
  const abbr = target.abbr_mode === 'derived'
    ? await gesamtprojekte.suggestMemberAbbr(supabase, { tenantId, groupId })
    : null;

  const project = await projekte.createProject(supabase, { tenantId, body: {
    company_id: src.COMPANY_ID, name,
    project_status_id: statusId, project_manager_id: managerId,
    project_type_id: src.PROJECT_TYPE_ID, department_id: src.DEPARTMENT_ID,
    address_id: addressId, contact_id: contactId,
    project_group_id: groupId,
    ...(abbr ? { project_abbr: abbr } : {}),
    employee2project: (team || []).map(t => ({
      employee_id: t.EMPLOYEE_ID, role_id: t.ROLE_ID, role_abbr: t.ROLE_ABBR, role_name: t.ROLE_NAME, hourly_rate: t.HOURLY_RATE,
    })),
  } });

  const terms = inheritedContractTerms(srcContract);
  if (Object.keys(terms).length) {
    const { error } = await supabase.from('CONTRACT').update(terms).eq('PROJECT_ID', project.ID).eq('TENANT_ID', tenantId);
    if (error) throw { status: 500, message: 'Projekt angelegt, aber die Vertragskonditionen ließen sich nicht übernehmen: ' + error.message };
  }
  return { project: { ID: project.ID, ABBR: project.ABBR, NAME: project.NAME }, groupId, groupCreated };
}

/** Naechste freie Sortierposition unter einem Vater (null = oberste Ebene). */
async function nextSortOrder(supabase, { tenantId, projectId, fatherId }) {
  let q = supabase.from('PROJECT_STRUCTURE').select('SORT_ORDER')
    .eq('PROJECT_ID', projectId).eq('TENANT_ID', tenantId);
  q = fatherId == null ? q.is('FATHER_ID', null) : q.eq('FATHER_ID', fatherId);
  const { data } = await q.order('SORT_ORDER', { ascending: false }).limit(1);
  return Number(data?.[0]?.SORT_ORDER || 0);
}

/**
 * Gibt einen Nachtrag ganz oder teilweise frei und übernimmt die anerkannten
 * Positionen als Blätter in eine PROJECT_STRUCTURE.
 *
 * body = {
 *   release_kind:  'FULL' | 'PARTIAL' | 'PROVISIONAL',
 *   release_basis: 'WRITTEN' | 'ORAL' | 'ORDER',
 *   note: string,
 *   positions: [{ nachtrag_structure_id, approved_amount_net? }],  // Blatt-Positionen
 *   target: {                                                       // optional, Migration 0182
 *     kind: 'origin'           — wie bisher: Projekt des Nachtrags, unter „Nachträge" › Nachtrag
 *         | 'new_project'      — eigenes Projekt im Gesamtprojekt (createReleaseProject)
 *         | 'release_project', — ein Projekt, das eine frühere Freigabe DIESES Nachtrags angelegt hat
 *     project_id, name, project_status_id, project_manager_id, address_id, contact_id,
 *     abbr_mode: 'range' | 'derived'
 *   }
 * }
 * Ohne positions + release_kind 'FULL' → alle offenen Blatt-Positionen voll.
 * `can(key)` = Recht des Aufrufers (ein eigenes Projekt braucht projects.create).
 */
async function release(supabase, { tenantId, nachtragId, body, employeeId, can = () => false }) {
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
      if (isReleased(node)) continue; // schon übernommen (auch gekürzt)
      const approvedAmount = p.approved_amount_net != null && p.approved_amount_net !== ''
        ? fmt2(Number(p.approved_amount_net)) : null;
      selection.push({ node, approvedAmount });
    }
  } else if (kind === 'FULL') {
    selection = leaves.filter(l => !isReleased(l)).map(node => ({ node, approvedAmount: null }));
  } else {
    throw { status: 400, message: 'Bitte Positionen auswählen (oder Voll-Freigabe wählen).' };
  }
  if (!selection.length) throw { status: 400, message: 'Keine (offenen) Positionen zur Freigabe ausgewählt.' };

  // Ziel bestimmen: Projekt und Vater der uebernommenen Positionen.
  const t = b.target && typeof b.target === 'object' ? b.target : { kind: 'origin' };
  let targetProjectId = nachtrag.PROJECT_ID;
  let groupId = null;            // Vater-Knoten der Positionen (null = oberste Ebene)
  let created = null;            // { project, groupId, groupCreated } bei neuem Projekt
  if (t.kind === 'new_project') {
    created = await createReleaseProject(supabase, { tenantId, nachtrag, target: t, can });
    targetProjectId = created.project.ID;
  } else if (t.kind === 'release_project') {
    // Nur ein Projekt, das eine fruehere Freigabe DIESES Nachtrags angelegt
    // hat — sonst liessen sich Positionen in beliebige Projekte schieben.
    const pid = toId(t.project_id);
    const { data: prev, error: pErr } = pid
      ? await supabase.from('NACHTRAG_RELEASE').select('ID')
        .eq('NACHTRAG_ID', nachtragId).eq('TENANT_ID', tenantId).eq('TARGET_PROJECT_ID', pid).limit(1)
      : { data: [], error: null };
    if (pErr) throw pErr;
    if (!(prev || []).length) throw { status: 400, message: 'In dieses Projekt ist der Nachtrag nicht freigegeben worden.' };
    targetProjectId = pid;
  } else {
    // Wie bisher: Container „Nachträge" + Gruppenknoten je Nachtrag im Projekt des Nachtrags.
    const containerId = await ensureNachtragContainer(supabase, { tenantId, projectId: nachtrag.PROJECT_ID });
    const { data: existingGroup } = await supabase.from('PROJECT_STRUCTURE')
      .select('ID').eq('PROJECT_ID', nachtrag.PROJECT_ID).eq('NACHTRAG_ID', nachtragId).is('BILLING_TYPE_ID', null).limit(1).maybeSingle();
    if (existingGroup) {
      groupId = existingGroup.ID;
    } else {
      const { data: g, error: gErr } = await supabase.from('PROJECT_STRUCTURE').insert([{
        ABBR: nachtrag.ABBR, NAME: nachtrag.NAME, PROJECT_ID: nachtrag.PROJECT_ID,
        FATHER_ID: containerId, BILLING_TYPE_ID: null, NACHTRAG_ID: nachtragId,
        REVENUE: 0, REVENUE_BASIS: 0, EXTRAS: 0, EXTRAS_PERCENT: 0, COSTS: 0,
        REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
        TENANT_ID: tenantId,
      }]).select('ID').single();
      if (gErr) throw { status: 500, message: 'Gruppenknoten konnte nicht angelegt werden: ' + gErr.message };
      groupId = g.ID;
    }
  }

  // Positionen als Blätter anlegen (BT1 mit Wert, BT2 startet bei 0) — im
  // eigenen Projekt auf oberster Ebene: dort ist das Projekt der Nachtrag.
  let releaseSum = 0;
  let sortOrder  = await nextSortOrder(supabase, { tenantId, projectId: targetProjectId, fatherId: groupId });
  for (const { node, approvedAmount } of selection) {
    const isBt1 = Number(node.BILLING_TYPE_ID) === 1;
    const fullRevenue = fmt2(Number(node.REVENUE || 0));
    const revenue = isBt1 ? (approvedAmount != null ? approvedAmount : fullRevenue) : 0;
    const extrasPct = Number(node.EXTRAS_PERCENT || 0);
    const extras = isBt1 ? fmt2(revenue * extrasPct / 100) : 0;
    releaseSum += isBt1 ? (revenue + extras) : 0;

    // Die Rollenspalten (ROLE_ABBR/ROLE_NAME/ROLE_ID) gibt es im Projekt nicht —
    // der Insert scheiterte daran mit 500, jede Freigabe brach ab. Wer mit
    // welcher Rolle bucht, steht im Projekt an EMPLOYEE2PROJECT, wie beim
    // Beauftragen eines Angebots. Stattdessen geht bei Positionen nach
    // Aufwand die Schätzung als Plan mit (Migration 0173, wie beim
    // Beauftragen): das Element startet bei 0, die Budgetwarnung vergleicht
    // gegen den Plan.
    const row = {
      ABBR: node.ABBR, NAME: node.NAME, PROJECT_ID: targetProjectId,
      FATHER_ID: groupId, BILLING_TYPE_ID: node.BILLING_TYPE_ID, NACHTRAG_ID: nachtragId,
      REVENUE_BASIS: isBt1 ? revenue : 0, REVENUE: revenue, EXTRAS_PERCENT: extrasPct, EXTRAS: extras, COSTS: 0,
      REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
      SORT_ORDER: (sortOrder += 10),
      TENANT_ID: tenantId,
    };
    const planHours = Number(node.QUANTITY || 0), planRevenue = fullRevenue;
    const plan = !isBt1 && (planHours > 0 || planRevenue > 0) ? { PLAN_HOURS: planHours, PLAN_REVENUE: planRevenue } : null;
    let { data: ps, error: psErr } = await supabase.from('PROJECT_STRUCTURE').insert([{ ...row, ...(plan || {}) }]).select('ID').single();
    // Schema-Cache ohne die Plan-Spalten (Deploy vor dem Reload): ohne Plan übernehmen
    if (psErr && plan && /PLAN_/.test(String(psErr.message || ''))) {
      ({ data: ps, error: psErr } = await supabase.from('PROJECT_STRUCTURE').insert([row]).select('ID').single());
    }
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
  const releaseRow = {
    TENANT_ID: tenantId, NACHTRAG_ID: nachtragId, RELEASE_NO: releaseNo,
    RELEASE_KIND: kind, RELEASE_BASIS: basis, AMOUNT_NET: releaseSum,
    RELEASED_BY: employeeId ?? null, NOTE: b.note ? String(b.note) : null,
  };
  const outside = targetProjectId !== nachtrag.PROJECT_ID;
  let { error: relErr } = await supabase.from('NACHTRAG_RELEASE')
    .insert([outside ? { ...releaseRow, TARGET_PROJECT_ID: targetProjectId } : releaseRow]);
  // Deploy-Fenster (0182 noch nicht im Schema-Cache): die Freigabe trotzdem festhalten.
  if (relErr && outside && /TARGET_PROJECT_ID/.test(String(relErr.message || ''))) {
    ({ error: relErr } = await supabase.from('NACHTRAG_RELEASE').insert([releaseRow]));
  }
  if (relErr) throw { status: 500, message: 'Positionen übernommen, aber die Freigabe ließ sich nicht protokollieren: ' + relErr.message };

  // Kopf: freigegebene Summe fortschreiben + Status bestimmen
  const newApproved = fmt2(Number(nachtrag.AMOUNT_APPROVED_NET || 0) + releaseSum);
  const remainingOpen = leaves.filter(l => !isReleased(l) && !selection.find(s => s.node.ID === l.ID)).length;
  const targetCode = remainingOpen === 0 ? 'COMMISSIONED' : 'PARTIALLY_COMMISSIONED';
  const targetStatus = await statusByCode(supabase, targetCode);
  await supabase.from('NACHTRAG').update({
    AMOUNT_APPROVED_NET: newApproved,
    NACHTRAG_STATUS_ID: targetStatus?.ID ?? nachtrag.NACHTRAG_STATUS_ID,
    DECISION_DATE: nachtrag.DECISION_DATE || new Date().toISOString().slice(0, 10),
  }).eq('ID', nachtragId).eq('TENANT_ID', tenantId);

  await writeAudit(supabase, {
    tenantId, nachtragId, eventType: 'RELEASE', actorId: employeeId,
    details: {
      releaseNo, kind, basis, amountNet: releaseSum, positions: selection.length, statusTo: targetCode,
      ...(outside ? { targetProjectId, newProject: !!created, groupCreated: !!created?.groupCreated } : {}),
    },
  });

  let targetProject = null;
  if (outside) {
    targetProject = created?.project ?? (await supabase.from('PROJECT').select('ID, ABBR, NAME')
      .eq('ID', targetProjectId).eq('TENANT_ID', tenantId).maybeSingle()).data ?? { ID: targetProjectId };
  }
  return {
    release_no: releaseNo, amount_net: releaseSum, approved_total_net: newApproved, status_code: targetCode,
    group_structure_id: groupId,
    target_project: targetProject,
    group_created: !!created?.groupCreated,
  };
}

// ── Freigabe-Historie ────────────────────────────────────────────────────────

/** Freigaben samt Zielprojekt (Nummer, Name), wenn sie in ein eigenes Projekt gingen. */
async function listReleases(supabase, { tenantId, nachtragId }) {
  const { data, error } = await supabase.from('NACHTRAG_RELEASE')
    .select('*').eq('NACHTRAG_ID', nachtragId).eq('TENANT_ID', tenantId).order('RELEASE_NO', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  const ids = [...new Set(rows.map(r => r.TARGET_PROJECT_ID).filter(Boolean))];
  if (!ids.length) return rows;
  const { data: projects, error: pErr } = await supabase.from('PROJECT')
    .select('ID, ABBR, NAME').eq('TENANT_ID', tenantId).in('ID', ids);
  if (pErr) throw pErr;
  const byId = new Map((projects || []).map(p => [String(p.ID), p]));
  return rows.map(r => {
    const p = r.TARGET_PROJECT_ID ? byId.get(String(r.TARGET_PROJECT_ID)) : null;
    return { ...r, TARGET_PROJECT_ABBR: p?.ABBR ?? null, TARGET_PROJECT_NAME: p?.NAME ?? null };
  });
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
    nachtrag.PROJECT_ID ? supabase.from('PROJECT').select('ABBR, NAME').eq('ID', nachtrag.PROJECT_ID).maybeSingle() : Promise.resolve({ data: null }),
    nachtrag.COMPANY_ID ? supabase.from('COMPANY').select('COMPANY_NAME_1, COMPANY_NAME_2, STREET, POST_CODE, CITY, POST_OFFICE_BOX, IBAN, BIC, "TAX-ID", TAX_NUMBER').eq('ID', nachtrag.COMPANY_ID).maybeSingle() : Promise.resolve({ data: null }),
    nachtrag.ADDRESS_ID ? supabase.from('ADDRESS').select('ADDRESS_NAME_1, ADDRESS_NAME_2, STREET, POST_CODE, CITY').eq('ID', nachtrag.ADDRESS_ID).maybeSingle() : Promise.resolve({ data: null }),
    // CONTACTS (Plural) — mit „CONTACT" fehlte der Ansprechpartner im Nachtrags-PDF
    nachtrag.CONTACT_ID ? supabase.from('CONTACTS').select('FIRST_NAME, LAST_NAME, EMAIL, MOBILE').eq('ID', nachtrag.CONTACT_ID).eq('TENANT_ID', tenantId).maybeSingle() : Promise.resolve({ data: null }),
    nachtrag.EMPLOYEE_ID ? supabase.from('EMPLOYEE').select('ABBR, FIRST_NAME, LAST_NAME').eq('ID', nachtrag.EMPLOYEE_ID).maybeSingle() : Promise.resolve({ data: null }),
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
    projectName:   project ? `${project.ABBR} — ${project.NAME}` : '',
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
      nameShort: n.ABBR || '', nameLong: n.NAME || '',
      isHourly: Number(n.BILLING_TYPE_ID) === 2,
      quantity: Number(n.QUANTITY || 0), spRate: Number(n.HOURLY_RATE || 0),
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
