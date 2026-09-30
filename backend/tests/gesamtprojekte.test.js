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

// ── Stufe 2: neue Projekte im Gesamtprojekt, abgeleitete Nummer ────────────

describe("Abgeleitete Projektnummer", () => {
  test("zählt nach der höchsten vergebenen weiter; das Projekt mit dem Kürzel selbst ist 01", async () => {
    const db = welt();
    db._tables.PROJECT.push({ ID: 20, TENANT_ID: T, ABBR: "2026-014-02", PROJECT_GROUP_ID: 1 });
    expect(await svc.suggestMemberAbbr(db, { tenantId: T, groupId: 1 })).toBe("2026-014-03");
  });

  test("ohne Projekte mit dem Kürzel beginnt sie bei 01", async () => {
    expect(await svc.suggestMemberAbbr(welt(), { tenantId: T, groupId: 2 })).toBe("2026-020-01");
  });

  test("Nummern fremder Mandanten zählen nicht, eigene Lücken werden nicht gefüllt", async () => {
    const db = welt();
    db._tables.PROJECT.push(
      { ID: 60, TENANT_ID: F, ABBR: "2026-020-07" },
      { ID: 21, TENANT_ID: T, ABBR: "2026-020-03" },
    );
    expect(await svc.suggestMemberAbbr(db, { tenantId: T, groupId: 2 })).toBe("2026-020-04");
  });

  test("ohne Kürzel kein Vorschlag, fremdes Gesamtprojekt 404", async () => {
    const db = welt();
    db._tables.PROJECT_GROUP.find((g) => g.ID === 2).ABBR = null;
    expect(await svc.suggestMemberAbbr(db, { tenantId: T, groupId: 2 })).toBeNull();
    expect((await fehler(svc.suggestMemberAbbr(db, { tenantId: T, groupId: 9 })))?.status).toBe(404);
  });

  test("Gesamtprojekt und Nummer für ein neues Projekt: fremd 400, vergeben 409", async () => {
    const db = welt();
    expect((await fehler(svc.newProjectGroupAndAbbr(db, { tenantId: T, body: { project_group_id: 9 } })))?.status).toBe(400);
    expect((await fehler(svc.newProjectGroupAndAbbr(db, { tenantId: T, body: { project_abbr: "2026-031" } })))?.status).toBe(409);
    // Dieselbe Nummer bei einem fremden Mandanten sperrt nicht
    expect(await svc.newProjectGroupAndAbbr(db, { tenantId: T, body: { project_group_id: 1, project_abbr: " F-1 " } }))
      .toEqual({ groupId: 1, abbr: "F-1" });
    expect(await svc.newProjectGroupAndAbbr(db, { tenantId: T, body: {} })).toEqual({ groupId: null, abbr: null });
  });
});

