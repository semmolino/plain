"use strict";

// Offene Posten (Domaene open_items): einzelne Altbelege mit Nummer, Datum,
// Faelligkeit und Positionen auf Strukturknoten.
//
// Die Belegerzeugung selbst ist gemockt - geprueft wird, was der Import an die
// Beleg-Pipeline UEBERGIBT (Positionsbetraege, Kopfdaten, Zahlung). Das ist der
// Teil, der hier entsteht; die Pipeline selbst hat ihre eigenen Tests.

jest.mock("../services/partialPayments", () => ({
  initPartialPayment: jest.fn(async () => ({ id: 500 })),
  writePpsRows: jest.fn(async () => {}),
  recomputePartialPaymentTotals: jest.fn(async () => {}),
  bookPartialPayment: jest.fn(async () => {}),
}));
jest.mock("../services/invoices", () => ({
  initInvoice: jest.fn(async () => ({ id: 600 })),
  writeInvoiceStructureRows: jest.fn(async () => {}),
  recomputeInvoiceTotals: jest.fn(async () => {}),
  bookInvoice: jest.fn(async () => {}),
}));

const ppSvc = require("../services/partialPayments");
const invSvc = require("../services/invoices");
const { commit, preview, rollback } = require("../services/importService");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { xlsxBuffer } = require("./helpers/sheetFixture");

const TENANT = 7;
const EMPLOYEE = 99;
const HEAD = [
  "Projektnummer *", "Belegnummer *", "Belegart (Abschlag/Rechnung)", "Belegdatum *", "Fällig am",
  "Position (Kürzel)", "Betrag netto *", "MwSt %", "Bereits bezahlt (netto)", "Zahlungsdatum", "Bemerkung",
];
const row = (...cells) => { const r = [...cells]; while (r.length < HEAD.length) r.push(""); return r; };

const seed = (extra = {}) => makeFakeSupabase({
  PROJECT: [{ ID: 1, TENANT_ID: TENANT, NAME_SHORT: "P-1", NAME_LONG: "Projekt Eins", COMPANY_ID: 3, ADDRESS_ID: 11, CONTACT_ID: 21 }],
  CONTRACT: [{ ID: 31, TENANT_ID: TENANT, PROJECT_ID: 1, INVOICE_ADDRESS_ID: 11, INVOICE_CONTACT_ID: 21 }],
  PROJECT_STRUCTURE: [
    { ID: 41, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, NAME_SHORT: "LP1-4", BILLING_TYPE_ID: 1, REVENUE: 30000, EXTRAS_PERCENT: 0 },
    { ID: 42, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, NAME_SHORT: "LP5",   BILLING_TYPE_ID: 1, REVENUE: 50000, EXTRAS_PERCENT: 10 },
    { ID: 43, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, NAME_SHORT: "BL",    BILLING_TYPE_ID: 2, REVENUE: 0,     EXTRAS_PERCENT: 0 },
  ],
  PARTIAL_PAYMENT: [{ ID: 500, TENANT_ID: TENANT, PROJECT_ID: 1, STATUS_ID: 0, VAT_PERCENT: 19 }],
  INVOICE: [{ ID: 600, TENANT_ID: TENANT, PROJECT_ID: 1, STATUS_ID: 0, VAT_PERCENT: 19 }],
  CONTACTS: [{ ID: 21, TENANT_ID: TENANT, ADDRESS_ID: 11 }],
  PAYMENT: [], PAYMENT_STRUCTURE: [], PARTIAL_PAYMENT_STRUCTURE: [],
  ...extra,
});

const runCommit = (buffer, supabase) =>
  commit({ domainKey: "open_items", buffer, filename: "posten.xlsx", mapping: null, supabase, tenantId: TENANT, employeeId: EMPLOYEE });
const runPreview = (buffer, supabase) =>
  preview({ domainKey: "open_items", buffer, filename: "posten.xlsx", mapping: null, supabase, tenantId: TENANT });

/** Zuletzt geschriebene Belegpositionen aus dem Mock holen. */
const ppsRows = () => ppSvc.writePpsRows.mock.calls.at(-1)[1].rows;
/** Die Kopfdaten, die der Import auf den Beleg geschrieben hat. */
const kopf = (supabase, table = "PARTIAL_PAYMENT") => supabase._tables[table][0];

beforeEach(() => jest.clearAllMocks());

