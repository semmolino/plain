"use strict";

// Offener Betrag — die eine Rechnung dafuer (services/openAmount.js).
// Vorher rechneten Rechnungsliste, Mahnwesen, Faelligkeitshinweise, Dashboard
// und E-Mail-Vorlagen je selbst, und nur die Liste kannte Nachlass,
// Einbehalt und Skonto. Diese Tests halten die Regeln fest.

const { claimOf, computeOpen, withClaimCols, openAmountsFor } = require("../services/openAmount");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");

const rechnung = (extra = {}) => ({
  ID: 1, TENANT_ID: 1, INVOICE_DATE: "2026-09-01",
  TOTAL_AMOUNT_NET: 1000, TOTAL_AMOUNT_GROSS: 1190, VAT_PERCENT: 19, VAT_CATEGORY: "S",
  ...extra,
});

describe("claimOf — was der Beleg fordert", () => {
  test("ohne Nachlass gilt das gespeicherte Brutto", () => {
    expect(claimOf(rechnung(), "INVOICE").payable).toBe(1190);
  });

  test("Nachlass wird wie auf dem PDF abgezogen (gespeichertes Brutto ist VOR Nachlass)", () => {
    const c = claimOf(rechnung({ DISCOUNT_1_PERCENT: 10 }), "INVOICE");
    expect(c.discounts).toBe(100);
    expect(c.gross).toBe(1071); // 900 + 19 %
  });

  test("gespeicherte Nachlass-Summe hat Vorrang vor den Prozenten", () => {
    expect(claimOf(rechnung({ TOTAL_DISCOUNTS: 50, DISCOUNT_1_PERCENT: 10 }), "INVOICE").gross).toBe(1130.5);
  });

  test("Sicherheitseinbehalt mindert die Forderung, eine Aufloesung erhoeht sie (nur Rechnung)", () => {
    expect(claimOf(rechnung({ SE_AMOUNT: 59.5 }), "INVOICE").payable).toBe(1130.5);
    expect(claimOf(rechnung({ SE_RELEASE_TOTAL: 100 }), "INVOICE").payable).toBe(1290);
    expect(claimOf({ ...rechnung({ SE_RELEASE_TOTAL: 100 }), ADVANCE_INVOICE_DATE: "2026-09-01" }, "ADVANCE_INVOICE").payable).toBe(1190);
  });

  test("Reverse-Charge: kein Steueraufschlag auf den Betrag nach Nachlass", () => {
    const c = claimOf(rechnung({ VAT_CATEGORY: "AE", TOTAL_AMOUNT_GROSS: 1000, DISCOUNT_1_PERCENT: 10 }), "INVOICE");
    expect(c.gross).toBe(900);
  });

  test("Skonto: Betrag und Frist ab Rechnungsdatum", () => {
    const c = claimOf(rechnung({ CASH_DISCOUNT_PERCENT: 2, CASH_DISCOUNT_DAYS: 14 }), "INVOICE");
    expect(c.skontoGross).toBe(1166.2);
    expect(c.skontoDeadline).toBe("2026-09-15");
  });
});

describe("computeOpen — offen nach Zahlungen und ausgebuchten Resten", () => {
  const c = claimOf(rechnung(), "INVOICE");

  test("Teilzahlung laesst den Rest offen", () => {
    const o = computeOpen(c, { payments: [{ gross: 1000, date: "2026-09-10" }] });
    expect(o.open).toBe(190);
    expect(o.settled).toBe(false);
  });

  test("ausgebuchter Rest schliesst den Beleg", () => {
    const o = computeOpen(c, { payments: [{ gross: 1000 }], adjustments: [{ gross: 190 }] });
    expect(o.open).toBe(0);
    expect(o.settled).toBe(true);
    expect(o.adjusted).toBe(190);
  });

  test("Skontozahlung innerhalb der Frist erledigt den Beleg", () => {
    const cs = claimOf(rechnung({ CASH_DISCOUNT_PERCENT: 2, CASH_DISCOUNT_DAYS: 14 }), "INVOICE");
    const o = computeOpen(cs, { payments: [{ gross: 1166.2, date: "2026-09-14" }] });
    expect(o.open).toBe(0);
    expect(o.skontoTaken).toBe(true);
  });

  test("Skontozahlung NACH der Frist laesst die Differenz offen", () => {
    const cs = claimOf(rechnung({ CASH_DISCOUNT_PERCENT: 2, CASH_DISCOUNT_DAYS: 14 }), "INVOICE");
    const o = computeOpen(cs, { payments: [{ gross: 1166.2, date: "2026-09-20" }] });
    expect(o.open).toBe(23.8);
    expect(o.skontoTaken).toBe(false);
  });

  test("ohne Rechnungsdatum zaehlt beim Skonto nur der Betrag (alte Regel)", () => {
    const cs = claimOf(rechnung({ INVOICE_DATE: null, CASH_DISCOUNT_PERCENT: 2, CASH_DISCOUNT_DAYS: 14 }), "INVOICE");
    expect(computeOpen(cs, { payments: [{ gross: 1166.2, date: "2027-01-01" }] }).open).toBe(0);
  });

  test("Ueberzahlung ergibt einen negativen offenen Betrag", () => {
    expect(computeOpen(c, { payments: [{ gross: 1200 }] }).open).toBe(-10);
  });
});

describe("withClaimCols", () => {
  test("nennt keine Spalte doppelt", () => {
    const cols = withClaimCols("INVOICE", "ID, INVOICE_DATE, TOTAL_AMOUNT_GROSS").split(", ");
    expect(new Set(cols).size).toBe(cols.length);
    expect(cols).toContain("SE_RELEASE_TOTAL");
  });
});

describe("openAmountsFor — gebuendelt geladen", () => {
  test("liest Zahlungen und ausgebuchte Reste je Beleg", async () => {
    const db = makeFakeSupabase({
      PAYMENT: [
        { ID: 1, TENANT_ID: 1, INVOICE_ID: 1, AMOUNT_PAYED_GROSS: 700, PAYMENT_DATE: "2026-09-10" },
        { ID: 2, TENANT_ID: 1, INVOICE_ID: 2, AMOUNT_PAYED_GROSS: 1190, PAYMENT_DATE: "2026-09-10" },
      ],
      RECEIVABLE_ADJUSTMENT: [
        { ID: 5, TENANT_ID: 1, INVOICE_ID: 1, AMOUNT_GROSS: 90, AMOUNT_NET: 75.63, REBILLABLE: false },
      ],
    });
    const out = await openAmountsFor(db, { kind: "INVOICE", docs: [rechnung(), rechnung({ ID: 2 })], tenantId: 1 });
    expect(out.get("1").open).toBe(400);
    expect(out.get("1").adjusted).toBe(90);
    expect(out.get("2").settled).toBe(true);
  });

  test("fehlt die Tabelle der ausgebuchten Reste, wird ohne sie gerechnet", async () => {
    const db = makeFakeSupabase({ PAYMENT: [] });
    const orig = db.from.bind(db);
    db.from = (t) => {
      if (t !== "RECEIVABLE_ADJUSTMENT") return orig(t);
      const err = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.RECEIVABLE_ADJUSTMENT' in the schema cache" } };
      const b = { select: () => b, in: () => b, eq: () => b, then: (res) => Promise.resolve(err).then(res) };
      return b;
    };
    const out = await openAmountsFor(db, { kind: "INVOICE", docs: [rechnung()], tenantId: 1 });
    expect(out.get("1").open).toBe(1190);
  });
});
