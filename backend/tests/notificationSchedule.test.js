"use strict";

// Zeitsteuerung der geplanten Benachrichtigungen.
//
// Der Container laeuft in UTC, die Uhrzeit im Zeitplan meint aber die Uhrzeit
// im Buero. Wurde beides gleichgesetzt, ging eine auf 09:00 gestellte
// Erinnerung im Sommer erst um 11:00 Ortszeit raus — und das Tagesdatum aus
// toISOString() sprang abends schon auf den Folgetag.

const schedule = require("../services/notificationSchedule");

// Fester Zeitpunkt in UTC, damit die Tests nicht von der Uhr abhaengen.
const utc = (iso) => new Date(iso);

describe("localDateStr — Tagesdatum in deutscher Zeit", () => {
  test("mittags gleich dem UTC-Datum", () => {
    expect(schedule.localDateStr(utc("2026-08-19T10:00:00Z"))).toBe("2026-08-19");
  });

  test("22:30 Ortszeit gehoert noch zum selben Tag (UTC waere schon der naechste)", () => {
    // 2026-08-19 22:30 CEST = 2026-08-19 20:30 UTC — hier stimmen beide.
    // Kritisch ist 2026-08-19 23:30 CEST = 21:30 UTC: auch derselbe Tag.
    expect(schedule.localDateStr(utc("2026-08-19T21:30:00Z"))).toBe("2026-08-19");
  });

  test("kurz nach Mitternacht Ortszeit ist bereits der neue Tag", () => {
    // 2026-08-20 00:30 CEST = 2026-08-19 22:30 UTC
    expect(schedule.localDateStr(utc("2026-08-19T22:30:00Z"))).toBe("2026-08-20");
  });

  test("Winterzeit: UTC+1", () => {
    // 2026-01-15 00:30 CET = 2026-01-14 23:30 UTC
    expect(schedule.localDateStr(utc("2026-01-14T23:30:00Z"))).toBe("2026-01-15");
  });
});

describe("hasReachedTimeOfDay — Uhrzeit in deutscher Zeit", () => {
  test("09:00 ist um 08:00 Ortszeit noch nicht erreicht", () => {
    // 2026-08-19 08:00 CEST = 06:00 UTC
    expect(schedule.hasReachedTimeOfDay("09:00:00", utc("2026-08-19T06:00:00Z"))).toBe(false);
  });

  test("09:00 ist um 09:05 Ortszeit erreicht", () => {
    // 2026-08-19 09:05 CEST = 07:05 UTC
    expect(schedule.hasReachedTimeOfDay("09:00:00", utc("2026-08-19T07:05:00Z"))).toBe(true);
  });

  test("Sommerzeit-Versatz: 07:30 UTC ist 09:30 Ortszeit, nicht 07:30", () => {
    // Genau der alte Fehler: mit Serverzeit waere 09:00 hier NICHT erreicht.
    expect(schedule.hasReachedTimeOfDay("09:00", utc("2026-08-19T07:30:00Z"))).toBe(true);
  });

  test("Winterzeit-Versatz betraegt nur eine Stunde", () => {
    // 2026-01-15 08:30 CET = 07:30 UTC -> 09:00 noch nicht erreicht
    expect(schedule.hasReachedTimeOfDay("09:00", utc("2026-01-15T07:30:00Z"))).toBe(false);
  });

  test("ohne hinterlegte Uhrzeit gilt der ganze Tag", () => {
    expect(schedule.hasReachedTimeOfDay(null,  utc("2026-08-19T02:00:00Z"))).toBe(true);
    expect(schedule.hasReachedTimeOfDay("",    utc("2026-08-19T02:00:00Z"))).toBe(true);
    expect(schedule.hasReachedTimeOfDay("quatsch", utc("2026-08-19T02:00:00Z"))).toBe(true);
  });
});

describe("shouldFireToday — Tag UND Uhrzeit", () => {
  const cfg = (extra) => ({
    ENABLED: true,
    SCHEDULE_DAYS: [25],
    SCHEDULE_LAST_DAY: false,
    SCHEDULE_TIME_OF_DAY: null,
    ...extra,
  });

  test("richtiger Tag, keine Uhrzeit -> feuert", () => {
    expect(schedule.shouldFireToday(cfg(), utc("2026-08-25T05:00:00Z"))).toBe(true);
  });

  test("falscher Tag -> feuert nicht", () => {
    expect(schedule.shouldFireToday(cfg(), utc("2026-08-24T05:00:00Z"))).toBe(false);
  });

  test("richtiger Tag, Uhrzeit noch nicht erreicht -> feuert nicht", () => {
    // 2026-08-25 07:00 CEST = 05:00 UTC, Ziel 09:00
    const c = cfg({ SCHEDULE_TIME_OF_DAY: "09:00:00" });
    expect(schedule.shouldFireToday(c, utc("2026-08-25T05:00:00Z"))).toBe(false);
  });

  test("richtiger Tag, Uhrzeit erreicht -> feuert", () => {
    // 2026-08-25 09:30 CEST = 07:30 UTC
    const c = cfg({ SCHEDULE_TIME_OF_DAY: "09:00:00" });
    expect(schedule.shouldFireToday(c, utc("2026-08-25T07:30:00Z"))).toBe(true);
  });

  test("deaktiviertes Schedule feuert nie", () => {
    expect(schedule.shouldFireToday(cfg({ ENABLED: false }), utc("2026-08-25T12:00:00Z"))).toBe(false);
    expect(schedule.shouldFireToday(null, utc("2026-08-25T12:00:00Z"))).toBe(false);
  });

  test("letzter Tag des Monats — 31 Tage", () => {
    const c = cfg({ SCHEDULE_DAYS: [], SCHEDULE_LAST_DAY: true });
    expect(schedule.shouldFireToday(c, utc("2026-08-31T10:00:00Z"))).toBe(true);
    expect(schedule.shouldFireToday(c, utc("2026-08-30T10:00:00Z"))).toBe(false);
  });

  test("letzter Tag des Monats — 30 Tage", () => {
    const c = cfg({ SCHEDULE_DAYS: [], SCHEDULE_LAST_DAY: true });
    expect(schedule.shouldFireToday(c, utc("2026-09-30T10:00:00Z"))).toBe(true);
    expect(schedule.shouldFireToday(c, utc("2026-09-29T10:00:00Z"))).toBe(false);
  });

  test("letzter Tag des Monats — Februar im Schaltjahr", () => {
    const c = cfg({ SCHEDULE_DAYS: [], SCHEDULE_LAST_DAY: true });
    expect(schedule.shouldFireToday(c, utc("2028-02-29T10:00:00Z"))).toBe(true);
    expect(schedule.shouldFireToday(c, utc("2028-02-28T10:00:00Z"))).toBe(false);
  });

  test("letzter Tag des Monats — Februar ohne Schaltjahr", () => {
    const c = cfg({ SCHEDULE_DAYS: [], SCHEDULE_LAST_DAY: true });
    expect(schedule.shouldFireToday(c, utc("2026-02-28T10:00:00Z"))).toBe(true);
  });
});
