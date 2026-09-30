"use strict";

// Rechnungskorrektur statt „Gutschrift" (Migration 0179, services/invoiceCorrection.js)
// und die Vorzeichen im XML fuer Storno und Korrektur.
//
// Vorher: die „Gutschrift" war eine Einzelrechnung mit anderem Typcode — ohne
// Bezug, mit POSITIVEN Betraegen, als Forderung im Mahnwesen. Und das
// Storno-XML trug positive Summen: es forderte den stornierten Betrag ein
// zweites Mal ein, mit negativem Einzelpreis (BR-27).

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const correction = require("../services/invoiceCorrection");
const { openAmountsFor, withClaimCols } = require("../services/openAmount");
const { loadInvoiceData } = require("../services_einvoice_data");
const { validateEInvoiceData } = require("../services_einvoice_validator");
const codelists = require("../einvoice/codelists");

const T = 1;
const beleg = {
  TENANT_ID: T, INVOICE_ADDRESS_ID: 900, COMPANY_ID: 10, EMPLOYEE_ID: 20, CONTRACT_ID: 30, PROJECT_ID: 40,
  VAT_PERCENT: 19, VAT_CATEGORY: "S", COMPANY_NAME_1: "Architektur GmbH", "COMPANY_TAX-ID": "DE123456789",
  COMPANY_IBAN: "DE02120300000000202051", EMPLOYEE: "S. Messina", EMPLOYEE_PHONE: "+49 89 1", EMPLOYEE_MAIL: "a@b.de",
  ADDRESS_NAME_1: "Bauherr AG", ADDRESS_COUNTRY: "DE", BUYER_REFERENCE: "04011000-1234512345-06",
};

function welt(extra = {}) {
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
    INVOICE: [{ ...beleg, ID: 600, STATUS_ID: 2, INVOICE_NUMBER: "R-2026-0100", INVOICE_DATE: "2026-09-01", INVOICE_TYPE: "rechnung",
      TOTAL_AMOUNT_NET: 10000, TAX_AMOUNT_NET: 1900, TOTAL_AMOUNT_GROSS: 11900, VAT_ID: 1 }],
    INVOICE_STRUCTURE: [
      { ID: 1, TENANT_ID: T, INVOICE_ID: 600, STRUCTURE_ID: 500, AMOUNT_NET: 6000, AMOUNT_EXTRAS_NET: 0 },
      { ID: 2, TENANT_ID: T, INVOICE_ID: 600, STRUCTURE_ID: 501, AMOUNT_NET: 3600, AMOUNT_EXTRAS_NET: 400 },
    ],
    PROJECT_STRUCTURE: [
      { ID: 500, TENANT_ID: T, ABBR: "LPH 5", NAME: "Ausführungsplanung", BILLING_TYPE_ID: 1 },
      { ID: 501, TENANT_ID: T, ABBR: "LPH 6", NAME: "Vergabe", BILLING_TYPE_ID: 1 },
    ],
    INVOICE_DEDUCTION: [], ADVANCE_INVOICE: [], ADVANCE_INVOICE_STRUCTURE: [],
    ...extra,
  });
}

const korrektur = (extra = {}) => ({
  invoice_id: 600, invoice_date: "2026-09-20", reason: "Aufmaß LPH 6 berichtigt", employee_id: 20,
  rows: [{ structure_id: 501, amount_net: 1000 }], ...extra,
});

