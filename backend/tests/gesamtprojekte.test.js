"use strict";

// Gesamtprojekte (Migration 0181, docs/GESAMTPROJEKT_CONCEPT.md).
// Festgehalten wird, was an der Klammer schiefgehen kann:
//   - Quoten als Mittelwert statt aus Summen (ein kleiner Nachtrag zaehlte
//     dann so viel wie der Hauptvertrag),
//   - Zuordnung ueber die Mandantengrenze (der Fremdschluessel prueft sie nicht),
//   - Loeschen, das mehr loescht als die Klammer,
//   - Summen ueber Projekte ausserhalb des Reporting-Scopes,
//   - der Gesamtverlauf, der den Scope bisher gar nicht kannte.

const express = require("express");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const svc = require("../services/gesamtprojekte");
const projekte = require("../services/projekte");
const makeReports = require("../routes/reports");

const T = 7, F = 99;

function welt(extra = {}) {
  return makeFakeSupabase({
    PROJECT_GROUP: [
      { ID: 1, TENANT_ID: T, ABBR: "2026-014", NAME: "Schule Nord", ADDRESS_ID: 3, MANAGER_ID: 5 },
      { ID: 2, TENANT_ID: T, ABBR: "2026-020", NAME: "Rathaus" },
      { ID: 9, TENANT_ID: F, ABBR: "X", NAME: "Fremdes Vorhaben" },
    ],
    PROJECT: [
      { ID: 10, TENANT_ID: T, ABBR: "2026-014", NAME: "Schule Nord LPH 1–4", PROJECT_GROUP_ID: 1, PROJECT_MANAGER_ID: 5 },
      { ID: 11, TENANT_ID: T, ABBR: "2026-031", NAME: "Schule Nord LPH 5–8", PROJECT_GROUP_ID: 1, PROJECT_MANAGER_ID: 6 },
      { ID: 12, TENANT_ID: T, ABBR: "2026-040", NAME: "Rathaus Umbau", PROJECT_GROUP_ID: 2 },
      { ID: 13, TENANT_ID: T, ABBR: "2026-041", NAME: "Kita Süd", PROJECT_GROUP_ID: null },
      { ID: 50, TENANT_ID: F, ABBR: "F-1", NAME: "Fremd", PROJECT_GROUP_ID: 9 },
    ],
    ADDRESS: [{ ID: 3, TENANT_ID: T, ADDRESS_NAME_1: "Stadt Musterstadt" }, { ID: 60, TENANT_ID: F, ADDRESS_NAME_1: "Fremd" }],
    EMPLOYEE: [{ ID: 5, TENANT_ID: T, ABBR: "AB", FIRST_NAME: "Anna", LAST_NAME: "Berg" }, { ID: 70, TENANT_ID: F, ABBR: "ZZ" }],
    ...extra,
  });
}

async function fehler(p) {
  try { await p; return null; } catch (e) { return e; }
}

describe("aggregateKpis — Quoten aus Summen", () => {
  test("Leistungsstand und Kostenquote gewichten nach Betrag, nicht je Projekt", () => {
    const t = svc.aggregateKpis([
      // Hauptvertrag: 400.000 Honorar, 50 % geleistet
      { BUDGET_TOTAL_NET: 400000, LEISTUNGSSTAND_VALUE: 200000, COST_TOTAL: 120000, BILLED_NET_TOTAL: 150000 },
      // Nachtrag: 5.000 Honorar, 100 % geleistet
      { BUDGET_TOTAL_NET: 5000, LEISTUNGSSTAND_VALUE: 5000, COST_TOTAL: 6000, BILLED_NET_TOTAL: 0 },
    ]);
    expect(t.BUDGET_TOTAL_NET).toBe(405000);
    // Mittelwert der Prozente waere 75 % — richtig ist 205.000 / 405.000
    expect(t.LEISTUNGSSTAND_PERCENT).toBeCloseTo(50.62, 2);
    expect(t.COST_RATIO).toBeCloseTo(126000 / 205000, 6);
    expect(t.BILLED_NET_TOTAL).toBe(150000);
    expect(t.PROJECT_COUNT).toBe(2);
  });

  test("ohne Grundlage kein Wert statt 0", () => {
    const t = svc.aggregateKpis([]);
    expect(t.BUDGET_TOTAL_NET).toBe(0);
    expect(t.LEISTUNGSSTAND_PERCENT).toBeNull();
    expect(t.COST_RATIO).toBeNull();
  });

  test("null und Text in Zeilen zaehlen als 0, nicht als NaN", () => {
    const t = svc.aggregateKpis([{ BUDGET_TOTAL_NET: null, OPEN_NET_TOTAL: "12.5" }, { BUDGET_TOTAL_NET: 100 }]);
    expect(t.BUDGET_TOTAL_NET).toBe(100);
    expect(t.OPEN_NET_TOTAL).toBe(12.5);
  });
});

