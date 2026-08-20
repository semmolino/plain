"use strict";

// Assistenten-Funktionen, die jeden Import betreffen:
// Zuordnung merken, Zeilen abwaehlen, Dubletten zusammenfuehren (umkehrbar).

const { commit, preview, rollback } = require("../services/importService");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { xlsxBuffer } = require("./helpers/sheetFixture");

const TENANT = 7;
const EMPLOYEE = 99;

const seed = (extra = {}) => makeFakeSupabase({
  COUNTRY: [{ ID: 1, NAME_LONG: "Deutschland", NAME_SHORT: "DE" }],
  ADDRESS: [
    { ID: 900, TENANT_ID: TENANT, ADDRESS_NAME_1: "Bestand GmbH", POST_CODE: "10115", CITY: "Berlin", EMAIL: null, PHONE: "030 111", STREET: "Altstr. 1" },
  ],
  ...extra,
});

const runPreview = (buffer, supabase, mapping = null) =>
  preview({ domainKey: "address", buffer, filename: "a.xlsx", mapping, supabase, tenantId: TENANT });

const runCommit = (buffer, supabase, opts = {}) =>
  commit({ domainKey: "address", buffer, filename: "a.xlsx", mapping: null, supabase, tenantId: TENANT, employeeId: EMPLOYEE, ...opts });

// ── Zuordnung merken ──────────────────────────────────────────────────────────
describe("Spaltenzuordnung merken", () => {
  it("schlaegt beim naechsten Mal die Zuordnung des letzten Imports vor", async () => {
    const supabase = seed();
    // Eigenwillige Ueberschriften, die die Automatik NICHT trifft.
    const datei = () => xlsxBuffer([
      ["Bezeichnung des Kunden", "Postleitzahl", "Ort"],
      ["Neu GmbH", "10117", "Berlin"],
    ]);

    // Erster Lauf: Automatik findet den Namen nicht, der Nutzer ordnet zu.
    const auto = await runPreview(await datei(), supabase);
    expect(auto.mappingSource).toBe("auto");
    expect(auto.mapping.address_name_1).toBeUndefined();

    const handzuordnung = { ...auto.mapping, address_name_1: "Bezeichnung des Kunden" };
    await commit({ domainKey: "address", buffer: await datei(), filename: "a.xlsx", mapping: handzuordnung, supabase, tenantId: TENANT, employeeId: EMPLOYEE });

    // Zweiter Lauf ohne Zuordnung: die gemerkte greift.
    const zweiter = await runPreview(await datei(), supabase);
    expect(zweiter.mappingSource).toBe("remembered");
    expect(zweiter.mapping.address_name_1).toBe("Bezeichnung des Kunden");
  });

  it("ignoriert eine gemerkte Zuordnung, deren Spalten es nicht mehr gibt", async () => {
    const supabase = seed();
    supabase._tables.IMPORT_BATCH = [{
      ID: 1, TENANT_ID: TENANT, DOMAIN: "address", STATUS: "committed",
      MAPPING_JSON: { address_name_1: "Gibt es nicht mehr" }, CREATED_AT: "2026-01-01",
    }];

    const pv = await runPreview(await xlsxBuffer([
      ["Name 1 (Firma/Nachname) *", "PLZ"],
      ["Neu GmbH", "10117"],
    ]), supabase);

    expect(pv.mappingSource).toBe("auto");
    expect(pv.mapping.address_name_1).toBe("Name 1 (Firma/Nachname) *");
  });
});

