"use strict";

// ---------------------------------------------------------------------------
// Fee calculation helpers
// ---------------------------------------------------------------------------

const FEE_ZONE_COLUMN_BY_ROMAN = {
  I:   { min: "ZONE_1", max: "ZONE_2" },
  II:  { min: "ZONE_2", max: "ZONE_3" },
  III: { min: "ZONE_3", max: "ZONE_4" },
  IV:  { min: "ZONE_4", max: "ZONE_5" },
  V:   { min: "ZONE_5", max: "ZONE_TOP" },
};

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function findBounds(rowsAsc, kx) {
  if (!Array.isArray(rowsAsc) || rowsAsc.length === 0 || kx === null) {
    return { lower: null, upper: null };
  }
  let lower = null, upper = null;
  for (const row of rowsAsc) {
    const base = toNumberOrNull(row.BASE);
    if (base === null) continue;
    if (base <= kx) lower = row;
    if (base >= kx) { upper = row; break; }
  }
  if (!lower) lower = rowsAsc[0] || null;
  if (!upper) upper = rowsAsc[rowsAsc.length - 1] || null;
  return { lower, upper };
}

function calculateRevenueLinearInterpolation(kx, lowerBase, upperBase, h1, h2) {
  if ([kx, lowerBase, upperBase, h1, h2].some((x) => x === null)) return null;
  if (upperBase === lowerBase) return h1;
  return h1 + (((kx - lowerBase) * (h2 - h1)) / (upperBase - lowerBase));
}

function resolveRevenueStrategy() {
  return calculateRevenueLinearInterpolation;
}

async function calculateRevenueFields(supabase, { feeMasterId, zoneId, zonePercent, costsByKey }) {
  const empty = { REVENUE_K0: null, REVENUE_K1: null, REVENUE_K2: null, REVENUE_K3: null, REVENUE_K4: null };
  if (!feeMasterId || !zoneId) return empty;

  const { data: zone, error: zoneErr } = await supabase.from("FEE_ZONES").select("ID, NAME_SHORT").eq("ID", zoneId).single();
  if (zoneErr) throw new Error(zoneErr.message);
  if (!zone) throw new Error("FEE_ZONE not found");

  const zoneKeyRaw = String(zone.NAME_SHORT || "").trim().toUpperCase();
  const zoneColumns = FEE_ZONE_COLUMN_BY_ROMAN[zoneKeyRaw];
  if (!zoneColumns) throw new Error(`Unsupported FEE_ZONE.NAME_SHORT "${zone.NAME_SHORT}"`);

  const { data: feeTables, error: tblErr } = await supabase
    .from("FEE_TABLES")
    .select(`BASE, ${zoneColumns.min}, ${zoneColumns.max}`)
    .eq("FEE_MASTER_ID", feeMasterId)
    .order("BASE", { ascending: true, nullsFirst: false });
  if (tblErr) throw new Error(tblErr.message);
  const rows = Array.isArray(feeTables) ? feeTables : [];
  if (!rows.length) throw new Error("No FEE_TABLES rows found for selected FEE_MASTER_ID");

  const strategy = resolveRevenueStrategy();
  const zonePercentNumber = toNumberOrNull(zonePercent) ?? 0;

  const calcOne = (costValue) => {
    const kx = toNumberOrNull(costValue);
    if (kx === null) return null;
    const { lower, upper } = findBounds(rows, kx);
    if (!lower || !upper) return null;
    const k1 = toNumberOrNull(lower.BASE);
    const k2 = toNumberOrNull(upper.BASE);
    const hm1 = toNumberOrNull(lower[zoneColumns.min]);
    const hm2 = toNumberOrNull(upper[zoneColumns.min]);
    const hh1 = toNumberOrNull(lower[zoneColumns.max]);
    const hh2 = toNumberOrNull(upper[zoneColumns.max]);
    const hm = strategy(kx, k1, k2, hm1, hm2);
    const hh = strategy(kx, k1, k2, hh1, hh2);
    if (hm === null || hh === null) return null;
    return hm + ((hh - hm) * (zonePercentNumber / 100));
  };

  return {
    REVENUE_K0: calcOne(costsByKey.CONSTRUCTION_COSTS_K0),
    REVENUE_K1: calcOne(costsByKey.CONSTRUCTION_COSTS_K1),
    REVENUE_K2: calcOne(costsByKey.CONSTRUCTION_COSTS_K2),
    REVENUE_K3: calcOne(costsByKey.CONSTRUCTION_COSTS_K3),
    REVENUE_K4: calcOne(costsByKey.CONSTRUCTION_COSTS_K4),
  };
}

