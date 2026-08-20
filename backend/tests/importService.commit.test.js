"use strict";

// Integrationstests fuer die schreibende Seite des Imports (commit + rollback).
// Die bestehende importService.test.js deckt nur die reinen Funktionen ab —
// genau deshalb blieb unbemerkt, dass die Anfangsbestaende den Mandanten nicht
// mehr an initInvoice/initPartialPayment weiterreichen (Security-Fix 13e88c4).


// Belegerzeugung wird gemockt: hier interessiert der Import-Pfad, nicht die
// Rechnungslogik. Muss VOR dem require des Service stehen (jest hoisting).
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
const { commit, rollback, buildTemplate, parseBuffer, errorReport } = require("../services/importService");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { xlsxBuffer, csvBuffer } = require("./helpers/sheetFixture");

const TENANT = 7;
const EMPLOYEE = 99;

/** Array-of-Arrays → XLSX-Buffer (simuliert die hochgeladene Datei). */
const fileOf = (aoa) => xlsxBuffer(aoa);

const run = (domainKey, buffer, supabase, opts = {}) =>
  commit({ domainKey, buffer, filename: "test.xlsx", mapping: null, supabase, tenantId: TENANT, employeeId: EMPLOYEE, ...opts });

beforeEach(() => jest.clearAllMocks());

// ── Vorlage ───────────────────────────────────────────────────────────────────
describe("buildTemplate", () => {
  const seed = () => makeFakeSupabase({
    COUNTRY: [{ NAME_LONG: "Deutschland" }, { NAME_LONG: "Österreich" }],
    GENDER: [{ GENDER: "weiblich" }, { GENDER: "männlich" }],
    PROJECT_STATUS: [{ NAME_SHORT: "in Bearbeitung" }, { NAME_SHORT: "abgeschlossen" }],
    PROJECT_TYPE: [{ TENANT_ID: TENANT, NAME_SHORT: "Neubau" }],
    EMPLOYEE: [{ TENANT_ID: TENANT, SHORT_NAME: "MMu" }, { TENANT_ID: TENANT, SHORT_NAME: "TBe" }],
    ADDRESS: [{ TENANT_ID: TENANT, ADDRESS_NAME_1: "Stadt Musterhausen" }],
  });

  it("liefert vier Blaetter und laesst das Datenblatt leer", async () => {
    const { buffer, filename } = await buildTemplate("address", { supabase: seed(), tenantId: TENANT });
    const parsed = await parseBuffer(buffer);

    expect(filename).toContain("address");
    expect(parsed.sheetNames).toEqual(["Anleitung", "Daten", "Beispiel", "Listen"]);
    // Gelesen wird "Daten" — nicht das erste Blatt der Datei.
    expect(parsed.sheetName).toBe("Daten");
    // Ueberschriften da, aber keine Datenzeile → die Beispielzeile kann nicht
    // versehentlich als echter Datensatz importiert werden.
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.headers[0]).toBe("Name 1 (Firma/Nachname) *");

    const beispiel = await parseBuffer(buffer, "Beispiel");
    expect(beispiel.rows).toHaveLength(1);
    expect(beispiel.rows[0]["Name 1 (Firma/Nachname) *"]).toBe("Mustermann Architekten GmbH");
  });

  it("fuellt die Auswahllisten aus dem Mandanten und haengt sie an die Spalten", async () => {
    const { buffer } = await buildTemplate("project", { supabase: seed(), tenantId: TENANT });
    const listen = await parseBuffer(buffer, "Listen");

    expect(listen.headers).toEqual(expect.arrayContaining(["Status", "Projekttyp", "Mitarbeiter (Kürzel)", "Adresse/Firma"]));
    const werte = listen.rows.flatMap(r => Object.values(r));
    expect(werte).toEqual(expect.arrayContaining(["in Bearbeitung", "Neubau", "MMu", "Stadt Musterhausen"]));

    // Datenvalidierung zeigt auf das Listen-Blatt (Dropdown in Excel).
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet("Daten");
    const statusCol = ws.getRow(1).values.indexOf("Status *");
    expect(ws.getCell(2, statusCol).dataValidation).toMatchObject({ type: "list", formulae: [expect.stringContaining("Listen!")] });
  });

  it("kommt ohne Datenbank aus (feste Listen bleiben)", async () => {
    const { buffer } = await buildTemplate("project_fee");
    const listen = await parseBuffer(buffer, "Listen");
    expect(listen.rows.flatMap(r => Object.values(r))).toEqual(expect.arrayContaining(["Pauschal", "Stunden"]));
  });
});