describe("Neues Projekt im Gesamtprojekt", () => {
  const body = {
    company_id: 1, name: "Schule Nord Außenanlagen", project_status_id: 1, project_manager_id: 5,
    address_id: 3, contact_id: 4,
  };

  function mitRpc(db) {
    const calls = [];
    db.rpc = async (name) => { calls.push(name); return { data: "P-2026-099", error: null }; };
    return calls;
  }

  test("abgeleitete Nummer: kein Griff in den Nummernkreis, Zuordnung gesetzt", async () => {
    const db = welt();
    const rpc = mitRpc(db);
    await projekte.createProject(db, { tenantId: T, body: { ...body, project_group_id: 1, project_abbr: "2026-014-02" } });
    const neu = db._tables.PROJECT.find((p) => p.NAME === "Schule Nord Außenanlagen");
    expect(neu).toMatchObject({ ABBR: "2026-014-02", PROJECT_GROUP_ID: 1, TENANT_ID: T });
    expect(rpc).toEqual([]);
  });

  test("ohne Nummer: Nummernkreis; ohne Gesamtprojekt keine Spalte in der Zeile", async () => {
    const db = welt();
    const rpc = mitRpc(db);
    await projekte.createProject(db, { tenantId: T, body });
    const neu = db._tables.PROJECT.find((p) => p.NAME === "Schule Nord Außenanlagen");
    expect(neu.ABBR).toBe("P-2026-099");
    // Im Deploy-Fenster kennt PostgREST die Spalte noch nicht — nur mitschicken, wenn gewählt.
    expect("PROJECT_GROUP_ID" in neu).toBe(false);
    expect(rpc).toEqual(["next_project_number"]);
  });

  test("fremdes Gesamtprojekt: 400, kein Projekt, keine verbrauchte Nummer", async () => {
    const db = welt();
    const rpc = mitRpc(db);
    const e = await fehler(projekte.createProject(db, { tenantId: T, body: { ...body, project_group_id: 9 } }));
    expect(e?.status).toBe(400);
    expect(db._tables.PROJECT.some((p) => p.NAME === "Schule Nord Außenanlagen")).toBe(false);
    expect(rpc).toEqual([]);
  });

  test("Folgeprojekt (Kopie) mit abgeleiteter Nummer bleibt im Gesamtprojekt der Vorlage", async () => {
    const db = welt({ PROJECT_STRUCTURE: [], EMPLOYEE2PROJECT: [], CONTRACT: [] });
    const rpc = mitRpc(db);
    const r = await projekte.copyProject(db, { projectId: 10, tenantId: T, body: { project_abbr: "2026-014-02" } });
    const neu = db._tables.PROJECT.find((p) => p.ID === r.project.ID);
    expect(neu).toMatchObject({ ABBR: "2026-014-02", PROJECT_GROUP_ID: 1 });
    expect(rpc).toEqual([]);
  });
});

describe("Adresse: verwendet in Gesamtprojekten", () => {
  const adressen = require("../services/adressen");

  test("Auftraggeber-Gesamtprojekte und die Gesamtprojekte ihrer Projekte, je Projekt der Name", async () => {
    const db = welt({ OFFER: [], CONTRACT: [], INVOICE: [], ADVANCE_INVOICE: [], NACHTRAG: [] });
    // Adresse 3 ist Auftraggeber von Gruppe 1 und von Projekt 12 (Gruppe 2)
    db._tables.PROJECT.find((p) => p.ID === 12).ADDRESS_ID = 3;
    const links = await adressen.addressLinks(db, { tenantId: T, addressId: 3, can: () => true });
    expect(links.groups.map((g) => g.NAME)).toEqual(["Rathaus", "Schule Nord"]);
    expect(links.projects).toEqual([expect.objectContaining({ ID: 12, GROUP_NAME: "Rathaus" })]);
  });

  test("ohne projects.view keine Gesamtprojekte", async () => {
    const db = welt({ OFFER: [], CONTRACT: [], INVOICE: [], ADVANCE_INVOICE: [], NACHTRAG: [] });
    const links = await adressen.addressLinks(db, { tenantId: T, addressId: 3, can: (k) => k !== "projects.view" });
    expect(links.groups).toEqual([]);
  });
});

describe("Rechnungsempfänger je Projekt", () => {
  test("nur mit Anfrage (Recht auf Verträge), aus dem Vertrag des Projekts", async () => {
    const db = welt({
      CONTRACT: [
        { ID: 70, TENANT_ID: T, PROJECT_ID: 10, INVOICE_ADDRESS_ID: 3 },
        { ID: 71, TENANT_ID: T, PROJECT_ID: 11, INVOICE_ADDRESS_ID: 8 },
      ],
      ADDRESS: [
        { ID: 3, TENANT_ID: T, ADDRESS_NAME_1: "Stadt Musterstadt" },
        { ID: 8, TENANT_ID: T, ADDRESS_NAME_1: "Förderverein Schule Nord" },
      ],
    });
    const ohne = await svc.getGroup(db, { tenantId: T, id: 1 });
    expect("INVOICE_ADDRESS_NAME" in ohne.PROJECTS[0]).toBe(false);
    const mit = await svc.getGroup(db, { tenantId: T, id: 1, withInvoiceAddress: true });
    expect(Object.fromEntries(mit.PROJECTS.map((p) => [p.ID, p.INVOICE_ADDRESS_NAME])))
      .toEqual({ 10: "Stadt Musterstadt", 11: "Förderverein Schule Nord" });
  });
});