// ── Positionen ────────────────────────────────────────────────────────────────
describe("Belegpositionen", () => {
  it("legt einen Beleg mit zwei Positionen auf den benannten Knoten an", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-2025-007", "Abschlag", "15.11.2025", "15.12.2025", "LP1-4", "12000", "19"),
      row("P-1", "AR-2025-007", "Abschlag", "15.11.2025", "15.12.2025", "LP5",   "8000",  "19"),
    ]);

    const res = await runCommit(buffer, supabase);
    expect(res.inserted).toBe(2);                       // zwei Zeilen = ein Beleg
    expect(ppSvc.initPartialPayment).toHaveBeenCalledTimes(1);

    const pos = ppsRows();
    expect(pos).toHaveLength(2);
    expect(pos.find((p) => p.STRUCTURE_ID === 41)).toMatchObject({ AMOUNT_NET: 12000, AMOUNT_EXTRAS_NET: 0 });
    // LP5 traegt 10 % Nebenkosten -> die Position bekommt sie mit
    expect(pos.find((p) => p.STRUCTURE_ID === 42)).toMatchObject({ AMOUNT_NET: 8000, AMOUNT_EXTRAS_NET: 800 });
  });

  it("verteilt eine Zeile ohne Position ueber die Pauschal-Knoten", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "", "8000", "19"),
    ]);

    await runCommit(buffer, supabase);
    const pos = ppsRows();
    // Verteilung im Verhaeltnis der Honorare 30.000 : 50.000
    expect(pos).toHaveLength(2);
    expect(pos.find((p) => p.STRUCTURE_ID === 41).AMOUNT_NET).toBe(3000);
    expect(pos.find((p) => p.STRUCTURE_ID === 42).AMOUNT_NET).toBe(5000);
    // Stunden-Knoten bleibt aussen vor
    expect(pos.some((p) => p.STRUCTURE_ID === 43)).toBe(false);
  });

  it("schreibt Nummer, Datum, Faelligkeit und MwSt aus der Datei auf den Beleg", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-2025-007", "Abschlag", "15.11.2025", "15.12.2025", "LP5", "8000", "7", "", "", "Altbestand"),
    ]);

    const res = await runCommit(buffer, supabase);
    expect(kopf(supabase)).toMatchObject({
      PARTIAL_PAYMENT_NUMBER: "AR-2025-007",
      PARTIAL_PAYMENT_DATE: "2025-11-15",
      DUE_DATE: "2025-12-15",
      VAT_PERCENT: 7,                                   // Datei schlaegt Vertragssatz
      COMMENT: "Altbestand",
      IMPORT_BATCH_ID: res.batchId,
    });
  });

  it("legt Rechnungen ueber den Rechnungs-Pfad an", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "RE-2025-101", "Rechnung", "01.12.2025", "31.12.2025", "LP5", "4200", "19"),
    ]);

    await runCommit(buffer, supabase);
    expect(invSvc.initInvoice).toHaveBeenCalledTimes(1);
    expect(ppSvc.initPartialPayment).not.toHaveBeenCalled();
    expect(kopf(supabase, "INVOICE")).toMatchObject({ INVOICE_NUMBER: "RE-2025-101", INVOICE_DATE: "2025-12-01" });
  });
});

// ── Zahlungen ─────────────────────────────────────────────────────────────────
describe("Teilzahlung", () => {
  it("bucht die Zahlung mit ihrem eigenen Datum, nicht mit heute", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "15.12.2025", "LP5", "8000", "19", "3000", "20.12.2025"),
    ]);

    await runCommit(buffer, supabase);
    const pay = supabase._tables.PAYMENT[0];
    expect(pay).toMatchObject({ AMOUNT_PAYED_NET: 3000, PAYMENT_DATE: "2025-12-20", PROJECT_ID: 1 });
    expect(pay.PURPOSE_OF_PAYMENT).toContain("AR-1");
    // Restforderung bleibt offen: 8000 - 3000
    expect(supabase._tables.PAYMENT_STRUCTURE.reduce((a, r) => a + r.AMOUNT_PAYED_NET, 0)).toBe(3000);
  });

  it("faellt ohne Zahlungsdatum auf das Belegdatum zurueck", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "LP5", "8000", "19", "1000"),
    ]);

    await runCommit(buffer, supabase);
    expect(supabase._tables.PAYMENT[0].PAYMENT_DATE).toBe("2025-11-15");
  });

  it("weist eine Zahlung ueber dem Belegbetrag zurueck", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "LP5", "8000", "19", "9000"),
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.summary.error).toBe(1);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("übersteigt den Betrag");
  });
});