function getRevenueByKx(calcMaster, kx) {
  const key = String(kx || "").trim().toUpperCase();
  const mapping = { K0: calcMaster?.REVENUE_K0, K1: calcMaster?.REVENUE_K1, K2: calcMaster?.REVENUE_K2, K3: calcMaster?.REVENUE_K3, K4: calcMaster?.REVENUE_K4 };
  return toNumberOrNull(mapping[key] ?? null);
}

function calculatePhaseRevenue(feePercent, revenueBase) {
  const pct = toNumberOrNull(feePercent);
  const base = toNumberOrNull(revenueBase);
  if (pct === null || base === null) return null;
  return (pct * base) / 100;
}

async function loadPhaseRowsWithLabels(supabase, calcMasterId) {
  const { data: phaseRows, error: rowsErr } = await supabase
    .from("FEE_CALCULATION_PHASE")
    .select("ID, FEE_MASTER_ID, FEE_PHASE_ID, FEE_PERCENT_BASE, KX, REVENUE_BASE, FEE_PERCENT, PHASE_REVENUE")
    .eq("FEE_MASTER_ID", calcMasterId)
    .order("FEE_PHASE_ID", { ascending: true });
  if (rowsErr) throw new Error(rowsErr.message);

  const phaseIds = Array.from(new Set((phaseRows || []).map((r) => r.FEE_PHASE_ID).filter(Boolean)));
  let phaseMap = new Map();
  if (phaseIds.length) {
    const { data: phases, error: phaseErr } = await supabase.from("FEE_PHASE").select("ID, NAME_SHORT, NAME_LONG, FEE_PERCENT").in("ID", phaseIds);
    if (phaseErr) throw new Error(phaseErr.message);
    phaseMap = new Map((phases || []).map((p) => [p.ID, p]));
  }

  return (phaseRows || []).map((row) => {
    const phase = phaseMap.get(row.FEE_PHASE_ID) || {};
    return {
      ...row,
      PHASE_LABEL: `${phase.NAME_SHORT || ""}: ${phase.NAME_LONG || ""}`.replace(/:\s*$/, ""),
      FEE_PERCENT_BASE: row.FEE_PERCENT_BASE ?? phase.FEE_PERCENT ?? null,
    };
  });
}

function buildProjectProgressRow(structureRow) {
  return {
    STRUCTURE_ID: structureRow.ID,
    REVENUE: structureRow.REVENUE ?? 0,
    EXTRAS_PERCENT: structureRow.EXTRAS_PERCENT ?? 0,
    EXTRAS: structureRow.EXTRAS ?? 0,
    REVENUE_COMPLETION_PERCENT: structureRow.REVENUE_COMPLETION_PERCENT ?? 0,
    EXTRAS_COMPLETION_PERCENT: structureRow.EXTRAS_COMPLETION_PERCENT ?? 0,
    REVENUE_COMPLETION: structureRow.REVENUE_COMPLETION ?? 0,
    EXTRAS_COMPLETION: structureRow.EXTRAS_COMPLETION ?? 0,
  };
}

async function recomputeStructureAggregates(supabase, structureId) {
  if (!structureId) return;

  const { data: structureRow, error: structureErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, BILLING_TYPE_ID, EXTRAS_PERCENT")
    .eq("ID", structureId)
    .single();
  if (structureErr) throw new Error(structureErr.message);
  if (!structureRow) return;

  const { data: tecRows, error: tecErr } = await supabase.from("TEC").select("QUANTITY_INT, CP_RATE, SP_TOT").eq("STRUCTURE_ID", structureId);
  if (tecErr) throw new Error(tecErr.message);

  const costs = (tecRows || []).reduce((sum, row) => sum + ((Number(row.QUANTITY_INT) || 0) * (Number(row.CP_RATE) || 0)), 0);
  const updatePayload = { COSTS: costs };

  if (Number(structureRow.BILLING_TYPE_ID) === 2) {
    const revenue = (tecRows || []).reduce((sum, row) => sum + (Number(row.SP_TOT) || 0), 0);
    const extrasPercent = Number(structureRow.EXTRAS_PERCENT ?? 0) || 0;
    const extras = (revenue * extrasPercent) / 100;
    updatePayload.REVENUE = revenue;
    updatePayload.EXTRAS = extras;
    updatePayload.REVENUE_COMPLETION_PERCENT = 100;
    updatePayload.EXTRAS_COMPLETION_PERCENT = 100;
    updatePayload.REVENUE_COMPLETION = revenue;
    updatePayload.EXTRAS_COMPLETION = extras;
  }

  const { error: updateErr } = await supabase.from("PROJECT_STRUCTURE").update(updatePayload).eq("ID", structureId);
  if (updateErr) throw new Error(updateErr.message);
}

module.exports = {
  toNumberOrNull,
  calculateRevenueFields,
  getRevenueByKx,
  calculatePhaseRevenue,
  loadPhaseRowsWithLabels,
  buildProjectProgressRow,
  recomputeStructureAggregates,
};
