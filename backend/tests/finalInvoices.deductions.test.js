"use strict";

// Schlussrechnung setzt nur noch Vereinnahmtes ab (services/arDeduction.js,
// docs/RECHNUNGSKUERZUNGEN_ANALYSE.md Schritt b).
//
// Vorher: abgesetzt wurde der FAKTURIERTE Betrag jeder Abschlagsrechnung.
// Ein nicht gezahlter Rest stand danach nirgends mehr in Rechnung — nicht in
// der Schlussrechnung, und auf der Abschlagsrechnung nicht mehr durchsetzbar,
// aber weiter gemahnt. Setzte man den Abzug von Hand auf das Gezahlte, stand
// der Rest doppelt da.

jest.mock("../services_pdf_render", () => ({
  renderDocumentPdf: async () => ({ pdf: Buffer.from("pdf"), template: { ID: 1, LAYOUT_KEY: "modern_a" }, theme: {} }),
}));
jest.mock("../services_einvoice_ubl", () => ({ generateUblInvoiceXml: async () => "<Invoice/>" }));
jest.mock("../services/generatedAssets", () => ({
  storeGeneratedPdfAsAsset: async () => ({ ID: 91 }),
  storeGeneratedXmlAsAsset: async () => ({ ID: 92 }),
  bestEffortDeleteAsset: async () => {},
}));

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const fin = require("../services/finalInvoices");
const { openAmountsFor } = require("../services/openAmount");

const T = 1;

// Honorar 100.000 netto. Abschlag AR-7 über 30.000 netto / 35.700 brutto.
function welt({ ar = {}, payments = [], adjustments = [] } = {}) {
  return makeFakeSupabase({
    INVOICE: [{
      ID: 800, TENANT_ID: T, STATUS_ID: 1, PROJECT_ID: 40, CONTRACT_ID: 30, COMPANY_ID: 10,
      INVOICE_TYPE: "schlussrechnung", INVOICE_NUMBER: "SR-1", VAT_PERCENT: 19, VAT_CATEGORY: "S",
    }],
    INVOICE_STRUCTURE: [{ ID: 1, TENANT_ID: T, INVOICE_ID: 800, STRUCTURE_ID: 500, AMOUNT_NET: 100000, AMOUNT_EXTRAS_NET: 0 }],
    INVOICE_DEDUCTION: [],
    ADVANCE_INVOICE: [{
      ID: 700, TENANT_ID: T, STATUS_ID: 2, PROJECT_ID: 40, CONTRACT_ID: 30,
      ADVANCE_INVOICE_NUMBER: "AR-7", ADVANCE_INVOICE_DATE: "2026-06-01",
      TOTAL_AMOUNT_NET: 30000, TOTAL_AMOUNT_GROSS: 35700, VAT_PERCENT: 19, VAT_CATEGORY: "S",
      SE_AMOUNT: 0, SE_RELEASED_BY_INVOICE_ID: null, CANCELS_ADVANCE_INVOICE_ID: null,
      ...ar,
    }],
    ADVANCE_INVOICE_STRUCTURE: [{ ID: 1, TENANT_ID: T, ADVANCE_INVOICE_ID: 700, STRUCTURE_ID: 500, AMOUNT_NET: 30000, AMOUNT_EXTRAS_NET: 0 }],
    PAYMENT: payments.map((p, i) => ({ ID: i + 1, TENANT_ID: T, ADVANCE_INVOICE_ID: 700, PAYMENT_DATE: "2026-06-20", ...p })),
    RECEIVABLE_ADJUSTMENT: adjustments.map((a, i) => ({ ID: i + 1, TENANT_ID: T, ADVANCE_INVOICE_ID: 700, ...a })),
    PROJECT: [{ ID: 40, TENANT_ID: T, INVOICED: 0 }],
    PROJECT_STRUCTURE: [{ ID: 500, TENANT_ID: T, BILLING_TYPE_ID: 1, INVOICED: 0 }],
    PROJECT_PROGRESS: [], SE_RELEASE: [],
  });
}

const ded = async (db) => (await fin.getDeductions(db, { id: 800, tenantId: T }))[0];

