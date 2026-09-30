"use strict";

/**
 * Stornieren und neu ausstellen — mit Zahlungsuebertrag (Migration 0180).
 *
 * Vorher: Storno, danach die Rechnung im Assistenten von vorn anlegen. Die
 * Zahlungen blieben am stornierten Original haengen oder wurden mit dem
 * Storno geloescht und mussten neu erfasst werden.
 *
 * Jetzt:
 *   reissue()   Storno wie bisher (Zahlungen bleiben stehen), dazu ein
 *               ENTWURF aus dem Original — Kopf, Positionen, die Buchungen,
 *               die der Storno freigegeben hat, bei einer Schlussrechnung die
 *               Auswahl der Abzuege. Rechnungsdatum heute, Faelligkeit mit
 *               demselben Zahlungsziel, Nummer erst beim Buchen.
 *               REPLACES_* haelt den Bezug auf das Original.
 *   transferReplacedPayments()
 *               beim BUCHEN des Entwurfs: die Zahlungen des Originals wandern
 *               samt Aufteilung (PAYMENT_STRUCTURE) auf die neue Rechnung.
 *
 * Warum erst beim Buchen: bis dahin hat der Entwurf keine Nummer, und eine
 * Zahlung gehoert zu einem Beleg, den der Kunde kennt. Wird der Entwurf
 * verworfen, bleibt alles, wie es nach einem Storno ist. PROJECT.PAYED und
 * die Leistungsstand-Snapshots aendern sich durch den Uebertrag nicht — die
 * Zahlungen gibt es weiter, sie gehoeren nur zu einem anderen Beleg.
 *
 * Ausgebuchte Reste gehen nicht mit: der Storno nimmt sie zurueck
 * (receivableAdjustments.removeForCancelledDoc); die neue Rechnung ist
 * genau der Ort, an dem der Betrag anders ausgewiesen wird.
 */

const { CREATE_KEY_BY_INVOICE_TYPE } = require("../middleware/draftEdit");

const META = {
  INVOICE: {
    table: "INVOICE", structTable: "INVOICE_STRUCTURE", idCol: "INVOICE_ID", dateCol: "INVOICE_DATE",
    replacesCol: "REPLACES_INVOICE_ID",
    // Was ein neuer Entwurf nicht erbt — nur Spalten, die es am Original gibt
    reset: { INVOICE_NUMBER: null, CANCELS_INVOICE_ID: null, CANCELLATION_DATE: null, SE_RELEASE_TOTAL: null,
      IMPORT_BATCH_ID: null, CORRECTS_INVOICE_ID: null, CORRECTS_ADVANCE_INVOICE_ID: null, CORRECTION_REASON: null },
  },
  ADVANCE_INVOICE: {
    table: "ADVANCE_INVOICE", structTable: "ADVANCE_INVOICE_STRUCTURE", idCol: "ADVANCE_INVOICE_ID", dateCol: "ADVANCE_INVOICE_DATE",
    replacesCol: "REPLACES_ADVANCE_INVOICE_ID",
    reset: { ADVANCE_INVOICE_NUMBER: null, CANCELS_ADVANCE_INVOICE_ID: null, CANCELLATION_DATE: null,
      SE_RELEASED_BY_INVOICE_ID: null, ABSORBED_BY_INVOICE_ID: null, INVOICE_ID: null, IMPORT_BATCH_ID: null },
  },
};

// Spalten, die zum gebuchten Dokument gehoeren, nicht zum Inhalt
const SKIP = new Set(["ID", "created_at", "updated_at"]);

function fail(status, message) { return { status, message }; }

