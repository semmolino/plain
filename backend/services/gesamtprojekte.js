"use strict";

/**
 * Gesamtprojekte — mehrere Projekte (Einzelvertraege) als eine Einheit.
 *
 * Ein Gesamtprojekt ist eine KLAMMER, kein Beleg-Traeger: Buchungen, Vertrag,
 * Rechnungen, Nachtraege und Leistungsstaende bleiben am einzelnen Projekt.
 * Hier wird nur zugeordnet und summiert. Konzept: docs/GESAMTPROJEKT_CONCEPT.md
 *
 * Drei Regeln, die ueberall gelten, wo Gesamtprojekte auftauchen:
 *   1. Quoten aus Summen, nie als Mittelwert (aggregateKpis).
 *   2. Summen nur ueber Projekte im Reporting-Scope des Aufrufers — die
 *      Summe verborgener Projekte verlaesst den Server nicht (routes/reports.js).
 *   3. Die Zuordnung prueft den Mandanten selbst (assertOwnGroup): der
 *      Fremdschluessel PROJECT → PROJECT_GROUP umgeht RLS und nimmt jede ID.
 */

const { assertOwnAddress } = require("./adressen");

const LIMITS = { NAME: 200, ABBR: 60, NOTES: 4000 };

/** Positive Ganzzahl oder null. */
function toId(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function text(v, max, label) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw { status: 400, message: `${label} darf höchstens ${max} Zeichen lang sein.` };
  return s;
}

/**
 * Gehoert das Gesamtprojekt diesem Mandanten? Liefert die Zeile oder wirft.
 * `status` erlaubt 404 fuer den direkten Zugriff (/gruppen/:id) und 400, wenn
 * die ID nur als Wert in einer Anfrage steht (Projektdaten).
 */
async function assertOwnGroup(supabase, { tenantId, groupId, status = 400 }) {
  const id = toId(groupId);
  if (!tenantId) throw { status: 401, message: "Kein Mandant." };
  if (!id) throw { status, message: "Dieses Gesamtprojekt gibt es nicht (mehr)." };
  const { data, error } = await supabase.from("PROJECT_GROUP")
    .select("ID, ABBR, NAME").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw { status, message: "Dieses Gesamtprojekt gibt es nicht (mehr)." };
  return data;
}

async function assertOwnEmployee(supabase, { tenantId, employeeId }) {
  const { data, error } = await supabase.from("EMPLOYEE").select("ID")
    .eq("ID", employeeId).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw { status: 400, message: "Diesen Mitarbeiter gibt es nicht (mehr)." };
}

/**
 * Anfrage → Spalten. `partial` = PATCH: nur mitgeschickte Felder; der Name
 * darf sich aendern, aber nicht leeren.
 */
async function groupColumns(supabase, { tenantId, body, partial }) {
  const b = body || {};
  const row = {};
  if (!partial || b.name !== undefined) {
    const name = text(b.name, LIMITS.NAME, "Der Name");
    if (!name) throw { status: 400, message: "Name ist erforderlich." };
    row.NAME = name;
  }
  if (!partial || b.abbr !== undefined)  row.ABBR  = text(b.abbr,  LIMITS.ABBR,  "Das Kürzel");
  if (!partial || b.notes !== undefined) row.NOTES = text(b.notes, LIMITS.NOTES, "Die Notiz");
  if (!partial || b.address_id !== undefined) {
    row.ADDRESS_ID = toId(b.address_id);
    if (row.ADDRESS_ID) await assertOwnAddress(supabase, { tenantId, addressId: row.ADDRESS_ID });
  }
  if (!partial || b.manager_id !== undefined) {
    row.MANAGER_ID = toId(b.manager_id);
    if (row.MANAGER_ID) await assertOwnEmployee(supabase, { tenantId, employeeId: row.MANAGER_ID });
  }
  return row;
}