describe("Abzug je Abschlagsrechnung", () => {
  test("voll bezahlt: voller Abzug", async () => {
    const d = await ded(welt({ payments: [{ AMOUNT_PAYED_GROSS: 35700 }] }));
    expect(d.DEDUCTION_AMOUNT_NET).toBe(30000);
    expect(d.INCLUDED_GROSS).toBe(0);
  });

  test("Teilzahlung: nur das Gezahlte, der Rest steht in der Schlussrechnung", async () => {
    const d = await ded(welt({ payments: [{ AMOUNT_PAYED_GROSS: 29750 }] }));
    expect(d.DEDUCTION_AMOUNT_NET).toBe(25000);
    expect(d.PAID_GROSS).toBe(29750);
    expect(d.INCLUDED_GROSS).toBe(5950);
  });

  test("nichts bezahlt: kein Abzug", async () => {
    expect((await ded(welt())).DEDUCTION_AMOUNT_NET).toBe(0);
  });

  test("Einbehalt: nie gezahlt, also in der Schlussrechnung enthalten", async () => {
    const d = await ded(welt({ ar: { SE_AMOUNT: 1785 }, payments: [{ AMOUNT_PAYED_GROSS: 33915 }] }));
    expect(d.DEDUCTION_AMOUNT_NET).toBe(28500);
    expect(d.SE_HELD).toBe(1785);
    expect(d.INCLUDED_GROSS).toBe(1785);
  });

  test("endgültig ausgebucht: gilt als erledigt und wird mit abgesetzt", async () => {
    const d = await ded(welt({
      payments: [{ AMOUNT_PAYED_GROSS: 29750 }],
      adjustments: [{ AMOUNT_GROSS: 5950, AMOUNT_NET: 5000, REBILLABLE: false, REASON: "kulanz" }],
    }));
    expect(d.DEDUCTION_AMOUNT_NET).toBe(30000);
    expect(d.MINDERUNG_GROSS).toBe(5950);
    expect(d.INCLUDED_GROSS).toBe(0);
  });

  test("wieder abrechenbar ausgebucht: steht in der Schlussrechnung", async () => {
    const d = await ded(welt({
      payments: [{ AMOUNT_PAYED_GROSS: 29750 }],
      adjustments: [{ AMOUNT_GROSS: 5950, AMOUNT_NET: 5000, REBILLABLE: true, REASON: "kuerzung" }],
    }));
    expect(d.DEDUCTION_AMOUNT_NET).toBe(25000);
    expect(d.REBILLABLE_GROSS).toBe(5950);
    expect(d.INCLUDED_GROSS).toBe(5950);
  });

  test("Skonto fristgerecht gezogen: die Differenz ist eine Minderung, kein offener Rest", async () => {
    const d = await ded(welt({
      ar: { CASH_DISCOUNT_PERCENT: 2, CASH_DISCOUNT_DAYS: 14 },
      payments: [{ AMOUNT_PAYED_GROSS: 34986, PAYMENT_DATE: "2026-06-10" }],
    }));
    expect(d.DEDUCTION_AMOUNT_NET).toBe(30000);
    expect(d.INCLUDED_GROSS).toBe(0);
  });

  test("Nachlass auf dem Abschlag bleibt gewährt (Abzug vor Nachlass)", async () => {
    // 30.000 − 10 % = 27.000 netto, 32.130 brutto — voll bezahlt.
    const d = await ded(welt({ ar: { DISCOUNT_1_PERCENT: 10 }, payments: [{ AMOUNT_PAYED_GROSS: 32130 }] }));
    expect(d.DEDUCTION_AMOUNT_NET).toBe(30000);
  });
});

describe("Speichern und Buchen", () => {
  test("der Abzug kommt vom Server, ein mitgeschickter Betrag zählt nicht", async () => {
    const db = welt({ payments: [{ AMOUNT_PAYED_GROSS: 29750 }] });
    const totals = await fin.saveDeductions(db, { id: 800, tenantId: T, items: [{ advance_invoice_id: 700, deduction_amount_net: 99999 }] });
    expect(db._tables.INVOICE_DEDUCTION[0].DEDUCTION_AMOUNT_NET).toBe(25000);
    expect(totals.totalNet).toBe(75000);
  });

  test("Zahlung seit dem Entwurf: Buchen hält an und aktualisiert den Abzug", async () => {
    const db = welt({ payments: [{ AMOUNT_PAYED_GROSS: 29750 }] });
    await fin.saveDeductions(db, { id: 800, tenantId: T, items: [{ advance_invoice_id: 700 }] });
    db._tables.PAYMENT.push({ ID: 9, TENANT_ID: T, ADVANCE_INVOICE_ID: 700, AMOUNT_PAYED_GROSS: 5950, PAYMENT_DATE: "2026-09-01" });
    await expect(fin.bookFinalInvoice(db, { id: 800, tenantId: T, force: true }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("AR-7") });
    expect(db._tables.INVOICE_DEDUCTION[0].DEDUCTION_AMOUNT_NET).toBe(30000);
    expect(db._tables.INVOICE[0].STATUS_ID).toBe(1);
  });

  test("gebucht: Abschlag ist aufgegangen, Einbehalt aufgelöst, aber nicht doppelt aufgeschlagen", async () => {
    const db = welt({ ar: { SE_AMOUNT: 1785 }, payments: [{ AMOUNT_PAYED_GROSS: 33915 }] });
    await fin.saveDeductions(db, { id: 800, tenantId: T, items: [{ advance_invoice_id: 700 }] });
    await fin.bookFinalInvoice(db, { id: 800, tenantId: T, force: true, releasePpIds: [700] });

    const inv = db._tables.INVOICE[0];
    expect(inv.STATUS_ID).toBe(2);
    expect(inv.TOTAL_AMOUNT_NET).toBe(71500);
    expect(inv.SE_RELEASE_TOTAL ?? 0).toBe(0);
    const ar = db._tables.ADVANCE_INVOICE[0];
    expect(ar.ABSORBED_BY_INVOICE_ID).toBe(800);
    expect(ar.SE_RELEASED_BY_INVOICE_ID).toBe(800);

    // Der Abschlag ist nicht mehr offen — der Einbehalt steht in der Schlussrechnung.
    const o = (await openAmountsFor(db, { kind: "ADVANCE_INVOICE", docs: [ar], tenantId: T })).get("700");
    expect(o.open).toBe(0);
    expect(o.absorbedBy).toBe(800);
  });
});
