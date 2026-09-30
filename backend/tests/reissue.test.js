"use strict";

// Stornieren und neu ausstellen (Migration 0180, services/reissue.js).
//
// Vorher: stornieren, danach die Rechnung im Assistenten von vorn anlegen.
// Die Zahlungen blieben am stornierten Original haengen oder wurden mit dem
// Storno geloescht und mussten neu erfasst werden.

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
// Die EN16931-Pruefung hat eigene Tests; hier geht es um Storno, Entwurf und Zahlungen.
jest.mock("../services_einvoice_validator", () => ({ validateEInvoiceData: () => ({ ok: true, errors: [], warnings: [] }) }));

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { reissue, termDays } = require("../services/reissue");
const invSvc = require("../services/invoices");
const ppSvc = require("../services/partialPayments");
const { openAmountsFor } = require("../services/openAmount");
const { loadInvoiceData } = require("../services_einvoice_data");

const T = 1;
const today = new Date().toISOString().slice(0, 10);
const plusDays = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const beleg = {
  TENANT_ID: T, INVOICE_ADDRESS_ID: 900, COMPANY_ID: 10, EMPLOYEE_ID: 20, CONTRACT_ID: 30, PROJECT_ID: 40,
  VAT_PERCENT: 19, VAT_ID: 1, VAT_CATEGORY: "S", COMPANY_NAME_1: "Architektur GmbH", "COMPANY_TAX-ID": "DE123456789",
  COMPANY_IBAN: "DE02120300000000202051", EMPLOYEE: "S. Messina", EMPLOYEE_PHONE: "+49 89 1", EMPLOYEE_MAIL: "a@b.de",
  ADDRESS_NAME_1: "Bauherr AG", ADDRESS_COUNTRY: "DE", BUYER_REFERENCE: "04011000-1234512345-06",
};

function welt({ invoice = {}, advance = null, extra = {} } = {}) {
  const db = makeFakeSupabase({
    COMPANY: [{ ID: 10, TENANT_ID: T, COMPANY_NAME_1: "Architektur GmbH", STREET: "H 1", POST_CODE: "80331", CITY: "München", COUNTRY_ID: 1,
      IBAN: "DE02120300000000202051", "TAX-ID": "DE123456789" }],
    ADDRESS: [{ ID: 900, TENANT_ID: T, ADDRESS_NAME_1: "Bauherr AG", STREET: "B 9", POST_CODE: "10115", CITY: "Berlin", COUNTRY_ID: 1,
      BUYER_REFERENCE: "04011000-1234512345-06" }],
    CONTACTS: [{ ID: 70, TENANT_ID: T, FIRST_NAME: "K", LAST_NAME: "Ludwig" }],
    EMPLOYEE: [{ ID: 20, TENANT_ID: T, FIRST_NAME: "S", LAST_NAME: "M", ABBR: "SM", MAIL: "sm@example.de", MOBILE: "+49 89 1234567" }],
    COUNTRY: [{ ID: 1, ABBR: "DE", NAME: "Deutschland" }],
    PROJECT: [{ ID: 40, TENANT_ID: T, ABBR: "P-1", NAME: "Kita", COMPANY_ID: 10, INVOICED: 10000, ADVANCE_INVOICED: 5000, PAYED: 5950 }],
    CONTRACT: [{ ID: 30, TENANT_ID: T, PROJECT_ID: 40, VAT_ID: 1, INVOICE_ADDRESS_ID: 900, INVOICE_CONTACT_ID: 70, VAT_CATEGORY: "S" }],
    VAT: [{ ID: 1, VAT_PERCENT: 19 }], TENANT_SETTINGS: [], RECEIVABLE_ADJUSTMENT: [], PROJECT_PROGRESS: [],
    INVOICE: [{ ...beleg, ID: 600, STATUS_ID: 2, INVOICE_NUMBER: "R-2026-0100", INVOICE_DATE: "2026-09-01", DUE_DATE: "2026-09-30",
      INVOICE_TYPE: "rechnung", TOTAL_AMOUNT_NET: 10000, TAX_AMOUNT_NET: 1900, TOTAL_AMOUNT_GROSS: 11900,
      CANCELS_INVOICE_ID: null, REPLACES_INVOICE_ID: null, DOCUMENT_PDF_ASSET_ID: 55, DOCUMENT_RENDERED_AT: "2026-09-01T10:00:00Z",
      document_pdf_asset_id: 55, ...invoice }],
    INVOICE_STRUCTURE: [
      { ID: 1, TENANT_ID: T, INVOICE_ID: 600, STRUCTURE_ID: 500, AMOUNT_NET: 6000, AMOUNT_EXTRAS_NET: 0 },
      { ID: 2, TENANT_ID: T, INVOICE_ID: 600, STRUCTURE_ID: 501, AMOUNT_NET: 3600, AMOUNT_EXTRAS_NET: 400 },
    ],
    PROJECT_STRUCTURE: [
      { ID: 500, TENANT_ID: T, ABBR: "LPH 5", NAME: "Ausführungsplanung", BILLING_TYPE_ID: 1, INVOICED: 6000, ADVANCE_INVOICED: 5000 },
      { ID: 501, TENANT_ID: T, ABBR: "LPH 6", NAME: "Vergabe", BILLING_TYPE_ID: 1, INVOICED: 4000, ADVANCE_INVOICED: 0 },
    ],
    BOOKING: [{ ID: 3000, TENANT_ID: T, INVOICE_ID: 600, ADVANCE_INVOICE_ID: null }],
    PAYMENT: [{ ID: 4000, TENANT_ID: T, INVOICE_ID: 600, ADVANCE_INVOICE_ID: null, PROJECT_ID: 40,
      AMOUNT_PAYED_GROSS: 5950, AMOUNT_PAYED_NET: 5000, PAYMENT_DATE: "2026-09-10" }],
    PAYMENT_STRUCTURE: [
      { ID: 4100, TENANT_ID: T, PAYMENT_ID: 4000, INVOICE_ID: 600, ADVANCE_INVOICE_ID: null, STRUCTURE_ID: 500, AMOUNT_PAYED_NET: 3000 },
      { ID: 4101, TENANT_ID: T, PAYMENT_ID: 4000, INVOICE_ID: 600, ADVANCE_INVOICE_ID: null, STRUCTURE_ID: 501, AMOUNT_PAYED_NET: 2000 },
    ],
    INVOICE_DEDUCTION: [],
    ADVANCE_INVOICE: advance ? [advance] : [],
    ADVANCE_INVOICE_STRUCTURE: advance
      ? [{ ID: 7, TENANT_ID: T, ADVANCE_INVOICE_ID: advance.ID, STRUCTURE_ID: 500, AMOUNT_NET: 5000, AMOUNT_EXTRAS_NET: 0 }]
      : [],
    ...extra,
  });
  let n = 200;
  db.rpc = async () => ({ data: `R-2026-0${n++}`, error: null });
  return db;
}

