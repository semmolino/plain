const express = require("express");

module.exports = (supabase) => {
  const router = express.Router();

  // Helper: load preset mapping for employee+project from EMPLOYEE2PROJECT
  async function loadEmployee2Project(employeeId, projectId) {
    if (!employeeId || !projectId) return null;

    const { data, error } = await supabase
      .from("EMPLOYEE2PROJECT")
      .select("ROLE_ID, ROLE_NAME_SHORT, ROLE_NAME_LONG, SP_RATE")
      .eq("EMPLOYEE_ID", employeeId)
      .eq("PROJECT_ID", projectId)
      .limit(1);

    if (error) throw new Error(error.message);
    if (!data || !data.length) return null;
    return data[0];
  }


  router.post("/", async (req, res) => {
    const b = req.body;

    // Validate required fields
    if (!b.EMPLOYEE_ID || !b.DATE_VOUCHER || !b.QUANTITY_INT || !b.CP_RATE ||
        !b.QUANTITY_EXT || !b.SP_RATE || !b.POSTING_DESCRIPTION || !b.PROJECT_ID) {
      return res.status(400).json({ error: "Pflichtfelder fehlen" });
    }


    // Load preset values from EMPLOYEE2PROJECT (authoritative)
    let preset = null;
    try {
      preset = await loadEmployee2Project(Number(b.EMPLOYEE_ID), Number(b.PROJECT_ID));
    } catch (e) {
      return res.status(500).json({ error: "Fehler beim Laden EMPLOYEE2PROJECT: " + e.message });
    }

    const effectiveSpRate = preset && preset.SP_RATE != null ? Number(preset.SP_RATE) : Number(b.SP_RATE);
    const roleId = preset ? (preset.ROLE_ID ?? null) : null;
    const roleNameShort = preset ? (preset.ROLE_NAME_SHORT ?? null) : null;
    const roleNameLong = preset ? (preset.ROLE_NAME_LONG ?? null) : null;

    // Step 1: Insert into TEC
    const { error: insertError } = await supabase
      .from("TEC")
      .insert([{
	  EMPLOYEE_ID: b.EMPLOYEE_ID,
	  DATE_VOUCHER: b.DATE_VOUCHER,
	  TIME_START: b.TIME_START || null,
	  TIME_FINISH: b.TIME_FINISH || null,
	  QUANTITY_INT: b.QUANTITY_INT,
	  CP_RATE: b.CP_RATE,
	  CP_TOT: b.QUANTITY_INT * b.CP_RATE,
	  QUANTITY_EXT: b.QUANTITY_EXT,
	  ROLE_ID: roleId,
	  ROLE_NAME_SHORT: roleNameShort,
	  ROLE_NAME_LONG: roleNameLong,
	  SP_RATE: effectiveSpRate,
	  SP_TOT: b.QUANTITY_EXT * effectiveSpRate,
	  POSTING_DESCRIPTION: b.POSTING_DESCRIPTION,
	  PROJECT_ID: b.PROJECT_ID,
	  STRUCTURE_ID: b.STRUCTURE_ID || null
	}]);

    if (insertError) {
      return res.status(500).json({ error: "Fehler beim Speichern in TEC: " + insertError.message });
    }

    // Step 2: Update PROJECT_STRUCTURE.COSTS += QUANTITY_INT * CP_RATE
    // Additional requirement: If BILLING_TYPE_ID == 2 for STRUCTURE_ID,
    // update PROJECT_STRUCTURE revenue-related fields based on TEC (including the just inserted booking).

    // If the booking is not linked to a structure, we're done.
    if (!b.STRUCTURE_ID) {
      return res.json({ success: true });
    }

    const costAddition = b.QUANTITY_INT * b.CP_RATE;

    const { data: currentProjectElement, error: fetchError } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("COSTS, BILLING_TYPE_ID, EXTRAS_PERCENT")
      .eq("ID", b.STRUCTURE_ID)
      .single();

    if (fetchError) {
      return res.status(500).json({ error: "Projekt nicht gefunden: " + fetchError.message });
    }

    const newCost = (currentProjectElement.COSTS || 0) + costAddition;

    // Prepare update payload
    let updatePayload = { COSTS: newCost };

    // If billing type is 2: derive REVENUE from TEC sum(SP_TOT) and update dependent fields
    if (Number(currentProjectElement.BILLING_TYPE_ID) === 2) {
      const { data: tecRows, error: tecError } = await supabase
        .from("TEC")
        .select("SP_TOT")
        .eq("STRUCTURE_ID", b.STRUCTURE_ID);

      if (tecError) {
        return res.status(500).json({ error: "Fehler beim Laden der TEC-Summe: " + tecError.message });
      }

      const revenue = (tecRows || []).reduce((sum, r) => sum + (Number(r.SP_TOT) || 0), 0);

      // Per requirement: REVENUE = sum(TEC.SP_TOT), EXTRAS = REVENUE * EXTRAS_PERCENT / 100,
      // and set the completion percents to 100.
      const extrasPercent = Number(currentProjectElement.EXTRAS_PERCENT) || 0;
      const extras = (revenue * extrasPercent) / 100;

      updatePayload = {
        ...updatePayload,
        REVENUE: revenue,
        EXTRAS: extras,
        REVENUE_COMPLETION_PERCENT: 100,
        EXTRAS_COMPLETION_PERCENT: 100,
        REVENUE_COMPLETION: revenue,
        EXTRAS_COMPLETION: extras,
      };
    }

    // Update PROJECT_STRUCTURE
    let { error: updateError } = await supabase
      .from("PROJECT_STRUCTURE")
      .update(updatePayload)
      .eq("ID", b.STRUCTURE_ID);

    if (updateError) {
      return res.status(500).json({ error: "Fehler beim Update der Projektstruktur: " + updateError.message });
    }

    res.json({ success: true });
  });
	
	
  // Update a booking (TEC) and keep dependent aggregates consistent
  router.patch("/:id", async (req, res) => {
    const id = req.params.id;
    const b = req.body || {};

    if (!id) return res.status(400).json({ error: "ID fehlt" });

    // Load existing TEC row to know current links (STRUCTURE/PROJECT/EMPLOYEE)
    const { data: existing, error: exErr } = await supabase
      .from("TEC")
      .select("ID, STRUCTURE_ID, PROJECT_ID, EMPLOYEE_ID")
      .eq("ID", id)
      .single();

    if (exErr || !existing) {
      return res.status(404).json({ error: "Buchung nicht gefunden: " + (exErr?.message || "") });
    }

    const oldStructureId = existing.STRUCTURE_ID ?? null;

    // Normalize potential FK changes coming from the UI
    const normFk = (v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const s = String(v).trim();
      if (!s || s === "null" || s === "undefined") return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };

    const newEmployeeId = normFk(b.EMPLOYEE_ID);
    const newProjectId = normFk(b.PROJECT_ID);
    const newStructureId = normFk(b.STRUCTURE_ID);

    const quantityInt = Number(b.QUANTITY_INT ?? 0);
    const cpRate = Number(b.CP_RATE ?? 0);
    const quantityExt = Number(b.QUANTITY_EXT ?? 0);
    const spRate = Number(b.SP_RATE ?? 0);

    const cpTot = quantityInt * cpRate;
    const spTot = quantityExt * spRate;

    // Normalize time inputs: Postgres TIME does not accept empty string
    const toNullIfEmpty = (v) => {
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      return s === "" ? null : s;
    };

    const updateTec = {
      DATE_VOUCHER: b.DATE_VOUCHER ?? null,
      TIME_START: toNullIfEmpty(b.TIME_START),
      TIME_FINISH: toNullIfEmpty(b.TIME_FINISH),
      QUANTITY_INT: quantityInt,
      CP_RATE: cpRate,
      CP_TOT: cpTot,
      QUANTITY_EXT: quantityExt,
      SP_RATE: spRate,
      SP_TOT: spTot,
      POSTING_DESCRIPTION: b.POSTING_DESCRIPTION ?? "",
    };

    // Allow changing linkage fields (same mask as create)
    if (newEmployeeId !== undefined) updateTec.EMPLOYEE_ID = newEmployeeId;
    if (newProjectId !== undefined) updateTec.PROJECT_ID = newProjectId;
    if (newStructureId !== undefined) updateTec.STRUCTURE_ID = newStructureId;

    // Load preset values from EMPLOYEE2PROJECT (authoritative for ROLE + SP_RATE)
    const effectiveEmployeeId = (newEmployeeId !== undefined ? newEmployeeId : existing.EMPLOYEE_ID);
    const effectiveProjectId = (newProjectId !== undefined ? newProjectId : existing.PROJECT_ID);

    let preset = null;
    try {
      preset = await loadEmployee2Project(Number(effectiveEmployeeId), Number(effectiveProjectId));
    } catch (e) {
      return res.status(500).json({ error: "Fehler beim Laden EMPLOYEE2PROJECT: " + e.message });
    }

    if (preset && preset.SP_RATE != null) {
      updateTec.ROLE_ID = preset.ROLE_ID ?? null;
      updateTec.ROLE_NAME_SHORT = preset.ROLE_NAME_SHORT ?? null;
      updateTec.ROLE_NAME_LONG = preset.ROLE_NAME_LONG ?? null;
      updateTec.SP_RATE = Number(preset.SP_RATE);
      updateTec.SP_TOT = quantityExt * Number(preset.SP_RATE);
    }

    const { data: updatedTec, error: updErr } = await supabase
      .from("TEC")
      .update(updateTec)
      .eq("ID", id)
      .select("*")
      .single();

    if (updErr) {
      return res.status(500).json({ error: "Fehler beim Aktualisieren: " + updErr.message });
    }

    // Helper: recompute aggregates for one structure (COSTS + billing-type-2 revenue fields)
    const recomputeStructure = async (structureId) => {
      if (!structureId) return;

      const { data: tecRows, error: tecErr } = await supabase
        .from("TEC")
        .select("QUANTITY_INT, CP_RATE, SP_TOT")
        .eq("STRUCTURE_ID", structureId);

      if (tecErr) throw new Error("Fehler beim Laden der TEC-Daten: " + tecErr.message);

      const newCosts = (tecRows || []).reduce(
        (acc, r) => acc + (Number(r.QUANTITY_INT ?? 0) * Number(r.CP_RATE ?? 0)),
        0
      );
      const revenueSum = (tecRows || []).reduce((acc, r) => acc + Number(r.SP_TOT ?? 0), 0);

      const { data: structureRow, error: strErr } = await supabase
        .from("PROJECT_STRUCTURE")
        .select("ID, BILLING_TYPE_ID, EXTRAS_PERCENT")
        .eq("ID", structureId)
        .single();

      if (strErr) throw new Error("Struktur-Element nicht gefunden: " + strErr.message);

      const structureUpdate = { COSTS: newCosts };

      if (Number(structureRow.BILLING_TYPE_ID) === 2) {
        const extrasPercent = Number(structureRow.EXTRAS_PERCENT ?? 0);
        const extras = (revenueSum * extrasPercent) / 100;

        structureUpdate.REVENUE = revenueSum;
        structureUpdate.EXTRAS = extras;
        structureUpdate.REVENUE_COMPLETION_PERCENT = 100;
        structureUpdate.EXTRAS_COMPLETION_PERCENT = 100;
        structureUpdate.REVENUE_COMPLETION = revenueSum;
        structureUpdate.EXTRAS_COMPLETION = extras;
      }

      const { error: psErr } = await supabase
        .from("PROJECT_STRUCTURE")
        .update(structureUpdate)
        .eq("ID", structureId);

      if (psErr) throw new Error("Fehler beim Aktualisieren der Projektstruktur: " + psErr.message);
    };

    // Recompute for old and new structures (in case the booking was moved)
    const affected = new Set([
      oldStructureId,
      (newStructureId !== undefined ? newStructureId : oldStructureId),
    ].filter(Boolean));

    try {
      for (const sid of affected) {
        await recomputeStructure(sid);
      }
    } catch (e) {
      return res.status(500).json({ error: e.message || "Fehler beim Aktualisieren der Projektstruktur" });
    }

    return res.json({ data: updatedTec });
  });



  // Delete a booking (TEC) and keep dependent aggregates consistent
  router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "ID fehlt" });

    // Load existing TEC row to know STRUCTURE_ID
    const { data: existing, error: exErr } = await supabase
      .from("TEC")
      .select("ID, STRUCTURE_ID")
      .eq("ID", id)
      .single();

    if (exErr || !existing) {
      return res.status(404).json({ error: "Buchung nicht gefunden: " + ((exErr && exErr.message) || "") });
    }

    const structureId = existing.STRUCTURE_ID;

    const { error: delErr } = await supabase
      .from("TEC")
      .delete()
      .eq("ID", id);

    if (delErr) {
      return res.status(500).json({ error: "Fehler beim Löschen: " + delErr.message });
    }

    // If the booking is not linked to a structure, we're done.
    if (!structureId) {
      return res.json({ success: true });
    }

    // Recompute COSTS/REVENUE aggregates for this structure based on remaining TEC rows
    const { data: tecRows, error: tecErr } = await supabase
      .from("TEC")
      .select("QUANTITY_INT, CP_RATE, SP_TOT")
      .eq("STRUCTURE_ID", structureId);

    if (tecErr) {
      return res.status(500).json({ error: "Fehler beim Laden der TEC-Daten: " + tecErr.message });
    }

    const newCosts = (tecRows || []).reduce((acc, r) => acc + (Number(r.QUANTITY_INT ?? 0) * Number(r.CP_RATE ?? 0)), 0);
    const revenueSum = (tecRows || []).reduce((acc, r) => acc + Number(r.SP_TOT ?? 0), 0);

    const { data: structureRow, error: strErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, BILLING_TYPE_ID, EXTRAS_PERCENT")
      .eq("ID", structureId)
      .single();

    if (strErr) {
      return res.status(500).json({ error: "Struktur-Element nicht gefunden: " + strErr.message });
    }

    const structureUpdate = { COSTS: newCosts };

    // For billing type 2: derive REVENUE from TEC sum(SP_TOT) and update dependent fields, incl. completion amounts
    if (Number(structureRow.BILLING_TYPE_ID) === 2) {
      const extrasPercent = Number(structureRow.EXTRAS_PERCENT ?? 0);
      const extras = revenueSum * extrasPercent / 100;

      structureUpdate.REVENUE = revenueSum;
      structureUpdate.EXTRAS = extras;
      structureUpdate.REVENUE_COMPLETION_PERCENT = 100;
      structureUpdate.EXTRAS_COMPLETION_PERCENT = 100;
      structureUpdate.REVENUE_COMPLETION = revenueSum;
      structureUpdate.EXTRAS_COMPLETION = extras;
    }

    const { error: psErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .update(structureUpdate)
      .eq("ID", structureId);

    if (psErr) {
      return res.status(500).json({ error: "Fehler beim Aktualisieren der Projektstruktur: " + psErr.message });
    }

    return res.json({ success: true });
  });

router.get("/project/:id", async (req, res) => {
	  const projectId = req.params.id;

	  const { data, error } = await supabase
		.from("TEC")
		.select(`
			  ID, PROJECT_ID, STRUCTURE_ID, EMPLOYEE_ID,
			  DATE_VOUCHER, TIME_START, TIME_FINISH,
		  QUANTITY_INT, CP_RATE, CP_TOT,
		  QUANTITY_EXT, SP_RATE, SP_TOT,
		  POSTING_DESCRIPTION,
		  EMPLOYEE:EMPLOYEE_ID(SHORT_NAME)
		`)
		.eq("PROJECT_ID", projectId)
		.order("DATE_VOUCHER", { ascending: true });

	  if (error) return res.status(500).json({ error: error.message });
	  res.json({ data });
	});

  return router;
};