// ── Dateiformate ──────────────────────────────────────────────────────────────
describe("Dateiformate", () => {
  const seed = () => makeFakeSupabase({
    COUNTRY: [{ ID: 1, NAME_LONG: "Deutschland", NAME_SHORT: "DE" }],
    ADDRESS: [],
  });

  it("liest Semikolon-CSV in Windows-1252 mit Umlauten", async () => {
    const supabase = seed();
    const buffer = csvBuffer([
      ["Name 1 (Firma/Nachname) *", "Straße", "Ort"],
      ["Müller & Söhne GmbH", "Bahnhofstraße 3", "Köln"],
    ], { delimiter: ";", encoding: "latin1" });

    const res = await run("address", buffer, supabase);

    expect(res.inserted).toBe(1);
    const a = supabase._tables.ADDRESS[0];
    expect(a.ADDRESS_NAME_1).toBe("Müller & Söhne GmbH");
    expect(a.STREET).toBe("Bahnhofstraße 3");
    expect(a.CITY).toBe("Köln");
  });

  it("liest Komma-CSV mit UTF-8-BOM und Anfuehrungszeichen", async () => {
    const supabase = seed();
    const buffer = csvBuffer([
      ["Name 1 (Firma/Nachname) *", "Ort"],
      ['Meier, Schulz & Partner', "Berlin"],
    ], { delimiter: ",", encoding: "utf8", bom: true });

    await run("address", buffer, supabase);
    expect(supabase._tables.ADDRESS[0].ADDRESS_NAME_1).toBe("Meier, Schulz & Partner");
  });

  it("erklaert bei alten .xls-Dateien, was zu tun ist", async () => {
    // OLE2-Signatur = altes Binaerformat
    const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
    await expect(run("address", xls, seed()))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining(".xlsx") });
  });

  it("nimmt Zahlen- und Datumszellen so, wie Excel sie speichert", async () => {
    const supabase = makeFakeSupabase({
      PROJECT: [{ ID: 1, TENANT_ID: TENANT, NAME_SHORT: "P-1", NAME_LONG: "Projekt Eins" }],
      PROJECT_STRUCTURE: [],
      TENANT_SETTINGS: [],
    });
    // 80000.5 als echte Zahl — als Text gelesen waere daraus 800005 geworden.
    const buffer = await xlsxBuffer([
      ["Projektnummer *", "Honorarsumme (netto) *"],
      ["P-1", 80000.5],
    ]);

    await run("project_fee", buffer, supabase, { structureMode: "single" });
    expect(supabase._tables.PROJECT_STRUCTURE[0].REVENUE).toBe(80000.5);
  });
});

// ── Standardpfad: Adressen ────────────────────────────────────────────────────
describe("commit + rollback (address)", () => {
  const file = () => fileOf([
    ["Name 1 (Firma/Nachname) *", "PLZ", "Ort"],
    ["Neu GmbH", "10117", "Berlin"],
    ["Bestand GmbH", "10115", "Berlin"],   // Dublette gegen den Bestand
  ]);

  const seed = () => makeFakeSupabase({
    COUNTRY: [{ ID: 1, NAME_LONG: "Deutschland", NAME_SHORT: "DE" }],
    ADDRESS: [{ ID: 900, TENANT_ID: TENANT, ADDRESS_NAME_1: "Bestand GmbH", POST_CODE: "10115" }],
  });

  it("schreibt nur die neue Zeile, taggt sie mit Mandant und Stapel", async () => {
    const supabase = seed();
    const res = await run("address", await file(), supabase, { duplicateMode: "skip" });

    expect(res.inserted).toBe(1);
    expect(res.summary).toMatchObject({ total: 2, ok: 1, duplicate: 1, error: 0 });

    const added = supabase._tables.ADDRESS.filter(a => a.ADDRESS_NAME_1 === "Neu GmbH");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ TENANT_ID: TENANT, IMPORT_BATCH_ID: res.batchId, COUNTRY_ID: 1, POST_CODE: "10117" });
    // Bestand unangetastet
    expect(supabase._tables.ADDRESS).toHaveLength(2);

    const batch = supabase._tables.IMPORT_BATCH[0];
    expect(batch).toMatchObject({ TENANT_ID: TENANT, DOMAIN: "address", STATUS: "committed", CREATED_BY: EMPLOYEE });
  });

  it("importiert Dubletten auf Wunsch mit", async () => {
    const supabase = seed();
    const res = await run("address", await file(), supabase, { duplicateMode: "import" });
    expect(res.inserted).toBe(2);
  });

  it("rollback entfernt genau die importierten Zeilen", async () => {
    const supabase = seed();
    const { batchId } = await run("address", await file(), supabase, { duplicateMode: "skip" });

    const res = await rollback({ batchId, supabase, tenantId: TENANT });

    expect(res).toMatchObject({ rolledBack: true, deleted: 1 });
    expect(supabase._tables.ADDRESS).toHaveLength(1);
    expect(supabase._tables.ADDRESS[0].ID).toBe(900);
    expect(supabase._tables.IMPORT_BATCH[0].STATUS).toBe("rolled_back");
  });

  it("rollback blockiert, wenn Live-Daten an der importierten Adresse haengen", async () => {
    const supabase = seed();
    const { batchId } = await run("address", await file(), supabase, { duplicateMode: "skip" });
    const imported = supabase._tables.ADDRESS.find(a => a.ADDRESS_NAME_1 === "Neu GmbH");
    supabase._tables.PROJECT = [{ ID: 1, TENANT_ID: TENANT, ADDRESS_ID: imported.ID }];

    await expect(rollback({ batchId, supabase, tenantId: TENANT }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("Projekt(e)") });
    // nichts geloescht
    expect(supabase._tables.ADDRESS).toHaveLength(2);
  });

  it("weist einen zweiten Rollback desselben Stapels ab", async () => {
    const supabase = seed();
    const { batchId } = await run("address", await file(), supabase, { duplicateMode: "skip" });
    await rollback({ batchId, supabase, tenantId: TENANT });

    await expect(rollback({ batchId, supabase, tenantId: TENANT }))
      .rejects.toMatchObject({ status: 400 });
  });
});

