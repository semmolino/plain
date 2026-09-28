"use strict";

/**
 * „Meine Zeit" — GET /buchungen/mine?from&to.
 *
 * Kein eigenes Recht, deshalb die harte Regel: der Mitarbeiter kommt aus der
 * Sitzung, nie aus der Anfrage, und es gibt keine Betraege. Dazu die beiden
 * Sperrkennzeichen, an denen die Oberflaeche Bearbeiten/Loeschen ausblendet.
 */

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const ctrl = require("../controllers/buchungen");
const routes = require("../routes/buchungen");

const TENANT = 7;

function welt() {
  const b = (over) => ({
    TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 5, QUANTITY_INT: 2, QUANTITY_EXT: 2,
    COST_RATE: 80, COST_TOTAL: 160, HOURLY_RATE: 95, HOURLY_RATE_TOTAL: 190, STATUS: "CONFIRMED",
    BOOKING_KIND: "WORK", ENTRY_KIND: "WORK", INVOICE_ID: null, ADVANCE_INVOICE_ID: null,
    TIME_START: "08:00:00", TIME_FINISH: "10:00:00", POSTING_DESCRIPTION: "Entwurf", ...over,
  });
  return makeFakeSupabase({
    PROJECT: [{ ID: 1, TENANT_ID: TENANT, ABBR: "P-26-001", NAME: "Kita" }],
    PROJECT_STRUCTURE: [{ ID: 10, TENANT_ID: TENANT, PROJECT_ID: 1, ABBR: "LP5", NAME: "Ausführung" }],
    EMPLOYEE_MONTH_CLOSE: [{ ID: 1, TENANT_ID: TENANT, EMPLOYEE_ID: 5, YEAR: 2026, MONTH: 8 }],
    BOOKING: [
      b({ ID: 100, BOOKING_DATE: "2026-09-22" }),
      b({ ID: 101, BOOKING_DATE: "2026-09-22", EMPLOYEE_ID: 6 }),                 // Kollege
      b({ ID: 102, BOOKING_DATE: "2026-09-23", INVOICE_ID: 900 }),               // abgerechnet
      b({ ID: 103, BOOKING_DATE: "2026-08-31" }),                                // Monat zu
      b({ ID: 104, BOOKING_DATE: "2026-09-24", STATUS: "DRAFT" }),               // Stempeluhr
      b({ ID: 105, BOOKING_DATE: "2026-09-22", TENANT_ID: 8 }),                  // anderer Mandant
      b({ ID: 106, BOOKING_DATE: "2026-10-01" }),                                // ausserhalb
      b({ ID: 107, BOOKING_DATE: "2026-09-21", ADVANCE_INVOICE_ID: 0 }),         // 0 = kein Beleg
    ],
  });
}

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const req = (query, employeeId = 5) => ({ tenantId: TENANT, employeeId, query, params: {}, body: {} });

describe("GET /buchungen/mine", () => {
  test("nur eigene Buchungen des Mandanten im Zeitraum, Entwuerfe getrennt", async () => {
    const r = res();
    await ctrl.listMine(req({ from: "2026-08-31", to: "2026-09-30", employee_id: "6" }), r, welt());
    expect(r.statusCode).toBe(200);
    const { bookings, drafts } = r.body.data;
    // employee_id in der Anfrage wird ignoriert — Sitzung ist 5.
    expect(bookings.map(b => b.ID).sort()).toEqual([100, 102, 103, 107]);
    expect(drafts.map(d => d.ID)).toEqual([104]);
  });

  test("keine Betraege in der Antwort", async () => {
    const r = res();
    await ctrl.listMine(req({ from: "2026-09-01", to: "2026-09-30" }), r, welt());
    for (const row of [...r.body.data.bookings, ...r.body.data.drafts]) {
      for (const k of ["COST_RATE", "COST_TOTAL", "HOURLY_RATE", "HOURLY_RATE_TOTAL", "QUANTITY_EXT", "INVOICE_ID", "ADVANCE_INVOICE_ID"]) {
        expect(row).not.toHaveProperty(k);
      }
    }
  });

  test("BILLED bei Rechnung oder Abschlag, 0 zaehlt nicht als Beleg; CLOSED im abgeschlossenen Monat", async () => {
    const r = res();
    await ctrl.listMine(req({ from: "2026-08-31", to: "2026-09-30" }), r, welt());
    const byId = Object.fromEntries(r.body.data.bookings.map(b => [b.ID, b]));
    expect(byId[100]).toMatchObject({ BILLED: false, CLOSED: false });
    expect(byId[102]).toMatchObject({ BILLED: true,  CLOSED: false });
    expect(byId[103]).toMatchObject({ BILLED: false, CLOSED: true });
    expect(byId[107]).toMatchObject({ BILLED: false });
  });

  test.each([
    [{ from: "2026-09-01" }, 400],
    [{ from: "01.09.2026", to: "30.09.2026" }, 400],
    [{ from: "2026-09-30", to: "2026-09-01" }, 400],
    [{ from: "2026-01-01", to: "2026-06-30" }, 400],
  ])("ungueltiger Zeitraum %o → %i", async (query, status) => {
    const r = res();
    await ctrl.listMine(req(query), r, welt());
    expect(r.statusCode).toBe(status);
  });

  test("ohne Mitarbeiter in der Sitzung → 400 statt fremder Daten", async () => {
    const r = res();
    await ctrl.listMine(req({ from: "2026-09-01", to: "2026-09-30" }, null), r, welt());
    expect(r.statusCode).toBe(400);
  });

  test("Route braucht kein eigenes Recht", () => {
    const router = routes(welt());
    const layers = router.stack.filter(l => l.route);
    const mine = layers.find(l => l.route.path === "/mine" && l.route.methods.get);
    expect(mine).toBeTruthy();
    // nur der Handler — keine requirePermission-Middleware davor
    expect(mine.route.stack).toHaveLength(1);
  });
});
