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
      // Seit Runde 10 prüft der Bulk, dass die Mitarbeiter zum Büro gehören
      EMPLOYEE: [{ ID: 5, TENANT_ID: TENANT }, { ID: 6, TENANT_ID: TENANT }],
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

// ── /preview (Runde 11) ──────────────────────────────────────────────────────
describe("GET /abwesenheit/preview", () => {
  function tables() {
    return {
      TENANT_SETTINGS: [],
      EMPLOYEE: [
        { ID: 5, TENANT_ID: TENANT, ABBR: "TK" },
        { ID: 6, TENANT_ID: 2, ABBR: "XX" },
      ],
      ABSENCE_TYPE: [
        { ID: 1, TENANT_ID: TENANT, NAME: "Urlaub", REDUCES_VACATION: true, REQUIRES_APPROVAL: true },
        { ID: 2, TENANT_ID: TENANT, NAME: "Krank", REDUCES_VACATION: false, REQUIRES_APPROVAL: false },
      ],
      VACATION_ENTITLEMENT: [{ ID: 1, TENANT_ID: TENANT, EMPLOYEE_ID: 5, YEAR: 2026, DAYS_ENTITLED: 30, CARRYOVER_OVERRIDE: null }],
      ABSENCE: [
        // genehmigt: Mo 2.3.–Fr 6.3. (5 Tage), offen: Mo 7.9.–Mi 9.9. (3 Tage)
        { ID: 10, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-03-02", DATE_TO: "2026-03-06", HALF_DAY: false, STATUS: "APPROVED" },
        { ID: 11, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-09-07", DATE_TO: "2026-09-09", HALF_DAY: false, STATUS: "REQUESTED" },
        { ID: 12, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-10-01", DATE_TO: "2026-10-02", HALF_DAY: false, STATUS: "CANCELLED" },
      ],
      EMPLOYEE_WORK_MODEL: [],
      PUBLIC_HOLIDAY: [],
    };
  }
  const self = { tenantId: TENANT, employeeId: 5, permissions: ["absence.request"] };

  it("zählt die Tage und rechnet den Resturlaub danach mit offenen Anträgen", async () => {
    const sb = makeFakeSupabase(tables());
    // Mo 21.9.–Fr 25.9. = 5 Tage; Rest 30 − 5 = 25, offen 3 → danach 17
    const r = await request(sb, self, "GET", "/abwesenheit/preview?absence_type_id=1&date_from=2026-09-21&date_to=2026-09-25");
    expect(r.status).toBe(200);
    expect(r.body.data.days).toBe(5);
    expect(r.body.data.reduces_vacation).toBe(true);
    expect(r.body.data.requires_approval).toBe(true);
    expect(r.body.data.balance).toEqual([{ year: 2026, remaining: 25, pending: 3, days: 5, after: 17 }]);
    expect(r.body.data.overlaps).toEqual([]);
  });

  it("meldet Überschneidungen mit eigenen offenen oder genehmigten Abwesenheiten, nicht mit stornierten", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, self, "GET", "/abwesenheit/preview?absence_type_id=1&date_from=2026-09-08&date_to=2026-10-02");
    expect(r.status).toBe(200);
    expect(r.body.data.overlaps.map(o => o.ID)).toEqual([11]);
    expect(r.body.data.overlaps[0].TYPE_NAME).toBe("Urlaub");
  });

  it("beim Bearbeiten zählt der eigene Antrag weder als offen noch als Überschneidung", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, self, "GET", "/abwesenheit/preview?absence_type_id=1&date_from=2026-09-07&date_to=2026-09-10&exclude_id=11");
    expect(r.body.data.overlaps).toEqual([]);
    expect(r.body.data.balance[0]).toMatchObject({ remaining: 25, pending: 0, days: 4, after: 21 });
  });

  it("über den Jahreswechsel je Jahr getrennt", async () => {
    const sb = makeFakeSupabase(tables());
    // Mo 28.12.2026–Fr 1.1.2027: 4 Tage 2026, 1 Tag 2027
    const r = await request(sb, self, "GET", "/abwesenheit/preview?absence_type_id=1&date_from=2026-12-28&date_to=2027-01-01");
    expect(r.body.data.days).toBe(5);
    expect(r.body.data.by_year).toEqual([{ year: 2026, days: 4 }, { year: 2027, days: 1 }]);
    expect(r.body.data.balance.map(b => b.year)).toEqual([2026, 2027]);
  });

  it("Arten ohne Urlaubsabzug: Tage ja, Saldo nein", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, self, "GET", "/abwesenheit/preview?absence_type_id=2&date_from=2026-09-21&date_to=2026-09-21");
    expect(r.body.data.days).toBe(1);
    expect(r.body.data.balance).toBeNull();
    expect(r.body.data.requires_approval).toBe(false);
  });

  it("fremder Mitarbeiter nur mit absence.view oder absence.manage — mit manage ohne view ohne Saldo", async () => {
    const q = "/abwesenheit/preview?employee_id=5&absence_type_id=1&date_from=2026-09-21&date_to=2026-09-25";
    const none = await request(makeFakeSupabase(tables()), { tenantId: TENANT, employeeId: 9, permissions: ["absence.request"] }, "GET", q);
    expect(none.status).toBe(403);
    const manage = await request(makeFakeSupabase(tables()), { tenantId: TENANT, employeeId: 9, permissions: ["absence.manage"] }, "GET", q);
    expect(manage.status).toBe(200);
    expect(manage.body.data.days).toBe(5);
    expect(manage.body.data.balance).toBeNull();
    const view = await request(makeFakeSupabase(tables()), { tenantId: TENANT, employeeId: 9, permissions: ["absence.view"] }, "GET", q);
    expect(view.body.data.balance[0].remaining).toBe(25);
  });

  it("Mitarbeiter eines anderen Mandanten: 404", async () => {
    const r = await request(makeFakeSupabase(tables()), { tenantId: TENANT, employeeId: 9, permissions: ["absence.view"] },
      "GET", "/abwesenheit/preview?employee_id=6&absence_type_id=1&date_from=2026-09-21&date_to=2026-09-25");
    expect(r.status).toBe(404);
  });

  it("prüft Datumsangaben", async () => {
    const sb = makeFakeSupabase(tables());
    expect((await request(sb, self, "GET", "/abwesenheit/preview?date_from=21.09.2026")).status).toBe(400);
    expect((await request(sb, self, "GET", "/abwesenheit/preview?date_from=2026-09-25&date_to=2026-09-21")).status).toBe(400);
    expect((await request(sb, self, "GET", "/abwesenheit/preview?date_from=2026-01-01&date_to=2027-06-01")).status).toBe(400);
  });
});

