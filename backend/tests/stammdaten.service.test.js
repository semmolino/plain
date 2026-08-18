"use strict";

const {
  toNumberOrNull,
  getRevenueByKx,
  calculatePhaseRevenue,
  calculateRevenueFields,
  feePhaseSortKey,
  zoneFromPoints,
} = require("../services/stammdaten");

// ── toNumberOrNull ────────────────────────────────────────────────────────────

describe("toNumberOrNull", () => {
  it("converts numeric strings", () => expect(toNumberOrNull("42.5")).toBe(42.5));
  it("converts actual numbers", () => expect(toNumberOrNull(7)).toBe(7));
  it("returns null for null", () => expect(toNumberOrNull(null)).toBeNull());
  it("returns null for undefined", () => expect(toNumberOrNull(undefined)).toBeNull());
  it("returns null for empty string", () => expect(toNumberOrNull("")).toBeNull());
  it("returns null for NaN string", () => expect(toNumberOrNull("abc")).toBeNull());
});

// ── calculatePhaseRevenue ─────────────────────────────────────────────────────

describe("calculatePhaseRevenue", () => {
  it("computes percent of base correctly", () => {
    expect(calculatePhaseRevenue(25, 100000)).toBeCloseTo(25000);
  });

  it("returns null when either input is null", () => {
    expect(calculatePhaseRevenue(null, 100000)).toBeNull();
    expect(calculatePhaseRevenue(25, null)).toBeNull();
  });

  it("returns null when feePercent is empty string", () => {
    expect(calculatePhaseRevenue("", 100000)).toBeNull();
  });

  it("handles zero percent", () => {
    expect(calculatePhaseRevenue(0, 100000)).toBe(0);
  });
});

// ── getRevenueByKx ────────────────────────────────────────────────────────────

describe("getRevenueByKx", () => {
  const calcMaster = {
    REVENUE_K0: 1000,
    REVENUE_K1: 2000,
    REVENUE_K2: 3000,
    REVENUE_K3: 4000,
    REVENUE_K4: 5000,
  };

  it("returns correct value for K0", () => expect(getRevenueByKx(calcMaster, "K0")).toBe(1000));
  it("returns correct value for K2", () => expect(getRevenueByKx(calcMaster, "K2")).toBe(3000));
  it("is case-insensitive", () => expect(getRevenueByKx(calcMaster, "k1")).toBe(2000));
  it("returns null for unknown key", () => expect(getRevenueByKx(calcMaster, "K9")).toBeNull());
  it("returns null when calcMaster is null", () => expect(getRevenueByKx(null, "K0")).toBeNull());
});

// ── calculateRevenueFields (with mocked Supabase) ────────────────────────────

function makeSupabaseMock({ zone, feeTables, baseType }) {
  return {
    from: jest.fn().mockImplementation((table) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue(
        table === "FEE_ZONES"
          ? { data: zone, error: null }
          : { data: null, error: null }
      ),
      maybeSingle: jest.fn().mockResolvedValue(
        table === "FEE_MASTERS"
          ? { data: baseType ? { BASE_TYPE: baseType } : null, error: null }
          : { data: null, error: null }
      ),
      order: jest.fn().mockResolvedValue(
        table === "FEE_TABLES"
          ? { data: feeTables, error: null }
          : { data: [], error: null }
      ),
    })),
  };
}

