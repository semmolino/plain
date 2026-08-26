"use strict";

// B3 (Audit 25.08.2026): ZONE_PERCENT war nirgends begrenzt. Bei FM 1, Zone III,
// K0 = 500.000 EUR und ZONE_PERCENT = 150 ergaben sich 86.223,50 EUR statt der
// 78.449 EUR Hoechstsatz laut Tafel -- 7.774,50 EUR darueber, ohne Hinweis.
//
// Die Grenze gilt bewusst NICHT fuer die Typen, die die Spalte zweckentfremden.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { zonePercentRangeError } = require("../services/stammdaten");

const db = (baseType) => makeFakeSupabase({
  FEE_MASTERS: [{ ID: 1, BASE_TYPE: baseType }],
});

describe("zonePercentRangeError (B3)", () => {
  it("laesst Werte innerhalb 0-100 durch", async () => {
    const supabase = db("cost_eur");
    for (const pct of [0, 0.5, 50, 99.99, 100]) {
      expect(await zonePercentRangeError(supabase, 1, pct)).toBeNull();
    }
  });

  it("weist 150 % bei einem Honorartafel-Leistungsbild ab", async () => {
    const msg = await zonePercentRangeError(db("cost_eur"), 1, 150);
    expect(msg).toMatch(/0 und 100/);
  });

  it("weist negative Werte ab", async () => {
    expect(await zonePercentRangeError(db("cost_eur"), 1, -1)).toMatch(/0 und 100/);
  });

  it("laesst 150 % bei percent_of_baukosten zu (frei vereinbarter Honorarsatz)", async () => {
    expect(await zonePercentRangeError(db("percent_of_baukosten"), 1, 150)).toBeNull();
  });

  it("laesst den Faktor f 184 bei flaechenaequivalent_brandschutz zu", async () => {
    // AHO Heft 17: f liegt je nach Jahr der Beauftragung zwischen 170 und 191.
    expect(await zonePercentRangeError(db("flaechenaequivalent_brandschutz"), 1, 184)).toBeNull();
  });

  it("ignoriert leere Werte", async () => {
    const supabase = db("cost_eur");
    for (const leer of [null, undefined, ""]) {
      expect(await zonePercentRangeError(supabase, 1, leer)).toBeNull();
    }
  });

  it("behandelt ein unbekanntes Leistungsbild wie einen Tafel-Typ", async () => {
    // Kein FEE_MASTERS-Treffer: im Zweifel pruefen, nicht durchlassen.
    expect(await zonePercentRangeError(db("cost_eur"), 999, 150)).toMatch(/0 und 100/);
  });
});
