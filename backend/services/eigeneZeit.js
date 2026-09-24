"use strict";

/**
 * „Eigene Zeit buchen" (Recht projects.bookings.own, Migration 0169).
 *
 * Wer nur dieses Recht hat, braucht zum Buchen zwei Listen: welche Projekte
 * gerade laufen, und welche Leistungen darin buchbar sind. Beides gab es nur
 * ueber die Projekt-Endpunkte hinter `projects.view` — und die zeigen
 * Honorare, Budgets und Strukturwerte aller Projekte. Hier stehen nur Nummer,
 * Name und Kuerzel.
 *
 * „Laufend" = die Status aus Einstellungen → Monatsabschluss
 * (TENANT_SETTINGS monatsabschluss_statuses). Nicht gesetzt: alle Projekte.
 */

const { assertProjectInTenant } = require("./tenantGuard");

async function runningStatusIds(supabase, tenantId) {
  const { data } = await supabase
    .from("TENANT_SETTINGS")
    .select("VALUE")
    .eq("TENANT_ID", tenantId)
    .eq("KEY", "monatsabschluss_statuses")
    .maybeSingle();
  try {
    const arr = JSON.parse(data?.VALUE || "[]");
    return Array.isArray(arr) ? arr.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function listOwnProjects(supabase, { tenantId }) {
  const statusIds = await runningStatusIds(supabase, tenantId);
  let q = supabase
    .from("PROJECT")
    .select("ID, ABBR, NAME, PROJECT_STATUS_ID")
    .eq("TENANT_ID", tenantId)
    .order("ABBR", { ascending: true });
  if (statusIds.length) q = q.in("PROJECT_STATUS_ID", statusIds);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(p => ({ ID: p.ID, ABBR: p.ABBR, NAME: p.NAME }));
}

/** 403, wenn auf das Projekt mit „Eigene Zeit" nicht gebucht werden darf. */
async function assertBookable(supabase, { tenantId, projectId }) {
  const pid = await assertProjectInTenant(supabase, projectId, tenantId);
  const statusIds = await runningStatusIds(supabase, tenantId);
  if (!statusIds.length) return pid;
  const { data } = await supabase
    .from("PROJECT").select("PROJECT_STATUS_ID").eq("ID", pid).eq("TENANT_ID", tenantId).maybeSingle();
  if (!data || !statusIds.includes(Number(data.PROJECT_STATUS_ID))) {
    throw { status: 403, message: "Auf dieses Projekt kann gerade nicht gebucht werden (Projekt läuft nicht)." };
  }
  return pid;
}

/** Leistungen eines laufenden Projekts — ohne Betraege. */
async function listOwnLeaves(supabase, { tenantId, projectId }) {
  const pid = await assertBookable(supabase, { tenantId, projectId });
  const { data, error } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, FATHER_ID, ABBR, NAME, BILLING_TYPE_ID, SORT_ORDER")
    .eq("PROJECT_ID", pid)
    .eq("TENANT_ID", tenantId)
    .order("SORT_ORDER", { ascending: true })
    .order("ID", { ascending: true });
  if (error) throw error;
  return (data || []).map(s => ({
    STRUCTURE_ID: s.ID, FATHER_ID: s.FATHER_ID ?? null, ABBR: s.ABBR, NAME: s.NAME, BILLING_TYPE_ID: s.BILLING_TYPE_ID,
  }));
}

/** Das Element muss zum Projekt gehoeren und ein Blatt sein. */
async function assertLeafOfProject(supabase, { tenantId, projectId, structureId }) {
  const { data: node } = await supabase
    .from("PROJECT_STRUCTURE").select("ID, PROJECT_ID").eq("ID", Number(structureId)).eq("TENANT_ID", tenantId).maybeSingle();
  if (!node || Number(node.PROJECT_ID) !== Number(projectId)) {
    throw { status: 400, message: "Die Leistung gehört nicht zu diesem Projekt." };
  }
}

// ---------------------------------------------------------------------------
// „Meine Zeit" — eigene Buchungen eines Zeitraums (GET /buchungen/mine)
// ---------------------------------------------------------------------------
//
// Ohne eigenes Recht: der Mitarbeiter kommt IMMER aus der Sitzung, nie aus der
// Anfrage — es gibt keinen Parameter, mit dem man fremde Zeiten laese. Keine
// Betraege (Saetze, Summen): die Karte zeigt Stunden, und wer nur eigene Zeit
// bucht, soll ueber diesen Weg nichts sehen, was er sonst nicht saehe.
//
// Je Buchung zwei Sperren, damit die Oberflaeche Bearbeiten/Loeschen gar nicht
// erst anbietet, statt erst beim Klick einen 409 zu zeigen:
//   BILLED — steckt in einer Rechnung oder Abschlagsrechnung
//   CLOSED — der Monat ist fuer den Mitarbeiter abgeschlossen
// Der Server prueft beides beim Schreiben ohnehin selbst (patchBuchung,
// deleteBuchung); das hier ist nur die Anzeige.

const MINE_MAX_DAYS = 62;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(from, to) {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
}

const belegLos = (v) => v === null || v === undefined || String(v) === "0";

async function listMine(supabase, { tenantId, employeeId, from, to }) {
  if (!employeeId) throw { status: 400, message: "Kein Mitarbeiter in der Sitzung" };
  if (!ISO.test(String(from || "")) || !ISO.test(String(to || ""))) {
    throw { status: 400, message: "from und to im Format JJJJ-MM-TT angeben" };
  }
  const span = daysBetween(from, to);
  if (span < 0) throw { status: 400, message: "„to“ liegt vor „from“" };
  if (span > MINE_MAX_DAYS) throw { status: 400, message: `Höchstens ${MINE_MAX_DAYS} Tage auf einmal` };

  const { data, error } = await supabase
    .from("BOOKING")
    .select(`
      ID, PROJECT_ID, STRUCTURE_ID, BOOKING_DATE, TIME_START, TIME_FINISH,
      QUANTITY_INT, QUANTITY_EXT, POSTING_DESCRIPTION, STATUS, ENTRY_KIND, BOOKING_KIND,
      INVOICE_ID, ADVANCE_INVOICE_ID,
      PROJECT:PROJECT_ID(ABBR, NAME),
      STRUCTURE:STRUCTURE_ID(ABBR, NAME)
    `)
    .eq("TENANT_ID", tenantId)
    .eq("EMPLOYEE_ID", employeeId)
    .gte("BOOKING_DATE", from)
    .lte("BOOKING_DATE", to)
    .order("BOOKING_DATE", { ascending: true })
    .order("TIME_START", { ascending: true });
  if (error) throw { status: 500, message: error.message };

  // Abgeschlossene Monate des Zeitraums, einmal gelesen statt je Zeile.
  const years = [...new Set([from.slice(0, 4), to.slice(0, 4)].map(Number))];
  const { data: closes } = await supabase
    .from("EMPLOYEE_MONTH_CLOSE")
    .select("YEAR, MONTH")
    .eq("TENANT_ID", tenantId)
    .eq("EMPLOYEE_ID", employeeId)
    .in("YEAR", years);
  const closed = new Set((closes || []).map(c => `${c.YEAR}-${String(c.MONTH).padStart(2, "0")}`));

  const bookings = [];
  const drafts   = [];
  for (const r of data || []) {
    const row = {
      ID:                  r.ID,
      PROJECT_ID:          r.PROJECT_ID,
      STRUCTURE_ID:        r.STRUCTURE_ID,
      BOOKING_DATE:        r.BOOKING_DATE,
      TIME_START:          r.TIME_START,
      TIME_FINISH:         r.TIME_FINISH,
      QUANTITY_INT:        Number(r.QUANTITY_INT ?? 0),
      // Nur ob die Abrechnungsstunden den geleisteten folgen — der Wert
      // selbst ist wie beim Projekt-Tab dem Umsatzrecht vorbehalten.
      EXT_FOLLOWS:         r.QUANTITY_EXT == null || Number(r.QUANTITY_EXT) === Number(r.QUANTITY_INT ?? 0),
      POSTING_DESCRIPTION: r.POSTING_DESCRIPTION ?? "",
      ENTRY_KIND:          r.ENTRY_KIND ?? "WORK",
      BOOKING_KIND:        r.BOOKING_KIND ?? null,
      PROJECT:             r.PROJECT ?? null,
      STRUCTURE:           r.STRUCTURE ?? null,
      BILLED:              !belegLos(r.INVOICE_ID) || !belegLos(r.ADVANCE_INVOICE_ID),
      CLOSED:              closed.has(String(r.BOOKING_DATE).slice(0, 7)),
    };
    (r.STATUS === "DRAFT" ? drafts : bookings).push(row);
  }
  return { from, to, bookings, drafts };
}

module.exports = { runningStatusIds, listOwnProjects, listOwnLeaves, assertBookable, assertLeafOfProject, listMine, MINE_MAX_DAYS };
