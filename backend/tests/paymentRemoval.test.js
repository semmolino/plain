"use strict";

// Zahlungen loeschen — „Zahlung loeschen" und „Stornieren + Zahlungen loeschen"
// laufen durch eine Routine (services/paymentRemoval.js,
// docs/RECHNUNGSKUERZUNGEN_ANALYSE.md, Nebenbefund 3).
//
// Vorher rechnete der Storno PROJECT_STRUCTURE.PAYED nur fuer Elemente neu,
// die NOCH Zahlungen hatten: war die geloeschte die einzige, blieb der alte
// Wert stehen. Die Vaeter wurden gar nicht nachgezogen.

jest.mock("../services_pdf_render", () => ({
  renderDocumentPdf: async () => ({ pdf: Buffer.from("pdf"), template: { ID: 1, LAYOUT_KEY: "modern_a" }, theme: {} }),
}));
jest.mock("../services_einvoice_ubl", () => ({ generateUblInvoiceXml: async () => "<Invoice/>" }));
jest.mock("../services/generatedAssets", () => ({
  storeGeneratedPdfAsAsset: async () => ({ ID: 91 }),
  storeGeneratedXmlAsAsset: async () => ({ ID: 92 }),
  bestEffortDeleteAsset: async () => {},
}));
jest.mock("../services/einvoiceSnapshot", () => ({ freezeCiiSnapshot: async () => {} }));
jest.mock("../services_einvoice_validator", () => ({ validateEInvoiceData: () => ({ ok: true, errors: [], warnings: [] }) }));
// Die Vorpruefung des Stornos braucht sonst einen vollstaendigen Beleg — hier geht es nur um die Zahlungen.
jest.mock("../services_einvoice_data", () => ({ loadInvoiceData: async () => ({}) }));

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { removePaymentsOfDoc, removePayments } = require("../services/paymentRemoval");
const invSvc = require("../services/invoices");

const T = 1;

// LPH 5 und LPH 6 unter „Leistungsphasen"; Zahlung A (R-100) auf beide, Zahlung B (R-200) nur auf LPH 6.
function welt() {
  return makeFakeSupabase({
    PROJECT: [{ ID: 40, TENANT_ID: T, PAYED: 6000, INVOICED: 10000 }],
    PROJECT_STRUCTURE: [
      { ID: 100, TENANT_ID: T, FATHER_ID: null, PAYED: 6000, INVOICED: 10000 },
      { ID: 500, TENANT_ID: T, FATHER_ID: 100, PAYED: 3000, INVOICED: 6000 },
      { ID: 501, TENANT_ID: T, FATHER_ID: 100, PAYED: 3000, INVOICED: 4000 },
    ],
    INVOICE: [{ ID: 600, TENANT_ID: T, STATUS_ID: 2, INVOICE_NUMBER: "R-100", INVOICE_TYPE: "rechnung", PROJECT_ID: 40, COMPANY_ID: 10,
      TOTAL_AMOUNT_NET: 5000, TAX_AMOUNT_NET: 950, TOTAL_AMOUNT_GROSS: 5950, VAT_PERCENT: 19, VAT_CATEGORY: "S" }],
    INVOICE_STRUCTURE: [{ ID: 1, TENANT_ID: T, INVOICE_ID: 600, STRUCTURE_ID: 500, AMOUNT_NET: 5000, AMOUNT_EXTRAS_NET: 0 }],
    PAYMENT: [
      { ID: 4000, TENANT_ID: T, INVOICE_ID: 600, PROJECT_ID: 40, AMOUNT_PAYED_NET: 5000, AMOUNT_PAYED_GROSS: 5950 },
      { ID: 4001, TENANT_ID: T, INVOICE_ID: 601, PROJECT_ID: 40, AMOUNT_PAYED_NET: 1000, AMOUNT_PAYED_GROSS: 1190 },
    ],
    PAYMENT_STRUCTURE: [
      { ID: 1, TENANT_ID: T, PAYMENT_ID: 4000, INVOICE_ID: 600, STRUCTURE_ID: 500, AMOUNT_PAYED_NET: 3000 },
      { ID: 2, TENANT_ID: T, PAYMENT_ID: 4000, INVOICE_ID: 600, STRUCTURE_ID: 501, AMOUNT_PAYED_NET: 2000 },
      { ID: 3, TENANT_ID: T, PAYMENT_ID: 4001, INVOICE_ID: 601, STRUCTURE_ID: 501, AMOUNT_PAYED_NET: 1000 },
    ],
    PROJECT_PROGRESS: [], BOOKING: [], RECEIVABLE_ADJUSTMENT: [], INVOICE_DEDUCTION: [], ADVANCE_INVOICE: [],
  });
}
const ps = (db, id) => db._tables.PROJECT_STRUCTURE.find((r) => r.ID === id);

describe("Zahlungen eines Belegs löschen", () => {
  test("Element ohne verbleibende Zahlung geht auf 0, Vater und Projekt ziehen nach", async () => {
    const db = welt();
    expect(await removePaymentsOfDoc(db, { kind: "INVOICE", id: 600, tenantId: T })).toEqual({ removed: 1 });

    expect(db._tables.PAYMENT.map((p) => p.ID)).toEqual([4001]);
    expect(db._tables.PAYMENT_STRUCTURE.map((p) => p.ID)).toEqual([3]);
    expect(ps(db, 500).PAYED).toBe(0);      // vorher blieb hier 3.000 stehen
    expect(ps(db, 501).PAYED).toBe(1000);
    expect(ps(db, 100).PAYED).toBe(1000);   // vorher gar nicht nachgezogen
    expect(db._tables.PROJECT[0].PAYED).toBe(1000);
    expect(db._tables.PROJECT_PROGRESS.map((r) => [r.STRUCTURE_ID, r.PAYED])).toEqual(expect.arrayContaining([[500, -3000], [501, -2000]]));
  });

  test("fremde Zahlungen werden nicht berührt", async () => {
    const db = welt();
    expect(await removePayments(db, { tenantId: 2, paymentIds: [4000] })).toEqual({ removed: 0 });
    expect(db._tables.PAYMENT).toHaveLength(2);
  });

  test("Storno mit „Zahlungen löschen“ nimmt denselben Weg", async () => {
    const db = welt();
    await invSvc.cancelInvoice(db, { id: 600, tenantId: T, deletePayments: true });
    expect(db._tables.PAYMENT.map((p) => p.ID)).toEqual([4001]);
    expect(ps(db, 500).PAYED).toBe(0);
    expect(ps(db, 100).PAYED).toBe(1000);
    expect(db._tables.PROJECT[0].PAYED).toBe(1000);
  });
});
