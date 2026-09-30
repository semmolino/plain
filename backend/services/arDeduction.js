"use strict";

/**
 * Was eine Schluss- oder Teilschlussrechnung von einer Abschlagsrechnung absetzt.
 *
 * Abzusetzen sind die VEREINNAHMTEN Teilentgelte (§ 14 Abs. 5 S. 2 UStG,
 * UStAE 14.8 Abs. 7); die Schlussrechnung von plan&simple ist eine
 * Restrechnung nach UStAE 14.8 Abs. 11 — sie rechnet das restliche Entgelt ab.
 * Vorher wurde der FAKTURIERTE Betrag abgesetzt. Ein nicht gezahlter Rest der
 * Abschlagsrechnung stand danach nirgends mehr in Rechnung: nicht in der
 * Schlussrechnung, und auf der Abschlagsrechnung nach Abnahme und
 * Schlussrechnung nicht mehr gesondert durchsetzbar (BGH VII ZR 205/07).
 * Wer den Abzug von Hand auf das Gezahlte setzte, bekam das Gegenteil: den
 * Rest in der Schlussrechnung UND weiter offen auf der Abschlagsrechnung.
 *
 * Abgesetzt wird jetzt, was auf der Abschlagsrechnung erledigt ist:
 *   + Zahlungen
 *   + endgueltig ausgebuchte Reste (Kulanz, Kuerzung, Ausfall, Skonto …)
 *   + Skonto, das eine fristgerechte Zahlung stillschweigend erledigt hat
 * Nicht abgesetzt — also in der Schlussrechnung enthalten:
 *   · ein noch offener Rest
 *   · der Sicherheitseinbehalt (er wurde nie gezahlt; die separate
 *     „Aufloesung" entfaellt fuer abgesetzte Abschlagsrechnungen)
 *   · wieder abrechenbar ausgebuchte Betraege
 *
 * Der Nettobetrag bezieht sich auf die Strukturzeilen, also auf den Betrag
 * VOR Nachlass I/II — sonst holte die Schlussrechnung einen gewaehrten
 * Nachlass wieder zurueck.
 */

const { openAmountsFor, withClaimCols, effectiveVatPercent, round2, toNum } = require("./openAmount");

const AR_COLS = withClaimCols("ADVANCE_INVOICE",
  "ID, ADVANCE_INVOICE_NUMBER, ADVANCE_INVOICE_DATE, PROJECT_ID, CONTRACT_ID, STATUS_ID, CANCELS_ADVANCE_INVOICE_ID");

/**
 * @param {object} ar  ADVANCE_INVOICE-Zeile (AR_COLS)
 * @param {object} o   Eintrag aus openAmountsFor (claim, paid, adjusted, adjustments, skontoTaken)
 */
function deductionOf(ar, o) {
  const claim = o.claim;
  const vatPct = effectiveVatPercent(ar);
  const adjs = o.adjustments || [];
  const finalAdj  = round2(adjs.filter(a => !a.REBILLABLE).reduce((s, a) => s + toNum(a.gross), 0));
  const rebillAdj = round2(adjs.filter(a => a.REBILLABLE).reduce((s, a) => s + toNum(a.gross), 0));
  // Skonto ohne eigene Ausbuchung: die Differenz ist trotzdem eine Minderung.
  const implicitSkonto = o.skontoTaken ? Math.max(0, round2(claim.payable - o.paid - o.adjusted)) : 0;
  const minderung = round2(finalAdj + implicitSkonto);
  const settledGross = round2(o.paid + minderung);

  const afterDiscount = round2(claim.net - claim.discounts);
  const scale = claim.net > 0 && afterDiscount > 0 ? claim.net / afterDiscount : 1;
  const deductionNet = round2((settledGross / (1 + vatPct / 100)) * scale);

  return {
    billedGross:     claim.gross,
    paidGross:       o.paid,
    seHeld:          claim.seHeld,
    minderungGross:  minderung,
    rebillableGross: rebillAdj,
    // Einbehalt + offener Rest + wieder abrechenbar: steht jetzt in der Schlussrechnung
    includedGross:   round2(claim.gross - settledGross),
    deductionNet,
    vatPct,
  };
}

/** @returns {Promise<Map<string, ReturnType<typeof deductionOf>>>} */
async function deductionsFor(supabase, { ars, tenantId = null }) {
  const open = await openAmountsFor(supabase, { kind: "ADVANCE_INVOICE", docs: ars || [], tenantId });
  const out = new Map();
  for (const ar of ars || []) {
    const o = open.get(String(ar.ID));
    if (o) out.set(String(ar.ID), { ...deductionOf(ar, o), absorbedBy: o.absorbedBy });
  }
  return out;
}

module.exports = { AR_COLS, deductionOf, deductionsFor };
