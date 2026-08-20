"use strict";

// Baum-Import (Domaene project_structure): Hierarchie aus der Gliederungs-
// nummer, Geld nur an den Blaettern, Elternwerte aus den Kindern gerechnet.
// Ein halb importierter Baum waere schlimmer als keiner - deshalb faellt bei
// einem Fehler das ganze Projekt aus. Genau das haelt dieser Test fest.

const { commit, rollback, preview, parseBuffer, buildStructurePrefill } = require("../services/importService");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { xlsxBuffer } = require("./helpers/sheetFixture");

const TENANT = 7;
const EMPLOYEE = 99;
const HEAD = [
  "Projektnummer *", "Gliederung *", "Kürzel *", "Bezeichnung",
  "Abrechnungsart (Pauschal/Stunden)", "Honorar netto", "Nebenkosten %", "Ebene (nur ohne Gliederung)",
];

/** Zeile bauen: [Projekt, Gliederung, Kuerzel, Bezeichnung, Abrechnung, Honorar, NK, Ebene] */
const row = (...cells) => { const r = [...cells]; while (r.length < HEAD.length) r.push(""); return r; };

const seed = (extra = {}) => makeFakeSupabase({
  PROJECT: [
    { ID: 1, TENANT_ID: TENANT, NAME_SHORT: "P-1", NAME_LONG: "Projekt Eins", ADDRESS_ID: 11, CONTACT_ID: 21 },
    { ID: 2, TENANT_ID: TENANT, NAME_SHORT: "P-2", NAME_LONG: "Projekt Zwei" },
  ],
  PROJECT_STRUCTURE: [],
  CONTRACT: [],
  TENANT_SETTINGS: [{ TENANT_ID: TENANT, KEY: "default_vat_id", VALUE: "2" }],
  ...extra,
});

const runCommit = (buffer, supabase, opts = {}) =>
  commit({ domainKey: "project_structure", buffer, filename: "baum.xlsx", mapping: null, supabase, tenantId: TENANT, employeeId: EMPLOYEE, ...opts });

const runPreview = (buffer, supabase) =>
  preview({ domainKey: "project_structure", buffer, filename: "baum.xlsx", mapping: null, supabase, tenantId: TENANT });

/** Der Beispielbaum: 1 (mit 1.1/1.2/1.3) + 2 als Stunden-Position. */
const baum = () => xlsxBuffer([
  HEAD,
  row("P-1", "1",   "LB",    "Leistungsbild Gebäude", "",         "",      "5"),
  row("P-1", "1.1", "LP1-4", "Vorplanung",            "Pauschal", "27000"),
  row("P-1", "1.2", "LP5",   "Ausführungsplanung",    "Pauschal", "25000"),
  row("P-1", "1.3", "LP6-8", "Bauüberwachung",        "Pauschal", "28000"),
  row("P-1", "2",   "BL",    "Besondere Leistungen",  "Stunden"),
]);