const rows = (db, t) => db._tables[t];
const inv = (db, id) => rows(db, "INVOICE").find((r) => r.ID === id);

describe("Stornieren und neu ausstellen — Rechnung", () => {
  test("storniert, legt den Entwurf an und laesst die Zahlungen bis zum Buchen am Original", async () => {
    const db = welt();
    const r = await reissue(db, { kind: "INVOICE", id: 600, tenantId: T });

    expect(r).toMatchObject({ kind: "INVOICE", invoice_type: "rechnung", payments_pending: 1 });
    expect(inv(db, 600).STATUS_ID).toBe(3);                                   // Original storniert
    const storno = inv(db, r.storno_id);
    expect(storno).toMatchObject({ INVOICE_TYPE: "stornorechnung", CANCELS_INVOICE_ID: 600, REPLACES_INVOICE_ID: null, TOTAL_AMOUNT_NET: -10000 });

    const draft = inv(db, r.draft_id);
    expect(draft).toMatchObject({
      STATUS_ID: 1, INVOICE_NUMBER: null, INVOICE_TYPE: "rechnung", REPLACES_INVOICE_ID: 600, CANCELS_INVOICE_ID: null,
      INVOICE_DATE: today, DUE_DATE: plusDays(29), TOTAL_AMOUNT_NET: 10000, ADDRESS_NAME_1: "Bauherr AG",
    });
    expect(draft.DOCUMENT_PDF_ASSET_ID).toBeUndefined();
    expect(draft.document_pdf_asset_id).toBeUndefined();
    expect(rows(db, "INVOICE_STRUCTURE").filter((s) => s.INVOICE_ID === r.draft_id)
      .map((s) => [s.STRUCTURE_ID, s.AMOUNT_NET, s.AMOUNT_EXTRAS_NET])).toEqual([[500, 6000, 0], [501, 3600, 400]]);
    expect(rows(db, "BOOKING")[0].INVOICE_ID).toBe(r.draft_id);             // Leistungen gehen mit
    expect(rows(db, "PAYMENT")[0].INVOICE_ID).toBe(600);                     // Zahlung noch am Original
  });

  test("beim Buchen wandern Zahlung und Aufteilung auf die neue Rechnung", async () => {
    const db = welt();
    const { draft_id } = await reissue(db, { kind: "INVOICE", id: 600, tenantId: T });
    const res = await invSvc.bookInvoice(db, { id: draft_id, inv: { ...inv(db, draft_id) }, tenantId: T });

    expect(res.payments_transferred).toBe(1);
    expect(inv(db, draft_id).STATUS_ID).toBe(2);
    expect(rows(db, "PAYMENT")[0].INVOICE_ID).toBe(draft_id);
    expect(rows(db, "PAYMENT_STRUCTURE").map((p) => p.INVOICE_ID)).toEqual([draft_id, draft_id]);
    expect(rows(db, "PROJECT")[0].PAYED).toBe(5950);                         // Zahlung bleibt Zahlung

    const open = await openAmountsFor(db, { kind: "INVOICE", docs: [inv(db, draft_id)], tenantId: T });
    expect(open.get(String(draft_id))).toMatchObject({ paid: 5950, open: 5950 });
  });

  test("Beleg und XML nennen die ersetzte Rechnung (BT-25)", async () => {
    const db = welt();
    const { draft_id } = await reissue(db, { kind: "INVOICE", id: 600, tenantId: T });
    const data = await loadInvoiceData(db, draft_id, "INVOICE", T);
    expect(data).toMatchObject({ canceledDocNumber: "R-2026-0100", canceledDocDate: "2026-09-01", replacesLabel: "Rechnung" });
  });

  test("Entwurf verworfen: die Zahlung bleibt am stornierten Original", async () => {
    const db = welt();
    const { draft_id } = await reissue(db, { kind: "INVOICE", id: 600, tenantId: T });
    await invSvc.deleteInvoice(db, { id: draft_id, tenantId: T });
    expect(inv(db, draft_id)).toBeUndefined();
    expect(rows(db, "PAYMENT")[0].INVOICE_ID).toBe(600);
    expect(rows(db, "BOOKING")[0].INVOICE_ID).toBeNull();                   // wie nach einem Storno
  });

  test("der Storno einer neu ausgestellten Rechnung holt sich keine Zahlungen", async () => {
    const db = welt();
    const { draft_id } = await reissue(db, { kind: "INVOICE", id: 600, tenantId: T });
    await invSvc.bookInvoice(db, { id: draft_id, inv: { ...inv(db, draft_id) }, tenantId: T });
    const { id: stornoId } = await invSvc.cancelInvoice(db, { id: draft_id, tenantId: T });
    expect(inv(db, stornoId).REPLACES_INVOICE_ID).toBeNull();
    expect(rows(db, "PAYMENT")[0].INVOICE_ID).toBe(draft_id);
  });

  test("Schlussrechnung: Auswahl der Abzuege und der SE-Freigabe geht mit", async () => {
    const db = welt({
      invoice: { INVOICE_TYPE: "schlussrechnung", SE_RELEASE_ADVANCE_IDS: [701], SE_RELEASE_TOTAL: 500 },
      extra: { INVOICE_DEDUCTION: [{ ID: 1, TENANT_ID: T, INVOICE_ID: 600, ADVANCE_INVOICE_ID: 701, DEDUCTION_AMOUNT_NET: 5000 }] },
    });
    const { draft_id, invoice_type } = await reissue(db, { kind: "INVOICE", id: 600, tenantId: T });
    expect(invoice_type).toBe("schlussrechnung");
    expect(inv(db, draft_id)).toMatchObject({ SE_RELEASE_ADVANCE_IDS: [701], SE_RELEASE_TOTAL: null, REPLACES_INVOICE_ID: 600 });
    expect(rows(db, "INVOICE_DEDUCTION").filter((d) => d.INVOICE_ID === draft_id))
      .toEqual([expect.objectContaining({ ADVANCE_INVOICE_ID: 701, DEDUCTION_AMOUNT_NET: 5000, TENANT_ID: T })]);
  });

  test("Zahlungsziel bleibt: Faelligkeit − Rechnungsdatum", () => {
    expect(termDays({ INVOICE_DATE: "2026-09-01", DUE_DATE: "2026-09-15" }, "INVOICE_DATE")).toBe(14);
    expect(termDays({ INVOICE_DATE: "2026-09-01", DUE_DATE: null }, "INVOICE_DATE")).toBeNull();
  });
});

