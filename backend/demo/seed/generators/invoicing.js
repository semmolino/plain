"use strict";

/**
 * Generator: Rechnungen & Zahlungen (Abschlags-/Schlussrechnungen + Zahlungseingänge).
 *
 * PLATZHALTER — wird in der nächsten Iteration über die echten Services
 * (partialPayments.initPartialPayment/applyPerformanceAmount/bookPartialPayment,
 * invoices.*, finalInvoices.bookFinalInvoice) + Zahlungslogik aus routes/payments.js
 * umgesetzt. Läuft NACH progress, weil die Abrechnung auf dem Leistungsstand aufsetzt.
 */

async function generate({ log }) {
  log("  Rechnungen & Zahlungen: folgt in der nächsten Iteration (noch nicht implementiert).");
  return { skipped: true };
}

module.exports = { generate };