describe("calculateRevenueFields", () => {
  it("returns all-null object when feeMasterId is missing", async () => {
    const supabase = makeSupabaseMock({ zone: null, feeTables: [] });
    const result = await calculateRevenueFields(supabase, {
      feeMasterId: null,
      zoneId: 1,
      zonePercent: 50,
      costsByKey: {},
    });
    expect(result).toEqual({
      REVENUE_K0: null,
      REVENUE_K1: null,
      REVENUE_K2: null,
      REVENUE_K3: null,
      REVENUE_K4: null,
    });
  });

  it("computes interpolated revenues for zone II with known table rows", async () => {
    const zone = { ID: 2, NAME_SHORT: "II" };
    const feeTables = [
      { BASE: 100000, ZONE_2: 10000, ZONE_3: 12000 },
      { BASE: 200000, ZONE_2: 18000, ZONE_3: 22000 },
    ];

    const supabase = {
      from: jest.fn().mockImplementation((table) => {
        if (table === "FEE_ZONES") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: zone, error: null }),
          };
        }
        // FEE_TABLES
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({ data: feeTables, error: null }),
        };
      }),
    };

    const result = await calculateRevenueFields(supabase, {
      feeMasterId: 1,
      zoneId: 2,
      zonePercent: 0, // pure ZONE_2 (min column), 0% blend toward max
      costsByKey: {
        CONSTRUCTION_COSTS_K0: 150000,  // midpoint → interpolated
        CONSTRUCTION_COSTS_K1: null,
        CONSTRUCTION_COSTS_K2: null,
        CONSTRUCTION_COSTS_K3: null,
        CONSTRUCTION_COSTS_K4: null,
      },
    });

    // At K0=150000 (midpoint between 100k and 200k):
    // zone min interp: 10000 + ((150000-100000)*(18000-10000))/(200000-100000) = 14000
    // zone max interp: 12000 + ((150000-100000)*(22000-12000))/(200000-100000) = 17000
    // zonePercent=0 → result = 14000 + (17000-14000)*0/100 = 14000
    expect(result.REVENUE_K0).toBeCloseTo(14000);
    expect(result.REVENUE_K1).toBeNull();
  });

  it("percent_of_baukosten: Grundhonorar je Kx = Kx × Honorarsatz, ohne Zone", async () => {
    const supabase = makeSupabaseMock({ zone: null, feeTables: [], baseType: "percent_of_baukosten" });
    const result = await calculateRevenueFields(supabase, {
      feeMasterId: 108,
      zoneId: null,
      zonePercent: 10,
      costsByKey: { CONSTRUCTION_COSTS_K0: 1000000, CONSTRUCTION_COSTS_K1: 500000 },
    });
    expect(result.REVENUE_K0).toBe(100000);
    expect(result.REVENUE_K1).toBe(50000);
    expect(result.REVENUE_K2).toBeNull();
  });

  it("percent_of_baukosten: null ohne Honorarsatz", async () => {
    const supabase = makeSupabaseMock({ zone: null, feeTables: [], baseType: "percent_of_baukosten" });
    const result = await calculateRevenueFields(supabase, {
      feeMasterId: 108,
      zoneId: null,
      zonePercent: null,
      costsByKey: { CONSTRUCTION_COSTS_K0: 1000000 },
    });
    expect(result.REVENUE_K0).toBeNull();
  });

  it("flaechenaequivalent_brandschutz: H = 2.600 + f x Aq^0,61 (AHO Heft 17, gegen die Quelle verifiziert)", async () => {
    const supabase = makeSupabaseMock({ zone: null, feeTables: [], baseType: "flaechenaequivalent_brandschutz" });
    const result = await calculateRevenueFields(supabase, {
      feeMasterId: 109,
      zoneId: null,
      zonePercent: 173, // Faktor f (zweckentfremdetes Feld), nicht Prozent
      costsByKey: { CONSTRUCTION_COSTS_K0: 5000 }, // Aq in m²
    });
    expect(result.REVENUE_K0).toBe(33818.92);
    expect(result.REVENUE_K1).toBeNull();
  });

  it("flaechenaequivalent_brandschutz: zweiter Referenzpunkt (f=184, Aq=10000)", async () => {
    const supabase = makeSupabaseMock({ zone: null, feeTables: [], baseType: "flaechenaequivalent_brandschutz" });
    const result = await calculateRevenueFields(supabase, {
      feeMasterId: 109,
      zoneId: null,
      zonePercent: 184,
      costsByKey: { CONSTRUCTION_COSTS_K0: 10000 },
    });
    expect(result.REVENUE_K0).toBe(53277.81);
  });

  it("flaechenaequivalent_brandschutz: null ohne Aq oder ohne Faktor f", async () => {
    const supabase = makeSupabaseMock({ zone: null, feeTables: [], baseType: "flaechenaequivalent_brandschutz" });
    const withoutAq = await calculateRevenueFields(supabase, {
      feeMasterId: 109, zoneId: null, zonePercent: 173, costsByKey: {},
    });
    expect(withoutAq.REVENUE_K0).toBeNull();
    const withoutF = await calculateRevenueFields(supabase, {
      feeMasterId: 109, zoneId: null, zonePercent: null, costsByKey: { CONSTRUCTION_COSTS_K0: 5000 },
    });
    expect(withoutF.REVENUE_K0).toBeNull();
  });

  it("throws when Supabase returns an error for FEE_ZONES", async () => {
    const supabase = {
      from: jest.fn().mockImplementation(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: new Error("DB error") }),
      })),
    };

    await expect(
      calculateRevenueFields(supabase, {
        feeMasterId: 1,
        zoneId: 1,
        zonePercent: 0,
        costsByKey: {},
      })
    ).rejects.toThrow("DB error");
  });
});

// ── feePhaseSortKey ───────────────────────────────────────────────────────────