// ── Zusammengesetzter Commit: Projekt-Honorar ─────────────────────────────────
describe("commit + rollback (project_fee)", () => {
  const file = () => fileOf([
    ["Projektnummer *", "Honorarsumme (netto) *", "Abrechnungsart (Pauschal/Stunden)"],
    ["P-1", "80.000,00", "Pauschal"],
  ]);

  const seed = () => makeFakeSupabase({
    PROJECT: [{ ID: 1, TENANT_ID: TENANT, NAME_SHORT: "P-1", NAME_LONG: "Projekt Eins", ADDRESS_ID: 11, CONTACT_ID: 21 }],
    PROJECT_STRUCTURE: [],
    TENANT_SETTINGS: [
      { TENANT_ID: TENANT, KEY: "default_vat_id", VALUE: "2" },
      { TENANT_ID: TENANT, KEY: "default_currency_id", VALUE: "1" },
    ],
  });

  it("legt Vertrag, Struktur und Fortschritt an — Struktur kennt den Vertrag", async () => {
    const supabase = seed();
    const res = await run("project_fee", await file(), supabase, { structureMode: "hoai" });

    expect(res.inserted).toBe(1);

    const contracts = supabase._tables.CONTRACT;
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({ PROJECT_ID: 1, TENANT_ID: TENANT, IMPORT_BATCH_ID: res.batchId, VAT_ID: 2, CURRENCY_ID: 1 });

    const nodes = supabase._tables.PROJECT_STRUCTURE;
    expect(nodes).toHaveLength(9);
    // Jeder Knoten haengt am Vertrag und traegt eine eigene Sortierung —
    // ohne SORT_ORDER stuenden alle auf 0 und die Reihenfolge waere zufaellig.
    expect(nodes.every(n => n.CONTRACT_ID === contracts[0].ID)).toBe(true);
    expect(nodes.map(n => n.SORT_ORDER)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
    expect(nodes.map(n => n.NAME_SHORT)).toEqual(["LP1", "LP2", "LP3", "LP4", "LP5", "LP6", "LP7", "LP8", "LP9"]);
    // Verteilung trifft die Honorarsumme exakt (Rundungsrest auf LP8).
    expect(nodes.reduce((s, n) => s + n.REVENUE, 0)).toBeCloseTo(80000, 2);

    expect(supabase._tables.PROJECT_PROGRESS).toHaveLength(9);
  });

  it("legt bei „single“ eine Position an und nutzt einen vorhandenen Vertrag weiter", async () => {
    const supabase = seed();
    supabase._tables.CONTRACT = [{ ID: 55, TENANT_ID: TENANT, PROJECT_ID: 1 }];

    await run("project_fee", await file(), supabase, { structureMode: "single" });

    expect(supabase._tables.CONTRACT).toHaveLength(1);          // kein zweiter Vertrag
    const nodes = supabase._tables.PROJECT_STRUCTURE;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ CONTRACT_ID: 55, SORT_ORDER: 0, REVENUE: 80000, BILLING_TYPE_ID: 1 });
  });

  it("rollback raeumt Fortschritt, Struktur und Vertrag ab", async () => {
    const supabase = seed();
    const { batchId } = await run("project_fee", await file(), supabase, { structureMode: "hoai" });

    await rollback({ batchId, supabase, tenantId: TENANT });

    expect(supabase._tables.PROJECT_STRUCTURE).toHaveLength(0);
    expect(supabase._tables.PROJECT_PROGRESS).toHaveLength(0);
    expect(supabase._tables.CONTRACT).toHaveLength(0);
  });

  it("rollback blockiert, wenn am Projekt schon gebucht wurde", async () => {
    const supabase = seed();
    const { batchId } = await run("project_fee", await file(), supabase, { structureMode: "hoai" });
    supabase._tables.TEC = [{ ID: 1, TENANT_ID: TENANT, PROJECT_ID: 1 }];

    await expect(rollback({ batchId, supabase, tenantId: TENANT }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("Buchung(en)") });
    expect(supabase._tables.PROJECT_STRUCTURE).toHaveLength(9);
  });
});

