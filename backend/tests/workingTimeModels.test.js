"use strict";

// Arbeitszeitmodelle (UI-Pilot Runde 12): vorher ging alles durch, was
// Number() schluckte — ein Soll von −8 oder 30 Stunden, ein erfundenes Land,
// eine Pausenregel aus einem anderen Büro.
const svc = require("../services/workingTimeModels");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");

const T = 1;
const base = { name: "Vollzeit", country_code: "DE", state_code: "BY", mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 };

function db() {
  return makeFakeSupabase({
    WORKING_TIME_MODEL: [{ ID: 5, TENANT_ID: T, NAME: "Alt", COUNTRY_CODE: "DE", STATE_CODE: null, MON: 8, TUE: 8, WED: 8, THU: 8, FRI: 8, SAT: 0, SUN: 0 }],
    BREAK_RULE: [{ ID: 1, TENANT_ID: T, NAME: "ArbZG-Standard" }, { ID: 2, TENANT_ID: 99, NAME: "Fremd" }],
    EMPLOYEE_WORK_MODEL: [],
  });
}

describe("Arbeitszeitmodelle — Eingaben prüfen", () => {
  test("Komma-Stunden werden angenommen und gerundet", () => {
    const { base: b } = svc.buildPayload({ ...base, mon: "7,5", tue: "7.755" });
    expect(b.MON).toBe(7.5);
    expect(b.TUE).toBe(7.76);
  });

  test.each([["mon", -8], ["fri", 30], ["sat", "acht"]])("Tagessoll %s = %p wird abgewiesen", (k, v) => {
    expect(() => svc.buildPayload({ ...base, [k]: v })).toThrow(expect.objectContaining({ status: 400 }));
  });

  test("unbekanntes Land und fremdes Bundesland werden abgewiesen", () => {
    expect(() => svc.buildPayload({ ...base, country_code: "XX" })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => svc.buildPayload({ ...base, country_code: "AT", state_code: "BY" })).toThrow(expect.objectContaining({ message: "Bundesland passt nicht zum Land." }));
  });

  test("leerer Name bleibt Pflicht, auch aus Leerzeichen", () => {
    expect(() => svc.buildPayload({ ...base, name: "   " })).toThrow(expect.objectContaining({ status: 400 }));
  });

  test("Tagesgrenze und Ruhezeit außerhalb 1–24 werden abgewiesen, leer fällt auf den Standard", () => {
    expect(() => svc.buildPayload({ ...base, max_daily_hours: 0.5 })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => svc.buildPayload({ ...base, min_rest_hours: 25 })).toThrow(expect.objectContaining({ status: 400 }));
    const { arbzg } = svc.buildPayload({ ...base, max_daily_hours: "", min_rest_hours: "" });
    expect(arbzg).toMatchObject({ MAX_DAILY_HOURS: 10, MIN_REST_HOURS: 11 });
  });

  test("Pausenregel eines anderen Büros wird abgewiesen, die eigene angenommen", async () => {
    await expect(svc.createModel(db(), T, { ...base, break_rule_id: 2 })).rejects.toMatchObject({ status: 400, message: "Pausenregel nicht gefunden." });
    const created = await svc.createModel(db(), T, { ...base, break_rule_id: 1 });
    expect(created).toMatchObject({ NAME: "Vollzeit", BREAK_RULE_ID: 1 });
  });

  test("Ändern eines fremden oder unbekannten Modells ist 404, keine 500", async () => {
    await expect(svc.updateModel(db(), 99, 5, base)).rejects.toMatchObject({ status: 404 });
    await expect(svc.updateModel(db(), T, 777, base)).rejects.toMatchObject({ status: 404 });
    const updated = await svc.updateModel(db(), T, 5, { ...base, name: "Neu" });
    expect(updated).toMatchObject({ ID: 5, NAME: "Neu" });
  });
});
