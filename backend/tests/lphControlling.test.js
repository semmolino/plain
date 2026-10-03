"use strict";

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { loadPhaseFacts, phaseKey } = require("../services/lphControlling");

const T = 1;
const F = 2;

/**
 * Projekt 10: Gebäude (HOAI 2021, Zone III) mit LPH 3, deren Knoten das Büro
 * in „Entwurf" umbenannt hat, und Geotechnik (Teilleistung „TL a").
 * Projekt 11: Gebäude nach HOAI 2013 (Zone IV) und Bebauungsplan — beide mit
 * einer „LPH 3", die nicht dasselbe ist.
 */
function welt() {
  return makeFakeSupabase({
    PROJECT_STRUCTURE: [
      { ID: 100, TENANT_ID: T, PROJECT_ID: 10, FATHER_ID: null, ABBR: "Entwurf", FEE_CALC_PHASE_ID: 501 },
      { ID: 101, TENANT_ID: T, PROJECT_ID: 10, FATHER_ID: 100, ABBR: "3.1" },
      { ID: 102, TENANT_ID: T, PROJECT_ID: 10, FATHER_ID: 100, ABBR: "3.2" },
      { ID: 110, TENANT_ID: T, PROJECT_ID: 10, FATHER_ID: null, ABBR: "TL a", FEE_CALC_PHASE_ID: 502 },
      { ID: 200, TENANT_ID: T, PROJECT_ID: 11, FATHER_ID: null, ABBR: "LPH 3", FEE_CALC_PHASE_ID: 601 },
      { ID: 210, TENANT_ID: T, PROJECT_ID: 11, FATHER_ID: null, ABBR: "LPH 3", FEE_CALC_PHASE_ID: 602 },
      // Verwaiste Verknüpfung: Kalkulationsphase gibt es nicht (mehr)
      { ID: 220, TENANT_ID: T, PROJECT_ID: 11, FATHER_ID: null, ABBR: "LPH 8", FEE_CALC_PHASE_ID: 999 },
      // Ohne Phasenzuordnung — zählt nicht
      { ID: 230, TENANT_ID: T, PROJECT_ID: 11, FATHER_ID: null, ABBR: "Sonstiges" },
      // Phase ganz ohne Werte — fällt heraus
      { ID: 240, TENANT_ID: T, PROJECT_ID: 11, FATHER_ID: null, ABBR: "LPH 9", FEE_CALC_PHASE_ID: 998 },
    ],
    VW_REPORT_PROJECT_DETAIL_STRUCTURE: [
      { TENANT_ID: T, PROJECT_ID: 10, STRUCTURE_ID: 100, IS_LEAF: false, HONORAR_NET: 99, EARNED_VALUE_NET: 99, HOURS_TOTAL: 99, COST_TOTAL: 99 },
      { TENANT_ID: T, PROJECT_ID: 10, STRUCTURE_ID: 101, IS_LEAF: true, HONORAR_NET: 10000, EARNED_VALUE_NET: 5000, HOURS_TOTAL: 40, COST_TOTAL: 3000 },
      { TENANT_ID: T, PROJECT_ID: 10, STRUCTURE_ID: 102, IS_LEAF: true, HONORAR_NET: 5000, EARNED_VALUE_NET: 5000, HOURS_TOTAL: 10, COST_TOTAL: 1000 },
      { TENANT_ID: T, PROJECT_ID: 10, STRUCTURE_ID: 110, IS_LEAF: true, HONORAR_NET: 2000, EARNED_VALUE_NET: 0, HOURS_TOTAL: 0, COST_TOTAL: 0 },
      { TENANT_ID: T, PROJECT_ID: 11, STRUCTURE_ID: 200, IS_LEAF: true, HONORAR_NET: 30000, EARNED_VALUE_NET: 30000, HOURS_TOTAL: 200, COST_TOTAL: 20000 },
      { TENANT_ID: T, PROJECT_ID: 11, STRUCTURE_ID: 210, IS_LEAF: true, HONORAR_NET: 4000, EARNED_VALUE_NET: 2000, HOURS_TOTAL: 30, COST_TOTAL: 2500 },
      { TENANT_ID: T, PROJECT_ID: 11, STRUCTURE_ID: 220, IS_LEAF: true, HONORAR_NET: 1000, EARNED_VALUE_NET: 0, HOURS_TOTAL: 5, COST_TOTAL: 400 },
      { TENANT_ID: T, PROJECT_ID: 11, STRUCTURE_ID: 230, IS_LEAF: true, HONORAR_NET: 7000, EARNED_VALUE_NET: 7000, HOURS_TOTAL: 50, COST_TOTAL: 3000 },
      { TENANT_ID: T, PROJECT_ID: 11, STRUCTURE_ID: 240, IS_LEAF: true, HONORAR_NET: 0, EARNED_VALUE_NET: 0, HOURS_TOTAL: 0, COST_TOTAL: 0 },
    ],
    FEE_CALCULATION_PHASE: [
      { ID: 501, TENANT_ID: T, FEE_MASTER_ID: 50, FEE_PHASE_ID: 3 },
      { ID: 502, TENANT_ID: T, FEE_MASTER_ID: 51, FEE_PHASE_ID: 1022 },
      { ID: 601, TENANT_ID: T, FEE_MASTER_ID: 60, FEE_PHASE_ID: 2003 },
      { ID: 602, TENANT_ID: T, FEE_MASTER_ID: 61, FEE_PHASE_ID: 14 },
      // Gleiche ID-Reihe bei einem fremden Mandanten — darf nichts beitragen
      { ID: 999, TENANT_ID: F, FEE_MASTER_ID: 90, FEE_PHASE_ID: 3 },
    ],
    FEE_CALCULATION_MASTER: [
      { ID: 50, TENANT_ID: T, FEE_MASTER_ID: 1, ZONE_ID: 3 },
      { ID: 51, TENANT_ID: T, FEE_MASTER_ID: 104, ZONE_ID: null },
      { ID: 60, TENANT_ID: T, FEE_MASTER_ID: 1001, ZONE_ID: 2004 },
      { ID: 61, TENANT_ID: T, FEE_MASTER_ID: 3, ZONE_ID: null },
      { ID: 90, TENANT_ID: F, FEE_MASTER_ID: 1, ZONE_ID: 3 },
    ],
    // Globale Kataloge: KEIN TENANT_ID — ein Mandantenfilter fände hier nichts.
    FEE_MASTERS: [
      { ID: 1, NAME: "Gebäude" },
      { ID: 1001, NAME: "Gebäude" },
      { ID: 3, NAME: "Bebauungsplan" },
      { ID: 104, NAME: "Geotechnik" },
    ],
    FEE_PHASE: [
      { ID: 3, FEE_MASTER_ID: 1, ABBR: "LPH 3", NAME: "Entwurfsplanung", FEE_PERCENT: 15 },
      { ID: 2003, FEE_MASTER_ID: 1001, ABBR: "LPH 3", NAME: "Entwurfsplanung", FEE_PERCENT: 15 },
      { ID: 14, FEE_MASTER_ID: 3, ABBR: "LPH 3", NAME: "Plan zur Beschlussfassung", FEE_PERCENT: 10 },
      { ID: 1022, FEE_MASTER_ID: 104, ABBR: "TL a", NAME: "Grundlagenermittlung und Erkundungskonzept", FEE_PERCENT: 15, SORT_ORDER: 1 },
    ],
    FEE_ZONES: [
      { ID: 3, FEE_MASTER_ID: 1, ABBR: "III" },
      { ID: 2004, FEE_MASTER_ID: 1001, ABBR: "IV" },
    ],
  });
}