/** Namen fuer Adressen und Leitung — eine Abfrage je Tabelle. */
async function decorate(supabase, { tenantId, groups }) {
  const addrIds = [...new Set(groups.map((g) => g.ADDRESS_ID).filter(Boolean))];
  const mgrIds  = [...new Set(groups.map((g) => g.MANAGER_ID).filter(Boolean))];
  const [addrRes, mgrRes] = await Promise.all([
    addrIds.length
      ? supabase.from("ADDRESS").select("ID, ADDRESS_NAME_1").eq("TENANT_ID", tenantId).in("ID", addrIds)
      : Promise.resolve({ data: [] }),
    mgrIds.length
      ? supabase.from("EMPLOYEE").select("ID, ABBR, FIRST_NAME, LAST_NAME").eq("TENANT_ID", tenantId).in("ID", mgrIds)
      : Promise.resolve({ data: [] }),
  ]);
  if (addrRes.error) throw addrRes.error;
  if (mgrRes.error) throw mgrRes.error;
  const addr = new Map((addrRes.data || []).map((a) => [String(a.ID), a.ADDRESS_NAME_1 || ""]));
  const mgr  = new Map((mgrRes.data || []).map((e) => [
    String(e.ID),
    [e.FIRST_NAME, e.LAST_NAME].filter(Boolean).join(" ") || e.ABBR || "",
  ]));
  return groups.map((g) => ({
    ...g,
    ADDRESS_NAME: g.ADDRESS_ID ? addr.get(String(g.ADDRESS_ID)) || "" : "",
    MANAGER_NAME: g.MANAGER_ID ? mgr.get(String(g.MANAGER_ID)) || "" : "",
  }));
}

const GROUP_COLS = "ID, ABBR, NAME, ADDRESS_ID, MANAGER_ID, NOTES, created_at, updated_at";

/** Alle Gesamtprojekte des Mandanten, je mit den IDs seiner Projekte. */
async function listGroups(supabase, { tenantId }) {
  const [gRes, pRes] = await Promise.all([
    supabase.from("PROJECT_GROUP").select(GROUP_COLS).eq("TENANT_ID", tenantId).order("NAME", { ascending: true }),
    supabase.from("PROJECT").select("ID, PROJECT_GROUP_ID").eq("TENANT_ID", tenantId).not("PROJECT_GROUP_ID", "is", null),
  ]);
  if (gRes.error) throw gRes.error;
  if (pRes.error) throw pRes.error;
  const members = new Map();
  for (const p of pRes.data || []) {
    const k = String(p.PROJECT_GROUP_ID);
    if (!members.has(k)) members.set(k, []);
    members.get(k).push(p.ID);
  }
  const groups = (gRes.data || []).map((g) => {
    const ids = members.get(String(g.ID)) || [];
    return { ...g, PROJECT_IDS: ids, PROJECT_COUNT: ids.length };
  });
  return decorate(supabase, { tenantId, groups });
}

/** Ein Gesamtprojekt samt seiner Projekte (ohne Betraege — die kommen aus dem Report). */
async function getGroup(supabase, { tenantId, id }) {
  const own = await assertOwnGroup(supabase, { tenantId, groupId: id, status: 404 });
  const [gRes, pRes] = await Promise.all([
    supabase.from("PROJECT_GROUP").select(GROUP_COLS).eq("ID", own.ID).eq("TENANT_ID", tenantId).maybeSingle(),
    supabase.from("PROJECT")
      .select("ID, ABBR, NAME, PROJECT_STATUS_ID, PROJECT_MANAGER_ID, ADDRESS_ID, COMPANY_ID, IS_INTERNAL")
      .eq("TENANT_ID", tenantId).eq("PROJECT_GROUP_ID", own.ID).order("ABBR", { ascending: true }),
  ]);
  if (gRes.error) throw gRes.error;
  if (pRes.error) throw pRes.error;
  const projects = pRes.data || [];
  const [group] = await decorate(supabase, { tenantId, groups: [gRes.data] });
  return {
    ...group,
    PROJECT_IDS: projects.map((p) => p.ID),
    PROJECT_COUNT: projects.length,
    PROJECTS: projects,
  };
}

async function createGroup(supabase, { tenantId, body }) {
  const row = await groupColumns(supabase, { tenantId, body, partial: false });
  const { data, error } = await supabase.from("PROJECT_GROUP")
    .insert([{ ...row, TENANT_ID: tenantId }]).select("ID").single();
  if (error) throw error;
  let moved = [];
  if (Array.isArray(body?.project_ids) && body.project_ids.length) {
    ({ moved } = await setMembers(supabase, { tenantId, id: data.ID, projectIds: body.project_ids }));
  }
  return { group: await getGroup(supabase, { tenantId, id: data.ID }), moved };
}

