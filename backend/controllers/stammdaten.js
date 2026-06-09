"use strict";

const fs   = require("fs");
const path = require("path");
const svc  = require("../services/stammdaten");

// Reichert FEE_CALCULATION_MASTER-Rows um BASE_TYPE aus FEE_MASTERS an.
// Fällt auf 'cost_eur' (= bisheriges Verhalten) zurück, wenn Migration
// 0054 noch nicht gelaufen ist und die Spalte noch nicht existiert.
async function enrichBaseType(supabase, rows) {
  const arr = Array.isArray(rows) ? rows : [rows];
  const ids = [...new Set(arr.map(r => r?.FEE_MASTER_ID).filter(Boolean))];
  let map = new Map();
  if (ids.length) {
    const { data: masters, error } = await supabase
      .from("FEE_MASTERS").select("ID, BASE_TYPE").in("ID", ids);
    if (!error) {
      map = new Map((masters || []).map(m => [m.ID, m.BASE_TYPE || 'cost_eur']));
    }
  }
  const enrich = (r) => ({ ...r, BASE_TYPE: (r?.FEE_MASTER_ID && map.get(r.FEE_MASTER_ID)) || 'cost_eur' });
  return Array.isArray(rows) ? arr.map(enrich) : enrich(rows);
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/status
// ---------------------------------------------------------------------------
async function postStatus(req, res, supabase) {
  const name_short = req.body.name_short;
  if (!name_short || typeof name_short !== "string") return res.status(400).json({ error: "name_short is required" });
  const { data, error } = await supabase.from("PROJECT_STATUS").insert([{ NAME_SHORT: name_short }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/typ
// ---------------------------------------------------------------------------
async function postTyp(req, res, supabase) {
  const name_short = req.body.name_short;
  if (!name_short || typeof name_short !== "string") return res.status(400).json({ error: "name_short is required" });
  const { data, error } = await supabase.from("PROJECT_TYPE").insert([{ NAME_SHORT: name_short, TENANT_ID: req.tenantId }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/department
// ---------------------------------------------------------------------------
async function postDepartment(req, res, supabase) {
  const name_short = req.body.name_short;
  if (!name_short || typeof name_short !== "string") return res.status(400).json({ error: "name_short is required" });
  const { data, error } = await supabase.from("DEPARTMENT").insert([{ NAME_SHORT: name_short, TENANT_ID: req.tenantId }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/countries
// ---------------------------------------------------------------------------
async function getCountries(req, res, supabase) {
  const { data, error } = await supabase.from("COUNTRY").select("ID, NAME_SHORT, NAME_LONG").order("NAME_LONG", { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/billing-types
// ---------------------------------------------------------------------------
async function getBillingTypes(req, res, supabase) {
  const { data, error } = await supabase.from("BILLING_TYPE").select("ID, BILLING_TYPE").order("BILLING_TYPE", { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  const mapped = (data || []).map(r => ({ ID: r.ID, NAME_SHORT: r.BILLING_TYPE, NAME_LONG: null }));
  res.json({ data: mapped });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/fee-groups
// ---------------------------------------------------------------------------
async function getFeeGroups(req, res, supabase) {
  const { data, error } = await supabase.from("FEE_GROUPS").select("ID, NAME_SHORT, NAME_LONG").order("NAME_SHORT", { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/fee-masters
// ---------------------------------------------------------------------------
async function getFeeMasters(req, res, supabase) {
  const feeGroupIdRaw = (req.query.fee_group_id || "").toString().trim();
  const feeGroupId = feeGroupIdRaw ? Number.parseInt(feeGroupIdRaw, 10) : null;
  if (feeGroupIdRaw && Number.isNaN(feeGroupId)) return res.status(400).json({ error: "fee_group_id must be a number" });

  let query = supabase.from("FEE_MASTERS").select("ID, NAME_SHORT, NAME_LONG, FEE_GROUP_ID, BASE_TYPE").order("NAME_SHORT", { ascending: true, nullsFirst: false });
  if (feeGroupId !== null) query = query.eq("FEE_GROUP_ID", feeGroupId);

  let { data, error } = await query;
  if (error) {
    // Fallback wenn Migration 0054 noch nicht gelaufen ist — BASE_TYPE
    // existiert dann nicht und Select wirft. Wir liefern dann ohne den
    // Flag aus und Default ist 'cost_eur' (bisheriges Verhalten).
    let fb = supabase.from("FEE_MASTERS")
      .select("ID, NAME_SHORT, NAME_LONG, FEE_GROUP_ID")
      .order("NAME_SHORT", { ascending: true, nullsFirst: false });
    if (feeGroupId !== null) fb = fb.eq("FEE_GROUP_ID", feeGroupId);
    const fallback = await fb;
    if (fallback.error) return res.status(500).json({ error: fallback.error.message });
    data = (fallback.data || []).map(r => ({ ...r, BASE_TYPE: 'cost_eur' }));
  }
  res.json({ data });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/fee-zones
// ---------------------------------------------------------------------------
async function getFeeZones(req, res, supabase) {
  const feeMasterIdRaw = (req.query.fee_master_id || "").toString().trim();
  const feeMasterId = feeMasterIdRaw ? Number.parseInt(feeMasterIdRaw, 10) : null;
  if (!feeMasterId) return res.status(400).json({ error: "fee_master_id is required" });

  const { data, error } = await supabase.from("FEE_ZONES").select("ID, NAME_SHORT, NAME_LONG, FEE_MASTER_ID").eq("FEE_MASTER_ID", feeMasterId).order("NAME_SHORT", { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data || [] });
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/fee-calculation-masters/init
// ---------------------------------------------------------------------------
async function postFeeCalcMasterInit(req, res, supabase) {
  const feeMasterIdRaw = (req.body?.fee_master_id ?? "").toString().trim();
  const feeMasterId = feeMasterIdRaw ? Number.parseInt(feeMasterIdRaw, 10) : null;
  if (!feeMasterId) return res.status(400).json({ error: "fee_master_id is required" });

  const { data: feeMaster, error: fmErr } = await supabase.from("FEE_MASTERS").select("ID, NAME_SHORT, NAME_LONG").eq("ID", feeMasterId).single();
  if (fmErr) return res.status(500).json({ error: fmErr.message });
  if (!feeMaster) return res.status(404).json({ error: "FEE_MASTER not found" });

  const offerIdRaw = (req.body?.offer_id ?? "").toString().trim();
  const offerId = offerIdRaw ? Number.parseInt(offerIdRaw, 10) : null;
  const projectIdRaw = (req.body?.project_id ?? "").toString().trim();
  const projectId = projectIdRaw ? Number.parseInt(projectIdRaw, 10) : null;

  // DB-Constraint chk_fee_calc_master_source verlangt PROJECT_ID oder
  // OFFER_ID beim Insert — sonst kommt ein 23514-Check-Violation-Error.
  if (!offerId && !projectId) {
    return res.status(400).json({ error: "project_id oder offer_id ist erforderlich" });
  }

  const { data, error } = await supabase
    .from("FEE_CALCULATION_MASTER")
    .insert([{
      FEE_MASTER_ID: feeMasterId,
      NAME_SHORT:    feeMaster.NAME_SHORT || null,
      NAME_LONG:     feeMaster.NAME_LONG  || null,
      TENANT_ID:     req.tenantId ?? null,
      ...(offerId   ? { OFFER_ID:   offerId   } : {}),
      ...(projectId ? { PROJECT_ID: projectId } : {}),
    }])
    .select("*")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  const enriched = await enrichBaseType(supabase, data);
  res.json({ data: enriched });
}

// ---------------------------------------------------------------------------
// PATCH /api/stammdaten/fee-calculation-masters/:id/basis
// ---------------------------------------------------------------------------
async function patchFeeCalcMasterBasis(req, res, supabase) {
  const idRaw = (req.params.id || "").toString().trim();
  const id = idRaw ? Number.parseInt(idRaw, 10) : null;
  if (!id) return res.status(400).json({ error: "id is required" });

  try {
    const { data: existing, error: existingErr } = await supabase
      .from("FEE_CALCULATION_MASTER")
      .select("ID, FEE_MASTER_ID, ZONE_ID, ZONE_PERCENT, CONSTRUCTION_COSTS_K0, CONSTRUCTION_COSTS_K1, CONSTRUCTION_COSTS_K2, CONSTRUCTION_COSTS_K3, CONSTRUCTION_COSTS_K4")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .single();
    if (existingErr) return res.status(500).json({ error: existingErr.message });
    if (!existing) return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });

    const body = req.body || {};

    // Fall back to existing values for any cost/zone fields not in the request body
    const costsByKey = {
      CONSTRUCTION_COSTS_K0: 'CONSTRUCTION_COSTS_K0' in body ? (body.CONSTRUCTION_COSTS_K0 ?? null) : existing.CONSTRUCTION_COSTS_K0,
      CONSTRUCTION_COSTS_K1: 'CONSTRUCTION_COSTS_K1' in body ? (body.CONSTRUCTION_COSTS_K1 ?? null) : existing.CONSTRUCTION_COSTS_K1,
      CONSTRUCTION_COSTS_K2: 'CONSTRUCTION_COSTS_K2' in body ? (body.CONSTRUCTION_COSTS_K2 ?? null) : existing.CONSTRUCTION_COSTS_K2,
      CONSTRUCTION_COSTS_K3: 'CONSTRUCTION_COSTS_K3' in body ? (body.CONSTRUCTION_COSTS_K3 ?? null) : existing.CONSTRUCTION_COSTS_K3,
      CONSTRUCTION_COSTS_K4: 'CONSTRUCTION_COSTS_K4' in body ? (body.CONSTRUCTION_COSTS_K4 ?? null) : existing.CONSTRUCTION_COSTS_K4,
    };

    const effectiveZoneId = 'ZONE_ID' in body ? body.ZONE_ID : existing.ZONE_ID;
    const effectiveZonePercent = 'ZONE_PERCENT' in body ? body.ZONE_PERCENT : existing.ZONE_PERCENT;
    const revenueFields = await svc.calculateRevenueFields(supabase, { feeMasterId: existing.FEE_MASTER_ID, zoneId: effectiveZoneId, zonePercent: effectiveZonePercent, costsByKey });

    // Only include fields that were explicitly provided in the request body
    const costUpdates = Object.fromEntries(
      ['CONSTRUCTION_COSTS_K0','CONSTRUCTION_COSTS_K1','CONSTRUCTION_COSTS_K2','CONSTRUCTION_COSTS_K3','CONSTRUCTION_COSTS_K4']
        .filter(k => k in body)
        .map(k => [k, costsByKey[k]])
    );

    const { data, error } = await supabase
      .from("FEE_CALCULATION_MASTER")
      .update({
        ...('NAME_SHORT'                   in body ? { NAME_SHORT:                   body.NAME_SHORT                   ?? null } : {}),
        ...('NAME_LONG'                    in body ? { NAME_LONG:                    body.NAME_LONG                    ?? null } : {}),
        ...('PROJECT_ID'                   in body ? { PROJECT_ID:                   body.PROJECT_ID                   ?? null } : {}),
        ...('OFFER_ID'                     in body ? { OFFER_ID:                     body.OFFER_ID                     ?? null } : {}),
        ...('ATTACH_TO_OFFER_STRUCTURE_ID' in body ? { ATTACH_TO_OFFER_STRUCTURE_ID: body.ATTACH_TO_OFFER_STRUCTURE_ID ?? null } : {}),
        ...('ZONE_ID'                      in body ? { ZONE_ID:                      body.ZONE_ID                      ?? null } : {}),
        ...('ZONE_PERCENT'                 in body ? { ZONE_PERCENT:                 body.ZONE_PERCENT                 ?? null } : {}),
        ...costUpdates,
        ...revenueFields,
      })
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .select("*")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/fee-calculation-masters/:id/phases/init
// ---------------------------------------------------------------------------
async function postFeeCalcPhasesInit(req, res, supabase) {
  const idRaw = (req.params.id || "").toString().trim();
  const id = idRaw ? Number.parseInt(idRaw, 10) : null;
  if (!id) return res.status(400).json({ error: "id is required" });

  try {
    const { data: calcMaster, error: calcErr } = await supabase
      .from("FEE_CALCULATION_MASTER")
      .select("ID, FEE_MASTER_ID, REVENUE_K0, REVENUE_K1, REVENUE_K2, REVENUE_K3, REVENUE_K4, TENANT_ID")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .single();
    if (calcErr) return res.status(500).json({ error: calcErr.message });
    if (!calcMaster) return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });

    const { data: existingRows, error: existingErr } = await supabase.from("FEE_CALCULATION_PHASE").select("ID").eq("FEE_MASTER_ID", id).limit(1);
    if (existingErr) return res.status(500).json({ error: existingErr.message });

    if (!existingRows || existingRows.length === 0) {
      const { data: feePhases, error: feePhaseErr } = await supabase.from("FEE_PHASE").select("ID, NAME_SHORT, NAME_LONG, FEE_PERCENT").eq("FEE_MASTER_ID", calcMaster.FEE_MASTER_ID).order("ID", { ascending: true });
      if (feePhaseErr) return res.status(500).json({ error: feePhaseErr.message });

      const revenueBase = svc.getRevenueByKx(calcMaster, "K0");
      const insertRows = (feePhases || []).map((phase) => ({
        FEE_MASTER_ID: id,
        FEE_PHASE_ID: phase.ID,
        FEE_PERCENT_BASE: phase.FEE_PERCENT ?? null,
        KX: "K0",
        REVENUE_BASE: revenueBase,
        FEE_PERCENT: phase.FEE_PERCENT ?? null,
        PHASE_REVENUE: svc.calculatePhaseRevenue(phase.FEE_PERCENT ?? null, revenueBase),
        TENANT_ID: calcMaster.TENANT_ID ?? null,
      }));

      if (insertRows.length) {
        const { error: insertErr } = await supabase.from("FEE_CALCULATION_PHASE").insert(insertRows);
        if (insertErr) return res.status(500).json({ error: insertErr.message });
      }
    }

    const rows = await svc.loadPhaseRowsWithLabels(supabase, id);
    return res.json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/stammdaten/fee-calculation-phases/:id
// ---------------------------------------------------------------------------
async function patchFeeCalcPhase(req, res, supabase) {
  const idRaw = (req.params.id || "").toString().trim();
  const id = idRaw ? Number.parseInt(idRaw, 10) : null;
  if (!id) return res.status(400).json({ error: "id is required" });

  try {
    const { data: phaseRow, error: phaseErr } = await supabase.from("FEE_CALCULATION_PHASE").select("ID, FEE_MASTER_ID, FEE_PHASE_ID, FEE_PERCENT_BASE").eq("ID", id).single();
    if (phaseErr) return res.status(500).json({ error: phaseErr.message });
    if (!phaseRow) return res.status(404).json({ error: "FEE_CALCULATION_PHASE not found" });

    const { data: calcMaster, error: calcErr } = await supabase.from("FEE_CALCULATION_MASTER").select("ID, REVENUE_K0, REVENUE_K1, REVENUE_K2, REVENUE_K3, REVENUE_K4").eq("ID", phaseRow.FEE_MASTER_ID).single();
    if (calcErr) return res.status(500).json({ error: calcErr.message });
    if (!calcMaster) return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });

    const body = req.body || {};
    const kx = String(body.KX || "K0").trim().toUpperCase();
    const revenueBase = svc.getRevenueByKx(calcMaster, kx);
    const feePercent = body.FEE_PERCENT ?? null;
    const phaseRevenue = svc.calculatePhaseRevenue(feePercent, revenueBase);

    const { data, error } = await supabase
      .from("FEE_CALCULATION_PHASE")
      .update({ KX: kx, REVENUE_BASE: revenueBase, FEE_PERCENT: feePercent, PHASE_REVENUE: phaseRevenue })
      .eq("ID", id)
      .select("ID, FEE_MASTER_ID, FEE_PHASE_ID, FEE_PERCENT_BASE, KX, REVENUE_BASE, FEE_PERCENT, PHASE_REVENUE")
      .single();
    if (error) return res.status(500).json({ error: error.message });

    const rows = await svc.loadPhaseRowsWithLabels(supabase, phaseRow.FEE_MASTER_ID);
    const enriched = rows.find((r) => r.ID === id) || data;
    return res.json({ data: enriched });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/fee-calculation-masters/:id/phases/save
// ---------------------------------------------------------------------------
async function postFeeCalcPhasesSave(req, res, supabase) {
  const idRaw = (req.params.id || "").toString().trim();
  const id = idRaw ? Number.parseInt(idRaw, 10) : null;
  if (!id) return res.status(400).json({ error: "id is required" });

  try {
    const rowsInput = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rowsInput.length) {
      const rows = await svc.loadPhaseRowsWithLabels(supabase, id);
      return res.json({ data: rows });
    }

    const { data: calcMaster, error: calcErr } = await supabase.from("FEE_CALCULATION_MASTER").select("ID, REVENUE_K0, REVENUE_K1, REVENUE_K2, REVENUE_K3, REVENUE_K4").eq("ID", id).eq("TENANT_ID", req.tenantId).single();
    if (calcErr) return res.status(500).json({ error: calcErr.message });
    if (!calcMaster) return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });

    const { data: existingRows, error: rowsErr } = await supabase.from("FEE_CALCULATION_PHASE").select("ID, FEE_MASTER_ID").eq("FEE_MASTER_ID", id);
    if (rowsErr) return res.status(500).json({ error: rowsErr.message });

    const allowedIds = new Set((existingRows || []).map((row) => Number(row.ID)));
    const updates = rowsInput
      .map((row) => ({
        id: Number.parseInt(String(row?.ID || ""), 10),
        kx: String(row?.KX || "K0").trim().toUpperCase(),
        feePercent: row?.FEE_PERCENT ?? null,
      }))
      .filter((row) => Number.isFinite(row.id) && allowedIds.has(row.id));

    await Promise.all(
      updates.map(async (row) => {
        const revenueBase = svc.getRevenueByKx(calcMaster, row.kx);
        const phaseRevenue = svc.calculatePhaseRevenue(row.feePercent, revenueBase);
        const { error: updateErr } = await supabase
          .from("FEE_CALCULATION_PHASE")
          .update({ KX: row.kx, REVENUE_BASE: revenueBase, FEE_PERCENT: row.feePercent, PHASE_REVENUE: phaseRevenue })
          .eq("ID", row.id)
          .eq("FEE_MASTER_ID", id);
        if (updateErr) throw new Error(updateErr.message);
      })
    );

    const rows = await svc.loadPhaseRowsWithLabels(supabase, id);
    return res.json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/stammdaten/fee-calculation-masters/:id
// ---------------------------------------------------------------------------
async function deleteFeeCalcMaster(req, res, supabase) {
  const idRaw = (req.params.id || "").toString().trim();
  const id = idRaw ? Number.parseInt(idRaw, 10) : null;
  if (!id) return res.status(400).json({ error: "id is required" });

  try {
    const { error: phaseErr } = await supabase.from("FEE_CALCULATION_PHASE").delete().eq("FEE_MASTER_ID", id);
    if (phaseErr) return res.status(500).json({ error: phaseErr.message });
    const { error: masterErr } = await supabase.from("FEE_CALCULATION_MASTER").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (masterErr) return res.status(500).json({ error: masterErr.message });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/fee-calculation-masters/:id/add-to-project-structure
// ---------------------------------------------------------------------------
async function postFeeCalcAddToStructure(req, res, supabase) {
  const idRaw = (req.params.id || "").toString().trim();
  const id = idRaw ? Number.parseInt(idRaw, 10) : null;
  const fatherIdRaw = (req.body?.father_id ?? "").toString().trim();
  const fatherId = fatherIdRaw ? Number.parseInt(fatherIdRaw, 10) : null;
  if (!id) return res.status(400).json({ error: "id is required" });
  if (!fatherId) return res.status(400).json({ error: "father_id is required" });

  try {
    const { data: calcMaster, error: calcErr } = await supabase.from("FEE_CALCULATION_MASTER").select("ID, PROJECT_ID").eq("ID", id).eq("TENANT_ID", req.tenantId).single();
    if (calcErr) return res.status(500).json({ error: calcErr.message });
    if (!calcMaster) return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });
    if (!calcMaster.PROJECT_ID) return res.status(400).json({ error: "Für die Honorarberechnung ist kein Projekt ausgewählt." });

    const [
      { data: project, error: projectErr },
      { data: father, error: fatherErr },
      { data: calcPhases, error: calcPhasesErr },
    ] = await Promise.all([
      supabase.from("PROJECT").select("ID, TENANT_ID").eq("ID", calcMaster.PROJECT_ID).single(),
      supabase.from("PROJECT_STRUCTURE").select("ID, PROJECT_ID, NAME_SHORT, NAME_LONG, EXTRAS_PERCENT").eq("ID", fatherId).single(),
      supabase.from("FEE_CALCULATION_PHASE").select("ID, FEE_PHASE_ID, FEE_PERCENT, PHASE_REVENUE").eq("FEE_MASTER_ID", id).order("FEE_PHASE_ID", { ascending: true }),
    ]);
    if (fatherErr) return res.status(500).json({ error: fatherErr.message });
    if (!father) return res.status(404).json({ error: "Übergeordnetes Projektelement nicht gefunden" });
    if (String(father.PROJECT_ID) !== String(calcMaster.PROJECT_ID)) return res.status(400).json({ error: "Das übergeordnete Projektelement gehört nicht zum ausgewählten Projekt." });

    // Check parent for billing/payment data (Option 2 = block; Option 1 = needs confirmation)
    const parentCheck = await require('../services/projekte').checkParentForChild(supabase, { parentId: fatherId });
    if (parentCheck.status === 'blocked') {
      return res.status(409).json({ error: parentCheck.reason });
    }
    const confirmed = req.body?.confirmed === true;
    if (parentCheck.status === 'needs_transfer' && !confirmed) {
      return res.status(409).json({ error: 'needs_transfer', needsTransfer: true, hasTec: parentCheck.hasTec, parentValues: parentCheck.parentValues });
    }
    if (projectErr) return res.status(500).json({ error: projectErr.message });
    if (!project) return res.status(404).json({ error: "Projekt nicht gefunden" });
    if (calcPhasesErr) return res.status(500).json({ error: calcPhasesErr.message });
    if (!Array.isArray(calcPhases) || calcPhases.length === 0) return res.status(400).json({ error: "Es sind keine Leistungsphasen zum Übertragen vorhanden." });

    // Skip phases with 0% and 0 € — they carry no value and clutter the structure
    const activePhases = calcPhases.filter(row => (Number(row.PHASE_REVENUE) || 0) !== 0 || (Number(row.FEE_PERCENT) || 0) !== 0);
    if (activePhases.length === 0) return res.status(400).json({ error: "Alle Leistungsphasen haben 0 % und 0 € — bitte Honorarwerte eintragen." });

    const phaseIds = Array.from(new Set(activePhases.map((row) => row.FEE_PHASE_ID).filter(Boolean)));
    const { data: phaseDefs, error: phaseDefsErr } = await supabase.from("FEE_PHASE").select("ID, NAME_SHORT, NAME_LONG").in("ID", phaseIds);
    if (phaseDefsErr) return res.status(500).json({ error: phaseDefsErr.message });
    const phaseMap = new Map((phaseDefs || []).map((row) => [row.ID, row]));

    const extrasPercent = Number(father.EXTRAS_PERCENT ?? 0) || 0;

    // Load surcharges + BL items to compute per-phase and per-BL allocation (soft-fail)
    let lphAlloc = {}, blAlloc = {};
    let blItemsForStructure = [];
    let existingBlStructMap = new Map();
    try {
      const [blItemsRes, surchargeRowsRes, existingBlStructRes] = await Promise.all([
        supabase.from("FEE_CALCULATION_BL").select("ID, NAME_SHORT, NAME, AMOUNT")
          .eq("FEE_CALC_MASTER_ID", id).order("SORT_ORDER", { ascending: true }),
        supabase.from("FEE_CALCULATION_SURCHARGES").select("AMOUNT, LPH_FILTER, BL_FILTER")
          .eq("FEE_CALC_MASTER_ID", id).eq("TENANT_ID", req.tenantId).order("SORT_ORDER", { ascending: true }),
        supabase.from("PROJECT_STRUCTURE").select("ID, FEE_CALC_BL_ID")
          .eq("FEE_CALC_MASTER_ID", id).eq("TENANT_ID", req.tenantId).not("FEE_CALC_BL_ID", "is", null),
      ]);
      blItemsForStructure = blItemsRes.data || [];
      existingBlStructMap = new Map((existingBlStructRes.data || []).map(r => [r.FEE_CALC_BL_ID, r.ID]));
      const allocs = computeSurchargeAllocations(activePhases, surchargeRowsRes.data || [], blItemsForStructure);
      lphAlloc = allocs.lphAlloc;
      blAlloc  = allocs.blAlloc;
    } catch (allocErr) {
      console.warn('[Surcharge alloc] Soft-fail (migration may not be run):', allocErr?.message);
    }

    // Build LPH structure rows (base revenue + surcharge share for this phase)
    const insertRows = activePhases.map((row) => {
      const phaseDef = phaseMap.get(row.FEE_PHASE_ID) || {};
      const baseRevenue = Number(row.PHASE_REVENUE ?? 0) || 0;
      const surchargeShare = lphAlloc[row.ID] || 0;
      const revenue = Math.round((baseRevenue + surchargeShare) * 100) / 100;
      const extras  = Math.round((revenue * extrasPercent) / 100 * 100) / 100;
      return {
        NAME_SHORT: phaseDef.NAME_SHORT || `LPH ${row.FEE_PHASE_ID}`,
        NAME_LONG: phaseDef.NAME_LONG || null,
        REVENUE: revenue, EXTRAS: extras, COSTS: 0,
        PROJECT_ID: calcMaster.PROJECT_ID, FATHER_ID: fatherId,
        EXTRAS_PERCENT: extrasPercent, BILLING_TYPE_ID: 1,
        TENANT_ID: project.TENANT_ID,
        REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0,
        REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
        FEE_CALC_MASTER_ID: id,
        FEE_CALC_PHASE_ID:  row.ID,
      };
    });

    const { data: createdRows, error: createErr } = await supabase.from("PROJECT_STRUCTURE").insert(insertRows).select("*");
    if (createErr) return res.status(500).json({ error: createErr.message });

    // Upsert BL items as PROJECT_STRUCTURE rows (update existing, insert missing — avoids duplicates on re-finalize)
    try {
      if (blItemsForStructure.length) {
        const blToInsert = [];
        for (const bl of blItemsForStructure) {
          const blSurchargeShare = blAlloc[bl.ID] || 0;
          const blRevenue = Math.round(((Number(bl.AMOUNT) || 0) + blSurchargeShare) * 100) / 100;
          const extras    = Math.round((blRevenue * extrasPercent) / 100 * 100) / 100;
          if (existingBlStructMap.has(bl.ID)) {
            const existingId = existingBlStructMap.get(bl.ID);
            await supabase.from("PROJECT_STRUCTURE")
              .update({ REVENUE: blRevenue, EXTRAS: extras, NAME_SHORT: bl.NAME_SHORT || null, NAME_LONG: bl.NAME || null })
              .eq("ID", existingId).eq("TENANT_ID", project.TENANT_ID);
          } else {
            blToInsert.push({
              NAME_SHORT: bl.NAME_SHORT || null,
              NAME_LONG: bl.NAME || null,
              REVENUE: blRevenue, EXTRAS: extras, COSTS: 0,
              PROJECT_ID: calcMaster.PROJECT_ID, FATHER_ID: fatherId,
              EXTRAS_PERCENT: extrasPercent, BILLING_TYPE_ID: 1,
              TENANT_ID: project.TENANT_ID,
              REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0,
              REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
              FEE_CALC_MASTER_ID: id,
              FEE_CALC_BL_ID: bl.ID,
            });
          }
        }
        if (blToInsert.length) {
          const { data: createdBlRows, error: blCreateErr } = await supabase.from("PROJECT_STRUCTURE").insert(blToInsert).select("*");
          if (blCreateErr) {
            console.warn('[BL structure] Insert failed (migration 0043 may not be run):', blCreateErr.message);
          } else {
            const blProgressRows = (createdBlRows || []).map(svc.buildProjectProgressRow);
            if (blProgressRows.length) await supabase.from("PROJECT_PROGRESS").insert(blProgressRows).catch(() => {});
          }
        }
      }
    } catch (blErr) {
      console.warn('[BL structure] Soft-fail:', blErr?.message || String(blErr));
    }

    try {
      const progressRows = (createdRows || []).map(svc.buildProjectProgressRow);
      if (progressRows.length) {
        const { error: progressErr } = await supabase.from("PROJECT_PROGRESS").insert(progressRows);
        if (progressErr) return res.status(500).json({ error: "Projektstruktur angelegt, aber PROJECT_PROGRESS fehlgeschlagen: " + progressErr.message });
      }
    } catch (progressOuterErr) {
      return res.status(500).json({ error: progressOuterErr?.message || String(progressOuterErr) });
    }

    let movedTecCount = 0, movedToName = "";
    const firstCreated = Array.isArray(createdRows) && createdRows.length ? createdRows[0] : null;
    if (firstCreated) {
      const { data: movedTecRows, error: moveErr } = await supabase.from("TEC").update({ STRUCTURE_ID: firstCreated.ID }).eq("STRUCTURE_ID", fatherId).select("ID");
      if (moveErr) return res.status(500).json({ error: moveErr.message });
      movedTecCount = Array.isArray(movedTecRows) ? movedTecRows.length : 0;
      if (movedTecCount > 0) {
        await Promise.all([svc.recomputeStructureAggregates(supabase, fatherId), svc.recomputeStructureAggregates(supabase, firstCreated.ID)]);
        movedToName = [firstCreated.NAME_SHORT, firstCreated.NAME_LONG].filter(Boolean).join(": ");
      }
    }

    const fatherName = [father.NAME_SHORT, father.NAME_LONG].filter(Boolean).join(": ");
    const message = movedTecCount > 0
      ? `${createdRows.length} Elemente wurden angelegt. ${movedTecCount} Buchungen wurden von ${fatherName || `#${fatherId}`} nach ${movedToName || `#${firstCreated?.ID}`} verschoben.`
      : `${createdRows.length} Elemente wurden angelegt.`;

    return res.json({ success: true, data: createdRows || [], moved_tec_count: movedTecCount, message });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/fee-calculation-masters/:id/add-to-offer-structure
// ---------------------------------------------------------------------------
async function postFeeCalcAddToOfferStructure(req, res, supabase) {
  const id       = parseInt(req.params.id, 10);
  const fatherId = parseInt(req.body?.father_id, 10);
  if (!id)       return res.status(400).json({ error: 'id is required' });
  if (!fatherId) return res.status(400).json({ error: 'father_id is required' });
  try {
    const { data: calcMaster, error: calcErr } = await supabase
      .from('FEE_CALCULATION_MASTER').select('ID, OFFER_ID').eq('ID', id).eq('TENANT_ID', req.tenantId).single();
    if (calcErr || !calcMaster) return res.status(404).json({ error: 'FEE_CALCULATION_MASTER nicht gefunden' });

    const { data: father, error: fatherErr } = await supabase
      .from('OFFER_STRUCTURE').select('ID, OFFER_ID').eq('ID', fatherId).maybeSingle();
    if (fatherErr) return res.status(500).json({ error: fatherErr.message });
    if (!father)   return res.status(404).json({ error: 'Übergeordnetes Angebotselement nicht gefunden' });

    const offerId = father.OFFER_ID;
    const { attachFeeCalcToOfferStructure } = require('../services/angebote');
    await attachFeeCalcToOfferStructure(supabase, { calcMasterId: id, fatherId, offerId, tenantId: req.tenantId });

    return res.json({ success: true, message: 'Angebotsstruktur wurde angelegt ✅' });
  } catch (err) {
    return res.status(err?.status || 500).json({ error: err?.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/companies
// ---------------------------------------------------------------------------
async function getCompanies(req, res, supabase) {
  const { data, error } = await supabase
    .from("COMPANY")
    .select("ID, COMPANY_NAME_1, COMPANY_NAME_2, STREET, POST_CODE, CITY, POST_OFFICE_BOX, COUNTRY_ID, TAX_NUMBER, \"TAX-ID\", BIC, IBAN, \"CREDITOR-ID\", PEPPOL_ENDPOINT_ID, PEPPOL_SCHEME_ID")
    .eq("TENANT_ID", req.tenantId)
    .order("COMPANY_NAME_1", { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

function buildCompanyRow(body) {
  const s = (v) => (typeof v === "string" ? v.trim() : "") || null;
  return {
    COMPANY_NAME_1:  (body.company_name_1 || "").trim(),
    COMPANY_NAME_2:  s(body.company_name_2),
    STREET:          s(body.street),
    POST_CODE:       s(body.post_code),
    CITY:            s(body.city),
    POST_OFFICE_BOX: s(body.post_office_box),
    COUNTRY_ID:      s(body.country_id),
    TAX_NUMBER:      s(body.tax_number),
    "TAX-ID":        s(body.tax_id),
    BIC:             s(body.bic),
    IBAN:            s(body.iban),
    "CREDITOR-ID":   s(body.creditor_id),
    // Branch 11: Peppol-Endpoint
    ...(body.peppol_endpoint_id !== undefined ? { PEPPOL_ENDPOINT_ID: s(body.peppol_endpoint_id) } : {}),
    ...(body.peppol_scheme_id   !== undefined ? { PEPPOL_SCHEME_ID:   s(body.peppol_scheme_id)   } : {}),
  };
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/company
// ---------------------------------------------------------------------------
async function postCompany(req, res, supabase) {
  const { company_name_1 } = req.body || {};
  if (!company_name_1 || typeof company_name_1 !== "string") return res.status(400).json({ error: "company_name_1 is required" });

  const row = { ...buildCompanyRow(req.body), TENANT_ID: req.tenantId ?? null };
  const { data, error } = await supabase.from("COMPANY").insert([row]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// PUT /api/stammdaten/company/:id
// ---------------------------------------------------------------------------
async function putCompany(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: "Invalid company id" });
  const { company_name_1 } = req.body || {};
  if (!company_name_1 || typeof company_name_1 !== "string") return res.status(400).json({ error: "company_name_1 is required" });

  const { data, error } = await supabase
    .from("COMPANY")
    .update(buildCompanyRow(req.body))
    .eq("ID", id)
    .eq("TENANT_ID", req.tenantId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/address
// ---------------------------------------------------------------------------
async function postAddress(req, res, supabase) {
  const { address_name_1, address_name_2, street, post_code, city, post_office_box, country_id, customer_number, tax_id, buyer_reference, peppol_endpoint_id, peppol_scheme_id } = req.body || {};
  if (!address_name_1 || typeof address_name_1 !== "string") return res.status(400).json({ error: "address_name_1 is required" });

  const parsedCountryId = typeof country_id === "number" ? country_id : parseInt(country_id, 10);
  if (!parsedCountryId || Number.isNaN(parsedCountryId)) return res.status(400).json({ error: "country_id is required" });

  const insertRow = {
    ADDRESS_NAME_1: address_name_1.trim(),
    ADDRESS_NAME_2: (address_name_2 || "").trim() || null,
    STREET: (street || "").trim() || null,
    POST_CODE: (post_code || "").trim() || null,
    CITY: (city || "").trim() || null,
    POST_OFFICE_BOX: (post_office_box || "").trim() || null,
    COUNTRY_ID: parsedCountryId,
    CUSTOMER_NUMBER: (customer_number || "").trim() || null,
    "TAX-ID": (tax_id || "").trim() || null,
    BUYER_REFERENCE: (buyer_reference || "").trim() || null,
    TENANT_ID: req.tenantId ?? null,
  };
  if (peppol_endpoint_id !== undefined) insertRow.PEPPOL_ENDPOINT_ID = (peppol_endpoint_id || "").trim() || null;
  if (peppol_scheme_id   !== undefined) insertRow.PEPPOL_SCHEME_ID   = (peppol_scheme_id   || "").trim() || null;

  const { data, error } = await supabase.from("ADDRESS").insert([insertRow]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/rollen
// ---------------------------------------------------------------------------
async function postRollen(req, res, supabase) {
  const { name_short, name_long, sp_rate } = req.body || {};
  if (!name_short || typeof name_short !== "string") return res.status(400).json({ error: "name_short is required" });

  const insertRow = {
    NAME_SHORT: name_short.trim(),
    NAME_LONG:  (name_long || "").trim() || null,
    SP_RATE:    sp_rate !== undefined && sp_rate !== "" ? parseFloat(sp_rate) : null,
    TENANT_ID:  req.tenantId ?? null,
    ACTIVE:     1,
  };

  let data, error, usedTable;
  ({ data, error } = await supabase.from("ROLE").insert([insertRow]));
  usedTable = "ROLE";

  if (error) {
    const msg = String(error.message || "");
    if (msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("relation") || msg.toLowerCase().includes("not found")) {
      ({ data, error } = await supabase.from("ADDRESS").insert([insertRow]));
      usedTable = "ADDRESS";
    }
  }

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data, table: usedTable });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/salutations
// ---------------------------------------------------------------------------
async function getSalutations(req, res, supabase) {
  const { data, error } = await supabase.from("SALUTATION").select("ID, SALUTATION").order("SALUTATION", { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: (data || []).map((r) => ({ ID: r.ID, SALUTATION: r.SALUTATION ?? '' })) });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/genders
// ---------------------------------------------------------------------------
async function getGenders(req, res, supabase) {
  const { data, error } = await supabase.from("GENDER").select("ID, GENDER").order("GENDER", { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: (data || []).map((r) => ({ ID: r.ID, GENDER: r.GENDER ?? '' })) });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/addresses/search
// ---------------------------------------------------------------------------
async function searchAddresses(req, res, supabase) {
  const q = (req.query.q || "").toString().trim();
  if (!q || q.length < 2) return res.json({ data: [] });
  const { data, error } = await supabase.from("ADDRESS").select("ID, ADDRESS_NAME_1").eq("TENANT_ID", req.tenantId).ilike("ADDRESS_NAME_1", `%${q}%`).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/addresses/list
// ---------------------------------------------------------------------------
async function listAddresses(req, res, supabase) {
  const limit = Math.min(parseInt(req.query.limit || "2000", 10) || 2000, 5000);

  const { data: addresses, error: aErr } = await supabase
    .from("ADDRESS")
    .select('ID, ADDRESS_NAME_1, ADDRESS_NAME_2, STREET, POST_CODE, CITY, POST_OFFICE_BOX, COUNTRY_ID, CUSTOMER_NUMBER, "TAX-ID", BUYER_REFERENCE, PEPPOL_ENDPOINT_ID, PEPPOL_SCHEME_ID')
    .eq("TENANT_ID", req.tenantId)
    .order("ADDRESS_NAME_1", { ascending: true })
    .limit(limit);
  if (aErr) return res.status(500).json({ error: aErr.message });

  const { data: countries, error: cErr } = await supabase.from("COUNTRY").select("ID, NAME_LONG, NAME_SHORT").order("NAME_LONG", { ascending: true }).limit(5000);
  if (cErr) return res.status(500).json({ error: cErr.message });

  const countryMap = new Map((countries || []).map((c) => [String(c.ID), (c.NAME_LONG || c.NAME_SHORT || "").toString()]));
  const normalized = (addresses || []).map((r) => ({ ...r, TAX_ID: r["TAX-ID"] ?? null, COUNTRY: countryMap.get(String(r.COUNTRY_ID)) || "" }));
  res.json({ data: normalized });
}

// ---------------------------------------------------------------------------
// PATCH /api/stammdaten/addresses/:id
// ---------------------------------------------------------------------------
async function patchAddress(req, res, supabase) {
  const id = req.params.id;
  const { address_name_1, address_name_2, street, post_code, city, post_office_box, country_id, customer_number, tax_id, buyer_reference, peppol_endpoint_id, peppol_scheme_id } = req.body || {};
  if (!address_name_1 || !country_id) return res.status(400).json({ error: "ADDRESS_NAME_1 und COUNTRY_ID sind erforderlich" });

  const update = {
    ADDRESS_NAME_1: address_name_1, ADDRESS_NAME_2: address_name_2 || null,
    STREET: street || null, POST_CODE: post_code || null, CITY: city || null,
    POST_OFFICE_BOX: post_office_box || null, COUNTRY_ID: parseInt(country_id, 10),
    CUSTOMER_NUMBER: customer_number || null, "TAX-ID": tax_id || null, BUYER_REFERENCE: buyer_reference || null,
  };
  // Branch 11: Peppol — nur setzen wenn explizit gesendet (Migration 0061 evtl. nicht da)
  if (peppol_endpoint_id !== undefined) update.PEPPOL_ENDPOINT_ID = peppol_endpoint_id || null;
  if (peppol_scheme_id   !== undefined) update.PEPPOL_SCHEME_ID   = peppol_scheme_id   || null;

  const { data, error } = await supabase.from("ADDRESS").update(update).eq("ID", id).eq("TENANT_ID", req.tenantId).select("*").single();
  if (error) return res.status(500).json({ error: error.message });

  let countryName = "";
  const { data: cData } = await supabase.from("COUNTRY").select("NAME_LONG, NAME_SHORT").eq("ID", data.COUNTRY_ID).maybeSingle();
  if (cData) countryName = cData.NAME_LONG || cData.NAME_SHORT || "";

  res.json({ data: { ...data, TAX_ID: data["TAX-ID"] ?? null, COUNTRY: countryName } });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/contacts/search
// ---------------------------------------------------------------------------
async function searchContacts(req, res, supabase) {
  const q = (req.query.q || "").toString().trim();
  const addressIdRaw = (req.query.address_id || "").toString().trim();
  if (!addressIdRaw) return res.json({ data: [] });
  const parsedAddressId = parseInt(addressIdRaw, 10);
  if (!parsedAddressId || Number.isNaN(parsedAddressId)) return res.json({ data: [] });
  if (!q || q.length < 2) return res.json({ data: [] });

  const { data, error } = await supabase.from("CONTACTS").select("ID, FIRST_NAME, LAST_NAME, ADDRESS_ID").eq("TENANT_ID", req.tenantId).eq("ADDRESS_ID", parsedAddressId).or(`FIRST_NAME.ilike.%${q}%,LAST_NAME.ilike.%${q}%`).order("LAST_NAME", { ascending: true }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/contacts/by-address?address_id=X
// ---------------------------------------------------------------------------
async function getContactsByAddress(req, res, supabase) {
  const addressId = parseInt((req.query.address_id || "").toString(), 10);
  if (!addressId) return res.json({ data: [] });

  const { data, error } = await supabase
    .from("CONTACTS")
    .select("ID, FIRST_NAME, LAST_NAME")
    .eq("TENANT_ID", req.tenantId)
    .eq("ADDRESS_ID", addressId)
    .order("LAST_NAME", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data || [] });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/contacts/list
// ---------------------------------------------------------------------------
async function listContacts(req, res, supabase) {
  const limit = Math.min(parseInt(req.query.limit || "2000", 10) || 2000, 5000);

  const { data: contacts, error: cErr } = await supabase.from("CONTACTS").select("ID, TITLE, FIRST_NAME, LAST_NAME, EMAIL, MOBILE, SALUTATION_ID, GENDER_ID, ADDRESS_ID").eq("TENANT_ID", req.tenantId).order("LAST_NAME", { ascending: true }).limit(limit);
  if (cErr) return res.status(500).json({ error: cErr.message });

  const [{ data: salutations, error: sErr }, { data: genders, error: gErr }, { data: addresses, error: aErr }] = await Promise.all([
    supabase.from("SALUTATION").select("ID, SALUTATION").limit(5000),
    supabase.from("GENDER").select("ID, GENDER").limit(5000),
    supabase.from("ADDRESS").select("ID, ADDRESS_NAME_1").limit(5000),
  ]);
  if (sErr) return res.status(500).json({ error: sErr.message });
  if (gErr) return res.status(500).json({ error: gErr.message });
  if (aErr) return res.status(500).json({ error: aErr.message });

  const salMap = new Map((salutations || []).map((s) => [String(s.ID), (s.SALUTATION || "").toString()]));
  const genMap = new Map((genders || []).map((g) => [String(g.ID), (g.GENDER || "").toString()]));
  const addrMap = new Map((addresses || []).map((a) => [String(a.ID), (a.ADDRESS_NAME_1 || "").toString()]));

  res.json({ data: (contacts || []).map((r) => ({ ...r, NAME: `${r.FIRST_NAME || ""} ${r.LAST_NAME || ""}`.trim(), SALUTATION: salMap.get(String(r.SALUTATION_ID)) || "", GENDER: genMap.get(String(r.GENDER_ID)) || "", ADDRESS: addrMap.get(String(r.ADDRESS_ID)) || "" })) });
}

// ---------------------------------------------------------------------------
// PATCH /api/stammdaten/contacts/:id
// ---------------------------------------------------------------------------
async function patchContact(req, res, supabase) {
  const id = req.params.id;
  const { title, first_name, last_name, email, mobile, salutation_id, gender_id, address_id } = req.body || {};
  if (!first_name || !last_name || !salutation_id || !gender_id || !address_id) return res.status(400).json({ error: "Vorname, Nachname, Anrede, Geschlecht und Adresse sind erforderlich" });

  const { data, error } = await supabase.from("CONTACTS").update({
    TITLE: title || null, FIRST_NAME: first_name, LAST_NAME: last_name,
    EMAIL: email || null, MOBILE: mobile || null,
    SALUTATION_ID: parseInt(salutation_id, 10), GENDER_ID: parseInt(gender_id, 10), ADDRESS_ID: parseInt(address_id, 10),
  }).eq("ID", id).eq("TENANT_ID", req.tenantId).select("*").single();
  if (error) return res.status(500).json({ error: error.message });

  const [{ data: s }, { data: g }, { data: a }] = await Promise.all([
    supabase.from("SALUTATION").select("SALUTATION").eq("ID", data.SALUTATION_ID).maybeSingle(),
    supabase.from("GENDER").select("GENDER").eq("ID", data.GENDER_ID).maybeSingle(),
    supabase.from("ADDRESS").select("ADDRESS_NAME_1").eq("ID", data.ADDRESS_ID).maybeSingle(),
  ]);

  res.json({ data: { ...data, NAME: `${data.FIRST_NAME || ""} ${data.LAST_NAME || ""}`.trim(), SALUTATION: s?.SALUTATION || "", GENDER: g?.GENDER || "", ADDRESS: a?.ADDRESS_NAME_1 || "" } });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/currencies
// ---------------------------------------------------------------------------
async function getCurrencies(req, res, supabase) {
  const { data, error } = await supabase.from("CURRENCY").select("ID, NAME_SHORT").order("NAME_SHORT", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data || [] });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/vat
// ---------------------------------------------------------------------------
async function getVat(req, res, supabase) {
  const { data, error } = await supabase.from("VAT").select("ID, VAT, VAT_PERCENT").order("VAT_PERCENT", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data || [] });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/defaults
// PUT /api/stammdaten/defaults  { key, value }
// ---------------------------------------------------------------------------
async function getDefaults(req, res, supabase) {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "no tenant" });
  const { data, error } = await supabase.from("TENANT_SETTINGS").select("KEY, VALUE").eq("TENANT_ID", tenantId);
  if (error) return res.status(500).json({ error: error.message });
  const settings = {};
  for (const row of data || []) settings[row.KEY] = row.VALUE;
  res.json({ data: settings });
}

async function putDefault(req, res, supabase) {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "no tenant" });
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: "key required" });
  const { error } = await supabase.from("TENANT_SETTINGS").upsert(
    [{ TENANT_ID: tenantId, KEY: key, VALUE: value ?? null, UPDATED_AT: new Date().toISOString() }],
    { onConflict: "TENANT_ID,KEY" }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/vat/search
// ---------------------------------------------------------------------------
async function searchVat(req, res, supabase) {
  const q = (req.query.q || "").toString().trim();
  if (!q || q.length < 1) return res.json({ data: [] });
  const { data, error } = await supabase.from("VAT").select("ID, VAT, VAT_PERCENT").ilike("VAT", `%${q}%`).order("VAT_PERCENT", { ascending: true }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/payment-means/search
// ---------------------------------------------------------------------------
async function searchPaymentMeans(req, res, supabase) {
  const q = (req.query.q || "").toString().trim();
  if (!q || q.length < 2) return res.json({ data: [] });
  const { data, error } = await supabase.from("PAYMENT_MEANS").select("ID, NAME_SHORT, NAME_LONG").or(`NAME_SHORT.ilike.%${q}%,NAME_LONG.ilike.%${q}%`).order("NAME_SHORT", { ascending: true }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/contacts
// ---------------------------------------------------------------------------
async function postContact(req, res, supabase) {
  const { title, first_name, last_name, email, mobile, salutation_id, gender_id, address_id } = req.body || {};

  if (!first_name || typeof first_name !== "string" || !first_name.trim()) return res.status(400).json({ error: "first_name is required" });
  if (!last_name || typeof last_name !== "string" || !last_name.trim()) return res.status(400).json({ error: "last_name is required" });

  const parsedSalutationId = typeof salutation_id === "number" ? salutation_id : parseInt(salutation_id, 10);
  const parsedGenderId = typeof gender_id === "number" ? gender_id : parseInt(gender_id, 10);
  const parsedAddressId = typeof address_id === "number" ? address_id : parseInt(address_id, 10);

  if (!parsedSalutationId || Number.isNaN(parsedSalutationId)) return res.status(400).json({ error: "salutation_id is required" });
  if (!parsedGenderId || Number.isNaN(parsedGenderId)) return res.status(400).json({ error: "gender_id is required" });
  if (!parsedAddressId || Number.isNaN(parsedAddressId)) return res.status(400).json({ error: "address_id is required" });

  const { data, error } = await supabase.from("CONTACTS").insert([{
    TITLE: (title || "").trim() || null, FIRST_NAME: first_name.trim(), LAST_NAME: last_name.trim(),
    EMAIL: (email || "").trim() || null, MOBILE: (mobile || "").trim() || null,
    SALUTATION_ID: parsedSalutationId, GENDER_ID: parsedGenderId, ADDRESS_ID: parsedAddressId,
    TENANT_ID: req.tenantId ?? null,
  }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ── Stammdaten list + delete ─────────────────────────────────────────────────

async function getDepartments(req, res, supabase) {
  const { data, error } = await supabase.from("DEPARTMENT").select("ID, NAME_SHORT")
    .eq("TENANT_ID", req.tenantId).order("NAME_SHORT", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data || [] });
}

async function deleteDepartment(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const { error } = await supabase.from("DEPARTMENT").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}

async function getTypen(req, res, supabase) {
  const { data, error } = await supabase.from("PROJECT_TYPE").select("ID, NAME_SHORT")
    .eq("TENANT_ID", req.tenantId).order("NAME_SHORT", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data || [] });
}

async function deleteTyp(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const { error } = await supabase.from("PROJECT_TYPE").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}

async function getRollen(req, res, supabase) {
  const { data, error } = await supabase.from("ROLE").select("ID, NAME_SHORT, NAME_LONG, SP_RATE")
    .eq("TENANT_ID", req.tenantId).order("NAME_SHORT", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data || [] });
}

async function deleteRolle(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const { error } = await supabase.from("ROLE").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}

async function patchDepartment(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const { name_short } = req.body || {};
  if (!name_short) return res.status(400).json({ error: "name_short is required" });
  const { data, error } = await supabase.from("DEPARTMENT").update({ NAME_SHORT: name_short.trim() }).eq("ID", id).eq("TENANT_ID", req.tenantId).select("ID, NAME_SHORT").single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

async function patchTyp(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const { name_short } = req.body || {};
  if (!name_short) return res.status(400).json({ error: "name_short is required" });
  const { data, error } = await supabase.from("PROJECT_TYPE").update({ NAME_SHORT: name_short.trim() }).eq("ID", id).eq("TENANT_ID", req.tenantId).select("ID, NAME_SHORT").single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

async function patchRolle(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const { name_short, name_long, sp_rate } = req.body || {};
  if (!name_short) return res.status(400).json({ error: "name_short is required" });
  const { data, error } = await supabase.from("ROLE").update({
    NAME_SHORT: name_short.trim(),
    NAME_LONG:  (name_long || "").trim() || null,
    SP_RATE:    sp_rate !== undefined && sp_rate !== "" ? parseFloat(sp_rate) : null,
  }).eq("ID", id).eq("TENANT_ID", req.tenantId).select("ID, NAME_SHORT, NAME_LONG, SP_RATE").single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

async function deleteAddress(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const { error } = await supabase.from("ADDRESS").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}

async function deleteContact(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "invalid id" });
  const { error } = await supabase.from("CONTACTS").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}

// ── Logo management ──────────────────────────────────────────────────────────
// Stores the logo asset ID in TENANT_SETTINGS and propagates to all templates.

async function getLogo(req, res, supabase) {
  const [assetRow, uriRow] = await Promise.all([
    supabase.from("TENANT_SETTINGS").select("VALUE").eq("TENANT_ID", req.tenantId).eq("KEY", "logo_asset_id").maybeSingle(),
    supabase.from("TENANT_SETTINGS").select("VALUE").eq("TENANT_ID", req.tenantId).eq("KEY", "logo_data_uri").maybeSingle(),
  ]);
  const assetId = assetRow.data?.VALUE ? parseInt(assetRow.data.VALUE, 10) : null;
  const dataUri = uriRow.data?.VALUE ?? null;
  res.json({ data: { logo_asset_id: assetId, logo_data_uri: dataUri } });
}

async function putLogo(req, res, supabase) {
  const assetId = req.body?.logo_asset_id != null ? parseInt(String(req.body.logo_asset_id), 10) : null;
  const value = assetId ? String(assetId) : null;

  // Persist asset ID in TENANT_SETTINGS
  const { error: settErr } = await supabase.from("TENANT_SETTINGS").upsert(
    [{ TENANT_ID: req.tenantId, KEY: "logo_asset_id", VALUE: value }],
    { onConflict: "TENANT_ID,KEY" }
  );
  if (settErr) return res.status(500).json({ error: settErr.message });

  // Cache logo as base64 data URI in DB so it survives server redeploys
  let dataUri = null;
  if (assetId) {
    try {
      const { data: asset } = await supabase.from("ASSET").select("STORAGE_KEY, MIME_TYPE").eq("ID", assetId).maybeSingle();
      if (asset) {
        const uploadRoot = path.join(__dirname, "..", "uploads");
        const filePath   = path.join(uploadRoot, asset.STORAGE_KEY);
        if (fs.existsSync(filePath)) {
          const b64 = fs.readFileSync(filePath).toString("base64");
          dataUri = `data:${asset.MIME_TYPE};base64,${b64}`;
        }
      }
    } catch (e) {
      console.error("[PUT_LOGO] base64 cache error:", e.message);
    }
  }
  await supabase.from("TENANT_SETTINGS").upsert(
    [{ TENANT_ID: req.tenantId, KEY: "logo_data_uri", VALUE: dataUri }],
    { onConflict: "TENANT_ID,KEY" }
  );

  // Propagate to all document templates for this tenant
  await supabase.from("DOCUMENT_TEMPLATE").update({ LOGO_ASSET_ID: assetId })
    .eq("TENANT_ID", req.tenantId);

  res.json({ ok: true, logo_asset_id: assetId });
}

// ── Per-company asset management (logo + signature) ───────────────────────────

async function _upsertCompanyAsset(supabase, tenantId, companyId, type, assetId) {
  const idKey  = `co_${companyId}_${type}_asset_id`;
  const uriKey = `co_${companyId}_${type}_data_uri`;
  const idValue = assetId ? String(assetId) : null;

  await supabase.from("TENANT_SETTINGS").upsert(
    [{ TENANT_ID: tenantId, KEY: idKey, VALUE: idValue }],
    { onConflict: "TENANT_ID,KEY" }
  );

  let dataUri = null;
  if (assetId) {
    try {
      const { data: asset } = await supabase.from("ASSET").select("STORAGE_KEY, MIME_TYPE").eq("ID", assetId).maybeSingle();
      if (asset) {
        const filePath = path.join(__dirname, "..", "uploads", asset.STORAGE_KEY);
        if (fs.existsSync(filePath)) {
          const b64 = fs.readFileSync(filePath).toString("base64");
          dataUri = `data:${asset.MIME_TYPE};base64,${b64}`;
        }
      }
    } catch (e) {
      console.error(`[COMPANY_ASSET] base64 cache error:`, e.message);
    }
  }
  await supabase.from("TENANT_SETTINGS").upsert(
    [{ TENANT_ID: tenantId, KEY: uriKey, VALUE: dataUri }],
    { onConflict: "TENANT_ID,KEY" }
  );
}

async function getCompanyAssets(req, res, supabase) {
  const companyId = parseInt(req.params.id, 10);
  if (!companyId) return res.status(400).json({ error: "Invalid company ID" });
  const keys = [
    `co_${companyId}_logo_asset_id`, `co_${companyId}_logo_data_uri`,
    `co_${companyId}_sig_asset_id`,  `co_${companyId}_sig_data_uri`,
  ];
  const { data } = await supabase.from("TENANT_SETTINGS")
    .select("KEY, VALUE").eq("TENANT_ID", req.tenantId).in("KEY", keys);
  const map = Object.fromEntries((data || []).map(r => [r.KEY, r.VALUE]));
  res.json({ data: {
    logo_asset_id: map[keys[0]] ? parseInt(map[keys[0]], 10) : null,
    logo_data_uri: map[keys[1]] || null,
    sig_asset_id:  map[keys[2]] ? parseInt(map[keys[2]], 10) : null,
    sig_data_uri:  map[keys[3]] || null,
  }});
}

async function putCompanyLogo(req, res, supabase) {
  const companyId = parseInt(req.params.id, 10);
  if (!companyId) return res.status(400).json({ error: "Invalid company ID" });
  const assetId = req.body?.asset_id != null ? parseInt(String(req.body.asset_id), 10) || null : null;
  try {
    await _upsertCompanyAsset(supabase, req.tenantId, companyId, "logo", assetId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}

async function putCompanySignature(req, res, supabase) {
  const companyId = parseInt(req.params.id, 10);
  if (!companyId) return res.status(400).json({ error: "Invalid company ID" });
  const assetId = req.body?.asset_id != null ? parseInt(String(req.body.asset_id), 10) || null : null;
  try {
    await _upsertCompanyAsset(supabase, req.tenantId, companyId, "sig", assetId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}

// ── Monatsabschluss ───────────────────────────────────────────────────────────

const monatsabschlussSvc = require("../services/monatsabschluss");
const { renderMonatsabschlussPdf } = require("../services_pdf_render");

async function getMonatsabschluss(req, res, supabase) {
  try {
    const settings = await monatsabschlussSvc.getSettings(supabase, req.tenantId);
    res.json({ data: settings });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function putMonatsabschluss(req, res, supabase) {
  try {
    const { enabled, statuses } = req.body || {};
    await monatsabschlussSvc.saveSettings(supabase, req.tenantId, { enabled: !!enabled, statuses: statuses || [] });
    res.json({ ok: true });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function runMonatsabschlussNow(req, res, supabase) {
  try {
    const result = await monatsabschlussSvc.runMonatsabschluss(supabase, req.tenantId, { isTest: true });
    res.json({ data: result });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function getMonatsabschlussPdf(req, res, supabase) {
  try {
    const { pdf, report } = await renderMonatsabschlussPdf({ supabase, tenantId: req.tenantId });
    const label = (report?.monthLabel || "Monatsabschluss").replace(/\s+/g, "_");
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `inline; filename="Monatsabschluss_${label}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

// ── HOAI Calculation list / detail ───────────────────────────────────────────

async function listFeeCalcMasters(req, res, supabase) {
  try {
    const projectIdRaw = (req.query.project_id || "").toString().trim();
    const projectId    = projectIdRaw ? Number.parseInt(projectIdRaw, 10) : null;
    const offerIdRaw   = (req.query.offer_id   || "").toString().trim();
    const offerId      = offerIdRaw  ? Number.parseInt(offerIdRaw,   10) : null;

    let query = supabase.from("FEE_CALCULATION_MASTER")
      .select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, OFFER_ID, ATTACH_TO_OFFER_STRUCTURE_ID, FEE_MASTER_ID, ZONE_ID, ZONE_PERCENT, CONSTRUCTION_COSTS_K0, CONSTRUCTION_COSTS_K1, CONSTRUCTION_COSTS_K2, CONSTRUCTION_COSTS_K3, CONSTRUCTION_COSTS_K4, REVENUE_K0, REVENUE_K1, REVENUE_K2, REVENUE_K3, REVENUE_K4, TENANT_ID")
      .eq("TENANT_ID", req.tenantId)
      .order("ID", { ascending: false });
    if (projectId) query = query.eq("PROJECT_ID", projectId);
    if (offerId)   query = query.eq("OFFER_ID",   offerId);

    const { data: masters, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    if (!masters || !masters.length) return res.json({ data: [] });

    const masterIds = masters.map(m => m.ID);
    const [{ data: phases }, { data: surcharges }, { data: projects }, { data: offers }] = await Promise.all([
      supabase.from("FEE_CALCULATION_PHASE").select("FEE_MASTER_ID, PHASE_REVENUE").in("FEE_MASTER_ID", masterIds),
      supabase.from("FEE_CALCULATION_SURCHARGES").select("FEE_CALC_MASTER_ID, AMOUNT").in("FEE_CALC_MASTER_ID", masterIds),
      supabase.from("PROJECT").select("ID, NAME_SHORT, NAME_LONG").eq("TENANT_ID", req.tenantId),
      supabase.from("OFFER").select("ID, NAME_SHORT, NAME_LONG").eq("TENANT_ID", req.tenantId),
    ]);

    const phaseSum = {};
    for (const r of (phases || [])) phaseSum[r.FEE_MASTER_ID] = (phaseSum[r.FEE_MASTER_ID] || 0) + (Number(r.PHASE_REVENUE) || 0);
    const surchargeSum = {};
    for (const r of (surcharges || [])) surchargeSum[r.FEE_CALC_MASTER_ID] = (surchargeSum[r.FEE_CALC_MASTER_ID] || 0) + (Number(r.AMOUNT) || 0);
    const projectMap = new Map((projects || []).map(p => [p.ID, p]));
    const offerMap   = new Map((offers   || []).map(o => [o.ID, o]));

    const result = masters.map(m => {
      const proj  = m.PROJECT_ID ? projectMap.get(m.PROJECT_ID) : null;
      const offer = m.OFFER_ID   ? offerMap.get(m.OFFER_ID)     : null;
      return {
        ...m,
        projectLabel: proj  ? `${proj.NAME_SHORT  || ""} – ${proj.NAME_LONG  || ""}`.replace(/ – $/, "") : null,
        offerLabel:   offer ? `${offer.NAME_SHORT || ""} – ${offer.NAME_LONG || ""}`.replace(/ – $/, "") : null,
        grundhonorar:  phaseSum[m.ID]     || 0,
        zuschlaegeSum: surchargeSum[m.ID] || 0,
        gesamthonorar: (phaseSum[m.ID] || 0) + (surchargeSum[m.ID] || 0),
      };
    });
    const enriched = await enrichBaseType(supabase, result);
    res.json({ data: enriched });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

async function getFeeCalcMasterDetail(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    const { data, error } = await supabase.from("FEE_CALCULATION_MASTER")
      .select("*").eq("ID", id).eq("TENANT_ID", req.tenantId).single();
    if (error) return res.status(404).json({ error: error.message });
    const enriched = await enrichBaseType(supabase, data);
    res.json({ data: enriched });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

// ── HOAI Surcharges (global master data) ─────────────────────────────────────

async function listFeeSurchargesGlobal(req, res, supabase) {
  const feeMasterIdRaw = (req.query.fee_master_id || "").toString().trim();
  const feeMasterId = feeMasterIdRaw ? Number.parseInt(feeMasterIdRaw, 10) : null;
  try {
    if (feeMasterId) {
      // Return only surcharges linked to this fee master via FEE_SURCHARGES2MASTER
      const { data: links, error: linkErr } = await supabase.from("FEE_SURCHARGES2MASTER")
        .select("FEE_SURCHARGE_ID").eq("FEE_MASTER_ID", feeMasterId);
      if (linkErr) return res.json({ data: [] }); // table may not exist
      const ids = (links || []).map(r => r.FEE_SURCHARGE_ID).filter(Boolean);
      if (!ids.length) return res.json({ data: [] });
      const { data, error } = await supabase.from("FEE_SURCHARGES").select("ID, NAME_SHORT, NAME_LONG, SURCHARGE_TYPE").in("ID", ids);
      if (error) return res.json({ data: [] });
      return res.json({ data: data || [] });
    } else {
      const { data, error } = await supabase.from("FEE_SURCHARGES").select("ID, NAME_SHORT, NAME_LONG, SURCHARGE_TYPE").order("ID");
      if (error) return res.json({ data: [] });
      return res.json({ data: data || [] });
    }
  } catch (e) {
    return res.json({ data: [] }); // soft-fail – table may not be seeded yet
  }
}

// ── HOAI Surcharges (per calculation) ────────────────────────────────────────

async function listFeeCalcSurcharges(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "id is required" });
  const { data, error } = await supabase.from("FEE_CALCULATION_SURCHARGES")
    .select("ID, FEE_CALC_MASTER_ID, FEE_SURCHARGE_ID, NAME_SHORT, NAME_LONG, PERCENT, BASE_AMOUNT, AMOUNT, SORT_ORDER, LPH_FILTER, CALC_MODE, INCLUDE_BL, BL_FILTER")
    .eq("FEE_CALC_MASTER_ID", id).eq("TENANT_ID", req.tenantId)
    .order("SORT_ORDER", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data || [] });
}

async function saveFeeCalcSurcharges(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "id is required" });

  try {
    // Verify ownership
    const { data: master, error: masterErr } = await supabase.from("FEE_CALCULATION_MASTER")
      .select("ID").eq("ID", id).eq("TENANT_ID", req.tenantId).single();
    if (masterErr || !master) return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    // Delete all existing surcharges for this calc, then re-insert
    const { error: delErr } = await supabase.from("FEE_CALCULATION_SURCHARGES")
      .delete().eq("FEE_CALC_MASTER_ID", id).eq("TENANT_ID", req.tenantId);
    if (delErr) return res.status(500).json({ error: delErr.message });

    if (rows.length) {
      const insertRows = rows.map((r, idx) => {
        const pct = Number(r.PERCENT) || 0;
        const base = Number(r.BASE_AMOUNT) || 0;
        return {
          TENANT_ID:          req.tenantId,
          FEE_CALC_MASTER_ID: id,
          FEE_SURCHARGE_ID:   r.FEE_SURCHARGE_ID ?? null,
          NAME_SHORT:         r.NAME_SHORT ?? null,
          NAME_LONG:          r.NAME_LONG ?? null,
          PERCENT:            pct,
          BASE_AMOUNT:        base,
          AMOUNT:             Math.round((pct / 100) * base * 100) / 100,
          SORT_ORDER:         r.SORT_ORDER ?? idx,
          LPH_FILTER:         r.LPH_FILTER ?? null,
          CALC_MODE:          r.CALC_MODE ?? 'parallel',
          INCLUDE_BL:         r.INCLUDE_BL ?? false,
          BL_FILTER:          r.BL_FILTER ?? null,
        };
      });
      const { error: insErr } = await supabase.from("FEE_CALCULATION_SURCHARGES").insert(insertRows);
      if (insErr) return res.status(500).json({ error: insErr.message });
    }

    const { data: saved } = await supabase.from("FEE_CALCULATION_SURCHARGES")
      .select("ID, FEE_CALC_MASTER_ID, FEE_SURCHARGE_ID, NAME_SHORT, NAME_LONG, PERCENT, BASE_AMOUNT, AMOUNT, SORT_ORDER, LPH_FILTER, CALC_MODE, INCLUDE_BL, BL_FILTER")
      .eq("FEE_CALC_MASTER_ID", id).eq("TENANT_ID", req.tenantId)
      .order("SORT_ORDER", { ascending: true });
    res.json({ data: saved || [] });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

// ── HOAI Besondere Leistungen ─────────────────────────────────────────────────

async function listFeeCalcBl(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    const { data, error } = await supabase.from("FEE_CALCULATION_BL")
      .select("ID, NAME_SHORT, NAME, LPH_REF, LPH_PHASE_ID, AMOUNT_TYPE, PERCENT, KX_REF, AMOUNT, SORT_ORDER")
      .eq("FEE_CALC_MASTER_ID", id).eq("TENANT_ID", req.tenantId)
      .order("SORT_ORDER", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

async function saveFeeCalcBl(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    const { data: master } = await supabase.from("FEE_CALCULATION_MASTER")
      .select("ID").eq("ID", id).eq("TENANT_ID", req.tenantId).single();
    if (!master) return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    // Upsert pattern: preserve IDs for existing rows so BL_FILTER references stay valid
    const toUpdate = rows.filter(r => r.ID);
    const toInsert = rows.filter(r => !r.ID);
    const keepIds  = toUpdate.map(r => r.ID);

    // Delete rows no longer in the list (preserving kept IDs)
    let delQuery = supabase.from("FEE_CALCULATION_BL")
      .delete().eq("FEE_CALC_MASTER_ID", id).eq("TENANT_ID", req.tenantId);
    if (keepIds.length > 0) {
      delQuery = delQuery.not("ID", "in", `(${keepIds.join(",")})`);
    }
    const { error: delErr } = await delQuery;
    if (delErr) return res.status(500).json({ error: delErr.message });

    // Update existing rows (keep their IDs)
    for (const r of toUpdate) {
      const { error: updErr } = await supabase.from("FEE_CALCULATION_BL").update({
        NAME_SHORT:   r.NAME_SHORT ? String(r.NAME_SHORT).trim() || null : null,
        NAME:         String(r.NAME || '').trim() || '—',
        LPH_REF:      r.LPH_REF ?? null,
        LPH_PHASE_ID: r.LPH_PHASE_ID ? Number(r.LPH_PHASE_ID) : null,
        AMOUNT_TYPE:  r.AMOUNT_TYPE || 'fixed',
        PERCENT:      r.PERCENT != null ? Number(r.PERCENT) : null,
        KX_REF:       r.KX_REF ?? null,
        AMOUNT:       Number(r.AMOUNT) || 0,
        SORT_ORDER:   r.SORT_ORDER ?? 0,
      }).eq("ID", r.ID).eq("TENANT_ID", req.tenantId);
      if (updErr) return res.status(500).json({ error: updErr.message });
    }

    // Insert new rows (no existing ID)
    if (toInsert.length) {
      const insertRows = toInsert.map((r, idx) => ({
        TENANT_ID:          req.tenantId,
        FEE_CALC_MASTER_ID: id,
        NAME_SHORT:         r.NAME_SHORT ? String(r.NAME_SHORT).trim() || null : null,
        NAME:               String(r.NAME || '').trim() || '—',
        LPH_REF:            r.LPH_REF ?? null,
        LPH_PHASE_ID:       r.LPH_PHASE_ID ? Number(r.LPH_PHASE_ID) : null,
        AMOUNT_TYPE:        r.AMOUNT_TYPE || 'fixed',
        PERCENT:            r.PERCENT != null ? Number(r.PERCENT) : null,
        KX_REF:             r.KX_REF ?? null,
        AMOUNT:             Number(r.AMOUNT) || 0,
        SORT_ORDER:         r.SORT_ORDER ?? (toUpdate.length + idx),
      }));
      const { error: insErr } = await supabase.from("FEE_CALCULATION_BL").insert(insertRows);
      if (insErr) return res.status(500).json({ error: insErr.message });
    }

    const { data: saved } = await supabase.from("FEE_CALCULATION_BL")
      .select("ID, NAME_SHORT, NAME, LPH_REF, LPH_PHASE_ID, AMOUNT_TYPE, PERCENT, KX_REF, AMOUNT, SORT_ORDER")
      .eq("FEE_CALC_MASTER_ID", id).eq("TENANT_ID", req.tenantId)
      .order("SORT_ORDER", { ascending: true });
    res.json({ data: saved || [] });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

// ── HOAI PDF ──────────────────────────────────────────────────────────────────

async function getHonorarPdf(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    const { renderHonorarPdf } = require("../services_pdf_render");
    const pdf = await renderHonorarPdf(supabase, { calcMasterId: id, tenantId: req.tenantId });
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `inline; filename="Honorarberechnung_${id}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

// ── HOAI → Projektstruktur sync ───────────────────────────────────────────────

/**
 * Splits each surcharge's stored AMOUNT proportionally between the LPH phases it
 * targets (via LPH_FILTER) and the BL items it targets (via BL_FILTER).
 * Returns two plain objects: lphAlloc {phaseId → share} and blAlloc {blId → share}.
 */
function computeSurchargeAllocations(phases, surchargeRows, blItems) {
  const allPhaseIds = (phases || []).map(p => p.ID);
  const lphAlloc = {};
  const blAlloc  = {};

  for (const s of (surchargeRows || [])) {
    const amount = Number(s.AMOUNT) || 0;
    if (amount === 0) continue;

    let selectedLphIds;
    if (s.LPH_FILTER) {
      try { selectedLphIds = JSON.parse(s.LPH_FILTER); } catch { selectedLphIds = allPhaseIds; }
    } else {
      selectedLphIds = allPhaseIds;
    }
    const selectedPhases = (phases || []).filter(p => selectedLphIds.includes(p.ID));
    const lphBase = selectedPhases.reduce((sum, p) => sum + (Number(p.PHASE_REVENUE) || 0), 0);

    let selectedBlItems = [], blBase = 0;
    if (s.BL_FILTER && (blItems || []).length > 0) {
      try {
        const selectedBlIds = JSON.parse(s.BL_FILTER);
        selectedBlItems = (blItems || []).filter(b => b.ID && selectedBlIds.includes(b.ID));
        blBase = selectedBlItems.reduce((sum, b) => sum + (Number(b.AMOUNT) || 0), 0);
      } catch { /* ignore */ }
    }

    const totalBase = lphBase + blBase;
    if (totalBase === 0) continue;

    if (lphBase > 0) {
      const lphAmt = amount * (lphBase / totalBase);
      for (const p of selectedPhases) {
        const pRev = Number(p.PHASE_REVENUE) || 0;
        if (pRev === 0) continue;
        lphAlloc[p.ID] = (lphAlloc[p.ID] || 0) + (pRev / lphBase) * lphAmt;
      }
    }

    if (blBase > 0) {
      const blAmt = amount * (blBase / totalBase);
      for (const b of selectedBlItems) {
        const bAmt = Number(b.AMOUNT) || 0;
        if (bAmt === 0) continue;
        blAlloc[b.ID] = (blAlloc[b.ID] || 0) + (bAmt / blBase) * blAmt;
      }
    }
  }

  return { lphAlloc, blAlloc };
}

async function syncFeeCalcToStructure(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    const { data: master } = await supabase.from("FEE_CALCULATION_MASTER")
      .select("ID, PROJECT_ID").eq("ID", id).eq("TENANT_ID", req.tenantId).single();
    if (!master) return res.status(404).json({ error: "Honorarberechnung nicht gefunden" });

    const { data: phases } = await supabase.from("FEE_CALCULATION_PHASE")
      .select("ID, PHASE_REVENUE, FEE_PERCENT").eq("FEE_MASTER_ID", id);

    const { data: surchargeRows } = await supabase.from("FEE_CALCULATION_SURCHARGES")
      .select("AMOUNT, LPH_FILTER, BL_FILTER")
      .eq("FEE_CALC_MASTER_ID", id).eq("TENANT_ID", req.tenantId)
      .order("SORT_ORDER", { ascending: true });

    const { data: structRows } = await supabase.from("PROJECT_STRUCTURE")
      .select("ID, EXTRAS_PERCENT, FATHER_ID, FEE_CALC_PHASE_ID")
      .eq("FEE_CALC_MASTER_ID", id).eq("TENANT_ID", req.tenantId);

    // Soft-fail BL queries if migration 0043 not yet run
    let blStructRows = [], blItems = [];
    try {
      const [blStructRes, blItemsRes] = await Promise.all([
        supabase.from("PROJECT_STRUCTURE").select("ID, EXTRAS_PERCENT, FEE_CALC_BL_ID").eq("FEE_CALC_MASTER_ID", id).eq("TENANT_ID", req.tenantId).not("FEE_CALC_BL_ID", "is", null),
        supabase.from("FEE_CALCULATION_BL").select("ID, NAME_SHORT, NAME, AMOUNT").eq("FEE_CALC_MASTER_ID", id).order("SORT_ORDER", { ascending: true }),
      ]);
      blStructRows = blStructRes.data || [];
      blItems = blItemsRes.data || [];
    } catch (blQueryErr) {
      console.warn('[sync BL] Migration 0043 may not be run yet:', blQueryErr?.message);
    }

    if ((!structRows || !structRows.length) && !blItems.length) {
      return res.json({ synced: 0, projectId: master.PROJECT_ID, message: "Keine verknüpften Projektelemente gefunden." });
    }

    // Distribute surcharges between LPH phases and BL items (split by respective bases)
    const { lphAlloc, blAlloc } = computeSurchargeAllocations(phases, surchargeRows, blItems);

    const phaseMap = new Map((phases || []).map(p => [p.ID, p]));
    const blMap = new Map((blItems || []).map(b => [b.ID, b]));
    let synced = 0;

    // Sync LPH structure rows
    for (const row of (structRows || [])) {
      const phase = phaseMap.get(row.FEE_CALC_PHASE_ID);
      if (!phase) continue;
      const baseRevenue = Number(phase.PHASE_REVENUE ?? 0) || 0;
      const surchargeShare = lphAlloc[phase.ID] || 0;
      const revenue = Math.round((baseRevenue + surchargeShare) * 100) / 100;
      const extrasPercent = Number(row.EXTRAS_PERCENT ?? 0) || 0;
      const extras = Math.round((revenue * extrasPercent) / 100 * 100) / 100;
      const { error } = await supabase.from("PROJECT_STRUCTURE")
        .update({ REVENUE: revenue, EXTRAS: extras })
        .eq("ID", row.ID).eq("TENANT_ID", req.tenantId);
      if (!error) synced++;
    }

    // Sync existing BL structure rows (base AMOUNT + surcharge share for this BL)
    for (const row of (blStructRows || [])) {
      const bl = blMap.get(row.FEE_CALC_BL_ID);
      if (!bl) continue;
      const blSurchargeShare = blAlloc[bl.ID] || 0;
      const revenue = Math.round(((Number(bl.AMOUNT) || 0) + blSurchargeShare) * 100) / 100;
      const extrasPercent = Number(row.EXTRAS_PERCENT ?? 0) || 0;
      const extras = Math.round((revenue * extrasPercent) / 100 * 100) / 100;
      const { error } = await supabase.from("PROJECT_STRUCTURE")
        .update({ REVENUE: revenue, EXTRAS: extras })
        .eq("ID", row.ID).eq("TENANT_ID", req.tenantId);
      if (!error) synced++;
    }

    // Create PROJECT_STRUCTURE rows for BL items that don't have one yet
    const existingBlStructIds = new Set((blStructRows || []).map(r => r.FEE_CALC_BL_ID));
    const missingBlItems = (blItems || []).filter(b => b.ID && !existingBlStructIds.has(b.ID));
    const fatherIdForBl = (structRows || []).length > 0 ? structRows[0].FATHER_ID : null;

    if (missingBlItems.length > 0 && fatherIdForBl && master.PROJECT_ID) {
      try {
        const { data: fatherRow } = await supabase.from("PROJECT_STRUCTURE")
          .select("EXTRAS_PERCENT").eq("ID", fatherIdForBl).single();
        const extrasPercent = Number(fatherRow?.EXTRAS_PERCENT ?? 0) || 0;

        const blInsertRows = missingBlItems.map(bl => {
          const blSurchargeShare = blAlloc[bl.ID] || 0;
          const revenue = Math.round(((Number(bl.AMOUNT) || 0) + blSurchargeShare) * 100) / 100;
          const extras = Math.round((revenue * extrasPercent) / 100 * 100) / 100;
          return {
            NAME_SHORT: bl.NAME_SHORT || null,
            NAME_LONG: bl.NAME || null,
            REVENUE: revenue, EXTRAS: extras, COSTS: 0,
            PROJECT_ID: master.PROJECT_ID, FATHER_ID: fatherIdForBl,
            EXTRAS_PERCENT: extrasPercent, BILLING_TYPE_ID: 1,
            TENANT_ID: req.tenantId,
            REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0,
            REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
            FEE_CALC_MASTER_ID: id,
            FEE_CALC_BL_ID: bl.ID,
          };
        });

        const { data: createdBlRows, error: blErr } = await supabase.from("PROJECT_STRUCTURE").insert(blInsertRows).select("*");
        if (!blErr && createdBlRows?.length) {
          synced += createdBlRows.length;
          const progressRows = createdBlRows.map(svc.buildProjectProgressRow);
          if (progressRows.length) await supabase.from("PROJECT_PROGRESS").insert(progressRows).catch(() => {});
        } else if (blErr) {
          console.warn('[sync BL create] Failed:', blErr.message);
        }
      } catch (blCreateErr) {
        console.warn('[sync BL create] Soft-fail:', blCreateErr?.message);
      }
    }

    return res.json({
      synced,
      projectId: master.PROJECT_ID,
      message: synced > 0
        ? `${synced} Projektelement${synced !== 1 ? "e" : ""} wurden aktualisiert.`
        : "Keine Elemente aktualisiert.",
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

const wtmSvc = require("../services/workingTimeModels");

async function getCountryStates(req, res) {
  res.json({ data: wtmSvc.getCountryStates() });
}

async function getWorkingTimeModels(req, res, supabase) {
  try {
    const data = await wtmSvc.listModels(supabase, req.tenantId);
    res.json({ data });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function postWorkingTimeModel(req, res, supabase) {
  try {
    const data = await wtmSvc.createModel(supabase, req.tenantId, req.body);
    res.json({ data });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function patchWorkingTimeModel(req, res, supabase) {
  try {
    const data = await wtmSvc.updateModel(supabase, req.tenantId, Number(req.params.id), req.body);
    res.json({ data });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function deleteWorkingTimeModel(req, res, supabase) {
  try {
    await wtmSvc.deleteModel(supabase, req.tenantId, Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

module.exports = {
  postStatus, postTyp, postDepartment, getCountries, getBillingTypes, getFeeGroups, getFeeMasters, getFeeZones,
  postFeeCalcMasterInit, patchFeeCalcMasterBasis, postFeeCalcPhasesInit, patchFeeCalcPhase,
  postFeeCalcPhasesSave, deleteFeeCalcMaster, postFeeCalcAddToStructure, postFeeCalcAddToOfferStructure, syncFeeCalcToStructure,
  getCompanies, postCompany, putCompany, postAddress, postRollen,
  getSalutations, getGenders, searchAddresses, listAddresses, patchAddress,
  searchContacts, listContacts, getContactsByAddress, patchContact, searchVat, searchPaymentMeans, postContact,
  getCurrencies, getVat, getDefaults, putDefault,
  getDepartments, deleteDepartment, patchDepartment,
  getTypen, deleteTyp, patchTyp,
  getRollen, deleteRolle, patchRolle,
  deleteAddress, deleteContact,
  getLogo, putLogo,
  getCompanyAssets, putCompanyLogo, putCompanySignature,
  getMonatsabschluss, putMonatsabschluss, runMonatsabschlussNow, getMonatsabschlussPdf,
  getCountryStates, getWorkingTimeModels, postWorkingTimeModel, patchWorkingTimeModel, deleteWorkingTimeModel,
  listFeeCalcMasters, getFeeCalcMasterDetail,
  listFeeSurchargesGlobal,
  listFeeCalcSurcharges, saveFeeCalcSurcharges,
  listFeeCalcBl, saveFeeCalcBl,
  getHonorarPdf,
};