describe("Rechnungskorrektur anlegen", () => {
  test("negativ, mit Bezug und Grund, ohne Fälligkeit", async () => {
    const db = welt();
    const r = await correction.saveCorrection(db, { tenantId: T, body: korrektur() });
    expect(r).toMatchObject({ total_amount_net: -1000, tax_amount_net: -190, total_amount_gross: -1190 });
    const inv = db._tables.INVOICE.find(i => i.ID === r.id);
    expect(inv).toMatchObject({ INVOICE_TYPE: "gutschrift", CORRECTS_INVOICE_ID: 600, CORRECTION_REASON: "Aufmaß LPH 6 berichtigt", DUE_DATE: null, STATUS_ID: 1 });
    // Honorar und Nebenkosten im Verhaeltnis des Originals (3.600 : 400)
    const rows = db._tables.INVOICE_STRUCTURE.filter(s => s.INVOICE_ID === r.id);
    expect(rows).toEqual([expect.objectContaining({ STRUCTURE_ID: 501, AMOUNT_NET: -900, AMOUNT_EXTRAS_NET: -100 })]);
  });

  test("Grund ist Pflicht, und mehr als berechnet geht nicht", async () => {
    await expect(correction.saveCorrection(welt(), { tenantId: T, body: korrektur({ reason: " " }) })).rejects.toMatchObject({ status: 400 });
    await expect(correction.saveCorrection(welt(), { tenantId: T, body: korrektur({ rows: [{ structure_id: 501, amount_net: 4000.01 }] }) }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("4000,00") });
  });

  test("was schon korrigiert ist, zählt beim nächsten Mal ab", async () => {
    const db = welt();
    await correction.saveCorrection(db, { tenantId: T, body: korrektur() });
    const basis = await correction.correctionBasis(db, { tenantId: T, query: { invoice_id: 600 } });
    expect(basis.rows.find(r => r.STRUCTURE_ID === 501)).toMatchObject({ BILLED_NET: 4000, CORRECTED_NET: 1000, MAX_NET: 3000 });
  });

  test("Storno und Korrektur selbst lassen sich nicht korrigieren", async () => {
    const db = welt();
    db._tables.INVOICE[0].INVOICE_TYPE = "stornorechnung";
    await expect(correction.saveCorrection(db, { tenantId: T, body: korrektur() })).rejects.toMatchObject({ status: 400 });
  });
});

describe("offener Betrag mit Korrektur", () => {
  test("gebuchte Korrektur mindert das Original, ist selbst nie offen", async () => {
    const db = welt();
    const r = await correction.saveCorrection(db, { tenantId: T, body: korrektur() });
    db._tables.INVOICE.find(i => i.ID === r.id).STATUS_ID = 2;
    const docs = db._tables.INVOICE;
    const o = await openAmountsFor(db, { kind: "INVOICE", docs, tenantId: T });
    expect(o.get("600")).toMatchObject({ corrected: 1190, open: 10710 });
    expect(o.get(String(r.id))).toMatchObject({ open: 0, isCorrection: true });
  });

  test("ein Entwurf mindert noch nichts", async () => {
    const db = welt();
    await correction.saveCorrection(db, { tenantId: T, body: korrektur() });
    const o = await openAmountsFor(db, { kind: "INVOICE", docs: [db._tables.INVOICE[0]], tenantId: T });
    expect(o.get("600").open).toBe(11900);
  });

  test("CLAIM_COLS enthalten die Belegart", () => {
    expect(withClaimCols("INVOICE", "ID")).toContain("INVOICE_TYPE");
  });
});

