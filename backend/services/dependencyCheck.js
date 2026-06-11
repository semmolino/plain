"use strict";

/**
 * Dependency-Check vor dem Loeschen.
 *
 * Statt den DB-Foreign-Key-Fehler durchzureichen, pruefen wir VOR dem DELETE
 * alle abhaengigen Tabellen und liefern eine sprechende Meldung mit konkreten
 * Datensatz-Namen (z.B. "Projekt 'P-26-004 — Schulneubau'") zurueck.
 *
 * Jede Funktion liefert:
 *   {
 *     blocked:    boolean,
 *     entity:     { label: string },           // "Adresse 'Mustermann GmbH'"
 *     refs:       [ { kind, count, sample } ], // Strukturierte Details (UI optional)
 *     message:    string,                       // Fertige deutsche Meldung
 *   }
 *
 * Defensiv: wenn eine referenzierende Tabelle nicht existiert (Migration nicht
 * gelaufen), wird sie schlicht uebersprungen.
 */

const SAMPLE_LIMIT = 3;

async function safeReferences(supabase, table, selectFields, filter) {
  try {
    let q = supabase.from(table).select(selectFields);
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
    const { data, error } = await q.limit(50);
    if (error) {
      if (/relation .* does not exist|column .* does not exist/i.test(error.message)) return [];
      throw error;
    }
    return data || [];
  } catch (_) { return []; }
}

function formatRefBlock(kind, rows, labelFn) {
  if (rows.length === 0) return null;
  const samples = rows.slice(0, SAMPLE_LIMIT).map(labelFn).filter(Boolean);
  return { kind, count: rows.length, sample: samples };
}

function joinRefs(refs) {
  // Macht aus mehreren Ref-Bloecken einen lesbaren Satz.
  // z.B. "in 2 Projekten (P-26-004, P-26-007) und 1 Rechnung (R-2026-0042)"
  return refs.map(r => {
    const inside = r.sample.length > 0 ? ` (${r.sample.join(", ")}${r.count > r.sample.length ? ` u.a.` : ""})` : "";
    return `${r.count} ${r.label}${inside}`;
  }).join(" und ");
}

// ── ADDRESS ───────────────────────────────────────────────────────────────