// ── Zeilen abwaehlen ──────────────────────────────────────────────────────────
describe("Zeilen abwaehlen", () => {
  const datei = () => xlsxBuffer([
    ["Name 1 (Firma/Nachname) *", "PLZ"],
    ["Eins GmbH",  "10117"],   // Zeile 2
    ["Zwei GmbH",  "10118"],   // Zeile 3
    ["Drei GmbH",  "10119"],   // Zeile 4
  ]);

  it("laesst abgewaehlte Zeilen aus", async () => {
    const supabase = seed();
    const res = await runCommit(await datei(), supabase, { excludeRows: [3] });

    expect(res.inserted).toBe(2);
    const namen = supabase._tables.ADDRESS.map((a) => a.ADDRESS_NAME_1);
    expect(namen).toContain("Eins GmbH");
    expect(namen).toContain("Drei GmbH");
    expect(namen).not.toContain("Zwei GmbH");
  });

  it("meldet sich, wenn alles abgewaehlt wurde", async () => {
    const supabase = seed();
    await expect(runCommit(await datei(), supabase, { excludeRows: [2, 3, 4] }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("abgewählt") });
    expect(supabase._tables.IMPORT_BATCH).toBeUndefined();
  });
});

// ── Dubletten zusammenfuehren ─────────────────────────────────────────────────
describe("Dubletten zusammenfuehren", () => {
  const datei = () => xlsxBuffer([
    ["Name 1 (Firma/Nachname) *", "PLZ", "Ort", "E-Mail", "Telefon"],
    ["Bestand GmbH", "10115", "Berlin", "neu@bestand.de", ""],   // Dublette: ergaenzt Mail
    ["Neu GmbH",     "10117", "Berlin", "", ""],                 // echte Neuanlage
  ]);

  it("ergaenzt den Bestand, statt einen zweiten Datensatz anzulegen", async () => {
    const supabase = seed();
    const res = await runCommit(await datei(), supabase, { duplicateMode: "merge" });

    expect(res).toMatchObject({ inserted: 1, merged: 1 });
    expect(supabase._tables.ADDRESS).toHaveLength(2);           // kein dritter Datensatz

    const bestand = supabase._tables.ADDRESS.find((a) => a.ID === 900);
    expect(bestand.EMAIL).toBe("neu@bestand.de");               // war leer → ergaenzt
    expect(bestand.PHONE).toBe("030 111");                      // Datei leer → Bestand bleibt
    expect(bestand.STREET).toBe("Altstr. 1");
  });

  it("laesst den Bestand in Ruhe, wenn Dubletten uebersprungen werden", async () => {
    const supabase = seed();
    const res = await runCommit(await datei(), supabase, { duplicateMode: "skip" });

    expect(res.inserted).toBe(1);
    expect(supabase._tables.ADDRESS.find((a) => a.ID === 900).EMAIL).toBeNull();
  });

  it("macht auch ein Zusammenfuehren wieder rueckgaengig", async () => {
    const supabase = seed();
    const { batchId } = await runCommit(await datei(), supabase, { duplicateMode: "merge" });

    const res = await rollback({ batchId, supabase, tenantId: TENANT });

    expect(res.restored).toBe(1);
    const bestand = supabase._tables.ADDRESS.find((a) => a.ID === 900);
    expect(bestand.EMAIL).toBeNull();                           // alter Stand wieder da
    expect(bestand.PHONE).toBe("030 111");
    // Die neu angelegte Adresse ist weg, der Bestand bleibt.
    expect(supabase._tables.ADDRESS).toHaveLength(1);
  });

  it("bietet das Zusammenfuehren nur an, wo es sinnvoll ist", async () => {
    const supabase = seed();
    const pv = await runPreview(await datei(), supabase);
    expect(pv.mergeable).toBe(true);

    const struktur = await preview({
      domainKey: "project_structure",
      buffer: await xlsxBuffer([["Projektnummer *", "Gliederung *", "Kürzel *"], ["P-1", "1", "LB"]]),
      filename: "s.xlsx", mapping: null,
      supabase: makeFakeSupabase({ PROJECT: [], PROJECT_STRUCTURE: [], CONTRACT: [], TENANT_SETTINGS: [] }),
      tenantId: TENANT,
    });
    expect(struktur.mergeable).toBe(false);
  });
});
