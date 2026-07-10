"use strict";

const express = require("express");
const makeRouter = require("../routes/abwesenheit");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");

// Baut eine Express-App mit gefaketem Auth/Permissions-Layer + Router.
function buildApp(supabase, ctx) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId   = ctx.tenantId;
    req.employeeId = ctx.employeeId;
    req.permissions = new Set(ctx.permissions || []);
    req.hasPermission = (k) => req.permissions.has(k);
    next();
  });
  app.use("/abwesenheit", makeRouter(supabase));
  return app;
}

// Ein Request gegen eine frische App (eigener Server auf Ephemeral-Port).
async function request(supabase, ctx, method, path, body) {
  const app = buildApp(supabase, ctx);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}

const TENANT = 1;

// ── /settings ────────────────────────────────────────────────────────────────
describe("GET/PUT /abwesenheit/settings", () => {
  it("liefert Defaults (Verfall aus, 03-31) ohne gespeicherte Settings", async () => {
    const sb = makeFakeSupabase({ TENANT_SETTINGS: [] });
    const r = await request(sb, { tenantId: TENANT, employeeId: 1, permissions: [] }, "GET", "/abwesenheit/settings");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ carryoverExpires: false, carryoverExpiryDate: "03-31" });
  });

  it("speichert und liest Verfall + Stichtag (mit absence.manage)", async () => {
    const sb = makeFakeSupabase({ TENANT_SETTINGS: [] });
    const put = await request(sb, { tenantId: TENANT, employeeId: 1, permissions: ["absence.manage"] },
      "PUT", "/abwesenheit/settings", { carryoverExpires: true, carryoverExpiryDate: "04-30" });
    expect(put.status).toBe(200);
    expect(put.body.data).toEqual({ carryoverExpires: true, carryoverExpiryDate: "04-30" });
    const get = await request(sb, { tenantId: TENANT, employeeId: 1, permissions: [] }, "GET", "/abwesenheit/settings");
    expect(get.body.data.carryoverExpires).toBe(true);
    expect(get.body.data.carryoverExpiryDate).toBe("04-30");
  });

  it("verweigert PUT ohne absence.manage (403)", async () => {
    const sb = makeFakeSupabase({ TENANT_SETTINGS: [] });
    const r = await request(sb, { tenantId: TENANT, employeeId: 1, permissions: [] },
      "PUT", "/abwesenheit/settings", { carryoverExpires: true });
    expect(r.status).toBe(403);
  });

  it("lehnt ungueltigen Stichtag ab (400)", async () => {
    const sb = makeFakeSupabase({ TENANT_SETTINGS: [] });
    const r = await request(sb, { tenantId: TENANT, employeeId: 1, permissions: ["absence.manage"] },
      "PUT", "/abwesenheit/settings", { carryoverExpiryDate: "4-30" });
    expect(r.status).toBe(400);
  });
});