describe("Stornieren und neu ausstellen — was nicht geht", () => {
  const unveraendert = (db) => {
    expect(inv(db, 600).STATUS_ID).toBe(2);
    expect(rows(db, "INVOICE")).toHaveLength(1);
  };

  test("ohne Anlege-Recht der Belegart: 403, nichts storniert", async () => {
    const db = welt();
    const can = (k) => k !== "invoices.create_single";
    await expect(reissue(db, { kind: "INVOICE", id: 600, tenantId: T, can })).rejects.toMatchObject({ status: 403 });
    unveraendert(db);
  });

  test("Datenbank ohne Migration 0180: 503, nichts storniert", async () => {
    const db = welt();
    delete rows(db, "INVOICE")[0].REPLACES_INVOICE_ID;
    await expect(reissue(db, { kind: "INVOICE", id: 600, tenantId: T })).rejects.toMatchObject({ status: 503 });
    unveraendert(db);
  });

  test("Entwurf, Storno und Rechnungskorrektur lassen sich nicht neu ausstellen", async () => {
    for (const invoice of [{ STATUS_ID: 1 }, { INVOICE_TYPE: "stornorechnung" }, { INVOICE_TYPE: "gutschrift" }]) {
      const db = welt({ invoice });
      await expect(reissue(db, { kind: "INVOICE", id: 600, tenantId: T })).rejects.toMatchObject({ status: 400 });
      expect(rows(db, "INVOICE")).toHaveLength(1);
    }
  });

  test("fremder Mandant: 404", async () => {
    const db = welt();
    await expect(reissue(db, { kind: "INVOICE", id: 600, tenantId: 2 })).rejects.toMatchObject({ status: 404 });
  });
});

