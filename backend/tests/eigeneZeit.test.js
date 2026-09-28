"use strict";

/**
 * Recht „Eigene Zeit buchen" (projects.bookings.own, Migration 0169).
 * Wer nur dieses Recht hat, darf fuer sich selbst buchen — nicht fuer
 * Kollegen, nicht mit selbst gewaehltem Satz, nicht auf ruhende Projekte, und
 * nur eigene, offene Buchungen aendern oder loeschen.
 */

const { makeFakeSupabase } = require("./helpers/fakeSupabase");

jest.mock("../services/budgetWarnings", () => ({
  evaluateAfterTecChange: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/arbzg", () => ({
  getArbzgSettings: jest.fn().mockResolvedValue({ enabled: false }),
  validateBookingArbZG: jest.fn().mockResolvedValue({ issues: [] }),
  writeAuditEvents: jest.fn().mockResolvedValue(undefined),
}));

const ctrl = require("../controllers/buchungen");

const TENANT = 7;

function welt() {
  return makeFakeSupabase({
    TENANT_SETTINGS: [{ TENANT_ID: TENANT, KEY: "monatsabschluss_statuses", VALUE: "[1]" }],
    PROJECT: [
      { ID: 1, TENANT_ID: TENANT, ABBR: "P-26-001", NAME: "Kita", PROJECT_STATUS_ID: 1 },
      { ID: 2, TENANT_ID: TENANT, ABBR: "P-26-002", NAME: "Ruht", PROJECT_STATUS_ID: 3 },
    ],
    PROJECT_STRUCTURE: [
      { ID: 10, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, ABBR: "LP5", NAME: "Ausführung", BILLING_TYPE_ID: 1, REVENUE: 400000, EXTRAS_PERCENT: 5, COSTS: 0 },
      { ID: 20, TENANT_ID: TENANT, PROJECT_ID: 2, FATHER_ID: null, ABBR: "LP1", NAME: "Grundlagen", BILLING_TYPE_ID: 1, REVENUE: 1000, EXTRAS_PERCENT: 0, COSTS: 0 },
    ],
    EMPLOYEE2PROJECT: [],
    EMPLOYEE_COST_RATE: [],
    EMPLOYEE_MONTH_CLOSE: [],
    BOOKING: [
      { ID: 100, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 5, BOOKING_DATE: "2026-09-22", QUANTITY_INT: 2, QUANTITY_EXT: 2,
        COST_RATE: 80, HOURLY_RATE: 95, STATUS: "CONFIRMED", BOOKING_KIND: "WORK", ENTRY_KIND: "WORK", INVOICE_ID: null, ADVANCE_INVOICE_ID: null },
      { ID: 101, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 6, BOOKING_DATE: "2026-09-22", QUANTITY_INT: 3, QUANTITY_EXT: 3,
        COST_RATE: 80, HOURLY_RATE: 95, STATUS: "CONFIRMED", BOOKING_KIND: "WORK", ENTRY_KIND: "WORK", INVOICE_ID: null, ADVANCE_INVOICE_ID: null },
    ],
  });
}

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function req({ perms = ["projects.bookings.own"], body = {}, params = {} } = {}) {
  const set = new Set(perms);
  return { tenantId: TENANT, employeeId: 5, body, params, query: {}, permissions: set, hasPermission: (k) => set.has(k) };
}

const buchung = (over = {}) => ({
  PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 6, BOOKING_DATE: "2026-09-24",
  QUANTITY_INT: 1.5, QUANTITY_EXT: 9, HOURLY_RATE: 500, COST_RATE: 1, POSTING_DESCRIPTION: "Werkplanung", ...over,
});

describe("Buchen mit Eigene Zeit buchen", () => {
  it("bucht für sich selbst, mit Server-Satz und geleisteten Stunden", async () => {
    const db = welt();
    const r = res();
    await ctrl.createBuchung(req({ body: buchung() }), r, db);
    expect(r.statusCode).toBe(200);
    const neu = db._tables.BOOKING.find(b => b.POSTING_DESCRIPTION === "Werkplanung");
    expect(neu.EMPLOYEE_ID).toBe(5);
    expect(Number(neu.HOURLY_RATE)).toBe(0);
    expect(Number(neu.QUANTITY_EXT)).toBe(1.5);
  });

  it("volles Recht bucht wie bisher für den angegebenen Mitarbeiter", async () => {
    const db = welt();
    const r = res();
    await ctrl.createBuchung(req({ perms: ["projects.bookings.create"], body: buchung() }), r, db);
    expect(r.statusCode).toBe(200);
    expect(db._tables.BOOKING.find(b => b.POSTING_DESCRIPTION === "Werkplanung").EMPLOYEE_ID).toBe(6);
  });

  it("verweigert ein Projekt, das nicht läuft", async () => {
    const r = res();
    await ctrl.createBuchung(req({ body: buchung({ PROJECT_ID: 2, STRUCTURE_ID: 20 }) }), r, welt());
    expect(r.statusCode).toBe(403);
  });

  it("verweigert eine Leistung aus einem anderen Projekt", async () => {
    const r = res();
    await ctrl.createBuchung(req({ body: buchung({ STRUCTURE_ID: 20 }) }), r, welt());
    expect(r.statusCode).toBe(400);
  });
});

describe("Ändern und Löschen mit Eigene Zeit buchen", () => {
  it("ändert die eigene Buchung, aber weder Mitarbeiter noch Satz", async () => {
    const db = welt();
    const r = res();
    await ctrl.patchBuchung(req({ params: { id: 100 }, body: { QUANTITY_INT: 2.5, EMPLOYEE_ID: 6, HOURLY_RATE: 999 } }), r, db);
    expect(r.statusCode).toBe(200);
    const b = db._tables.BOOKING.find(x => x.ID === 100);
    expect(b.EMPLOYEE_ID).toBe(5);
    expect(Number(b.QUANTITY_INT)).toBe(2.5);
    expect(Number(b.HOURLY_RATE)).toBe(95);
    // Die Antwort traegt die ganze Zeile — ohne Kosten-/Umsatzrecht ohne Saetze.
    for (const k of ["COST_RATE", "COST_TOTAL", "HOURLY_RATE", "HOURLY_RATE_TOTAL"]) {
      expect(r.body.data).not.toHaveProperty(k);
    }
  });

  it("verweigert die Buchung eines Kollegen", async () => {
    const r = res();
    await ctrl.patchBuchung(req({ params: { id: 101 }, body: { QUANTITY_INT: 1 } }), r, welt());
    expect(r.statusCode).toBe(403);
    const d = res();
    await ctrl.deleteBuchung(req({ params: { id: 101 } }), d, welt());
    expect(d.statusCode).toBe(403);
  });
});

describe("Auswahlliste", () => {
  it("zeigt nur laufende Projekte", async () => {
    const r = res();
    await ctrl.listOwnProjects(req(), r, welt());
    expect(r.body.data).toEqual([{ ID: 1, ABBR: "P-26-001", NAME: "Kita" }]);
  });

  it("liefert Leistungen ohne Beträge", async () => {
    const r = res();
    await ctrl.listOwnLeaves(req({ params: { id: 1 } }), r, welt());
    expect(r.body.data).toEqual([{ STRUCTURE_ID: 10, FATHER_ID: null, ABBR: "LP5", NAME: "Ausführung", BILLING_TYPE_ID: 1 }]);
    expect(JSON.stringify(r.body.data)).not.toMatch(/REVENUE|400000/);
  });
});
