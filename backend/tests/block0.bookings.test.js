"use strict";

/**
 * Runde 2, Block 0: drei Luecken rund um Buchungen, jede fuer sich ein
 * Datenrisiko.
 *   1. Eine abgerechnete Buchung liess sich per PATCH umschreiben (Loeschen
 *      und Umbuchen waren gesperrt, Aendern nicht).
 *   2. Der Monatsabschluss galt beim Aendern nicht.
 *   3. Timer-Entwuerfe: gelesen und bestaetigt wurde nach der Mitarbeiter-ID
 *      aus der Anfrage — also auch die eines Kollegen, samt Kostensatz.
 */

const { makeFakeSupabase } = require("./helpers/fakeSupabase");

jest.mock("../services/budgetWarnings", () => ({
  evaluateAfterTecChange: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/arbzg", () => ({
  getArbzgSettings: jest.fn().mockResolvedValue({ enabled: false }),
  writeAuditEvents: jest.fn().mockResolvedValue(undefined),
}));

const svc  = require("../services/buchungen");
const ctrl = require("../controllers/buchungen");

const TENANT = 7;

function welt({ monthClose = [] } = {}) {
  return makeFakeSupabase({
    PROJECT: [{ ID: 1, TENANT_ID: TENANT, ABBR: "P-26-001", NAME: "Kita" }],
    PROJECT_STRUCTURE: [
      { ID: 10, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, ABBR: "LP5", NAME: "Ausführung", BILLING_TYPE_ID: 2, EXTRAS_PERCENT: 0, COSTS: 0, REVENUE: 0 },
    ],
    EMPLOYEE2PROJECT: [],
    EMPLOYEE_MONTH_CLOSE: monthClose,
    BOOKING: [
      { ID: 100, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 5, BOOKING_DATE: "2026-08-03",
        QUANTITY_INT: 4, QUANTITY_EXT: 4, COST_RATE: 80, COST_TOTAL: 320, HOURLY_RATE: 90, HOURLY_RATE_TOTAL: 360,
        POSTING_DESCRIPTION: "Grundrisse", STATUS: "CONFIRMED", BOOKING_KIND: "WORK", ENTRY_KIND: "WORK",
        INVOICE_ID: null, ADVANCE_INVOICE_ID: null },
      { ID: 101, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 5, BOOKING_DATE: "2026-08-04",
        QUANTITY_INT: 2, QUANTITY_EXT: 2, COST_RATE: 80, COST_TOTAL: 160, HOURLY_RATE: 90, HOURLY_RATE_TOTAL: 180,
        POSTING_DESCRIPTION: "Details", STATUS: "CONFIRMED", BOOKING_KIND: "WORK", ENTRY_KIND: "WORK",
        INVOICE_ID: null, ADVANCE_INVOICE_ID: 77 },
      // Timer-Entwuerfe zweier Mitarbeiter am selben Tag
      { ID: 200, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 5, BOOKING_DATE: "2026-09-24",
        QUANTITY_INT: 1, COST_RATE: 80, COST_TOTAL: 80, QUANTITY_EXT: 1, HOURLY_RATE: 90, HOURLY_RATE_TOTAL: 90,
        TIME_START: "08:00:00", STATUS: "DRAFT", ENTRY_KIND: "WORK" },
      { ID: 201, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 6, BOOKING_DATE: "2026-09-24",
        QUANTITY_INT: 2, COST_RATE: 95, COST_TOTAL: 190, QUANTITY_EXT: 2, HOURLY_RATE: 90, HOURLY_RATE_TOTAL: 180,
        TIME_START: "09:00:00", STATUS: "DRAFT", ENTRY_KIND: "WORK" },
    ],
  });
}

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function req({ employeeId = 5, perms = [], query = {}, body = {} } = {}) {
  const set = new Set(perms);
  return { tenantId: TENANT, employeeId, query, body, params: {}, permissions: set, hasPermission: (k) => set.has(k) };
}

describe("patchBuchung", () => {
  it("ändert eine offene Buchung", async () => {
    const db = welt();
    await svc.patchBuchung(db, { id: 100, body: { POSTING_DESCRIPTION: "Grundrisse EG" }, tenantId: TENANT });
    expect(db._tables.BOOKING.find(r => r.ID === 100).POSTING_DESCRIPTION).toBe("Grundrisse EG");
  });

  it("sperrt eine abgerechnete Buchung", async () => {
    const db = welt();
    await expect(svc.patchBuchung(db, { id: 101, body: { QUANTITY_INT: 5 }, tenantId: TENANT }))
      .rejects.toMatchObject({ status: 409 });
    expect(db._tables.BOOKING.find(r => r.ID === 101).QUANTITY_INT).toBe(2);
  });

  it("sperrt eine Buchung aus einem abgeschlossenen Monat", async () => {
    const db = welt({ monthClose: [{ ID: 1, TENANT_ID: TENANT, EMPLOYEE_ID: 5, YEAR: 2026, MONTH: 8 }] });
    await expect(svc.patchBuchung(db, { id: 100, body: { QUANTITY_INT: 5 }, tenantId: TENANT }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("lässt nichts in einen abgeschlossenen Monat wandern", async () => {
    const db = welt({ monthClose: [{ ID: 1, TENANT_ID: TENANT, EMPLOYEE_ID: 5, YEAR: 2026, MONTH: 7 }] });
    await expect(svc.patchBuchung(db, { id: 100, body: { BOOKING_DATE: "2026-07-30" }, tenantId: TENANT }))
      .rejects.toMatchObject({ status: 409 });
  });
});

describe("Timer-Entwürfe", () => {
  it("liefert ohne Angabe die eigenen, ohne Kostensatz", async () => {
    const r = res();
    await ctrl.listDraftsByEmployee(req({ query: { date: "2026-09-24" } }), r, welt());
    expect(r.statusCode).toBe(200);
    expect(r.body.data.map(d => d.ID)).toEqual([200]);
    expect(r.body.data[0].COST_RATE).toBeUndefined();
  });

  it("verweigert fremde Entwürfe ohne Team-Sicht", async () => {
    const r = res();
    await ctrl.listDraftsByEmployee(req({ query: { date: "2026-09-24", employee_id: "6" } }), r, welt());
    expect(r.statusCode).toBe(403);
  });

  it("zeigt fremde Entwürfe mit employees.bookings.view_all", async () => {
    const r = res();
    await ctrl.listDraftsByEmployee(req({ perms: ["employees.bookings.view_all"], query: { date: "2026-09-24", employee_id: "6" } }), r, welt());
    expect(r.body.data.map(d => d.ID)).toEqual([201]);
  });

  it("bestätigt nur eigene Entwürfe", async () => {
    const db = welt();
    const r = res();
    await ctrl.confirmDrafts(req({ body: { ids: [200, 201] } }), r, db);
    expect(r.body.confirmed ?? r.body.success).toBeTruthy();
    expect(db._tables.BOOKING.find(b => b.ID === 200).STATUS).toBe("CONFIRMED");
    expect(db._tables.BOOKING.find(b => b.ID === 201).STATUS).toBe("DRAFT");
  });
});
