'use strict';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function computeSurchargesOffer(revenueBasis, settings) {
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

// Build flat ordered list from OFFER_STRUCTURE rows (respects FATHER_ID tree)
function flattenOfferStructure(rows) {
  const byId     = new Map(rows.map(r => [r.ID, r]));
  const children = new Map();
  for (const r of rows) {
    const pid = r.FATHER_ID ?? null;
    if (!children.has(pid)) children.set(pid, []);
    children.get(pid).push(r);
  }
  const sort = arr => [...arr].sort((a, b) => {
    const od = Number(a.SORT_ORDER ?? 0) - Number(b.SORT_ORDER ?? 0);
    return od !== 0 ? od : a.ID - b.ID;
  });
  const result = [];
  function walk(parentId, depth) {
    for (const r of sort(children.get(parentId) || [])) {
      result.push({ node: r, depth });
      walk(r.ID, depth + 1);
    }
  }
  walk(null, 0);
  return result;
}

// ── offer statuses ────────────────────────────────────────────────────────────

async function getOfferStatuses(supabase) {
  const { data, error } = await supabase
    .from('OFFER_STATUS')
    .select('ID, NAME_SHORT')
    .order('ID', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── offers ────────────────────────────────────────────────────────────────────

async function listOffers(supabase, { tenantId }) {
  const { data, error } = await supabase
    .from('OFFER')
    .select('ID, NAME_SHORT, NAME_LONG, PROBABILITY, CREATED_AT, OFFER_DATE, VALID_UNTIL, OFFER_STATUS_ID, EMPLOYEE_ID, ADDRESS_ID, CONTACT_ID, PROJECT_ID')
    .eq('TENANT_ID', tenantId)
    .order('ID', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return [];

  const offerIds   = rows.map(r => r.ID);
  const statusIds  = [...new Set(rows.map(r => r.OFFER_STATUS_ID).filter(Boolean))];
  const empIds     = [...new Set(rows.map(r => r.EMPLOYEE_ID).filter(Boolean))];
  const addrIds    = [...new Set(rows.map(r => r.ADDRESS_ID).filter(Boolean))];
  const contactIds = [...new Set(rows.map(r => r.CONTACT_ID).filter(Boolean))];
  const projectIds = [...new Set(rows.map(r => r.PROJECT_ID).filter(Boolean))];

  const [statusRes, empRes, addrRes, contactRes, structRes, projectRes, feeCalcMasterRes] = await Promise.all([
    statusIds.length  ? supabase.from('OFFER_STATUS').select('ID, NAME_SHORT').in('ID', statusIds) : Promise.resolve({ data: [] }),
    empIds.length     ? supabase.from('EMPLOYEE').select('ID, SHORT_NAME, FIRST_NAME, LAST_NAME').in('ID', empIds) : Promise.resolve({ data: [] }),
    addrIds.length    ? supabase.from('ADDRESS').select('ID, ADDRESS_NAME_1').in('ID', addrIds) : Promise.resolve({ data: [] }),
    contactIds.length ? supabase.from('CONTACT').select('ID, FIRST_NAME, LAST_NAME').in('ID', contactIds) : Promise.resolve({ data: [] }),
    supabase.from('OFFER_STRUCTURE').select('OFFER_ID, ID, FATHER_ID, REVENUE, EXTRAS').in('OFFER_ID', offerIds),
    projectIds.length ? supabase.from('PROJECT').select('ID, NAME_SHORT').in('ID', projectIds) : Promise.resolve({ data: [] }),
    supabase.from('FEE_CALCULATION_MASTER').select('ID, OFFER_ID').in('OFFER_ID', offerIds).eq('TENANT_ID', tenantId),
  ]);

  const statusMap  = new Map((statusRes.data  || []).map(r => [r.ID, r]));
  const empMap     = new Map((empRes.data      || []).map(r => [r.ID, r]));
  const addrMap    = new Map((addrRes.data     || []).map(r => [r.ID, r]));
  const contactMap = new Map((contactRes.data  || []).map(r => [r.ID, r]));
  const projectMap = new Map((projectRes.data  || []).map(r => [r.ID, r]));

  // Leaf-based totals per offer
  const totalMap = new Map();
  if (structRes.data?.length) {
    const byOffer = new Map();
    for (const s of structRes.data) {
      if (!byOffer.has(s.OFFER_ID)) byOffer.set(s.OFFER_ID, []);
      byOffer.get(s.OFFER_ID).push(s);
    }
    for (const [oId, sRows] of byOffer) {
      const withChildren = new Set(sRows.map(r => r.FATHER_ID).filter(Boolean));
      const leaves = sRows.filter(r => !withChildren.has(r.ID));
      const rev  = leaves.reduce((s, r) => s + (Number(r.REVENUE) || 0), 0);
      const ext  = leaves.reduce((s, r) => s + (Number(r.EXTRAS)  || 0), 0);
      totalMap.set(oId, fmt2(rev + ext));
    }
  }

  // Add HOAI fee-calculation totals (phases + BL + surcharges) per offer
  const feeCalcMasters = feeCalcMasterRes.data || [];
  if (feeCalcMasters.length) {
    const masterIds = feeCalcMasters.map(m => m.ID);
    const masterToOffer = new Map(feeCalcMasters.map(m => [m.ID, m.OFFER_ID]));
    const [phaseRes, hoaiBLRes, surRes] = await Promise.all([
      supabase.from('FEE_CALCULATION_PHASE').select('FEE_MASTER_ID, PHASE_REVENUE').in('FEE_MASTER_ID', masterIds),
      supabase.from('FEE_CALCULATION_BL').select('FEE_CALC_MASTER_ID, AMOUNT').in('FEE_CALC_MASTER_ID', masterIds).eq('TENANT_ID', tenantId),
      supabase.from('FEE_CALCULATION_SURCHARGES').select('FEE_CALC_MASTER_ID, AMOUNT').in('FEE_CALC_MASTER_ID', masterIds).eq('TENANT_ID', tenantId),
    ]);
    const hoaiTotal = new Map();
    for (const p of (phaseRes.data || [])) {
      const oId = masterToOffer.get(p.FEE_MASTER_ID);
      if (oId) hoaiTotal.set(oId, (hoaiTotal.get(oId) || 0) + (Number(p.PHASE_REVENUE) || 0));
    }
    for (const b of (hoaiBLRes.data || [])) {
      const oId = masterToOffer.get(b.FEE_CALC_MASTER_ID);
      if (oId) hoaiTotal.set(oId, (hoaiTotal.get(oId) || 0) + (Number(b.AMOUNT) || 0));
    }
    for (const s of (surRes.data || [])) {
      const oId = masterToOffer.get(s.FEE_CALC_MASTER_ID);
      if (oId) hoaiTotal.set(oId, (hoaiTotal.get(oId) || 0) + (Number(s.AMOUNT) || 0));
    }
    for (const [oId, total] of hoaiTotal) {
      totalMap.set(oId, fmt2((totalMap.get(oId) || 0) + total));
    }
  }

  return rows.map(r => {
    const emp     = empMap.get(r.EMPLOYEE_ID);
    const contact = contactMap.get(r.CONTACT_ID);
    return {
      ID:              r.ID,
      NAME_SHORT:      r.NAME_SHORT,
      NAME_LONG:       r.NAME_LONG,
      PROBABILITY:     r.PROBABILITY,
      CREATED_AT:      r.CREATED_AT,
      OFFER_DATE:      r.OFFER_DATE   ?? null,
      VALID_UNTIL:     r.VALID_UNTIL  ?? null,
      TOTAL_AMOUNT:    totalMap.get(r.ID) ?? null,
      STATUS_NAME:     statusMap.get(r.OFFER_STATUS_ID)?.NAME_SHORT ?? null,
      OFFER_STATUS_ID: r.OFFER_STATUS_ID,
      EMPLOYEE_NAME:   emp
        ? `${emp.SHORT_NAME ? emp.SHORT_NAME + ': ' : ''}${emp.FIRST_NAME ?? ''} ${emp.LAST_NAME ?? ''}`.trim()
        : null,
      ADDRESS_NAME:    addrMap.get(r.ADDRESS_ID)?.ADDRESS_NAME_1 ?? null,
      CONTACT_NAME:    contact
        ? `${contact.FIRST_NAME ?? ''} ${contact.LAST_NAME ?? ''}`.trim()
        : null,
      PROJECT_ID:        r.PROJECT_ID ?? null,
      PROJECT_NAME:      r.PROJECT_ID ? (projectMap.get(r.PROJECT_ID)?.NAME_SHORT ?? null) : null,
    };
  });
}

async function getOffer(supabase, { tenantId, offerId }) {
  const { data, error } = await supabase
    .from('OFFER')
    .select('*')
    .eq('ID', offerId)
    .eq('TENANT_ID', tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw { status: 404, message: 'Angebot nicht gefunden' };
  // Adressname fuer die Anzeige im Bearbeiten-Dialog nachladen (sonst zeigt
  // das Empfaenger-Feld nur die ADDRESS_ID).
  if (data.ADDRESS_ID) {
    const { data: addr } = await supabase
      .from('ADDRESS').select('ADDRESS_NAME_1').eq('ID', data.ADDRESS_ID).maybeSingle();
    data.ADDRESS_NAME = addr?.ADDRESS_NAME_1 ?? null;
  } else {
    data.ADDRESS_NAME = null;
  }
  return data;
}

async function createOffer(supabase, { tenantId, body }) {
  const b = body || {};

  if (!b.name_long || !String(b.name_long).trim()) {
    throw { status: 400, message: 'Angebotstitel (name_long) ist erforderlich' };
  }
  if (!b.offer_status_id) throw { status: 400, message: 'Angebotsstatus ist erforderlich' };
  if (!b.employee_id)     throw { status: 400, message: 'Ansprechpartner ist erforderlich' };
  if (!b.address_id)      throw { status: 400, message: 'Adresse ist erforderlich' };
  if (!b.contact_id)      throw { status: 400, message: 'Kontakt ist erforderlich' };
  if (!b.company_id)      throw { status: 400, message: 'Firma ist erforderlich' };

  // Resolve offer number via RPC
  const { data: numData, error: numErr } = await supabase.rpc('next_offer_number', {
    p_company_id: parseInt(String(b.company_id), 10),
  });
  if (numErr || !numData) {
    throw { status: 500, message: 'Nummernkreis konnte nicht geladen werden: ' + (numErr?.message || 'kein Ergebnis') };
  }

  // Resolve default VAT from tenant settings
  const { data: settingsRows } = await supabase.from('TENANT_SETTINGS').select('KEY, VALUE').eq('TENANT_ID', tenantId);
  const tenantDefaults = {};
  for (const row of settingsRows || []) tenantDefaults[row.KEY] = row.VALUE;
  const defaultVatId = b.vat_id
    ? parseInt(String(b.vat_id), 10)
    : (tenantDefaults.default_vat_id ? Number(tenantDefaults.default_vat_id) : null);

  const { data: offer, error: offerErr } = await supabase
    .from('OFFER')
    .insert([{
      NAME_SHORT:      numData,
      NAME_LONG:       String(b.name_long).trim(),
      EMPLOYEE_ID:     parseInt(String(b.employee_id), 10),
      PROBABILITY:     b.probability != null && b.probability !== '' ? Number(b.probability) : null,
      OFFER_TEXT_1:    b.offer_text_1 ? String(b.offer_text_1) : null,
      OFFER_TEXT_2:    b.offer_text_2 ? String(b.offer_text_2) : null,
      ADDRESS_ID:      parseInt(String(b.address_id), 10),
      CONTACT_ID:      parseInt(String(b.contact_id), 10),
      OFFER_STATUS_ID: parseInt(String(b.offer_status_id), 10),
      COMPANY_ID:      parseInt(String(b.company_id), 10),
      TENANT_ID:       tenantId,
      OFFER_DATE:      b.offer_date   || new Date().toISOString().slice(0, 10),
      VALID_UNTIL:     b.valid_until  || null,
      ...(defaultVatId ? { VAT_ID: defaultVatId } : {}),
    }])
    .select('*')
    .single();

  if (offerErr) throw offerErr;

  // Insert structure nodes if provided
  if (Array.isArray(b.offer_structure) && b.offer_structure.length) {
    await insertOfferStructure(supabase, { offer, draft: b.offer_structure, tenantId });
  }

  return offer;
}

async function insertOfferStructure(supabase, { offer, draft, tenantId }) {
  const insertRows = draft.map((n, i) => {
    const btId     = n.BILLING_TYPE_ID ? parseInt(String(n.BILLING_TYPE_ID), 10) : null;
    const isHourly = btId === 2;
    const quantity    = isHourly ? (Number(n.QUANTITY)   || 0) : null;
    const spRate      = isHourly ? (Number(n.SP_RATE)     || 0) : null;
    const revenue     = isHourly ? fmt2((quantity || 0) * (spRate || 0)) : fmt2(Number(n.REVENUE) || 0);
    const extPct      = Number(n.EXTRAS_PERCENT) || 0;
    const extras      = fmt2(revenue * extPct / 100);

    return {
      NAME_SHORT:      String(n.NAME_SHORT || '').trim(),
      NAME_LONG:       String(n.NAME_LONG  || '').trim(),
      OFFER_ID:        offer.ID,
      BILLING_TYPE_ID: btId,
      FATHER_ID:       null,
      REVENUE:         revenue,
      EXTRAS_PERCENT:  extPct,
      EXTRAS:          extras,
      SORT_ORDER:      i * 10,
      QUANTITY:        quantity,
      SP_RATE:         spRate,
      ROLE_NAME_SHORT: n.ROLE_NAME_SHORT ? String(n.ROLE_NAME_SHORT) : null,
      ROLE_NAME_LONG:  n.ROLE_NAME_LONG  ? String(n.ROLE_NAME_LONG)  : null,
      ROLE_ID:         n.ROLE_ID ? parseInt(String(n.ROLE_ID), 10) : null,
      TENANT_ID:       tenantId,
    };
  });

  const { data: created, error: insErr } = await supabase
    .from('OFFER_STRUCTURE')
    .insert(insertRows)
    .select('ID');
  if (insErr) throw { status: 500, message: 'Positionen konnten nicht gespeichert werden: ' + insErr.message };

  // Set FATHER_ID via tmp_key mapping
  const tmpToId = new Map();
  (created || []).forEach((row, i) => {
    const tk = String(draft[i].tmp_key || '').trim();
    if (tk) tmpToId.set(tk, row.ID);
  });

  for (const n of draft) {
    const tk = String(n.tmp_key || '').trim();
    const fk = String(n.father_tmp_key || '').trim();
    if (!fk) continue;
    const childId  = tmpToId.get(tk);
    const fatherId = tmpToId.get(fk);
    if (!childId || !fatherId) continue;
    await supabase.from('OFFER_STRUCTURE').update({ FATHER_ID: fatherId }).eq('ID', childId);
  }
}

async function updateOffer(supabase, { tenantId, offerId, body }) {
  const b = body || {};
  const patch = {};
  if (b.name_long       !== undefined) patch.NAME_LONG       = String(b.name_long).trim();
  if (b.employee_id     !== undefined) patch.EMPLOYEE_ID     = parseInt(String(b.employee_id), 10);
  if (b.probability     !== undefined) patch.PROBABILITY     = b.probability !== '' && b.probability !== null ? Number(b.probability) : null;
  if (b.offer_text_1    !== undefined) patch.OFFER_TEXT_1    = b.offer_text_1 || null;
  if (b.offer_text_2    !== undefined) patch.OFFER_TEXT_2    = b.offer_text_2 || null;
  if (b.address_id      !== undefined) patch.ADDRESS_ID      = parseInt(String(b.address_id), 10);
  if (b.contact_id      !== undefined) patch.CONTACT_ID      = parseInt(String(b.contact_id), 10);
  if (b.offer_status_id !== undefined) patch.OFFER_STATUS_ID = parseInt(String(b.offer_status_id), 10);
  if (b.company_id      !== undefined) patch.COMPANY_ID      = parseInt(String(b.company_id), 10);
  if (b.offer_date      !== undefined) patch.OFFER_DATE      = b.offer_date    || null;
  if (b.valid_until     !== undefined) patch.VALID_UNTIL     = b.valid_until   || null;
  if (b.refusal_date    !== undefined) patch.REFUSAL_DATE    = b.refusal_date  || null;
  if (b.order_date      !== undefined) patch.ORDER_DATE      = b.order_date    || null;
  if (b.project_id      !== undefined) patch.PROJECT_ID      = b.project_id != null && b.project_id !== '' ? parseInt(String(b.project_id), 10) : null;

  // Root-level surcharge settings (Option A — offer-level surcharges)
  if (b.SURCHARGE_1_LABEL !== undefined) patch.SURCHARGE_1_LABEL = b.SURCHARGE_1_LABEL;
  if (b.SURCHARGE_1_PCT   !== undefined) patch.SURCHARGE_1_PCT   = b.SURCHARGE_1_PCT != null && b.SURCHARGE_1_PCT !== '' ? Number(b.SURCHARGE_1_PCT) : null;
  if (b.SURCHARGE_1_CUMUL !== undefined) patch.SURCHARGE_1_CUMUL = !!b.SURCHARGE_1_CUMUL;
  if (b.SURCHARGE_2_LABEL !== undefined) patch.SURCHARGE_2_LABEL = b.SURCHARGE_2_LABEL;
  if (b.SURCHARGE_2_PCT   !== undefined) patch.SURCHARGE_2_PCT   = b.SURCHARGE_2_PCT != null && b.SURCHARGE_2_PCT !== '' ? Number(b.SURCHARGE_2_PCT) : null;
  if (b.SURCHARGE_2_CUMUL !== undefined) patch.SURCHARGE_2_CUMUL = !!b.SURCHARGE_2_CUMUL;
  if (b.SURCHARGE_3_LABEL !== undefined) patch.SURCHARGE_3_LABEL = b.SURCHARGE_3_LABEL;
  if (b.SURCHARGE_3_PCT   !== undefined) patch.SURCHARGE_3_PCT   = b.SURCHARGE_3_PCT != null && b.SURCHARGE_3_PCT !== '' ? Number(b.SURCHARGE_3_PCT) : null;
  if (b.SURCHARGE_3_CUMUL !== undefined) patch.SURCHARGE_3_CUMUL = !!b.SURCHARGE_3_CUMUL;

  const hasSurchargeChange =
    b.SURCHARGE_1_LABEL !== undefined || b.SURCHARGE_1_PCT !== undefined || b.SURCHARGE_1_CUMUL !== undefined ||
    b.SURCHARGE_2_LABEL !== undefined || b.SURCHARGE_2_PCT !== undefined || b.SURCHARGE_2_CUMUL !== undefined ||
    b.SURCHARGE_3_LABEL !== undefined || b.SURCHARGE_3_PCT !== undefined || b.SURCHARGE_3_CUMUL !== undefined;

  const { data, error } = await supabase
    .from('OFFER')
    .update(patch)
    .eq('ID', offerId)
    .eq('TENANT_ID', tenantId)
    .select('*')
    .single();
  if (error) throw error;

  if (hasSurchargeChange) {
    await recalcOfferRootSurcharges(supabase, { offerId });
    const { data: refreshed } = await supabase.from('OFFER').select('*').eq('ID', offerId).eq('TENANT_ID', tenantId).maybeSingle();
    return refreshed || data;
  }
  return data;
}

async function recalcOfferRootSurcharges(supabase, { offerId }) {
  const { data: roots } = await supabase
    .from('OFFER_STRUCTURE')
    .select('REVENUE')
    .eq('OFFER_ID', offerId)
    .is('FATHER_ID', null);
  const basis = (roots || []).reduce((s, r) => s + Number(r.REVENUE || 0), 0);

  const { data: settings } = await supabase
    .from('OFFER')
    .select('SURCHARGE_1_LABEL, SURCHARGE_1_PCT, SURCHARGE_1_CUMUL, SURCHARGE_2_LABEL, SURCHARGE_2_PCT, SURCHARGE_2_CUMUL, SURCHARGE_3_LABEL, SURCHARGE_3_PCT, SURCHARGE_3_CUMUL')
    .eq('ID', offerId)
    .maybeSingle();
  if (!settings) return;

  const r2 = (n) => Math.round(n * 100) / 100;
  const { s1Eur, s2Eur, s3Eur, surchargesTotal } = computeSurchargesOffer(basis, settings);

  await supabase.from('OFFER').update({
    SURCHARGE_1_EUR:  r2(s1Eur),
    SURCHARGE_2_EUR:  r2(s2Eur),
    SURCHARGE_3_EUR:  r2(s3Eur),
    SURCHARGES_TOTAL: surchargesTotal,
  }).eq('ID', offerId);
}

async function deleteOffer(supabase, { tenantId, offerId }) {
  // Delete structure first
  await supabase.from('OFFER_STRUCTURE').delete().eq('OFFER_ID', offerId);
  const { error } = await supabase
    .from('OFFER')
    .delete()
    .eq('ID', offerId)
    .eq('TENANT_ID', tenantId);
  if (error) throw error;
}

// ── offer structure ───────────────────────────────────────────────────────────

async function getOfferStructure(supabase, { tenantId, offerId }) {
  const { data, error } = await supabase
    .from('OFFER_STRUCTURE')
    .select('*')
    .eq('OFFER_ID', offerId)
    .eq('TENANT_ID', tenantId)
    .order('SORT_ORDER', { ascending: true })
    .order('ID', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function addOfferStructureNode(supabase, { tenantId, offerId, body }) {
  const b     = body || {};
  const btId  = b.billing_type_id ? parseInt(String(b.billing_type_id), 10) : null;
  if (!btId) throw { status: 400, message: 'billing_type_id ist erforderlich' };

  const isHourly  = btId === 2;
  const quantity  = isHourly ? (Number(b.quantity)  || 0) : null;
  const spRate    = isHourly ? (Number(b.sp_rate)    || 0) : null;
  const revenue   = isHourly ? fmt2((quantity || 0) * (spRate || 0)) : fmt2(Number(b.revenue) || 0);
  const extPct    = Number(b.extras_percent) || 0;
  const extras    = fmt2(revenue * extPct / 100);
  const fatherId  = b.father_id ? parseInt(String(b.father_id), 10) : null;

  // SORT_ORDER: append after existing siblings
  const sibQuery = supabase.from('OFFER_STRUCTURE').select('SORT_ORDER').eq('OFFER_ID', offerId);
  const { data: siblings } = fatherId !== null
    ? await sibQuery.eq('FATHER_ID', fatherId)
    : await sibQuery.is('FATHER_ID', null);
  const maxSort = siblings && siblings.length > 0
    ? Math.max(...siblings.map(s => Number(s.SORT_ORDER ?? 0)))
    : -10;

  const { data, error } = await supabase
    .from('OFFER_STRUCTURE')
    .insert([{
      NAME_SHORT:      String(b.name_short || '').trim(),
      NAME_LONG:       String(b.name_long  || '').trim(),
      OFFER_ID:        offerId,
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
      ROLE_NAME_SHORT: b.role_name_short || null,
      ROLE_NAME_LONG:  b.role_name_long  || null,
      ROLE_ID:         b.role_id ? parseInt(String(b.role_id), 10) : null,
      TENANT_ID:       tenantId,
    }])
    .select('*')
    .single();
  if (error) throw error;
  if (fatherId !== null) await recalcOfferParent(supabase, { parentId: fatherId });
  return data;
}

async function updateOfferStructureNode(supabase, { tenantId, nodeId, body }) {
  const b        = body || {};
  const r2       = (n) => Math.round(n * 100) / 100;
  const btId     = b.billing_type_id != null ? parseInt(String(b.billing_type_id), 10) : undefined;
  const isHourly = btId === 2;
  const patch    = {};

  if (b.name_short      !== undefined) patch.NAME_SHORT      = String(b.name_short).trim();
  if (b.name_long       !== undefined) patch.NAME_LONG       = String(b.name_long).trim();
  if (btId              !== undefined) patch.BILLING_TYPE_ID = btId;
  if (b.extras_percent  !== undefined) patch.EXTRAS_PERCENT  = Number(b.extras_percent) || 0;
  if (b.role_name_short !== undefined) patch.ROLE_NAME_SHORT = b.role_name_short || null;
  if (b.role_name_long  !== undefined) patch.ROLE_NAME_LONG  = b.role_name_long  || null;
  if (b.role_id         !== undefined) patch.ROLE_ID         = b.role_id ? parseInt(String(b.role_id), 10) : null;

  // Surcharge settings
  if (b.SURCHARGE_1_LABEL !== undefined) patch.SURCHARGE_1_LABEL = b.SURCHARGE_1_LABEL;
  if (b.SURCHARGE_1_PCT   !== undefined) patch.SURCHARGE_1_PCT   = b.SURCHARGE_1_PCT != null ? Number(b.SURCHARGE_1_PCT) : null;
  if (b.SURCHARGE_1_CUMUL !== undefined) patch.SURCHARGE_1_CUMUL = !!b.SURCHARGE_1_CUMUL;
  if (b.SURCHARGE_2_LABEL !== undefined) patch.SURCHARGE_2_LABEL = b.SURCHARGE_2_LABEL;
  if (b.SURCHARGE_2_PCT   !== undefined) patch.SURCHARGE_2_PCT   = b.SURCHARGE_2_PCT != null ? Number(b.SURCHARGE_2_PCT) : null;
  if (b.SURCHARGE_2_CUMUL !== undefined) patch.SURCHARGE_2_CUMUL = !!b.SURCHARGE_2_CUMUL;
  if (b.SURCHARGE_3_LABEL !== undefined) patch.SURCHARGE_3_LABEL = b.SURCHARGE_3_LABEL;
  if (b.SURCHARGE_3_PCT   !== undefined) patch.SURCHARGE_3_PCT   = b.SURCHARGE_3_PCT != null ? Number(b.SURCHARGE_3_PCT) : null;
  if (b.SURCHARGE_3_CUMUL !== undefined) patch.SURCHARGE_3_CUMUL = !!b.SURCHARGE_3_CUMUL;

  const hasSurchargeChange = b.SURCHARGE_1_LABEL !== undefined || b.SURCHARGE_1_PCT !== undefined ||
    b.SURCHARGE_2_LABEL !== undefined || b.SURCHARGE_2_PCT !== undefined ||
    b.SURCHARGE_3_LABEL !== undefined || b.SURCHARGE_3_PCT !== undefined;
  const hasRevenueChange = isHourly || b.quantity !== undefined || b.sp_rate !== undefined || b.revenue !== undefined;

  if (hasRevenueChange || hasSurchargeChange || patch.EXTRAS_PERCENT !== undefined) {
    const { data: cur } = await supabase
      .from('OFFER_STRUCTURE')
      .select('REVENUE_BASIS, REVENUE, EXTRAS_PERCENT, QUANTITY, SP_RATE, SURCHARGE_1_LABEL, SURCHARGE_1_PCT, SURCHARGE_1_CUMUL, SURCHARGE_2_LABEL, SURCHARGE_2_PCT, SURCHARGE_2_CUMUL, SURCHARGE_3_LABEL, SURCHARGE_3_PCT, SURCHARGE_3_CUMUL')
      .eq('ID', nodeId)
      .maybeSingle();

    let revenueBasis;
    if (isHourly || b.quantity !== undefined || b.sp_rate !== undefined) {
      const q = Number(b.quantity ?? cur?.QUANTITY ?? 0);
      const s = Number(b.sp_rate  ?? cur?.SP_RATE  ?? 0);
      if (b.quantity !== undefined) patch.QUANTITY = q;
      if (b.sp_rate  !== undefined) patch.SP_RATE  = s;
      revenueBasis = r2(q * s);
    } else if (b.revenue !== undefined) {
      revenueBasis = r2(Number(b.revenue));
    } else {
      revenueBasis = Number(cur?.REVENUE_BASIS ?? cur?.REVENUE ?? 0);
    }

    const settings = {
      SURCHARGE_1_LABEL: patch.SURCHARGE_1_LABEL !== undefined ? patch.SURCHARGE_1_LABEL : cur?.SURCHARGE_1_LABEL,
      SURCHARGE_1_PCT:   patch.SURCHARGE_1_PCT   !== undefined ? patch.SURCHARGE_1_PCT   : cur?.SURCHARGE_1_PCT,
      SURCHARGE_1_CUMUL: patch.SURCHARGE_1_CUMUL !== undefined ? patch.SURCHARGE_1_CUMUL : cur?.SURCHARGE_1_CUMUL,
      SURCHARGE_2_LABEL: patch.SURCHARGE_2_LABEL !== undefined ? patch.SURCHARGE_2_LABEL : cur?.SURCHARGE_2_LABEL,
      SURCHARGE_2_PCT:   patch.SURCHARGE_2_PCT   !== undefined ? patch.SURCHARGE_2_PCT   : cur?.SURCHARGE_2_PCT,
      SURCHARGE_2_CUMUL: patch.SURCHARGE_2_CUMUL !== undefined ? patch.SURCHARGE_2_CUMUL : cur?.SURCHARGE_2_CUMUL,
      SURCHARGE_3_LABEL: patch.SURCHARGE_3_LABEL !== undefined ? patch.SURCHARGE_3_LABEL : cur?.SURCHARGE_3_LABEL,
      SURCHARGE_3_PCT:   patch.SURCHARGE_3_PCT   !== undefined ? patch.SURCHARGE_3_PCT   : cur?.SURCHARGE_3_PCT,
      SURCHARGE_3_CUMUL: patch.SURCHARGE_3_CUMUL !== undefined ? patch.SURCHARGE_3_CUMUL : cur?.SURCHARGE_3_CUMUL,
    };
    const { s1Eur, s2Eur, s3Eur, surchargesTotal } = computeSurchargesOffer(revenueBasis, settings);

    patch.REVENUE_BASIS   = revenueBasis;
    patch.SURCHARGES_TOTAL = surchargesTotal;
    patch.SURCHARGE_1_EUR  = r2(s1Eur);
    patch.SURCHARGE_2_EUR  = r2(s2Eur);
    patch.SURCHARGE_3_EUR  = r2(s3Eur);
    patch.REVENUE          = r2(revenueBasis + surchargesTotal);

    const extrasPct = patch.EXTRAS_PERCENT !== undefined ? patch.EXTRAS_PERCENT : Number(cur?.EXTRAS_PERCENT || 0);
    patch.EXTRAS = r2(patch.REVENUE * extrasPct / 100);
  } else if (patch.EXTRAS_PERCENT !== undefined) {
    const { data: cur2 } = await supabase.from('OFFER_STRUCTURE').select('REVENUE').eq('ID', nodeId).maybeSingle();
    patch.EXTRAS = r2(Number(cur2?.REVENUE || 0) * patch.EXTRAS_PERCENT / 100);
  }

  const { data, error } = await supabase
    .from('OFFER_STRUCTURE')
    .update(patch)
    .eq('ID', nodeId)
    .eq('TENANT_ID', tenantId)
    .select('*')
    .single();
  if (error) throw error;

  await propagateUpwardsOffer(supabase, { structureId: nodeId });
  return data;
}

async function deleteOfferStructureNode(supabase, { tenantId, nodeId }) {
  const { data: nd } = await supabase.from('OFFER_STRUCTURE').select('FATHER_ID').eq('ID', nodeId).eq('TENANT_ID', tenantId).maybeSingle();
  const fatherId = nd?.FATHER_ID ?? null;
  await supabase.from('OFFER_STRUCTURE').delete().eq('FATHER_ID', nodeId).eq('TENANT_ID', tenantId);
  const { error } = await supabase.from('OFFER_STRUCTURE').delete().eq('ID', nodeId).eq('TENANT_ID', tenantId);
  if (error) throw error;
  if (fatherId != null) await recalcOfferParent(supabase, { parentId: fatherId });
}

async function recalcOfferParent(supabase, { parentId }) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const { data: children, error } = await supabase
    .from('OFFER_STRUCTURE')
    .select('REVENUE, EXTRAS')
    .eq('FATHER_ID', parentId);
  if (error) throw error;
  if (!children || children.length === 0) return;

  const revenueBasis = children.reduce((s, c) => s + Number(c.REVENUE || 0), 0);

  const { data: parent } = await supabase
    .from('OFFER_STRUCTURE')
    .select('EXTRAS_PERCENT, SURCHARGE_1_LABEL, SURCHARGE_1_PCT, SURCHARGE_1_CUMUL, SURCHARGE_2_LABEL, SURCHARGE_2_PCT, SURCHARGE_2_CUMUL, SURCHARGE_3_LABEL, SURCHARGE_3_PCT, SURCHARGE_3_CUMUL')
    .eq('ID', parentId)
    .maybeSingle();

  const { s1Eur, s2Eur, s3Eur, surchargesTotal } = computeSurchargesOffer(revenueBasis, parent);
  const revenue   = r2(revenueBasis + surchargesTotal);
  const extrasPct = Number(parent?.EXTRAS_PERCENT || 0);
  const extras    = r2(revenue * extrasPct / 100);

  const { error: uErr } = await supabase
    .from('OFFER_STRUCTURE')
    .update({
      REVENUE_BASIS:    revenueBasis,
      REVENUE:          revenue,
      EXTRAS:           extras,
      SURCHARGES_TOTAL: surchargesTotal,
      SURCHARGE_1_EUR:  r2(s1Eur),
      SURCHARGE_2_EUR:  r2(s2Eur),
      SURCHARGE_3_EUR:  r2(s3Eur),
    })
    .eq('ID', parentId);
  if (uErr) throw uErr;
}

async function moveOfferStructureNode(supabase, { tenantId, nodeId, fatherRaw, sortAfterId }) {
  const newFatherId =
    fatherRaw === undefined || fatherRaw === null || String(fatherRaw) === '' || String(fatherRaw) === '0'
      ? null : parseInt(String(fatherRaw), 10);

  const { data: current, error: curErr } = await supabase
    .from('OFFER_STRUCTURE').select('ID, OFFER_ID, FATHER_ID').eq('ID', nodeId).eq('TENANT_ID', tenantId).maybeSingle();
  if (curErr) throw curErr;
  if (!current) throw { status: 404, message: 'OFFER_STRUCTURE nicht gefunden' };
  if (newFatherId !== null && newFatherId === nodeId)
    throw { status: 400, message: 'Ein Element kann nicht sich selbst untergeordnet werden' };

  if (newFatherId !== null) {
    const { data: all } = await supabase.from('OFFER_STRUCTURE').select('ID, FATHER_ID').eq('OFFER_ID', current.OFFER_ID);
    const map = new Map((all || []).map(n => [String(n.ID), n.FATHER_ID === null ? null : String(n.FATHER_ID)]));
    let cursor = String(newFatherId), guard = 0;
    while (cursor && guard++ < 5000) {
      if (cursor === String(nodeId)) throw { status: 400, message: 'Ungültige Verschiebung (Zyklus)' };
      const next = map.get(cursor);
      if (!next) break;
      cursor = next;
    }
  }

  const oldFatherId = current.FATHER_ID === null || current.FATHER_ID === undefined ? null : current.FATHER_ID;

  await supabase.from('OFFER_STRUCTURE').update({ FATHER_ID: newFatherId }).eq('ID', nodeId);

  // Re-order siblings in new parent group
  const sibQ = supabase.from('OFFER_STRUCTURE').select('ID, SORT_ORDER')
    .eq('OFFER_ID', current.OFFER_ID).neq('ID', nodeId)
    .order('SORT_ORDER', { ascending: true }).order('ID', { ascending: true });
  const { data: newSiblings } = newFatherId !== null
    ? await sibQ.eq('FATHER_ID', newFatherId)
    : await sibQ.is('FATHER_ID', null);

  const ordered = [...(newSiblings || [])];
  const finalIdx = sortAfterId === '__end__' ? ordered.length
    : sortAfterId === null ? 0
    : (() => { const i = ordered.findIndex(s => String(s.ID) === String(sortAfterId)); return i === -1 ? ordered.length : i + 1 })();
  ordered.splice(finalIdx, 0, { ID: nodeId });
  for (let i = 0; i < ordered.length; i++) {
    await supabase.from('OFFER_STRUCTURE').update({ SORT_ORDER: i * 10 }).eq('ID', ordered[i].ID);
  }

  // Propagate aggregation
  await propagateUpwardsOffer(supabase, { structureId: nodeId });
  if (oldFatherId !== null && oldFatherId !== newFatherId) {
    await recalcOfferParent(supabase, { parentId: oldFatherId });
  }
}

async function propagateUpwardsOffer(supabase, { structureId }) {
  const { data: node } = await supabase
    .from('OFFER_STRUCTURE')
    .select('FATHER_ID, OFFER_ID')
    .eq('ID', structureId)
    .maybeSingle();
  if (!node) return;
  if (node.FATHER_ID == null) {
    // Reached a root structure node — recompute offer-level surcharges
    if (node.OFFER_ID) await recalcOfferRootSurcharges(supabase, { offerId: node.OFFER_ID });
    return;
  }
  await recalcOfferParent(supabase, { parentId: node.FATHER_ID });
  await propagateUpwardsOffer(supabase, { structureId: node.FATHER_ID });
}

// ── PDF view model ────────────────────────────────────────────────────────────

async function buildOfferPdfViewModel(supabase, { offerId, tenantId }) {
  // Load offer with related data
  const { data: offer, error: offerErr } = await supabase
    .from('OFFER')
    .select('*')
    .eq('ID', offerId)
    .eq('TENANT_ID', tenantId)
    .maybeSingle();
  if (offerErr) throw offerErr;
  if (!offer) throw { status: 404, message: 'Angebot nicht gefunden' };

  // Load company (seller)
  const { data: company } = await supabase
    .from('COMPANY')
    .select('COMPANY_NAME_1, COMPANY_NAME_2, STREET, POST_CODE, CITY, POST_OFFICE_BOX, IBAN, BIC, "TAX-ID", TAX_NUMBER, "CREDITOR-ID"')
    .eq('ID', offer.COMPANY_ID)
    .maybeSingle();

  // Load buyer address
  const { data: address } = await supabase
    .from('ADDRESS')
    .select('ADDRESS_NAME_1, ADDRESS_NAME_2, STREET, POST_CODE, CITY, COUNTRY_ID')
    .eq('ID', offer.ADDRESS_ID)
    .maybeSingle();

  // Load buyer contact
  const { data: contact } = await supabase
    .from('CONTACT')
    .select('FIRST_NAME, LAST_NAME, EMAIL, MOBILE')
    .eq('ID', offer.CONTACT_ID)
    .maybeSingle();

  // Load employee (Ansprechpartner)
  const { data: employee } = await supabase
    .from('EMPLOYEE')
    .select('SHORT_NAME, FIRST_NAME, LAST_NAME')
    .eq('ID', offer.EMPLOYEE_ID)
    .maybeSingle();

  // Load structure
  const { data: structRows } = await supabase
    .from('OFFER_STRUCTURE')
    .select('*')
    .eq('OFFER_ID', offerId)
    .order('SORT_ORDER', { ascending: true })
    .order('ID', { ascending: true });

  const flat = flattenOfferStructure(structRows || []);

  // Totals from root-level nodes (no FATHER_ID) so parent surcharges are included in the sum
  const roots      = (structRows || []).filter(r => r.FATHER_ID == null);
  const structureRevenueSum = roots.reduce((s, r) => s + (Number(r.REVENUE)  || 0), 0);
  const totalExtras  = roots.reduce((s, r) => s + (Number(r.EXTRAS)   || 0), 0);

  // Offer-level (root) surcharges — Option A
  const offerLevelSurcharges = Number(offer.SURCHARGES_TOTAL || 0);
  const totalRevenue = structureRevenueSum + offerLevelSurcharges;
  const totalNet     = fmt2(totalRevenue + totalExtras);

  const hasExtras = (structRows || []).some(r => Number(r.EXTRAS || 0) > 0 || Number(r.EXTRAS_PERCENT || 0) > 0);
  const hasSurcharges = (structRows || []).some(r => Number(r.SURCHARGES_TOTAL || 0) > 0) || offerLevelSurcharges > 0;
  const structureSurchargesTotal = (structRows || []).filter(r => Number(r.SURCHARGES_TOTAL || 0) > 0).reduce((s, r) => s + Number(r.SURCHARGES_TOTAL || 0), 0);
  const offerSurchargesTotal = fmt2(structureSurchargesTotal + offerLevelSurcharges);
  const surchargeSummaryRows = (structRows || []).filter(r => Number(r.SURCHARGES_TOTAL || 0) > 0).map(r => ({
    nameShort:      r.NAME_SHORT || '',
    nameLong:       r.NAME_LONG  || '',
    revenueBasis:   Number(r.REVENUE_BASIS ?? r.REVENUE ?? 0),
    surchargesTotal: Number(r.SURCHARGES_TOTAL || 0),
    s1Label: r.SURCHARGE_1_LABEL || null, s1Pct: Number(r.SURCHARGE_1_PCT || 0), s1Eur: Number(r.SURCHARGE_1_EUR || 0),
    s2Label: r.SURCHARGE_2_LABEL || null, s2Pct: Number(r.SURCHARGE_2_PCT || 0), s2Eur: Number(r.SURCHARGE_2_EUR || 0),
    s3Label: r.SURCHARGE_3_LABEL || null, s3Pct: Number(r.SURCHARGE_3_PCT || 0), s3Eur: Number(r.SURCHARGE_3_EUR || 0),
  }));
  // Append offer-level surcharges as a final summary row
  if (offerLevelSurcharges > 0) {
    surchargeSummaryRows.push({
      nameShort:      'Angebot',
      nameLong:       'Angebotsweite Zuschläge',
      revenueBasis:   structureRevenueSum,
      surchargesTotal: offerLevelSurcharges,
      s1Label: offer.SURCHARGE_1_LABEL || null, s1Pct: Number(offer.SURCHARGE_1_PCT || 0), s1Eur: Number(offer.SURCHARGE_1_EUR || 0),
      s2Label: offer.SURCHARGE_2_LABEL || null, s2Pct: Number(offer.SURCHARGE_2_PCT || 0), s2Eur: Number(offer.SURCHARGE_2_EUR || 0),
      s3Label: offer.SURCHARGE_3_LABEL || null, s3Pct: Number(offer.SURCHARGE_3_PCT || 0), s3Eur: Number(offer.SURCHARGE_3_EUR || 0),
    });
  }

  // VAT
  let vatPercent = 0;
  if (offer.VAT_ID) {
    const { data: vatRow } = await supabase.from('VAT').select('VAT_PERCENT').eq('ID', offer.VAT_ID).maybeSingle();
    vatPercent = Number(vatRow?.VAT_PERCENT || 0);
  }
  const vatAmount  = fmt2(totalNet * vatPercent / 100);
  const grossTotal = fmt2(totalNet * (100 + vatPercent) / 100);

  const sellerName = [company?.COMPANY_NAME_1, company?.COMPANY_NAME_2].filter(Boolean).join(' ');

  return {
    offer,
    seller: {
      name:          sellerName || '',
      street:        company?.STREET          || '',
      postCode:      company?.POST_CODE       || '',
      city:          company?.CITY            || '',
      postOfficeBox: company?.POST_OFFICE_BOX || '',
      iban:          company?.IBAN            || '',
      bic:           company?.BIC             || '',
      taxId:         company?.TAX_NUMBER      || '',
      vatId:         company?.['TAX-ID']      || '',
      creditorId:    company?.['CREDITOR-ID'] || '',
    },
    buyer: {
      name:     address?.ADDRESS_NAME_1 || '',
      name2:    address?.ADDRESS_NAME_2 || '',
      street:   address?.STREET    || '',
      postCode: address?.POST_CODE  || '',
      city:     address?.CITY       || '',
    },
    contact: contact || null,
    employee: employee || null,
    structureRows: flat.map(({ node: n, depth }) => ({
      id:              n.ID,
      depth,
      nameShort:       n.NAME_SHORT  || '',
      nameLong:        n.NAME_LONG   || '',
      btId:            Number(n.BILLING_TYPE_ID),
      isHourly:        Number(n.BILLING_TYPE_ID) === 2,
      quantity:        Number(n.QUANTITY       || 0),
      spRate:          Number(n.SP_RATE        || 0),
      revenueBasis:    Number(n.REVENUE_BASIS  ?? n.REVENUE ?? 0),
      revenue:         Number(n.REVENUE        || 0),
      extrasPct:       Number(n.EXTRAS_PERCENT || 0),
      extras:          Number(n.EXTRAS         || 0),
      total:           fmt2(Number(n.REVENUE || 0) + Number(n.EXTRAS || 0)),
      roleName:        n.ROLE_NAME_LONG || n.ROLE_NAME_SHORT || '',
      surchargesTotal: Number(n.SURCHARGES_TOTAL || 0),
    })),
    hasExtras,
    hasSurcharges,
    offerSurchargesTotal,
    surchargeSummaryRows,
    vatPercent,
    vatAmount,
    grossTotal,
    totals: {
      revenue:    fmt2(totalRevenue),
      extras:     fmt2(totalExtras),
      total:      totalNet,
    },
    text1: offer.OFFER_TEXT_1 || '',
    text2: offer.OFFER_TEXT_2 || '',
  };
}

// ── HOAI attachment helper (called during conversion) ────────────────────────

async function attachFeeCalcToProjectStructure(supabase, { calcMasterId, fatherId, projectId, tenantId }) {
  const { loadPhaseRowsWithLabels } = require('./stammdaten');
  const phaseRows = await loadPhaseRowsWithLabels(supabase, calcMasterId);
  const activePhases = phaseRows.filter(r => (Number(r.PHASE_REVENUE) || 0) !== 0 || (Number(r.FEE_PERCENT) || 0) !== 0);

  // Step 1: Load BL items BEFORE early-return so BL-only calcs are handled correctly.
  // No TENANT_ID filter — FEE_CALC_MASTER_ID already scopes to the right calc (verified by caller).
  let blItems = [];
  const blQueryRes = await supabase.from('FEE_CALCULATION_BL')
    .select('ID, NAME, AMOUNT')
    .eq('FEE_CALC_MASTER_ID', calcMasterId)
    .order('SORT_ORDER', { ascending: true });
  if (blQueryRes.error) {
    console.error('[attachFeeCalc] BL query error (calcMasterId=%d):', calcMasterId, blQueryRes.error.message);
  } else {
    blItems = blQueryRes.data || [];
  }
  console.log('[attachFeeCalc] calcMasterId=%d fatherId=%s activePhases=%d blItems=%d', calcMasterId, fatherId, activePhases.length, blItems.length);

  if (!activePhases.length && !blItems.length) return; // nothing to create

  // Phase label map (only needed when there are active phases)
  let phaseMap = new Map();
  if (activePhases.length) {
    const phaseIds = [...new Set(activePhases.map(r => r.FEE_PHASE_ID).filter(Boolean))];
    if (phaseIds.length) {
      const { data: phaseDefs } = await supabase.from('FEE_PHASE').select('ID, NAME_SHORT, NAME_LONG').in('ID', phaseIds);
      phaseMap = new Map((phaseDefs || []).map(r => [r.ID, r]));
    }
  }

  // EXTRAS_PERCENT from parent node (0 if no parent)
  let extrasPercent = 0;
  if (fatherId) {
    const { data: father } = await supabase.from('PROJECT_STRUCTURE').select('EXTRAS_PERCENT').eq('ID', fatherId).single();
    extrasPercent = Number(father?.EXTRAS_PERCENT ?? 0) || 0;
  }

  // Step 2: Compute surcharge allocations (soft-fail)
  let lphAlloc = {}, blAlloc = {};
  try {
    const surRes = await supabase.from('FEE_CALCULATION_SURCHARGES').select('AMOUNT, LPH_FILTER, BL_FILTER')
      .eq('FEE_CALC_MASTER_ID', calcMasterId).eq('TENANT_ID', tenantId).order('SORT_ORDER');
    const allPhaseIds = activePhases.map(p => p.ID);
    for (const s of (surRes.data || [])) {
      const amount = Number(s.AMOUNT) || 0;
      if (!amount) continue;
      const selIds = s.LPH_FILTER ? (() => { try { return JSON.parse(s.LPH_FILTER); } catch { return allPhaseIds; } })() : allPhaseIds;
      const selPhases = activePhases.filter(p => selIds.includes(p.ID));
      const lphBase = selPhases.reduce((sum, p) => sum + (Number(p.PHASE_REVENUE) || 0), 0);
      let selBls = [], blBase = 0;
      if (s.BL_FILTER) {
        try { const ids = JSON.parse(s.BL_FILTER); selBls = blItems.filter(b => ids.includes(b.ID)); blBase = selBls.reduce((sum, b) => sum + (Number(b.AMOUNT) || 0), 0); } catch { /* ignore */ }
      }
      const base = lphBase + blBase;
      if (!base) continue;
      const lphAmt = amount * (lphBase / base);
      for (const p of selPhases) { const pRev = Number(p.PHASE_REVENUE) || 0; if (pRev) lphAlloc[p.ID] = (lphAlloc[p.ID] || 0) + (pRev / lphBase) * lphAmt; }
      const blAmt  = amount * (blBase / base);
      for (const b of selBls)  { const bAmt = Number(b.AMOUNT) || 0; if (bAmt) blAlloc[b.ID]  = (blAlloc[b.ID]  || 0) + (bAmt  / blBase)  * blAmt;  }
    }
  } catch (surErr) {
    console.warn('[attachFeeCalc] Surcharge allocation soft-fail:', surErr?.message);
  }

  // Step 3: Insert LPH structure rows
  let insertRows = [];
  if (activePhases.length) {
    insertRows = activePhases.map(r => {
      const def = phaseMap.get(r.FEE_PHASE_ID) || {};
      const rev  = fmt2((Number(r.PHASE_REVENUE) || 0) + (lphAlloc[r.ID] || 0));
      return {
        NAME_SHORT: def.NAME_SHORT || `LPH ${r.FEE_PHASE_ID}`,
        NAME_LONG:  def.NAME_LONG  || null,
        REVENUE: rev, EXTRAS: fmt2(rev * extrasPercent / 100), COSTS: 0,
        PROJECT_ID: projectId, FATHER_ID: fatherId,
        EXTRAS_PERCENT: extrasPercent, BILLING_TYPE_ID: 1, TENANT_ID: tenantId,
        REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0,
        REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
        FEE_CALC_MASTER_ID: calcMasterId, FEE_CALC_PHASE_ID: r.ID,
      };
    });
    let { data: created, error } = await supabase.from('PROJECT_STRUCTURE').insert(insertRows).select('ID');
    if (error) {
      const fallback = insertRows.map(({ FEE_CALC_MASTER_ID, FEE_CALC_PHASE_ID, ...rest }) => rest);
      const { data: created2, error: err2 } = await supabase.from('PROJECT_STRUCTURE').insert(fallback).select('ID');
      if (err2) throw err2;
      created = created2;
    }
    if (created && created.length) {
      await supabase.from('PROJECT_PROGRESS').insert(created.map(r => ({
        STRUCTURE_ID: r.ID, TENANT_ID: tenantId, REVENUE: 0, EXTRAS: 0, EXTRAS_PERCENT: extrasPercent,
        REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
      }))).catch(() => {});
    }
  }

  // Step 4: Insert BL structure rows
  if (blItems.length) {
    const blInsert = blItems.map(b => {
      const rev = fmt2((Number(b.AMOUNT) || 0) + (blAlloc[b.ID] || 0));
      return {
        NAME_SHORT: b.NAME || 'BL',
        NAME_LONG:  b.NAME || null,
        REVENUE: rev, EXTRAS: fmt2(rev * extrasPercent / 100), COSTS: 0,
        PROJECT_ID: projectId, FATHER_ID: fatherId,
        EXTRAS_PERCENT: extrasPercent, BILLING_TYPE_ID: 1, TENANT_ID: tenantId,
        REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0,
        REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
        FEE_CALC_MASTER_ID: calcMasterId, FEE_CALC_BL_ID: b.ID,
      };
    });
    let blCreated = null;
    const { data: blData, error: blErr } = await supabase.from('PROJECT_STRUCTURE').insert(blInsert).select('ID');
    if (blErr) {
      console.error('[attachFeeCalc] BL insert error (trying fallback without FEE_CALC cols):', blErr.message);
      const blFallback = blInsert.map(({ FEE_CALC_MASTER_ID, FEE_CALC_BL_ID, ...rest }) => rest);
      const { data: blData2, error: blErr2 } = await supabase.from('PROJECT_STRUCTURE').insert(blFallback).select('ID');
      if (blErr2) {
        console.error('[attachFeeCalc] BL fallback insert error:', blErr2.message);
      } else {
        blCreated = blData2;
      }
    } else {
      blCreated = blData;
    }
    if (blCreated && blCreated.length) {
      await supabase.from('PROJECT_PROGRESS').insert(blCreated.map(r => ({
        STRUCTURE_ID: r.ID, TENANT_ID: tenantId, REVENUE: 0, EXTRAS: 0, EXTRAS_PERCENT: extrasPercent,
        REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
      }))).catch(() => {});
    }
  }

  // Update parent node REVENUE = sum of children (LPH + BL) revenues
  if (fatherId) {
    const lphTotal = insertRows.reduce((sum, r) => sum + (Number(r.REVENUE) || 0), 0);
    const blTotal  = blItems.reduce((acc, b) => acc + fmt2((Number(b.AMOUNT) || 0) + (blAlloc[b.ID] || 0)), 0);
    const parentRev = fmt2(lphTotal + blTotal);
    if (parentRev > 0) {
      await supabase.from('PROJECT_STRUCTURE').update({
        REVENUE: parentRev,
        EXTRAS:  fmt2(parentRev * extrasPercent / 100),
      }).eq('ID', fatherId).catch(() => {});
    }
  }
}

// ── attach fee calc to offer structure ───────────────────────────────────────

async function attachFeeCalcToOfferStructure(supabase, { calcMasterId, fatherId, offerId, tenantId }) {
  const { loadPhaseRowsWithLabels } = require('./stammdaten');
  const phaseRows   = await loadPhaseRowsWithLabels(supabase, calcMasterId);
  const activePhases = phaseRows.filter(r => (Number(r.PHASE_REVENUE) || 0) !== 0 || (Number(r.FEE_PERCENT) || 0) !== 0);

  const blQueryRes = await supabase.from('FEE_CALCULATION_BL')
    .select('ID, NAME, AMOUNT').eq('FEE_CALC_MASTER_ID', calcMasterId).order('SORT_ORDER', { ascending: true });
  const blItems = blQueryRes.data || [];

  if (!activePhases.length && !blItems.length) return;

  // Phase label map
  const phaseIds = [...new Set(activePhases.map(r => r.FEE_PHASE_ID).filter(Boolean))];
  let phaseMap = new Map();
  if (phaseIds.length) {
    const { data: phaseDefs } = await supabase.from('FEE_PHASE').select('ID, NAME_SHORT, NAME_LONG').in('ID', phaseIds);
    phaseMap = new Map((phaseDefs || []).map(r => [r.ID, r]));
  }

  // EXTRAS_PERCENT from parent node
  let extrasPercent = 0;
  if (fatherId) {
    const { data: father } = await supabase.from('OFFER_STRUCTURE').select('EXTRAS_PERCENT').eq('ID', fatherId).single();
    extrasPercent = Number(father?.EXTRAS_PERCENT ?? 0) || 0;
  }

  // Surcharge allocation (same as project version)
  let lphAlloc = {}, blAlloc = {};
  try {
    const surRes = await supabase.from('FEE_CALCULATION_SURCHARGES').select('AMOUNT, LPH_FILTER, BL_FILTER')
      .eq('FEE_CALC_MASTER_ID', calcMasterId).eq('TENANT_ID', tenantId).order('SORT_ORDER');
    const allPhaseIds = activePhases.map(p => p.ID);
    for (const s of (surRes.data || [])) {
      const amount = Number(s.AMOUNT) || 0;
      if (!amount) continue;
      const selIds    = s.LPH_FILTER ? (() => { try { return JSON.parse(s.LPH_FILTER); } catch { return allPhaseIds; } })() : allPhaseIds;
      const selPhases = activePhases.filter(p => selIds.includes(p.ID));
      const lphBase   = selPhases.reduce((sum, p) => sum + (Number(p.PHASE_REVENUE) || 0), 0);
      let selBls = [], blBase = 0;
      if (s.BL_FILTER) {
        try { const ids = JSON.parse(s.BL_FILTER); selBls = blItems.filter(b => ids.includes(b.ID)); blBase = selBls.reduce((sum, b) => sum + (Number(b.AMOUNT) || 0), 0); } catch { /* ignore */ }
      }
      const base = lphBase + blBase;
      if (!base) continue;
      const lphAmt = amount * (lphBase / base);
      for (const p of selPhases) { const pRev = Number(p.PHASE_REVENUE) || 0; if (pRev) lphAlloc[p.ID] = (lphAlloc[p.ID] || 0) + (pRev / lphBase) * lphAmt; }
      const blAmt = amount * (blBase / base);
      for (const b of selBls) { const bAmt = Number(b.AMOUNT) || 0; if (bAmt) blAlloc[b.ID] = (blAlloc[b.ID] || 0) + (bAmt / blBase) * blAmt; }
    }
  } catch (_) { /* soft-fail */ }

  // Determine SORT_ORDER start (append after existing children)
  let sortBase = 0;
  if (fatherId) {
    const { data: siblings } = await supabase.from('OFFER_STRUCTURE').select('SORT_ORDER').eq('FATHER_ID', fatherId);
    if (siblings && siblings.length > 0) sortBase = Math.max(...siblings.map(s => Number(s.SORT_ORDER ?? 0))) + 10;
  }

  // Insert LPH rows
  if (activePhases.length) {
    const insertRows = activePhases.map((r, i) => {
      const def = phaseMap.get(r.FEE_PHASE_ID) || {};
      const rev  = fmt2((Number(r.PHASE_REVENUE) || 0) + (lphAlloc[r.ID] || 0));
      return {
        NAME_SHORT:     def.NAME_SHORT || `LPH ${r.FEE_PHASE_ID}`,
        NAME_LONG:      def.NAME_LONG  || null,
        OFFER_ID:       offerId, FATHER_ID: fatherId,
        BILLING_TYPE_ID: 1, EXTRAS_PERCENT: extrasPercent,
        REVENUE_BASIS: rev, REVENUE: rev, EXTRAS: fmt2(rev * extrasPercent / 100),
        SURCHARGES_TOTAL: 0, SORT_ORDER: sortBase + i * 10,
        TENANT_ID: tenantId,
      };
    });
    await supabase.from('OFFER_STRUCTURE').insert(insertRows);
  }

  // Insert BL rows
  if (blItems.length) {
    const lphCount = activePhases.length;
    const blRows = blItems.map((b, i) => {
      const rev = fmt2((Number(b.AMOUNT) || 0) + (blAlloc[b.ID] || 0));
      return {
        NAME_SHORT:      b.NAME || b.NAME_SHORT || 'BL',
        NAME_LONG:       b.NAME || null,
        OFFER_ID:        offerId, FATHER_ID: fatherId,
        BILLING_TYPE_ID: 1, EXTRAS_PERCENT: extrasPercent,
        REVENUE_BASIS: rev, REVENUE: rev, EXTRAS: fmt2(rev * extrasPercent / 100),
        SURCHARGES_TOTAL: 0, SORT_ORDER: sortBase + (lphCount + i) * 10,
        TENANT_ID: tenantId,
      };
    });
    await supabase.from('OFFER_STRUCTURE').insert(blRows);
  }

  // Recalculate parent
  if (fatherId) await recalcOfferParent(supabase, { parentId: fatherId });
}

// ── offer → project conversion ────────────────────────────────────────────────

async function convertOfferToProject(supabase, { tenantId, offerId, body }) {
  const b = body || {};

  if (!b.order_date)         throw { status: 400, message: 'Auftragsdatum ist erforderlich' };
  if (!b.project_status_id)  throw { status: 400, message: 'Projektstatus ist erforderlich' };
  if (!b.project_manager_id) throw { status: 400, message: 'Projektleiter ist erforderlich' };

  // Fetch offer
  const { data: offer, error: offerErr } = await supabase
    .from('OFFER')
    .select('*')
    .eq('ID', offerId)
    .eq('TENANT_ID', tenantId)
    .maybeSingle();
  if (offerErr) throw offerErr;
  if (!offer) throw { status: 404, message: 'Angebot nicht gefunden' };

  if (offer.PROJECT_ID) throw { status: 409, message: 'Angebot wurde bereits in ein Projekt konvertiert' };
  if (!offer.ADDRESS_ID) throw { status: 400, message: 'Angebot hat keine Rechnungsadresse' };
  if (!offer.CONTACT_ID) throw { status: 400, message: 'Angebot hat keinen Kontakt' };

  // Fetch offer structure ordered by SORT_ORDER so hierarchy is preserved
  const { data: offerStructRows, error: structErr } = await supabase
    .from('OFFER_STRUCTURE')
    .select('*')
    .eq('OFFER_ID', offerId)
    .order('SORT_ORDER', { ascending: true })
    .order('ID', { ascending: true });
  if (structErr) throw structErr;
  const offerStruct = offerStructRows || [];

  // Project number
  const companyId = offer.COMPANY_ID ? parseInt(String(offer.COMPANY_ID), 10) : null;
  if (!companyId) throw { status: 400, message: 'Angebot hat keine Firma' };

  const { data: num, error: numErr } = await supabase.rpc('next_project_number', { p_company_id: companyId });
  if (numErr || !num) {
    throw { status: 500, message: 'Nummernkreis konnte nicht geladen werden: ' + (numErr?.message || 'kein Ergebnis') };
  }

  // Insert PROJECT — also copy root-level (offer-level) surcharges
  const projectRow = {
    NAME_SHORT:         num,
    NAME_LONG:          offer.NAME_LONG,
    COMPANY_ID:         companyId,
    PROJECT_STATUS_ID:  parseInt(String(b.project_status_id), 10),
    PROJECT_TYPE_ID:    b.project_type_id  ? parseInt(String(b.project_type_id), 10)  : null,
    DEPARTMENT_ID:      b.department_id    ? parseInt(String(b.department_id), 10)    : null,
    PROJECT_MANAGER_ID: parseInt(String(b.project_manager_id), 10),
    ADDRESS_ID:         offer.ADDRESS_ID,
    CONTACT_ID:         offer.CONTACT_ID,
    TENANT_ID:          tenantId,
    OFFER_ID:           offerId,
    SURCHARGE_1_LABEL:  offer.SURCHARGE_1_LABEL ?? null,
    SURCHARGE_1_PCT:    offer.SURCHARGE_1_PCT   ?? null,
    SURCHARGE_1_EUR:    offer.SURCHARGE_1_EUR   ?? 0,
    SURCHARGE_1_CUMUL:  offer.SURCHARGE_1_CUMUL ?? true,
    SURCHARGE_2_LABEL:  offer.SURCHARGE_2_LABEL ?? null,
    SURCHARGE_2_PCT:    offer.SURCHARGE_2_PCT   ?? null,
    SURCHARGE_2_EUR:    offer.SURCHARGE_2_EUR   ?? 0,
    SURCHARGE_2_CUMUL:  offer.SURCHARGE_2_CUMUL ?? true,
    SURCHARGE_3_LABEL:  offer.SURCHARGE_3_LABEL ?? null,
    SURCHARGE_3_PCT:    offer.SURCHARGE_3_PCT   ?? null,
    SURCHARGE_3_EUR:    offer.SURCHARGE_3_EUR   ?? 0,
    SURCHARGE_3_CUMUL:  offer.SURCHARGE_3_CUMUL ?? true,
    SURCHARGES_TOTAL:   offer.SURCHARGES_TOTAL  ?? 0,
  };

  let project = null;
  {
    const r = await supabase.from('PROJECT').insert([projectRow])
      .select('ID, NAME_SHORT, NAME_LONG, ADDRESS_ID, CONTACT_ID, TENANT_ID')
      .single();
    if (r.error) {
      const msg = String(r.error.message || '');
      // Retry without problematic columns if schema not yet updated
      const row2 = { ...projectRow };
      if (msg.includes('OFFER_ID'))   delete row2.OFFER_ID;
      if (msg.includes('COMPANY_ID')) delete row2.COMPANY_ID;
      // If SURCHARGE_* columns don't exist yet (migration 0046 not run), drop them and retry
      if (msg.includes('SURCHARGE')) {
        delete row2.SURCHARGE_1_LABEL; delete row2.SURCHARGE_1_PCT; delete row2.SURCHARGE_1_EUR; delete row2.SURCHARGE_1_CUMUL;
        delete row2.SURCHARGE_2_LABEL; delete row2.SURCHARGE_2_PCT; delete row2.SURCHARGE_2_EUR; delete row2.SURCHARGE_2_CUMUL;
        delete row2.SURCHARGE_3_LABEL; delete row2.SURCHARGE_3_PCT; delete row2.SURCHARGE_3_EUR; delete row2.SURCHARGE_3_CUMUL;
        delete row2.SURCHARGES_TOTAL;
      }
      const r2 = await supabase.from('PROJECT').insert([row2])
        .select('ID, NAME_SHORT, NAME_LONG, ADDRESS_ID, CONTACT_ID, TENANT_ID')
        .single();
      if (r2.error) throw { status: 500, message: r2.error.message };
      project = r2.data;
    } else {
      project = r.data;
    }
  }

  // EMPLOYEE2PROJECT — deduplicate by employee_id
  if (Array.isArray(b.employee2project) && b.employee2project.length) {
    const seen = new Set();
    const e2pRows = [];
    for (const r of b.employee2project) {
      const empId = r.employee_id ? parseInt(String(r.employee_id), 10) : null;
      if (!empId || seen.has(empId)) continue;
      seen.add(empId);
      e2pRows.push({
        EMPLOYEE_ID:    empId,
        PROJECT_ID:     project.ID,
        ROLE_ID:        r.role_id ? parseInt(String(r.role_id), 10) : null,
        ROLE_NAME_SHORT: r.role_name_short || '',
        ROLE_NAME_LONG:  r.role_name_long  || '',
        SP_RATE:        r.sp_rate != null && r.sp_rate !== '' ? Number(r.sp_rate) : null,
        TENANT_ID:      tenantId,
      });
    }
    if (e2pRows.length) {
      const { error: e2pErr } = await supabase.from('EMPLOYEE2PROJECT').insert(e2pRows);
      if (e2pErr) throw { status: 500, message: 'Mitarbeiter konnten nicht zugeordnet werden: ' + e2pErr.message };
    }
  }

  // PROJECT_STRUCTURE — 2-pass to set FATHER_ID
  // Declared here so it's also accessible in the HOAI attachment block below
  const offerIdToNew = new Map();
  if (offerStruct.length) {
    const insertRows = offerStruct.map(n => {
      const btId  = n.BILLING_TYPE_ID ? parseInt(String(n.BILLING_TYPE_ID), 10) : null;
      const isBt1 = btId === 1;
      return {
      NAME_SHORT:       String(n.NAME_SHORT || '').trim(),
      NAME_LONG:        String(n.NAME_LONG  || '').trim(),
      PROJECT_ID:       project.ID,
      BILLING_TYPE_ID:  btId,
      FATHER_ID:        null,
      REVENUE_BASIS:    isBt1 ? fmt2(Number(n.REVENUE_BASIS ?? n.REVENUE ?? 0)) : 0,
      REVENUE:          isBt1 ? fmt2(Number(n.REVENUE || 0)) : 0,
      EXTRAS_PERCENT:   Number(n.EXTRAS_PERCENT || 0),
      EXTRAS:           isBt1 ? fmt2(Number(n.EXTRAS  || 0)) : 0,
      COSTS:            0,
      REVENUE_COMPLETION_PERCENT: 0,
      EXTRAS_COMPLETION_PERCENT:  0,
      REVENUE_COMPLETION: 0,
      EXTRAS_COMPLETION:  0,
      TENANT_ID:        tenantId,
      // Per-node surcharges
      SURCHARGE_1_LABEL: n.SURCHARGE_1_LABEL ?? null,
      SURCHARGE_1_PCT:   n.SURCHARGE_1_PCT   ?? null,
      SURCHARGE_1_EUR:   n.SURCHARGE_1_EUR   ?? 0,
      SURCHARGE_1_CUMUL: n.SURCHARGE_1_CUMUL ?? true,
      SURCHARGE_2_LABEL: n.SURCHARGE_2_LABEL ?? null,
      SURCHARGE_2_PCT:   n.SURCHARGE_2_PCT   ?? null,
      SURCHARGE_2_EUR:   n.SURCHARGE_2_EUR   ?? 0,
      SURCHARGE_2_CUMUL: n.SURCHARGE_2_CUMUL ?? true,
      SURCHARGE_3_LABEL: n.SURCHARGE_3_LABEL ?? null,
      SURCHARGE_3_PCT:   n.SURCHARGE_3_PCT   ?? null,
      SURCHARGE_3_EUR:   n.SURCHARGE_3_EUR   ?? 0,
      SURCHARGE_3_CUMUL: n.SURCHARGE_3_CUMUL ?? true,
      SURCHARGES_TOTAL:  n.SURCHARGES_TOTAL  ?? 0,
    }; });

    let createdNodes;
    {
      const r = await supabase.from('PROJECT_STRUCTURE').insert(insertRows).select('ID');
      if (r.error) {
        const msg = String(r.error.message || '');
        // Fallback: schema may be missing surcharge columns
        if (msg.includes('SURCHARGE') || msg.includes('REVENUE_BASIS')) {
          const stripped = insertRows.map(row => {
            const c = { ...row };
            delete c.REVENUE_BASIS;
            delete c.SURCHARGE_1_LABEL; delete c.SURCHARGE_1_PCT; delete c.SURCHARGE_1_EUR; delete c.SURCHARGE_1_CUMUL;
            delete c.SURCHARGE_2_LABEL; delete c.SURCHARGE_2_PCT; delete c.SURCHARGE_2_EUR; delete c.SURCHARGE_2_CUMUL;
            delete c.SURCHARGE_3_LABEL; delete c.SURCHARGE_3_PCT; delete c.SURCHARGE_3_EUR; delete c.SURCHARGE_3_CUMUL;
            delete c.SURCHARGES_TOTAL;
            return c;
          });
          const r2 = await supabase.from('PROJECT_STRUCTURE').insert(stripped).select('ID');
          if (r2.error) throw { status: 500, message: 'Projektstruktur konnte nicht angelegt werden: ' + r2.error.message };
          createdNodes = r2.data;
        } else {
          throw { status: 500, message: 'Projektstruktur konnte nicht angelegt werden: ' + r.error.message };
        }
      } else {
        createdNodes = r.data;
      }
    }

    // Map old offer structure ID → new project structure ID
    (createdNodes || []).forEach((row, i) => { offerIdToNew.set(offerStruct[i].ID, row.ID); });

    // Set FATHER_ID
    for (let i = 0; i < offerStruct.length; i++) {
      const n = offerStruct[i];
      if (!n.FATHER_ID) continue;
      const childId  = offerIdToNew.get(n.ID);
      const fatherId = offerIdToNew.get(n.FATHER_ID);
      if (!childId || !fatherId) continue;
      await supabase.from('PROJECT_STRUCTURE').update({ FATHER_ID: fatherId }).eq('ID', childId);
    }

    // PROJECT_PROGRESS
    try {
      const progressRows = (createdNodes || []).map((r, i) => {
        const n     = offerStruct[i];
        const isBt1 = parseInt(String(n.BILLING_TYPE_ID || 0), 10) === 1;
        return {
        STRUCTURE_ID:               r.ID,
        TENANT_ID:                  tenantId,
        REVENUE:                    isBt1 ? fmt2(Number(n.REVENUE || 0)) : 0,
        EXTRAS_PERCENT:             Number(n.EXTRAS_PERCENT || 0),
        EXTRAS:                     isBt1 ? fmt2(Number(n.EXTRAS  || 0)) : 0,
        REVENUE_COMPLETION_PERCENT: 0,
        EXTRAS_COMPLETION_PERCENT:  0,
        REVENUE_COMPLETION:         0,
        EXTRAS_COMPLETION:          0,
        }; });
      if (progressRows.length) await supabase.from('PROJECT_PROGRESS').insert(progressRows);
    } catch (_) { /* ignore progress errors */ }
  }

  // CONTRACT with tenant defaults
  const { data: settingsRows } = await supabase
    .from('TENANT_SETTINGS').select('KEY, VALUE').eq('TENANT_ID', tenantId);
  const defaults = {};
  for (const row of settingsRows || []) defaults[row.KEY] = row.VALUE;

  const contractRow = {
    NAME_SHORT:         project.NAME_SHORT,
    NAME_LONG:          project.NAME_LONG,
    PROJECT_ID:         project.ID,
    INVOICE_ADDRESS_ID: project.ADDRESS_ID,
    INVOICE_CONTACT_ID: project.CONTACT_ID,
    TENANT_ID:          tenantId,
    ...(defaults.default_currency_id ? { CURRENCY_ID: Number(defaults.default_currency_id) } : {}),
    ...(defaults.default_vat_id      ? { VAT_ID:      Number(defaults.default_vat_id)      } : {}),
  };
  {
    const { error } = await supabase.from('CONTRACT').insert([contractRow]);
    if (error) {
      const { error: e2 } = await supabase.from('CONTRACTS').insert([contractRow]);
      if (e2) throw { status: 500, message: 'Vertrag konnte nicht angelegt werden: ' + (e2.message || error.message) };
    }
  }

  // Update OFFER — wrap in try/catch in case columns not yet migrated
  try {
    await supabase.from('OFFER').update({ PROJECT_ID: project.ID, ORDER_DATE: b.order_date })
      .eq('ID', offerId);
  } catch (_) { /* non-fatal */ }

  // Attach HOAI calculations that were linked to this offer
  try {
    const { data: feeCalcs } = await supabase
      .from('FEE_CALCULATION_MASTER')
      .select('ID, NAME_SHORT, NAME_LONG, ATTACH_TO_OFFER_STRUCTURE_ID')
      .eq('OFFER_ID', offerId)
      .eq('TENANT_ID', tenantId);

    if (feeCalcs && feeCalcs.length > 0) {
      for (const calc of feeCalcs) {
        // Move calculation from offer to project
        await supabase.from('FEE_CALCULATION_MASTER')
          .update({ PROJECT_ID: project.ID })
          .eq('ID', calc.ID).eq('TENANT_ID', tenantId);

        // Resolve parent project-structure node
        let fatherId = calc.ATTACH_TO_OFFER_STRUCTURE_ID
          ? (offerIdToNew.get(calc.ATTACH_TO_OFFER_STRUCTURE_ID) || null)
          : (offerIdToNew.size > 0 ? offerIdToNew.values().next().value : null);

        // No matching parent found — create a root node for this HOAI calculation
        if (!fatherId) {
          const { data: rootNode } = await supabase.from('PROJECT_STRUCTURE').insert([{
            NAME_SHORT:        calc.NAME_SHORT || 'Honorar',
            NAME_LONG:         calc.NAME_LONG  || null,
            PROJECT_ID:        project.ID, BILLING_TYPE_ID: 1, FATHER_ID: null,
            REVENUE: 0, EXTRAS: 0, COSTS: 0, EXTRAS_PERCENT: 0,
            REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0,
            REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
            TENANT_ID: tenantId,
          }]).select('ID').single();
          if (rootNode) {
            fatherId = rootNode.ID;
            await supabase.from('PROJECT_PROGRESS').insert([{
              STRUCTURE_ID: rootNode.ID, TENANT_ID: tenantId, REVENUE: 0, EXTRAS: 0, EXTRAS_PERCENT: 0,
              REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
            }]).catch(() => {});
          }
        }

        if (fatherId) {
          // Skip if OFFER_STRUCTURE already had children under ATTACH_TO_OFFER_STRUCTURE_ID —
          // those nodes were copied to PROJECT_STRUCTURE above; calling attachFeeCalcToProjectStructure
          // would create duplicates.
          if (calc.ATTACH_TO_OFFER_STRUCTURE_ID) {
            const { data: existingChildren } = await supabase
              .from('OFFER_STRUCTURE').select('ID')
              .eq('FATHER_ID', calc.ATTACH_TO_OFFER_STRUCTURE_ID).limit(1);
            if (existingChildren && existingChildren.length > 0) {
              console.log('[convertOffer] skipping attachFeeCalcToProjectStructure for calcId=%d (already in OFFER_STRUCTURE)', calc.ID);
              continue;
            }
          }
          await attachFeeCalcToProjectStructure(supabase, { calcMasterId: calc.ID, fatherId, projectId: project.ID, tenantId });

          // Direct BL failsafe: query BL items independently (no TENANT_ID filter) and create
          // any that are missing from PROJECT_STRUCTURE. Handles the case where
          // attachFeeCalcToProjectStructure's BL step silently returned empty.
          const { data: blAll } = await supabase.from('FEE_CALCULATION_BL')
            .select('ID, NAME, AMOUNT').eq('FEE_CALC_MASTER_ID', calc.ID);
          if (blAll && blAll.length) {
            // Check which BL items already have a PROJECT_STRUCTURE row for this project.
            // If FEE_CALC_BL_ID column doesn't exist (migration 0043 not run), data is null → empty set.
            const blStructRes = await supabase.from('PROJECT_STRUCTURE')
              .select('FEE_CALC_BL_ID').eq('PROJECT_ID', project.ID)
              .not('FEE_CALC_BL_ID', 'is', null);
            const existingBlStructs = blStructRes.data;
            const existingBlIds = new Set((existingBlStructs || []).map(r => r.FEE_CALC_BL_ID));
            const missingBls = blAll.filter(b => !existingBlIds.has(b.ID));
            if (missingBls.length) {
              console.log('[convertOffer] creating %d missing BL structure rows for calcMasterId=%d', missingBls.length, calc.ID);
              const blRows = missingBls.map(b => ({
                NAME_SHORT: b.NAME || 'BL', NAME_LONG: b.NAME || null,
                REVENUE: Number(b.AMOUNT) || 0, EXTRAS: 0, COSTS: 0,
                PROJECT_ID: project.ID, FATHER_ID: fatherId, EXTRAS_PERCENT: 0,
                BILLING_TYPE_ID: 1, TENANT_ID: tenantId,
                REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0,
                REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
              }));
              // Try with FEE_CALC_BL_ID first (migration 0043)
              const blWithId = blRows.map((r, i) => ({ ...r, FEE_CALC_BL_ID: missingBls[i].ID }));
              let { data: blCreated, error: blInsErr } = await supabase.from('PROJECT_STRUCTURE').insert(blWithId).select('ID');
              if (blInsErr) {
                console.warn('[convertOffer] BL insert with FEE_CALC_BL_ID failed, retrying without:', blInsErr.message);
                const { data: blCreated2, error: blInsErr2 } = await supabase.from('PROJECT_STRUCTURE').insert(blRows).select('ID');
                if (blInsErr2) console.error('[convertOffer] BL fallback insert error:', blInsErr2.message);
                else blCreated = blCreated2;
              }
              if (blCreated?.length) {
                await supabase.from('PROJECT_PROGRESS').insert(blCreated.map(r => ({
                  STRUCTURE_ID: r.ID, TENANT_ID: tenantId, REVENUE: 0, EXTRAS: 0, EXTRAS_PERCENT: 0,
                  REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
                }))).catch(() => {});
              }
            }
          }
        }
      }
    }
  } catch (feeErr) {
    console.warn('[HOAI conversion] soft-fail:', feeErr?.message || feeErr);
  }

  return { project, projectName: project.NAME_SHORT };
}

// ── copy offer ────────────────────────────────────────────────────────────────

async function copyOffer(supabase, { offerId, tenantId }) {
  const { data: src, error: srcErr } = await supabase
    .from('OFFER').select('*').eq('ID', offerId).eq('TENANT_ID', tenantId).maybeSingle();
  if (srcErr) throw srcErr;
  if (!src) throw { status: 404, message: 'Angebot nicht gefunden' };

  const { data: newNum, error: numErr } = await supabase.rpc('next_offer_number', { p_company_id: src.COMPANY_ID });
  if (numErr || !newNum) throw { status: 500, message: 'Nummernkreis Fehler: ' + (numErr?.message || '') };

  // eslint-disable-next-line no-unused-vars
  const { ID: _id, CREATED_AT: _ca, UPDATED_AT: _ua, NAME_SHORT: _ns, PROJECT_ID: _pid, ...offerRest } = src;
  const { data: newOffer, error: offerInsErr } = await supabase
    .from('OFFER')
    .insert([{ ...offerRest, NAME_SHORT: newNum, PROJECT_ID: null, TENANT_ID: tenantId }])
    .select('*').single();
  if (offerInsErr) throw offerInsErr;

  // Copy OFFER_STRUCTURE (2-pass for FATHER_ID)
  const { data: srcStruct } = await supabase
    .from('OFFER_STRUCTURE').select('*').eq('OFFER_ID', offerId).eq('TENANT_ID', tenantId)
    .order('SORT_ORDER').order('ID');
  const oldToNewStructId = new Map();
  if (srcStruct?.length) {
    const insRows = srcStruct.map(({ ID: _sid, OFFER_ID: _oid, FATHER_ID: _fid, CREATED_AT: _ca2, UPDATED_AT: _ua2, ...rest }) => ({
      ...rest, OFFER_ID: newOffer.ID, FATHER_ID: null, TENANT_ID: tenantId,
    }));
    const { data: created, error: structInsErr } = await supabase.from('OFFER_STRUCTURE').insert(insRows).select('ID');
    if (structInsErr) throw structInsErr;
    srcStruct.forEach((row, i) => oldToNewStructId.set(row.ID, created[i].ID));
    for (const row of srcStruct) {
      if (!row.FATHER_ID) continue;
      const newId = oldToNewStructId.get(row.ID);
      const newFatherId = oldToNewStructId.get(row.FATHER_ID);
      if (newId && newFatherId) await supabase.from('OFFER_STRUCTURE').update({ FATHER_ID: newFatherId }).eq('ID', newId);
    }
  }

  // Copy FEE_CALCULATION_MASTER + phases + BL + surcharges
  const { data: feeCalcs } = await supabase
    .from('FEE_CALCULATION_MASTER')
    .select('ID, NAME_SHORT, NAME_LONG, FEE_MASTER_ID, ZONE_ID, ZONE_PERCENT, CONSTRUCTION_COSTS_K0, CONSTRUCTION_COSTS_K1, CONSTRUCTION_COSTS_K2, CONSTRUCTION_COSTS_K3, CONSTRUCTION_COSTS_K4, REVENUE_K0, REVENUE_K1, REVENUE_K2, REVENUE_K3, REVENUE_K4, ATTACH_TO_OFFER_STRUCTURE_ID')
    .eq('OFFER_ID', offerId).eq('TENANT_ID', tenantId);

  for (const calc of (feeCalcs || [])) {
    const newAttachId = calc.ATTACH_TO_OFFER_STRUCTURE_ID
      ? (oldToNewStructId.get(calc.ATTACH_TO_OFFER_STRUCTURE_ID) ?? null) : null;
    const { data: newCalc, error: calcInsErr } = await supabase
      .from('FEE_CALCULATION_MASTER')
      .insert([{
        NAME_SHORT: calc.NAME_SHORT, NAME_LONG: calc.NAME_LONG,
        FEE_MASTER_ID: calc.FEE_MASTER_ID, ZONE_ID: calc.ZONE_ID, ZONE_PERCENT: calc.ZONE_PERCENT,
        CONSTRUCTION_COSTS_K0: calc.CONSTRUCTION_COSTS_K0, CONSTRUCTION_COSTS_K1: calc.CONSTRUCTION_COSTS_K1,
        CONSTRUCTION_COSTS_K2: calc.CONSTRUCTION_COSTS_K2, CONSTRUCTION_COSTS_K3: calc.CONSTRUCTION_COSTS_K3,
        CONSTRUCTION_COSTS_K4: calc.CONSTRUCTION_COSTS_K4,
        REVENUE_K0: calc.REVENUE_K0, REVENUE_K1: calc.REVENUE_K1, REVENUE_K2: calc.REVENUE_K2,
        REVENUE_K3: calc.REVENUE_K3, REVENUE_K4: calc.REVENUE_K4,
        OFFER_ID: newOffer.ID, PROJECT_ID: null,
        ATTACH_TO_OFFER_STRUCTURE_ID: newAttachId, TENANT_ID: tenantId,
      }])
      .select('ID').single();
    if (calcInsErr) { console.warn('FEE_CALC_MASTER copy:', calcInsErr.message); continue; }

    const { data: phases } = await supabase.from('FEE_CALCULATION_PHASE')
      .select('FEE_PHASE_ID, FEE_PERCENT_BASE, KX, REVENUE_BASE, FEE_PERCENT, PHASE_REVENUE')
      .eq('FEE_MASTER_ID', calc.ID);
    if (phases?.length) await supabase.from('FEE_CALCULATION_PHASE').insert(phases.map(p => ({ ...p, FEE_MASTER_ID: newCalc.ID })));

    const { data: blItems } = await supabase.from('FEE_CALCULATION_BL')
      .select('ID, NAME, NAME_SHORT, LPH_REF, LPH_PHASE_ID, AMOUNT_TYPE, PERCENT, KX_REF, AMOUNT, SORT_ORDER')
      .eq('FEE_CALC_MASTER_ID', calc.ID).eq('TENANT_ID', tenantId);
    const oldToNewBlId = new Map();
    if (blItems?.length) {
      const blInsRows = blItems.map(({ ID: _blId, ...blRest }) => ({ ...blRest, FEE_CALC_MASTER_ID: newCalc.ID, TENANT_ID: tenantId }));
      const { data: createdBl } = await supabase.from('FEE_CALCULATION_BL').insert(blInsRows).select('ID');
      blItems.forEach((row, i) => { if (createdBl?.[i]) oldToNewBlId.set(row.ID, createdBl[i].ID); });
    }

    const { data: surcharges } = await supabase.from('FEE_CALCULATION_SURCHARGES')
      .select('FEE_SURCHARGE_ID, NAME_SHORT, NAME_LONG, PERCENT, BASE_AMOUNT, AMOUNT, SORT_ORDER, INCLUDE_BL, LPH_FILTER, BL_FILTER')
      .eq('FEE_CALC_MASTER_ID', calc.ID).eq('TENANT_ID', tenantId);
    if (surcharges?.length) {
      const surRows = surcharges.map(s => {
        let blFilter = s.BL_FILTER;
        if (blFilter && oldToNewBlId.size) {
          try { const ids = JSON.parse(blFilter); blFilter = JSON.stringify(ids.map(id => oldToNewBlId.get(id) ?? id)); } catch { /* keep */ }
        }
        return { ...s, BL_FILTER: blFilter, FEE_CALC_MASTER_ID: newCalc.ID, TENANT_ID: tenantId };
      });
      await supabase.from('FEE_CALCULATION_SURCHARGES').insert(surRows);
    }
  }

  return newOffer;
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  getOfferStatuses,
  listOffers,
  getOffer,
  createOffer,
  updateOffer,
  deleteOffer,
  getOfferStructure,
  addOfferStructureNode,
  updateOfferStructureNode,
  deleteOfferStructureNode,
  moveOfferStructureNode,
  recalcOfferRootSurcharges,
  attachFeeCalcToOfferStructure,
  buildOfferPdfViewModel,
  convertOfferToProject,
  copyOffer,
};
