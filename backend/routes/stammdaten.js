const express = require("express");

module.exports = (supabase) => {
  const router = express.Router();

  const FEE_ZONE_COLUMN_BY_ROMAN = {
    I: { min: "ZONE_1", max: "ZONE_2" },
    II: { min: "ZONE_2", max: "ZONE_3" },
    III: { min: "ZONE_3", max: "ZONE_4" },
    IV: { min: "ZONE_4", max: "ZONE_5" },
    V: { min: "ZONE_5", max: "ZONE_TOP" },
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

    let lower = null;
    let upper = null;

    for (const row of rowsAsc) {
      const base = toNumberOrNull(row.BASE);
      if (base === null) continue;
      if (base <= kx) lower = row;
      if (base >= kx) {
        upper = row;
        break;
      }
    }

    if (!lower) lower = rowsAsc[0] || null;
    if (!upper) upper = rowsAsc[rowsAsc.length - 1] || null;
    return { lower, upper };
  }

  // Default interpolation strategy (prepared for future fee-master specific formulas)
  // Official HOAI interpolation per §13:
  // Hx = H1 + ((Kx - K1) * (H2 - H1)) / (K2 - K1)
  function calculateRevenueLinearInterpolation(kx, lowerBase, upperBase, h1, h2) {
    if ([kx, lowerBase, upperBase, h1, h2].some((x) => x === null)) return null;
    if (upperBase === lowerBase) return h1;
    return h1 + (((kx - lowerBase) * (h2 - h1)) / (upperBase - lowerBase));
  }

  function resolveRevenueStrategy(/* feeMasterId */) {
    return calculateRevenueLinearInterpolation;
  }

  async function calculateRevenueFields({ feeMasterId, zoneId, zonePercent, costsByKey }) {
    if (!feeMasterId || !zoneId) {
      return {
        REVENUE_K0: null,
        REVENUE_K1: null,
        REVENUE_K2: null,
        REVENUE_K3: null,
        REVENUE_K4: null,
      };
    }

    const { data: zone, error: zoneErr } = await supabase
      .from("FEE_ZONES")
      .select("ID, NAME_SHORT")
      .eq("ID", zoneId)
      .single();
    if (zoneErr) throw new Error(zoneErr.message);
    if (!zone) throw new Error("FEE_ZONE not found");

    const zoneKeyRaw = String(zone.NAME_SHORT || "").trim().toUpperCase();
    const zoneColumns = FEE_ZONE_COLUMN_BY_ROMAN[zoneKeyRaw];
    if (!zoneColumns) {
      throw new Error(`Unsupported FEE_ZONE.NAME_SHORT "${zone.NAME_SHORT}"`);
    }

    const { data: feeTables, error: tblErr } = await supabase
      .from("FEE_TABLES")
      .select(`BASE, ${zoneColumns.min}, ${zoneColumns.max}`)
      .eq("FEE_MASTER_ID", feeMasterId)
      .order("BASE", { ascending: true, nullsFirst: false });
    if (tblErr) throw new Error(tblErr.message);
    const rows = Array.isArray(feeTables) ? feeTables : [];
    if (!rows.length) {
      throw new Error("No FEE_TABLES rows found for selected FEE_MASTER_ID");
    }

    const strategy = resolveRevenueStrategy(feeMasterId);
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

      const hm = strategy(
        kx,
        k1,
        k2,
        hm1,
        hm2
      );
      const hh = strategy(
        kx,
        k1,
        k2,
        hh1,
        hh2
      );
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
    const mapping = {
      K0: calcMaster?.REVENUE_K0,
      K1: calcMaster?.REVENUE_K1,
      K2: calcMaster?.REVENUE_K2,
      K3: calcMaster?.REVENUE_K3,
      K4: calcMaster?.REVENUE_K4,
    };
    return toNumberOrNull(mapping[key] ?? null);
  }

  function calculatePhaseRevenue(feePercent, revenueBase) {
    const pct = toNumberOrNull(feePercent);
    const base = toNumberOrNull(revenueBase);
    if (pct === null || base === null) return null;
    return (pct * base) / 100;
  }

  async function loadPhaseRowsWithLabels(calcMasterId) {
    const { data: phaseRows, error: rowsErr } = await supabase
      .from("FEE_CALCULATION_PHASE")
      .select("ID, FEE_MASTER_ID, FEE_PHASE_ID, FEE_PERCENT_BASE, KX, REVENUE_BASE, FEE_PERCENT, PHASE_REVENUE")
      .eq("FEE_MASTER_ID", calcMasterId)
      .order("FEE_PHASE_ID", { ascending: true });
    if (rowsErr) throw new Error(rowsErr.message);

    const phaseIds = Array.from(new Set((phaseRows || []).map((r) => r.FEE_PHASE_ID).filter(Boolean)));
    let phaseMap = new Map();
    if (phaseIds.length) {
      const { data: phases, error: phaseErr } = await supabase
        .from("FEE_PHASE")
        .select("ID, NAME_SHORT, NAME_LONG, FEE_PERCENT")
        .in("ID", phaseIds);
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

  async function recomputeStructureAggregates(structureId) {
    if (!structureId) return;

    const { data: structureRow, error: structureErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, BILLING_TYPE_ID, EXTRAS_PERCENT")
      .eq("ID", structureId)
      .single();
    if (structureErr) throw new Error(structureErr.message);
    if (!structureRow) return;

    const { data: tecRows, error: tecErr } = await supabase
      .from("TEC")
      .select("QUANTITY_INT, CP_RATE, SP_TOT")
      .eq("STRUCTURE_ID", structureId);
    if (tecErr) throw new Error(tecErr.message);

    const costs = (tecRows || []).reduce((sum, row) => {
      return sum + ((Number(row.QUANTITY_INT) || 0) * (Number(row.CP_RATE) || 0));
    }, 0);

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

    const { error: updateErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .update(updatePayload)
      .eq("ID", structureId);
    if (updateErr) throw new Error(updateErr.message);
  }

  // Save PROJECT_STATUS
  router.post("/status", async (req, res) => {
    const name_short = req.body.name_short;

    if (!name_short || typeof name_short !== "string") {
      return res.status(400).json({ error: "name_short is required" });
    }

    const { data, error } = await supabase
      .from("PROJECT_STATUS")
      .insert([{ "NAME_SHORT": name_short }]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // Save PROJECT_TYPE
  router.post("/typ", async (req, res) => {
    const name_short = req.body.name_short;

    if (!name_short || typeof name_short !== "string") {
      return res.status(400).json({ error: "name_short is required" });
    }

    const { data, error } = await supabase
      .from("PROJECT_TYPE")
      .insert([{ "NAME_SHORT": name_short }]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List COUNTRIES (for dropdowns)
  router.get("/countries", async (req, res) => {
    const { data, error } = await supabase
      .from("COUNTRY")
      .select("ID, NAME_SHORT, NAME_LONG")
      .order("NAME_LONG", { ascending: true, nullsFirst: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List BILLING_TYPE (for dropdowns)
  // Table: BILLING_TYPE, Display column: BILLING_TYPE
  router.get("/billing-types", async (req, res) => {
    const { data, error } = await supabase
      .from("BILLING_TYPE")
      .select("ID, BILLING_TYPE")
      .order("BILLING_TYPE", { ascending: true, nullsFirst: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List FEE_GROUPS (for Honorarordnungen dropdown)
  router.get("/fee-groups", async (req, res) => {
    const { data, error } = await supabase
      .from("FEE_GROUPS")
      .select("ID, NAME_SHORT, NAME_LONG")
      .order("NAME_SHORT", { ascending: true, nullsFirst: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List FEE_MASTERS filtered by fee_group_id (Leistungsbild dropdown)
  router.get("/fee-masters", async (req, res) => {
    const feeGroupIdRaw = (req.query.fee_group_id || "").toString().trim();
    const feeGroupId = feeGroupIdRaw ? Number.parseInt(feeGroupIdRaw, 10) : null;

    if (feeGroupIdRaw && Number.isNaN(feeGroupId)) {
      return res.status(400).json({ error: "fee_group_id must be a number" });
    }

    let query = supabase
      .from("FEE_MASTERS")
      .select("ID, NAME_SHORT, NAME_LONG, FEE_GROUP_ID")
      .order("NAME_SHORT", { ascending: true, nullsFirst: false });

    if (feeGroupId !== null) {
      query = query.eq("FEE_GROUP_ID", feeGroupId);
    }

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List FEE_ZONES filtered by fee_master_id (Honorarzone dropdown)
  router.get("/fee-zones", async (req, res) => {
    const feeMasterIdRaw = (req.query.fee_master_id || "").toString().trim();
    const feeMasterId = feeMasterIdRaw ? Number.parseInt(feeMasterIdRaw, 10) : null;
    if (!feeMasterId) {
      return res.status(400).json({ error: "fee_master_id is required" });
    }

    const { data, error } = await supabase
      .from("FEE_ZONES")
      .select("ID, NAME_SHORT, NAME_LONG, FEE_MASTER_ID")
      .eq("FEE_MASTER_ID", feeMasterId)
      .order("NAME_SHORT", { ascending: true, nullsFirst: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data: data || [] });
  });

  // Create FEE_CALCULATION_MASTER row from selected FEE_MASTER_ID
  router.post("/fee-calculation-masters/init", async (req, res) => {
    const feeMasterIdRaw = (req.body?.fee_master_id ?? "").toString().trim();
    const feeMasterId = feeMasterIdRaw ? Number.parseInt(feeMasterIdRaw, 10) : null;
    if (!feeMasterId) {
      return res.status(400).json({ error: "fee_master_id is required" });
    }

    const { data: feeMaster, error: fmErr } = await supabase
      .from("FEE_MASTERS")
      .select("ID, NAME_SHORT, NAME_LONG")
      .eq("ID", feeMasterId)
      .single();

    if (fmErr) {
      return res.status(500).json({ error: fmErr.message });
    }
    if (!feeMaster) {
      return res.status(404).json({ error: "FEE_MASTER not found" });
    }

    const insertRow = {
      FEE_MASTER_ID: feeMasterId,
      NAME_SHORT: feeMaster.NAME_SHORT || null,
      NAME_LONG: feeMaster.NAME_LONG || null,
      TENANT_ID: req.tenantId ?? null,
    };

    const { data, error } = await supabase
      .from("FEE_CALCULATION_MASTER")
      .insert([insertRow])
      .select("*")
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // Update page-2 basis fields in FEE_CALCULATION_MASTER
  router.patch("/fee-calculation-masters/:id/basis", async (req, res) => {
    const idRaw = (req.params.id || "").toString().trim();
    const id = idRaw ? Number.parseInt(idRaw, 10) : null;
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }

    try {
      const { data: existing, error: existingErr } = await supabase
        .from("FEE_CALCULATION_MASTER")
        .select("ID, FEE_MASTER_ID, ZONE_ID, ZONE_PERCENT")
        .eq("ID", id)
        .eq("TENANT_ID", req.tenantId)
        .single();
      if (existingErr) {
        return res.status(500).json({ error: existingErr.message });
      }
      if (!existing) {
        return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });
      }

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
      const revenueFields = await calculateRevenueFields({
        feeMasterId: existing.FEE_MASTER_ID,
        zoneId: effectiveZoneId,
        zonePercent: effectiveZonePercent,
        costsByKey,
      });

      const updateRow = {
        NAME_SHORT: body.NAME_SHORT ?? null,
        NAME_LONG: body.NAME_LONG ?? null,
        PROJECT_ID: body.PROJECT_ID ?? null,
        ZONE_ID: body.ZONE_ID ?? null,
        ZONE_PERCENT: body.ZONE_PERCENT ?? null,
        CONSTRUCTION_COSTS_K0: costsByKey.CONSTRUCTION_COSTS_K0,
        CONSTRUCTION_COSTS_K1: costsByKey.CONSTRUCTION_COSTS_K1,
        CONSTRUCTION_COSTS_K2: costsByKey.CONSTRUCTION_COSTS_K2,
        CONSTRUCTION_COSTS_K3: costsByKey.CONSTRUCTION_COSTS_K3,
        CONSTRUCTION_COSTS_K4: costsByKey.CONSTRUCTION_COSTS_K4,
        REVENUE_K0: revenueFields.REVENUE_K0,
        REVENUE_K1: revenueFields.REVENUE_K1,
        REVENUE_K2: revenueFields.REVENUE_K2,
        REVENUE_K3: revenueFields.REVENUE_K3,
        REVENUE_K4: revenueFields.REVENUE_K4,
      };

      const { data, error } = await supabase
        .from("FEE_CALCULATION_MASTER")
        .update(updateRow)
        .eq("ID", id)
        .eq("TENANT_ID", req.tenantId)
        .select("*")
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      res.json({ data });
    } catch (err) {
      return res.status(500).json({ error: err?.message || String(err) });
    }
  });

  router.post("/fee-calculation-masters/:id/phases/init", async (req, res) => {
    const idRaw = (req.params.id || "").toString().trim();
    const id = idRaw ? Number.parseInt(idRaw, 10) : null;
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }

    try {
      const { data: calcMaster, error: calcErr } = await supabase
        .from("FEE_CALCULATION_MASTER")
        .select("ID, FEE_MASTER_ID, REVENUE_K0, REVENUE_K1, REVENUE_K2, REVENUE_K3, REVENUE_K4, TENANT_ID")
        .eq("ID", id)
        .eq("TENANT_ID", req.tenantId)
        .single();
      if (calcErr) {
        return res.status(500).json({ error: calcErr.message });
      }
      if (!calcMaster) {
        return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });
      }

      const { data: existingRows, error: existingErr } = await supabase
        .from("FEE_CALCULATION_PHASE")
        .select("ID")
        .eq("FEE_MASTER_ID", id)
        .limit(1);
      if (existingErr) {
        return res.status(500).json({ error: existingErr.message });
      }

      if (!existingRows || existingRows.length === 0) {
        const { data: feePhases, error: feePhaseErr } = await supabase
          .from("FEE_PHASE")
          .select("ID, NAME_SHORT, NAME_LONG, FEE_PERCENT")
          .eq("FEE_MASTER_ID", calcMaster.FEE_MASTER_ID)
          .order("ID", { ascending: true });
        if (feePhaseErr) {
          return res.status(500).json({ error: feePhaseErr.message });
        }

        const revenueBase = getRevenueByKx(calcMaster, "K0");
        const insertRows = (feePhases || []).map((phase) => ({
          FEE_MASTER_ID: id,
          FEE_PHASE_ID: phase.ID,
          FEE_PERCENT_BASE: phase.FEE_PERCENT ?? null,
          KX: "K0",
          REVENUE_BASE: revenueBase,
          FEE_PERCENT: phase.FEE_PERCENT ?? null,
          PHASE_REVENUE: calculatePhaseRevenue(phase.FEE_PERCENT ?? null, revenueBase),
          TENANT_ID: calcMaster.TENANT_ID ?? null,
        }));

        if (insertRows.length) {
          const { error: insertErr } = await supabase
            .from("FEE_CALCULATION_PHASE")
            .insert(insertRows);
          if (insertErr) {
            return res.status(500).json({ error: insertErr.message });
          }
        }
      }

      const rows = await loadPhaseRowsWithLabels(id);
      return res.json({ data: rows });
    } catch (err) {
      return res.status(500).json({ error: err?.message || String(err) });
    }
  });

  router.patch("/fee-calculation-phases/:id", async (req, res) => {
    const idRaw = (req.params.id || "").toString().trim();
    const id = idRaw ? Number.parseInt(idRaw, 10) : null;
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }

    try {
      const { data: phaseRow, error: phaseErr } = await supabase
        .from("FEE_CALCULATION_PHASE")
        .select("ID, FEE_MASTER_ID, FEE_PHASE_ID, FEE_PERCENT_BASE")
        .eq("ID", id)
        .single();
      if (phaseErr) {
        return res.status(500).json({ error: phaseErr.message });
      }
      if (!phaseRow) {
        return res.status(404).json({ error: "FEE_CALCULATION_PHASE not found" });
      }

      const { data: calcMaster, error: calcErr } = await supabase
        .from("FEE_CALCULATION_MASTER")
        .select("ID, REVENUE_K0, REVENUE_K1, REVENUE_K2, REVENUE_K3, REVENUE_K4")
        .eq("ID", phaseRow.FEE_MASTER_ID)
        .single();
      if (calcErr) {
        return res.status(500).json({ error: calcErr.message });
      }
      if (!calcMaster) {
        return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });
      }

      const body = req.body || {};
      const kx = String(body.KX || "K0").trim().toUpperCase();
      const revenueBase = getRevenueByKx(calcMaster, kx);
      const feePercent = body.FEE_PERCENT ?? null;
      const phaseRevenue = calculatePhaseRevenue(feePercent, revenueBase);

      const updateRow = {
        KX: kx,
        REVENUE_BASE: revenueBase,
        FEE_PERCENT: feePercent,
        PHASE_REVENUE: phaseRevenue,
      };

      const { data, error } = await supabase
        .from("FEE_CALCULATION_PHASE")
        .update(updateRow)
        .eq("ID", id)
        .select("ID, FEE_MASTER_ID, FEE_PHASE_ID, FEE_PERCENT_BASE, KX, REVENUE_BASE, FEE_PERCENT, PHASE_REVENUE")
        .single();
      if (error) {
        return res.status(500).json({ error: error.message });
      }

      const rows = await loadPhaseRowsWithLabels(phaseRow.FEE_MASTER_ID);
      const enriched = rows.find((r) => r.ID === id) || data;
      return res.json({ data: enriched });
    } catch (err) {
      return res.status(500).json({ error: err?.message || String(err) });
    }
  });

  router.post("/fee-calculation-masters/:id/phases/save", async (req, res) => {
    const idRaw = (req.params.id || "").toString().trim();
    const id = idRaw ? Number.parseInt(idRaw, 10) : null;
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }

    try {
      const rowsInput = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (!rowsInput.length) {
        const rows = await loadPhaseRowsWithLabels(id);
        return res.json({ data: rows });
      }

      const { data: calcMaster, error: calcErr } = await supabase
        .from("FEE_CALCULATION_MASTER")
        .select("ID, REVENUE_K0, REVENUE_K1, REVENUE_K2, REVENUE_K3, REVENUE_K4")
        .eq("ID", id)
        .eq("TENANT_ID", req.tenantId)
        .single();
      if (calcErr) {
        return res.status(500).json({ error: calcErr.message });
      }
      if (!calcMaster) {
        return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });
      }

      const { data: existingRows, error: rowsErr } = await supabase
        .from("FEE_CALCULATION_PHASE")
        .select("ID, FEE_MASTER_ID")
        .eq("FEE_MASTER_ID", id);
      if (rowsErr) {
        return res.status(500).json({ error: rowsErr.message });
      }

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
          const revenueBase = getRevenueByKx(calcMaster, row.kx);
          const phaseRevenue = calculatePhaseRevenue(row.feePercent, revenueBase);
          const { error: updateErr } = await supabase
            .from("FEE_CALCULATION_PHASE")
            .update({
              KX: row.kx,
              REVENUE_BASE: revenueBase,
              FEE_PERCENT: row.feePercent,
              PHASE_REVENUE: phaseRevenue,
            })
            .eq("ID", row.id)
            .eq("FEE_MASTER_ID", id);
          if (updateErr) throw new Error(updateErr.message);
        })
      );

      const rows = await loadPhaseRowsWithLabels(id);
      return res.json({ data: rows });
    } catch (err) {
      return res.status(500).json({ error: err?.message || String(err) });
    }
  });

  router.delete("/fee-calculation-masters/:id", async (req, res) => {
    const idRaw = (req.params.id || "").toString().trim();
    const id = idRaw ? Number.parseInt(idRaw, 10) : null;
    if (!id) return res.status(400).json({ error: "id is required" });

    try {
      const { error: phaseErr } = await supabase
        .from("FEE_CALCULATION_PHASE")
        .delete()
        .eq("FEE_MASTER_ID", id);
      if (phaseErr) return res.status(500).json({ error: phaseErr.message });

      const { error: masterErr } = await supabase
        .from("FEE_CALCULATION_MASTER")
        .delete()
        .eq("ID", id)
        .eq("TENANT_ID", req.tenantId);
      if (masterErr) return res.status(500).json({ error: masterErr.message });

      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err?.message || String(err) });
    }
  });

  router.post("/fee-calculation-masters/:id/add-to-project-structure", async (req, res) => {
    const idRaw = (req.params.id || "").toString().trim();
    const id = idRaw ? Number.parseInt(idRaw, 10) : null;
    const fatherIdRaw = (req.body?.father_id ?? "").toString().trim();
    const fatherId = fatherIdRaw ? Number.parseInt(fatherIdRaw, 10) : null;
    if (!id) return res.status(400).json({ error: "id is required" });
    if (!fatherId) return res.status(400).json({ error: "father_id is required" });

    try {
      const { data: calcMaster, error: calcErr } = await supabase
        .from("FEE_CALCULATION_MASTER")
        .select("ID, PROJECT_ID")
        .eq("ID", id)
        .eq("TENANT_ID", req.tenantId)
        .single();
      if (calcErr) return res.status(500).json({ error: calcErr.message });
      if (!calcMaster) return res.status(404).json({ error: "FEE_CALCULATION_MASTER not found" });
      if (!calcMaster.PROJECT_ID) {
        return res.status(400).json({ error: "Für die Honorarberechnung ist kein Projekt ausgewählt." });
      }

      const [
        { data: project, error: projectErr },
        { data: father, error: fatherErr },
        { data: calcPhases, error: calcPhasesErr },
      ] = await Promise.all([
        supabase
          .from("PROJECT")
          .select("ID, TENANT_ID")
          .eq("ID", calcMaster.PROJECT_ID)
          .single(),
        supabase
          .from("PROJECT_STRUCTURE")
          .select("ID, PROJECT_ID, NAME_SHORT, NAME_LONG, EXTRAS_PERCENT")
          .eq("ID", fatherId)
          .single(),
        supabase
          .from("FEE_CALCULATION_PHASE")
          .select("ID, FEE_PHASE_ID, FEE_PERCENT, PHASE_REVENUE")
          .eq("FEE_MASTER_ID", id)
          .order("FEE_PHASE_ID", { ascending: true }),
      ]);
      if (fatherErr) return res.status(500).json({ error: fatherErr.message });
      if (!father) return res.status(404).json({ error: "Übergeordnetes Projektelement nicht gefunden" });
      if (String(father.PROJECT_ID) !== String(calcMaster.PROJECT_ID)) {
        return res.status(400).json({ error: "Das übergeordnete Projektelement gehört nicht zum ausgewählten Projekt." });
      }
      if (projectErr) return res.status(500).json({ error: projectErr.message });
      if (!project) return res.status(404).json({ error: "Projekt nicht gefunden" });
      if (calcPhasesErr) return res.status(500).json({ error: calcPhasesErr.message });
      if (!Array.isArray(calcPhases) || calcPhases.length === 0) {
        return res.status(400).json({ error: "Es sind keine Leistungsphasen zum Übertragen vorhanden." });
      }

      const phaseIds = Array.from(new Set(calcPhases.map((row) => row.FEE_PHASE_ID).filter(Boolean)));
      const { data: phaseDefs, error: phaseDefsErr } = await supabase
        .from("FEE_PHASE")
        .select("ID, NAME_SHORT, NAME_LONG")
        .in("ID", phaseIds);
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
          REVENUE: revenue,
          EXTRAS: extras,
          COSTS: 0,
          PROJECT_ID: calcMaster.PROJECT_ID,
          FATHER_ID: fatherId,
          EXTRAS_PERCENT: extrasPercent,
          BILLING_TYPE_ID: 1,
          TENANT_ID: project.TENANT_ID,
          REVENUE_COMPLETION_PERCENT: 0,
          EXTRAS_COMPLETION_PERCENT: 0,
          REVENUE_COMPLETION: 0,
          EXTRAS_COMPLETION: 0,
        };
      });

      const { data: createdRows, error: createErr } = await supabase
        .from("PROJECT_STRUCTURE")
        .insert(insertRows)
        .select("*");
      if (createErr) return res.status(500).json({ error: createErr.message });

      try {
        const progressRows = (createdRows || []).map(buildProjectProgressRow);
        if (progressRows.length) {
          const { error: progressErr } = await supabase.from("PROJECT_PROGRESS").insert(progressRows);
          if (progressErr) {
            return res.status(500).json({ error: "Projektstruktur angelegt, aber PROJECT_PROGRESS fehlgeschlagen: " + progressErr.message });
          }
        }
      } catch (progressOuterErr) {
        return res.status(500).json({ error: progressOuterErr?.message || String(progressOuterErr) });
      }

      let movedTecCount = 0;
      let movedToName = "";
      const firstCreated = Array.isArray(createdRows) && createdRows.length ? createdRows[0] : null;
      if (firstCreated) {
        const { data: movedTecRows, error: moveErr } = await supabase
          .from("TEC")
          .update({ STRUCTURE_ID: firstCreated.ID })
          .eq("STRUCTURE_ID", fatherId)
          .select("ID");
        if (moveErr) return res.status(500).json({ error: moveErr.message });

        movedTecCount = Array.isArray(movedTecRows) ? movedTecRows.length : 0;
        if (movedTecCount > 0) {
          await Promise.all([
            recomputeStructureAggregates(fatherId),
            recomputeStructureAggregates(firstCreated.ID),
          ]);
          movedToName = [firstCreated.NAME_SHORT, firstCreated.NAME_LONG].filter(Boolean).join(": ");
        }
      }

      const fatherName = [father.NAME_SHORT, father.NAME_LONG].filter(Boolean).join(": ");
      const message = movedTecCount > 0
        ? `${createdRows.length} Elemente wurden angelegt. ${movedTecCount} Buchungen wurden von ${fatherName || `#${fatherId}`} nach ${movedToName || `#${firstCreated?.ID}`} verschoben.`
        : `${createdRows.length} Elemente wurden angelegt.`;

      return res.json({
        success: true,
        data: createdRows || [],
        moved_tec_count: movedTecCount,
        message,
      });
    } catch (err) {
      return res.status(500).json({ error: err?.message || String(err) });
    }
  });

  // List COMPANY (for dropdowns)
  // Table: COMPANY, Display column: COMPANY_NAME_1
  router.get("/companies", async (req, res) => {
    const { data, error } = await supabase
      .from("COMPANY")
      .select("ID, COMPANY_NAME_1")
      .eq("TENANT_ID", req.tenantId)
      .order("COMPANY_NAME_1", { ascending: true, nullsFirst: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // Save COMPANY master data
  router.post("/company", async (req, res) => {
    const {
      company_name_1,
      company_name_2,
      street,
      post_code,
      city,
      country_id,
      tax_id
    } = req.body || {};

    // Minimal validation
    if (!company_name_1 || typeof company_name_1 !== "string") {
      return res.status(400).json({ error: "company_name_1 is required" });
    }
    if (!street || typeof street !== "string") {
      return res.status(400).json({ error: "street is required" });
    }
    if (!post_code || typeof post_code !== "string") {
      return res.status(400).json({ error: "post_code is required" });
    }
    if (!city || typeof city !== "string") {
      return res.status(400).json({ error: "city is required" });
    }
    if (!country_id || typeof country_id !== "string") {
      return res.status(400).json({ error: "country_id is required" });
    }

    const insertRow = {
      COMPANY_NAME_1: company_name_1.trim(),
      COMPANY_NAME_2: (company_name_2 || "").trim() || null,
      STREET: street.trim(),
      POST_CODE: post_code.trim(),
      CITY: city.trim(),
      COUNTRY_ID: country_id.trim(),
      "TAX-ID": (tax_id || "").trim() || null,
      TENANT_ID: req.tenantId ?? null,
    };

    const { data, error } = await supabase
      .from("COMPANY")
      .insert([insertRow]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // Save ADDRESS master data
  router.post("/address", async (req, res) => {
    const {
      address_name_1,
      address_name_2,
      street,
      post_code,
      city,
      post_office_box,
      country_id,
      customer_number,
      tax_id,
      buyer_reference
    } = req.body || {};

    if (!address_name_1 || typeof address_name_1 !== "string") {
      return res.status(400).json({ error: "address_name_1 is required" });
    }

    const parsedCountryId =
      typeof country_id === "number" ? country_id : parseInt(country_id, 10);

    if (!parsedCountryId || Number.isNaN(parsedCountryId)) {
      return res.status(400).json({ error: "country_id is required" });
    }

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

    const { data, error } = await supabase
      .from("ADDRESS")
      .insert([insertRow]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // Save Rollen master data
  // Note: Some schemas use a dedicated table (e.g. ROLE/ROLE_TYPE). If that table
  // is not present, we fall back to ADDRESS to align with the user's stated table.
  router.post("/rollen", async (req, res) => {
    const { name_short, name_long } = req.body || {};

    if (!name_short || typeof name_short !== "string") {
      return res.status(400).json({ error: "name_short is required" });
    }

    const insertRow = {
      NAME_SHORT: name_short.trim(),
      NAME_LONG: (name_long || "").trim() || null,
      TENANT_ID: req.tenantId ?? null,
    };

    // Try ROLE first (most likely for "Rollen"), then fall back to ADDRESS
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

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data, table: usedTable });
  });
// Load SALUTATION for dropdowns
// Table: SALUTATION, Display column: SALUTATION
router.get("/salutations", async (req, res) => {
  const { data, error } = await supabase
    .from("SALUTATION")
    .select("ID, SALUTATION")
    .order("SALUTATION", { ascending: true, nullsFirst: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Normalize to {ID, NAME_LONG} expected by the frontend
  const normalized = (data || []).map((r) => ({
    ID: r.ID,
    NAME_LONG: r.SALUTATION ?? null
  }));

  res.json({ data: normalized });
});
// Load GENDER for dropdowns
// Table: GENDER, Display column: GENDER
router.get("/genders", async (req, res) => {
  const { data, error } = await supabase
    .from("GENDER")
    .select("ID, GENDER")
    .order("GENDER", { ascending: true, nullsFirst: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Normalize to {ID, NAME_LONG} expected by the frontend
  const normalized = (data || []).map((r) => ({
    ID: r.ID,
    NAME_LONG: r.GENDER ?? null
  }));

  res.json({ data: normalized });
});


  // Search ADDRESS by ADDRESS_NAME_1 (for contacts)


  router.get("/addresses/search", async (req, res) => {
    const q = (req.query.q || "").toString().trim();

    if (!q || q.length < 2) {
      return res.json({ data: [] });
    }

    const { data, error } = await supabase
      .from("ADDRESS")
      .select("ID, ADDRESS_NAME_1")
      .eq("TENANT_ID", req.tenantId)
      .ilike("ADDRESS_NAME_1", `%${q}%`)
      .limit(20);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List ADDRESS (for Anschriftenliste)
  router.get("/addresses/list", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "2000", 10) || 2000, 5000);

    const { data: addresses, error: aErr } = await supabase
      .from("ADDRESS")
      .select('ID, ADDRESS_NAME_1, ADDRESS_NAME_2, STREET, POST_CODE, CITY, POST_OFFICE_BOX, COUNTRY_ID, CUSTOMER_NUMBER, "TAX-ID", BUYER_REFERENCE')
      .eq("TENANT_ID", req.tenantId)
      .order("ADDRESS_NAME_1", { ascending: true })
      .limit(limit);

    if (aErr) return res.status(500).json({ error: aErr.message });

    // Load country names for display (safe even without FK relationships)
    const { data: countries, error: cErr } = await supabase
      .from("COUNTRY")
      .select("ID, NAME_LONG, NAME_SHORT")
      .order("NAME_LONG", { ascending: true })
      .limit(5000);

    if (cErr) return res.status(500).json({ error: cErr.message });

    const countryMap = new Map((countries || []).map(c => [String(c.ID), (c.NAME_LONG || c.NAME_SHORT || "").toString()]));

    const normalized = (addresses || []).map((r) => ({
      ...r,
      TAX_ID: r["TAX-ID"] ?? null,
      COUNTRY: countryMap.get(String(r.COUNTRY_ID)) || "",
    }));

    res.json({ data: normalized });
  });

  // Update ADDRESS (for Anschriftenliste edit modal)
  router.patch("/addresses/:id", async (req, res) => {
    const id = req.params.id;
    const {
      address_name_1,
      address_name_2,
      street,
      post_code,
      city,
      post_office_box,
      country_id,
      customer_number,
      tax_id,
      buyer_reference,
    } = req.body || {};

    if (!address_name_1 || !country_id) {
      return res.status(400).json({ error: "ADDRESS_NAME_1 und COUNTRY_ID sind erforderlich" });
    }

    const updateRow = {
      ADDRESS_NAME_1: address_name_1,
      ADDRESS_NAME_2: address_name_2 || null,
      STREET: street || null,
      POST_CODE: post_code || null,
      CITY: city || null,
      POST_OFFICE_BOX: post_office_box || null,
      COUNTRY_ID: parseInt(country_id, 10),
      CUSTOMER_NUMBER: customer_number || null,
      "TAX-ID": tax_id || null,
      BUYER_REFERENCE: buyer_reference || null,
    };

    const { data, error } = await supabase
      .from("ADDRESS")
      .update(updateRow)
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Add COUNTRY + TAX_ID normalization for frontend consistency
    let countryName = "";
    const { data: cData } = await supabase.from("COUNTRY").select("NAME_LONG, NAME_SHORT").eq("ID", data.COUNTRY_ID).maybeSingle();
    if (cData) countryName = cData.NAME_LONG || cData.NAME_SHORT || "";

    res.json({
      data: {
        ...data,
        TAX_ID: data["TAX-ID"] ?? null,
        COUNTRY: countryName,
      },
    });
  });

  // Search CONTACTS by FIRST_NAME / LAST_NAME, filtered by ADDRESS_ID (for Projekte -> Kontakt)
  router.get("/contacts/search", async (req, res) => {
    const q = (req.query.q || "").toString().trim();
    const addressIdRaw = (req.query.address_id || "").toString().trim();

    if (!addressIdRaw) {
      return res.json({ data: [] });
    }

    const parsedAddressId = parseInt(addressIdRaw, 10);
    if (!parsedAddressId || Number.isNaN(parsedAddressId)) {
      return res.json({ data: [] });
    }

    if (!q || q.length < 2) {
      return res.json({ data: [] });
    }

    const { data, error } = await supabase
      .from("CONTACTS")
      .select("ID, FIRST_NAME, LAST_NAME, ADDRESS_ID")
      .eq("TENANT_ID", req.tenantId)
      .eq("ADDRESS_ID", parsedAddressId)
      .or(`FIRST_NAME.ilike.%${q}%,LAST_NAME.ilike.%${q}%`)
      .order("LAST_NAME", { ascending: true })
      .limit(20);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List CONTACTS (for Kontaktliste)
  router.get("/contacts/list", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "2000", 10) || 2000, 5000);

    const { data: contacts, error: cErr } = await supabase
      .from("CONTACTS")
      .select("ID, TITLE, FIRST_NAME, LAST_NAME, EMAIL, MOBILE, SALUTATION_ID, GENDER_ID, ADDRESS_ID")
      .eq("TENANT_ID", req.tenantId)
      .order("LAST_NAME", { ascending: true })
      .limit(limit);
    if (cErr) return res.status(500).json({ error: cErr.message });

    const [{ data: salutations, error: sErr }, { data: genders, error: gErr }, { data: addresses, error: aErr }] = await Promise.all([
      supabase.from("SALUTATION").select("ID, SALUTATION").limit(5000),
      supabase.from("GENDER").select("ID, GENDER").limit(5000),
      supabase.from("ADDRESS").select("ID, ADDRESS_NAME_1").limit(5000),
    ]);

    if (sErr) return res.status(500).json({ error: sErr.message });
    if (gErr) return res.status(500).json({ error: gErr.message });
    if (aErr) return res.status(500).json({ error: aErr.message });

    const salMap = new Map((salutations || []).map(s => [String(s.ID), (s.SALUTATION || "").toString()]));
    const genMap = new Map((genders || []).map(g => [String(g.ID), (g.GENDER || "").toString()]));
    const addrMap = new Map((addresses || []).map(a => [String(a.ID), (a.ADDRESS_NAME_1 || "").toString()]));

    const normalized = (contacts || []).map((r) => ({
      ...r,
      NAME: `${r.FIRST_NAME || ""} ${r.LAST_NAME || ""}`.trim(),
      SALUTATION: salMap.get(String(r.SALUTATION_ID)) || "",
      GENDER: genMap.get(String(r.GENDER_ID)) || "",
      ADDRESS: addrMap.get(String(r.ADDRESS_ID)) || "",
    }));

    res.json({ data: normalized });
  });

  // Update CONTACTS (for Kontaktliste edit modal)
  router.patch("/contacts/:id", async (req, res) => {
    const id = req.params.id;
    const {
      title,
      first_name,
      last_name,
      email,
      mobile,
      salutation_id,
      gender_id,
      address_id,
    } = req.body || {};

    if (!first_name || !last_name || !salutation_id || !gender_id || !address_id) {
      return res.status(400).json({ error: "Vorname, Nachname, Anrede, Geschlecht und Adresse sind erforderlich" });
    }

    const updateRow = {
      TITLE: title || null,
      FIRST_NAME: first_name,
      LAST_NAME: last_name,
      EMAIL: email || null,
      MOBILE: mobile || null,
      SALUTATION_ID: parseInt(salutation_id, 10),
      GENDER_ID: parseInt(gender_id, 10),
      ADDRESS_ID: parseInt(address_id, 10),
    };

    const { data, error } = await supabase
      .from("CONTACTS")
      .update(updateRow)
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // hydrate display fields
    const [{ data: s }, { data: g }, { data: a }] = await Promise.all([
      supabase.from("SALUTATION").select("SALUTATION").eq("ID", data.SALUTATION_ID).maybeSingle(),
      supabase.from("GENDER").select("GENDER").eq("ID", data.GENDER_ID).maybeSingle(),
      supabase.from("ADDRESS").select("ADDRESS_NAME_1").eq("ID", data.ADDRESS_ID).maybeSingle(),
    ]);

    res.json({
      data: {
        ...data,
        NAME: `${data.FIRST_NAME || ""} ${data.LAST_NAME || ""}`.trim(),
        SALUTATION: s?.SALUTATION || "",
        GENDER: g?.GENDER || "",
        ADDRESS: a?.ADDRESS_NAME_1 || "",
      },
    });
  });

  // Search VAT (for Abschlagsrechnungen wizard)
  // Table: VAT, columns: VAT, VAT_PERCENT
  router.get("/vat/search", async (req, res) => {
    const q = (req.query.q || "").toString().trim();
    if (!q || q.length < 1) return res.json({ data: [] });

    const { data, error } = await supabase
      .from("VAT")
      .select("ID, VAT, VAT_PERCENT")
      .ilike("VAT", `%${q}%`)
      .order("VAT_PERCENT", { ascending: true })
      .limit(20);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // Search PAYMENT_MEANS (for Abschlagsrechnungen wizard)
  // Table: PAYMENT_MEANS, columns: NAME_SHORT, NAME_LONG
  router.get("/payment-means/search", async (req, res) => {
    const q = (req.query.q || "").toString().trim();
    if (!q || q.length < 2) return res.json({ data: [] });

    const { data, error } = await supabase
      .from("PAYMENT_MEANS")
      .select("ID, NAME_SHORT, NAME_LONG")
      .or(`NAME_SHORT.ilike.%${q}%,NAME_LONG.ilike.%${q}%`)
      .order("NAME_SHORT", { ascending: true })
      .limit(20);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // Save CONTACTS
  router.post("/contacts", async (req, res) => {
    const {
      title,
      first_name,
      last_name,
      email,
      mobile,
      salutation_id,
      gender_id,
      address_id
    } = req.body || {};

    if (!first_name || typeof first_name !== "string" || !first_name.trim()) {
      return res.status(400).json({ error: "first_name is required" });
    }

    if (!last_name || typeof last_name !== "string" || !last_name.trim()) {
      return res.status(400).json({ error: "last_name is required" });
    }

    const parsedSalutationId =
      typeof salutation_id === "number"
        ? salutation_id
        : parseInt(salutation_id, 10);

    const parsedGenderId =
      typeof gender_id === "number" ? gender_id : parseInt(gender_id, 10);

    const parsedAddressId =
      typeof address_id === "number" ? address_id : parseInt(address_id, 10);

    if (!parsedSalutationId || Number.isNaN(parsedSalutationId)) {
      return res.status(400).json({ error: "salutation_id is required" });
    }

    if (!parsedGenderId || Number.isNaN(parsedGenderId)) {
      return res.status(400).json({ error: "gender_id is required" });
    }

    if (!parsedAddressId || Number.isNaN(parsedAddressId)) {
      return res.status(400).json({ error: "address_id is required" });
    }

    const insertRow = {
      TITLE: (title || "").trim() || null,
      FIRST_NAME: first_name.trim(),
      LAST_NAME: last_name.trim(),
      EMAIL: (email || "").trim() || null,
      MOBILE: (mobile || "").trim() || null,
      SALUTATION_ID: parsedSalutationId,
      GENDER_ID: parsedGenderId,
      ADDRESS_ID: parsedAddressId,
      TENANT_ID: req.tenantId ?? null,
    };

    const { data, error } = await supabase.from("CONTACTS").insert([insertRow]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  return router;
};