describe("Stammdaten des Gesamtprojekts", () => {
  test("Liste: nur eigene, mit Anzahl, Auftraggeber und Leitung", async () => {
    const groups = await svc.listGroups(welt(), { tenantId: T });
    expect(groups.map((g) => g.NAME)).toEqual(["Rathaus", "Schule Nord"]);
    const nord = groups.find((g) => g.ID === 1);
    expect(nord).toMatchObject({ PROJECT_COUNT: 2, ADDRESS_NAME: "Stadt Musterstadt", MANAGER_NAME: "Anna Berg" });
    expect(nord.PROJECT_IDS.sort()).toEqual([10, 11]);
  });

  test("fremdes Gesamtprojekt: 404, als waere es nicht da", async () => {
    const e = await fehler(svc.getGroup(welt(), { tenantId: T, id: 9 }));
    expect(e?.status).toBe(404);
  });

  test("Anlegen: Name Pflicht, Leerzeichen zaehlen nicht", async () => {
    const e = await fehler(svc.createGroup(welt(), { tenantId: T, body: { name: "   " } }));
    expect(e).toMatchObject({ status: 400, message: "Name ist erforderlich." });
  });

  test("Anlegen: Adresse und Leitung eines fremden Bueros werden abgewiesen", async () => {
    expect((await fehler(svc.createGroup(welt(), { tenantId: T, body: { name: "X", address_id: 60 } })))?.status).toBe(400);
    expect((await fehler(svc.createGroup(welt(), { tenantId: T, body: { name: "X", manager_id: 70 } })))?.status).toBe(400);
  });

  test("Anlegen mit Projekten: TENANT_ID in der Zeile, Projekte zugeordnet", async () => {
    const db = welt();
    const { group } = await svc.createGroup(db, { tenantId: T, body: { name: " Kita ", abbr: "K-1", project_ids: [13] } });
    expect(group).toMatchObject({ NAME: "Kita", ABBR: "K-1", PROJECT_IDS: [13] });
    expect(db._tables.PROJECT_GROUP.find((g) => g.ID === group.ID).TENANT_ID).toBe(T);
  });

  test("Aendern: Name darf sich aendern, aber nicht leeren", async () => {
    const db = welt();
    expect((await fehler(svc.patchGroup(db, { tenantId: T, id: 1, body: { name: "" } })))?.status).toBe(400);
    const g = await svc.patchGroup(db, { tenantId: T, id: 1, body: { notes: "BV mit zwei Stufen" } });
    expect(g).toMatchObject({ NAME: "Schule Nord", NOTES: "BV mit zwei Stufen" });
  });

  test("Loeschen loest nur die Klammer — die Projekte bleiben", async () => {
    const db = welt();
    const r = await svc.deleteGroup(db, { tenantId: T, id: 1 });
    expect(r).toEqual({ deleted: true, unlinked: 2 });
    expect(db._tables.PROJECT_GROUP.some((g) => g.ID === 1)).toBe(false);
    const p = db._tables.PROJECT.filter((x) => x.ID === 10 || x.ID === 11);
    expect(p).toHaveLength(2);
    expect(p.every((x) => x.PROJECT_GROUP_ID === null)).toBe(true);
  });

  test("Loeschen eines fremden Gesamtprojekts: 404, fremde Projekte unberuehrt", async () => {
    const db = welt();
    expect((await fehler(svc.deleteGroup(db, { tenantId: T, id: 9 })))?.status).toBe(404);
    expect(db._tables.PROJECT.find((x) => x.ID === 50).PROJECT_GROUP_ID).toBe(9);
  });
});

