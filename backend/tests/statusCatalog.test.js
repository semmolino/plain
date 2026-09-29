"use strict";

// Projekt- und Angebotsstatus je Büro (UI-Pilot Runde 13, Migration 0176):
// jedes Büro pflegt seine eigene Liste, löscht nur Unbenutztes, und kein Weg
// hängt einen Status eines anderen Büros an ein Projekt oder Angebot.
const express = require("express");
const makeRouter = require("../routes/stammdaten");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const st = require("../services/statusCatalog");
const angebote = require("../services/angebote");
const projekte = require("../services/projekte");
const monatsabschluss = require("../services/monatsabschluss");
const notificationSchedule = require("../services/notificationSchedule");

const T = 7, F = 99;

function tables() {
  return {
    PROJECT_STATUS: [
      { ID: 1, TENANT_ID: T, ABBR: "Laufend", SORT_ORDER: 10 },
      { ID: 2, TENANT_ID: T, ABBR: "Abgeschlossen", SORT_ORDER: 20 },
      { ID: 3, TENANT_ID: T, ABBR: "Akquise", SORT_ORDER: 5 },
      { ID: 4, TENANT_ID: T, ABBR: "Ruhend", SORT_ORDER: 30 },
      { ID: 90, TENANT_ID: F, ABBR: "Fremd", SORT_ORDER: 10 },
    ],
    OFFER_STATUS: [
      { ID: 11, TENANT_ID: T, ABBR: "In Bearbeitung", SORT_ORDER: 10, CODE: null },
      { ID: 12, TENANT_ID: T, ABBR: "Beauftragt", SORT_ORDER: 20, CODE: "ORDERED" },
      { ID: 13, TENANT_ID: T, ABBR: "Abgelehnt", SORT_ORDER: 30, CODE: "REJECTED" },
      { ID: 91, TENANT_ID: F, ABBR: "Fremd", SORT_ORDER: 10, CODE: "ORDERED" },
    ],
    PROJECT: [
      { ID: 100, TENANT_ID: T, PROJECT_STATUS_ID: 1 },
      { ID: 101, TENANT_ID: T, PROJECT_STATUS_ID: 1 },
      { ID: 102, TENANT_ID: F, PROJECT_STATUS_ID: 90 },
    ],
    OFFER: [{ ID: 200, TENANT_ID: T, OFFER_STATUS_ID: 11 }],
    TENANT_SETTINGS: [
      { TENANT_ID: T, KEY: "default_project_status_id", VALUE: "2" },
      { TENANT_ID: T, KEY: "monatsabschluss_statuses", VALUE: "[3]" },
    ],
    NOTIFICATION_SCHEDULE_CONFIG: [],
  };
}

function buildApp(supabase, permissions) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T; req.employeeId = 1;
    req.permissions = new Set(permissions);
    req.hasPermission = (k) => req.permissions.has(k);
    next();
  });
  app.use("/stammdaten", makeRouter(supabase));
  return app;
}
async function request(supabase, permissions, method, path, body) {
  const server = buildApp(supabase, permissions).listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { "content-type": "application/json" }, body: body != null ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally { server.close(); }
}
const EDIT = ["settings.basedata.edit"];

describe("Liste je Büro", () => {
  test("nur eigene Status, in der gepflegten Reihenfolge", async () => {
    const rows = await st.listStatuses(makeFakeSupabase(tables()), T, "project");
    expect(rows.map(r => r.ABBR)).toEqual(["Akquise", "Laufend", "Abgeschlossen", "Ruhend"]);
  });

  test("Einstellungen sehen, wo ein Status hängt", async () => {
    const r = await request(makeFakeSupabase(tables()), ["settings.basedata.view"], "GET", "/stammdaten/status/project");
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.data.map(x => [x.ABBR, x.USAGE.refs]));
    expect(by.Laufend).toEqual(["2 Projekten"]);
    expect(by.Abgeschlossen).toEqual(["Vorbelegung"]);
    expect(by.Akquise).toEqual(["„laufende Projekte“ im Monatsabschluss"]);
    expect(by.Ruhend).toEqual([]);
  });

  test("ohne Stammdaten-Recht kein Zugriff auf die Pflege", async () => {
    const sb = makeFakeSupabase(tables());
    expect((await request(sb, [], "GET", "/stammdaten/status/project")).status).toBe(403);
    expect((await request(sb, ["settings.basedata.view"], "POST", "/stammdaten/status/project", { abbr: "Neu" })).status).toBe(403);
    expect((await request(sb, EDIT, "GET", "/stammdaten/status/unsinn")).status).toBe(404);
  });
});