describe("Report: Leistungsphasen über das Gesamtprojekt", () => {
  // Stufenvertrag: LPH 1 im Projekt 10, LPH 5 im Projekt 11 (beide Gruppe 1),
  // LPH 2 im Projekt 12 (Gruppe 2).
  function lphWelt() {
    const db = reportWelt();
    db._tables.PROJECT_STRUCTURE = [
      { ID: 100, TENANT_ID: T, PROJECT_ID: 10, FATHER_ID: null, ABBR: "LPH 1", FEE_CALC_PHASE_ID: 1 },
      { ID: 101, TENANT_ID: T, PROJECT_ID: 10, FATHER_ID: 100, ABBR: "1.1" },
      { ID: 110, TENANT_ID: T, PROJECT_ID: 11, FATHER_ID: null, ABBR: "LPH 5", FEE_CALC_PHASE_ID: 5 },
      { ID: 111, TENANT_ID: T, PROJECT_ID: 11, FATHER_ID: 110, ABBR: "5.1" },
      { ID: 120, TENANT_ID: T, PROJECT_ID: 12, FATHER_ID: null, ABBR: "LPH 2", FEE_CALC_PHASE_ID: 2 },
      { ID: 121, TENANT_ID: T, PROJECT_ID: 12, FATHER_ID: 120, ABBR: "2.1" },
    ];
    db._tables.VW_REPORT_PROJECT_DETAIL_STRUCTURE = [
      { TENANT_ID: T, PROJECT_ID: 10, STRUCTURE_ID: 101, IS_LEAF: true, HONORAR_NET: 20000, EARNED_VALUE_NET: 20000, HOURS_TOTAL: 100, COST_TOTAL: 9000 },
      { TENANT_ID: T, PROJECT_ID: 11, STRUCTURE_ID: 111, IS_LEAF: true, HONORAR_NET: 80000, EARNED_VALUE_NET: 8000, HOURS_TOTAL: 40, COST_TOTAL: 3000 },
      { TENANT_ID: T, PROJECT_ID: 12, STRUCTURE_ID: 121, IS_LEAF: true, HONORAR_NET: 5000, EARNED_VALUE_NET: 0, HOURS_TOTAL: 0, COST_TOTAL: 0 },
    ];
    return db;
  }

  test("ohne group_id: alle Projekte", async () => {
    const r = await report(lphWelt(), "/reports/phases/matrix");
    expect(r.body.data.phases.map((p) => p.num)).toEqual([1, 2, 5]);
    expect(r.body.meta).toBeNull();
  });

  test("mit group_id: nur dessen Projekte — LPH 1 und 5 aus zwei Verträgen als ein Bild", async () => {
    const r = await report(lphWelt(), "/reports/phases/matrix?group_id=1");
    expect(r.status).toBe(200);
    expect(r.body.data.projects.map((p) => p.PROJECT_ID)).toEqual([10, 11]);
    expect(r.body.data.byPhase.map((p) => [p.num, p.HONORAR_NET])).toEqual([[1, 20000], [5, 80000]]);
    expect(r.body.meta).toEqual({ members_total: 2, members_visible: 2 });
  });

  test("Reporting-Scope greift auch hier", async () => {
    const r = await report(lphWelt(), "/reports/phases/matrix?group_id=1", { scopeAll: false });
    expect(r.body.data.projects.map((p) => p.PROJECT_ID)).toEqual([10]);
    expect(r.body.meta).toEqual({ members_total: 2, members_visible: 1 });
  });

  test("fremdes Gesamtprojekt: 404", async () => {
    expect((await report(lphWelt(), "/reports/phases/matrix?group_id=9")).status).toBe(404);
  });
});
