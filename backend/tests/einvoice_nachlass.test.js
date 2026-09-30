"use strict";

// Nachlass I/II im XML (docs/RECHNUNGSKUERZUNGEN_ANALYSE.md, Nebenbefund 6;
// services/documentDiscounts.js).
//
// Vorher las das XML die Nachlaesse aus den Betragsspalten DISCOUNT_1/2, die
// kein Code schreibt — gespeichert sind nur Prozente und TOTAL_DISCOUNTS. Das
// XML nannte deshalb keinen Nachlass und forderte den Betrag davor, das PDF
// den danach. Und im Storno-PDF stand „Netto −10.000, Nachlass 1.000".

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { loadInvoiceData } = require("../services_einvoice_data");
const { validateEInvoiceData } = require("../services_einvoice_validator");
const { generateCiiXml } = require("../services_einvoice_cii");
const { generateUblXml } = require("../services_einvoice_ubl");
const { claimOf } = require("../services/openAmount");
const { discountsOf } = require("../services/documentDiscounts");

const T = 1;
const beleg = {
  TENANT_ID: T, INVOICE_ADDRESS_ID: 900, COMPANY_ID: 10, EMPLOYEE_ID: 20, CONTRACT_ID: 30, PROJECT_ID: 40,
  VAT_PERCENT: 19, VAT_ID: 1, VAT_CATEGORY: "S", COMPANY_NAME_1: "Architektur GmbH", "COMPANY_TAX-ID": "DE123456789",
  COMPANY_IBAN: "DE02120300000000202051", EMPLOYEE: "S. Messina", EMPLOYEE_PHONE: "+49 89 1", EMPLOYEE_MAIL: "a@b.de",
  ADDRESS_NAME_1: "Bauherr AG", ADDRESS_COUNTRY: "DE", BUYER_REFERENCE: "04011000-1234512345-06",
  INVOICE_TYPE: "rechnung", INVOICE_DATE: "2026-09-01", STATUS_ID: 2,
  // 10 % und 5 % — gespeichert wie vom Assistenten: Prozente plus Summe, Beträge VOR Nachlass
  DISCOUNT_1_PERCENT: 10, DISCOUNT_1_REASON: "Rahmenvertrag", DISCOUNT_2_PERCENT: 5, DISCOUNT_2_REASON: null,
  TOTAL_DISCOUNTS: 1450,
};

function welt(invoice) {
  return makeFakeSupabase({
    COMPANY: [{ ID: 10, TENANT_ID: T, COMPANY_NAME_1: "Architektur GmbH", STREET: "H 1", POST_CODE: "80331", CITY: "München", COUNTRY_ID: 1,
      IBAN: "DE02120300000000202051", "TAX-ID": "DE123456789" }],
    ADDRESS: [{ ID: 900, TENANT_ID: T, ADDRESS_NAME_1: "Bauherr AG", STREET: "B 9", POST_CODE: "10115", CITY: "Berlin", COUNTRY_ID: 1,
      BUYER_REFERENCE: "04011000-1234512345-06" }],
    CONTACTS: [{ ID: 70, TENANT_ID: T, FIRST_NAME: "K", LAST_NAME: "Ludwig" }],
    EMPLOYEE: [{ ID: 20, TENANT_ID: T, FIRST_NAME: "S", LAST_NAME: "M", ABBR: "SM", MAIL: "sm@example.de", MOBILE: "+49 89 1234567" }],
    COUNTRY: [{ ID: 1, ABBR: "DE", NAME: "Deutschland" }],
    PROJECT: [{ ID: 40, TENANT_ID: T, ABBR: "P-1", NAME: "Kita", COMPANY_ID: 10 }],
    CONTRACT: [{ ID: 30, TENANT_ID: T, PROJECT_ID: 40, VAT_ID: 1, INVOICE_ADDRESS_ID: 900, INVOICE_CONTACT_ID: 70, VAT_CATEGORY: "S" }],
    VAT: [{ ID: 1, VAT_PERCENT: 19 }], TENANT_SETTINGS: [], BOOKING: [], PAYMENT: [], RECEIVABLE_ADJUSTMENT: [],
    INVOICE: [{ ...beleg, ID: 600, ...invoice }],
    INVOICE_STRUCTURE: [
      { ID: 1, TENANT_ID: T, INVOICE_ID: 600, STRUCTURE_ID: 500, AMOUNT_NET: 6000 * Math.sign(invoice.TOTAL_AMOUNT_NET), AMOUNT_EXTRAS_NET: 0 },
      { ID: 2, TENANT_ID: T, INVOICE_ID: 600, STRUCTURE_ID: 501, AMOUNT_NET: 3600 * Math.sign(invoice.TOTAL_AMOUNT_NET), AMOUNT_EXTRAS_NET: 400 * Math.sign(invoice.TOTAL_AMOUNT_NET) },
    ],
    PROJECT_STRUCTURE: [
      { ID: 500, TENANT_ID: T, ABBR: "LPH 5", NAME: "Ausführungsplanung", BILLING_TYPE_ID: 1 },
      { ID: 501, TENANT_ID: T, ABBR: "LPH 6", NAME: "Vergabe", BILLING_TYPE_ID: 1 },
    ],
    INVOICE_DEDUCTION: [], ADVANCE_INVOICE: [], ADVANCE_INVOICE_STRUCTURE: [],
  });
}