// ── Aufbau ────────────────────────────────────────────────────────────────────
describe("Baum anlegen", () => {
  it("setzt FATHER_ID aus der Gliederung und sortiert die Geschwister", async () => {
    const supabase = seed();
    const res = await runCommit(await baum(), supabase);

    expect(res.inserted).toBe(5);
    const nodes = supabase._tables.PROJECT_STRUCTURE;
    const by = (k) => nodes.find((n) => n.NAME_SHORT === k);

    expect(by("LB").FATHER_ID).toBeNull();
    expect(by("BL").FATHER_ID).toBeNull();
    expect(by("LP1-4").FATHER_ID).toBe(by("LB").ID);
    expect(by("LP5").FATHER_ID).toBe(by("LB").ID);
    expect(by("LP6-8").FATHER_ID).toBe(by("LB").ID);

    // Geschwister in Zehnerschritten, in der Reihenfolge der Gliederung
    expect([by("LB").SORT_ORDER, by("BL").SORT_ORDER]).toEqual([0, 10]);
    expect([by("LP1-4").SORT_ORDER, by("LP5").SORT_ORDER, by("LP6-8").SORT_ORDER]).toEqual([0, 10, 20]);
  });

  it("rechnet den Elternwert aus den Kindern statt ihn zu uebernehmen", async () => {
    const supabase = seed();
    await runCommit(await baum(), supabase);
    const lb = supabase._tables.PROJECT_STRUCTURE.find((n) => n.NAME_SHORT === "LB");

    expect(lb.REVENUE).toBe(80000);          // 27000 + 25000 + 28000
    expect(lb.REVENUE_BASIS).toBe(80000);
    expect(lb.EXTRAS_PERCENT).toBe(5);
  });

  it("gibt jedem Knoten eine Fortschrittszeile und haengt alles an einen Vertrag", async () => {
    const supabase = seed();
    const res = await runCommit(await baum(), supabase);

    expect(supabase._tables.PROJECT_PROGRESS).toHaveLength(5);
    const contracts = supabase._tables.CONTRACT;
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({ PROJECT_ID: 1, VAT_ID: 2, IMPORT_BATCH_ID: res.batchId });
    expect(supabase._tables.PROJECT_STRUCTURE.every((n) => n.CONTRACT_ID === contracts[0].ID)).toBe(true);
  });

  it("nutzt einen vorhandenen Vertrag weiter", async () => {
    const supabase = seed({ CONTRACT: [{ ID: 55, TENANT_ID: TENANT, PROJECT_ID: 1 }] });
    await runCommit(await baum(), supabase);

    expect(supabase._tables.CONTRACT).toHaveLength(1);
    expect(supabase._tables.PROJECT_STRUCTURE.every((n) => n.CONTRACT_ID === 55)).toBe(true);
  });

  it("liest die Hierarchie ersatzweise aus der Ebenen-Spalte", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "", "LB",    "Leistungsbild", "",         "",      "", "1"),
      row("P-1", "", "LP1-4", "Vorplanung",    "Pauschal", "27000", "", "2"),
      row("P-1", "", "LP5",   "Ausführung",    "Pauschal", "25000", "", "2"),
    ]);

    await runCommit(buffer, supabase);
    const nodes = supabase._tables.PROJECT_STRUCTURE;
    const lb = nodes.find((n) => n.NAME_SHORT === "LB");
    expect(nodes.filter((n) => n.FATHER_ID === lb.ID)).toHaveLength(2);
    expect(lb.REVENUE).toBe(52000);
  });

  it("verarbeitet mehrere Projekte in einer Datei", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "1",   "LB",  "Leistungsbild", ""),
      row("P-1", "1.1", "LP1", "Grundlagen",    "Pauschal", "1000"),
      row("P-2", "1",   "LB",  "Leistungsbild", ""),
      row("P-2", "1.1", "LP1", "Grundlagen",    "Pauschal", "2000"),
    ]);

    await runCommit(buffer, supabase);
    const roots = supabase._tables.PROJECT_STRUCTURE.filter((n) => n.FATHER_ID === null);
    expect(roots.map((r) => r.REVENUE).sort((a, b) => a - b)).toEqual([1000, 2000]);
  });
});

// ── Geld an der richtigen Stelle ──────────────────────────────────────────────
describe("Honorar", () => {
  it("ignoriert einen Betrag auf einer uebergeordneten Zeile und sagt es", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "1",   "LB",  "Leistungsbild", "",         "99999"),   // wird ignoriert
      row("P-1", "1.1", "LP1", "Grundlagen",    "Pauschal", "1000"),
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("aus den Unterzeilen gerechnet");

    await runCommit(buffer, supabase);
    expect(supabase._tables.PROJECT_STRUCTURE.find((n) => n.NAME_SHORT === "LB").REVENUE).toBe(1000);
  });

  it("nullt das Honorar von Stunden-Positionen", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "1", "BL", "Besondere Leistungen", "Stunden", "5000"),
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.summary.warning).toBe(1);

    await runCommit(buffer, supabase);
    expect(supabase._tables.PROJECT_STRUCTURE[0]).toMatchObject({ BILLING_TYPE_ID: 2, REVENUE: 0 });
  });

  it("rechnet die Nebenkosten je Blatt", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "1", "LP1", "Grundlagen", "Pauschal", "1000", "10"),
    ]);

    await runCommit(buffer, supabase);
    expect(supabase._tables.PROJECT_STRUCTURE[0]).toMatchObject({ REVENUE: 1000, EXTRAS_PERCENT: 10, EXTRAS: 100 });
  });
});

