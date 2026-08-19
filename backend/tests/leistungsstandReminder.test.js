"use strict";

// Leistungsstand-Erinnerung an die Projektleitung: je Projekt eine Nachricht
// (Vorgabe) oder eine Sammelnachricht je Person. Wer zwanzig Projekte fuehrt,
// bekam vorher zwanzig Meldungen am selben Morgen.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const checker  = require("../services/leistungsstandReminderChecker");
const schedule = require("../services/notificationSchedule");

const TENANT = 1;

function projekt(id, pmId, extra = {}) {
  return {
    ID: id,
    TENANT_ID: TENANT,
    NAME_SHORT: `P-${id}`,
    NAME_LONG: `Projekt ${id}`,
    PROJECT_MANAGER_ID: pmId,
    PROJECT_STATUS_ID: 1,
    ...extra,
  };
}

// Der Zeitplan wird hier nicht geprueft (dafuer notificationSchedule.test.js) —
// runNowForTenant feuert unabhaengig von Tag und Uhrzeit.
function konfig(extra = {}) {
  return {
    ID: 1,
    TENANT_ID: TENANT,
    TYPE_KEY: "leistungsstand_reminder",
    ENABLED: true,
    NOTIFY_PROJECT_PM: true,
    PM_NOTIFY_MODE: "per_project",
    PROJECT_STATUS_IDS: null,
    AUDIENCE_ROLES: null,
    AUDIENCE_DEPARTMENTS: null,
    AUDIENCE_EMPLOYEES: null,
    LAST_FIRED_DATE: null,
    ...extra,
  };
}

async function lauf({ projects, cfg }) {
  const db = makeFakeSupabase({
    NOTIFICATION_SCHEDULE_CONFIG: [cfg],
    PROJECT: projects,
    EMPLOYEE: [],
    NOTIFICATION: [],
    NOTIFICATION_TYPE: [],
  });
  const created = await checker.runNowForTenant(db, TENANT);
  return { created, notifs: db._tables.NOTIFICATION, db };
}

describe("Leistungsstand-Reminder — eine je Projekt (Vorgabe)", () => {
  test("drei Projekte derselben Person ergeben drei Nachrichten", async () => {
    const { created, notifs } = await lauf({
      projects: [projekt(1, 7), projekt(2, 7), projekt(3, 7)],
      cfg: konfig(),
    });
    expect(created).toBe(3);
    expect(notifs).toHaveLength(3);
    expect(notifs.every(n => n.USER_ID === "7")).toBe(true);
    expect(notifs.map(n => n.METADATA.project_id).sort()).toEqual(["1", "2", "3"]);
    expect(notifs.every(n => n.METADATA.scope === "pm")).toBe(true);
  });

  test("jede Nachricht verlinkt ihr eigenes Projekt", async () => {
    const { notifs } = await lauf({ projects: [projekt(4, 7)], cfg: konfig() });
    expect(notifs[0].LINK).toBe("/projekte?tab=leistungsstand&projectId=4");
  });

  test("fehlende PM-Zuordnung wird uebersprungen", async () => {
    const { created } = await lauf({
      projects: [projekt(1, 7), projekt(2, null)],
      cfg: konfig(),
    });
    expect(created).toBe(1);
  });
});

describe("Leistungsstand-Reminder — eine insgesamt", () => {
  const summary = () => konfig({ PM_NOTIFY_MODE: "summary" });

  test("drei Projekte derselben Person ergeben EINE Nachricht", async () => {
    const { created, notifs } = await lauf({
      projects: [projekt(1, 7), projekt(2, 7), projekt(3, 7)],
      cfg: summary(),
    });
    expect(created).toBe(1);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].USER_ID).toBe("7");
    expect(notifs[0].TITLE).toBe("Leistungsstände pflegen (3 Projekte)");
    expect(notifs[0].METADATA.scope).toBe("pm_summary");
    expect(notifs[0].METADATA.project_ids).toEqual(["1", "2", "3"]);
    expect(notifs[0].LINK).toBe("/projekte?tab=leistungsstand&filter=mine");
  });

  test("je Person eine Nachricht, nicht eine fuer alle", async () => {
    const { created, notifs } = await lauf({
      projects: [projekt(1, 7), projekt(2, 7), projekt(3, 8)],
      cfg: summary(),
    });
    expect(created).toBe(2);
    expect(notifs.map(n => n.USER_ID).sort()).toEqual(["7", "8"]);
  });

  test("bei genau einem Projekt bleibt der Text konkret statt zu zaehlen", async () => {
    const { notifs } = await lauf({ projects: [projekt(9, 7)], cfg: summary() });
    expect(notifs[0].TITLE).toBe("Leistungsstand pflegen: P-9");
    expect(notifs[0].BODY).toContain("P-9 – Projekt 9");
  });

  test("ab dem sechsten Projekt wird die Aufzaehlung gekuerzt", async () => {
    const projects = [1, 2, 3, 4, 5, 6, 7].map(id => projekt(id, 7));
    const { notifs } = await lauf({ projects, cfg: summary() });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].TITLE).toBe("Leistungsstände pflegen (7 Projekte)");
    expect(notifs[0].BODY).toContain("und 2 weitere");
    // Die vollstaendige Liste haengt trotzdem an den Metadaten.
    expect(notifs[0].METADATA.project_ids).toHaveLength(7);
  });

  test("ohne PM-Benachrichtigung entsteht gar nichts", async () => {
    const { created } = await lauf({
      projects: [projekt(1, 7), projekt(2, 7)],
      cfg: konfig({ NOTIFY_PROJECT_PM: false, PM_NOTIFY_MODE: "summary" }),
    });
    expect(created).toBe(0);
  });

  test("fehlender PM_NOTIFY_MODE (Migration 0129 offen) verhaelt sich wie bisher", async () => {
    const cfg = konfig();
    delete cfg.PM_NOTIFY_MODE;
    const { created } = await lauf({ projects: [projekt(1, 7), projekt(2, 7)], cfg });
    expect(created).toBe(2);
  });
});

describe("Leistungsstand-Reminder — Zeitplan bleibt nach dem Test offen", () => {
  test("runNowForTenant setzt LAST_FIRED_DATE nicht", async () => {
    const { db } = await lauf({ projects: [projekt(1, 7)], cfg: konfig() });
    expect(db._tables.NOTIFICATION_SCHEDULE_CONFIG[0].LAST_FIRED_DATE).toBeNull();
  });

  test("der regulaere Lauf markiert den Tag dagegen sehr wohl", async () => {
    const heute = schedule.localDateStr();
    const db = makeFakeSupabase({
      // Zeitplan so gesetzt, dass heute ein Feuertag ist.
      NOTIFICATION_SCHEDULE_CONFIG: [konfig({
        SCHEDULE_DAYS: [Number(heute.slice(8, 10))],
        SCHEDULE_TIME_OF_DAY: "00:00:00",
      })],
      PROJECT: [projekt(1, 7)],
      EMPLOYEE: [],
      NOTIFICATION: [],
      NOTIFICATION_TYPE: [],
    });
    await checker.checkLeistungsstandReminders(db);
    expect(db._tables.NOTIFICATION_SCHEDULE_CONFIG[0].LAST_FIRED_DATE).toBe(heute);
    expect(db._tables.NOTIFICATION).toHaveLength(1);
  });
});