const RECHNUNG = { INVOICE_NUMBER: "R-2026-0100", TOTAL_AMOUNT_NET: 10000, TAX_AMOUNT_NET: 1900, TOTAL_AMOUNT_GROSS: 11900 };

describe("Nachlass I/II — eine Rechnung", () => {
  test("Nachlass II auf den Rest nach Nachlass I, Summe wie gespeichert", () => {
    const d = discountsOf({ ...beleg, ...RECHNUNG });
    expect(d).toMatchObject({ d1: 1000, d2: 450, total: 1450, adjustedNet: 8550 });
    expect(d.steps).toEqual([
      { percent: 10, amount: 1000, baseAmount: 10000, reason: "Rahmenvertrag" },
      { percent: 5, amount: 450, baseAmount: 9000, reason: "Nachlass" },
    ]);
  });

  test("Storno: Beträge mit dem Vorzeichen des Belegs, auch wenn TOTAL_DISCOUNTS positiv geerbt ist", () => {
    const d = discountsOf({ ...beleg, TOTAL_AMOUNT_NET: -10000 });
    expect(d).toMatchObject({ d1: -1000, d2: -450, total: -1450, adjustedNet: -8550 });
  });

  test("Rundungsrest der gespeicherten Summe geht in die letzte Stufe", () => {
    const d = discountsOf({ TOTAL_AMOUNT_NET: 999.99, DISCOUNT_1_PERCENT: 3.33, DISCOUNT_2_PERCENT: 1.11, TOTAL_DISCOUNTS: 43.99 });
    expect(d.d1 + d.d2).toBeCloseTo(43.99, 2);
    expect(d.adjustedNet).toBe(956);
  });

  test("offener Betrag rechnet mit demselben Nachlass", () => {
    expect(claimOf({ ...beleg, ...RECHNUNG }, "INVOICE")).toMatchObject({ discounts: 1450, gross: 10174.5 });
    expect(claimOf({ ...beleg, TOTAL_AMOUNT_NET: -10000, TOTAL_AMOUNT_GROSS: -11900 }, "INVOICE")).toMatchObject({ gross: -10174.5 });
  });
});

describe("E-Rechnung mit Nachlass", () => {
  test("Nachlässe als BG-20, Steuer auf das Netto danach — wie das PDF", async () => {
    const data = await loadInvoiceData(welt(RECHNUNG), 600, "INVOICE", T);
    expect(data.allowances).toEqual([
      expect.objectContaining({ reason: "Rahmenvertrag", percent: 10, amount: 1000, baseAmount: 10000 }),
      expect.objectContaining({ reason: "Nachlass", percent: 5, amount: 450, baseAmount: 9000 }),
    ]);
    // Vorher: allowanceTotal 0, taxBasis 10.000, grandTotal 11.900 — das PDF forderte 10.174,50.
    expect(data.totals).toMatchObject({ lineTotal: 10000, allowanceTotal: 1450, taxBasis: 8550, taxAmount: 1624.5, grandTotal: 10174.5, duePayable: 10174.5 });
    expect(data.vatBreakdown[0]).toMatchObject({ basis: 8550, amount: 1624.5 });
    expect(validateEInvoiceData(data).errors).toEqual([]);

    const cii = generateCiiXml(data, "EN16931");
    expect(cii).toMatch(/<ram:CalculationPercent>5\.00<\/ram:CalculationPercent>\s*<ram:BasisAmount>9000\.00<\/ram:BasisAmount>\s*<ram:ActualAmount>450\.00<\/ram:ActualAmount>/);
    expect(cii).toMatch(/<ram:AllowanceTotalAmount>1450\.00<\/ram:AllowanceTotalAmount>/);
    const ubl = generateUblXml(data);
    expect(ubl).toMatch(/<cbc:Amount currencyID="EUR">1000\.00<\/cbc:Amount>\s*<cbc:BaseAmount currencyID="EUR">10000\.00<\/cbc:BaseAmount>/);
    expect(ubl).toMatch(/<cbc:PayableAmount currencyID="EUR">10174\.50<\/cbc:PayableAmount>/);
  });

  test("Storno mit Nachlass: alles negativ, BR-CO-13 hält", async () => {
    const data = await loadInvoiceData(welt({ INVOICE_NUMBER: "S-R-2026-0100", INVOICE_TYPE: "stornorechnung", CANCELS_INVOICE_ID: 599,
      TOTAL_AMOUNT_NET: -10000, TAX_AMOUNT_NET: -1900, TOTAL_AMOUNT_GROSS: -11900 }), 600, "INVOICE", T);
    expect(data.allowances.map((a) => a.amount)).toEqual([-1000, -450]);
    expect(data.totals).toMatchObject({ lineTotal: -10000, allowanceTotal: -1450, taxBasis: -8550, taxAmount: -1624.5, grandTotal: -10174.5 });
    expect(validateEInvoiceData(data).errors).toEqual([]);
  });

  test("ohne Nachlass bleibt es bei den gespeicherten Summen", async () => {
    const data = await loadInvoiceData(welt({ ...RECHNUNG, DISCOUNT_1_PERCENT: 0, DISCOUNT_2_PERCENT: 0, TOTAL_DISCOUNTS: 0 }), 600, "INVOICE", T);
    expect(data.allowances).toEqual([]);
    expect(data.totals).toMatchObject({ taxBasis: 10000, taxAmount: 1900, grandTotal: 11900 });
  });
});