// ── Fehlerfaelle ──────────────────────────────────────────────────────────────
describe("Pruefung", () => {
  it("verwirft das GANZE Projekt, wenn eine Zeile fehlerhaft ist", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "1",   "LB",  "Leistungsbild", ""),
      row("P-1", "1.1", "LP1", "Grundlagen",    "Pauschal", "1000"),
      row("P-1", "1.2", "",    "Ohne Kürzel",   "Pauschal", "2000"),   // Pflichtfeld fehlt
      row("P-2", "1",   "LP1", "Grundlagen",    "Pauschal", "3000"),   // anderes Projekt bleibt gueltig
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.summary.error).toBe(3);           // alle drei Zeilen von P-1
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("wird übersprungen");

    const res = await runCommit(buffer, supabase);
    expect(res.inserted).toBe(1);
    expect(supabase._tables.PROJECT_STRUCTURE.every((n) => n.PROJECT_ID === 2)).toBe(true);
  });

  it("meldet eine fehlende uebergeordnete Zeile", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "1",     "LB",  "Leistungsbild", ""),
      row("P-1", "1.1.1", "LP1", "Zu tief",       "Pauschal", "1000"),  // 1.1 fehlt
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.summary.error).toBe(2);
    expect(pv.rows.map((r) => r.messages.map((m) => m.text).join()).join()).toContain("fehlt in der Datei");
  });

  it("meldet doppelte Gliederungsnummern im selben Projekt", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "1", "LP1", "Erste",  "Pauschal", "1000"),
      row("P-1", "1", "LP2", "Zweite", "Pauschal", "2000"),
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows.map((r) => r.messages.map((m) => m.text).join()).join()).toContain("mehrfach vor");
    expect(pv.summary.error).toBe(2);
  });

  it("verlangt die Abrechnungsart an der untersten Ebene", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([
      HEAD,
      row("P-1", "1", "LP1", "Ohne Abrechnungsart", "", "1000"),
    ]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.summary.error).toBe(1);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("Abrechnungsart fehlt");
  });

  it("meldet ein unbekanntes Projekt", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([HEAD, row("P-999", "1", "LP1", "Grundlagen", "Pauschal", "1000")]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("nicht gefunden");
  });

  it("ueberspringt Projekte, die schon eine Struktur haben", async () => {
    const supabase = seed({ PROJECT_STRUCTURE: [{ ID: 900, TENANT_ID: TENANT, PROJECT_ID: 1, NAME_SHORT: "alt" }] });
    const pv = await runPreview(await baum(), supabase);

    expect(pv.summary.duplicate).toBe(5);
    expect(pv.summary.ok + pv.summary.warning).toBe(0);
  });

  it("begrenzt die Tiefe", async () => {
    const supabase = seed();
    const buffer = await xlsxBuffer([HEAD, row("P-1", "1.1.1.1.1.1", "X", "Zu tief", "Pauschal", "1")]);

    const pv = await runPreview(buffer, supabase);
    expect(pv.rows[0].messages.map((m) => m.text).join()).toContain("maximal 5");
  });
});

