"use strict";

// N10 (Audit 25.08.2026): Der Sicherheitseinbehalt wurde direkt vom Zahlbetrag
// abgezogen (und bei der Aufloesung wieder addiert). Beides verletzt BR-CO-16
// -- BT-115 muss BT-112 minus BT-113 sein -- und zwar in beide Richtungen.
// Solche Rechnungen waren nur mit force=true buchbar.
//
// Entschieden nach der offiziellen XRechnung-FAQ (XStandards Einkauf):
//   "Sicherheitseinbehalte mindern den Forderungsbetrag einer Rechnung nicht
//    und zielen auf eine von der Rechnungsfaelligkeit unabhaengige Auszahlung
//    ab. In XRechnung koennen sie daher nicht als Nachlass auf Dokumenten-
//    (BG-20) oder Positionsebene ausgedrueckt werden."
// Vorgesehen ist ein Hinweis mit Betreffcode PMT (BT-21/BT-22).
//
// Auf der Schlussrechnung zaehlt entsprechend das VEREINNAHMTE, nicht das
// fakturierte -- so verlangt es auch § 14 Abs. 5 UStG fuer die Endrechnung.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { loadInvoiceData } = require("../services_einvoice_data");
const { validateEInvoiceData } = require("../services_einvoice_validator");
const { generateCiiXml } = require("../services_einvoice_cii");
const { generateUblXml } = require("../services_einvoice_ubl");

const TENANT = 1;

// Abschlag: 10.000 netto + 19 % = 11.900 brutto, Einbehalt 5 % vom Brutto = 595.
const AR_NETTO = 10000, AR_USt = 1900, AR_BRUTTO = 11900, SE = 595;
// Schlussrechnung ueber das Gesamthonorar: 14.000 netto -> 16.660 brutto.
const SR_NETTO = 14000, SR_USt = 2660, SR_BRUTTO = 16660;

const stammdaten = {
  COMPANY: [{
    ID: 10, TENANT_ID: TENANT, COMPANY_NAME_1: "Architektur GmbH",
    STREET: "Hauptstr. 1", POST_CODE: "80331", CITY: "München", COUNTRY_ID: 1,
    IBAN: "DE02120300000000202051",
  }],
  ADDRESS: [{
    ID: 900, TENANT_ID: TENANT, ADDRESS_NAME_1: "Bauherr AG",
    STREET: "Bauplatz 9", POST_CODE: "10115", CITY: "Berlin", COUNTRY_ID: 1, VAT_ID: "DE987654321",
  }],
  EMPLOYEE: [{ ID: 20, TENANT_ID: TENANT, FIRST_NAME: "Simon", LAST_NAME: "Messina" }],
  COUNTRY: [{ ID: 1, NAME_SHORT: "DE" }],
  CONTRACT: [{ ID: 30, TENANT_ID: TENANT, SE_LEGAL_REFERENCE: "§ 17 VOB/B" }],
  TEC: [],
};

const belegFelder = {
  TENANT_ID: TENANT, STATUS_ID: 2, INVOICE_ADDRESS_ID: 900,
  COMPANY_ID: 10, EMPLOYEE_ID: 20, CONTRACT_ID: 30, PROJECT_ID: 40,
  VAT_PERCENT: 19, VAT_CATEGORY: "S",
  COMPANY_NAME_1: "Architektur GmbH",
  "COMPANY_TAX-ID": "DE123456789", COMPANY_TAX_NUMBER: "143/815/09321",
  COMPANY_IBAN: "DE02120300000000202051",
  EMPLOYEE: "S. Messina", EMPLOYEE_PHONE: "+49 89 1234567", EMPLOYEE_MAIL: "info@example.de",
  ADDRESS_NAME_1: "Bauherr AG", ADDRESS_COUNTRY: "DE", ADDRESS_VAT_ID: "DE987654321",
  BUYER_REFERENCE: "04011000-1234512345-06",
};

