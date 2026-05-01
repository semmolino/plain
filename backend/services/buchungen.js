"use strict";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadEmployee2Project(supabase, employeeId, projectId) {
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

async function recomputeStructure(supabase, structureId) {
  if (!structureId) return;

  const { data: tecRows, error: tecErr } = await supabase
    .from("TEC")
    .select("QUANTITY_INT, CP_RATE, SP_TOT")
    .eq("STRUCTURE_ID", structureId);
  if (tecErr) throw new Error("Fehler beim Laden der TEC-Daten: " + tecErr.message);

  const newCosts = (tecRows || []).reduce(
    (acc, r) => acc + Number(r.QUANTITY_INT ?? 0) * Number(r.CP_RATE ?? 0),
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

  const { error: psErr } = await supabase.from("PROJECT_STRUCTURE").update(structureUpdate).eq("ID", structureId);
  if (psErr) throw new Error("Fehler beim Aktualisieren der Projektstruktur: " + psErr.message);
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

async function createTimerDraft(supabase, { body }) {
  const b = body;
  if (!b.EMPLOYEE_ID || !b.DATE_VOUCHER || !b.STRUCTURE_ID || !b.PROJECT_ID) {
    throw { status: 400, message: "Pflichtfelder fehlen" };
  }

  const { data: projRow, error: projErr } = await supabase
    .from("PROJECT")
    .select("TENANT_ID")
    .eq("ID", b.PROJECT_ID)
    .maybeSingle();
  if (projErr) throw { status: 500, message: "Fehler beim Laden des Projekts: " + projErr.message };
  const resolvedTenantId = projRow?.TENANT_ID ?? null;

  const preset = await loadEmployee2Project(supabase, Number(b.EMPLOYEE_ID), Number(b.PROJECT_ID));

  const quantityInt = Number(b.QUANTITY_INT ?? 0);
  const quantityExt = quantityInt;
  const cpRate = Number(b.CP_RATE ?? 0);
  const spRate = preset?.SP_RATE != null ? Number(preset.SP_RATE) : 0;

  const { data: inserted, error: insErr } = await supabase.from("TEC").insert([{
    TENANT_ID: resolvedTenantId,
    STATUS: "DRAFT",
    EMPLOYEE_ID: b.EMPLOYEE_ID,
    DATE_VOUCHER: b.DATE_VOUCHER,
    TIME_START: b.TIME_START || null,
    TIME_FINISH: b.TIME_FINISH || null,
    QUANTITY_INT: quantityInt,
    CP_RATE: cpRate,
    CP_TOT: quantityInt * cpRate,
    QUANTITY_EXT: quantityExt,
    ROLE_ID: preset?.ROLE_ID ?? null,
    ROLE_NAME_SHORT: preset?.ROLE_NAME_SHORT ?? null,
    ROLE_NAME_LONG: preset?.ROLE_NAME_LONG ?? null,
    SP_RATE: spRate,
    SP_TOT: quantityExt * spRate,
    POSTING_DESCRIPTION: b.POSTING_DESCRIPTION || "",
    PROJECT_ID: b.PROJECT_ID,
    STRUCTURE_ID: b.STRUCTURE_ID,
  }]).select("ID").single();

  if (insErr) throw { status: 500, message: "Fehler beim Speichern des Entwurfs: " + insErr.message };
  return inserted;
}

async function listDraftsByEmployee(supabase, { employeeId, date }) {
  if (!employeeId || !date) throw { status: 400, message: "employee_id und date sind erforderlich" };

  const { data, error } = await supabase
    .from("TEC")
    .select(`
      ID, PROJECT_ID, STRUCTURE_ID, EMPLOYEE_ID,
      DATE_VOUCHER, TIME_START, TIME_FINISH,
      QUANTITY_INT, CP_RATE, CP_TOT,
      QUANTITY_EXT, SP_RATE, SP_TOT,
      POSTING_DESCRIPTION, STATUS,
      PROJECT:PROJECT_ID(NAME_SHORT),
      STRUCTURE:STRUCTURE_ID(NAME_SHORT, NAME_LONG)
    `)
    .eq("EMPLOYEE_ID", employeeId)
    .eq("DATE_VOUCHER", date)
    .eq("STATUS", "DRAFT")
    .order("TIME_START", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function confirmDrafts(supabase, { ids }) {
  if (!Array.isArray(ids) || !ids.length) throw { status: 400, message: "ids fehlen" };

  const { data: rows, error: fetchErr } = await supabase
    .from("TEC")
    .select("ID, STRUCTURE_ID, STATUS")
    .in("ID", ids);
  if (fetchErr) throw fetchErr;

  const draftIds = (rows || []).filter(r => r.STATUS === "DRAFT").map(r => r.ID);
  if (!draftIds.length) return { confirmed: 0 };

  const { error: updErr } = await supabase
    .from("TEC")
    .update({ STATUS: "CONFIRMED" })
    .in("ID", draftIds);
  if (updErr) throw { status: 500, message: "Fehler beim Freigeben: " + updErr.message };

  const affectedStructures = [...new Set((rows || []).map(r => r.STRUCTURE_ID).filter(Boolean))];
  for (const sid of affectedStructures) {
    await recomputeStructure(supabase, sid);
  }

  return { confirmed: draftIds.length };
}

async function deleteDraft(supabase, { id }) {
  const { data: row, error: fetchErr } = await supabase
    .from("TEC")
    .select("ID, STATUS")
    .eq("ID", id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw { status: 404, message: "Eintrag nicht gefunden" };
  if (row.STATUS !== "DRAFT") throw { status: 400, message: "Nur Entwürfe können gelöscht werden" };

  const { error } = await supabase.from("TEC").delete().eq("ID", id);
  if (error) throw error;
}

async function patchDraftDescription(supabase, { id, description }) {
  const { data: row, error: fetchErr } = await supabase
    .from("TEC").select("ID, STATUS").eq("ID", id).maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw { status: 404, message: "Eintrag nicht gefunden" };
  if (row.STATUS !== "DRAFT") throw { status: 400, message: "Nur Entwürfe können bearbeitet werden" };

  const { error } = await supabase.from("TEC")
    .update({ POSTING_DESCRIPTION: description })
    .eq("ID", id);
  if (error) throw error;
}

async function createBuchung(supabase, { body, tenantId }) {
  const b = body;

  if (!b.EMPLOYEE_ID || !b.DATE_VOUCHER || !b.QUANTITY_INT || !b.CP_RATE ||
      !b.QUANTITY_EXT || !b.SP_RATE || !b.POSTING_DESCRIPTION || !b.PROJECT_ID) {
    throw { status: 400, message: "Pflichtfelder fehlen" };
  }

  const { data: projRow, error: projErr } = await supabase
    .from("PROJECT")
    .select("TENANT_ID")
    .eq("ID", b.PROJECT_ID)
    .maybeSingle();
  if (projErr) throw { status: 500, message: "Fehler beim Laden des Projekts: " + projErr.message };
  const resolvedTenantId = projRow?.TENANT_ID ?? null;

  let preset = null;
  try {
    preset = await loadEmployee2Project(supabase, Number(b.EMPLOYEE_ID), Number(b.PROJECT_ID));
  } catch (e) {
    throw { status: 500, message: "Fehler beim Laden EMPLOYEE2PROJECT: " + e.message };
  }

  const effectiveSpRate = preset && preset.SP_RATE != null ? Number(preset.SP_RATE) : Number(b.SP_RATE);
  const roleId = preset ? (preset.ROLE_ID ?? null) : null;
  const roleNameShort = preset ? (preset.ROLE_NAME_SHORT ?? null) : null;
  const roleNameLong = preset ? (preset.ROLE_NAME_LONG ?? null) : null;

  const { error: insertError } = await supabase.from("TEC").insert([{
    TENANT_ID: resolvedTenantId,
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
    STRUCTURE_ID: b.STRUCTURE_ID || null,
  }]);

  if (insertError) throw { status: 500, message: "Fehler beim Speichern in TEC: " + insertError.message };

  if (!b.STRUCTURE_ID) return;

  const costAddition = b.QUANTITY_INT * b.CP_RATE;
  const { data: currentProjectElement, error: fetchError } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("COSTS, BILLING_TYPE_ID, EXTRAS_PERCENT")
    .eq("ID", b.STRUCTURE_ID)
    .single();

  if (fetchError) throw { status: 500, message: "Projekt nicht gefunden: " + fetchError.message };

  const newCost = (currentProjectElement.COSTS || 0) + costAddition;
  let updatePayload = { COSTS: newCost };

  if (Number(currentProjectElement.BILLING_TYPE_ID) === 2) {
    const { data: tecRows, error: tecError } = await supabase
      .from("TEC")
      .select("SP_TOT")
      .eq("STRUCTURE_ID", b.STRUCTURE_ID);
    if (tecError) throw { status: 500, message: "Fehler beim Laden der TEC-Summe: " + tecError.message };

    const revenue = (tecRows || []).reduce((sum, r) => sum + (Number(r.SP_TOT) || 0), 0);
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

  const { error: updateError } = await supabase.from("PROJECT_STRUCTURE").update(updatePayload).eq("ID", b.STRUCTURE_ID);
  if (updateError) throw { status: 500, message: "Fehler beim Update der Projektstruktur: " + updateError.message };
}

async function patchBuchung(supabase, { id, body, tenantId }) {
  const b = body || {};

  const { data: existing, error: exErr } = await supabase
    .from("TEC")
    .select("ID, STRUCTURE_ID, PROJECT_ID, EMPLOYEE_ID, TENANT_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .single();

  if (exErr || !existing) {
    throw { status: 404, message: "Buchung nicht gefunden: " + (exErr?.message || "") };
  }

  const oldStructureId = existing.STRUCTURE_ID ?? null;

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

  const toNullIfEmpty = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };

  let resolvedTenantId = existing.TENANT_ID ?? null;
  if (!resolvedTenantId) {
    const effectivePid = newProjectId !== undefined ? newProjectId : existing.PROJECT_ID;
    const { data: projRow } = await supabase.from("PROJECT").select("TENANT_ID").eq("ID", effectivePid).maybeSingle();
    resolvedTenantId = projRow?.TENANT_ID ?? null;
  }

  const updateTec = {
    TENANT_ID: resolvedTenantId,
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

  if (newEmployeeId !== undefined) updateTec.EMPLOYEE_ID = newEmployeeId;
  if (newProjectId !== undefined) updateTec.PROJECT_ID = newProjectId;
  if (newStructureId !== undefined) updateTec.STRUCTURE_ID = newStructureId;

  const effectiveEmployeeId = newEmployeeId !== undefined ? newEmployeeId : existing.EMPLOYEE_ID;
  const effectiveProjectId = newProjectId !== undefined ? newProjectId : existing.PROJECT_ID;

  let preset = null;
  try {
    preset = await loadEmployee2Project(supabase, Number(effectiveEmployeeId), Number(effectiveProjectId));
  } catch (e) {
    throw { status: 500, message: "Fehler beim Laden EMPLOYEE2PROJECT: " + e.message };
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
  if (updErr) throw { status: 500, message: "Fehler beim Aktualisieren: " + updErr.message };

  const affected = new Set([
    oldStructureId,
    newStructureId !== undefined ? newStructureId : oldStructureId,
  ].filter(Boolean));

  for (const sid of affected) {
    await recomputeStructure(supabase, sid);
  }

  return updatedTec;
}

async function deleteBuchung(supabase, { id }) {
  const { data: existing, error: exErr } = await supabase
    .from("TEC")
    .select("ID, STRUCTURE_ID")
    .eq("ID", id)
    .single();

  if (exErr || !existing) {
    throw { status: 404, message: "Buchung nicht gefunden: " + ((exErr && exErr.message) || "") };
  }

  const structureId = existing.STRUCTURE_ID;

  const { error: delErr } = await supabase.from("TEC").delete().eq("ID", id);
  if (delErr) throw { status: 500, message: "Fehler beim Löschen: " + delErr.message };

  if (!structureId) return;

  const { data: tecRows, error: tecErr } = await supabase
    .from("TEC")
    .select("QUANTITY_INT, CP_RATE, SP_TOT")
    .eq("STRUCTURE_ID", structureId);
  if (tecErr) throw { status: 500, message: "Fehler beim Laden der TEC-Daten: " + tecErr.message };

  const newCosts = (tecRows || []).reduce((acc, r) => acc + Number(r.QUANTITY_INT ?? 0) * Number(r.CP_RATE ?? 0), 0);
  const revenueSum = (tecRows || []).reduce((acc, r) => acc + Number(r.SP_TOT ?? 0), 0);

  const { data: structureRow, error: strErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, BILLING_TYPE_ID, EXTRAS_PERCENT")
    .eq("ID", structureId)
    .single();
  if (strErr) throw { status: 500, message: "Struktur-Element nicht gefunden: " + strErr.message };

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

  const { error: psErr } = await supabase.from("PROJECT_STRUCTURE").update(structureUpdate).eq("ID", structureId);
  if (psErr) throw { status: 500, message: "Fehler beim Aktualisieren der Projektstruktur: " + psErr.message };
}

async function listBuchungenByProject(supabase, { projectId, tenantId }) {
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
    .eq("TENANT_ID", tenantId)
    .eq("PROJECT_ID", projectId)
    .order("DATE_VOUCHER", { ascending: true });

  if (error) throw error;
  return data;
}

module.exports = {
  createBuchung,
  patchBuchung,
  deleteBuchung,
  listBuchungenByProject,
  createTimerDraft,
  listDraftsByEmployee,
  confirmDrafts,
  deleteDraft,
  patchDraftDescription,
};