async function patchGroup(supabase, { tenantId, id, body }) {
  const own = await assertOwnGroup(supabase, { tenantId, groupId: id, status: 404 });
  const row = await groupColumns(supabase, { tenantId, body, partial: true });
  if (Object.keys(row).length) {
    const { error } = await supabase.from("PROJECT_GROUP")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("ID", own.ID).eq("TENANT_ID", tenantId);
    if (error) throw error;
  }
  return getGroup(supabase, { tenantId, id: own.ID });
}

/**
 * Loescht nur die Klammer. Die Projekte bleiben und verlieren die Zuordnung —
 * ausdruecklich und mit Mandantenfilter, nicht erst ueber ON DELETE SET NULL.
 */
async function deleteGroup(supabase, { tenantId, id }) {
  const own = await assertOwnGroup(supabase, { tenantId, groupId: id, status: 404 });
  const { data: unlinked, error: uErr } = await supabase.from("PROJECT")
    .update({ PROJECT_GROUP_ID: null })
    .eq("TENANT_ID", tenantId).eq("PROJECT_GROUP_ID", own.ID)
    .select("ID");
  if (uErr) throw uErr;
  const { error } = await supabase.from("PROJECT_GROUP").delete().eq("ID", own.ID).eq("TENANT_ID", tenantId);
  if (error) throw error;
  return { deleted: true, unlinked: (unlinked || []).length };
}

/**
 * Setzt die Projekte eines Gesamtprojekts auf genau diese Liste. Ein Projekt,
 * das schon in einem anderen Gesamtprojekt steht, wird umgehaengt — die
 * Antwort nennt es (`moved`), damit die Oberflaeche es sagen kann.
 */
async function setMembers(supabase, { tenantId, id, projectIds }) {
  const own = await assertOwnGroup(supabase, { tenantId, groupId: id, status: 404 });
  if (!Array.isArray(projectIds)) throw { status: 400, message: "project_ids muss eine Liste sein." };
  const ids = [...new Set(projectIds.map(toId))];
  if (ids.some((x) => x === null)) throw { status: 400, message: "Ungültige Projekt-ID." };

  let found = [];
  if (ids.length) {
    const { data, error } = await supabase.from("PROJECT")
      .select("ID, ABBR, NAME, PROJECT_GROUP_ID").eq("TENANT_ID", tenantId).in("ID", ids);
    if (error) throw error;
    found = data || [];
  }
  if (found.length !== ids.length) {
    throw { status: 400, message: "Mindestens eines der Projekte gibt es nicht (mehr)." };
  }

  const { data: current, error: cErr } = await supabase.from("PROJECT")
    .select("ID").eq("TENANT_ID", tenantId).eq("PROJECT_GROUP_ID", own.ID);
  if (cErr) throw cErr;

  const wanted  = new Set(ids.map(String));
  const remove  = (current || []).map((p) => p.ID).filter((pid) => !wanted.has(String(pid)));
  const add     = found.filter((p) => String(p.PROJECT_GROUP_ID ?? "") !== String(own.ID));
  const movedFrom = add.filter((p) => p.PROJECT_GROUP_ID);

  let moved = [];
  if (movedFrom.length) {
    const fromIds = [...new Set(movedFrom.map((p) => p.PROJECT_GROUP_ID))];
    const { data: fromGroups, error: fErr } = await supabase.from("PROJECT_GROUP")
      .select("ID, NAME").eq("TENANT_ID", tenantId).in("ID", fromIds);
    if (fErr) throw fErr;
    const names = new Map((fromGroups || []).map((g) => [String(g.ID), g.NAME]));
    moved = movedFrom.map((p) => ({
      ID: p.ID, ABBR: p.ABBR, NAME: p.NAME,
      FROM_GROUP_ID: p.PROJECT_GROUP_ID, FROM_GROUP_NAME: names.get(String(p.PROJECT_GROUP_ID)) || "",
    }));
  }

  if (remove.length) {
    const { error } = await supabase.from("PROJECT").update({ PROJECT_GROUP_ID: null })
      .eq("TENANT_ID", tenantId).eq("PROJECT_GROUP_ID", own.ID).in("ID", remove);
    if (error) throw error;
  }
  if (add.length) {
    const { error } = await supabase.from("PROJECT").update({ PROJECT_GROUP_ID: own.ID })
      .eq("TENANT_ID", tenantId).in("ID", add.map((p) => p.ID));
    if (error) throw error;
  }
  return { added: add.length, removed: remove.length, moved };
}

