'use strict';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
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

async function getOfferStatuses(supabase, { tenantId }) {
  const { data, error } = await supabase
    .from('OFFER_STATUS')
    .select('ID, NAME_SHORT')
    .or(`TENANT_ID.eq.${tenantId},TENANT_ID.is.null`)
    .order('ID', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function createOfferStatus(supabase, { tenantId, name_short }) {
  if (!name_short || typeof name_short !== 'string' || !name_short.trim()) {
    throw { status: 400, message: 'name_short ist erforderlich' };
  }
  const { data, error } = await supabase
    .from('OFFER_STATUS')
    .insert([{ NAME_SHORT: name_short.trim(), TENANT_ID: tenantId }])
    .select('ID, NAME_SHORT')
    .single();
  if (error) throw error;
  return data;
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

  const [statusRes, empRes, addrRes, contactRes, structRes, projectRes] = await Promise.all([
    statusIds.length  ? supabase.from('OFFER_STATUS').select('ID, NAME_SHORT').in('ID', statusIds) : Promise.resolve({ data: [] }),
    empIds.length     ? supabase.from('EMPLOYEE').select('ID, SHORT_NAME, FIRST_NAME, LAST_NAME').in('ID', empIds) : Promise.resolve({ data: [] }),
    addrIds.length    ? supabase.from('ADDRESS').select('ID, ADDRESS_NAME_1').in('ID', addrIds) : Promise.resolve({ data: [] }),
    contactIds.length ? supabase.from('CONTACT').select('ID, FIRST_NAME, LAST_NAME').in('ID', contactIds) : Promise.resolve({ data: [] }),
    supabase.from('OFFER_STRUCTURE').select('OFFER_ID, ID, FATHER_ID, REVENUE, EXTRAS').in('OFFER_ID', offerIds),
    projectIds.length ? supabase.from('PROJECT').select('ID, NAME_SHORT').in('ID', projectIds) : Promise.resolve({ data: [] }),
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

  const { data, error } = await supabase
    .from('OFFER')
    .update(patch)
    .eq('ID', offerId)
    .eq('TENANT_ID', tenantId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
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
      REVENUE:         revenue,
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
  return data;
}

async function updateOfferStructureNode(supabase, { tenantId, nodeId, body }) {
  const b       = body || {};
  const btId    = b.billing_type_id != null ? parseInt(String(b.billing_type_id), 10) : undefined;
  const isHourly = btId === 2;
  const patch   = {};

  if (b.name_short    !== undefined) patch.NAME_SHORT    = String(b.name_short).trim();
  if (b.name_long     !== undefined) patch.NAME_LONG     = String(b.name_long).trim();
  if (btId            !== undefined) patch.BILLING_TYPE_ID = btId;
  if (b.extras_percent !== undefined) patch.EXTRAS_PERCENT = Number(b.extras_percent) || 0;
  if (b.role_name_short !== undefined) patch.ROLE_NAME_SHORT = b.role_name_short || null;
  if (b.role_name_long  !== undefined) patch.ROLE_NAME_LONG  = b.role_name_long  || null;
  if (b.role_id         !== undefined) patch.ROLE_ID = b.role_id ? parseInt(String(b.role_id), 10) : null;

  // Recalculate revenue and extras
  if (isHourly || (btId === undefined && b.quantity !== undefined)) {
    const q = Number(b.quantity  ?? 0);
    const r = Number(b.sp_rate   ?? 0);
    patch.QUANTITY = q;
    patch.SP_RATE  = r;
    patch.REVENUE  = fmt2(q * r);
  } else if (b.revenue !== undefined) {
    patch.REVENUE = fmt2(Number(b.revenue));
  }

  // Recalculate extras from current or new values
  if (patch.REVENUE !== undefined || patch.EXTRAS_PERCENT !== undefined) {
    const { data: current } = await supabase.from('OFFER_STRUCTURE').select('REVENUE, EXTRAS_PERCENT').eq('ID', nodeId).maybeSingle();
    const rev  = patch.REVENUE        ?? Number(current?.REVENUE || 0);
    const pct  = patch.EXTRAS_PERCENT ?? Number(current?.EXTRAS_PERCENT || 0);
    patch.EXTRAS = fmt2(rev * pct / 100);
  }

  const { data, error } = await supabase
    .from('OFFER_STRUCTURE')
    .update(patch)
    .eq('ID', nodeId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function deleteOfferStructureNode(supabase, { nodeId }) {
  // Delete children first (one level — for deeper trees, caller should handle)
  await supabase.from('OFFER_STRUCTURE').delete().eq('FATHER_ID', nodeId);
  const { error } = await supabase.from('OFFER_STRUCTURE').delete().eq('ID', nodeId);
  if (error) throw error;
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

  // Aggregate totals (leaf nodes only — nodes without children)
  const withChildren = new Set((structRows || []).map(r => r.FATHER_ID).filter(Boolean));
  const leaves = (structRows || []).filter(r => !withChildren.has(r.ID));
  const totalRevenue = leaves.reduce((s, r) => s + (Number(r.REVENUE)  || 0), 0);
  const totalExtras  = leaves.reduce((s, r) => s + (Number(r.EXTRAS)   || 0), 0);
  const totalNet     = fmt2(totalRevenue + totalExtras);

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
      id:         n.ID,
      depth,
      nameShort:  n.NAME_SHORT  || '',
      nameLong:   n.NAME_LONG   || '',
      btId:       Number(n.BILLING_TYPE_ID),
      isHourly:   Number(n.BILLING_TYPE_ID) === 2,
      quantity:   Number(n.QUANTITY    || 0),
      spRate:     Number(n.SP_RATE     || 0),
      revenue:    Number(n.REVENUE     || 0),
      extrasPct:  Number(n.EXTRAS_PERCENT || 0),
      extras:     Number(n.EXTRAS      || 0),
      total:      fmt2(Number(n.REVENUE || 0) + Number(n.EXTRAS || 0)),
      roleName:   n.ROLE_NAME_LONG  || n.ROLE_NAME_SHORT || '',
    })),
    totals: {
      revenue:    fmt2(totalRevenue),
      extras:     fmt2(totalExtras),
      total:      totalNet,
    },
    text1: offer.OFFER_TEXT_1 || '',
    text2: offer.OFFER_TEXT_2 || '',
  };
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

  // Insert PROJECT
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
      REVENUE:          isBt1 ? fmt2(Number(n.REVENUE || 0)) : 0,
      EXTRAS_PERCENT:   Number(n.EXTRAS_PERCENT || 0),
      EXTRAS:           isBt1 ? fmt2(Number(n.EXTRAS  || 0)) : 0,
      COSTS:            0,
      REVENUE_COMPLETION_PERCENT: 0,
      EXTRAS_COMPLETION_PERCENT:  0,
      REVENUE_COMPLETION: 0,
      EXTRAS_COMPLETION:  0,
      TENANT_ID:        tenantId,
    }; });

    const { data: createdNodes, error: psErr } = await supabase
      .from('PROJECT_STRUCTURE')
      .insert(insertRows)
      .select('ID');
    if (psErr) throw { status: 500, message: 'Projektstruktur konnte nicht angelegt werden: ' + psErr.message };

    // Map old offer structure ID → new project structure ID
    const offerIdToNew = new Map();
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

  return { project, projectName: project.NAME_SHORT };
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  getOfferStatuses,
  createOfferStatus,
  listOffers,
  getOffer,
  createOffer,
  updateOffer,
  deleteOffer,
  getOfferStructure,
  addOfferStructureNode,
  updateOfferStructureNode,
  deleteOfferStructureNode,
  buildOfferPdfViewModel,
  convertOfferToProject,
};