function isoToday() { return new Date().toISOString().slice(0, 10); }

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Zahlungsziel des Originals in Tagen (Faelligkeit − Belegdatum), sonst null. */
function termDays(orig, dateCol) {
  const a = Date.parse(`${String(orig[dateCol] || "").slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(orig.DUE_DATE || "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Anlege-Recht der Belegart — wer neu ausstellt, legt einen Entwurf dieser Art an. */
function createKeyFor(kind, row) {
  if (kind === "ADVANCE_INVOICE") return "invoices.create_partial";
  const type = row?.INVOICE_TYPE ? String(row.INVOICE_TYPE) : "rechnung";
  return CREATE_KEY_BY_INVOICE_TYPE[type] || null;
}

async function loadDoc(supabase, kind, id, tenantId) {
  const m = META[kind];
  const { data, error } = await supabase.from(m.table).select("*").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Prueft, ob der Beleg neu ausgestellt werden kann; wirft {status, message}. */
function assertReissuable(kind, orig) {
  if (!orig) throw fail(404, kind === "INVOICE" ? "Rechnung nicht gefunden." : "Abschlagsrechnung nicht gefunden.");
  if (Number(orig.STATUS_ID) !== 2) throw fail(400, "Nur gebuchte Belege lassen sich stornieren und neu ausstellen.");
  // Vor dem Storno pruefen: ohne Migration 0180 stuende sonst ein Storno ohne Entwurf da.
  if (!(META[kind].replacesCol in orig)) {
    throw fail(503, "Neu ausstellen ist gleich verfügbar — die Datenbank wird noch aktualisiert. Bitte in ein paar Minuten erneut versuchen.");
  }
  if (kind === "INVOICE") {
    if (orig.INVOICE_TYPE === "stornorechnung" || orig.CANCELS_INVOICE_ID != null) {
      throw fail(400, "Eine Stornorechnung lässt sich nicht neu ausstellen.");
    }
    if (orig.INVOICE_TYPE === "gutschrift") {
      throw fail(400, "Eine Rechnungskorrektur wird storniert und bei Bedarf neu erfasst — neu ausstellen gibt es dafür nicht.");
    }
  } else {
    if (orig.CANCELS_ADVANCE_INVOICE_ID != null) throw fail(400, "Eine Stornorechnung lässt sich nicht neu ausstellen.");
    if (orig.ABSORBED_BY_INVOICE_ID != null || orig.INVOICE_ID != null) {
      throw fail(409, "Die Abschlagsrechnung ist in einer Schlussrechnung aufgegangen. Bitte zuerst die Schlussrechnung stornieren.");
    }
  }
}

async function idsOf(supabase, table, col, value, tenantId) {
  const { data, error } = await supabase.from(table).select("ID").eq(col, value).eq("TENANT_ID", tenantId);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.ID);
}

/**
 * Storniert einen gebuchten Beleg und legt den Entwurf an, der ihn ersetzt.
 * @param {'INVOICE'|'ADVANCE_INVOICE'} kind
 * @param {(key:string)=>boolean} [can]  Rechte-Pruefung des Aufrufers
 */
async function reissue(supabase, { kind, id, tenantId, can = () => true }) {
  const m = META[kind];
  if (!m) throw fail(400, "Unbekannte Belegart.");
  const docId = parseInt(String(id), 10);
  const orig = await loadDoc(supabase, kind, docId, tenantId);
  assertReissuable(kind, orig);
  const createKey = createKeyFor(kind, orig);
  if (!createKey || !can(createKey)) {
    throw fail(403, "Zum Neu-Ausstellen fehlt das Recht, diese Belegart anzulegen.");
  }

  // Was der Storno freigibt — VOR dem Storno merken.
  const bookingIds = await idsOf(supabase, "BOOKING", m.idCol, docId, tenantId);
  const { data: structRows, error: sSelErr } = await supabase.from(m.structTable).select("*").eq(m.idCol, docId);
  if (sSelErr) throw new Error(sSelErr.message);
  let dedRows = [];
  if (kind === "INVOICE") {
    const { data, error: dSelErr } = await supabase.from("INVOICE_DEDUCTION")
      .select("ADVANCE_INVOICE_ID, DEDUCTION_AMOUNT_NET").eq("INVOICE_ID", docId);
    if (dSelErr) throw new Error(dSelErr.message);
    dedRows = data || [];
  }

  // 1. Storno wie bisher — Zahlungen bleiben am Original, bis der Entwurf gebucht ist
  let storno;
  if (kind === "INVOICE") {
    const { cancelInvoice } = require("./invoices");
    storno = await cancelInvoice(supabase, { id: docId, tenantId, deletePayments: false });
  } else {
    const { cancelPartialPayment } = require("./partialPayments");
    storno = await cancelPartialPayment(supabase, { id: docId, tenantId, deletePayments: false });
  }

  // 2. Entwurf aus dem Original
  const copy = {};
  for (const [k, v] of Object.entries(orig)) {
    if (SKIP.has(k) || /^document_/i.test(k)) continue;
    copy[k] = k in m.reset ? m.reset[k] : v;
  }
  const today = isoToday();
  const term = termDays(orig, m.dateCol);
  Object.assign(copy, {
    STATUS_ID: 1,
    [m.dateCol]: today,
    DUE_DATE: term != null ? addDays(today, term) : (orig.DUE_DATE ?? null),
    [m.replacesCol]: docId,
    TENANT_ID: tenantId,
  });

  const { data: created, error: insErr } = await supabase.from(m.table).insert([copy]).select("ID").single();
  if (insErr) {
    // Ohne Migration 0180 fehlt REPLACES_* — der Storno steht, der Entwurf nicht
    throw fail(500, `Storniert, aber der neue Entwurf konnte nicht angelegt werden: ${insErr.message}`);
  }
  const draftId = created.ID;

  if ((structRows || []).length > 0) {
    const rows = structRows.map((r) => {
      const row = {};
      for (const [k, v] of Object.entries(r)) if (!SKIP.has(k) && k !== "IMPORT_BATCH_ID") row[k] = v;
      return { ...row, [m.idCol]: draftId, TENANT_ID: tenantId };
    });
    const { error } = await supabase.from(m.structTable).insert(rows);
    if (error) throw new Error(error.message);
  }
  if (dedRows.length > 0) {
    // Auswahl der Abzuege; die Betraege gleicht das Buchen ab (refreshDeductions)
    const { error } = await supabase.from("INVOICE_DEDUCTION").insert(dedRows.map((d) => ({
      INVOICE_ID: draftId, ADVANCE_INVOICE_ID: d.ADVANCE_INVOICE_ID,
      DEDUCTION_AMOUNT_NET: d.DEDUCTION_AMOUNT_NET, TENANT_ID: tenantId,
    })));
    if (error) throw new Error(error.message);
  }
  if (bookingIds.length > 0) {
    const { error } = await supabase.from("BOOKING").update({ [m.idCol]: draftId })
      .in("ID", bookingIds).eq("TENANT_ID", tenantId);
    if (error) throw new Error(error.message);
  }

  const paymentIds = await idsOf(supabase, "PAYMENT", m.idCol, docId, tenantId);
  return {
    storno_id: storno?.id ?? null,
    draft_id: draftId,
    kind,
    invoice_type: kind === "INVOICE" ? (orig.INVOICE_TYPE || "rechnung") : null,
    payments_pending: paymentIds.length,
  };
}

/**
 * Beim Buchen: ersetzt der Beleg eine stornierte Rechnung, gehen deren
 * Zahlungen auf ihn ueber. Best-effort — die Buchung ist dann schon gueltig;
 * ein Fehler hier wird geloggt, nicht geworfen.
 * @returns {Promise<number>} Anzahl uebertragener Zahlungen
 */
async function transferReplacedPayments(supabase, { kind, id, tenantId }) {
  const m = META[kind];
  try {
    const docId = parseInt(String(id), 10);
    const doc = await loadDoc(supabase, kind, docId, tenantId);
    const fromId = doc?.[m.replacesCol];
    if (!fromId) return 0;
    // Der Storno eines Ersatzbelegs erbt REPLACES_* — er uebernimmt nichts.
    const isStorno = kind === "INVOICE"
      ? (doc.INVOICE_TYPE === "stornorechnung" || doc.CANCELS_INVOICE_ID != null)
      : doc.CANCELS_ADVANCE_INVOICE_ID != null;
    if (isStorno) return 0;

    const paymentIds = await idsOf(supabase, "PAYMENT", m.idCol, fromId, tenantId);
    if (paymentIds.length === 0) return 0;
    const { error: pErr } = await supabase.from("PAYMENT").update({ [m.idCol]: docId })
      .in("ID", paymentIds).eq("TENANT_ID", tenantId);
    if (pErr) throw new Error(pErr.message);
    const { error: psErr } = await supabase.from("PAYMENT_STRUCTURE").update({ [m.idCol]: docId })
      .in("PAYMENT_ID", paymentIds).eq("TENANT_ID", tenantId);
    if (psErr) throw new Error(psErr.message);
    return paymentIds.length;
  } catch (e) {
    console.error("[REISSUE][TRANSFER_PAYMENTS]", { kind, id, error: e?.message || e });
    return 0;
  }
}

module.exports = { reissue, transferReplacedPayments, createKeyFor, termDays };
