"use strict";

const { isOverLimit, enforceLimit, getUsage, LIMIT_META, fitsStorage, checkStorageLimit } = require("../middleware/limits");

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
    neq() { return this; },
    // letztes Kettenglied liefert das Ergebnis -> wir lösen über then auf
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

  it("LIMIT_META deckt die metered Capabilities ab (kein Projekt-Limit)", () => {
    for (const k of ["limits.employees", "limits.storage_mb"]) {
      expect(LIMIT_META[k]).toBeTruthy();
    }
    // Auf Projekte gibt es bewusst kein Limit.
    expect(LIMIT_META["limits.projects_active"]).toBeUndefined();
    void checkStorageLimit;
    expect(typeof getUsage).toBe("function");
  });
});

describe("Speicherlimit — fitsStorage (pur)", () => {
  const MB = 1024 * 1024;
  it("unbegrenzt (null) passt immer", () => {
    expect(fitsStorage(999 * MB, 50 * MB, null)).toBe(true);
  });
  it("inkrementell: belegt + neue Datei <= Grenze", () => {
    expect(fitsStorage(90 * MB, 5 * MB, 100)).toBe(true);   // 95 <= 100
    expect(fitsStorage(90 * MB, 10 * MB, 100)).toBe(true);  // 100 <= 100 (Gleichheit erlaubt)
    expect(fitsStorage(90 * MB, 11 * MB, 100)).toBe(false); // 101 > 100
  });
  it("bereits über der Grenze -> jede weitere Datei blockt", () => {
    expect(fitsStorage(120 * MB, 1, 100)).toBe(false);
  });
});

describe("Speicherlimit — checkStorageLimit-Integration", () => {
  const MB = 1024 * 1024;
  // Fake-Supabase: COMPANY -> [{ID:1}], ASSET -> Summe der gelieferten Größen.
  const fakeSupabase = (assetSizes) => ({
    _table: null,
    from(t) { this._table = t; return this; },
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    then(resolve) {
      if (this._table === "COMPANY") resolve({ data: [{ ID: 1 }], error: null });
      else resolve({ data: assetSizes.map((s) => ({ FILE_SIZE: s })), error: null });
    },
  });

  it("ohne Limit -> erlaubt", async () => {
    const req = makeReq({ limits: {} });
    const r = await checkStorageLimit(fakeSupabase([50 * MB]), req, 5 * MB);
    expect(r.allowed).toBe(true);
    expect(r.limitMb).toBe(null);
  });

  it("Upload passt noch -> erlaubt", async () => {
    const req = makeReq({ limits: { "limits.storage_mb": 100 } });
    const r = await checkStorageLimit(fakeSupabase([90 * MB]), req, 5 * MB);
    expect(r.allowed).toBe(true);
    expect(r.usedMb).toBe(90);
  });

  it("Upload sprengt Limit -> blockiert", async () => {
    const req = makeReq({ limits: { "limits.storage_mb": 100 } });
    const r = await checkStorageLimit(fakeSupabase([98 * MB]), req, 5 * MB);
    expect(r.allowed).toBe(false);
  });
});
