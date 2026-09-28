"use strict";

/**
 * Leistungsstand zum Stichtag und Monatsrunde (Migration 0170).
 *
 * Die Berichte beruhen auf einer Regel: je Element steigt AS_OF_DATE in
 * Erfassungsreihenfolge nie ab. Diese Tests pruefen die drei Stellen, die sie
 * halten — Speichern mit Stichtag, Bestaetigen ohne Aenderung, Fortschreiben
 * bei Rechnung/Zahlung — und die Arbeitsliste der Monatsrunde.
 */

const { makeFakeSupabase } = require("./helpers/fakeSupabase");

jest.mock("../services/notificationSchedule", () => ({
  ...jest.requireActual("../services/notificationSchedule"),
  localDateStr: () => "2026-10-03",
}));

const svc = require("../services/projekte");
const runde = require("../services/leistungsstandRunde");
const { insertProgressSnapshot } = require("../services/projectProgress");
const ctrl = require("../controllers/projekte");

const TENANT = 7;

function welt({ progress = [] } = {}) {
  return makeFakeSupabase({
    TENANT_SETTINGS: [{ TENANT_ID: TENANT, KEY: "monatsabschluss_statuses", VALUE: "[1]" }],
    PROJECT: [
      { ID: 1, TENANT_ID: TENANT, ABBR: "P-26-001", NAME: "Kita",   PROJECT_STATUS_ID: 1, PROJECT_MANAGER_ID: 5, PROGRESS_REVIEWED_AS_OF: null },
      { ID: 2, TENANT_ID: TENANT, ABBR: "P-26-002", NAME: "Halle",  PROJECT_STATUS_ID: 1, PROJECT_MANAGER_ID: 6, PROGRESS_REVIEWED_AS_OF: "2026-09-30" },
      { ID: 3, TENANT_ID: TENANT, ABBR: "P-26-003", NAME: "Ruht",   PROJECT_STATUS_ID: 3, PROJECT_MANAGER_ID: 5, PROGRESS_REVIEWED_AS_OF: null },
      { ID: 4, TENANT_ID: TENANT, ABBR: "P-26-004", NAME: "Nur Nachweis", PROJECT_STATUS_ID: 1, PROJECT_MANAGER_ID: 5, PROGRESS_REVIEWED_AS_OF: null },
      { ID: 9, TENANT_ID: 8,      ABBR: "X-1",      NAME: "Fremd",  PROJECT_STATUS_ID: 1, PROJECT_MANAGER_ID: 5, PROGRESS_REVIEWED_AS_OF: null },
    ],
    PROJECT_STRUCTURE: [
      { ID: 10, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, ABBR: "LP", BILLING_TYPE_ID: 1, REVENUE: 0, EXTRAS: 0, EXTRAS_PERCENT: 0 },
      { ID: 11, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: 10, ABBR: "LP2", BILLING_TYPE_ID: 1, REVENUE: 1000, EXTRAS: 50, EXTRAS_PERCENT: 5,
        REVENUE_COMPLETION_PERCENT: 40, EXTRAS_COMPLETION_PERCENT: 40, ADVANCE_INVOICED: 0, INVOICED: 0, PAYED: 0 },
      { ID: 12, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: 10, ABBR: "LP5", BILLING_TYPE_ID: 1, REVENUE: 2000, EXTRAS: 100, EXTRAS_PERCENT: 5,
        REVENUE_COMPLETION_PERCENT: 10, EXTRAS_COMPLETION_PERCENT: 10, ADVANCE_INVOICED: 0, INVOICED: 0, PAYED: 0 },
      { ID: 20, TENANT_ID: TENANT, PROJECT_ID: 2, FATHER_ID: null, ABBR: "LP8", BILLING_TYPE_ID: 1, REVENUE: 500, EXTRAS: 0, EXTRAS_PERCENT: 0 },
      { ID: 30, TENANT_ID: TENANT, PROJECT_ID: 3, FATHER_ID: null, ABBR: "LP1", BILLING_TYPE_ID: 1, REVENUE: 100, EXTRAS: 0, EXTRAS_PERCENT: 0 },
      { ID: 40, TENANT_ID: TENANT, PROJECT_ID: 4, FATHER_ID: null, ABBR: "BL",  BILLING_TYPE_ID: 2, REVENUE: 0, EXTRAS: 0, EXTRAS_PERCENT: 0 },
    ],
    PROJECT_PROGRESS: progress,
    VW_REPORT_PROJECT_DETAIL: [
      { TENANT_ID: TENANT, PROJECT_ID: 1, PROJECT_MANAGER_DISPLAY: "S. Messina", LEISTUNGSSTAND_PERCENT: 20, OPEN_NET_TOTAL: 350, BUDGET_TOTAL_NET: 3150 },
      { TENANT_ID: TENANT, PROJECT_ID: 2, PROJECT_MANAGER_DISPLAY: "T. Kern",    LEISTUNGSSTAND_PERCENT: 55, OPEN_NET_TOTAL: 0,   BUDGET_TOTAL_NET: 500 },
    ],
    BOOKING: [],
  });
}