// ── /vacation-balance ────────────────────────────────────────────────────────
describe("GET /abwesenheit/vacation-balance", () => {
  it("rechnet Anspruch minus genommene Werktage (ohne Feiertage)", async () => {
    const sb = makeFakeSupabase({
      TENANT_SETTINGS: [],
      ABSENCE_TYPE: [{ ID: 1, TENANT_ID: TENANT, NAME: "Urlaub", REDUCES_VACATION: true }],
      VACATION_ENTITLEMENT: [{ ID: 1, TENANT_ID: TENANT, EMPLOYEE_ID: 5, YEAR: 2026, DAYS_ENTITLED: 30, CARRYOVER_OVERRIDE: null }],
      // Mo 2026-03-02 bis Fr 2026-03-06 = 5 Werktage
      ABSENCE: [{ ID: 10, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-03-02", DATE_TO: "2026-03-06", HALF_DAY: false, STATUS: "APPROVED" }],
      EMPLOYEE_WORK_MODEL: [],
      PUBLIC_HOLIDAY: [],
    });
    const r = await request(sb, { tenantId: TENANT, employeeId: 5, permissions: [] },
      "GET", "/abwesenheit/vacation-balance?employee_id=5&year=2026");
    expect(r.status).toBe(200);
    expect(r.body.data.entitled).toBe(30);
    expect(r.body.data.taken).toBe(5);
    expect(r.body.data.remaining).toBe(25);
    expect(r.body.data.carryoverExpires).toBe(false);
  });

  it("verweigert fremden Saldo ohne absence.view (403)", async () => {
    const sb = makeFakeSupabase({ ABSENCE_TYPE: [], VACATION_ENTITLEMENT: [], ABSENCE: [] });
    const r = await request(sb, { tenantId: TENANT, employeeId: 9, permissions: [] },
      "GET", "/abwesenheit/vacation-balance?employee_id=5&year=2026");
    expect(r.status).toBe(403);
  });
});

// ── /:id/clarify ─────────────────────────────────────────────────────────────
describe("POST /abwesenheit/:id/clarify", () => {
  function baseTables() {
    return {
      ABSENCE: [{ ID: 20, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-05-04", DATE_TO: "2026-05-08", HALF_DAY: false, STATUS: "REQUESTED", DECISION_NOTE: null, CLARIFICATION_LOG: [] }],
      ABSENCE_TYPE: [{ ID: 1, TENANT_ID: TENANT, NAME: "Urlaub" }],
    };
  }

  it("stellt eine Rueckfrage: Status bleibt REQUESTED, Notiz + Log gesetzt", async () => {
    const sb = makeFakeSupabase(baseTables());
    const r = await request(sb, { tenantId: TENANT, employeeId: 2, permissions: ["absence.approve"] },
      "POST", "/abwesenheit/20/clarify", { note: "Bitte Vertretung angeben" });
    expect(r.status).toBe(200);
    const row = sb._tables.ABSENCE.find(a => a.ID === 20);
    expect(row.STATUS).toBe("REQUESTED");
    expect(row.DECISION_NOTE).toBe("Bitte Vertretung angeben");
    expect(row.CLARIFICATION_LOG).toHaveLength(1);
    expect(row.CLARIFICATION_LOG[0].role).toBe("approver");
  });

  it("verweigert Rueckfrage ohne absence.approve (403)", async () => {
    const sb = makeFakeSupabase(baseTables());
    const r = await request(sb, { tenantId: TENANT, employeeId: 2, permissions: [] },
      "POST", "/abwesenheit/20/clarify", { note: "x" });
    expect(r.status).toBe(403);
  });

  it("gibt 404 zurueck, wenn der Antrag nicht offen (REQUESTED) ist", async () => {
    const t = baseTables();
    t.ABSENCE[0].STATUS = "APPROVED";
    const sb = makeFakeSupabase(t);
    const r = await request(sb, { tenantId: TENANT, employeeId: 2, permissions: ["absence.approve"] },
      "POST", "/abwesenheit/20/clarify", { note: "x" });
    expect(r.status).toBe(404);
  });

  it("lehnt leere Notiz ab (400)", async () => {
    const sb = makeFakeSupabase(baseTables());
    const r = await request(sb, { tenantId: TENANT, employeeId: 2, permissions: ["absence.approve"] },
      "POST", "/abwesenheit/20/clarify", { note: "   " });
    expect(r.status).toBe(400);
  });
});

// ── /:id/reply ───────────────────────────────────────────────────────────────
describe("POST /abwesenheit/:id/reply", () => {
  function baseTables() {
    return {
      ABSENCE: [{ ID: 30, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-05-04", DATE_TO: "2026-05-08", HALF_DAY: false, STATUS: "REQUESTED", DECISION_NOTE: "Bitte Vertretung?", CLARIFICATION_LOG: [{ role: "approver", by: 2, at: "2026-04-01T00:00:00Z", text: "Bitte Vertretung?" }] }],
      ABSENCE_TYPE: [{ ID: 1, TENANT_ID: TENANT, NAME: "Urlaub" }],
    };
  }

  it("Antragsteller (Owner) antwortet: Log um Antwort ergaenzt", async () => {
    const sb = makeFakeSupabase(baseTables());
    const r = await request(sb, { tenantId: TENANT, employeeId: 5, permissions: ["absence.request"] },
      "POST", "/abwesenheit/30/reply", { note: "Vertretung: Kollege X" });
    expect(r.status).toBe(200);
    const row = sb._tables.ABSENCE.find(a => a.ID === 30);
    expect(row.CLARIFICATION_LOG).toHaveLength(2);
    expect(row.CLARIFICATION_LOG[1].role).toBe("requester");
    expect(row.CLARIFICATION_LOG[1].text).toBe("Vertretung: Kollege X");
    expect(row.STATUS).toBe("REQUESTED");
  });

  it("verweigert Antwort eines Fremden ohne absence.manage (403)", async () => {
    const sb = makeFakeSupabase(baseTables());
    const r = await request(sb, { tenantId: TENANT, employeeId: 99, permissions: [] },
      "POST", "/abwesenheit/30/reply", { note: "x" });
    expect(r.status).toBe(403);
  });

  it("lehnt Antwort auf nicht-offenen Antrag ab (400)", async () => {
    const t = baseTables();
    t.ABSENCE[0].STATUS = "APPROVED";
    const sb = makeFakeSupabase(t);
    const r = await request(sb, { tenantId: TENANT, employeeId: 5, permissions: ["absence.request"] },
      "POST", "/abwesenheit/30/reply", { note: "x" });
    expect(r.status).toBe(400);
  });
});

// ── /entitlements/bulk ───────────────────────────────────────────────────────
describe("PUT /abwesenheit/entitlements/bulk", () => {
  it("legt neue Ansprueche an und aktualisiert bestehende (NOTE bleibt erhalten)", async () => {
    const sb = makeFakeSupabase({
      VACATION_ENTITLEMENT: [{ ID: 1, TENANT_ID: TENANT, EMPLOYEE_ID: 5, YEAR: 2027, DAYS_ENTITLED: 25, CARRYOVER_OVERRIDE: null, NOTE: "Altfall" }],
    });
    const r = await request(sb, { tenantId: TENANT, employeeId: 1, permissions: ["absence.manage"] },
      "PUT", "/abwesenheit/entitlements/bulk", { year: 2027, items: [
        { employee_id: 5, days_entitled: 30 },       // Update
        { employee_id: 6, days_entitled: 28 },       // Insert
      ] });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(2);
    const rows = sb._tables.VACATION_ENTITLEMENT;
    const e5 = rows.find(x => x.EMPLOYEE_ID === 5);
    const e6 = rows.find(x => x.EMPLOYEE_ID === 6);
    expect(e5.DAYS_ENTITLED).toBe(30);
    expect(e5.NOTE).toBe("Altfall"); // Update erhaelt NOTE
    expect(e6.DAYS_ENTITLED).toBe(28);
  });

  it("verweigert Bulk ohne absence.manage (403)", async () => {
    const sb = makeFakeSupabase({ VACATION_ENTITLEMENT: [] });
    const r = await request(sb, { tenantId: TENANT, employeeId: 1, permissions: [] },
      "PUT", "/abwesenheit/entitlements/bulk", { year: 2027, items: [{ employee_id: 5, days_entitled: 30 }] });
    expect(r.status).toBe(403);
  });
});
