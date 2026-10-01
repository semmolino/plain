"use strict";

/**
 * Buchungsauswahl der Rechnungsassistenten (Abschlag, Einzelrechnung,
 * Rechnungskorrektur) — was `GET /invoices/:id/tec` und
 * `GET /partial-payments/:id/tec` gemeinsam liefern.
 */

// Buchungsarten ohne Stundencharakter (wie SPECIAL_KINDS in services/buchungen.js):
// dort ist QUANTITY_EXT eine Stueckzahl oder 1 — keine Stunden.
const NON_HOUR_KINDS = new Set(["UNIT", "LUMP_COST", "LUMP_REVENUE"]);

// Spalten, die `tecEntry` braucht.
const TEC_SELECT =
  "ID, BOOKING_DATE, POSTING_DESCRIPTION, QUANTITY_EXT, HOURLY_RATE_TOTAL, BOOKING_KIND, STRUCTURE_ID, " +
  "ADVANCE_INVOICE_ID, INVOICE_ID, EMPLOYEE:EMPLOYEE_ID(ABBR), STRUCTURE:STRUCTURE_ID(ABBR, NAME)";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function tecEntry(t, assigned) {
  const s = t.STRUCTURE || null;
  return {
    ID: t.ID,
    BOOKING_DATE: t.BOOKING_DATE,
    EMPLOYEE_SHORT_NAME: t.EMPLOYEE?.ABBR ?? "",
    POSTING_DESCRIPTION: t.POSTING_DESCRIPTION ?? "",
    HOURLY_RATE_TOTAL: round2(t.HOURLY_RATE_TOTAL),
    // null = keine Stundenbuchung (Pauschale, Stueckleistung)
    HOURS: NON_HOUR_KINDS.has(t.BOOKING_KIND) ? null : round2(t.QUANTITY_EXT),
    STRUCTURE_ID: t.STRUCTURE_ID ?? null,
    STRUCTURE_LABEL: s ? [s.ABBR, s.NAME].filter(Boolean).join(" – ") : "",
    ASSIGNED: !!assigned,
  };
}

/**
 * Letzte Rechnung eines Vertrags — Stichtag fuer den Filter „Seit letzter
 * Rechnung".
 *
 * Es zaehlen gebuchte (STATUS_ID 2) Abschlags-, Einzel-, Teilschluss- und
 * Schlussrechnungen. Nicht: Entwuerfe, stornierte Belege (STATUS_ID 3),
 * Stornobelege und Rechnungskorrekturen — sie eroeffnen keinen neuen
 * Abrechnungszeitraum. Ein Storno von heute leerte sonst die ganze Liste.
 *
 * Stichtag ist das Ende des Leistungszeitraums, ohne Leistungszeitraum das
 * Belegdatum: die Rechnung vom 05.10. fuer September laesst die Buchungen
 * vom 01. bis 05.10. stehen. „Letzte" ist der Beleg mit dem spaetesten
 * Stichtag — eine nachgereichte Rechnung fuer August setzt den Stichtag nicht
 * hinter den schon abgerechneten September zurueck.
 *
 * Ohne Vertrag gilt das Projekt (wie `loadProjectStructuresForContext`).
 */

// Belegarten, die keine Leistung abrechnen.
const NOT_BILLING = new Set(["gutschrift", "stornorechnung"]);

const day = (v) => (v ? String(v).slice(0, 10) : null);

async function lastBilledDocument(supabase, { tenantId, projectId, contractId }) {
  if (tenantId === undefined || tenantId === null || tenantId === "") {
    throw { status: 500, message: "lastBilledDocument: tenantId ist erforderlich" };
  }
  if (!contractId && !projectId) return null;
  const scope = (q) => (contractId ? q.eq("CONTRACT_ID", contractId) : q.eq("PROJECT_ID", projectId));

  const [inv, adv] = await Promise.all([
    scope(
      supabase
        .from("INVOICE")
        .select("ID, INVOICE_NUMBER, INVOICE_DATE, BILLING_PERIOD_FINISH, INVOICE_TYPE")
        .eq("TENANT_ID", tenantId)
        .eq("STATUS_ID", 2)
    ),
    scope(
      supabase
        .from("ADVANCE_INVOICE")
        .select("ID, ADVANCE_INVOICE_NUMBER, ADVANCE_INVOICE_DATE, BILLING_PERIOD_FINISH, CANCELS_ADVANCE_INVOICE_ID")
        .eq("TENANT_ID", tenantId)
        .eq("STATUS_ID", 2)
    ),
  ]);
  if (inv.error) throw new Error(inv.error.message);
  if (adv.error) throw new Error(adv.error.message);

  const docs = [
    ...(inv.data || [])
      .filter((r) => !NOT_BILLING.has(String(r.INVOICE_TYPE || "").toLowerCase()))
      .map((r) => ({
        kind: r.INVOICE_TYPE || "rechnung",
        id: r.ID,
        number: r.INVOICE_NUMBER ?? null,
        date: day(r.INVOICE_DATE),
        period_end: day(r.BILLING_PERIOD_FINISH),
      })),
    ...(adv.data || [])
      .filter((r) => !r.CANCELS_ADVANCE_INVOICE_ID)
      .map((r) => ({
        kind: "abschlag",
        id: r.ID,
        number: r.ADVANCE_INVOICE_NUMBER ?? null,
        date: day(r.ADVANCE_INVOICE_DATE),
        period_end: day(r.BILLING_PERIOD_FINISH),
      })),
  ]
    .map((d) => ({ ...d, since: d.period_end || d.date }))
    .filter((d) => d.since);

  if (docs.length === 0) return null;
  docs.sort((a, b) => b.since.localeCompare(a.since) || String(b.date || "").localeCompare(String(a.date || "")));
  return docs[0];
}

module.exports = { TEC_SELECT, tecEntry, lastBilledDocument };