describe("Stornieren und neu ausstellen — Abschlagsrechnung", () => {
  const ar = (extra = {}) => ({
    ...beleg, ADVANCE_INVOICE_ADDRESS_ID: 900, ID: 700, STATUS_ID: 2, ADVANCE_INVOICE_NUMBER: "AR-7",
    ADVANCE_INVOICE_DATE: "2026-08-01", DUE_DATE: "2026-08-15", AMOUNT_NET: 5000, AMOUNT_EXTRAS_NET: 0,
    TOTAL_AMOUNT_NET: 5000, TAX_AMOUNT_NET: 950, TOTAL_AMOUNT_GROSS: 5950,
    CANCELS_ADVANCE_INVOICE_ID: null, REPLACES_ADVANCE_INVOICE_ID: null, ABSORBED_BY_INVOICE_ID: null, INVOICE_ID: null,
    SE_RELEASED_BY_INVOICE_ID: null, ...extra,
  });
  const mitArZahlung = (db) => {
    rows(db, "PAYMENT")[0].INVOICE_ID = null;
    rows(db, "PAYMENT")[0].ADVANCE_INVOICE_ID = 700;
    for (const p of rows(db, "PAYMENT_STRUCTURE")) { p.INVOICE_ID = null; p.ADVANCE_INVOICE_ID = 700; }
  };

  test("Entwurf mit Bezug, Zahlung geht beim Buchen mit", async () => {
    const db = welt({ advance: ar() });
    mitArZahlung(db);
    const r = await reissue(db, { kind: "ADVANCE_INVOICE", id: 700, tenantId: T, can: (k) => k === "invoices.create_partial" });
    expect(r).toMatchObject({ kind: "ADVANCE_INVOICE", invoice_type: null, payments_pending: 1 });

    const draft = rows(db, "ADVANCE_INVOICE").find((a) => a.ID === r.draft_id);
    expect(draft).toMatchObject({ STATUS_ID: 1, ADVANCE_INVOICE_NUMBER: null, REPLACES_ADVANCE_INVOICE_ID: 700,
      ADVANCE_INVOICE_DATE: today, DUE_DATE: plusDays(14) });
    expect(rows(db, "ADVANCE_INVOICE").find((a) => a.ID === 700).STATUS_ID).toBe(3);

    const res = await ppSvc.bookPartialPayment(db, { id: r.draft_id, pp: { ...draft }, tenantId: T });
    expect(res.payments_transferred).toBe(1);
    expect(rows(db, "PAYMENT")[0].ADVANCE_INVOICE_ID).toBe(r.draft_id);
    expect(rows(db, "PAYMENT_STRUCTURE").map((p) => p.ADVANCE_INVOICE_ID)).toEqual([r.draft_id, r.draft_id]);
  });

  test("in einer Schlussrechnung aufgegangen: 409, erst die Schlussrechnung stornieren", async () => {
    const db = welt({ advance: ar({ ABSORBED_BY_INVOICE_ID: 600 }) });
    await expect(reissue(db, { kind: "ADVANCE_INVOICE", id: 700, tenantId: T })).rejects.toMatchObject({ status: 409 });
    expect(rows(db, "ADVANCE_INVOICE")).toHaveLength(1);
  });
});