// ── Anfangsbestaende: der Mandant muss mitlaufen ──────────────────────────────
describe("commit (opening_balance)", () => {
  const file = () => fileOf([
    ["Projektnummer *", "Bereits berechnet (netto) *"],
    ["P-1", "30.000,00"],
  ]);

  const seed = () => makeFakeSupabase({
    PROJECT: [{ ID: 1, TENANT_ID: TENANT, NAME_SHORT: "P-1", NAME_LONG: "Projekt Eins", COMPANY_ID: 3, ADDRESS_ID: 11, CONTACT_ID: 21 }],
    CONTRACT: [{ ID: 31, TENANT_ID: TENANT, PROJECT_ID: 1, INVOICE_ADDRESS_ID: 11, INVOICE_CONTACT_ID: 21 }],
    PROJECT_STRUCTURE: [{ ID: 41, TENANT_ID: TENANT, PROJECT_ID: 1, BILLING_TYPE_ID: 1, REVENUE: 80000, EXTRAS_PERCENT: 0 }],
    // Belege, die die gemockte init-Funktion "erzeugt" haette:
    PARTIAL_PAYMENT: [{ ID: 500, TENANT_ID: TENANT, PROJECT_ID: 1, STATUS_ID: 0, VAT_PERCENT: 19 }],
    INVOICE: [{ ID: 600, TENANT_ID: TENANT, PROJECT_ID: 1, STATUS_ID: 0, VAT_PERCENT: 19 }],
  });

  it("reicht tenantId an initPartialPayment durch (Regression zu 13e88c4)", async () => {
    const supabase = seed();
    const res = await run("opening_balance", await file(), supabase, { docType: "partial" });

    expect(res.inserted).toBe(1);
    expect(ppSvc.initPartialPayment).toHaveBeenCalledTimes(1);
    expect(ppSvc.initPartialPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT, projectId: 1, contractId: 31 }),
    );
    // Beleg traegt den Stapel → Rollback kann ihn spaeter reversieren.
    expect(supabase._tables.PARTIAL_PAYMENT[0].IMPORT_BATCH_ID).toBe(res.batchId);
  });

  it("reicht tenantId an initInvoice durch", async () => {
    const supabase = seed();
    await run("opening_balance", await file(), supabase, { docType: "invoice" });

    expect(invSvc.initInvoice).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT, projectId: 1, contractId: 31 }),
    );
  });
});