const byKey = (facts) => Object.fromEntries(facts.map((f) => [`${f.PROJECT_ID}|${f.LB}|${f.PHASE}`, f]));

describe("LPH-Controlling: Rohsummen je Leistungsbild und Phase", () => {
  test("Phase aus dem Katalog, nicht aus dem (umbenannten) Kürzel; nur Blätter zählen", async () => {
    const r = await loadPhaseFacts(welt(), { tenantId: T, projectIds: [10, 11] });
    const f = byKey(r.facts)["10|Gebäude|LPH 3"];
    expect(f).toMatchObject({ ZONE: "III", HONORAR_NET: 15000, EARNED_VALUE_NET: 10000, HOURS_TOTAL: 50, COST_TOTAL: 4000 });
  });

  test("gleiche LPH-Nummer, verschiedene Leistungsbilder: getrennt; HOAI 2013 und 2021 zusammen", async () => {
    const r = await loadPhaseFacts(welt(), { tenantId: T, projectIds: [10, 11] });
    const k = byKey(r.facts);
    expect(k["11|Gebäude|LPH 3"]).toMatchObject({ ZONE: "IV", HONORAR_NET: 30000 });
    expect(k["11|Bebauungsplan|LPH 3"]).toMatchObject({ ZONE: "", HONORAR_NET: 4000 });
    const lbs = Object.fromEntries(r.leistungsbilder.map((l) => [l.key, l]));
    expect(Object.keys(lbs)).toEqual(["Bebauungsplan", "Gebäude", "Geotechnik", ""]);
    expect(lbs["Gebäude"].phases).toEqual([{ key: "LPH 3", name: "Entwurfsplanung", hoaiPercent: 15, sort: 3 }]);
    expect(lbs["Bebauungsplan"].phases[0].name).toBe("Plan zur Beschlussfassung");
  });

  test("Teilleistungen ohne Nummer bleiben drin und stehen hinter den LPH", async () => {
    const r = await loadPhaseFacts(welt(), { tenantId: T, projectIds: [10, 11] });
    expect(byKey(r.facts)["10|Geotechnik|TL a"]).toMatchObject({ HONORAR_NET: 2000 });
    const geo = r.leistungsbilder.find((l) => l.key === "Geotechnik");
    expect(geo.phases[0]).toMatchObject({ key: "TL a", sort: 1001 });
  });

  test("verwaiste oder fremde Kalkulation: Kürzel des Knotens, ohne Leistungsbild", async () => {
    const r = await loadPhaseFacts(welt(), { tenantId: T, projectIds: [10, 11] });
    expect(byKey(r.facts)["11||LPH 8"]).toMatchObject({ HONORAR_NET: 1000, COST_TOTAL: 400 });
    expect(r.leistungsbilder.find((l) => l.key === "").label).toBe("ohne Leistungsbild");
  });

  test("Blätter ohne Phase und Phasen ohne Werte zählen nicht; nur gewählte Projekte", async () => {
    const alle = await loadPhaseFacts(welt(), { tenantId: T, projectIds: [10, 11] });
    expect(byKey(alle.facts)["11||LPH 9"]).toBeUndefined();
    expect(alle.facts.some((f) => f.HONORAR_NET === 7000)).toBe(false); // „Sonstiges"
    const r = await loadPhaseFacts(welt(), { tenantId: T, projectIds: [10] });
    expect([...r.projectIds]).toEqual([10]);
    expect(r.facts.every((f) => f.PROJECT_ID === 10)).toBe(true);
    expect(r.facts.reduce((s, f) => s + f.HONORAR_NET, 0)).toBe(17000);
  });

  test("ohne Projekte keine Abfrage", async () => {
    expect(await loadPhaseFacts(welt(), { tenantId: T, projectIds: [] }))
      .toEqual({ leistungsbilder: [], facts: [], projectIds: new Set() });
  });
});

describe("phaseKey", () => {
  test.each([
    ["LPH 3", "LPH 3"], ["LPH3", "LPH 3"], ["lph 03", "LPH 3"], ["3", "LPH 3"],
    ["TL a", "TL a"], ["Entwurf", "Entwurf"], ["", "?"], [null, "?"],
  ])("%s → %s", (input, out) => expect(phaseKey(input)).toBe(out));
});
