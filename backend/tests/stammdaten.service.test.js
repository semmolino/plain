"use strict";

const {
  toNumberOrNull,
  getRevenueByKx,
  calculatePhaseRevenue,
  calculateRevenueFields,
  feePhaseSortKey,
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

function makeSupabaseMock({ zone, feeTables }) {
  return {
    from: jest.fn().mockImplementation((table) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue(
        table === "FEE_ZONES"
          ? { data: zone, error: null }
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
