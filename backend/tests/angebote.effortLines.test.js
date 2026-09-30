"use strict";

// Aufwandszeilen im Angebot (Migration 0173, UI-Pilot Runde 5): ein Element
// nach Aufwand traegt mehrere Zeilen Rolle · Stunden · Satz, sein Honorar ist
// die Summe. Die Einzelspalten werden daraus abgeleitet; Altbestand ohne
// Zeilen gilt als eine Zeile.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { normalizeEffortLines, effortColumns, nodeEffortLines } = require("../services/effortLines");
const svc = require("../services/angebote");

const T = 7;

describe("Aufwandszeilen: Regeln", () => {
  test("leere Zeilen fallen weg, Zahlen werden gerundet", () => {
    const lines = normalizeEffortLines([
      { role_id: 3, role_abbr: "PL", role_name: "Projektleitung", hours: "8", rate: 120 },
      { role_id: null, hours: 0, rate: 0 },
      { role_abbr: "BZ", hours: "16,5", rate: "85.004" },
    ]);
    expect(lines).toEqual([
      { role_id: 3, role_abbr: "PL", role_name: "Projektleitung", hours: 8, rate: 120 },
      { role_id: null, role_abbr: "BZ", role_name: null, hours: 16.5, rate: 85 },
    ]);
  });

  test("negative oder unsinnige Werte werden abgewiesen", () => {
    expect(() => normalizeEffortLines([{ hours: -1, rate: 10 }])).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => normalizeEffortLines([{ hours: "abc", rate: 10 }])).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => normalizeEffortLines({ hours: 1 })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => normalizeEffortLines(Array.from({ length: 31 }, () => ({ hours: 1, rate: 1 })))).toThrow(expect.objectContaining({ status: 400 }));
  });

  test("abgeleitete Spalten: Summe der Stunden, Satz und Rolle nur bei einer Zeile", () => {
    const one = effortColumns([{ role_id: 3, role_abbr: "PL", role_name: "Projektleitung", hours: 8, rate: 120 }]);
    expect(one).toMatchObject({ QUANTITY: 8, HOURLY_RATE: 120, ROLE_ID: 3, ROLE_ABBR: "PL", basis: 960 });
    const two = effortColumns([
      { role_id: 3, role_abbr: "PL", role_name: null, hours: 8, rate: 120 },
      { role_id: 4, role_abbr: "BZ", role_name: null, hours: 16, rate: 85 },
    ]);
    expect(two).toMatchObject({ QUANTITY: 24, HOURLY_RATE: null, ROLE_ID: null, ROLE_ABBR: null, basis: 2320 });
    expect(effortColumns([])).toMatchObject({ EFFORT_LINES: null, QUANTITY: 0, HOURLY_RATE: 0, basis: 0 });
  });

  test("Altbestand ohne Zeilen gilt als eine Zeile", () => {
    expect(nodeEffortLines({ QUANTITY: 24, HOURLY_RATE: 95, ROLE_ID: 2, ROLE_ABBR: "PL", ROLE_NAME: "Projektleitung" }))
      .toEqual([{ role_id: 2, role_abbr: "PL", role_name: "Projektleitung", hours: 24, rate: 95 }]);
    expect(nodeEffortLines({ QUANTITY: null, HOURLY_RATE: null, ROLE_ID: null })).toEqual([]);
  });
});

function setup(extra = []) {
  const OFFER = { ID: 1, TENANT_ID: T, ABBR: "A-1", NAME: "Test", SURCHARGES_TOTAL: 0 };
  const STRUCT = [
    { ID: 10, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: null, BILLING_TYPE_ID: 2, ABBR: "BL", REVENUE: 2280, REVENUE_BASIS: 2280, EXTRAS: 0, EXTRAS_PERCENT: 0, SURCHARGES_TOTAL: 0 },
    // Altbestand: eine Rolle ueber die Einzelspalten
    { ID: 11, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: 10, BILLING_TYPE_ID: 2, ABBR: "BL1", QUANTITY: 24, HOURLY_RATE: 95, ROLE_ID: 2, ROLE_ABBR: "PL", ROLE_NAME: "Projektleitung", REVENUE: 2280, REVENUE_BASIS: 2280, EXTRAS: 0, EXTRAS_PERCENT: 0, SURCHARGES_TOTAL: 0, EFFORT_LINES: null },
    ...extra,
  ];
  return makeFakeSupabase({ OFFER: [OFFER], OFFER_STRUCTURE: STRUCT });
}
const row = (sb, id) => sb._tables.OFFER_STRUCTURE.find(r => r.ID === id);