const pp = (sid, asOf, pct, extra = {}) => ({
  TENANT_ID: TENANT, STRUCTURE_ID: sid, AS_OF_DATE: asOf, created_at: `${asOf}T10:00:00Z`,
  REVENUE: 1000, REVENUE_COMPLETION_PERCENT: pct, REVENUE_COMPLETION: 10 * pct, INVOICED: 0, ...extra,
});

describe("Stichtag beim Speichern", () => {
  it("schreibt den Stand mit dem Stichtag und vermerkt das Projekt als gepflegt", async () => {
    const db = welt({ progress: [pp(11, "2026-08-31", 30), pp(12, "2026-08-31", 5)] });
    const out = await svc.saveLeistungsstand(db, {
      projectId: 1, tenantId: TENANT, employeeId: 5, asOfDate: "2026-09-30",
      updates: [{ structure_id: 11, revenue_completion_percent: 60 }],
    });
    expect(out.as_of).toBe("2026-09-30");
    const neu = db._tables.PROJECT_PROGRESS.filter(r => r.AS_OF_DATE === "2026-09-30");
    expect(neu.map(r => Number(r.STRUCTURE_ID)).sort()).toEqual([10, 11, 12]);
    expect(Number(neu.find(r => Number(r.STRUCTURE_ID) === 11).REVENUE_COMPLETION_PERCENT)).toBe(60);
    const p = db._tables.PROJECT.find(x => x.ID === 1);
    expect(p).toMatchObject({ PROGRESS_REVIEWED_AS_OF: "2026-09-30", PROGRESS_REVIEWED_BY: 5 });
  });

  it("ohne Stichtag gilt heute (App-Zeitzone)", async () => {
    const db = welt();
    const out = await svc.saveLeistungsstand(db, {
      projectId: 1, tenantId: TENANT, updates: [{ structure_id: 12, revenue_completion_percent: 20 }],
    });
    expect(out.as_of).toBe("2026-10-03");
  });

  it("Stichtag in der Zukunft → 400", async () => {
    await expect(svc.saveLeistungsstand(welt(), {
      projectId: 1, tenantId: TENANT, asOfDate: "2026-10-04", updates: [{ structure_id: 11, revenue_completion_percent: 50 }],
    })).rejects.toMatchObject({ status: 400 });
  });

  it("ein Element mit späterem Stand sperrt nur sich selbst", async () => {
    // LP5 wurde am 2.10. schon gepflegt, LP2 nicht.
    const db = welt({ progress: [pp(11, "2026-08-31", 30), pp(12, "2026-10-02", 25)] });
    await expect(svc.saveLeistungsstand(db, {
      projectId: 1, tenantId: TENANT, asOfDate: "2026-09-30", updates: [{ structure_id: 12, revenue_completion_percent: 20 }],
    })).rejects.toMatchObject({ status: 409, code: "AS_OF_BEFORE_LATEST", message: expect.stringContaining("LP5 (02.10.2026)") });

    // LP2 geht — und fuer LP5 entsteht KEINE Zeile zum 30.09.
    const out = await svc.saveLeistungsstand(db, {
      projectId: 1, tenantId: TENANT, asOfDate: "2026-09-30", updates: [{ structure_id: 11, revenue_completion_percent: 45 }],
    });
    expect(out.skipped_later).toEqual(["12"]);
    const sep = db._tables.PROJECT_PROGRESS.filter(r => r.AS_OF_DATE === "2026-09-30").map(r => Number(r.STRUCTURE_ID));
    expect(sep).not.toContain(12);
    expect(sep).toContain(11);
  });

  it("Unverändert bestätigen schreibt die aktuellen Werte zum Stichtag", async () => {
    const db = welt({ progress: [pp(11, "2026-08-31", 40), pp(12, "2026-08-31", 10)] });
    const out = await svc.saveLeistungsstand(db, {
      projectId: 1, tenantId: TENANT, employeeId: 5, asOfDate: "2026-09-30", updates: [], confirmUnchanged: true,
    });
    expect(out).toMatchObject({ confirmed: true, as_of: "2026-09-30" });
    const sep = db._tables.PROJECT_PROGRESS.filter(r => r.AS_OF_DATE === "2026-09-30");
    expect(Number(sep.find(r => Number(r.STRUCTURE_ID) === 11).REVENUE_COMPLETION_PERCENT)).toBe(40);
    expect(db._tables.PROJECT.find(x => x.ID === 1).PROGRESS_REVIEWED_AS_OF).toBe("2026-09-30");
  });

  it("ohne Änderung und ohne Bestätigung passiert nichts", async () => {
    const db = welt();
    const out = await svc.saveLeistungsstand(db, { projectId: 1, tenantId: TENANT, updates: [] });
    expect(out.saved).toBe(0);
    expect(db._tables.PROJECT_PROGRESS).toHaveLength(0);
  });

  it("Controller reicht as_of_date, confirm_unchanged und den Mitarbeiter durch", async () => {
    const db = welt();
    const r = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await ctrl.saveLeistungsstand({ params: { id: 1 }, tenantId: TENANT, employeeId: 5, body: { as_of_date: "2026-09-30", confirm_unchanged: true } }, r, db);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ success: true, confirmed: true, as_of: "2026-09-30" });
  });
});

