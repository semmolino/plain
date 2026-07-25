"use strict";

const { isOverLimit, enforceLimit, getUsage, LIMIT_META } = require("../middleware/limits");

describe("Mengenlimit — isOverLimit (pur)", () => {
  it("unbegrenzt (null) blockt nie", () => {
    expect(isOverLimit(0, null)).toBe(false);
    expect(isOverLimit(9999, null)).toBe(false);
  });
  it("blockt bei Erreichen der Grenze", () => {
    expect(isOverLimit(4, 5)).toBe(false);
    expect(isOverLimit(5, 5)).toBe(true);
    expect(isOverLimit(6, 5)).toBe(true); // Bestand über gesenkter Grenze -> kein Neuanlegen
  });
});

// Fake-req/res-Helfer für den Guard.
function makeReq({ unrestricted = false, limits = {}, tenantId = 1 } = {}) {
  return {
    _licenseUnrestricted: unrestricted,
    tenantId,
    license: { limits: new Map(Object.entries(limits)) },
  };
}
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

describe("Mengenlimit — enforceLimit-Guard", () => {
  const fakeSupabase = (count) => ({
    from() { return this; },
    select() { return this; },
    eq() { return this; },
    // letztes eq() gibt das Ergebnis zurück -> wir lösen über then auf
    then(resolve) { resolve({ count, error: null }); },
  });

  it("unrestricted -> immer durch", async () => {
    const req = makeReq({ unrestricted: true, limits: { "limits.employees": 1 } });
    const res = makeRes();
    let called = false;
    await enforceLimit(fakeSupabase(99), "limits.employees")(req, res, () => { called = true; });
    expect(called).toBe(true);
    expect(res.statusCode).toBe(null);
  });

  it("keine Grenze gesetzt -> durch", async () => {
    const req = makeReq({ limits: {} });
    const res = makeRes();
    let called = false;
    await enforceLimit(fakeSupabase(99), "limits.employees")(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it("unter der Grenze -> durch", async () => {
    const req = makeReq({ limits: { "limits.employees": 5 } });
    const res = makeRes();
    let called = false;
    await enforceLimit(fakeSupabase(4), "limits.employees")(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it("an der Grenze -> 402", async () => {
    const req = makeReq({ limits: { "limits.employees": 5 } });
    const res = makeRes();
    let called = false;
    await enforceLimit(fakeSupabase(5), "limits.employees")(req, res, () => { called = true; });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(402);
    expect(res.body.limit_reached).toBe(true);
    expect(res.body.limit).toBe(5);
    expect(res.body.used).toBe(5);
  });

  it("Zählfehler -> Soft-Fail (durchlassen, nicht blockieren)", async () => {
    // Zähl-Query wirft -> der Guard fängt den Fehler und lässt die Anlage durch,
    // statt eine legitime Aktion an einem DB-Problem scheitern zu lassen.
    const dbDown = { from() { return this; }, select() { return this; }, eq() { throw new Error("db down"); } };
    const req = makeReq({ limits: { "limits.employees": 1 } });
    const res = makeRes();
    let called = false;
    await enforceLimit(dbDown, "limits.employees")(req, res, () => { called = true; });
    expect(called).toBe(true);
    expect(res.statusCode).toBe(null);
  });

  it("LIMIT_META deckt alle metered Capabilities ab", () => {
    for (const k of ["limits.employees", "limits.projects_active", "limits.storage_mb"]) {
      expect(LIMIT_META[k]).toBeTruthy();
    }
    expect(typeof getUsage).toBe("function");
  });
});