describe("Zuordnung", () => {
  test("setMembers: genau diese Liste — entfernt, fuegt hinzu, meldet Umhaengen", async () => {
    const db = welt();
    const r = await svc.setMembers(db, { tenantId: T, id: 1, projectIds: [10, 12] });
    expect(r.added).toBe(1);
    expect(r.removed).toBe(1);
    expect(r.moved).toEqual([expect.objectContaining({ ID: 12, FROM_GROUP_ID: 2, FROM_GROUP_NAME: "Rathaus" })]);
    const by = Object.fromEntries(db._tables.PROJECT.map((p) => [p.ID, p.PROJECT_GROUP_ID]));
    expect(by).toMatchObject({ 10: 1, 11: null, 12: 1, 13: null, 50: 9 });
  });

  test("setMembers: ein fremdes Projekt in der Liste → 400, nichts geaendert", async () => {
    const db = welt();
    const e = await fehler(svc.setMembers(db, { tenantId: T, id: 1, projectIds: [10, 50] }));
    expect(e?.status).toBe(400);
    expect(db._tables.PROJECT.find((x) => x.ID === 50).PROJECT_GROUP_ID).toBe(9);
    expect(db._tables.PROJECT.find((x) => x.ID === 11).PROJECT_GROUP_ID).toBe(1);
  });

  test("setMembers auf ein fremdes Gesamtprojekt: 404", async () => {
    expect((await fehler(svc.setMembers(welt(), { tenantId: T, id: 9, projectIds: [13] })))?.status).toBe(404);
  });

  test("Projektdaten: fremdes Gesamtprojekt → 400, eigenes und null gehen", async () => {
    const db = welt({ PROJECT_STATUS: [], PROJECT_TYPE: [] });
    const e = await fehler(projekte.patchProject(db, { id: 13, tenantId: T, body: { project_group_id: 9 } }));
    expect(e?.status).toBe(400);
    expect(db._tables.PROJECT.find((x) => x.ID === 13).PROJECT_GROUP_ID).toBeNull();

    const ok = await projekte.patchProject(db, { id: 13, tenantId: T, body: { project_group_id: 2 } });
    expect(ok.PROJECT_GROUP_ID).toBe(2);
    expect(db._tables.PROJECT.find((x) => x.ID === 13).PROJECT_GROUP_ID).toBe(2);

    await projekte.patchProject(db, { id: 13, tenantId: T, body: { project_group_id: null } });
    expect(db._tables.PROJECT.find((x) => x.ID === 13).PROJECT_GROUP_ID).toBeNull();
  });

  test("Projektliste traegt das Gesamtprojekt je Zeile", async () => {
    const rows = await projekte.listProjectsFull(welt(), { tenantId: T });
    const by = Object.fromEntries(rows.map((r) => [r.ID, r.GROUP_NAME]));
    expect(by).toEqual({ 10: "Schule Nord", 11: "Schule Nord", 12: "Rathaus", 13: "" });
  });

  test("Liste ohne Migration 0181 (Deploy-Fenster): leer statt Fehler", async () => {
    const db = welt();
    const orig = db.from.bind(db);
    db.from = (t) => {
      const b = orig(t);
      if (t !== "PROJECT") return b;
      const not = b.not.bind(b);
      b.not = (col, ...rest) => {
        if (col === "PROJECT_GROUP_ID") {
          return { then: (res) => Promise.resolve({ data: null, error: { message: "column PROJECT.PROJECT_GROUP_ID does not exist" } }).then(res) };
        }
        return not(col, ...rest);
      };
      return b;
    };
    const rows = await projekte.listProjectsFull(db, { tenantId: T });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.PROJECT_GROUP_ID === null)).toBe(true);
  });
});

// ── Reports ─────────────────────────────────────────────────────────────────

/** Report-Zeilen je Projekt (Form von VW_REPORT_PROJECT_DETAIL). */
function reportWelt() {
  return welt({
    VW_REPORT_PROJECT_DETAIL: [
      { TENANT_ID: T, PROJECT_ID: 10, ABBR: "2026-014", BUDGET_TOTAL_NET: 400000, LEISTUNGSSTAND_VALUE: 200000, COST_TOTAL: 100000, BILLED_NET_TOTAL: 150000 },
      { TENANT_ID: T, PROJECT_ID: 11, ABBR: "2026-031", BUDGET_TOTAL_NET: 300000, LEISTUNGSSTAND_VALUE: 30000,  COST_TOTAL: 40000,  BILLED_NET_TOTAL: 0 },
      { TENANT_ID: T, PROJECT_ID: 12, ABBR: "2026-040", BUDGET_TOTAL_NET: 90000,  LEISTUNGSSTAND_VALUE: 9000,   COST_TOTAL: 5000,   BILLED_NET_TOTAL: 0 },
    ],
    PROJECT_STRUCTURE: [
      { ID: 100, TENANT_ID: T, PROJECT_ID: 10, FATHER_ID: null, BILLING_TYPE_ID: 1, REVENUE: 1000, EXTRAS: 0 },
      { ID: 110, TENANT_ID: T, PROJECT_ID: 11, FATHER_ID: null, BILLING_TYPE_ID: 1, REVENUE: 7000, EXTRAS: 0 },
    ],
    PROJECT_PROGRESS: [], BOOKING: [], ADVANCE_INVOICE: [], INVOICE: [], PAYMENT: [],
  });
}

