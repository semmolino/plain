"use strict";

// Offene Posten (Domaene open_items): einzelne Altbelege mit Nummer, Datum,
// Faelligkeit und Positionen auf Strukturknoten.
//
// Seit 09/2026 schreibt der Import GEBUENDELT: er ruft initInvoice/bookInvoice
// nicht mehr je Beleg, sondern baut die Belegzeilen selbst und fuegt sie in
// wenigen Stapeln ein (services/importBelege.js). Der alte Weg kostete rund 30
// Anfragen je Beleg und riss bei etwa 150 Belegen im Gateway-Timeout.
//
// Geprueft wird deshalb, was WIRKLICH IN DEN TABELLEN STEHT — nicht mehr, was
// an eine Pipeline uebergeben wurde. Die Mocks bleiben nur stehen, damit die
// Module ohne Playwright/PDF laden.

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
const { commit, preview, rollback, parseBuffer, buildAutoMapping, buildPreview, DOMAINS } = require("../services/importService");
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
  PROJECT: [{ ID: 1, TENANT_ID: TENANT, ABBR: "P-1", NAME: "Projekt Eins", COMPANY_ID: 3, ADDRESS_ID: 11, CONTACT_ID: 21 }],
  CONTRACT: [{ ID: 31, TENANT_ID: TENANT, PROJECT_ID: 1, INVOICE_ADDRESS_ID: 11, INVOICE_CONTACT_ID: 21, VAT_ID: 5 }],
  PROJECT_STRUCTURE: [
    { ID: 41, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, ABBR: "LP1-4", BILLING_TYPE_ID: 1, REVENUE: 30000, EXTRAS_PERCENT: 0 },
    { ID: 42, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, ABBR: "LP5",   BILLING_TYPE_ID: 1, REVENUE: 50000, EXTRAS_PERCENT: 10 },
    { ID: 43, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, ABBR: "BL",    BILLING_TYPE_ID: 2, REVENUE: 0,     EXTRAS_PERCENT: 0 },
  ],
  ADVANCE_INVOICE: [],
  INVOICE: [],
  CONTACTS: [{ ID: 21, TENANT_ID: TENANT, ADDRESS_ID: 11, FIRST_NAME: "Anna", LAST_NAME: "Meier" }],
  ADDRESS: [{ ID: 11, TENANT_ID: TENANT, ADDRESS_NAME_1: "Bauherr GmbH" }],
  COMPANY: [{ ID: 3, TENANT_ID: TENANT, COMPANY_NAME_1: "Architekten" }],
  EMPLOYEE: [{ ID: EMPLOYEE, TENANT_ID: TENANT, ABBR: "FH", FIRST_NAME: "Frank", LAST_NAME: "Haus" }],
  VAT: [{ ID: 5, VAT_PERCENT: 19 }, { ID: 6, VAT_PERCENT: 16 }],
  COUNTRY: [], SALUTATION: [], TENANT_SETTINGS: [],
  PAYMENT: [], PAYMENT_STRUCTURE: [], ADVANCE_INVOICE_STRUCTURE: [], INVOICE_STRUCTURE: [], INVOICE_DEDUCTION: [],
  ...extra,
});

const runCommit = (buffer, supabase) =>
  commit({ domainKey: "open_items", buffer, filename: "posten.xlsx", mapping: null, supabase, tenantId: TENANT, employeeId: EMPLOYEE });
const runPreview = (buffer, supabase) =>
  preview({ domainKey: "open_items", buffer, filename: "posten.xlsx", mapping: null, supabase, tenantId: TENANT });

/** Die geschriebenen Belegpositionen (Abschlagsrechnung, sofern nicht anders gesagt). */
const ppsRows = (supabase, table = "ADVANCE_INVOICE_STRUCTURE") =>
  supabase._tables[table].map((r) => ({ ...r, id: r.STRUCTURE_ID, amt: r.AMOUNT_NET }));
/** Der geschriebene Beleg. */
const kopf = (supabase, table = "ADVANCE_INVOICE") =>
  supabase._tables[table].find((r) => r.IMPORT_BATCH_ID != null) || supabase._tables[table][0];
