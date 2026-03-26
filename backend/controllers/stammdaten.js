"use strict";

const svc = require("../services/stammdaten");

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
  const { data, error } = await supabase.from("PROJECT_TYPE").insert([{ NAME_SHORT: name_short }]);
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
  res.json({ data });
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

  let query = supabase.from("FEE_MASTERS").select("ID, NAME_SHORT, NAME_LONG, FEE_GROUP_ID").order("NAME_SHORT", { ascending: true, nullsFirst: false });
  if (feeGroupId !== null) query = query.eq("FEE_GROUP_ID", feeGroupId);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
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

  const { data, error } = await supabase
    .from("FEE_CALCULATION_MASTER")
    .insert([{ FEE_MASTER_ID: feeMasterId, NAME_SHORT: feeMaster.NAME_SHORT || null, NAME_LONG: feeMaster.NAME_LONG || null, TENANT_ID: req.tenantId ?? null }])
    .select("*")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
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
      .select("ID, FEE_MASTER_ID, ZONE_ID, ZONE_PERCENT")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .single();
    if (existingErr) return res.status(500).json({ error: existingErr.message });
    if (!existing) return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });

    const body = req.body || {};
    const costsByKey = {
      CONSTRUCTION_COSTS_K0: body.CONSTRUCTION_COSTS_K0 ?? null,
      CONSTRUCTION_COSTS_K1: body.CONSTRUCTION_COSTS_K1 ?? null,
      CONSTRUCTION_COSTS_K2: body.CONSTRUCTION_COSTS_K2 ?? null,
      CONSTRUCTION_COSTS_K3: body.CONSTRUCTION_COSTS_K3 ?? null,
      CONSTRUCTION_COSTS_K4: body.CONSTRUCTION_COSTS_K4 ?? null,
    };

    const effectiveZoneId = body.ZONE_ID ?? existing.ZONE_ID ?? null;
    const effectiveZonePercent = body.ZONE_PERCENT ?? existing.ZONE_PERCENT ?? null;
    const revenueFields = await svc.calculateRevenueFields(supabase, { feeMasterId: existing.FEE_MASTER_ID, zoneId: effectiveZoneId, zonePercent: effectiveZonePercent, costsByKey });

    const { data, error } = await supabase
      .from("FEE_CALCULATION_MASTER")
      .update({
        NAME_SHORT: body.NAME_SHORT ?? null,
        NAME_LONG: body.NAME_LONG ?? null,
        PROJECT_ID: body.PROJECT_ID ?? null,
        ZONE_ID: body.ZONE_ID ?? null,
        ZONE_PERCENT: body.ZONE_PERCENT ?? null,
        ...costsByKey,
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
    if (projectErr) return res.status(500).json({ error: projectErr.message });
    if (!project) return res.status(404).json({ error: "Projekt nicht gefunden" });
    if (calcPhasesErr) return res.status(500).json({ error: calcPhasesErr.message });
    if (!Array.isArray(calcPhases) || calcPhases.length === 0) return res.status(400).json({ error: "Es sind keine Leistungsphasen zum Übertragen vorhanden." });

    const phaseIds = Array.from(new Set(calcPhases.map((row) => row.FEE_PHASE_ID).filter(Boolean)));
    const { data: phaseDefs, error: phaseDefsErr } = await supabase.from("FEE_PHASE").select("ID, NAME_SHORT, NAME_LONG").in("ID", phaseIds);
    if (phaseDefsErr) return res.status(500).json({ error: phaseDefsErr.message });
    const phaseMap = new Map((phaseDefs || []).map((row) => [row.ID, row]));

    const extrasPercent = Number(father.EXTRAS_PERCENT ?? 0) || 0;
    const insertRows = calcPhases.map((row) => {
      const phaseDef = phaseMap.get(row.FEE_PHASE_ID) || {};
      const revenue = Number(row.PHASE_REVENUE ?? 0) || 0;
      const extras = (revenue * extrasPercent) / 100;
      return {
        NAME_SHORT: phaseDef.NAME_SHORT || `LPH ${row.FEE_PHASE_ID}`,
        NAME_LONG: phaseDef.NAME_LONG || null,
        REVENUE: revenue, EXTRAS: extras, COSTS: 0,
        PROJECT_ID: calcMaster.PROJECT_ID, FATHER_ID: fatherId,
        EXTRAS_PERCENT: extrasPercent, BILLING_TYPE_ID: 1,
        TENANT_ID: project.TENANT_ID,
        REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0,
        REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
      };
    });

    const { data: createdRows, error: createErr } = await supabase.from("PROJECT_STRUCTURE").insert(insertRows).select("*");
    if (createErr) return res.status(500).json({ error: createErr.message });

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
// GET /api/stammdaten/companies
// ---------------------------------------------------------------------------
async function getCompanies(req, res, supabase) {
  const { data, error } = await supabase.from("COMPANY").select("ID, COMPANY_NAME_1").eq("TENANT_ID", req.tenantId).order("COMPANY_NAME_1", { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/company
// ---------------------------------------------------------------------------
async function postCompany(req, res, supabase) {
  const { company_name_1, company_name_2, street, post_code, city, country_id, tax_id } = req.body || {};
  if (!company_name_1 || typeof company_name_1 !== "string") return res.status(400).json({ error: "company_name_1 is required" });
  if (!street || typeof street !== "string") return res.status(400).json({ error: "street is required" });
  if (!post_code || typeof post_code !== "string") return res.status(400).json({ error: "post_code is required" });
  if (!city || typeof city !== "string") return res.status(400).json({ error: "city is required" });
  if (!country_id || typeof country_id !== "string") return res.status(400).json({ error: "country_id is required" });

  const { data, error } = await supabase.from("COMPANY").insert([{
    COMPANY_NAME_1: company_name_1.trim(),
    COMPANY_NAME_2: (company_name_2 || "").trim() || null,
    STREET: street.trim(), POST_CODE: post_code.trim(), CITY: city.trim(),
    COUNTRY_ID: country_id.trim(), "TAX-ID": (tax_id || "").trim() || null,
    TENANT_ID: req.tenantId ?? null,
  }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/address
// ---------------------------------------------------------------------------
async function postAddress(req, res, supabase) {
  const { address_name_1, address_name_2, street, post_code, city, post_office_box, country_id, customer_number, tax_id, buyer_reference } = req.body || {};
  if (!address_name_1 || typeof address_name_1 !== "string") return res.status(400).json({ error: "address_name_1 is required" });

  const parsedCountryId = typeof country_id === "number" ? country_id : parseInt(country_id, 10);
  if (!parsedCountryId || Number.isNaN(parsedCountryId)) return res.status(400).json({ error: "country_id is required" });

  const { data, error } = await supabase.from("ADDRESS").insert([{
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
  }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
}

// ---------------------------------------------------------------------------
// POST /api/stammdaten/rollen
// ---------------------------------------------------------------------------
async function postRollen(req, res, supabase) {
  const { name_short, name_long } = req.body || {};
  if (!name_short || typeof name_short !== "string") return res.status(400).json({ error: "name_short is required" });

  const insertRow = { NAME_SHORT: name_short.trim(), NAME_LONG: (name_long || "").trim() || null, TENANT_ID: req.tenantId ?? null };

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
  res.json({ data: (data || []).map((r) => ({ ID: r.ID, NAME_LONG: r.SALUTATION ?? null })) });
}

// ---------------------------------------------------------------------------
// GET /api/stammdaten/genders
// ---------------------------------------------------------------------------
async function getGenders(req, res, supabase) {
  const { data, error } = await supabase.from("GENDER").select("ID, GENDER").order("GENDER", { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: (data || []).map((r) => ({ ID: r.ID, NAME_LONG: r.GENDER ?? null })) });
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
    .select('ID, ADDRESS_NAME_1, ADDRESS_NAME_2, STREET, POST_CODE, CITY, POST_OFFICE_BOX, COUNTRY_ID, CUSTOMER_NUMBER, "TAX-ID", BUYER_REFERENCE')
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
  const { address_name_1, address_name_2, street, post_code, city, post_office_box, country_id, customer_number, tax_id, buyer_reference } = req.body || {};
  if (!address_name_1 || !country_id) return res.status(400).json({ error: "ADDRESS_NAME_1 und COUNTRY_ID sind erforderlich" });

  const { data, error } = await supabase.from("ADDRESS").update({
    ADDRESS_NAME_1: address_name_1, ADDRESS_NAME_2: address_name_2 || null,
    STREET: street || null, POST_CODE: post_code || null, CITY: city || null,
    POST_OFFICE_BOX: post_office_box || null, COUNTRY_ID: parseInt(country_id, 10),
    CUSTOMER_NUMBER: customer_number || null, "TAX-ID": tax_id || null, BUYER_REFERENCE: buyer_reference || null,
  }).eq("ID", id).eq("TENANT_ID", req.tenantId).select("*").single();
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

module.exports = {
  postStatus, postTyp, getCountries, getBillingTypes, getFeeGroups, getFeeMasters, getFeeZones,
  postFeeCalcMasterInit, patchFeeCalcMasterBasis, postFeeCalcPhasesInit, patchFeeCalcPhase,
  postFeeCalcPhasesSave, deleteFeeCalcMaster, postFeeCalcAddToStructure,
  getCompanies, postCompany, postAddress, postRollen,
  getSalutations, getGenders, searchAddresses, listAddresses, patchAddress,
  searchContacts, listContacts, patchContact, searchVat, searchPaymentMeans, postContact,
};