/** Abschlagsrechnung, die einen Einbehalt zurueckhaelt. */
function abschlag({ seAmount = SE } = {}) {
  return makeFakeSupabase(Object.assign({}, stammdaten, {
    PARTIAL_PAYMENT: [Object.assign({}, belegFelder, {
      ID: 700, PARTIAL_PAYMENT_NUMBER: "AR-2026-0007", PARTIAL_PAYMENT_DATE: "2026-06-09",
      PARTIAL_PAYMENT_ADDRESS_ID: 900,
      TOTAL_AMOUNT_NET: AR_NETTO, TAX_AMOUNT_NET: AR_USt, TOTAL_AMOUNT_GROSS: AR_BRUTTO,
      // Die Abschlagsrechnung traegt ihren Betrag hier, nicht in Strukturzeilen.
      AMOUNT_NET: AR_NETTO, AMOUNT_EXTRAS_NET: 0,
      SE_PERCENT: 5, SE_BASIS: "BRUTTO", SE_BASIS_AMT: AR_BRUTTO, SE_AMOUNT: seAmount,
    })],
    PARTIAL_PAYMENT_STRUCTURE: [
      { ID: 1, TENANT_ID: TENANT, PARTIAL_PAYMENT_ID: 700, STRUCTURE_ID: 500, AMOUNT_NET: AR_NETTO, AMOUNT_EXTRAS_NET: 0 },
    ],
    PROJECT_STRUCTURE: [{ ID: 500, TENANT_ID: TENANT, NAME_SHORT: "LPH 1-4", NAME_LONG: "Abschlag", BILLING_TYPE_ID: 1 }],
    INVOICE: [], INVOICE_STRUCTURE: [], INVOICE_DEDUCTION: [],
  }));
}

/** Schlussrechnung, die den Abschlag absetzt. */
function schlussrechnung({ seAmount = SE } = {}) {
  return makeFakeSupabase(Object.assign({}, stammdaten, {
    INVOICE: [Object.assign({}, belegFelder, {
      ID: 800, INVOICE_NUMBER: "SR-2026-0001", INVOICE_DATE: "2026-09-30",
      INVOICE_TYPE: "schlussrechnung",
      TOTAL_AMOUNT_NET: SR_NETTO, TAX_AMOUNT_NET: SR_USt, TOTAL_AMOUNT_GROSS: SR_BRUTTO,
      SE_RELEASE_TOTAL: seAmount,
    })],
    INVOICE_STRUCTURE: [
      { ID: 1, TENANT_ID: TENANT, INVOICE_ID: 800, STRUCTURE_ID: 500, AMOUNT_NET: SR_NETTO, AMOUNT_EXTRAS_NET: 0 },
    ],
    PROJECT_STRUCTURE: [{ ID: 500, TENANT_ID: TENANT, NAME_SHORT: "LPH 1-9", NAME_LONG: "Gesamt", BILLING_TYPE_ID: 1 }],
    INVOICE_DEDUCTION: [
      { ID: 1, TENANT_ID: TENANT, INVOICE_ID: 800, PARTIAL_PAYMENT_ID: 700, DEDUCTION_AMOUNT_NET: AR_NETTO },
    ],
    PARTIAL_PAYMENT: [{
      ID: 700, TENANT_ID: TENANT, PARTIAL_PAYMENT_NUMBER: "AR-2026-0007",
      PARTIAL_PAYMENT_DATE: "2026-06-09",
      TOTAL_AMOUNT_NET: AR_NETTO, TOTAL_AMOUNT_GROSS: AR_BRUTTO,
      SE_AMOUNT: seAmount, SE_RELEASED_BY_INVOICE_ID: 800,
    }],
    PARTIAL_PAYMENT_STRUCTURE: [],
  }));
}

const ladeAbschlag = (db) => loadInvoiceData(db, 700, "PARTIAL_PAYMENT", TENANT);
const ladeSchluss  = (db) => loadInvoiceData(db, 800, "INVOICE", TENANT);