// ── Vorbefuellte Vorlage ──────────────────────────────────────────────────────
describe("Vorbefuellte Strukturvorlage", () => {
  it("enthaelt jedes Projekt ohne Struktur mit LB + LP1-9", async () => {
    const supabase = seed({
      PROJECT_STRUCTURE: [{ ID: 900, TENANT_ID: TENANT, PROJECT_ID: 2 }],   // P-2 ist schon versorgt
    });

    const res = await buildStructurePrefill({ supabase, tenantId: TENANT });
    expect(res).toMatchObject({ projects: 1, rows: 10 });                    // 1 Leistungsbild + 9 Phasen

    const daten = await parseBuffer(res.buffer);
    expect(daten.rows).toHaveLength(10);
    expect(daten.rows.every((r) => r["Projektnummer *"] === "P-1")).toBe(true);
    expect(daten.rows.map((r) => r["Gliederung *"])).toEqual(["1", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9"]);
    // Das Leistungsbild traegt keine Abrechnungsart (es ist kein Blatt), die Phasen schon.
    expect(daten.rows[0]["Abrechnungsart (Pauschal/Stunden)"]).toBe("");
    expect(daten.rows[1]["Abrechnungsart (Pauschal/Stunden)"]).toBe("Pauschal");
  });

  it("laesst sich mit ergaenzten Betraegen direkt wieder importieren", async () => {
    const supabase = seed();
    const res = await buildStructurePrefill({ supabase, tenantId: TENANT });
    const daten = await parseBuffer(res.buffer);

    // Der Nutzer traegt Betraege ein und laedt dieselbe Datei wieder hoch.
    const gefuellt = [daten.headers];
    daten.rows.forEach((r, i) => {
      const cells = daten.headers.map((h) => r[h] ?? "");
      if (i > 0 && r["Projektnummer *"] === "P-1") cells[daten.headers.indexOf("Honorar netto")] = 1000;
      gefuellt.push(cells);
    });

    const commitRes = await runCommit(await xlsxBuffer(gefuellt), supabase);

    // 2 Projekte je 10 Zeilen
    expect(commitRes.inserted).toBe(20);
    const nodes = supabase._tables.PROJECT_STRUCTURE;
    const lbP1 = nodes.find((n) => n.PROJECT_ID === 1 && n.FATHER_ID === null);
    expect(nodes.filter((n) => n.FATHER_ID === lbP1.ID)).toHaveLength(9);
    expect(lbP1.REVENUE).toBe(9000);                                        // 9 × 1.000
  });

  it("sagt Bescheid, wenn jedes Projekt schon eine Struktur hat", async () => {
    const supabase = seed({
      PROJECT_STRUCTURE: [
        { ID: 900, TENANT_ID: TENANT, PROJECT_ID: 1 },
        { ID: 901, TENANT_ID: TENANT, PROJECT_ID: 2 },
      ],
    });
    await expect(buildStructurePrefill({ supabase, tenantId: TENANT }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("bereits eine Leistungsstruktur") });
  });
});

// ── Rollback ──────────────────────────────────────────────────────────────────
describe("Rollback", () => {
  it("entfernt Struktur, Fortschritt und Vertrag", async () => {
    const supabase = seed();
    const { batchId } = await runCommit(await baum(), supabase);

    await rollback({ batchId, supabase, tenantId: TENANT });

    expect(supabase._tables.PROJECT_STRUCTURE).toHaveLength(0);
    expect(supabase._tables.PROJECT_PROGRESS).toHaveLength(0);
    expect(supabase._tables.CONTRACT).toHaveLength(0);
  });

  it("blockiert, sobald am Projekt gebucht wurde", async () => {
    const supabase = seed();
    const { batchId } = await runCommit(await baum(), supabase);
    supabase._tables.TEC = [{ ID: 1, TENANT_ID: TENANT, PROJECT_ID: 1 }];

    await expect(rollback({ batchId, supabase, tenantId: TENANT }))
      .rejects.toMatchObject({ status: 409 });
    expect(supabase._tables.PROJECT_STRUCTURE).toHaveLength(5);
  });
});
