"use strict";

/**
 * Der Monatsabschluss soll je laufendem Projekt einen Leistungsstand zum
 * Monatsende schreiben (PROJECT_PROGRESS). Bis Runde 2 rief er
 * progressSnapshot ohne tenantId auf — assertInTenant warf, der Fehler wurde
 * je Projekt geschluckt, und es entstand nie ein Stand. Der Stichtagsbericht
 * „Teilfertige Leistungen" sah deshalb nur manuell gespeicherte Stände.
 */

const { makeFakeSupabase } = require("./helpers/fakeSupabase");

jest.mock("../services/notifications", () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
}));

const svc = require("../services/monatsabschluss");

const TENANT = 7;

it("schreibt je Projekt einen Stand und zählt ihn", async () => {
  const db = makeFakeSupabase({
    TENANT_SETTINGS: [],
    VW_REPORT_PROJECT_DETAIL: [
      { TENANT_ID: TENANT, PROJECT_ID: 1, ABBR: "P-26-001", NAME: "Kita", PROJECT_STATUS_ID: 1 },
    ],
    PROJECT: [{ ID: 1, TENANT_ID: TENANT, ABBR: "P-26-001", NAME: "Kita" }],
    PROJECT_STRUCTURE: [
      { ID: 10, TENANT_ID: TENANT, PROJECT_ID: 1, BILLING_TYPE_ID: 1, REVENUE: 1000, EXTRAS: 50, EXTRAS_PERCENT: 5,
        REVENUE_COMPLETION_PERCENT: 40, EXTRAS_COMPLETION_PERCENT: 40, ADVANCE_INVOICED: 0, INVOICED: 0, PAYED: 0 },
    ],
    PROJECT_PROGRESS: [],
    BOOKING: [],
  });

  const out = await svc.runMonatsabschluss(db, TENANT, { year: 2026, month: 9 });

  expect(out.snapshotCount).toBe(1);
  const rows = db._tables.PROJECT_PROGRESS.filter(r => Number(r.STRUCTURE_ID) === 10);
  expect(rows).toHaveLength(1);
  expect(rows[0].TENANT_ID).toBe(TENANT);
  expect(Number(rows[0].REVENUE_COMPLETION_PERCENT)).toBe(40);
});
