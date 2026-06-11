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

module.exports = {
  checkAddress,
  checkContact,
  checkEmployee,
  checkProject,
};