describe("feePhaseSortKey", () => {
  it("parst die führende Zahl aus NAME_SHORT, wenn kein SORT_ORDER gesetzt ist", () => {
    expect(feePhaseSortKey({ NAME_SHORT: "LPH 1" })).toBe(1);
    expect(feePhaseSortKey({ NAME_SHORT: "LPH 9" })).toBe(9);
  });
  it("bevorzugt SORT_ORDER vor dem Namens-Parsing", () => {
    expect(feePhaseSortKey({ NAME_SHORT: "LPH 9", SORT_ORDER: 1 })).toBe(1);
  });
  it("liefert MAX_SAFE_INTEGER für Namen ohne Ziffer und ohne SORT_ORDER (z. B. Geotechnik vor 0117)", () => {
    expect(feePhaseSortKey({ NAME_SHORT: "TL a" })).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("sortiert Teilleistungen a/b/c korrekt, wenn SORT_ORDER gesetzt ist", () => {
    const phases = [
      { NAME_SHORT: "TL c", SORT_ORDER: 3 },
      { NAME_SHORT: "TL a", SORT_ORDER: 1 },
      { NAME_SHORT: "TL b", SORT_ORDER: 2 },
    ];
    const sorted = [...phases].sort((a, b) => feePhaseSortKey(a) - feePhaseSortKey(b));
    expect(sorted.map((p) => p.NAME_SHORT)).toEqual(["TL a", "TL b", "TL c"]);
  });
  it("behandelt fehlende Phase (undefined) wie MAX_SAFE_INTEGER", () => {
    expect(feePhaseSortKey(undefined)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

// ── zoneFromPoints (§ 5 Abs. 2 HOAI) ──────────────────────────────────────────

describe("zoneFromPoints", () => {
  // § 35 Abs. 6 (Gebäude/Innenräume): I bis 10, II 11–18, III 19–26,
  // IV 27–34, V 35–42 — Zone-IDs wie in Migration 0115 für Gebäude.
  const gebaeude = [
    { ZONE_ID: 1, POINTS_FROM: 0,  POINTS_TO: 10 },
    { ZONE_ID: 2, POINTS_FROM: 11, POINTS_TO: 18 },
    { ZONE_ID: 3, POINTS_FROM: 19, POINTS_TO: 26 },
    { ZONE_ID: 4, POINTS_FROM: 27, POINTS_TO: 34 },
    { ZONE_ID: 5, POINTS_FROM: 35, POINTS_TO: 42 },
  ];

  it("trifft die unterste Zone", () => {
    expect(zoneFromPoints(0, gebaeude).zoneId).toBe(1);
    expect(zoneFromPoints(10, gebaeude).zoneId).toBe(1);
  });
  it("trifft an den Bandgrenzen die richtige Zone", () => {
    expect(zoneFromPoints(11, gebaeude).zoneId).toBe(2);
    expect(zoneFromPoints(18, gebaeude).zoneId).toBe(2);
    expect(zoneFromPoints(19, gebaeude).zoneId).toBe(3);
  });
  it("trifft die oberste Zone", () => {
    expect(zoneFromPoints(35, gebaeude).zoneId).toBe(5);
    expect(zoneFromPoints(42, gebaeude).zoneId).toBe(5);
  });
  it("gibt das getroffene Band mit zurück (für die Anzeige)", () => {
    expect(zoneFromPoints(20, gebaeude)).toEqual({ zoneId: 3, from: 19, to: 26 });
  });
  it("oberhalb der Skala greift die höchste Zone statt kein Ergebnis", () => {
    expect(zoneFromPoints(99, gebaeude).zoneId).toBe(5);
  });
  it("ohne Punktzahl oder ohne Schwellen: null", () => {
    expect(zoneFromPoints(null, gebaeude)).toBeNull();
    expect(zoneFromPoints("", gebaeude)).toBeNull();
    expect(zoneFromPoints(10, [])).toBeNull();
    expect(zoneFromPoints(10, null)).toBeNull();
  });
  it("funktioniert auch bei dreizonigen Leistungsbildern (§ 20: 0-9/10-14/15-18)", () => {
    const fnp = [
      { ZONE_ID: 9,  POINTS_FROM: 0,  POINTS_TO: 9 },
      { ZONE_ID: 10, POINTS_FROM: 10, POINTS_TO: 14 },
      { ZONE_ID: 11, POINTS_FROM: 15, POINTS_TO: 18 },
    ];
    expect(zoneFromPoints(9, fnp).zoneId).toBe(9);
    expect(zoneFromPoints(10, fnp).zoneId).toBe(10);
    expect(zoneFromPoints(18, fnp).zoneId).toBe(11);
  });
  it("sortiert unsortierte Schwellen selbst", () => {
    const shuffled = [gebaeude[3], gebaeude[0], gebaeude[4], gebaeude[1], gebaeude[2]];
    expect(zoneFromPoints(20, shuffled).zoneId).toBe(3);
  });
});
