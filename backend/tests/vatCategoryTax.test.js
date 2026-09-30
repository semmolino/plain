"use strict";

// Steuer nur bei Regelsatz (docs/RECHNUNGSKUERZUNGEN_ANALYSE.md, Nebenbefund 7).
//
// Vorher rechneten Neuberechnung und Buchen TAX_AMOUNT_NET = Netto × VAT_PERCENT,
// auch bei Reverse-Charge (AE) oder steuerfrei (E). VAT_PERCENT haelt dort den
// Satz des Vertrags (19), die Kategorie entscheidet — Liste, offener Betrag und
// Mahnwesen forderten damit 19 % Steuer, die die Rechnung gar nicht ausweist.

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

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const invSvc = require("../services/invoices");
const ppSvc = require("../services/partialPayments");

const T = 1;

function welt(cat) {
  const db = makeFakeSupabase({
    INVOICE: [{ ID: 600, TENANT_ID: T, STATUS_ID: 1, PROJECT_ID: 40, CONTRACT_ID: 30, COMPANY_ID: 10, INVOICE_TYPE: "rechnung",
      VAT_PERCENT: 19, VAT_ID: 1, VAT_CATEGORY: cat, TOTAL_AMOUNT_NET: 1000 }],
    INVOICE_STRUCTURE: [{ ID: 1, TENANT_ID: T, INVOICE_ID: 600, STRUCTURE_ID: 500, AMOUNT_NET: 900, AMOUNT_EXTRAS_NET: 100 }],
    ADVANCE_INVOICE: [{ ID: 700, TENANT_ID: T, STATUS_ID: 1, PROJECT_ID: 40, CONTRACT_ID: 30, COMPANY_ID: 10,
      VAT_PERCENT: 19, VAT_ID: 1, VAT_CATEGORY: cat }],
    ADVANCE_INVOICE_STRUCTURE: [{ ID: 2, TENANT_ID: T, ADVANCE_INVOICE_ID: 700, STRUCTURE_ID: 500, AMOUNT_NET: 1000, AMOUNT_EXTRAS_NET: 0 }],
    PROJECT: [{ ID: 40, TENANT_ID: T, INVOICED: 0 }],
    PROJECT_STRUCTURE: [{ ID: 500, TENANT_ID: T, INVOICED: 0 }],
    PROJECT_PROGRESS: [], VAT: [{ ID: 1, VAT_PERCENT: 19 }], BOOKING: [], PAYMENT: [], RECEIVABLE_ADJUSTMENT: [],
  });
  db.rpc = async () => ({ data: "R-2026-0300", error: null });
  return db;
}
const inv = (db) => db._tables.INVOICE.find((r) => r.ID === 600);
const ar  = (db) => db._tables.ADVANCE_INVOICE.find((r) => r.ID === 700);

describe("Steuer je Kategorie", () => {
  test.each([["AE"], ["E"], ["K"]])("Kategorie %s: keine Steuer, Satz des Vertrags bleibt stehen", async (cat) => {
    const db = welt(cat);
    await invSvc.recomputeInvoiceTotals(db, 600);
    expect(inv(db)).toMatchObject({ TOTAL_AMOUNT_NET: 1000, TAX_AMOUNT_NET: 0, TOTAL_AMOUNT_GROSS: 1000, VAT_PERCENT: 19 });
    await ppSvc.recomputePartialPaymentTotals(db, 700);
    expect(ar(db)).toMatchObject({ TOTAL_AMOUNT_NET: 1000, TAX_AMOUNT_NET: 0, TOTAL_AMOUNT_GROSS: 1000 });
  });

  test("Regelsatz: wie bisher", async () => {
    const db = welt("S");
    await invSvc.recomputeInvoiceTotals(db, 600);
    expect(inv(db)).toMatchObject({ TAX_AMOUNT_NET: 190, TOTAL_AMOUNT_GROSS: 1190 });
  });

  test("Buchen: Reverse-Charge bleibt ohne Steuer", async () => {
    const db = welt("AE");
    // force: die Vorpruefung braucht einen vollstaendigen Beleg, hier geht es nur um die Steuer
    await invSvc.bookInvoice(db, { id: 600, inv: { ...inv(db) }, tenantId: T, force: true });
    expect(inv(db)).toMatchObject({ STATUS_ID: 2, TAX_AMOUNT_NET: 0, TOTAL_AMOUNT_GROSS: 1000 });
  });
});