// ── Kosten-Anfangsbestand ─────────────────────────────────────────────────────
describe("commit + rollback (opening_cost)", () => {
  const file = () => fileOf([
    ["Projektnummer *", "Bereits angefallene Kosten (netto) *", "Bezeichnung (optional)"],
    ["P-1", "45.000,00", "Personalkosten bis 06/2026"],
  ]);

  const seed = () => makeFakeSupabase({
    PROJECT: [{ ID: 1, TENANT_ID: TENANT, NAME_SHORT: "P-1" }],
    PROJECT_STRUCTURE: [{ ID: 41, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, BILLING_TYPE_ID: 2, EXTRAS_PERCENT: 0 }],
  });

  it("bucht einen Kostenblock auf den Blattknoten", async () => {
    const supabase = seed();
    const res = await run("opening_cost", await file(), supabase);

    expect(res.inserted).toBe(1);
    const tec = supabase._tables.TEC;
    expect(tec).toHaveLength(1);
    expect(tec[0]).toMatchObject({
      BOOKING_KIND: "LUMP_COST", STATUS: "CONFIRMED", STRUCTURE_ID: 41,
      QUANTITY_INT: 0, CP_TOT: 45000, IMPORT_BATCH_ID: res.batchId, TENANT_ID: TENANT,
    });
    // COSTS am Strukturknoten neu gerechnet
    expect(supabase._tables.PROJECT_STRUCTURE[0].COSTS).toBe(45000);
  });

  it("rollback entfernt die Buchung und rechnet die Kosten zurueck", async () => {
    const supabase = seed();
    const { batchId } = await run("opening_cost", await file(), supabase);

    const res = await rollback({ batchId, supabase, tenantId: TENANT });

    expect(res).toMatchObject({ rolledBack: true, deleted: 1 });
    expect(supabase._tables.TEC).toHaveLength(0);
    expect(supabase._tables.PROJECT_STRUCTURE[0].COSTS).toBe(0);
  });
});

// ── Fehlerprotokoll ───────────────────────────────────────────────────────────
describe("errorReport", () => {
  const seed = () => makeFakeSupabase({
    COUNTRY: [{ ID: 1, NAME_LONG: "Deutschland", NAME_SHORT: "DE" }],
    ADDRESS: [],
  });

  it("liefert genau die fehlerhaften Zeilen samt Grund und bleibt wieder hochladbar", async () => {
    const buffer = await fileOf([
      ["Name 1 (Firma/Nachname) *", "PLZ", "Land"],
      ["Gut GmbH", "10117", "Deutschland"],
      ["", "10118", "Deutschland"],                 // Pflichtfeld fehlt
      ["Falsches Land GmbH", "10119", "Atlantis"],  // Land nicht auflösbar
    ]);

    const rep = await errorReport({ domainKey: "address", buffer, mapping: null, supabase: seed(), tenantId: TENANT });
    expect(rep.count).toBe(2);
    expect(rep.filename).toContain("Fehler");

    // Das Protokoll ist selbst wieder eine gueltige Importdatei: Originalspalten
    // unveraendert, dahinter Zeile + Fehler.
    const back = await parseBuffer(rep.buffer);
    expect(back.headers).toEqual(["Name 1 (Firma/Nachname) *", "PLZ", "Land", "Zeile", "Fehler"]);
    expect(back.rows).toHaveLength(2);
    expect(back.rows[0]).toMatchObject({ PLZ: "10118", Zeile: 3 });
    expect(back.rows[0]["Fehler"]).toContain("Name 1 fehlt");
    expect(back.rows[1]["Fehler"]).toContain("Atlantis");

    // Korrigiert man die Datei, laesst sie sich unveraendert importieren —
    // die Zusatzspalten stoeren die Zuordnung nicht.
    const supabase = seed();
    const fixed = await fileOf([
      ["Name 1 (Firma/Nachname) *", "PLZ", "Land", "Zeile", "Fehler"],
      ["Jetzt Richtig GmbH", "10118", "Deutschland", 3, "Name 1 fehlt (Pflichtfeld)"],
    ]);
    const res = await run("address", fixed, supabase);
    expect(res.inserted).toBe(1);
    expect(supabase._tables.ADDRESS[0].ADDRESS_NAME_1).toBe("Jetzt Richtig GmbH");
  });

  it("sagt Bescheid, wenn es nichts zu korrigieren gibt", async () => {
    const buffer = await fileOf([
      ["Name 1 (Firma/Nachname) *", "PLZ"],
      ["Gut GmbH", "10117"],
    ]);
    await expect(errorReport({ domainKey: "address", buffer, mapping: null, supabase: seed(), tenantId: TENANT }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("Keine fehlerhaften Zeilen") });
  });
});

// ── Leere/unbrauchbare Dateien ────────────────────────────────────────────────
describe("commit ohne importierbare Zeilen", () => {
  it("legt keinen Stapel an, wenn nur Fehlerzeilen kommen", async () => {
    const supabase = makeFakeSupabase({ COUNTRY: [{ ID: 1, NAME_LONG: "Deutschland", NAME_SHORT: "DE" }], ADDRESS: [] });
    const buffer = await fileOf([["Name 1 (Firma/Nachname) *", "PLZ"], ["", "10117"]]);

    await expect(run("address", buffer, supabase)).rejects.toMatchObject({ status: 400 });
    expect(supabase._tables.IMPORT_BATCH).toBeUndefined();
  });
});