describe("E-Rechnung: Korrektur und Storno", () => {
  test("Korrektur: 384, Bezug auf das Original, negative Summen, positiver Einzelpreis", async () => {
    const db = welt();
    const r = await correction.saveCorrection(db, { tenantId: T, body: korrektur() });
    Object.assign(db._tables.INVOICE.find(i => i.ID === r.id), { STATUS_ID: 2, INVOICE_NUMBER: "RK-1" });
    const data = await loadInvoiceData(db, r.id, "INVOICE", T);
    expect(data.typeCodeUbl).toBe("384");
    expect(data.typeCodeCii).toBe("384");
    expect(data.canceledDocNumber).toBe("R-2026-0100");
    expect(data.correctionReason).toBe("Aufmaß LPH 6 berichtigt");
    expect(data.totals).toMatchObject({ taxBasis: -1000, taxAmount: -190, grandTotal: -1190, duePayable: -1190 });
    for (const l of data.lines) { expect(l.unitPrice).toBeGreaterThanOrEqual(0); expect(l.quantity).toBeLessThan(0); }
    expect(validateEInvoiceData(data).errors).toEqual([]);
  });

  test("Storno: negative Summen statt einer zweiten Forderung", async () => {
    const db = welt();
    db._tables.INVOICE[0].STATUS_ID = 3;
    db._tables.INVOICE.push({ ...beleg, ID: 601, STATUS_ID: 2, INVOICE_NUMBER: "S-R-2026-0100", INVOICE_DATE: "2026-09-02",
      INVOICE_TYPE: "stornorechnung", CANCELS_INVOICE_ID: 600, TOTAL_AMOUNT_NET: -10000, TAX_AMOUNT_NET: -1900, TOTAL_AMOUNT_GROSS: -11900 });
    db._tables.INVOICE_STRUCTURE.push(
      { ID: 3, TENANT_ID: T, INVOICE_ID: 601, STRUCTURE_ID: 500, AMOUNT_NET: -6000, AMOUNT_EXTRAS_NET: 0 },
      { ID: 4, TENANT_ID: T, INVOICE_ID: 601, STRUCTURE_ID: 501, AMOUNT_NET: -3600, AMOUNT_EXTRAS_NET: -400 });
    const data = await loadInvoiceData(db, 601, "INVOICE", T);
    // Vorher: grandTotal +11.900 und Einzelpreis −6.000.
    expect(data.totals).toMatchObject({ lineTotal: -10000, grandTotal: -11900, duePayable: -11900 });
    for (const l of data.lines) { expect(l.unitPrice).toBeGreaterThan(0); expect(l.quantity).toBeLessThan(0); }
    expect(validateEInvoiceData(data).errors).toEqual([]);
  });

  test("Storno einer Schlussrechnung nimmt die Abzüge zurück", async () => {
    const db = welt();
    Object.assign(db._tables.INVOICE[0], { INVOICE_TYPE: "schlussrechnung", STATUS_ID: 3, TOTAL_AMOUNT_NET: 7000, TAX_AMOUNT_NET: 1330, TOTAL_AMOUNT_GROSS: 8330 });
    db._tables.INVOICE_DEDUCTION.push({ ID: 1, TENANT_ID: T, INVOICE_ID: 600, ADVANCE_INVOICE_ID: 700, DEDUCTION_AMOUNT_NET: 3000 });
    db._tables.ADVANCE_INVOICE.push({ ID: 700, TENANT_ID: T, ADVANCE_INVOICE_NUMBER: "AR-7" });
    db._tables.INVOICE.push({ ...beleg, ID: 601, STATUS_ID: 2, INVOICE_NUMBER: "S-SR", INVOICE_DATE: "2026-09-02",
      INVOICE_TYPE: "stornorechnung", CANCELS_INVOICE_ID: 600, TOTAL_AMOUNT_NET: -7000, TAX_AMOUNT_NET: -1330, TOTAL_AMOUNT_GROSS: -8330 });
    db._tables.INVOICE_STRUCTURE.push(
      { ID: 3, TENANT_ID: T, INVOICE_ID: 601, STRUCTURE_ID: 500, AMOUNT_NET: -6000, AMOUNT_EXTRAS_NET: 0 },
      { ID: 4, TENANT_ID: T, INVOICE_ID: 601, STRUCTURE_ID: 501, AMOUNT_NET: -3600, AMOUNT_EXTRAS_NET: -400 });
    const data = await loadInvoiceData(db, 601, "INVOICE", T);
    const ruecknahme = data.lines.find(l => /Rücknahme Abzug/.test(l.description));
    expect(ruecknahme).toMatchObject({ quantity: 1, unitPrice: 3000, lineTotal: 3000 });
    expect(data.totals.lineTotal).toBe(-7000);
    expect(validateEInvoiceData(data).errors).toEqual([]);
  });

  test("Belegart: Gutschrift-Typ wird 384 in beiden Syntaxen", () => {
    for (const syntax of ["CII", "UBL"]) {
      expect(codelists.documentTypeCode({ docType: "INVOICE", invoiceType: "gutschrift", syntax })).toBe("384");
    }
  });
});
