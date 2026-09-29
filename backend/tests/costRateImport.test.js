"use strict";

// Kostensatz-Übernahme mit „Buchungen neu rechnen" (UI-Pilot Runde 11).
// Vorher überschrieb sie jede Buchung ab dem Stichtag — auch über einen
// späteren Satz hinweg, auch Pauschalen, Pausen und abgeschlossene Monate —
// und rechnete die Kosten der Projektelemente nicht nach.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { importCostRates } = require("../services/costRateCalc");

const T = 1, F = 99;

function data(extra = {}) {
  return {
    EMPLOYEE: [{ ID: 2, TENANT_ID: T }, { ID: 3, TENANT_ID: T }, { ID: 50, TENANT_ID: F }],
    EMPLOYEE_COST_RATE: [
      { ID: 1, TENANT_ID: T, EMPLOYEE_ID: 2, COST_RATE: 50, VALID_FROM: "2026-01-01" },
      { ID: 2, TENANT_ID: T, EMPLOYEE_ID: 2, COST_RATE: 60, VALID_FROM: "2026-07-01" },
    ],
    EMPLOYEE_MONTH_CLOSE: [{ ID: 1, TENANT_ID: T, EMPLOYEE_ID: 2, YEAR: 2026, MONTH: 3 }],
    BOOKING: [
      { ID: 10, TENANT_ID: T, EMPLOYEE_ID: 2, BOOKING_DATE: "2026-02-10", QUANTITY_INT: 4, COST_RATE: 50, COST_TOTAL: 200, STRUCTURE_ID: 7, STATUS: "CONFIRMED" },
      { ID: 11, TENANT_ID: T, EMPLOYEE_ID: 2, BOOKING_DATE: "2026-03-05", QUANTITY_INT: 2, COST_RATE: 50, COST_TOTAL: 100, STRUCTURE_ID: 7, STATUS: "CONFIRMED" },
      { ID: 12, TENANT_ID: T, EMPLOYEE_ID: 2, BOOKING_DATE: "2026-04-01", QUANTITY_INT: 1, COST_RATE: 0, COST_TOTAL: 850, BOOKING_KIND: "LUMP_COST", STRUCTURE_ID: 7, STATUS: "CONFIRMED" },
      { ID: 13, TENANT_ID: T, EMPLOYEE_ID: 2, BOOKING_DATE: "2026-04-02", QUANTITY_INT: 0.5, COST_RATE: 50, COST_TOTAL: 0, ENTRY_KIND: "BREAK", STRUCTURE_ID: 7, STATUS: "CONFIRMED" },
      { ID: 14, TENANT_ID: T, EMPLOYEE_ID: 2, BOOKING_DATE: "2026-08-01", QUANTITY_INT: 3, COST_RATE: 60, COST_TOTAL: 180, STRUCTURE_ID: 7, STATUS: "CONFIRMED" },
      { ID: 15, TENANT_ID: T, EMPLOYEE_ID: 2, BOOKING_DATE: "2025-12-15", QUANTITY_INT: 5, COST_RATE: 40, COST_TOTAL: 200, STRUCTURE_ID: 7, STATUS: "CONFIRMED" },
    ],
    PROJECT_STRUCTURE: [{ ID: 7, TENANT_ID: T, BILLING_TYPE_ID: 1, COSTS: 0 }],
    ...extra,
  };
}

const bk = (sb, id) => sb._tables.BOOKING.find(b => b.ID === id);

describe("importCostRates", () => {
  test("rechnet nur Stundenbuchungen bis zum nächsten Satz, ohne abgeschlossene Monate", async () => {
    const sb = makeFakeSupabase(data());
    sb.rpc = async () => ({ data: null, error: null });
    const r = await importCostRates(sb, T, [{ employee_id: 2, rate: 55 }], "2026-01-01", true);
    expect(bk(sb, 10)).toMatchObject({ COST_RATE: 55, COST_TOTAL: 220 });   // Februar: neu
    expect(bk(sb, 11)).toMatchObject({ COST_RATE: 50, COST_TOTAL: 100 });   // März abgeschlossen
    expect(bk(sb, 12)).toMatchObject({ COST_TOTAL: 850 });                  // Pauschale bleibt
    expect(bk(sb, 13)).toMatchObject({ COST_TOTAL: 0 });                    // Pause bleibt
    expect(bk(sb, 14)).toMatchObject({ COST_RATE: 60, COST_TOTAL: 180 });   // ab 1.7. gilt der spätere Satz
    expect(bk(sb, 15)).toMatchObject({ COST_RATE: 40 });                    // vor dem Stichtag
    expect(r).toMatchObject({ recalculated: 1, skipped_closed_month: 1, skipped_not_hours: 2, replaced: 1 });
    expect(r.until[2]).toBe("2026-07-01");
  });

  test("zweiter Import am selben Tag ändert den Satz statt einen zweiten anzulegen", async () => {
    const sb = makeFakeSupabase(data());
    await importCostRates(sb, T, [{ employee_id: 2, rate: 57.5 }], "2026-07-01", false);
    const rows = sb._tables.EMPLOYEE_COST_RATE.filter(x => x.EMPLOYEE_ID === 2 && x.VALID_FROM === "2026-07-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].COST_RATE).toBe(57.5);
  });

  test("neuer Satz für einen Mitarbeiter ohne Satz an dem Tag wird angelegt", async () => {
    const sb = makeFakeSupabase(data());
    const r = await importCostRates(sb, T, [{ employee_id: 3, rate: "48,20" }], "2026-10-01", false);
    expect(sb._tables.EMPLOYEE_COST_RATE.find(x => x.EMPLOYEE_ID === 3)).toMatchObject({ COST_RATE: 48.2, VALID_FROM: "2026-10-01", TENANT_ID: T });
    expect(r.replaced).toBe(0);
  });

  test.each([
    [[{ employee_id: 2, rate: -1 }], "2026-10-01"],
    [[{ employee_id: 2, rate: "" }], "2026-10-01"],
    [[{ employee_id: 2, rate: 50 }], "01.10.2026"],
  ])("ungültige Eingabe %j / %s → 400, nichts geschrieben", async (rates, date) => {
    const sb = makeFakeSupabase(data());
    await expect(importCostRates(sb, T, rates, date, true)).rejects.toMatchObject({ status: 400 });
    expect(sb._tables.EMPLOYEE_COST_RATE).toHaveLength(2);
  });

  test("Mitarbeiter eines fremden Büros → 404", async () => {
    const sb = makeFakeSupabase(data());
    await expect(importCostRates(sb, T, [{ employee_id: 50, rate: 50 }], "2026-10-01", false)).rejects.toMatchObject({ status: 404 });
    expect(sb._tables.EMPLOYEE_COST_RATE).toHaveLength(2);
  });
});