describe("Anlegen, umbenennen, sortieren", () => {
  test("neuer Status landet am Ende, ein Code lässt sich nicht einschleusen", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, EDIT, "POST", "/stammdaten/status/offer", { abbr: "  Versendet ", code: "ORDERED" });
    expect(r.status).toBe(200);
    const row = sb._tables.OFFER_STATUS.find(x => x.ABBR === "Versendet");
    expect(row).toMatchObject({ TENANT_ID: T, SORT_ORDER: 40 });
    expect(row.CODE).toBeUndefined();
  });

  test("gleicher Name (auch anders geschrieben) ist 409, leer ist 400", async () => {
    const sb = makeFakeSupabase(tables());
    expect((await request(sb, EDIT, "POST", "/stammdaten/status/project", { abbr: "laufend" })).status).toBe(409);
    expect((await request(sb, EDIT, "POST", "/stammdaten/status/project", { abbr: "  " })).status).toBe(400);
    // Derselbe Name wie im fremden Büro ist erlaubt
    expect((await request(sb, EDIT, "POST", "/stammdaten/status/project", { abbr: "Fremd" })).status).toBe(200);
  });

  test("Systemstatus lässt sich umbenennen; ein fremder Status ist 404", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, EDIT, "PATCH", "/stammdaten/status/offer/12", { abbr: "Auftrag erteilt" });
    expect(r.status).toBe(200);
    expect(sb._tables.OFFER_STATUS.find(x => x.ID === 12)).toMatchObject({ ABBR: "Auftrag erteilt", CODE: "ORDERED" });
    expect((await request(sb, EDIT, "PATCH", "/stammdaten/status/offer/91", { abbr: "X" })).status).toBe(404);
    expect(sb._tables.OFFER_STATUS.find(x => x.ID === 91).ABBR).toBe("Fremd");
  });

  test("Reihenfolge nur mit genau den eigenen Status", async () => {
    const sb = makeFakeSupabase(tables());
    expect((await request(sb, EDIT, "PUT", "/stammdaten/status/project/order", { ids: [1, 2, 3] })).status).toBe(409);
    expect((await request(sb, EDIT, "PUT", "/stammdaten/status/project/order", { ids: [1, 2, 3, 90] })).status).toBe(409);
    const ok = await request(sb, EDIT, "PUT", "/stammdaten/status/project/order", { ids: [4, 3, 2, 1] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.map(r => r.ABBR)).toEqual(["Ruhend", "Akquise", "Abgeschlossen", "Laufend"]);
  });
});

describe("Löschen nur, wenn nichts daran hängt", () => {
  test.each([
    [1, "2 Projekten"],
    [2, "Vorbelegung"],
    [3, "Monatsabschluss"],
  ])("Projektstatus %i: 409 mit „%s“", async (id, text) => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, EDIT, "DELETE", `/stammdaten/status/project/${id}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toContain(text);
    expect(sb._tables.PROJECT_STATUS.some(x => x.ID === id)).toBe(true);
  });

  test("Erinnerungen halten einen Status ebenfalls fest", async () => {
    const t = tables();
    t.NOTIFICATION_SCHEDULE_CONFIG = [{ TENANT_ID: T, TYPE_KEY: "leistungsstand_reminder", PROJECT_STATUS_IDS: [4] }];
    const r = await request(makeFakeSupabase(t), EDIT, "DELETE", "/stammdaten/status/project/4");
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("Erinnerungen");
  });

  test("Beauftragt und Abgelehnt sind nicht löschbar", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, EDIT, "DELETE", "/stammdaten/status/offer/13");
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/umbenennen geht/);
  });

  test("unbenutzt: weg; fremd: 404", async () => {
    const sb = makeFakeSupabase(tables());
    expect((await request(sb, EDIT, "DELETE", "/stammdaten/status/project/90")).status).toBe(404);
    expect((await request(sb, EDIT, "DELETE", "/stammdaten/status/project/4")).status).toBe(200);
    expect(sb._tables.PROJECT_STATUS.some(x => x.ID === 4)).toBe(false);
    expect(sb._tables.PROJECT_STATUS.some(x => x.ID === 90)).toBe(true);
  });
});

describe("Kein fremder Status an Projekt, Angebot oder Einstellung", () => {
  test("Projekt ändern mit fremdem Status ist 400", async () => {
    const sb = makeFakeSupabase(tables());
    await expect(projekte.patchProject(sb, { id: 100, tenantId: T, body: { project_status_id: 90 } }))
      .rejects.toMatchObject({ status: 400, message: "Projektstatus nicht gefunden." });
    expect(sb._tables.PROJECT.find(p => p.ID === 100).PROJECT_STATUS_ID).toBe(1);
  });

  test("Angebot ändern mit fremdem Status ist 400", async () => {
    const sb = makeFakeSupabase(tables());
    await expect(angebote.updateOffer(sb, { tenantId: T, offerId: 200, body: { offer_status_id: 91 } }))
      .rejects.toMatchObject({ status: 400, message: "Angebotsstatus nicht gefunden." });
  });

  test("Monatsabschluss und Erinnerungen nehmen nur eigene Status", async () => {
    const sb = makeFakeSupabase(tables());
    await expect(monatsabschluss.saveSettings(sb, T, { enabled: true, statuses: [1, 90] })).rejects.toMatchObject({ status: 400 });
    await monatsabschluss.saveSettings(sb, T, { enabled: true, statuses: ["1", 4] });
    expect(sb._tables.TENANT_SETTINGS.find(s => s.KEY === "monatsabschluss_statuses").VALUE).toBe("[1,4]");
    await expect(notificationSchedule.upsertSchedule(sb, { tenantId: T, typeKey: "leistungsstand_reminder", body: { projectStatusIds: [90] } }))
      .rejects.toMatchObject({ status: 400 });
  });

  test("Vorbelegung mit fremdem Status ist 400", async () => {
    const { writeDefaults } = require("../services/tenantDefaults");
    await expect(writeDefaults(makeFakeSupabase(tables()), T, { default_project_status_id: "90" }, () => true))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe("Standardsatz für neue Büros", () => {
  test("legt beide Listen einmal an, samt Beauftragt/Abgelehnt", async () => {
    const sb = makeFakeSupabase({ PROJECT_STATUS: [], OFFER_STATUS: [] });
    await st.seedDefaultStatuses(sb, 42);
    await st.seedDefaultStatuses(sb, 42);
    expect(sb._tables.PROJECT_STATUS.map(r => r.ABBR)).toEqual(st.DEFAULT_STATUSES.project.map(s => s.ABBR));
    expect(sb._tables.OFFER_STATUS.filter(r => r.CODE).map(r => r.CODE).sort()).toEqual(["ORDERED", "REJECTED"]);
    expect(sb._tables.OFFER_STATUS.every(r => r.TENANT_ID === 42)).toBe(true);
  });
});