describe("Aufwandszeilen: Speichern", () => {
  test("mehrere Zeilen: Honorar ist die Summe, Vater und Angebot rechnen nach", async () => {
    const sb = setup();
    await svc.updateOfferStructureNode(sb, { tenantId: T, nodeId: 11, body: { effort_lines: [
      { role_id: 2, role_abbr: "PL", role_name: "Projektleitung", hours: 8, rate: 120 },
      { role_id: 4, role_abbr: "BZ", role_name: "Bauzeichnung", hours: 16, rate: 85 },
    ] } });
    const n = row(sb, 11);
    expect(n.EFFORT_LINES).toHaveLength(2);
    expect(n.QUANTITY).toBe(24);
    expect(n.HOURLY_RATE).toBeNull();
    expect(n.ROLE_ID).toBeNull();
    expect(n.REVENUE_BASIS).toBe(960 + 1360);
    expect(n.REVENUE).toBe(2320);
    expect(row(sb, 10).REVENUE).toBe(2320);
  });

  test("Einzelfelder am Altbestand schreiben eine Zeile", async () => {
    const sb = setup();
    await svc.updateOfferStructureNode(sb, { tenantId: T, nodeId: 11, body: { quantity: 30 } });
    const n = row(sb, 11);
    expect(n.EFFORT_LINES).toEqual([{ role_id: 2, role_abbr: "PL", role_name: "Projektleitung", hours: 30, rate: 95 }]);
    expect(n.REVENUE_BASIS).toBe(2850);
  });

  test("Einzelfelder bei mehreren Zeilen: 409 statt still eine Rolle zu verlieren", async () => {
    const sb = setup();
    await svc.updateOfferStructureNode(sb, { tenantId: T, nodeId: 11, body: { effort_lines: [
      { role_abbr: "PL", hours: 8, rate: 120 }, { role_abbr: "BZ", hours: 16, rate: 85 },
    ] } });
    await expect(svc.updateOfferStructureNode(sb, { tenantId: T, nodeId: 11, body: { quantity: 5 } }))
      .rejects.toMatchObject({ status: 409 });
    expect(row(sb, 11).EFFORT_LINES).toHaveLength(2);
  });

  test("Wechsel auf Pauschal entfernt die Zeilen", async () => {
    const sb = setup();
    await svc.updateOfferStructureNode(sb, { tenantId: T, nodeId: 11, body: { billing_type_id: 1, revenue: 5000 } });
    const n = row(sb, 11);
    expect(n.EFFORT_LINES).toBeNull();
    expect(n.REVENUE_BASIS).toBe(5000);
  });

  test("Zeilen an einem Pauschal-Element werden abgewiesen", async () => {
    const sb = setup([{ ID: 12, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: null, BILLING_TYPE_ID: 1, ABBR: "LP1", REVENUE: 1000, REVENUE_BASIS: 1000, EXTRAS: 0, EXTRAS_PERCENT: 0, SURCHARGES_TOTAL: 0 }]);
    await expect(svc.updateOfferStructureNode(sb, { tenantId: T, nodeId: 12, body: { effort_lines: [{ hours: 1, rate: 1 }] } }))
      .rejects.toMatchObject({ status: 400 });
  });

  test("Anlegen mit Zeilen", async () => {
    const sb = setup();
    const created = await svc.addOfferStructureNode(sb, { tenantId: T, offerId: 1, body: {
      abbr: "BL2", billing_type_id: 2, father_id: 10,
      effort_lines: [{ role_abbr: "PL", hours: 2, rate: 120 }, { role_abbr: "BZ", hours: 4, rate: 85 }],
    } });
    expect(created.EFFORT_LINES).toHaveLength(2);
    expect(created.REVENUE).toBe(580);
    expect(row(sb, 10).REVENUE).toBe(2280 + 580);
  });
});

describe("Aufwandszeilen im Angebots-PDF", () => {
  test("jede Zeile einzeln, Altbestand als eine Zeile", async () => {
    const sb = setup([{ ID: 13, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: 10, BILLING_TYPE_ID: 2, ABBR: "BL2", SORT_ORDER: 5,
      EFFORT_LINES: [{ role_id: 2, role_abbr: "PL", role_name: "Projektleitung", hours: 8, rate: 120 },
                     { role_id: 4, role_abbr: "BZ", role_name: null, hours: 16, rate: 85 }],
      QUANTITY: 24, HOURLY_RATE: null, REVENUE: 2320, REVENUE_BASIS: 2320, EXTRAS: 0, EXTRAS_PERCENT: 0, SURCHARGES_TOTAL: 0 }]);
    const vm = await svc.buildOfferPdfViewModel(sb, { offerId: 1, tenantId: T });
    const byAbbr = Object.fromEntries(vm.structureRows.map(r => [r.nameShort, r]));
    expect(byAbbr.BL1.effortLines).toEqual([{ hours: 24, rate: 95, amount: 2280, roleName: "Projektleitung" }]);
    expect(byAbbr.BL2.effortLines).toEqual([
      { hours: 8, rate: 120, amount: 960, roleName: "Projektleitung" },
      { hours: 16, rate: 85, amount: 1360, roleName: "BZ" },
    ]);
  });
});
