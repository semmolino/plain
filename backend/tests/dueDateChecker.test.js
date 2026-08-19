"use strict";

// Faelligkeits-Erinnerungen duerfen nur fuer OFFENE Rechnungen entstehen.
// INVOICE traegt kein Bezahlt-Kennzeichen — der offene Betrag steckt in den
// PAYMENT-Zeilen. Ohne diese Pruefung meldete der Checker jede gebuchte
// Rechnung als faellig, auch eine laengst vollstaendig bezahlte.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { checkDueDates } = require("../services/dueDateChecker");

// DUE_DATE als YYYY-MM-DD relativ zu heute. Bewusst aus den LOKALEN
// Datumsteilen gebaut: toISOString() rechnet nach UTC um und verschiebt das
// Datum oestlich von Greenwich um einen Tag — der Checker vergleicht aber
// gegen die lokale Mitternacht.
function tage(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function rechnung(id, extra = {}) {
  return {
    ID: id,
    TENANT_ID: 1,
    INVOICE_NUMBER: `R-${id}`,
    STATUS_ID: 2,
    INVOICE_TYPE: "schlussrechnung",
    DUE_DATE: tage(3),
    TOTAL_AMOUNT_GROSS: 1190,
    TOTAL_AMOUNT_NET: 1000,
    VAT_PERCENT: 19,
    ...extra,
  };
}

async function laufMit({ invoices, payments = [] }) {
  const db = makeFakeSupabase({
    INVOICE: invoices,
    PAYMENT: payments,
    NOTIFICATION: [],
    NOTIFICATION_TYPE: [],
  });
  await checkDueDates(db);
  return db._tables.NOTIFICATION;
}

describe("dueDateChecker — bezahlte Rechnungen", () => {
  test("offene Rechnung 3 Tage vor Faelligkeit erzeugt eine Erinnerung", async () => {
    const notifs = await laufMit({ invoices: [rechnung(1)] });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].TYPE).toBe("invoice_due");
    expect(notifs[0].METADATA.invoice_id).toBe("1");
  });

  test("vollstaendig bezahlte Rechnung erzeugt KEINE Erinnerung", async () => {
    const notifs = await laufMit({
      invoices: [rechnung(1)],
      payments: [{ ID: 1, INVOICE_ID: 1, AMOUNT_PAYED_GROSS: 1190 }],
    });
    expect(notifs).toHaveLength(0);
  });

  test("Zahlung in mehreren Raten zaehlt zusammen", async () => {
    const notifs = await laufMit({
      invoices: [rechnung(1)],
      payments: [
        { ID: 1, INVOICE_ID: 1, AMOUNT_PAYED_GROSS: 600 },
        { ID: 2, INVOICE_ID: 1, AMOUNT_PAYED_GROSS: 590 },
      ],
    });
    expect(notifs).toHaveLength(0);
  });

  test("Teilzahlung laesst die Erinnerung bestehen", async () => {
    const notifs = await laufMit({
      invoices: [rechnung(1)],
      payments: [{ ID: 1, INVOICE_ID: 1, AMOUNT_PAYED_GROSS: 500 }],
    });
    expect(notifs).toHaveLength(1);
  });

  test("bezahlte Rechnung wird auch nicht als ueberfaellig gemeldet", async () => {
    const notifs = await laufMit({
      invoices: [rechnung(1, { DUE_DATE: tage(-7) })],
      payments: [{ ID: 1, INVOICE_ID: 1, AMOUNT_PAYED_GROSS: 1190 }],
    });
    expect(notifs).toHaveLength(0);
  });

  test("offene Rechnung 7 Tage nach Faelligkeit wird als ueberfaellig gemeldet", async () => {
    const notifs = await laufMit({ invoices: [rechnung(1, { DUE_DATE: tage(-7) })] });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].TYPE).toBe("invoice_overdue");
  });

  test("Zahlung einer anderen Rechnung stellt diese nicht still", async () => {
    const notifs = await laufMit({
      invoices: [rechnung(1), rechnung(2)],
      payments: [{ ID: 1, INVOICE_ID: 2, AMOUNT_PAYED_GROSS: 1190 }],
    });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].METADATA.invoice_id).toBe("1");
  });

  test("ohne bezifferbaren Betrag wird lieber erinnert als geschwiegen", async () => {
    const notifs = await laufMit({
      invoices: [rechnung(1, { TOTAL_AMOUNT_GROSS: null, TOTAL_AMOUNT_NET: null })],
    });
    expect(notifs).toHaveLength(1);
  });

  test("fehlt der Bruttowert, wird er aus Netto + USt rekonstruiert", async () => {
    const notifs = await laufMit({
      invoices: [rechnung(1, { TOTAL_AMOUNT_GROSS: null })],
      payments: [{ ID: 1, INVOICE_ID: 1, AMOUNT_PAYED_GROSS: 1190 }],
    });
    expect(notifs).toHaveLength(0);
  });

  test("Rundungsrest von einem halben Cent gilt als bezahlt", async () => {
    const notifs = await laufMit({
      invoices: [rechnung(1)],
      payments: [{ ID: 1, INVOICE_ID: 1, AMOUNT_PAYED_GROSS: 1189.996 }],
    });
    expect(notifs).toHaveLength(0);
  });
});