async function checkAddress(supabase, { tenantId, id }) {
  const { data: addr } = await supabase
    .from("ADDRESS")
    .select("ADDRESS_NAME_1")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  const name = addr?.ADDRESS_NAME_1 || `#${id}`;
  const entityLabel = `Adresse „${name}"`;

  const [contacts, projects, offers, invoices, partials] = await Promise.all([
    safeReferences(supabase, "CONTACTS",        "ID, FIRST_NAME, LAST_NAME", { ADDRESS_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "PROJECT",         "ID, NAME_SHORT, NAME_LONG", { ADDRESS_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "OFFER",           "ID, NAME_SHORT",            { ADDRESS_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "INVOICE",         "ID, INVOICE_NUMBER",        { ADDRESS_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "PARTIAL_PAYMENT", "ID, PARTIAL_PAYMENT_NUMBER",{ ADDRESS_ID: id, TENANT_ID: tenantId }),
  ]);

  const refs = [
    formatRefBlock("contacts", contacts, c => `${c.FIRST_NAME || ""} ${c.LAST_NAME || ""}`.trim() || `#${c.ID}`),
    formatRefBlock("projects", projects, p => p.NAME_SHORT || `#${p.ID}`),
    formatRefBlock("offers",   offers,   o => o.NAME_SHORT || `#${o.ID}`),
    formatRefBlock("invoices", invoices, i => i.INVOICE_NUMBER || `#${i.ID}`),
    formatRefBlock("partials", partials, p => p.PARTIAL_PAYMENT_NUMBER || `#${p.ID}`),
  ].filter(Boolean);

  const labeled = refs.map(r => ({
    ...r,
    label:
      r.kind === "contacts" ? (r.count === 1 ? "Kontakt"  : "Kontakten") :
      r.kind === "projects" ? (r.count === 1 ? "Projekt"  : "Projekten") :
      r.kind === "offers"   ? (r.count === 1 ? "Angebot"  : "Angeboten") :
      r.kind === "invoices" ? (r.count === 1 ? "Rechnung" : "Rechnungen") :
      r.kind === "partials" ? (r.count === 1 ? "Abschlag" : "Abschlägen") : r.kind,
  }));

  const blocked = labeled.length > 0;
  return {
    blocked,
    entity:  { label: entityLabel },
    refs:    labeled,
    message: blocked
      ? `${entityLabel} kann nicht gelöscht werden — verwendet in ${joinRefs(labeled)}.`
      : "",
  };
}

// ── CONTACT ───────────────────────────────────────────────────────────────

async function checkContact(supabase, { tenantId, id }) {
  const { data: c } = await supabase
    .from("CONTACTS")
    .select("FIRST_NAME, LAST_NAME")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  const name = c ? `${c.FIRST_NAME || ""} ${c.LAST_NAME || ""}`.trim() : `#${id}`;
  const entityLabel = `Kontakt „${name || "ohne Namen"}"`;

  const [projects, offers, invoices, partials] = await Promise.all([
    safeReferences(supabase, "PROJECT",         "ID, NAME_SHORT",            { CONTACT_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "OFFER",           "ID, NAME_SHORT",            { CONTACT_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "INVOICE",         "ID, INVOICE_NUMBER",        { CONTACT_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "PARTIAL_PAYMENT", "ID, PARTIAL_PAYMENT_NUMBER",{ CONTACT_ID: id, TENANT_ID: tenantId }),
  ]);

  const refs = [
    formatRefBlock("projects", projects, p => p.NAME_SHORT || `#${p.ID}`),
    formatRefBlock("offers",   offers,   o => o.NAME_SHORT || `#${o.ID}`),
    formatRefBlock("invoices", invoices, i => i.INVOICE_NUMBER || `#${i.ID}`),
    formatRefBlock("partials", partials, p => p.PARTIAL_PAYMENT_NUMBER || `#${p.ID}`),
  ].filter(Boolean);

  const labeled = refs.map(r => ({
    ...r,
    label:
      r.kind === "projects" ? (r.count === 1 ? "Projekt"  : "Projekten") :
      r.kind === "offers"   ? (r.count === 1 ? "Angebot"  : "Angeboten") :
      r.kind === "invoices" ? (r.count === 1 ? "Rechnung" : "Rechnungen") :
      r.kind === "partials" ? (r.count === 1 ? "Abschlag" : "Abschlägen") : r.kind,
  }));

  const blocked = labeled.length > 0;
  return {
    blocked,
    entity:  { label: entityLabel },
    refs:    labeled,
    message: blocked
      ? `${entityLabel} kann nicht gelöscht werden — verwendet in ${joinRefs(labeled)}.`
      : "",
  };
}

// ── EMPLOYEE ──────────────────────────────────────────────────────────────

async function checkEmployee(supabase, { tenantId, id }) {
  const { data: emp } = await supabase
    .from("EMPLOYEE")
    .select("SHORT_NAME, FIRST_NAME, LAST_NAME")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  const name = emp
    ? `${emp.SHORT_NAME || ""}${emp.SHORT_NAME && (emp.FIRST_NAME || emp.LAST_NAME) ? " — " : ""}${(emp.FIRST_NAME || "")} ${emp.LAST_NAME || ""}`.trim()
    : `#${id}`;
  const entityLabel = `Mitarbeiter:in „${name}"`;

  // Buchungen (TEC) — Eltern-Projekte fuer Kontext aufloesen
  const tec = await safeReferences(supabase, "TEC", "ID, PROJECT_ID", { EMPLOYEE_ID: id, TENANT_ID: tenantId });
  let tecProjectSamples = [];
  let tecProjectsCount  = 0;
  if (tec.length > 0) {
    const projIds = [...new Set(tec.map(t => t.PROJECT_ID).filter(Boolean))];
    tecProjectsCount = projIds.length;
    if (projIds.length > 0) {
      const { data: projs } = await supabase
        .from("PROJECT")
        .select("ID, NAME_SHORT")
        .in("ID", projIds.slice(0, SAMPLE_LIMIT));
      tecProjectSamples = (projs || []).map(p => p.NAME_SHORT || `#${p.ID}`);
    }
  }

  const [managedProjects, e2pAssignments, monthCloses, cpRates, workModels] = await Promise.all([
    safeReferences(supabase, "PROJECT",                "ID, NAME_SHORT",  { PROJECT_MANAGER_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "EMPLOYEE2PROJECT",       "ID, PROJECT_ID",  { EMPLOYEE_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "EMPLOYEE_MONTH_CLOSE",   "ID",              { EMPLOYEE_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "EMPLOYEE_CP_RATE",       "ID",              { EMPLOYEE_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "EMPLOYEE_WORK_MODEL",    "ID",              { EMPLOYEE_ID: id, TENANT_ID: tenantId }),
  ]);

  const refs = [];
  if (tec.length > 0) {
    refs.push({
      kind: "bookings", count: tec.length,
      sample: tecProjectSamples,
      label: tec.length === 1 ? "Buchung" : "Buchungen",
      extraNote: tecProjectsCount > 0 ? ` aus ${tecProjectsCount} Projekt${tecProjectsCount === 1 ? "" : "en"}` : "",
    });
  }
  const managedBlock = formatRefBlock("managed", managedProjects, p => p.NAME_SHORT || `#${p.ID}`);
  if (managedBlock) refs.push({ ...managedBlock, label: managedBlock.count === 1 ? "Projektleitung" : "Projektleitungen" });
  if (e2pAssignments.length > 0) {
    refs.push({ kind: "team_assignments", count: e2pAssignments.length, sample: [], label: e2pAssignments.length === 1 ? "Team-Zuordnung" : "Team-Zuordnungen" });
  }
  if (monthCloses.length > 0) {
    refs.push({ kind: "month_closes", count: monthCloses.length, sample: [], label: monthCloses.length === 1 ? "Monatsabschluss" : "Monatsabschlüssen" });
  }
  if (cpRates.length > 0) {
    refs.push({ kind: "cp_rates", count: cpRates.length, sample: [], label: cpRates.length === 1 ? "Kostensatz-Eintrag" : "Kostensatz-Einträgen" });
  }
  if (workModels.length > 0) {
    refs.push({ kind: "work_models", count: workModels.length, sample: [], label: workModels.length === 1 ? "Arbeitszeitmodell-Zuordnung" : "Arbeitszeitmodell-Zuordnungen" });
  }

  const blocked = refs.length > 0;

  // Sondersatz fuer Buchungen-mit-Projekten-Kontext
  function joinEmpRefs(refs) {
    return refs.map(r => {
      const inside = r.sample.length > 0 ? ` (${r.sample.join(", ")}${r.count > r.sample.length ? ` u.a.` : ""})` : "";
      const extra  = r.extraNote || "";
      return `${r.count} ${r.label}${extra}${inside}`;
    }).join(" und ");
  }

  return {
    blocked,
    entity:  { label: entityLabel },
    refs,
    message: blocked
      ? `${entityLabel} kann nicht gelöscht werden — referenziert in ${joinEmpRefs(refs)}.`
      : "",
  };
}

// ── PROJECT ───────────────────────────────────────────────────────────────

async function checkProject(supabase, { tenantId, id }) {
  const { data: proj } = await supabase
    .from("PROJECT")
    .select("NAME_SHORT, NAME_LONG")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  const name = proj ? `${proj.NAME_SHORT || ""}${proj.NAME_SHORT && proj.NAME_LONG ? " — " : ""}${proj.NAME_LONG || ""}`.trim() : `#${id}`;
  const entityLabel = `Projekt „${name}"`;

  const [tec, invoices, partials, structure, e2p] = await Promise.all([
    safeReferences(supabase, "TEC",                    "ID", { PROJECT_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "INVOICE",                "ID, INVOICE_NUMBER", { PROJECT_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "PARTIAL_PAYMENT",        "ID, PARTIAL_PAYMENT_NUMBER", { PROJECT_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "PROJECT_STRUCTURE",      "ID", { PROJECT_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "EMPLOYEE2PROJECT",       "ID", { PROJECT_ID: id, TENANT_ID: tenantId }),
  ]);

  const refs = [];
  if (tec.length > 0)        refs.push({ kind: "bookings",  count: tec.length,        sample: [],                                                                  label: tec.length === 1 ? "Buchung"        : "Buchungen" });
  if (invoices.length > 0) {
    const blk = formatRefBlock("invoices", invoices, i => i.INVOICE_NUMBER || `#${i.ID}`);
    refs.push({ ...blk, label: blk.count === 1 ? "Rechnung" : "Rechnungen" });
  }
  if (partials.length > 0) {
    const blk = formatRefBlock("partials", partials, p => p.PARTIAL_PAYMENT_NUMBER || `#${p.ID}`);
    refs.push({ ...blk, label: blk.count === 1 ? "Abschlag" : "Abschlägen" });
  }
  if (structure.length > 0)  refs.push({ kind: "structure", count: structure.length,  sample: [], label: structure.length === 1 ? "Strukturelement" : "Strukturelementen" });
  if (e2p.length > 0)        refs.push({ kind: "team",      count: e2p.length,        sample: [], label: e2p.length === 1 ? "Team-Zuordnung" : "Team-Zuordnungen" });

  const blocked = refs.length > 0;
  return {
    blocked,
    entity:  { label: entityLabel },
    refs,
    message: blocked
      ? `${entityLabel} kann nicht gelöscht werden — enthält ${joinRefs(refs)}.`
      : "",
  };
}

// ── OFFER ─────────────────────────────────────────────────────────────────

async function checkOffer(supabase, { tenantId, id }) {
  const { data: off } = await supabase
    .from("OFFER")
    .select("NAME_SHORT, NAME_LONG, PROJECT_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  const name = off ? `${off.NAME_SHORT || ""}${off.NAME_SHORT && off.NAME_LONG ? " — " : ""}${off.NAME_LONG || ""}`.trim() : `#${id}`;
  const entityLabel = `Angebot „${name}"`;

  const refs = [];

  // Wenn Angebot bereits in ein Projekt konvertiert wurde
  if (off?.PROJECT_ID) {
    const { data: linkedProj } = await supabase
      .from("PROJECT")
      .select("NAME_SHORT")
      .eq("ID", off.PROJECT_ID)
      .maybeSingle();
    refs.push({
      kind: "linked_project", count: 1,
      sample: [linkedProj?.NAME_SHORT || `#${off.PROJECT_ID}`],
      label: "konvertiertem Projekt",
    });
  }

  const structureNodes = await safeReferences(supabase, "OFFER_STRUCTURE", "ID", { OFFER_ID: id, TENANT_ID: tenantId });
  if (structureNodes.length > 0) {
    refs.push({ kind: "structure", count: structureNodes.length, sample: [], label: structureNodes.length === 1 ? "Strukturelement" : "Strukturelementen" });
  }

  const blocked = refs.length > 0;
  return {
    blocked,
    entity:  { label: entityLabel },
    refs,
    message: blocked
      ? `${entityLabel} kann nicht gelöscht werden — enthält ${joinRefs(refs)}.`
      : "",
  };
}

// ── MAHNUNG ───────────────────────────────────────────────────────────────

async function checkMahnung(supabase, { tenantId, id }) {
  const { data: m } = await supabase
    .from("MAHNUNG")
    .select("MAHNSTUFE, INVOICE_ID, PP_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  const stufeName = m?.MAHNSTUFE != null ? `Stufe ${m.MAHNSTUFE}` : "";
  let docName = "";
  if (m?.INVOICE_ID) {
    const { data: inv } = await supabase.from("INVOICE").select("INVOICE_NUMBER").eq("ID", m.INVOICE_ID).maybeSingle();
    docName = inv?.INVOICE_NUMBER ? ` zu Rechnung ${inv.INVOICE_NUMBER}` : "";
  } else if (m?.PP_ID) {
    const { data: pp } = await supabase.from("PARTIAL_PAYMENT").select("PARTIAL_PAYMENT_NUMBER").eq("ID", m.PP_ID).maybeSingle();
    docName = pp?.PARTIAL_PAYMENT_NUMBER ? ` zu Abschlag ${pp.PARTIAL_PAYMENT_NUMBER}` : "";
  }
  const entityLabel = `Mahnung${stufeName ? ` (${stufeName})` : ""}${docName}`;

  const history = await safeReferences(supabase, "MAHNUNG_HISTORY", "ID", { MAHNUNG_ID: id, TENANT_ID: tenantId });
  const refs = [];
  if (history.length > 0) {
    refs.push({ kind: "history", count: history.length, sample: [], label: history.length === 1 ? "Historien-Eintrag" : "Historien-Einträgen" });
  }

  const blocked = refs.length > 0;
  return {
    blocked,
    entity:  { label: entityLabel },
    refs,
    message: blocked
      ? `${entityLabel} kann nicht gelöscht werden — hat bereits ${joinRefs(refs)} (Versand-/Status-Historie).`
      : "",
  };
}

// ── PROJECT_STATUS / OFFER_STATUS (gemeinsam in PROJECT_STATUS) ────────────

async function checkProjectStatus(supabase, { tenantId, id }) {
  // Status-Tabelle ist global (kein TENANT_ID), Name aufloesen
  const { data: st } = await supabase.from("PROJECT_STATUS").select("NAME_SHORT").eq("ID", id).maybeSingle();
  const entityLabel = `Status „${st?.NAME_SHORT || `#${id}`}"`;

  const [projects, offers, invoices, partials] = await Promise.all([
    safeReferences(supabase, "PROJECT",         "ID, NAME_SHORT",            { PROJECT_STATUS_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "OFFER",           "ID, NAME_SHORT",            { OFFER_STATUS_ID:   id, TENANT_ID: tenantId }),
    safeReferences(supabase, "INVOICE",         "ID, INVOICE_NUMBER",        { STATUS_ID:         id, TENANT_ID: tenantId }),
    safeReferences(supabase, "PARTIAL_PAYMENT", "ID, PARTIAL_PAYMENT_NUMBER",{ STATUS_ID:         id, TENANT_ID: tenantId }),
  ]);
  const refs = [
    formatRefBlock("projects", projects, p => p.NAME_SHORT || `#${p.ID}`),
    formatRefBlock("offers",   offers,   o => o.NAME_SHORT || `#${o.ID}`),
    formatRefBlock("invoices", invoices, i => i.INVOICE_NUMBER || `#${i.ID}`),
    formatRefBlock("partials", partials, p => p.PARTIAL_PAYMENT_NUMBER || `#${p.ID}`),
  ].filter(Boolean);
  const labeled = refs.map(r => ({
    ...r,
    label:
      r.kind === "projects" ? (r.count === 1 ? "Projekt"  : "Projekten") :
      r.kind === "offers"   ? (r.count === 1 ? "Angebot"  : "Angeboten") :
      r.kind === "invoices" ? (r.count === 1 ? "Rechnung" : "Rechnungen") :
      r.kind === "partials" ? (r.count === 1 ? "Abschlag" : "Abschlägen") : r.kind,
  }));
  const blocked = labeled.length > 0;
  return {
    blocked,
    entity: { label: entityLabel },
    refs:   labeled,
    message: blocked
      ? `${entityLabel} wird noch in ${joinRefs(labeled)} genutzt — bitte erst dort umstellen.`
      : "",
  };
}

// ── PROJECT_TYPE (Projekttyp) ─────────────────────────────────────────────

async function checkProjectTyp(supabase, { tenantId, id }) {
  const { data: t } = await supabase.from("PROJECT_TYPE").select("NAME_SHORT").eq("ID", id).maybeSingle();
  const entityLabel = `Projekttyp „${t?.NAME_SHORT || `#${id}`}"`;
  const projects = await safeReferences(supabase, "PROJECT", "ID, NAME_SHORT", { TYP_ID: id, TENANT_ID: tenantId });
  const refs = [];
  const blk = formatRefBlock("projects", projects, p => p.NAME_SHORT || `#${p.ID}`);
  if (blk) refs.push({ ...blk, label: blk.count === 1 ? "Projekt" : "Projekten" });
  const blocked = refs.length > 0;
  return {
    blocked, entity: { label: entityLabel }, refs,
    message: blocked ? `${entityLabel} wird noch in ${joinRefs(refs)} verwendet.` : "",
  };
}

// ── ROLE (Projekt-Rolle, mit Stundensatz) ─────────────────────────────────

async function checkRole(supabase, { tenantId, id }) {
  const { data: r } = await supabase.from("ROLE").select("NAME_SHORT").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
  const entityLabel = `Projekt-Rolle „${r?.NAME_SHORT || `#${id}`}"`;
  const [employees, e2p] = await Promise.all([
    safeReferences(supabase, "EMPLOYEE",         "ID, SHORT_NAME", { ROLE_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "EMPLOYEE2PROJECT", "ID",             { ROLE_ID: id, TENANT_ID: tenantId }),
  ]);
  const refs = [];
  if (employees.length > 0) {
    const blk = formatRefBlock("employees", employees, e => e.SHORT_NAME || `#${e.ID}`);
    refs.push({ ...blk, label: blk.count === 1 ? "Mitarbeiter:in" : "Mitarbeiter:innen" });
  }
  if (e2p.length > 0) {
    refs.push({ kind: "team_assignments", count: e2p.length, sample: [], label: e2p.length === 1 ? "Projekt-Team-Zuordnung" : "Projekt-Team-Zuordnungen" });
  }
  const blocked = refs.length > 0;
  return {
    blocked, entity: { label: entityLabel }, refs,
    message: blocked ? `${entityLabel} ist noch ${joinRefs(refs)} zugewiesen.` : "",
  };
}

// ── DEPARTMENT (Abteilung) ────────────────────────────────────────────────

async function checkDepartment(supabase, { tenantId, id }) {
  const { data: d } = await supabase.from("DEPARTMENT").select("NAME_SHORT").eq("ID", id).maybeSingle();
  const entityLabel = `Abteilung „${d?.NAME_SHORT || `#${id}`}"`;
  const [employees, projects] = await Promise.all([
    safeReferences(supabase, "EMPLOYEE", "ID, SHORT_NAME, FIRST_NAME, LAST_NAME", { DEPARTMENT_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "PROJECT",  "ID, NAME_SHORT",                        { DEPARTMENT_ID: id, TENANT_ID: tenantId }),
  ]);
  const refs = [];
  if (employees.length > 0) {
    const blk = formatRefBlock("employees", employees, e => e.SHORT_NAME || `${e.FIRST_NAME || ""} ${e.LAST_NAME || ""}`.trim() || `#${e.ID}`);
    refs.push({ ...blk, label: blk.count === 1 ? "Mitarbeiter:in" : "Mitarbeiter:innen" });
  }
  if (projects.length > 0) {
    const blk = formatRefBlock("projects", projects, p => p.NAME_SHORT || `#${p.ID}`);
    refs.push({ ...blk, label: blk.count === 1 ? "Projekt" : "Projekten" });
  }
  const blocked = refs.length > 0;
  return {
    blocked, entity: { label: entityLabel }, refs,
    message: blocked ? `${entityLabel} kann nicht gelöscht werden — zugeordnet in ${joinRefs(refs)}.` : "",
  };
}

// ── USER_ROLE (RBAC-Rolle) ────────────────────────────────────────────────

async function checkUserRole(supabase, { tenantId, id }) {
  const { data: r } = await supabase.from("USER_ROLE").select("NAME_SHORT").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
  const entityLabel = `Rolle „${r?.NAME_SHORT || `#${id}`}"`;
  // Mitarbeiter mit dieser Rolle (per EMPLOYEE_ROLE-Tabelle)
  const empRoles = await safeReferences(supabase, "EMPLOYEE_ROLE", "EMPLOYEE_ID", { ROLE_ID: id });
  const refs = [];
  if (empRoles.length > 0) {
    const empIds = [...new Set(empRoles.map(er => er.EMPLOYEE_ID).filter(Boolean))];
    let sample = [];
    if (empIds.length > 0) {
      const { data: emps } = await supabase.from("EMPLOYEE").select("ID, SHORT_NAME").in("ID", empIds.slice(0, SAMPLE_LIMIT));
      sample = (emps || []).map(e => e.SHORT_NAME || `#${e.ID}`);
    }
    refs.push({ kind: "employees", count: empIds.length, sample, label: empIds.length === 1 ? "Mitarbeiter:in" : "Mitarbeiter:innen" });
  }
  const blocked = refs.length > 0;
  return {
    blocked, entity: { label: entityLabel }, refs,
    message: blocked ? `${entityLabel} ist noch ${joinRefs(refs)} zugewiesen.` : "",
  };
}

// ── CONTRACT ──────────────────────────────────────────────────────────────

async function checkContract(supabase, { tenantId, id }) {
  const { data: c } = await supabase.from("CONTRACT").select("NAME_SHORT, NAME_LONG").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
  const name = c ? `${c.NAME_SHORT || ""}${c.NAME_SHORT && c.NAME_LONG ? " — " : ""}${c.NAME_LONG || ""}`.trim() : `#${id}`;
  const entityLabel = `Vertrag „${name}"`;
  const [invoices, partials, structure] = await Promise.all([
    safeReferences(supabase, "INVOICE",           "ID, INVOICE_NUMBER",         { CONTRACT_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "PARTIAL_PAYMENT",   "ID, PARTIAL_PAYMENT_NUMBER", { CONTRACT_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "PROJECT_STRUCTURE", "ID",                          { CONTRACT_ID: id, TENANT_ID: tenantId }),
  ]);
  const refs = [];
  if (invoices.length > 0) {
    const blk = formatRefBlock("invoices", invoices, i => i.INVOICE_NUMBER || `#${i.ID}`);
    refs.push({ ...blk, label: blk.count === 1 ? "Rechnung" : "Rechnungen" });
  }
  if (partials.length > 0) {
    const blk = formatRefBlock("partials", partials, p => p.PARTIAL_PAYMENT_NUMBER || `#${p.ID}`);
    refs.push({ ...blk, label: blk.count === 1 ? "Abschlag" : "Abschlägen" });
  }
  if (structure.length > 0) {
    refs.push({ kind: "structure", count: structure.length, sample: [], label: structure.length === 1 ? "Strukturelement" : "Strukturelementen" });
  }
  const blocked = refs.length > 0;
  return {
    blocked, entity: { label: entityLabel }, refs,
    message: blocked ? `${entityLabel} kann nicht gelöscht werden — referenziert in ${joinRefs(refs)}.` : "",
  };
}

// ── WORKING_TIME_MODEL ────────────────────────────────────────────────────

async function checkWorkingTimeModel(supabase, { tenantId, id }) {
  const { data: w } = await supabase.from("WORKING_TIME_MODEL").select("NAME").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
  const entityLabel = `Arbeitszeitmodell „${w?.NAME || `#${id}`}"`;
  const assigns = await safeReferences(supabase, "EMPLOYEE_WORK_MODEL", "EMPLOYEE_ID", { MODEL_ID: id, TENANT_ID: tenantId });
  const refs = [];
  if (assigns.length > 0) {
    const empIds = [...new Set(assigns.map(a => a.EMPLOYEE_ID).filter(Boolean))];
    let sample = [];
    if (empIds.length > 0) {
      const { data: emps } = await supabase.from("EMPLOYEE").select("ID, SHORT_NAME").in("ID", empIds.slice(0, SAMPLE_LIMIT));
      sample = (emps || []).map(e => e.SHORT_NAME || `#${e.ID}`);
    }
    refs.push({ kind: "employees", count: empIds.length, sample, label: empIds.length === 1 ? "Mitarbeiter:in" : "Mitarbeiter:innen" });
  }
  const blocked = refs.length > 0;
  return {
    blocked, entity: { label: entityLabel }, refs,
    message: blocked ? `${entityLabel} ist ${joinRefs(refs)} zugeordnet.` : "",
  };
}

// ── TEC (Buchung) ─────────────────────────────────────────────────────────

async function checkTec(supabase, { tenantId, id }) {
  const { data: tec } = await supabase
    .from("TEC")
    .select("DATE_VOUCHER, QUANTITY_INT, INVOICE_ID, PARTIAL_PAYMENT_ID, EMPLOYEE_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  const dateStr = tec?.DATE_VOUCHER || "";
  const qty = tec?.QUANTITY_INT;
  const entityLabel = `Buchung vom ${dateStr || "—"}${qty != null ? ` (${qty} h)` : ""}`;

  const refs = [];
  if (tec?.INVOICE_ID) {
    const { data: inv } = await supabase.from("INVOICE").select("INVOICE_NUMBER").eq("ID", tec.INVOICE_ID).maybeSingle();
    refs.push({ kind: "invoice", count: 1, sample: [inv?.INVOICE_NUMBER || `#${tec.INVOICE_ID}`], label: "Rechnung" });
  }
  if (tec?.PARTIAL_PAYMENT_ID) {
    const { data: pp } = await supabase.from("PARTIAL_PAYMENT").select("PARTIAL_PAYMENT_NUMBER").eq("ID", tec.PARTIAL_PAYMENT_ID).maybeSingle();
    refs.push({ kind: "partial", count: 1, sample: [pp?.PARTIAL_PAYMENT_NUMBER || `#${tec.PARTIAL_PAYMENT_ID}`], label: "Abschlag" });
  }
  const blocked = refs.length > 0;
  return {
    blocked, entity: { label: entityLabel }, refs,
    message: blocked ? `${entityLabel} kann nicht gelöscht werden — bereits in ${joinRefs(refs)} abgerechnet.` : "",
  };
}

// ── PROJECT_STRUCTURE node ────────────────────────────────────────────────

async function checkProjectStructure(supabase, { tenantId, id }) {
  const { data: s } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("NAME_SHORT, PROJECT_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  const entityLabel = `Strukturelement „${s?.NAME_SHORT || `#${id}`}"`;

  const [tec, children] = await Promise.all([
    safeReferences(supabase, "TEC",               "ID", { STRUCTURE_ID: id, TENANT_ID: tenantId }),
    safeReferences(supabase, "PROJECT_STRUCTURE", "ID, NAME_SHORT", { FATHER_ID: id, TENANT_ID: tenantId }),
  ]);

  const refs = [];
  if (tec.length > 0) {
    refs.push({ kind: "bookings", count: tec.length, sample: [], label: tec.length === 1 ? "Buchung" : "Buchungen" });
  }
  if (children.length > 0) {
    const blk = formatRefBlock("children", children, c => c.NAME_SHORT || `#${c.ID}`);
    refs.push({ ...blk, label: blk.count === 1 ? "Kind-Strukturelement" : "Kind-Strukturelementen" });
  }
  const blocked = refs.length > 0;
  return {
    blocked, entity: { label: entityLabel }, refs,
    message: blocked ? `${entityLabel} kann nicht gelöscht werden — enthält ${joinRefs(refs)}.` : "",
  };
}

// ── OFFER_STRUCTURE node ──────────────────────────────────────────────────

async function checkOfferStructure(supabase, { tenantId, id }) {
  const { data: s } = await supabase
    .from("OFFER_STRUCTURE")
    .select("NAME_SHORT, OFFER_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  const entityLabel = `Angebotsstrukturelement „${s?.NAME_SHORT || `#${id}`}"`;

  const children = await safeReferences(supabase, "OFFER_STRUCTURE", "ID, NAME_SHORT", { FATHER_ID: id, TENANT_ID: tenantId });
  const refs = [];
  if (children.length > 0) {
    const blk = formatRefBlock("children", children, c => c.NAME_SHORT || `#${c.ID}`);
    refs.push({ ...blk, label: blk.count === 1 ? "Kind-Strukturelement" : "Kind-Strukturelementen" });
  }
  const blocked = refs.length > 0;
  return {
    blocked, entity: { label: entityLabel }, refs,
    message: blocked ? `${entityLabel} kann nicht gelöscht werden — enthält ${joinRefs(refs)}.` : "",
  };
}

module.exports = {
  checkAddress,
  checkContact,
  checkEmployee,
  checkProject,
  checkOffer,
  checkMahnung,
  checkProjectStatus,
  checkProjectTyp,
  checkDepartment,
  checkUserRole,
  checkRole,
  checkContract,
  checkWorkingTimeModel,
  checkTec,
  checkProjectStructure,
  checkOfferStructure,
};
