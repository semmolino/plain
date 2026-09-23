"use strict";

// ---------------------------------------------------------------------------
// Die Summenformel eines Belegs — an EINER Stelle.
//
// Dieselbe Rechnung stand bisher zweimal da: in recomputeInvoiceTotals
// (services/invoices.js) und in recomputePartialPaymentTotals
// (services/partialPayments.js). Der gebuendelte Belegimport braucht sie ein
// drittes Mal — und eine dritte Kopie waere die, die driftet.
//
// Warum das keine Kleinigkeit ist: zwei Wege zu derselben Zahl, von denen
// einer aus dem Zwischenspeicher kommt, weichen irgendwann voneinander ab,
// und zwar ohne Warnung. Genau dieser Befund steht ueber
// recomputeBilledByStructure in services/finalInvoices.js.
//
// Die Funktion ist rein: keine Datenbank, kein req/res. Damit laesst sie sich
// pruefen, und der Import kann seine Summen rechnen, BEVOR er schreibt —
// Voraussetzung dafuer, einen Beleg gleich fertig gebucht einzufuegen statt
// ihn als Entwurf anzulegen und nachtraeglich zu aktualisieren.
// ---------------------------------------------------------------------------

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

/**
 * Die fuenf Betragsspalten eines Belegs aus seinen Positionen.
 *
 * @param {object}  args
 * @param {Array}   args.positionen  [{ AMOUNT_NET, AMOUNT_EXTRAS_NET }]
 * @param {number}  args.vatPercent  Steuersatz in Prozent (0 = keine Steuer)
 * @param {number} [args.abzuege]    Summe der Abzuege (Schlussrechnung: bereits
 *                                   gestellte Abschlaege). Mindert den Betrag,
 *                                   auf den die Steuer gerechnet wird — so
 *                                   macht es recomputeTotal in finalInvoices.js.
 * @returns {{AMOUNT_NET:number, AMOUNT_EXTRAS_NET:number, TOTAL_AMOUNT_NET:number,
 *            TAX_AMOUNT_NET:number, TOTAL_AMOUNT_GROSS:number}}
 */
function belegSummen({ positionen, vatPercent, abzuege = 0 }) {
  const netto  = round2((positionen || []).reduce((s, p) => s + (Number(p?.AMOUNT_NET) || 0), 0));
  const extras = round2((positionen || []).reduce((s, p) => s + (Number(p?.AMOUNT_EXTRAS_NET) || 0), 0));

  // Reihenfolge ist bindend: erst beide Teilsummen einzeln runden, dann
  // addieren. Rundet man erst am Ende, weicht das Ergebnis bei vielen
  // Positionen um Cents von dem ab, was die App schreibt — und dann streiten
  // zwei Zahlen darueber, welche die richtige ist.
  const gesamtNetto = round2(netto + extras - (Number(abzuege) || 0));
  const steuer      = round2(gesamtNetto * (Number(vatPercent) || 0) / 100);

  return {
    AMOUNT_NET:         netto,
    AMOUNT_EXTRAS_NET:  extras,
    TOTAL_AMOUNT_NET:   gesamtNetto,
    TAX_AMOUNT_NET:     steuer,
    TOTAL_AMOUNT_GROSS: round2(gesamtNetto + steuer),
  };
}

module.exports = { belegSummen, round2 };
