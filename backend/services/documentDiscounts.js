"use strict";

/**
 * Nachlass I/II eines Belegs — eine Rechnung fuer PDF, E-Rechnung und offenen
 * Betrag (docs/RECHNUNGSKUERZUNGEN_ANALYSE.md, Nebenbefund 6).
 *
 * Gespeichert sind die Prozente (DISCOUNT_1/2_PERCENT) und die Summe
 * (TOTAL_DISCOUNTS, vom Assistenten gerechnet, invoiceTotals.ts).
 * TOTAL_AMOUNT_NET ist der Betrag VOR Nachlass. Die Betragsspalten
 * DISCOUNT_1/DISCOUNT_2 schreibt kein Code — das XML las bis 10/2026 nur sie,
 * nannte deshalb nie einen Nachlass und forderte den Betrag davor, waehrend
 * das PDF den danach forderte.
 *
 * Rechenweg wie auf dem PDF: Nachlass I auf das Netto, Nachlass II auf den
 * Rest, je auf Cent gerundet; massgeblich fuer die Summe ist TOTAL_DISCOUNTS,
 * ein Rundungsrest geht in die letzte Stufe.
 *
 * Vorzeichen: Storno und Rechnungskorrektur stehen negativ gespeichert, der
 * Storno erbt TOTAL_DISCOUNTS aber positiv. Die Betraege tragen deshalb das
 * Vorzeichen des Nettos — sonst stand im Storno-PDF „Netto −10.000, Nachlass
 * 1.000, verbleibend −11.000".
 */

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((toNum(n) + Number.EPSILON) * 100) / 100;
}

/**
 * @param {object} doc  INVOICE- oder ADVANCE_INVOICE-Zeile
 * @returns {{
 *   net:number, d1:number, d2:number, total:number, adjustedNet:number,
 *   steps: { percent:number, amount:number, baseAmount:number, reason:string }[]
 * }}  Betraege mit dem Vorzeichen des Nettos; steps nur mit Betrag ≠ 0
 */
function discountsOf(doc) {
  const net = round2(doc?.TOTAL_AMOUNT_NET);
  const sign = net < 0 ? -1 : 1;
  const base = Math.abs(net);
  const p1 = Math.abs(toNum(doc?.DISCOUNT_1_PERCENT));
  const p2 = Math.abs(toNum(doc?.DISCOUNT_2_PERCENT));

  let d1 = round2(Math.abs(toNum(doc?.DISCOUNT_1))) || round2(base * p1 / 100);
  let d2 = round2(Math.abs(toNum(doc?.DISCOUNT_2))) || round2((base - d1) * p2 / 100);
  const stored = round2(Math.abs(toNum(doc?.TOTAL_DISCOUNTS)));
  const total = stored > 0 ? stored : round2(d1 + d2);

  if (stored > 0 && d1 === 0 && d2 === 0) {
    d1 = total;                                   // Summe ohne Prozente (Altbestand, Import)
  } else if (Math.abs(total - round2(d1 + d2)) > 0.001) {
    if (d2 > 0) d2 = round2(total - d1); else d1 = total;
  }

  const reason = (r) => String(r ?? "").trim() || "Nachlass";
  const steps = [];
  if (d1 > 0) steps.push({ percent: p1, amount: sign * d1, baseAmount: sign * base, reason: reason(doc?.DISCOUNT_1_REASON) });
  if (d2 > 0) steps.push({ percent: p2, amount: sign * d2, baseAmount: sign * round2(base - d1), reason: reason(doc?.DISCOUNT_2_REASON) });

  const signedTotal = sign * total;
  return { net, d1: sign * d1, d2: sign * d2, total: signedTotal, adjustedNet: round2(net - signedTotal), steps };
}

module.exports = { discountsOf };
