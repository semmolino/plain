"use strict";

/**
 * Lädt die manuell angelegten Stammdaten eines Demo-Mandanten und bereitet sie
 * für die Generatoren auf: Projekte mit Struktur-Baum (inkl. Blatt-Erkennung),
 * Verträgen, Mitarbeiter-Zuordnungen und Kostensatz-Historie.
 *
 * Es wird ausschließlich gelesen. Fehlende, aber für Bewegungsdaten nötige
 * Bausteine werden als Warnungen gemeldet (nicht hart abgebrochen), damit man
 * den Zustand vor dem Generieren gefahrlos prüfen kann.
 */

async function fetchAll(supabase, table, tenantId, cols = "*") {
  const { data, error } = await supabase.from(table).select(cols).eq("TENANT_ID", tenantId);
  if (error) return { rows: [], error: error.message };
  return { rows: data || [], error: null };
}

// Blatt = kein anderes Element verweist per FATHER_ID auf dieses.
function computeLeaves(structures) {
  const parentIds = new Set(structures.map((s) => (s.FATHER_ID != null ? String(s.FATHER_ID) : null)).filter(Boolean));
  return structures.filter((s) => !parentIds.has(String(s.ID)));
}

async function loadMasterData(supabase, tenantId) {
  const warnings = [];
  const errors = [];

  // Tenant selbst
  const { data: tenant, error: tErr } = await supabase.from("TENANTS").select("*").eq("ID", tenantId).maybeSingle();
  if (tErr || !tenant) errors.push(`TENANTS ${tenantId} nicht gefunden (${tErr?.message || "leer"}).`);

  const company = (await fetchAll(supabase, "COMPANY", tenantId)).rows[0] || null;
  if (!company) warnings.push("Keine COMPANY vorhanden — Rechnungsnummern/Belege brauchen eine Firma.");

  const employees = (await fetchAll(supabase, "EMPLOYEE", tenantId)).rows;
  const roles = (await fetchAll(supabase, "ROLE", tenantId)).rows;
  const projects = (await fetchAll(supabase, "PROJECT", tenantId)).rows;
  const structures = (await fetchAll(supabase, "PROJECT_STRUCTURE", tenantId)).rows;
  const contracts = (await fetchAll(supabase, "CONTRACT", tenantId)).rows;
  const assignments = (await fetchAll(supabase, "EMPLOYEE2PROJECT", tenantId)).rows;
  const offers = (await fetchAll(supabase, "OFFER", tenantId)).rows;
  const cpRates = (await fetchAll(supabase, "EMPLOYEE_CP_RATE", tenantId)).rows;
  const bookingTypes = (await fetchAll(supabase, "BOOKING_TYPE", tenantId)).rows;

  // Referenzdaten (teils global, teils tenant): tolerant laden.
  const vats = (await fetchAll(supabase, "VAT", tenantId)).rows;
  const currencies = (await supabase.from("CURRENCY").select("*")).data || [];
  const paymentMeans = (await fetchAll(supabase, "PAYMENT_MEANS", tenantId)).rows;
  const projectStatus = (await supabase.from("PROJECT_STATUS").select("*")).data || [];

  // Kostensatz-Historie je Mitarbeiter
  const cpByEmp = new Map();
  for (const r of cpRates) {
    const k = String(r.EMPLOYEE_ID);
    if (!cpByEmp.has(k)) cpByEmp.set(k, []);
    cpByEmp.get(k).push({ CP_RATE: Number(r.CP_RATE), VALID_FROM: r.VALID_FROM });
  }
  for (const list of cpByEmp.values()) list.sort((a, b) => (a.VALID_FROM < b.VALID_FROM ? -1 : 1));

  const employeesEnriched = employees.map((e) => ({
    ...e,
    cpRates: cpByEmp.get(String(e.ID)) || [],
  }));
  const employeesById = new Map(employeesEnriched.map((e) => [String(e.ID), e]));

  // Projekte mit Struktur-Baum, Vertrag, Zuordnungen, Angebot
  const structByProject = new Map();
  for (const s of structures) {
    const k = String(s.PROJECT_ID);
    if (!structByProject.has(k)) structByProject.set(k, []);
    structByProject.get(k).push(s);
  }
  const contractByProject = new Map(contracts.map((c) => [String(c.PROJECT_ID), c]));
  const assignByProject = new Map();
  for (const a of assignments) {
    const k = String(a.PROJECT_ID);
    if (!assignByProject.has(k)) assignByProject.set(k, []);
    assignByProject.get(k).push(a);
  }
  const offerById = new Map(offers.map((o) => [String(o.ID), o]));

  const projectsEnriched = projects.map((p) => {
    const projStructs = structByProject.get(String(p.ID)) || [];
    const leaves = computeLeaves(projStructs);
    const projAssign = assignByProject.get(String(p.ID)) || [];
    const contract = contractByProject.get(String(p.ID)) || null;
    const offer = p.OFFER_ID != null ? offerById.get(String(p.OFFER_ID)) || null : null;

    if (projStructs.length === 0) warnings.push(`Projekt "${p.NAME_SHORT || p.ID}" hat keine Struktur.`);
    else if (leaves.length === 0) warnings.push(`Projekt "${p.NAME_SHORT || p.ID}" hat keine Blatt-Elemente.`);
    if (projAssign.length === 0) warnings.push(`Projekt "${p.NAME_SHORT || p.ID}" hat keine Mitarbeiter-Zuordnung (EMPLOYEE2PROJECT).`);
    if (!contract) warnings.push(`Projekt "${p.NAME_SHORT || p.ID}" hat keinen CONTRACT — ohne Vertrag keine Rechnungen.`);

    return { ...p, structures: projStructs, leaves, assignments: projAssign, contract, offer };
  });

  // Kostensätze fehlen → Buchungen bekommen CP_RATE 0 (Kosten unrealistisch niedrig).
  const empsWithoutRate = employeesEnriched.filter((e) => e.cpRates.length === 0);
  if (empsWithoutRate.length > 0) {
    warnings.push(
      `${empsWithoutRate.length} Mitarbeiter ohne Kostensatz-Historie (EMPLOYEE_CP_RATE) — ` +
        `Buchungen kalkulieren dann mit Kosten 0. Tipp: seedCostRates aktivieren oder Sätze pflegen.`,
    );
  }

  return {
    tenantId,
    tenant,
    company,
    companyId: company?.ID || null,
    employees: employeesEnriched,
    employeesById,
    roles,
    projects: projectsEnriched,
    bookingTypes,
    refs: {
      vat: vats[0] || null,
      currency: currencies.find((c) => c.NAME_SHORT === "EUR") || currencies[0] || null,
      paymentMeans: paymentMeans[0] || null,
      projectStatus,
    },
    warnings,
    errors,
  };
}

function summarize(md) {
  const lines = [];
  lines.push(`Mandant: ${md.tenant?.TENANT || "?"} (ID ${md.tenantId})`);
  lines.push(`Firma:   ${md.company?.COMPANY_NAME_1 || "— fehlt —"}`);
  lines.push(`Mitarbeiter: ${md.employees.length}  ·  Rollen: ${md.roles.length}`);
  lines.push(`Projekte: ${md.projects.length}`);
  for (const p of md.projects) {
    lines.push(
      `  • ${String(p.NAME_SHORT || p.ID).padEnd(24)} ` +
        `Blätter:${String(p.leaves.length).padStart(2)}  ` +
        `Zuordn.:${String(p.assignments.length).padStart(2)}  ` +
        `Vertrag:${p.contract ? "ja" : "NEIN"}`,
    );
  }
  return lines.join("\n");
}

module.exports = { loadMasterData, summarize, computeLeaves };