describe("Fortschreiben (Rechnung/Zahlung)", () => {
  it("übernimmt den Stichtag der Zeile, aus der es kopiert", async () => {
    // August-Stand am 31.08., September-Stand am 3.10. nachgetragen (AS_OF 30.09.).
    const db = welt({ progress: [
      pp(11, "2026-08-31", 30),
      { ...pp(11, "2026-09-30", 60), created_at: "2026-10-03T09:00:00Z" },
    ] });
    await insertProgressSnapshot(db, [{ TENANT_ID: TENANT, STRUCTURE_ID: 11, INVOICED: 250 }]);
    const last = db._tables.PROJECT_PROGRESS[db._tables.PROJECT_PROGRESS.length - 1];
    expect(last.AS_OF_DATE).toBe("2026-09-30");
    expect(Number(last.REVENUE_COMPLETION_PERCENT)).toBe(60);
    expect(Number(last.INVOICED)).toBe(250);
  });

  it("ohne Vorgänger bleibt der Stichtag dem Spaltenstandard überlassen", async () => {
    const db = welt();
    await insertProgressSnapshot(db, [{ TENANT_ID: TENANT, STRUCTURE_ID: 11, INVOICED: 100 }]);
    expect(db._tables.PROJECT_PROGRESS[0]).not.toHaveProperty("AS_OF_DATE");
  });
});

describe("Monatsrunde", () => {
  it("meine laufenden Projekte, Vorbelegung letztes Monatsende", async () => {
    const out = await runde.listRunde(welt(), { tenantId: TENANT, employeeId: 5 });
    expect(out.as_of).toBe("2026-09-30");
    // 3 ruht, 4 hat nur Nachweis-Elemente, 9 ist fremd, 2 leitet jemand anderes.
    expect(out.projects.map(p => p.ID)).toEqual([1]);
    expect(out.projects[0]).toMatchObject({ EDITABLE_COUNT: 2, DONE: false, OPEN_NET_TOTAL: 350, PROJECT_MANAGER: "S. Messina" });
    expect(out).toMatchObject({ total: 1, done: 0, mine_count: 2 });
  });

  it("alle laufenden, erledigt ab Stichtag", async () => {
    const out = await runde.listRunde(welt(), { tenantId: TENANT, employeeId: 5, scope: "all" });
    expect(out.projects.map(p => [p.ID, p.DONE])).toEqual([[1, false], [2, true]]);
    const oct = await runde.listRunde(welt(), { tenantId: TENANT, employeeId: 5, scope: "all", asOf: "2026-10-31" });
    expect(oct.projects.find(p => p.ID === 2).DONE).toBe(false);
  });

  it("Kurzfassung fällt auf alle zurück, wenn man keine Projekte leitet", async () => {
    const r = await runde.roundSummary(welt(), { tenantId: TENANT, employeeId: 99 });
    expect(r).toMatchObject({ scope: "all", total: 2, open: 1 });
  });

  it("lastMonthEnd über Jahres- und Schaltjahresgrenzen", () => {
    expect(runde.lastMonthEnd("2026-10-03")).toBe("2026-09-30");
    expect(runde.lastMonthEnd("2027-01-15")).toBe("2026-12-31");
    expect(runde.lastMonthEnd("2028-03-01")).toBe("2028-02-29");
  });
});