/** Ruft den Report-Router auf. scopeAll=false: nur Projekte, die employeeId leitet. */
async function report(db, url, { scopeAll = true, employeeId = 5 } = {}) {
  const app = express();
  app.use((req, _res, next) => {
    req.tenantId = T;
    req.employeeId = employeeId;
    req._permissionsUnrestricted = false;
    req.permissions = new Set(["reports.view", ...(scopeAll ? ["reports.scope.all"] : [])]);
    next();
  });
  app.use("/reports", makeReports(db));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

describe("Report: Gesamtprojekt", () => {
  test("summiert seine Projekte, Quoten aus Summen", async () => {
    const r = await report(reportWelt(), "/reports/groups/1/summary");
    expect(r.status).toBe(200);
    expect(r.body.data.members.map((m) => m.PROJECT_ID).sort()).toEqual([10, 11]);
    expect(r.body.data.totals).toMatchObject({ BUDGET_TOTAL_NET: 700000, BILLED_NET_TOTAL: 150000 });
    expect(r.body.data.totals.LEISTUNGSSTAND_PERCENT).toBeCloseTo((230000 / 700000) * 100, 2);
    expect(r.body.meta).toMatchObject({ members_total: 2, members_visible: 2, scope: null });
  });

  test("ausserhalb des Reporting-Scopes: nur sichtbare Projekte, keine Summe der verborgenen", async () => {
    // Mitarbeiter 5 leitet nur Projekt 10
    const r = await report(reportWelt(), "/reports/groups/1/summary", { scopeAll: false });
    expect(r.status).toBe(200);
    expect(r.body.data.members.map((m) => m.PROJECT_ID)).toEqual([10]);
    expect(r.body.data.totals.BUDGET_TOTAL_NET).toBe(400000);
    expect(r.body.meta).toMatchObject({ members_total: 2, members_visible: 1, scope: "permission" });
    expect(JSON.stringify(r.body)).not.toContain("300000");
  });

  test("fremdes Gesamtprojekt: 404", async () => {
    expect((await report(reportWelt(), "/reports/groups/9/summary")).status).toBe(404);
  });

  test("Alle Projekte: Gesamtprojekt je Zeile", async () => {
    const r = await report(reportWelt(), "/reports/projects/list");
    const by = Object.fromEntries(r.body.data.map((x) => [x.PROJECT_ID, x.GROUP_NAME]));
    expect(by).toEqual({ 10: "Schule Nord", 11: "Schule Nord", 12: "Rathaus" });
  });
});

describe("Report: Gesamtverlauf beachtet den Reporting-Scope", () => {
  const honorarHeute = (body) => body.data[body.data.length - 1]?.HONORAR_NET;

  test("mit reports.scope.all: alle Projekte", async () => {
    const r = await report(reportWelt(), "/reports/projects/timeline");
    expect(honorarHeute(r.body)).toBe(8000);
  });

  test("ohne reports.scope.all und ohne project_ids: nur eigene Projekte", async () => {
    const r = await report(reportWelt(), "/reports/projects/timeline", { scopeAll: false });
    expect(honorarHeute(r.body)).toBe(1000);
  });

  test("ohne reports.scope.all mit fremden project_ids: nichts", async () => {
    const r = await report(reportWelt(), "/reports/projects/timeline?project_ids=11", { scopeAll: false });
    expect(r.body.data).toEqual([]);
  });

  test("ohne reports.scope.all: gemischte project_ids werden auf den Scope geschnitten", async () => {
    const r = await report(reportWelt(), "/reports/projects/timeline?project_ids=10,11", { scopeAll: false });
    expect(honorarHeute(r.body)).toBe(1000);
  });
});