/**
 * Projekt-ID → Gesamtprojekt (ID, ABBR, NAME) fuer eine Liste von Projekten.
 * Fuer Listen und Reports, die die Zuordnung neben ihre eigenen Zeilen legen.
 */
async function groupsByProject(supabase, { tenantId, projectIds = null }) {
  let q = supabase.from("PROJECT").select("ID, PROJECT_GROUP_ID")
    .eq("TENANT_ID", tenantId).not("PROJECT_GROUP_ID", "is", null);
  if (projectIds) {
    if (!projectIds.length) return new Map();
    q = q.in("ID", projectIds);
  }
  const { data: links, error } = await q;
  if (error) throw error;
  const groupIds = [...new Set((links || []).map((l) => l.PROJECT_GROUP_ID))];
  if (!groupIds.length) return new Map();
  const { data: groups, error: gErr } = await supabase.from("PROJECT_GROUP")
    .select("ID, ABBR, NAME").eq("TENANT_ID", tenantId).in("ID", groupIds);
  if (gErr) throw gErr;
  const byId = new Map((groups || []).map((g) => [String(g.ID), g]));
  const out = new Map();
  for (const l of links || []) {
    const g = byId.get(String(l.PROJECT_GROUP_ID));
    if (g) out.set(String(l.ID), g);
  }
  return out;
}

/**
 * Wie groupsByProject, aber fuer Listen, die auch ohne Gesamtprojekte
 * funktionieren muessen: der Web-Container startet VOR dem postdeploy-Hook,
 * PROJECT_GROUP_ID steht in den ersten Minuten eines Deploys also noch nicht
 * im Schema. Nur genau dieser Fall wird zur leeren Zuordnung — jeder andere
 * Fehler bleibt ein Fehler (ein geschluckter Fehler beim Lesen ist hier ein
 * falsches Ergebnis, siehe CLAUDE.md).
 */
async function groupsByProjectIfMigrated(supabase, args) {
  try {
    return await groupsByProject(supabase, args);
  } catch (e) {
    if (/PROJECT_GROUP/.test(String(e?.message || ""))) return new Map();
    throw e;
  }
}

// ── Rechenkern (rein, ohne Datenbank) ────────────────────────────────────────

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const SUM_FIELDS = [
  "BUDGET_TOTAL_NET", "LEISTUNGSSTAND_VALUE", "HOURS_TOTAL", "COST_TOTAL",
  "REMAINING_BUDGET_NET", "BILLED_NET_TOTAL", "OPEN_NET_TOTAL", "PAYED_NET_TOTAL",
  "SALES_TOTAL", "QTY_EXT_TOTAL",
];

/**
 * Kennzahlen eines Gesamtprojekts aus den Zeilen seiner Projekte (Form von
 * VW_REPORT_PROJECT_DETAIL). Betraege werden summiert, Quoten AUS den Summen
 * gerechnet — ein Mittelwert der Prozente gaebe einem 5.000-EUR-Nachtrag
 * dasselbe Gewicht wie dem 400.000-EUR-Hauptvertrag. Dieselbe Rechnung wie
 * die Summenzeile im Report „Alle Projekte" (renderTotal), damit Zwischen-
 * summe und Gesamtprojekt-Kopf nie auseinanderlaufen.
 *
 * Keine Grundlage → null (kein Wert), nicht 0.
 */
function aggregateKpis(rows) {
  const out = {};
  for (const f of SUM_FIELDS) out[f] = round2((rows || []).reduce((s, r) => s + num(r?.[f]), 0));
  const b = out.BUDGET_TOTAL_NET;
  const l = out.LEISTUNGSSTAND_VALUE;
  out.LEISTUNGSSTAND_PERCENT = b > 0 ? round2((l / b) * 100) : null;
  out.COST_RATIO = l > 0 ? out.COST_TOTAL / l : null;
  out.PROJECT_COUNT = (rows || []).length;
  return out;
}

module.exports = {
  LIMITS,
  assertOwnGroup,
  listGroups,
  getGroup,
  createGroup,
  patchGroup,
  deleteGroup,
  setMembers,
  groupsByProject,
  groupsByProjectIfMigrated,
  aggregateKpis,
};