// ── Pruefung ──────────────────────────────────────────────────────────────────
describe("Pruefung", () => {
  it("lehnt eine bereits vergebene Belegnummer ab", async () => {
    const supabase = seed({
      PARTIAL_PAYMENT: [{ ID: 500, TENANT_ID: TENANT, PROJECT_ID: 1, STATUS_ID: 2, PARTIAL_PAYMENT_NUMBER: "AR-2025-007", VAT_PERCENT: 19 }],
    });
    const buffer = await xlsxBuffer([HEAD, row("P-1", "AR-2025-007", "Abschlag", "15.11.2025", "", "LP5", "8000")]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("bereits vergeben");
    expect(pv.summary.error).toBe(1);
  });

  it("verlangt ein Belegdatum", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([HEAD, row("P-1", "AR-1", "Abschlag", "", "", "LP5", "8000")]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("Belegdatum fehlt");
  });

  it("warnt ohne Faelligkeit", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([HEAD, row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "LP5", "8000")]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.summary.warning).toBe(1);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("gemahnt");
  });

  it("meldet ein unbekanntes Positions-Kuerzel", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([HEAD, row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "LP99", "8000")]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("nicht gefunden");
  });

  it("lehnt eine Stunden-Position ab", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([HEAD, row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "BL", "8000")]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("Stunden-Position");
  });

  it("verbietet, Positionszeilen mit einer Sammelzeile zu mischen", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "LP5", "8000"),
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "",    "2000"),
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.summary.error).toBe(2);                         // ganzer Beleg faellt aus
    expect(pv.rows.map((r) => r.messages.map((m) => m.text).join()).join()).toContain("mischt Positionszeilen");
  });

  it("meldet dieselbe Position zweimal im selben Beleg", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "LP5", "8000"),
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "LP5", "2000"),
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows.map((r) => r.messages.map((m) => m.text).join()).join()).toContain("mehrfach");
  });

  it("meldet dieselbe Belegnummer bei zwei Projekten", async () => {
    const supabase = seed({
      PROJECT: [
        { ID: 1, TENANT_ID: TENANT, NAME_SHORT: "P-1", NAME_LONG: "Eins", COMPANY_ID: 3, ADDRESS_ID: 11, CONTACT_ID: 21 },
        { ID: 2, TENANT_ID: TENANT, NAME_SHORT: "P-2", NAME_LONG: "Zwei", COMPANY_ID: 3, ADDRESS_ID: 11, CONTACT_ID: 21 },
      ],
      CONTRACT: [
        { ID: 31, TENANT_ID: TENANT, PROJECT_ID: 1, INVOICE_ADDRESS_ID: 11, INVOICE_CONTACT_ID: 21 },
        { ID: 32, TENANT_ID: TENANT, PROJECT_ID: 2, INVOICE_ADDRESS_ID: 11, INVOICE_CONTACT_ID: 21 },
      ],
      PROJECT_STRUCTURE: [
        { ID: 41, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, NAME_SHORT: "LP5", BILLING_TYPE_ID: 1, REVENUE: 1000, EXTRAS_PERCENT: 0 },
        { ID: 51, TENANT_ID: TENANT, PROJECT_ID: 2, FATHER_ID: null, NAME_SHORT: "LP5", BILLING_TYPE_ID: 1, REVENUE: 1000, EXTRAS_PERCENT: 0 },
      ],
    });
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "LP5", "500"),
      row("P-2", "AR-1", "Abschlag", "15.11.2025", "", "LP5", "500"),
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.summary.error).toBe(2);
    expect(pv.rows.map((r) => r.messages.map((m) => m.text).join()).join()).toContain("mehreren Projekten");
  });

  it("verwirft den GANZEN Beleg, wenn eine Position fehlerhaft ist", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "LP1-4", "8000"),
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "LP99",  "2000"),   // Kuerzel gibt es nicht
      row("P-1", "AR-2", "Abschlag", "15.11.2025", "", "LP5",   "1000"),   // anderer Beleg bleibt gueltig
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.summary.error).toBe(2);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("wird übersprungen");

    const res = await runCommit(buffer, supabase);
    expect(res.inserted).toBe(1);
    expect(ppSvc.initPartialPayment).toHaveBeenCalledTimes(1);
  });

  it("uebernimmt Kopfdaten der ersten Zeile und meldet Abweichungen", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "15.12.2025", "LP1-4", "8000"),
      row("P-1", "AR-1", "Abschlag", "20.11.2025", "15.12.2025", "LP5",   "2000"),
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows[1].messages.map((m) => m.text).join()).toContain("weicht von der ersten Zeile");

    await runCommit(buffer, supabase);
    expect(kopf(supabase).PARTIAL_PAYMENT_DATE).toBe("2025-11-15");
  });
});

// -- Rollback ------------------------------------------------------------------
describe("Rollback", () => {
  it("nimmt Beleg und Zahlung wieder zurueck", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "15.12.2025", "LP5", "8000", "19", "3000", "20.12.2025"),
    ]);
    const { batchId } = await runCommit(buffer, supabase);
    expect(supabase._tables.PAYMENT).toHaveLength(1);

    await rollback({ batchId, supabase, tenantId: TENANT });

    expect(supabase._tables.PAYMENT).toHaveLength(0);
    expect(supabase._tables.PAYMENT_STRUCTURE).toHaveLength(0);
    // Der Beleg selbst ist ebenfalls weg (er trug die Stapel-Kennung).
    expect(supabase._tables.PARTIAL_PAYMENT.filter((r) => r.IMPORT_BATCH_ID === batchId)).toHaveLength(0);
  });
});