describe("GET /abwesenheit/vacation-balance — offen beantragt", () => {
  it("weist offene Anträge als pending aus, ohne den Resturlaub zu mindern", async () => {
    const sb = makeFakeSupabase({
      TENANT_SETTINGS: [],
      ABSENCE_TYPE: [{ ID: 1, TENANT_ID: TENANT, NAME: "Urlaub", REDUCES_VACATION: true }],
      VACATION_ENTITLEMENT: [{ ID: 1, TENANT_ID: TENANT, EMPLOYEE_ID: 5, YEAR: 2026, DAYS_ENTITLED: 30, CARRYOVER_OVERRIDE: null }],
      ABSENCE: [
        { ID: 10, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-03-02", DATE_TO: "2026-03-06", HALF_DAY: false, STATUS: "APPROVED" },
        { ID: 11, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-09-07", DATE_TO: "2026-09-09", HALF_DAY: false, STATUS: "REQUESTED" },
      ],
      EMPLOYEE_WORK_MODEL: [],
      PUBLIC_HOLIDAY: [],
    });
    const r = await request(sb, { tenantId: TENANT, employeeId: 5, permissions: [] }, "GET", "/abwesenheit/vacation-balance?year=2026");
    expect(r.body.data).toMatchObject({ taken: 5, remaining: 25, pending: 3 });
  });
});

// ── /:id/cancel (Runde 11) ───────────────────────────────────────────────────
describe("POST /abwesenheit/:id/cancel", () => {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const shift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return iso(d); };
  function tables(status, from, to) {
    return { ABSENCE: [{ ID: 30, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: from, DATE_TO: to, HALF_DAY: false, STATUS: status }] };
  }
  const own = { tenantId: TENANT, employeeId: 5, permissions: ["absence.request"] };

  it("eigene genehmigte Abwesenheit in der Zukunft: storniert", async () => {
    const sb = makeFakeSupabase(tables("APPROVED", shift(10), shift(14)));
    const r = await request(sb, own, "POST", "/abwesenheit/30/cancel");
    expect(r.status).toBe(200);
    expect(sb._tables.ABSENCE[0].STATUS).toBe("CANCELLED");
  });

  it("eigene, schon begonnene oder vergangene Abwesenheit: 409, nichts geändert", async () => {
    for (const [from, to] of [[shift(0), shift(3)], [shift(-20), shift(-15)]]) {
      const sb = makeFakeSupabase(tables("APPROVED", from, to));
      const r = await request(sb, own, "POST", "/abwesenheit/30/cancel");
      expect(r.status).toBe(409);
      expect(sb._tables.ABSENCE[0].STATUS).toBe("APPROVED");
    }
  });

  it("mit absence.manage auch rückwirkend", async () => {
    const sb = makeFakeSupabase(tables("APPROVED", shift(-20), shift(-15)));
    const r = await request(sb, { tenantId: TENANT, employeeId: 1, permissions: ["absence.manage"] }, "POST", "/abwesenheit/30/cancel");
    expect(r.status).toBe(200);
    expect(sb._tables.ABSENCE[0].STATUS).toBe("CANCELLED");
  });

  it("abgelehnt oder storniert: 409", async () => {
    for (const st of ["REJECTED", "CANCELLED"]) {
      const sb = makeFakeSupabase(tables(st, shift(10), shift(14)));
      const r = await request(sb, own, "POST", "/abwesenheit/30/cancel");
      expect(r.status).toBe(409);
    }
  });

  it("fremde ohne absence.manage: 403", async () => {
    const sb = makeFakeSupabase(tables("APPROVED", shift(10), shift(14)));
    const r = await request(sb, { tenantId: TENANT, employeeId: 9, permissions: ["absence.request", "absence.view"] }, "POST", "/abwesenheit/30/cancel");
    expect(r.status).toBe(403);
  });
});

// ── Überschneidungen sperren (Runde 12) ──────────────────────────────────────
describe("POST/PATCH /abwesenheit — Überschneidung", () => {
  function tables() {
    return {
      TENANT_SETTINGS: [],
      EMPLOYEE: [{ ID: 5, TENANT_ID: TENANT, ABBR: "TK" }],
      ABSENCE_TYPE: [
        { ID: 1, TENANT_ID: TENANT, NAME: "Urlaub", REDUCES_VACATION: true, REQUIRES_APPROVAL: true },
        { ID: 2, TENANT_ID: TENANT, NAME: "Krank", REDUCES_VACATION: false, REQUIRES_APPROVAL: false },
      ],
      ABSENCE: [
        { ID: 10, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-10-12", DATE_TO: "2026-10-16", HALF_DAY: false, STATUS: "APPROVED" },
        { ID: 11, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-11-02", DATE_TO: "2026-11-03", HALF_DAY: false, STATUS: "REQUESTED" },
        { ID: 12, TENANT_ID: TENANT, EMPLOYEE_ID: 5, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-12-01", DATE_TO: "2026-12-04", HALF_DAY: false, STATUS: "CANCELLED" },
        // anderer Mitarbeiter, gleicher Zeitraum — kein Konflikt
        { ID: 13, TENANT_ID: TENANT, EMPLOYEE_ID: 6, ABSENCE_TYPE_ID: 1, DATE_FROM: "2026-10-19", DATE_TO: "2026-10-23", HALF_DAY: false, STATUS: "APPROVED" },
      ],
      EMPLOYEE_WORK_MODEL: [],
      PUBLIC_HOLIDAY: [],
    };
  }
  const self = { tenantId: TENANT, employeeId: 5, permissions: ["absence.request"] };
  const body = (from, to, type = 1) => ({ absence_type_id: type, date_from: from, date_to: to });

  it("eigener Antrag über einen genehmigten Urlaub: 409 mit Klartext, nichts angelegt", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, self, "POST", "/abwesenheit", body("2026-10-15", "2026-10-20"));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/^Überschneidet sich mit Urlaub 12\.10\.2026 – 16\.10\.2026 \(genehmigt\)\./);
    expect(r.body.overlaps.map(o => o.ID)).toEqual([10]);
    expect(sb._tables.ABSENCE).toHaveLength(4);
  });

  it("auch über einen offenen Antrag; stornierte und fremde zählen nicht", async () => {
    const sb = makeFakeSupabase(tables());
    expect((await request(sb, self, "POST", "/abwesenheit", body("2026-11-03", "2026-11-03"))).status).toBe(409);
    const ok1 = await request(sb, self, "POST", "/abwesenheit", body("2026-12-02", "2026-12-03"));
    expect(ok1.status).toBe(200);
    const ok2 = await request(sb, self, "POST", "/abwesenheit", body("2026-10-19", "2026-10-23"));
    expect(ok2.status).toBe(200);
  });

  it("die Verwaltung darf überschneiden (Krank im Urlaub)", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, { tenantId: TENANT, employeeId: 1, permissions: ["absence.manage"] },
      "POST", "/abwesenheit", { ...body("2026-10-14", "2026-10-14", 2), employee_id: 5 });
    expect(r.status).toBe(200);
  });

  it("Ändern des eigenen Antrags prüft die neuen Daten, ohne sich selbst zu zählen", async () => {
    const sb = makeFakeSupabase(tables());
    const bad = await request(sb, self, "PATCH", "/abwesenheit/11", { date_from: "2026-10-16", date_to: "2026-10-19" });
    expect(bad.status).toBe(409);
    expect(sb._tables.ABSENCE.find(a => a.ID === 11).DATE_FROM).toBe("2026-11-02");
    const ok = await request(sb, self, "PATCH", "/abwesenheit/11", { date_from: "2026-11-02", date_to: "2026-11-05" });
    expect(ok.status).toBe(200);
    const note = await request(sb, self, "PATCH", "/abwesenheit/11", { note: "nur Notiz" });
    expect(note.status).toBe(200);
  });

  it("die Vorschau sagt, ob der Server sperren wird", async () => {
    const q = "/abwesenheit/preview?absence_type_id=1&date_from=2026-10-15&date_to=2026-10-20";
    const own = await request(makeFakeSupabase(tables()), self, "GET", q);
    expect(own.body.data.overlap_blocks).toBe(true);
    const mgr = await request(makeFakeSupabase(tables()), { tenantId: TENANT, employeeId: 1, permissions: ["absence.manage", "absence.view"] }, "GET", `${q}&employee_id=5`);
    expect(mgr.body.data.overlaps).toHaveLength(1);
    expect(mgr.body.data.overlap_blocks).toBe(false);
  });
});