/** Einen Beleg ueber seine Nummer finden — die Kennungen vergibt jetzt die DB. */
const belegMitNummer = (supabase, nummer, table = "ADVANCE_INVOICE") =>
  supabase._tables[table].find((r) => r.ADVANCE_INVOICE_NUMBER === nummer || r.INVOICE_NUMBER === nummer);

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
    expect(supabase._tables.ADVANCE_INVOICE).toHaveLength(1);   // ein Beleg

    const pos = ppsRows(supabase);
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
    const pos = ppsRows(supabase);
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
      ADVANCE_INVOICE_NUMBER: "AR-2025-007",
      ADVANCE_INVOICE_DATE: "2025-11-15",
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
    expect(supabase._tables.INVOICE).toHaveLength(1);           // ueber den Rechnungs-Pfad
    expect(supabase._tables.ADVANCE_INVOICE).toHaveLength(0);
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
      ADVANCE_INVOICE: [{ ID: 500, TENANT_ID: TENANT, PROJECT_ID: 1, STATUS_ID: 2, ADVANCE_INVOICE_NUMBER: "AR-2025-007", VAT_PERCENT: 19 }],
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
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("Mahnwesen");
  });

  it("meldet ein unbekanntes Positions-Kuerzel", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([HEAD, row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "LP99", "8000")]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("nicht gefunden");
  });

  // Bis 09/2026 war das ein Fehler. Fuer eine echte Belegoruebernahme ist das
  // falsch: Altsysteme rechnen Abschlaege sehr wohl auf Stunden-Positionen ab.
  // Der Leistungsstand kann dort ueber 100 % laufen — das ist eine Aussage
  // ueber die Daten, kein Grund, den Beleg abzulehnen.
  it("warnt bei einer Stunden-Position, lehnt sie aber nicht ab", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([HEAD, row("P-1", "AR-1", "Abschlag", "15.11.2025", "", "BL", "8000")]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows[0].status).not.toBe("error");
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("nach Aufwand abgerechnet");
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
        { ID: 1, TENANT_ID: TENANT, ABBR: "P-1", NAME: "Eins", COMPANY_ID: 3, ADDRESS_ID: 11, CONTACT_ID: 21 },
        { ID: 2, TENANT_ID: TENANT, ABBR: "P-2", NAME: "Zwei", COMPANY_ID: 3, ADDRESS_ID: 11, CONTACT_ID: 21 },
      ],
      CONTRACT: [
        { ID: 31, TENANT_ID: TENANT, PROJECT_ID: 1, INVOICE_ADDRESS_ID: 11, INVOICE_CONTACT_ID: 21 },
        { ID: 32, TENANT_ID: TENANT, PROJECT_ID: 2, INVOICE_ADDRESS_ID: 11, INVOICE_CONTACT_ID: 21 },
      ],
      PROJECT_STRUCTURE: [
        { ID: 41, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, ABBR: "LP5", BILLING_TYPE_ID: 1, REVENUE: 1000, EXTRAS_PERCENT: 0 },
        { ID: 51, TENANT_ID: TENANT, PROJECT_ID: 2, FATHER_ID: null, ABBR: "LP5", BILLING_TYPE_ID: 1, REVENUE: 1000, EXTRAS_PERCENT: 0 },
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
    expect(supabase._tables.ADVANCE_INVOICE).toHaveLength(1);   // ein Beleg
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
    expect(kopf(supabase).ADVANCE_INVOICE_DATE).toBe("2025-11-15");
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
    expect(supabase._tables.ADVANCE_INVOICE.filter((r) => r.IMPORT_BATCH_ID === batchId)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Belegarten (09/2026)
//
// Bis dahin kannte der Import zwei Ausprägungen und leitete sie aus einer
// Zeile ab: `dt.includes("rechnung") && !dt.includes("abschlag")`. Das traf
// "Schlussrechnung" richtig und "Storno-Abschlagsrechnung" falsch — und vor
// allem hatte es keinen Fehlerfall: alles Unbekannte wurde stillschweigend
// zur Abschlagsrechnung.
// ─────────────────────────────────────────────────────────────────────────────
describe("Belegarten", () => {
  const HEAD_X = [...HEAD, "Zahlungsziel (Tage)", "Storniert Beleg"];
  const rowX = (...cells) => { const r = [...cells]; while (r.length < HEAD_X.length) r.push(""); return r; };
  const previewX = async (zeilen, supabase) => {
    const parsed = await parseBuffer(await xlsxBuffer([HEAD_X, ...zeilen]));
    const ctx = await DOMAINS.open_items.loadContext(supabase, TENANT);
    return buildPreview({ domainKey: "open_items", parsed, mapping: buildAutoMapping(parsed.headers, "open_items"), ctx });
  };

  it.each([
    ["Abschlag",            "partial", null],
    ["Abschlagsrechnung",   "partial", null],
    ["Rechnung",            "invoice", "rechnung"],
    ["Schlussrechnung",     "invoice", "schlussrechnung"],
    ["SR",                  "invoice", "schlussrechnung"],
    ["Teilschlussrechnung", "invoice", "teilschlussrechnung"],
    ["Gutschrift",          "invoice", "gutschrift"],
  ])("erkennt „%s“", async (text, docType, invoiceType) => {
    const pv = await previewX([rowX("P-1", "B-1", text, "15.11.2025", "30.11.2025", "LP5", "8000")], seed());
    expect(pv.rows[0]._dbRow.docType).toBe(docType);
    expect(pv.rows[0]._dbRow.invoiceType).toBe(invoiceType);
  });

  it("dreht bei einer Gutschrift das Vorzeichen und sagt es", async () => {
    const pv = await previewX([rowX("P-1", "GS-1", "Gutschrift", "15.11.2025", "30.11.2025", "LP5", "8000")], seed());
    expect(pv.rows[0]._dbRow.amount).toBe(-8000);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("als Minderung");
  });

  it("lehnt eine unbekannte Belegart ab und nennt die erlaubten", async () => {
    const pv = await previewX([rowX("P-1", "X-1", "Zwischenrechnung", "15.11.2025", "30.11.2025", "LP5", "8000")], seed());
    expect(pv.rows[0].status).toBe("error");
    const text = pv.rows[0].messages.map((m) => m.text).join();
    expect(text).toContain("unbekannt");
    expect(text).toContain("Schlussrechnung");
  });

  it("nimmt eine leere Belegart als Abschlag, sagt es aber", async () => {
    const pv = await previewX([rowX("P-1", "B-1", "", "15.11.2025", "30.11.2025", "LP5", "8000")], seed());
    expect(pv.rows[0]._dbRow.docType).toBe("partial");
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("Belegart leer");
  });

  it("lehnt ein Storno ohne Bezugsbeleg ab", async () => {
    const pv = await previewX([rowX("P-1", "S-1", "Storno", "15.11.2025", "30.11.2025", "LP5", "8000")], seed());
    expect(pv.rows[0].status).toBe("error");
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("ohne Bezugsbeleg");
  });

  // Statt zu warnen, dass der Beleg nie im Mahnwesen erscheint: ableiten.
  it("rechnet die Fälligkeit aus dem Zahlungsziel", async () => {
    const pv = await previewX([rowX("P-1", "B-1", "Abschlag", "15.11.2025", "", "LP5", "8000", "", "", "", "", "30")], seed());
    expect(pv.rows[0]._dbRow.dueDate).toBe("2025-12-15");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Belegketten (09/2026): Abzüge der Schlussrechnung, Storno, Reihenfolge.
//
// Aufgelöst wird in der VORSCHAU, nicht im Commit — nur dort sieht der Nutzer
// den Fehler, bevor ein Beleg gebucht ist. Und aufgelöst wird gegen die ganze
// Datei UND den Bestand: die Reihenfolge der Zeilen darf keine Rolle spielen.
// ─────────────────────────────────────────────────────────────────────────────
describe("Belegketten", () => {
  const HEAD_K = [...HEAD, "Zieht Abschläge ab", "Storniert Beleg", "Stornodatum", "Kopfsumme netto (Prüfsumme)"];
  const rowK = (...cells) => { const r = [...cells]; while (r.length < HEAD_K.length) r.push(""); return r; };

  const seedK = () => {
    // Die Kennungen vergibt die Datenbank — der Import legt die Belege selbst an.
    return seed();
  };

  const previewK = async (zeilen, supabase) => {
    const parsed = await parseBuffer(await xlsxBuffer([HEAD_K, ...zeilen]));
    const ctx = await DOMAINS.open_items.loadContext(supabase, TENANT);
    return buildPreview({ domainKey: "open_items", parsed, mapping: buildAutoMapping(parsed.headers, "open_items"), ctx });
  };
  const commitK = (zeilen, supabase) =>
    xlsxBuffer([HEAD_K, ...zeilen]).then((buf) => runCommit(buf, supabase));

  const abschlag = (nr, betrag) => rowK("P-1", nr, "Abschlag", "01.03.2025", "31.03.2025", "LP5", betrag);

  it("schreibt die Abzüge einer Schlussrechnung in INVOICE_DEDUCTION", async () => {
    const sb = seedK();
    await commitK([
      abschlag("AR-1", "10000"),
      rowK("P-1", "SR-1", "Schlussrechnung", "01.12.2025", "31.12.2025", "LP5", "50000", "", "", "", "", "AR-1"),
    ], sb);

    expect(sb._tables.INVOICE_DEDUCTION).toHaveLength(1);
    const arBeleg = sb._tables.ADVANCE_INVOICE.find((r) => r.ADVANCE_INVOICE_NUMBER === "AR-1");
    expect(sb._tables.INVOICE_DEDUCTION[0]).toMatchObject({
      ADVANCE_INVOICE_ID: arBeleg.ID, DEDUCTION_AMOUNT_NET: 10000,
    });
    // Ohne Stapel-Kennung waere die Zeile beim Zuruecksetzen nicht auffindbar.
    expect(sb._tables.INVOICE_DEDUCTION[0].IMPORT_BATCH_ID).toBeTruthy();
  });

  // Der Kern: die Datei darf ihre Belege in beliebiger Reihenfolge führen.
  it("findet den Abschlag auch, wenn er HINTER der Schlussrechnung steht", async () => {
    const sb = seedK();
    await commitK([
      rowK("P-1", "SR-1", "Schlussrechnung", "01.12.2025", "31.12.2025", "LP5", "50000", "", "", "", "", "AR-1"),
      abschlag("AR-1", "10000"),
    ], sb);

    expect(sb._tables.INVOICE_DEDUCTION).toHaveLength(1);
    const ar = sb._tables.ADVANCE_INVOICE.find((r) => r.ADVANCE_INVOICE_NUMBER === "AR-1");
    expect(sb._tables.INVOICE_DEDUCTION[0].ADVANCE_INVOICE_ID).toBe(ar.ID);
  });

  it("nimmt einen Teilabzug aus der Datei", async () => {
    const sb = seedK();
    await commitK([
      abschlag("AR-1", "10000"),
      rowK("P-1", "SR-1", "Schlussrechnung", "01.12.2025", "31.12.2025", "LP5", "50000", "", "", "", "", "AR-1:4000"),
    ], sb);
    expect(sb._tables.INVOICE_DEDUCTION[0].DEDUCTION_AMOUNT_NET).toBe(4000);
  });

  it("lehnt einen Abzug ab, den es nirgends gibt", async () => {
    const pv = await previewK([
      rowK("P-1", "SR-1", "Schlussrechnung", "01.12.2025", "31.12.2025", "LP5", "50000", "", "", "", "", "AR-99"),
    ], seedK());
    expect(pv.rows[0].status).toBe("error");
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("weder in dieser Datei noch im System");
  });

  it("lässt denselben Abschlag nicht zweimal abziehen", async () => {
    const pv = await previewK([
      abschlag("AR-1", "10000"),
      rowK("P-1", "SR-1", "Schlussrechnung", "01.12.2025", "", "LP5", "20000", "", "", "", "", "AR-1"),
      rowK("P-1", "SR-2", "Schlussrechnung", "02.12.2025", "", "LP5", "20000", "", "", "", "", "AR-1"),
    ], seedK());
    expect(pv.rows.filter((r) => r.status === "error").length).toBeGreaterThan(0);
    expect(pv.rows.map((r) => r.messages.map((m) => m.text).join()).join())
      .toContain("von zwei Belegen abgezogen");
  });

  it("warnt bei einer Schlussrechnung ohne Abzüge", async () => {
    const pv = await previewK([
      rowK("P-1", "SR-1", "Schlussrechnung", "01.12.2025", "31.12.2025", "LP5", "50000"),
    ], seedK());
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("ohne Abzüge");
  });

  it("verknüpft ein Storno mit seinem Original und datiert es aus der Datei", async () => {
    const sb = seedK();
    await commitK([
      abschlag("AR-1", "10000"),
      rowK("P-1", "S-AR-1", "Storno", "20.12.2025", "", "LP5", "10000", "", "", "", "", "", "AR-1", "20.12.2025"),
    ], sb);

    const original = sb._tables.ADVANCE_INVOICE.find((r) => r.ADVANCE_INVOICE_NUMBER === "AR-1");
    const storno = sb._tables.ADVANCE_INVOICE.find((r) => r.CANCELS_ADVANCE_INVOICE_ID === original.ID);
    expect(storno).toBeTruthy();
    // Das Stornodatum steht am ORIGINAL und kommt aus der Datei, nicht von heute.
    expect(original.CANCELLATION_DATE).toBe("2025-12-20");
    // Und das Original ist storniert — sonst zaehlt sein Betrag doppelt.
    expect(original.STATUS_ID).toBe(3);
  });

  it("lehnt ein Storno auf einen unbekannten Beleg ab", async () => {
    const pv = await previewK([
      rowK("P-1", "S-1", "Storno", "20.12.2025", "", "LP5", "10000", "", "", "", "", "", "AR-99"),
    ], seedK());
    expect(pv.rows[0].status).toBe("error");
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("weder in dieser Datei noch im System");
  });

  // Geschrieben werden die Positionen. Weicht ihre Summe von der Kopfsumme ab,
  // waere der Beleg eine falsche Forderung — deshalb Fehler, nicht Warnung.
  it("lehnt einen Beleg ab, dessen Positionen nicht zur Kopfsumme passen", async () => {
    const pv = await previewK([
      rowK("P-1", "AR-1", "Abschlag", "01.03.2025", "", "LP5", "8000", "", "", "", "", "", "", "", "9000"),
    ], seedK());
    expect(pv.rows[0].status).toBe("error");
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("Kopfsumme");
  });

  it("lässt eine passende Kopfsumme durch", async () => {
    const pv = await previewK([
      rowK("P-1", "AR-1", "Abschlag", "01.03.2025", "", "LP5", "5000", "", "", "", "", "", "", "", "8000"),
      rowK("P-1", "AR-1", "Abschlag", "01.03.2025", "", "LP1-4", "3000"),
    ], seedK());
    expect(pv.rows.every((r) => r.status !== "error")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gebündelt schreiben (09/2026)
//
// Der frühere Weg legte EINEN Beleg je Aufruf an: initInvoice mit 14 Abfragen,
// Kopf-Update, Positionen, Summenlauf, Beleg neu lesen, buchen, Aggregate je
// Beleg fortschreiben. Rund 30 Anfragen je Beleg — bei 5 ms je Rundreise reißt
// der Gateway-Schnitt nach 30 Sekunden, also bei etwa 150 Belegen.
//
// Der Zähler unten ist der Wächter: er lässt eine später eingeschlichene
// Schleife („ach, eine Abfrage je Beleg geht schon") sofort auffallen, statt
// sie im Betrieb als Timeout zu entdecken.
// ─────────────────────────────────────────────────────────────────────────────
describe("Gebündelt schreiben", () => {
  const vieleBelege = (n) => {
    const zeilen = [HEAD];
    for (let i = 1; i <= n; i++) {
      zeilen.push(row("P-1", `AR-${String(i).padStart(4, "0")}`, "Abschlag",
        "15.11.2025", "15.12.2025", "LP5", String(1000 + i), "19"));
    }
    return zeilen;
  };

  it("braucht für 200 Belege nur einen Bruchteil der früheren Anfragen", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer(vieleBelege(200));

    supabase._anfragenZuruecksetzen();
    const res = await runCommit(buffer, supabase);

    expect(res.inserted).toBe(200);
    expect(supabase._tables.ADVANCE_INVOICE).toHaveLength(200);
    // Der alte Weg käme hier auf rund 6.000. Die Grenze ist bewusst großzügig:
    // sie soll eine Schleife fangen, nicht jede Umstellung blockieren.
    expect(supabase._anfragen()).toBeLessThan(600);
  });

  it("wächst nicht linear mit der Belegzahl", async () => {
    const klein = seed();
    klein._anfragenZuruecksetzen();
    await runCommit(await xlsxBuffer(vieleBelege(20)), klein);
    const beiZwanzig = klein._anfragen();

    const gross = seed();
    gross._anfragenZuruecksetzen();
    await runCommit(await xlsxBuffer(vieleBelege(200)), gross);
    const beiZweihundert = gross._anfragen();

    // Zehnmal so viele Belege dürfen nicht zehnmal so viele Anfragen kosten.
    expect(beiZweihundert).toBeLessThan(beiZwanzig * 4);
  });

  it("schreibt jede Zeile mit Stapel-Kennung", async () => {
    const supabase = seed();
    const { batchId } = await runCommit(await xlsxBuffer(vieleBelege(5)), supabase);

    // Wächter: keine neue Zeile ohne Kennung — sonst ist sie beim
    // Zurücksetzen nicht auffindbar.
    for (const tabelle of ["ADVANCE_INVOICE", "ADVANCE_INVOICE_STRUCTURE"]) {
      const ohne = supabase._tables[tabelle].filter((r) => r.IMPORT_BATCH_ID !== batchId);
      expect({ tabelle, ohne: ohne.length }).toEqual({ tabelle, ohne: 0 });
    }
  });

  it("meldet je Tabelle eine Zahl, nicht eine Gesamtzahl", async () => {
    const supabase = seed();
    const res = await runCommit(await xlsxBuffer(vieleBelege(3)), supabase);

    // Eine Null an der falschen Stelle springt so sofort ins Auge; ein
    // einzelnes „inserted: 3" verbirgt sie.
    expect(res.belege).toMatchObject({ abschlaege: 3, rechnungen: 0, positionen: 3 });
    expect(res.belege.knoten).toBeGreaterThan(0);
  });

  // Die Aggregate stammen aus derselben Rechnung, mit der sich die Anwendung
  // selbst heilt. Weicht der Import davon ab, ist das ein Fehler des Imports.
  it("setzt die Aggregate so, wie die Rückrechnung sie sieht", async () => {
    const supabase = seed();
    await runCommit(await xlsxBuffer([
      HEAD,
      row("P-1", "AR-1", "Abschlag", "15.11.2025", "15.12.2025", "LP5", "12000", "19"),
      row("P-1", "AR-2", "Abschlag", "16.11.2025", "16.12.2025", "LP5", "8000", "19"),
    ]), supabase);

    const { recomputeBilledByStructure } = require("../services/finalInvoices");
    const r = await recomputeBilledByStructure(supabase, { contractIds: [31] });
    expect(r.ok).toBe(true);

    const knoten = supabase._tables.PROJECT_STRUCTURE.find((s) => s.ID === 42);
    expect(knoten.ADVANCE_INVOICED).toBe(r.partial.get("42"));
    // 20.000 plus 10 % Nebenkosten am Knoten LP5
    expect(knoten.ADVANCE_INVOICED).toBe(22000);
  });
});
