"use strict";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Lookup / reference data
// ---------------------------------------------------------------------------

async function getStatuses(supabase) {
  const { data, error } = await supabase.from("PROJECT_STATUS").select("ID, NAME_SHORT");
  if (error) throw error;
  return data;
}

async function getTypes(supabase) {
  const { data, error } = await supabase.from("PROJECT_TYPE").select("ID, NAME_SHORT");
  if (error) throw error;
  return data;
}

async function getManagers(supabase) {
  const { data, error } = await supabase.from("EMPLOYEE").select("ID, SHORT_NAME");
  if (error) throw error;
  return data;
}

async function getActiveEmployees(supabase) {
  let q = supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME").eq("ACTIVE", 1);
  let { data, error } = await q;
  if (error && String(error.message || "").toLowerCase().includes("active")) {
    const r = await supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME, ACTIVE");
    data = r.data;
    error = r.error;
    if (!error && Array.isArray(data)) data = data.filter((e) => String(e.ACTIVE) === "1" || e.ACTIVE === true);
  }
  if (error) throw error;
  return data || [];
}

async function getActiveRoles(supabase) {
  let q = supabase.from("ROLE").select("ID, NAME_SHORT, NAME_LONG").eq("ACTIVE", 1);
  let { data, error } = await q;
  if (error && String(error.message || "").toLowerCase().includes("active")) {
    const r = await supabase.from("ROLE").select("ID, NAME_SHORT, NAME_LONG, ACTIVE");
    data = r.data;
    error = r.error;
    if (!error && Array.isArray(data)) data = data.filter((r0) => String(r0.ACTIVE) === "1" || r0.ACTIVE === true);
  }
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

async function createProject(supabase, { body, tenantId }) {
  const b = body;

  if (!b.company_id || !b.name_long || !b.project_status_id || !b.project_manager_id) {
    throw { status: 400, message: "Pflichtfelder fehlen" };
  }

  const parsedAddressId = b.address_id !== undefined && b.address_id !== null ? parseInt(b.address_id, 10) : NaN;
  const parsedContactId = b.contact_id !== undefined && b.contact_id !== null ? parseInt(b.contact_id, 10) : NaN;

  if (!parsedAddressId || Number.isNaN(parsedAddressId) || !parsedContactId || Number.isNaN(parsedContactId)) {
    throw { status: 400, message: "Rechnungsadresse und Kontakt sind erforderlich" };
  }

  const companyId = parseInt(b.company_id, 10);
  if (!companyId || Number.isNaN(companyId)) {
    throw { status: 400, message: "Firma ist erforderlich" };
  }

  const { data: num, error: numErr } = await supabase.rpc("next_project_number", { p_company_id: companyId });
  if (numErr || !num) {
    throw { status: 500, message: `Nummernkreis konnte nicht geladen werden: ${numErr?.message || "unknown error"}` };
  }

  const projectInsertBase = {
    NAME_SHORT: num,
    NAME_LONG: b.name_long,
    COMPANY_ID: companyId,
    PROJECT_STATUS_ID: b.project_status_id,
    PROJECT_TYPE_ID: b.project_type_id || null,
    PROJECT_MANAGER_ID: b.project_manager_id,
    ADDRESS_ID: parsedAddressId,
    CONTACT_ID: parsedContactId,
    TENANT_ID: tenantId ?? null,
  };

  const tryInsertProject = async (row) => {
    return supabase
      .from("PROJECT")
      .insert([row])
      .select("ID, NAME_SHORT, NAME_LONG, ADDRESS_ID, CONTACT_ID, TENANT_ID")
      .single();
  };

  let project = null;
  let projectError = null;
  {
    const r1 = await tryInsertProject(projectInsertBase);
    project = r1.data;
    projectError = r1.error;
    if (projectError && String(projectError.message || "").includes("COMPANY_ID")) {
      const row2 = { ...projectInsertBase };
      delete row2.COMPANY_ID;
      const r2 = await tryInsertProject(row2);
      project = r2.data;
      projectError = r2.error;
    }
  }
  if (projectError) throw { status: 500, message: projectError.message };

  // EMPLOYEE2PROJECT rows
  if (Array.isArray(b.employee2project) && b.employee2project.length) {
    const rows = b.employee2project.map((r0) => ({
      EMPLOYEE_ID: r0.employee_id,
      PROJECT_ID: project.ID,
      ROLE_ID: r0.role_id || null,
      ROLE_NAME_SHORT: r0.role_name_short || "",
      ROLE_NAME_LONG: r0.role_name_long || "",
      SP_RATE: r0.sp_rate === "" || r0.sp_rate === undefined ? null : r0.sp_rate,
      TENANT_ID: project.TENANT_ID,
    }));
    const { error: e2pErr } = await supabase.from("EMPLOYEE2PROJECT").insert(rows);
    if (e2pErr) {
      throw {
        status: 500,
        message: "Projekt wurde gespeichert, aber Mitarbeiter konnten nicht zugeordnet werden: " + (e2pErr.message || e2pErr),
      };
    }
  }

  // PROJECT_STRUCTURE rows
  if (Array.isArray(b.project_structure) && b.project_structure.length) {
    const draft = b.project_structure;
    const tmpKeys = new Set();
    for (const n of draft) {
      const tk = String(n.tmp_key || "").trim();
      if (!tk) throw { status: 400, message: "PROJECT_STRUCTURE: tmp_key fehlt" };
      if (tmpKeys.has(tk)) throw { status: 400, message: "PROJECT_STRUCTURE: tmp_key muss eindeutig sein" };
      tmpKeys.add(tk);
    }

    const insertRows = draft.map((n) => ({
      NAME_SHORT: String(n.NAME_SHORT || "").trim(),
      NAME_LONG: String(n.NAME_LONG || "").trim(),
      PROJECT_ID: project.ID,
      BILLING_TYPE_ID: n.BILLING_TYPE_ID ? parseInt(n.BILLING_TYPE_ID, 10) : null,
      FATHER_ID: null,
      REVENUE: 0,
      EXTRAS_PERCENT: 0,
      EXTRAS: 0,
      REVENUE_COMPLETION_PERCENT: 0,
      EXTRAS_COMPLETION_PERCENT: 0,
      REVENUE_COMPLETION: 0,
      EXTRAS_COMPLETION: 0,
      TENANT_ID: project.TENANT_ID,
    }));

    for (let i = 0; i < insertRows.length; i++) {
      if (!insertRows[i].BILLING_TYPE_ID || Number.isNaN(insertRows[i].BILLING_TYPE_ID)) {
        throw { status: 400, message: `PROJECT_STRUCTURE: Abrechnungsart fehlt (Zeile ${i + 1})` };
      }
    }

    const { data: createdNodes, error: psErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .insert(insertRows)
      .select("ID, NAME_SHORT, NAME_LONG");

    if (psErr) {
      throw {
        status: 500,
        message: "Projekt wurde gespeichert, aber Projektstruktur konnte nicht angelegt werden: " + psErr.message,
      };
    }

    const tmpToId = new Map();
    (createdNodes || []).forEach((row, i) => {
      const tk = String(draft[i].tmp_key || "").trim();
      if (tk) tmpToId.set(tk, row.ID);
    });

    const updates = [];
    draft.forEach((n) => {
      const tk = String(n.tmp_key || "").trim();
      const fk = n.father_tmp_key ? String(n.father_tmp_key).trim() : "";
      if (!fk) return;
      const childId = tmpToId.get(tk);
      const fatherId = tmpToId.get(fk);
      if (!childId || !fatherId) return;
      updates.push({ id: childId, father_id: fatherId });
    });

    for (const u of updates) {
      const { error: uErr } = await supabase.from("PROJECT_STRUCTURE").update({ FATHER_ID: u.father_id }).eq("ID", u.id);
      if (uErr) {
        throw { status: 500, message: "Projekt wurde gespeichert, aber FATHER_ID konnte nicht gesetzt werden: " + uErr.message };
      }
    }

    try {
      const progressRows = (createdNodes || []).map((r) => ({
        STRUCTURE_ID: r.ID,
        REVENUE: 0,
        EXTRAS_PERCENT: 0,
        EXTRAS: 0,
        REVENUE_COMPLETION_PERCENT: 0,
        EXTRAS_COMPLETION_PERCENT: 0,
        REVENUE_COMPLETION: 0,
        EXTRAS_COMPLETION: 0,
        TENANT_ID: project.TENANT_ID,
      }));
      if (progressRows.length) await supabase.from("PROJECT_PROGRESS").insert(progressRows);
    } catch (e) {
      // ignore
    }
  }

  // CONTRACT row
  const contractRow = {
    NAME_SHORT: project.NAME_SHORT,
    NAME_LONG: project.NAME_LONG,
    PROJECT_ID: project.ID,
    INVOICE_ADDRESS_ID: project.ADDRESS_ID,
    INVOICE_CONTACT_ID: project.CONTACT_ID,
    TENANT_ID: project.TENANT_ID,
  };

  let contractInsertError = null;
  {
    const { error } = await supabase.from("CONTRACT").insert([contractRow]);
    contractInsertError = error || null;
  }
  if (contractInsertError) {
    const { error } = await supabase.from("CONTRACTS").insert([contractRow]);
    if (error) {
      throw {
        status: 500,
        message:
          "Projekt wurde gespeichert, aber Vertrag konnte nicht angelegt werden: " +
          (error.message || contractInsertError.message),
      };
    }
  }

  return project;
}

async function listProjects(supabase, { tenantId }) {
  try {
    const { data, error } = await supabase
      .from("PROJECT")
      .select(`
        ID, NAME_SHORT, NAME_LONG,
        STATUS:PROJECT_STATUS_ID(NAME_SHORT),
        TYPE:PROJECT_TYPE_ID(NAME_SHORT),
        MANAGER:PROJECT_MANAGER_ID(SHORT_NAME)
      `)
      .eq("TENANT_ID", tenantId);
    if (error) throw error;
    return data;
  } catch (_) {
    const { data, error } = await supabase
      .from("PROJECT")
      .select("ID, NAME_SHORT, NAME_LONG")
      .eq("TENANT_ID", tenantId)
      .order("NAME_SHORT", { ascending: true });
    if (error) throw error;
    return data;
  }
}

async function listProjectsFull(supabase, { tenantId, limit }) {
  const safeLimit = Math.min(parseInt(String(limit || "2000"), 10) || 2000, 5000);

  const { data: projects, error: pErr } = await supabase
    .from("PROJECT")
    .select("ID, NAME_SHORT, NAME_LONG, PROJECT_STATUS_ID, PROJECT_TYPE_ID, PROJECT_MANAGER_ID")
    .eq("TENANT_ID", tenantId)
    .order("NAME_SHORT", { ascending: true })
    .limit(safeLimit);

  if (pErr) throw pErr;

  const statusIds = [...new Set((projects || []).map((p) => p.PROJECT_STATUS_ID).filter(Boolean))];
  const typeIds = [...new Set((projects || []).map((p) => p.PROJECT_TYPE_ID).filter(Boolean))];
  const mgrIds = [...new Set((projects || []).map((p) => p.PROJECT_MANAGER_ID).filter(Boolean))];

  const [stRes, tyRes, mgRes] = await Promise.all([
    statusIds.length ? supabase.from("PROJECT_STATUS").select("ID, NAME_SHORT").in("ID", statusIds) : Promise.resolve({ data: [] }),
    typeIds.length ? supabase.from("PROJECT_TYPE").select("ID, NAME_SHORT").in("ID", typeIds) : Promise.resolve({ data: [] }),
    mgrIds.length ? supabase.from("EMPLOYEE").select("ID, SHORT_NAME").in("ID", mgrIds) : Promise.resolve({ data: [] }),
  ]);

  const statusMap = new Map((stRes.data || []).map((x) => [String(x.ID), x.NAME_SHORT]));
  const typeMap = new Map((tyRes.data || []).map((x) => [String(x.ID), x.NAME_SHORT]));
  const mgrMap = new Map((mgRes.data || []).map((x) => [String(x.ID), x.SHORT_NAME]));

  return (projects || []).map((p) => ({
    ...p,
    STATUS_NAME: statusMap.get(String(p.PROJECT_STATUS_ID)) || "",
    TYPE_NAME: typeMap.get(String(p.PROJECT_TYPE_ID)) || "",
    MANAGER_NAME: mgrMap.get(String(p.PROJECT_MANAGER_ID)) || "",
  }));
}

async function patchProject(supabase, { id, body, tenantId }) {
  const b = body || {};
  const upd = {};
  if (b.name_short !== undefined) upd.NAME_SHORT = String(b.name_short || "").trim();
  if (b.name_long !== undefined) upd.NAME_LONG = String(b.name_long || "").trim();
  if (b.project_status_id !== undefined) {
    upd.PROJECT_STATUS_ID = b.project_status_id ? parseInt(String(b.project_status_id), 10) : null;
  }
  if (b.project_type_id !== undefined) {
    upd.PROJECT_TYPE_ID = b.project_type_id ? parseInt(String(b.project_type_id), 10) : null;
  }
  if (b.project_manager_id !== undefined) {
    upd.PROJECT_MANAGER_ID = b.project_manager_id ? parseInt(String(b.project_manager_id), 10) : null;
  }
  if (upd.NAME_SHORT !== undefined && !upd.NAME_SHORT) {
    throw { status: 400, message: "NAME_SHORT ist erforderlich" };
  }

  const { data: updated, error: uErr } = await supabase
    .from("PROJECT")
    .update(upd)
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .select("ID, NAME_SHORT, NAME_LONG, PROJECT_STATUS_ID, PROJECT_TYPE_ID, PROJECT_MANAGER_ID")
    .single();

  if (uErr) throw uErr;

  const [st, ty, mg] = await Promise.all([
    updated.PROJECT_STATUS_ID
      ? supabase.from("PROJECT_STATUS").select("ID, NAME_SHORT").eq("ID", updated.PROJECT_STATUS_ID).single()
      : Promise.resolve({ data: null }),
    updated.PROJECT_TYPE_ID
      ? supabase.from("PROJECT_TYPE").select("ID, NAME_SHORT").eq("ID", updated.PROJECT_TYPE_ID).single()
      : Promise.resolve({ data: null }),
    updated.PROJECT_MANAGER_ID
      ? supabase.from("EMPLOYEE").select("ID, SHORT_NAME").eq("ID", updated.PROJECT_MANAGER_ID).single()
      : Promise.resolve({ data: null }),
  ]);

  return {
    ...updated,
    STATUS_NAME: st.data?.NAME_SHORT || "",
    TYPE_NAME: ty.data?.NAME_SHORT || "",
    MANAGER_NAME: mg.data?.SHORT_NAME || "",
  };
}

async function searchProjects(supabase, { q, tenantId }) {
  const { data, error } = await supabase
    .from("PROJECT")
    .select("ID, NAME_SHORT, NAME_LONG")
    .eq("TENANT_ID", tenantId)
    .or(`NAME_SHORT.ilike.%${q}%,NAME_LONG.ilike.%${q}%`)
    .order("NAME_SHORT", { ascending: true })
    .limit(20);
  if (error) throw error;
  return data;
}

async function searchContracts(supabase, { projectId, q }) {
  const query = (table) =>
    supabase
      .from(table)
      .select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID")
      .eq("PROJECT_ID", projectId)
      .or(`NAME_SHORT.ilike.%${q}%,NAME_LONG.ilike.%${q}%`)
      .order("NAME_SHORT", { ascending: true })
      .limit(20);

  let { data, error } = await query("CONTRACT");
  if (error) ({ data, error } = await query("CONTRACTS"));
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// Project Structure
// ---------------------------------------------------------------------------

async function getProjectStructure(supabase, { projectId }) {
  const { data: structures, error } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("*")
    .eq("PROJECT_ID", projectId);

  if (error) throw error;
  if (!Array.isArray(structures) || structures.length === 0) return [];

  const billingType2Ids = structures.filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);
  const tecSums = {};

  if (billingType2Ids.length > 0) {
    const { data: tecRows, error: tecError } = await supabase
      .from("TEC")
      .select("STRUCTURE_ID, SP_TOT")
      .in("STRUCTURE_ID", billingType2Ids);
    if (tecError) throw tecError;
    (tecRows || []).forEach((r) => {
      const sid = String(r.STRUCTURE_ID);
      const val = Number(r.SP_TOT ?? 0);
      tecSums[sid] = (tecSums[sid] ?? 0) + (Number.isFinite(val) ? val : 0);
    });
  }

  return structures.map((s) => ({
    ...s,
    TEC_SP_TOT_SUM: tecSums[String(s.ID)] ?? 0,
  }));
}

async function patchStructureCompletionPercents(supabase, { structureId, revPct, exPct }) {
  const { error } = await supabase
    .from("PROJECT_STRUCTURE")
    .update({ REVENUE_COMPLETION_PERCENT: revPct, EXTRAS_COMPLETION_PERCENT: exPct })
    .eq("ID", structureId);
  if (error) throw error;
}

async function progressSnapshot(supabase, { projectId }) {
  const { data: structures, error: sErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, TENANT_ID, BILLING_TYPE_ID, REVENUE, EXTRAS, EXTRAS_PERCENT, REVENUE_COMPLETION_PERCENT, EXTRAS_COMPLETION_PERCENT")
    .eq("PROJECT_ID", projectId);

  if (sErr) throw sErr;

  const rows = Array.isArray(structures) ? structures : [];
  if (!rows.length) return { updated: 0, inserted: 0 };

  const bt2Ids = rows.filter((r) => Number(r.BILLING_TYPE_ID) === 2).map((r) => r.ID);
  const tecSums = {};
  if (bt2Ids.length) {
    const { data: tecRows, error: tecErr } = await supabase
      .from("TEC")
      .select("STRUCTURE_ID, SP_TOT")
      .in("STRUCTURE_ID", bt2Ids);
    if (tecErr) throw tecErr;
    (tecRows || []).forEach((t) => {
      const sid = String(t.STRUCTURE_ID);
      const v = Number(t.SP_TOT ?? 0);
      tecSums[sid] = (tecSums[sid] ?? 0) + (Number.isFinite(v) ? v : 0);
    });
  }

  const updates = [];
  const progressRows = [];

  for (const r of rows) {
    const sid = String(r.ID);
    const btId = Number(r.BILLING_TYPE_ID ?? 0) || 0;
    const storedRevenue = Number(r.REVENUE ?? 0) || 0;
    const storedExtras = Number(r.EXTRAS ?? 0) || 0;
    const extrasPercent = Number(r.EXTRAS_PERCENT ?? 0) || 0;
    const revenue = btId === 2 ? Number(tecSums[sid] ?? 0) || 0 : storedRevenue;
    const extras = btId === 2 ? (revenue * extrasPercent) / 100 : storedExtras;
    const revPct = Number(r.REVENUE_COMPLETION_PERCENT ?? 0) || 0;
    const exPct = Number(r.EXTRAS_COMPLETION_PERCENT ?? 0) || 0;
    const revenueCompletion = (revPct * revenue) / 100;
    const extrasCompletion = (exPct * extras) / 100;

    updates.push({ sid, btId, revenue, extras, revenueCompletion, extrasCompletion });
    progressRows.push({
      TENANT_ID: r.TENANT_ID,
      STRUCTURE_ID: sid,
      REVENUE: revenue,
      EXTRAS_PERCENT: extrasPercent,
      EXTRAS: extras,
      REVENUE_COMPLETION_PERCENT: revPct,
      EXTRAS_COMPLETION_PERCENT: exPct,
      REVENUE_COMPLETION: revenueCompletion,
      EXTRAS_COMPLETION: extrasCompletion,
    });
  }

  for (const u of updates) {
    const payload = { REVENUE_COMPLETION: u.revenueCompletion, EXTRAS_COMPLETION: u.extrasCompletion };
    if (Number(u.btId) === 2) {
      payload.REVENUE = u.revenue;
      payload.EXTRAS = u.extras;
    }
    const { error: uErr } = await supabase.from("PROJECT_STRUCTURE").update(payload).eq("ID", u.sid);
    if (uErr) throw uErr;
  }

  for (const part of chunk(progressRows, 200)) {
    const { error: pErr } = await supabase.from("PROJECT_PROGRESS").insert(part);
    if (pErr) throw { status: 500, message: "PROJECT_PROGRESS konnte nicht geschrieben werden: " + pErr.message };
  }

  return { updated: updates.length, inserted: progressRows.length };
}

async function getTecSum(supabase, { structureId }) {
  const { data: tecRows, error } = await supabase
    .from("TEC")
    .select("SP_TOT")
    .eq("STRUCTURE_ID", structureId);
  if (error) throw error;
  const sum = (tecRows || []).reduce((acc, r) => {
    const v = Number(r.SP_TOT ?? 0);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
  return sum;
}

async function createStructureNode(supabase, { projectId, node }) {
  const nameShort = String(node.NAME_SHORT || "").trim();
  const nameLong = String(node.NAME_LONG || "").trim();
  if (!nameShort) throw { status: 400, message: "NAME_SHORT ist erforderlich" };

  const billingTypeId =
    typeof node.BILLING_TYPE_ID === "number"
      ? node.BILLING_TYPE_ID
      : parseInt(String(node.BILLING_TYPE_ID || ""), 10);
  if (!billingTypeId || Number.isNaN(billingTypeId)) {
    throw { status: 400, message: "BILLING_TYPE_ID ist erforderlich" };
  }

  const fatherIdRaw = node.FATHER_ID;
  const fatherIdParsed =
    fatherIdRaw === undefined || fatherIdRaw === null || String(fatherIdRaw) === "" || String(fatherIdRaw) === "0"
      ? null
      : parseInt(String(fatherIdRaw), 10);

  if (fatherIdParsed !== null && (Number.isNaN(fatherIdParsed) || fatherIdParsed <= 0)) {
    throw { status: 400, message: "FATHER_ID ist ungültig" };
  }

  if (fatherIdParsed !== null) {
    const { data: parent, error: pErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, PROJECT_ID")
      .eq("ID", fatherIdParsed)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!parent) throw { status: 400, message: "Übergeordnetes Element nicht gefunden" };
    if (String(parent.PROJECT_ID) !== String(projectId)) {
      throw { status: 400, message: "FATHER_ID gehört nicht zum Projekt" };
    }
  }

  const extrasPercent =
    node.EXTRAS_PERCENT !== undefined && node.EXTRAS_PERCENT !== null && String(node.EXTRAS_PERCENT) !== ""
      ? Number(node.EXTRAS_PERCENT)
      : 0;

  let revenue =
    node.REVENUE !== undefined && node.REVENUE !== null && String(node.REVENUE) !== ""
      ? Number(node.REVENUE)
      : 0;
  if (Number(billingTypeId) === 2) revenue = 0;

  const extras = (revenue * extrasPercent) / 100;
  const revenuePct =
    node.REVENUE_COMPLETION_PERCENT !== undefined && node.REVENUE_COMPLETION_PERCENT !== null && String(node.REVENUE_COMPLETION_PERCENT) !== ""
      ? Number(node.REVENUE_COMPLETION_PERCENT)
      : 0;
  const extrasPct =
    node.EXTRAS_COMPLETION_PERCENT !== undefined && node.EXTRAS_COMPLETION_PERCENT !== null && String(node.EXTRAS_COMPLETION_PERCENT) !== ""
      ? Number(node.EXTRAS_COMPLETION_PERCENT)
      : 0;
  const revenueCompletion = (revenuePct * revenue) / 100;
  const extrasCompletion = (extrasPct * extras) / 100;

  const { data: projForTenant } = await supabase.from("PROJECT").select("TENANT_ID").eq("ID", projectId).maybeSingle();

  const insertPayload = {
    NAME_SHORT: nameShort,
    NAME_LONG: nameLong,
    FATHER_ID: fatherIdParsed,
    PROJECT_ID: projectId,
    BILLING_TYPE_ID: billingTypeId,
    REVENUE: revenue,
    EXTRAS_PERCENT: extrasPercent,
    EXTRAS: extras,
    REVENUE_COMPLETION_PERCENT: revenuePct,
    EXTRAS_COMPLETION_PERCENT: extrasPct,
    REVENUE_COMPLETION: revenueCompletion,
    EXTRAS_COMPLETION: extrasCompletion,
    TENANT_ID: projForTenant?.TENANT_ID,
  };

  const { data: created, error: cErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .insert([insertPayload])
    .select("*")
    .single();
  if (cErr) throw cErr;

  const progressRow = {
    TENANT_ID: created.TENANT_ID,
    STRUCTURE_ID: created.ID,
    REVENUE: created.REVENUE,
    EXTRAS_PERCENT: created.EXTRAS_PERCENT,
    EXTRAS: created.EXTRAS,
    REVENUE_COMPLETION_PERCENT: created.REVENUE_COMPLETION_PERCENT,
    EXTRAS_COMPLETION_PERCENT: created.EXTRAS_COMPLETION_PERCENT,
    REVENUE_COMPLETION: created.REVENUE_COMPLETION,
    EXTRAS_COMPLETION: created.EXTRAS_COMPLETION,
  };

  const { error: prErr } = await supabase.from("PROJECT_PROGRESS").insert([progressRow]);
  if (prErr) throw { status: 500, message: "Element angelegt, aber PROJECT_PROGRESS fehlgeschlagen: " + prErr.message };

  return created;
}

async function patchStructure(supabase, { structureId, update }) {
  const { data: current, error: currentErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("NAME_SHORT, NAME_LONG, BILLING_TYPE_ID, REVENUE, EXTRAS_PERCENT, REVENUE_COMPLETION_PERCENT, EXTRAS_COMPLETION_PERCENT, TENANT_ID")
    .eq("ID", structureId)
    .maybeSingle();

  if (currentErr) throw currentErr;
  if (!current) throw { status: 404, message: "PROJECT_STRUCTURE nicht gefunden" };

  let billingTypeId =
    update.BILLING_TYPE_ID !== undefined && update.BILLING_TYPE_ID !== null && String(update.BILLING_TYPE_ID) !== ""
      ? parseInt(update.BILLING_TYPE_ID, 10)
      : parseInt(current.BILLING_TYPE_ID, 10);

  if (!billingTypeId || Number.isNaN(billingTypeId)) {
    throw { status: 400, message: "BILLING_TYPE_ID ist erforderlich" };
  }

  const nameShort =
    update.NAME_SHORT !== undefined && update.NAME_SHORT !== null ? String(update.NAME_SHORT) : current.NAME_SHORT;
  const nameLong =
    update.NAME_LONG !== undefined && update.NAME_LONG !== null ? String(update.NAME_LONG) : current.NAME_LONG;

  const revenuePct =
    update.REVENUE_COMPLETION_PERCENT !== undefined && update.REVENUE_COMPLETION_PERCENT !== null && String(update.REVENUE_COMPLETION_PERCENT) !== ""
      ? Number(update.REVENUE_COMPLETION_PERCENT)
      : Number(current.REVENUE_COMPLETION_PERCENT ?? 0);
  const extrasPct =
    update.EXTRAS_COMPLETION_PERCENT !== undefined && update.EXTRAS_COMPLETION_PERCENT !== null && String(update.EXTRAS_COMPLETION_PERCENT) !== ""
      ? Number(update.EXTRAS_COMPLETION_PERCENT)
      : Number(current.EXTRAS_COMPLETION_PERCENT ?? 0);
  const extrasPercent =
    update.EXTRAS_PERCENT !== undefined && update.EXTRAS_PERCENT !== null && String(update.EXTRAS_PERCENT) !== ""
      ? Number(update.EXTRAS_PERCENT)
      : Number(current.EXTRAS_PERCENT ?? 0);

  let revenue =
    update.REVENUE !== undefined && update.REVENUE !== null && String(update.REVENUE) !== ""
      ? Number(update.REVENUE)
      : Number(current.REVENUE ?? 0);

  if (Number(billingTypeId) === 2) {
    const { data: tecRows, error: tecError } = await supabase
      .from("TEC")
      .select("SP_TOT")
      .eq("STRUCTURE_ID", structureId);
    if (tecError) throw tecError;
    revenue = (tecRows || []).reduce((acc, r) => {
      const v = Number(r.SP_TOT ?? 0);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);
  }

  const extras = (revenue * extrasPercent) / 100;
  const revenueCompletion = (revenuePct * revenue) / 100;
  const extrasCompletion = (extrasPct * extras) / 100;

  const updatePayload = {
    NAME_SHORT: nameShort,
    NAME_LONG: nameLong,
    BILLING_TYPE_ID: billingTypeId,
    REVENUE: revenue,
    EXTRAS_PERCENT: extrasPercent,
    REVENUE_COMPLETION_PERCENT: revenuePct,
    EXTRAS_COMPLETION_PERCENT: extrasPct,
    EXTRAS: extras,
    REVENUE_COMPLETION: revenueCompletion,
    EXTRAS_COMPLETION: extrasCompletion,
  };

  const { error: updateError } = await supabase.from("PROJECT_STRUCTURE").update(updatePayload).eq("ID", structureId);
  if (updateError) throw updateError;

  const progressRow = {
    TENANT_ID: current.TENANT_ID,
    STRUCTURE_ID: structureId,
    REVENUE: revenue,
    EXTRAS_PERCENT: extrasPercent,
    EXTRAS: extras,
    REVENUE_COMPLETION_PERCENT: revenuePct,
    EXTRAS_COMPLETION_PERCENT: extrasPct,
    REVENUE_COMPLETION: revenueCompletion,
    EXTRAS_COMPLETION: extrasCompletion,
  };

  const { error: progressError } = await supabase.from("PROJECT_PROGRESS").insert([progressRow]);
  if (progressError) {
    throw {
      status: 500,
      message: "Projektstruktur gespeichert, aber PROJECT_PROGRESS konnte nicht geschrieben werden: " + progressError.message,
    };
  }

  return { billingTypeId, revenue, extras, revenueCompletion, extrasCompletion };
}

async function inheritStructure(supabase, { structureId, inheritBt, inheritExtras }) {
  const { data: root, error: rootErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, PROJECT_ID")
    .eq("ID", structureId)
    .maybeSingle();
  if (rootErr) throw rootErr;
  if (!root) throw { status: 404, message: "PROJECT_STRUCTURE nicht gefunden" };

  const { data: all, error: allErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, TENANT_ID, FATHER_ID, BILLING_TYPE_ID, REVENUE, EXTRAS_PERCENT, REVENUE_COMPLETION_PERCENT, EXTRAS_COMPLETION_PERCENT")
    .eq("PROJECT_ID", root.PROJECT_ID);
  if (allErr) throw allErr;

  const childrenByParent = new Map();
  (all || []).forEach((n) => {
    const pid = n.FATHER_ID === null || n.FATHER_ID === undefined ? null : String(n.FATHER_ID);
    const arr = childrenByParent.get(pid) || [];
    arr.push(String(n.ID));
    childrenByParent.set(pid, arr);
  });

  const descendants = [];
  const stack = [...(childrenByParent.get(String(structureId)) || [])];
  const seen = new Set();
  while (stack.length) {
    const cur = String(stack.pop() || "");
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    descendants.push(cur);
    const kids = childrenByParent.get(cur) || [];
    kids.forEach((k) => stack.push(k));
  }

  if (!descendants.length) return { updated: 0, updated_ids: [] };

  const nodeById = new Map((all || []).map((n) => [String(n.ID), n]));

  const bt2Ids = descendants.filter((sid) => {
    const n = nodeById.get(String(sid));
    if (!n) return false;
    const effBt = inheritBt !== null ? inheritBt : parseInt(n.BILLING_TYPE_ID, 10);
    return Number(effBt) === 2;
  });

  const tecSumByStructure = new Map();
  for (const part of chunk(bt2Ids, 100)) {
    const { data: tecRows, error: tecErr } = await supabase
      .from("TEC")
      .select("STRUCTURE_ID, SP_TOT")
      .in("STRUCTURE_ID", part);
    if (tecErr) throw tecErr;
    (tecRows || []).forEach((r) => {
      const sid = String(r.STRUCTURE_ID);
      const v = Number(r.SP_TOT ?? 0);
      const prev = tecSumByStructure.get(sid) || 0;
      tecSumByStructure.set(sid, prev + (Number.isFinite(v) ? v : 0));
    });
  }

  const progressRows = [];
  const updatedIds = [];

  for (const sid of descendants) {
    const n = nodeById.get(String(sid));
    if (!n) continue;

    const effBt = inheritBt !== null ? inheritBt : parseInt(n.BILLING_TYPE_ID, 10);
    const effExtrasPercent = inheritExtras !== null ? inheritExtras : Number(n.EXTRAS_PERCENT ?? 0);

    let revenue = Number(n.REVENUE ?? 0);
    if (Number(effBt) === 2) revenue = Number(tecSumByStructure.get(String(sid)) ?? 0);

    const extras = (revenue * effExtrasPercent) / 100;
    const revenuePct = Number(n.REVENUE_COMPLETION_PERCENT ?? 0);
    const extrasPct = Number(n.EXTRAS_COMPLETION_PERCENT ?? 0);
    const revenueCompletion = (revenuePct * revenue) / 100;
    const extrasCompletion = (extrasPct * extras) / 100;

    const upd = {
      BILLING_TYPE_ID: effBt,
      EXTRAS_PERCENT: effExtrasPercent,
      REVENUE: revenue,
      EXTRAS: extras,
      REVENUE_COMPLETION: revenueCompletion,
      EXTRAS_COMPLETION: extrasCompletion,
    };

    const { error: uErr } = await supabase.from("PROJECT_STRUCTURE").update(upd).eq("ID", sid);
    if (uErr) throw uErr;

    updatedIds.push(String(sid));
    progressRows.push({
      TENANT_ID: nodeById.get(String(sid))?.TENANT_ID,
      STRUCTURE_ID: sid,
      REVENUE: revenue,
      EXTRAS_PERCENT: effExtrasPercent,
      EXTRAS: extras,
      REVENUE_COMPLETION_PERCENT: revenuePct,
      EXTRAS_COMPLETION_PERCENT: extrasPct,
      REVENUE_COMPLETION: revenueCompletion,
      EXTRAS_COMPLETION: extrasCompletion,
    });
  }

  for (const part of chunk(progressRows, 200)) {
    const { error: pErr } = await supabase.from("PROJECT_PROGRESS").insert(part);
    if (pErr) throw { status: 500, message: "PROJECT_PROGRESS konnte nicht geschrieben werden: " + pErr.message };
  }

  return { updated: updatedIds.length, updated_ids: updatedIds };
}

async function moveStructure(supabase, { structureId, fatherRaw }) {
  const newFatherId =
    fatherRaw === undefined || fatherRaw === null || String(fatherRaw) === "" || String(fatherRaw) === "0"
      ? null
      : String(fatherRaw);

  const { data: current, error: curErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, PROJECT_ID, FATHER_ID")
    .eq("ID", structureId)
    .maybeSingle();
  if (curErr) throw curErr;
  if (!current) throw { status: 404, message: "PROJECT_STRUCTURE nicht gefunden" };

  if (newFatherId !== null && String(newFatherId) === String(structureId)) {
    throw { status: 400, message: "Ein Element kann nicht sich selbst untergeordnet werden" };
  }

  if (newFatherId !== null) {
    const { data: parent, error: pErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, PROJECT_ID, FATHER_ID")
      .eq("ID", newFatherId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!parent) throw { status: 400, message: "Ziel-Element nicht gefunden" };
    if (String(parent.PROJECT_ID) !== String(current.PROJECT_ID)) {
      throw { status: 400, message: "Ziel-Element gehört nicht zum selben Projekt" };
    }

    const { data: all, error: aErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, FATHER_ID")
      .eq("PROJECT_ID", current.PROJECT_ID);
    if (aErr) throw aErr;

    const map = new Map((all || []).map((n) => [String(n.ID), n.FATHER_ID === null ? null : String(n.FATHER_ID)]));
    let cursor = String(newFatherId);
    let guard = 0;
    while (cursor && guard++ < 5000) {
      if (cursor === String(structureId)) {
        throw { status: 400, message: "Ungültige Verschiebung (Zyklus in der Struktur)" };
      }
      const next = map.get(cursor);
      if (!next) break;
      cursor = next ? String(next) : null;
    }
  }

  const { error: uErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .update({ FATHER_ID: newFatherId })
    .eq("ID", structureId);
  if (uErr) throw uErr;
}

async function deleteStructure(supabase, { structureId, cascade }) {
  const { data: current, error: curErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, PROJECT_ID")
    .eq("ID", structureId)
    .maybeSingle();
  if (curErr) throw curErr;
  if (!current) throw { status: 404, message: "PROJECT_STRUCTURE nicht gefunden" };

  const { data: all, error: aErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, FATHER_ID")
    .eq("PROJECT_ID", current.PROJECT_ID);
  if (aErr) throw aErr;

  const childrenByParent = new Map();
  (all || []).forEach((n) => {
    const pid = n.FATHER_ID === null || n.FATHER_ID === undefined ? null : String(n.FATHER_ID);
    const arr = childrenByParent.get(pid) || [];
    arr.push(String(n.ID));
    childrenByParent.set(pid, arr);
  });

  const directChildren = childrenByParent.get(String(structureId)) || [];
  if (directChildren.length && !cascade) {
    throw {
      status: 409,
      message: "Element hat Unterelemente. Bitte zuerst verschieben/löschen oder 'Unterstruktur mitlöschen' wählen.",
    };
  }

  const toDelete = [];
  const stack = [String(structureId)];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (toDelete.includes(cur)) continue;
    toDelete.push(cur);
    const kids = childrenByParent.get(cur) || [];
    kids.forEach((k) => stack.push(k));
  }

  const hasRefs = async (table, col) => {
    try {
      const { data, error } = await supabase.from(table).select("ID").in(col, toDelete).limit(1);
      if (error) return false;
      return Array.isArray(data) && data.length > 0;
    } catch (_) {
      return false;
    }
  };

  const tecRef = await hasRefs("TEC", "STRUCTURE_ID");
  const ppsRef = await hasRefs("PARTIAL_PAYMENT_STRUCTURE", "STRUCTURE_ID");
  const invsRef = await hasRefs("INVOICE_STRUCTURE", "STRUCTURE_ID");

  if (tecRef || ppsRef || invsRef) {
    throw { status: 409, message: "Element kann nicht gelöscht werden, da Buchungen/Rechnungen darauf verweisen." };
  }

  const { error: delPErr } = await supabase.from("PROJECT_PROGRESS").delete().in("STRUCTURE_ID", toDelete);
  if (delPErr) throw delPErr;

  const { error: delSErr } = await supabase.from("PROJECT_STRUCTURE").delete().in("ID", toDelete);
  if (delSErr) throw delSErr;

  return toDelete;
}

module.exports = {
  getStatuses,
  getTypes,
  getManagers,
  getActiveEmployees,
  getActiveRoles,
  createProject,
  listProjects,
  listProjectsFull,
  patchProject,
  searchProjects,
  searchContracts,
  getProjectStructure,
  patchStructureCompletionPercents,
  progressSnapshot,
  getTecSum,
  createStructureNode,
  patchStructure,
  inheritStructure,
  moveStructure,
  deleteStructure,
};