describe("Sicherheitseinbehalt: Abschlagsrechnung (N10)", () => {
  it("mindert den Forderungsbetrag nicht -- BT-115 bleibt der volle Bruttobetrag", async () => {
    const data = await ladeAbschlag(abschlag());
    expect(data.totals.grandTotal).toBe(AR_BRUTTO);
    // Vorher: 11.900 - 595 = 11.305, und damit BR-CO-16 verletzt.
    expect(data.totals.duePayable).toBe(AR_BRUTTO);
  });

  it("ist damit ohne force buchbar", async () => {
    const r = validateEInvoiceData(await ladeAbschlag(abschlag()));
    expect(r.errors.some(e => e.code === "BR-CO-16")).toBe(false);
    // Meldungen mit ausgeben, sonst raet man beim Debuggen.
    expect(r.errors.map(e => `${e.code}/${e.btField}: ${e.message}`)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("laesst die Umsatzsteuer unangetastet", async () => {
    const data = await ladeAbschlag(abschlag());
    // Der Einbehalt ist bereits versteuert -- er darf die Bemessungsgrundlage
    // nicht mindern (das war der Grund gegen BG-20).
    expect(data.totals.taxBasis).toBe(AR_NETTO);
    expect(data.totals.taxAmount).toBe(AR_USt);
  });

  it("fuehrt den Einbehalt als Hinweis mit Betreffcode PMT", async () => {
    const data = await ladeAbschlag(abschlag());
    const cii = generateCiiXml(data, "EN16931");
    const ubl = generateUblXml(data);

    // CII strukturiert, UBL als #PMT#-Praefix -- so bindet EN 16931 BT-21.
    expect(cii).toContain("<ram:SubjectCode>PMT</ram:SubjectCode>");
    expect(ubl).toContain("#PMT#");
    for (const doc of [cii, ubl]) {
      expect(doc).toContain("Sicherheitseinbehalt");
      expect(doc).toContain("595.00");
      expect(doc).toContain("§ 17 VOB/B");
    }
  });

  it("aendert nichts, wenn kein Einbehalt vereinbart ist", async () => {
    const data = await ladeAbschlag(abschlag({ seAmount: 0 }));
    expect(data.totals.duePayable).toBe(AR_BRUTTO);
    expect(validateEInvoiceData(data).ok).toBe(true);
    expect(generateUblXml(data)).not.toContain("#PMT#");
  });
});

describe("Sicherheitseinbehalt: Schlussrechnung (N10)", () => {
  it("setzt das Vereinnahmte ab, nicht das Fakturierte", async () => {
    const data = await ladeSchluss(schlussrechnung());
    // Fakturiert war die Abschlagsrechnung ueber 11.900; geflossen sind
    // 11.305. § 14 Abs. 5 UStG verlangt die vereinnahmten Teilentgelte.
    expect(data.deductions[0].grossAmount).toBe(AR_BRUTTO);
    expect(data.deductions[0].retainedAmount).toBe(SE);
    expect(data.deductions[0].paidAmount).toBe(AR_BRUTTO - SE);
    expect(data.totals.prepaidGross).toBe(AR_BRUTTO - SE);
  });

  it("kommt auf denselben Zahlbetrag wie die frueher Rechnung", async () => {
    const data = await ladeSchluss(schlussrechnung());
    // Frueher: 16.660 - 11.900 (fakturiert) + 595 (Aufloesung) = 5.355
    // Jetzt:   16.660 - 11.305 (vereinnahmt)                    = 5.355
    expect(data.totals.duePayable).toBe(5355);
  });

  it("ist ohne force buchbar", async () => {
    const r = validateEInvoiceData(await ladeSchluss(schlussrechnung()));
    expect(r.errors.some(e => e.code === "BR-CO-16")).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("verhaelt sich ohne Einbehalt wie zuvor", async () => {
    const data = await ladeSchluss(schlussrechnung({ seAmount: 0 }));
    expect(data.totals.prepaidGross).toBe(AR_BRUTTO);
    expect(data.totals.duePayable).toBe(SR_BRUTTO - AR_BRUTTO);
    expect(validateEInvoiceData(data).ok).toBe(true);
  });
});
