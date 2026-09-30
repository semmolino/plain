"use strict";

// Sicherheitsluecken im Mitarbeiter-Modul (UI-Pilot Runde 10). Jeder Block
// hier war offen: Gehalts-Guard per Schraegstrich umgangen, Rechte bei
// Ladefehler „alle", fremde E-Mail = Kontouebernahme, Passwort setzen ohne
// Sitzungsende und fuer maechtigere Konten, jede Datei als Profilfoto,
// Rollen ueber die eigenen Rechte hinaus, das eigene Konto / der letzte Admin
// loeschbar, ArbZG-Audit ohne Recht, Kosten ohne Gehaltsrecht.

const express = require("express");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { makeMiddleware, requirePermission } = require("../middleware/permissions");

const T = 1, F = 99;

function baseData(extra = {}) {
  return {
    EMPLOYEE: [
      { ID: 1, TENANT_ID: T, ABBR: "SM", FIRST_NAME: "Simon", LAST_NAME: "Messina", MAIL: "s@buero.de", GENDER_ID: 1, ACTIVE: 1 },
      { ID: 2, TENANT_ID: T, ABBR: "TK", FIRST_NAME: "Thomas", LAST_NAME: "Kern", MAIL: "t@buero.de", GENDER_ID: 1, ACTIVE: 1 },
      { ID: 3, TENANT_ID: T, ABBR: "LH", FIRST_NAME: "Lena", LAST_NAME: "Hartmann", MAIL: "l@buero.de", GENDER_ID: 2, ACTIVE: 1 },
      { ID: 50, TENANT_ID: F, ABBR: "XX", FIRST_NAME: "Fremd", LAST_NAME: "Konto", MAIL: "x@fremd.de", GENDER_ID: 1, ACTIVE: 1 },
    ],
    GENDER: [{ ID: 1, GENDER: "männlich" }, { ID: 2, GENDER: "weiblich" }],
    EMPLOYEE_COST_RATE: [{ ID: 7, TENANT_ID: T, EMPLOYEE_ID: 2, COST_RATE: 58.4, VALID_FROM: "2026-01-01" }],
    // Rolle 1 = Administrator, 2 = Mitarbeiter-Verwaltung (ohne Gehalt/Rollen), 3 = einfach
    USER_ROLE: [{ ID: 1, TENANT_ID: T }, { ID: 2, TENANT_ID: T }, { ID: 3, TENANT_ID: T }],
    PERMISSION: [
      { ID: 11, KEY: "roles.edit" }, { ID: 12, KEY: "employees.role.assign" },
      { ID: 13, KEY: "employees.view" }, { ID: 14, KEY: "employees.edit" },
      { ID: 15, KEY: "employees.salary.view" }, { ID: 16, KEY: "employees.password.set" },
    ],
    // PERMISSION ist eingebettet wie der PostgREST-Join „PERMISSION!inner ( KEY )"
    ROLE_PERMISSION: [
      ...[11, 12, 13, 14, 15, 16].map(p => ({ ROLE_ID: 1, PERMISSION_ID: p })),
      ...[13, 14, 16].map(p => ({ ROLE_ID: 2, PERMISSION_ID: p })),
      { ROLE_ID: 3, PERMISSION_ID: 13 },
    ].map(r => ({ ...r, PERMISSION: { KEY: { 11: "roles.edit", 12: "employees.role.assign", 13: "employees.view", 14: "employees.edit", 15: "employees.salary.view", 16: "employees.password.set" }[r.PERMISSION_ID] } })),
    EMPLOYEE_ROLE: [{ EMPLOYEE_ID: 1, ROLE_ID: 1 }, { EMPLOYEE_ID: 2, ROLE_ID: 2 }, { EMPLOYEE_ID: 3, ROLE_ID: 3 }],
    ASSET: [], COMPANY: [{ ID: 5, TENANT_ID: T }],
    ...extra,
  };
}

/** App mit der echten Permissions-Middleware: die Rechte kommen aus den Rollen. */
function app(sb, employeeId, mount) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.tenantId = T; req.employeeId = employeeId; next(); });
  a.use(makeMiddleware(sb));
  mount(a);
  return a;
}

async function call(a, method, path, body) {
  const server = a.listen(0);
  await new Promise(r => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, body: json, text };
  } finally { server.close(); }
}

const mitarbeiter = (sb, who) => app(sb, who, a => a.use("/mitarbeiter", require("../routes/mitarbeiter")(sb)));
const emp = (sb, id) => sb._tables.EMPLOYEE.find(e => e.ID === id);

describe("C1 Gehalts-Guard", () => {
  test.each(["/mitarbeiter/2/cp-rates", "/mitarbeiter/2/cp-rates/", "/mitarbeiter/2/CP-RATES", "/mitarbeiter/2/Cp-Rate?date=2026-09-01", "/mitarbeiter/2/cp-rate/"])(
    "%s ohne Gehaltsrecht → 403", async (path) => {
      const sb = makeFakeSupabase(baseData());
      const r = await call(mitarbeiter(sb, 3), "GET", path);   // Lena: nur employees.view
      expect(r.status).toBe(403);
    });

  test("mit Gehaltsrecht lesbar", async () => {
    const sb = makeFakeSupabase(baseData());
    const r = await call(mitarbeiter(sb, 1), "GET", "/mitarbeiter/2/cp-rates");
    expect(r.status).toBe(200);
    expect(r.body.data[0].COST_RATE).toBe(58.4);
  });
});

describe("C2 Rechte laden fail-closed", () => {
  test("Ladefehler → 503 statt „alle Rechte“", async () => {
    const sb = makeFakeSupabase(baseData());
    const orig = sb.from.bind(sb);
    sb.from = (t) => (t === "EMPLOYEE_ROLE" ? { select: () => ({ eq: async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } }) }) } : orig(t));
    const a = app(sb, 3, x => x.get("/geheim", requirePermission("employees.salary.view"), (_req, res) => res.json({ ok: true })));
    const r = await call(a, "GET", "/geheim");
    expect(r.status).toBe(503);
  });

  test("fehlende RBAC-Migration bleibt der einzige unrestricted-Fall", async () => {
    const sb = makeFakeSupabase(baseData());
    const orig = sb.from.bind(sb);
    sb.from = (t) => (t === "EMPLOYEE_ROLE" ? { select: () => ({ eq: async () => ({ data: null, error: { message: 'relation "EMPLOYEE_ROLE" does not exist' } }) }) } : orig(t));
    const a = app(sb, 3, x => x.get("/frei", requirePermission("employees.salary.view"), (_req, res) => res.json({ ok: true })));
    expect((await call(a, "GET", "/frei")).status).toBe(200);
  });
});

describe("C3 E-Mail fremder Konten", () => {
  test("mit employees.edit allein → 403, Adresse bleibt", async () => {
    const sb = makeFakeSupabase(baseData({
      ROLE_PERMISSION: baseData().ROLE_PERMISSION.filter(r => !(r.ROLE_ID === 2 && r.PERMISSION_ID === 16)),
    }));
    const r = await call(mitarbeiter(sb, 2), "PATCH", "/mitarbeiter/3", { mail: "angreifer@example.com" });
    expect(r.status).toBe(403);
    expect(emp(sb, 3).MAIL).toBe("l@buero.de");
  });

  test("mit Zugangsrecht erlaubt — und die Sitzungen des Kontos enden", async () => {
    const sb = makeFakeSupabase(baseData());
    const r = await call(mitarbeiter(sb, 2), "PATCH", "/mitarbeiter/3", { mail: "lena.hartmann@buero.de" });
    expect(r.status).toBe(200);
    expect(emp(sb, 3).MAIL).toBe("lena.hartmann@buero.de");
    expect(emp(sb, 3).SESSION_EPOCH).toBeTruthy();
  });

  test("die eigene Adresse ändert jeder selbst, ohne abgemeldet zu werden", async () => {
    const sb = makeFakeSupabase(baseData());
    const r = await call(mitarbeiter(sb, 2), "PATCH", "/mitarbeiter/2", { mail: "thomas@buero.de" });
    expect(r.status).toBe(200);
    expect(emp(sb, 2).SESSION_EPOCH).toBeUndefined();
  });
});

describe("PATCH als Teil-Update", () => {
  test("nur die Abteilung — Rest bleibt, auch ohne Geschlecht", async () => {
    const sb = makeFakeSupabase(baseData());
    emp(sb, 3).GENDER_ID = null;
    const r = await call(mitarbeiter(sb, 1), "PATCH", "/mitarbeiter/3", { department_id: 2 });
    expect(r.status).toBe(200);
    expect(emp(sb, 3)).toMatchObject({ DEPARTMENT_ID: 2, MAIL: "l@buero.de", FIRST_NAME: "Lena" });
  });

  test.each([
    [{ first_name: "  " }, /Vorname/], [{ gender_id: 0 }, /Geschlecht/], [{ active: 3 }, /aktiv/],
    [{ supervisor_id: 3 }, /eigener Vorgesetzter/], [{ supervisor_id: 50 }, /Vorgesetzten gibt es nicht/],
    [{ dashboard_role: "root" }, /Dashboard-Rolle/], [{}, /Nichts zu ändern/],
  ])("%j → 400", async (body, msg) => {
    const sb = makeFakeSupabase(baseData());
    const r = await call(mitarbeiter(sb, 1), "PATCH", "/mitarbeiter/3", body);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(msg);
  });

  test("fremder Mitarbeiter → 404", async () => {
    const sb = makeFakeSupabase(baseData());
    expect((await call(mitarbeiter(sb, 1), "PATCH", "/mitarbeiter/50", { first_name: "X" })).status).toBe(404);
  });

  test("sich selbst oder den letzten Admin deaktivieren → 409", async () => {
    const sb = makeFakeSupabase(baseData());
    expect((await call(mitarbeiter(sb, 1), "PATCH", "/mitarbeiter/1", { active: 2 })).status).toBe(409);
    sb._tables.EMPLOYEE_ROLE.push({ EMPLOYEE_ID: 2, ROLE_ID: 1 });
    // zwei Admins: Thomas darf Simon deaktivieren …
    expect((await call(mitarbeiter(sb, 2), "PATCH", "/mitarbeiter/1", { active: 2 })).status).toBe(200);
    // … danach ist Thomas der letzte — Simon (inaktiv) zählt nicht mehr
    sb._tables.EMPLOYEE_ROLE = sb._tables.EMPLOYEE_ROLE.filter(r => !(r.EMPLOYEE_ID === 2 && r.ROLE_ID === 1));
  });
});

describe("H5 Passwort setzen", () => {
  test("Zahl statt Text → 400, Passwort bleibt", async () => {
    const sb = makeFakeSupabase(baseData());
    emp(sb, 3).PASSWORD = "hash";
    const r = await call(mitarbeiter(sb, 1), "PATCH", "/mitarbeiter/3/set-password", { new_password: 12345678 });
    expect(r.status).toBe(400);
    expect(emp(sb, 3).PASSWORD).toBe("hash");
  });

  test("für ein mächtigeres Konto → 403", async () => {
    const sb = makeFakeSupabase(baseData());
    const r = await call(mitarbeiter(sb, 2), "PATCH", "/mitarbeiter/1/set-password", { new_password: "geheim12345" });
    expect(r.status).toBe(403);
  });

  test("gesetzt → laufende Sitzungen enden", async () => {
    const sb = makeFakeSupabase(baseData());
    const r = await call(mitarbeiter(sb, 2), "PATCH", "/mitarbeiter/3/set-password", { new_password: "geheim12345" });
    expect(r.status).toBe(200);
    expect(emp(sb, 3).PASSWORD).toMatch(/^\$2/);
    expect(emp(sb, 3).SESSION_EPOCH).toBeTruthy();
  });
});

describe("Eigenes Passwort löschen", () => {
  test("→ 409, Passwort bleibt, keine Abmeldung", async () => {
    const sb = makeFakeSupabase(baseData());
    emp(sb, 1).PASSWORD = "hash";
    const r = await call(mitarbeiter(sb, 1), "PATCH", "/mitarbeiter/1/set-password", { new_password: null });
    expect(r.status).toBe(409);
    expect(emp(sb, 1).PASSWORD).toBe("hash");
  });
});

describe("H3 Profilfoto", () => {
  test("ein Rechnungs-PDF als Profilfoto → 400", async () => {
    const sb = makeFakeSupabase(baseData({ ASSET: [{ ID: 70, TENANT_ID: T, COMPANY_ID: 5, ASSET_TYPE: "INVOICE_PDF", MIME_TYPE: "application/pdf", STORAGE_KEY: "k" }] }));
    const r = await call(mitarbeiter(sb, 3), "POST", "/mitarbeiter/me/avatar", { asset_id: 70 });
    expect(r.status).toBe(400);
    expect(r.body?.data_uri).toBeUndefined();
  });
});

describe("M10 Kostensatz", () => {
  test.each([[""], [" "], ["abc"], [-5]])("cost_rate %j → 400", async (v) => {
    const sb = makeFakeSupabase(baseData({ ROLE_PERMISSION: [...baseData().ROLE_PERMISSION, { ROLE_ID: 1, PERMISSION_ID: 17, PERMISSION: { KEY: "employees.salary.edit" } }], PERMISSION: [...baseData().PERMISSION, { ID: 17, KEY: "employees.salary.edit" }] }));
    const r = await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter/2/cp-rates", { cost_rate: v, valid_from: "2026-10-01" });
    expect(r.status).toBe(400);
    expect(sb._tables.EMPLOYEE_COST_RATE).toHaveLength(1);
  });
});

describe("Datierte Einträge: Kostensatz und Arbeitszeitmodell", () => {
  const withSalaryEdit = (extra = {}) => baseData({
    ROLE_PERMISSION: [...baseData().ROLE_PERMISSION, { ROLE_ID: 1, PERMISSION_ID: 17, PERMISSION: { KEY: "employees.salary.edit" } }],
    PERMISSION: [...baseData().PERMISSION, { ID: 17, KEY: "employees.salary.edit" }],
    WORKING_TIME_MODEL: [{ ID: 4, TENANT_ID: T, NAME: "Vollzeit" }, { ID: 40, TENANT_ID: F, NAME: "Fremdes Modell" }],
    EMPLOYEE_WORK_MODEL: [{ ID: 8, TENANT_ID: T, EMPLOYEE_ID: 2, MODEL_ID: 4, VALID_FROM: "2026-01-01" }],
    ...extra,
  });

  test("zweiter Kostensatz am selben Tag → 409", async () => {
    const sb = makeFakeSupabase(withSalaryEdit());
    const r = await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter/2/cp-rates", { cost_rate: 60, valid_from: "2026-01-01" });
    expect(r.status).toBe(409);
    expect(sb._tables.EMPLOYEE_COST_RATE).toHaveLength(1);
  });

  test("Modell eines fremden Büros → 400", async () => {
    const sb = makeFakeSupabase(withSalaryEdit());
    const r = await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter/2/work-models", { model_id: 40, valid_from: "2026-10-01" });
    expect(r.status).toBe(400);
    expect(sb._tables.EMPLOYEE_WORK_MODEL).toHaveLength(1);
  });

  test("ungültiges Datum → 400 statt Serverfehler", async () => {
    const sb = makeFakeSupabase(withSalaryEdit());
    const r = await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter/2/work-models", { model_id: 4, valid_from: "01.10.2026" });
    expect(r.status).toBe(400);
  });

  test("fremder Mitarbeiter → 404", async () => {
    const sb = makeFakeSupabase(withSalaryEdit());
    const r = await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter/50/work-models", { model_id: 4, valid_from: "2026-10-01" });
    expect(r.status).toBe(404);
  });

  test("zweites Modell am selben Tag → 409, auch beim Verschieben", async () => {
    const sb = makeFakeSupabase(withSalaryEdit({
      EMPLOYEE_WORK_MODEL: [
        { ID: 8, TENANT_ID: T, EMPLOYEE_ID: 2, MODEL_ID: 4, VALID_FROM: "2026-01-01" },
        { ID: 9, TENANT_ID: T, EMPLOYEE_ID: 2, MODEL_ID: 4, VALID_FROM: "2026-07-01" },
      ],
    }));
    expect((await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter/2/work-models", { model_id: 4, valid_from: "2026-07-01" })).status).toBe(409);
    expect((await call(mitarbeiter(sb, 1), "PATCH", "/mitarbeiter/2/work-models/9", { valid_from: "2026-01-01" })).status).toBe(409);
  });

  test("unbekannte Zuordnung ändern → 404", async () => {
    const sb = makeFakeSupabase(withSalaryEdit());
    const r = await call(mitarbeiter(sb, 1), "PATCH", "/mitarbeiter/2/work-models/77", { valid_from: "2026-03-01" });
    expect(r.status).toBe(404);
  });

  test("gültige Zuordnung → angelegt", async () => {
    const sb = makeFakeSupabase(withSalaryEdit());
    const r = await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter/2/work-models", { model_id: 4, valid_from: "2026-10-01" });
    expect(r.status).toBe(200);
    expect(sb._tables.EMPLOYEE_WORK_MODEL).toHaveLength(2);
  });
});

describe("Neuanlage", () => {
  const withCreate = () => baseData({
    ROLE_PERMISSION: [...baseData().ROLE_PERMISSION, { ROLE_ID: 1, PERMISSION_ID: 18, PERMISSION: { KEY: "employees.create" } }],
    PERMISSION: [...baseData().PERMISSION, { ID: 18, KEY: "employees.create" }],
    USER_ROLE: [{ ID: 1, TENANT_ID: T, IS_DEFAULT: false }],
  });
  const ok = { abbr: " NE ", first_name: "Nina", last_name: "Eck", gender_id: "2", email: "", personnel_number: " " };

  test("Vorgesetzter aus einem fremden Büro → 400, nichts angelegt", async () => {
    const sb = makeFakeSupabase(withCreate());
    const r = await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter", { ...ok, supervisor_id: 50 });
    expect(r.status).toBe(400);
    expect(sb._tables.EMPLOYEE).toHaveLength(4);
  });

  test("Eingaben getrimmt, leere Angaben als null", async () => {
    const sb = makeFakeSupabase(withCreate());
    const r = await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter", ok);
    expect(r.status).toBe(200);
    const neu = sb._tables.EMPLOYEE.find(e => e.ABBR === "NE");
    expect(neu).toBeTruthy();
    expect(neu.MAIL).toBeNull();
    expect(neu.PERSONNEL_NUMBER).toBeNull();
    expect(neu.GENDER_ID).toBe(2);
  });

  test("Kürzel eines anderen trotz Leerzeichen → 409", async () => {
    const sb = makeFakeSupabase(withCreate());
    const r = await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter", { ...ok, abbr: "tk " });
    expect(r.status).toBe(409);
  });
});

describe("Einladungslink ohne Mailversand", () => {
  const withCreate = () => baseData({
    ROLE_PERMISSION: [...baseData().ROLE_PERMISSION, { ROLE_ID: 1, PERMISSION_ID: 18, PERMISSION: { KEY: "employees.create" } }],
    PERMISSION: [...baseData().PERMISSION, { ID: 18, KEY: "employees.create" }],
    USER_ROLE: [{ ID: 1, TENANT_ID: T, IS_DEFAULT: false }],
  });
  const smtp = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"].map(k => [k, process.env[k]]);
  const secret = process.env.JWT_SECRET;
  beforeEach(() => { for (const [k] of smtp) delete process.env[k]; process.env.JWT_SECRET = "test-secret-mindestens-32-zeichen-lang-xx"; });
  afterAll(() => {
    for (const [k, v] of smtp) if (v !== undefined) process.env[k] = v;
    if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
  });

  test("Neuanlage: kein Link in der Antwort", async () => {
    const sb = makeFakeSupabase(withCreate());
    const r = await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter", { abbr: "NE", first_name: "Nina", last_name: "Eck", gender_id: 2, email: "n.eck@buero.de" });
    expect(r.status).toBe(200);
    expect(r.body.invite.sent).toBe(false);
    expect(r.body.invite).not.toHaveProperty("url");
    expect(r.text).not.toMatch(/token=|passwort-festlegen|set-password\?/i);
  });

  test("Einladung erneut senden: kein Link in der Fehlermeldung", async () => {
    const sb = makeFakeSupabase(baseData());
    const r = await call(mitarbeiter(sb, 1), "POST", "/mitarbeiter/2/invite", {});
    expect(r.status).toBe(500);
    expect(r.body).not.toHaveProperty("url");
  });
});

describe("H6 Mitarbeiter löschen", () => {
  const withDelete = () => baseData({
    PERMISSION: [...baseData().PERMISSION, { ID: 18, KEY: "employees.delete" }],
    ROLE_PERMISSION: [...baseData().ROLE_PERMISSION, { ROLE_ID: 1, PERMISSION_ID: 18, PERMISSION: { KEY: "employees.delete" } }],
    BOOKING: [], PROJECT: [], EMPLOYEE2PROJECT: [], EMPLOYEE_MONTH_CLOSE: [], EMPLOYEE_WORK_MODEL: [],
    OFFER: [], INVOICE: [], ADVANCE_INVOICE: [], MAHNUNG: [], NACHTRAG: [], ABSENCE: [],
  });

  test("das eigene Konto → 409", async () => {
    const sb = makeFakeSupabase(withDelete());
    expect((await call(mitarbeiter(sb, 1), "DELETE", "/mitarbeiter/1")).status).toBe(409);
  });

  test("Rechnung als Zuständige:r blockiert mit Klartext", async () => {
    const d = withDelete();
    d.INVOICE = [{ ID: 4, TENANT_ID: T, EMPLOYEE_ID: 3, INVOICE_NUMBER: "RE-2026-0041" }];
    d.EMPLOYEE_COST_RATE = [];
    const sb = makeFakeSupabase(d);
    const r = await call(mitarbeiter(sb, 1), "DELETE", "/mitarbeiter/3");
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/RE-2026-0041/);
    expect(r.body.error).toMatch(/inaktiv/);
  });

  test("frei → gelöscht, Rollenvergabe-Nachweis gelöst", async () => {
    const d = withDelete();
    d.EMPLOYEE_COST_RATE = [];
    d.EMPLOYEE_ROLE = [...d.EMPLOYEE_ROLE, { EMPLOYEE_ID: 2, ROLE_ID: 3, ASSIGNED_BY: 3 }];
    const sb = makeFakeSupabase(d);
    const r = await call(mitarbeiter(sb, 1), "DELETE", "/mitarbeiter/3");
    expect(r.status).toBe(200);
    expect(emp(sb, 3)).toBeUndefined();
    expect(sb._tables.EMPLOYEE_ROLE.find(x => x.EMPLOYEE_ID === 2 && x.ROLE_ID === 3).ASSIGNED_BY).toBeNull();
  });
});

describe("M9 Rollen zuweisen", () => {
  const roles = (sb, who) => app(sb, who, a => a.use("/", require("../routes/roles")(sb)));

  test("Rolle mit Rechten, die man selbst nicht hat → 403", async () => {
    const sb = makeFakeSupabase(baseData({
      ROLE_PERMISSION: [...baseData().ROLE_PERMISSION, { ROLE_ID: 2, PERMISSION_ID: 12, PERMISSION: { KEY: "employees.role.assign" } }],
    }));
    const r = await call(roles(sb, 2), "PUT", "/employees/3/roles", { role_ids: [1] });
    expect(r.status).toBe(403);
    expect(sb._tables.EMPLOYEE_ROLE.find(x => x.EMPLOYEE_ID === 3).ROLE_ID).toBe(3);
  });

  test("Rolle innerhalb der eigenen Rechte → ok", async () => {
    const sb = makeFakeSupabase(baseData({
      ROLE_PERMISSION: [...baseData().ROLE_PERMISSION, { ROLE_ID: 2, PERMISSION_ID: 12, PERMISSION: { KEY: "employees.role.assign" } }],
    }));
    const r = await call(roles(sb, 2), "PUT", "/employees/3/roles", { role_ids: [3] });
    expect(r.status).toBe(200);
  });
});

describe("H2 ArbZG-Audit", () => {
  const arbzg = (sb, who) => app(sb, who, a => a.use("/arbzg", require("../routes/arbzg")(sb)));
  const d = () => baseData({ ARBZG_AUDIT: [{ ID: 1, TENANT_ID: T, EMPLOYEE_ID: 2, BOOKING_DATE: "2026-09-01", EVENT_TYPE: "MAX_DAILY", SEVERITY: "violation", DETAILS: {} }] });

  test("alle ohne Recht → 403, auch der Export", async () => {
    const sb = makeFakeSupabase(d());
    expect((await call(arbzg(sb, 3), "GET", "/arbzg/audit")).status).toBe(403);
    expect((await call(arbzg(sb, 3), "GET", "/arbzg/audit/export")).status).toBe(403);
    expect((await call(arbzg(sb, 3), "GET", "/arbzg/limits/2?date=2026-09-01")).status).toBe(403);
  });

  test("die eigenen gehen", async () => {
    const sb = makeFakeSupabase(d());
    expect((await call(arbzg(sb, 2), "GET", "/arbzg/audit?employee_id=2")).status).toBe(200);
  });
});

describe("M2 Salden und Kosten", () => {
  test("fremder Saldo nur mit „alle Buchungen sehen“", async () => {
    const sb = makeFakeSupabase(baseData());
    expect((await call(mitarbeiter(sb, 3), "GET", "/mitarbeiter/2/balance?year=2026&month=9")).status).toBe(403);
  });

  test("ungültiger Monat → 400 statt Serverfehler", async () => {
    const sb = makeFakeSupabase(baseData());
    expect((await call(mitarbeiter(sb, 3), "GET", "/mitarbeiter/3/balance?year=2026&month=13")).status).toBe(400);
  });
});

describe("M4 Abwesenheit entscheiden", () => {
  const abw = (sb, who, perms) => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.tenantId = T; req.employeeId = who;
      req.permissions = new Set(perms); req.hasPermission = (k) => req.permissions.has(k);
      next();
    });
    a.use("/abwesenheit", require("../routes/abwesenheit")(sb));
    return a;
  };
  const d = () => makeFakeSupabase({ ABSENCE: [
    { ID: 1, TENANT_ID: T, EMPLOYEE_ID: 2, STATUS: "REQUESTED" },
    { ID: 2, TENANT_ID: T, EMPLOYEE_ID: 2, STATUS: "CANCELLED" },
    { ID: 3, TENANT_ID: T, EMPLOYEE_ID: 1, STATUS: "REQUESTED" },
  ], NOTIFICATION: [], EMPLOYEE: [] });

  test("zurückgezogener Antrag → 409, bleibt zurückgezogen", async () => {
    const sb = d();
    const r = await call(abw(sb, 1, ["absence.approve"]), "POST", "/abwesenheit/2/decision", { decision: "APPROVED" });
    expect(r.status).toBe(409);
    expect(sb._tables.ABSENCE.find(x => x.ID === 2).STATUS).toBe("CANCELLED");
  });
  test("unbekannter Antrag → 404 statt Erfolg", async () => {
    expect((await call(abw(d(), 1, ["absence.approve"]), "POST", "/abwesenheit/99/decision", { decision: "APPROVED" })).status).toBe(404);
  });
  test("eigener Antrag nur mit „Abwesenheiten verwalten“", async () => {
    expect((await call(abw(d(), 1, ["absence.approve"]), "POST", "/abwesenheit/3/decision", { decision: "APPROVED" })).status).toBe(403);
    expect((await call(abw(d(), 1, ["absence.approve", "absence.manage"]), "POST", "/abwesenheit/3/decision", { decision: "APPROVED" })).status).toBe(200);
  });
  test("offener fremder Antrag → genehmigt", async () => {
    const sb = d();
    expect((await call(abw(sb, 1, ["absence.approve"]), "POST", "/abwesenheit/1/decision", { decision: "APPROVED" })).status).toBe(200);
    expect(sb._tables.ABSENCE.find(x => x.ID === 1).STATUS).toBe("APPROVED");
  });
});

describe("Urlaubsansprüche je Jahr (Bulk)", () => {
  const abw = (sb) => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.tenantId = T; req.employeeId = 1;
      req.permissions = new Set(["absence.manage"]); req.hasPermission = (k) => req.permissions.has(k);
      next();
    });
    a.use("/abwesenheit", require("../routes/abwesenheit")(sb));
    return a;
  };
  const d = () => makeFakeSupabase({
    EMPLOYEE: baseData().EMPLOYEE,
    VACATION_ENTITLEMENT: [{ ID: 1, TENANT_ID: T, EMPLOYEE_ID: 2, YEAR: 2026, DAYS_ENTITLED: 30, CARRYOVER_OVERRIDE: null }],
  });

  test("leerer Anspruch wird nicht zu 0 Tagen → 400", async () => {
    const sb = d();
    const r = await call(abw(sb), "PUT", "/abwesenheit/entitlements/bulk", { year: 2026, items: [{ employee_id: 2, days_entitled: "" }] });
    expect(r.status).toBe(400);
    expect(sb._tables.VACATION_ENTITLEMENT[0].DAYS_ENTITLED).toBe(30);
  });

  test("„abc“ → 400 statt stillem Erfolg", async () => {
    const sb = d();
    const r = await call(abw(sb), "PUT", "/abwesenheit/entitlements/bulk", { year: 2026, items: [{ employee_id: 3, days_entitled: "abc" }] });
    expect(r.status).toBe(400);
    expect(sb._tables.VACATION_ENTITLEMENT).toHaveLength(1);
  });

  test("Mitarbeiter eines fremden Büros → 404", async () => {
    const sb = d();
    const r = await call(abw(sb), "PUT", "/abwesenheit/entitlements/bulk", { year: 2026, items: [{ employee_id: 50, days_entitled: 28 }] });
    expect(r.status).toBe(404);
    expect(sb._tables.VACATION_ENTITLEMENT).toHaveLength(1);
  });

  test("Komma und Übertrag → gespeichert", async () => {
    const sb = d();
    const r = await call(abw(sb), "PUT", "/abwesenheit/entitlements/bulk", { year: 2026, items: [{ employee_id: 2, days_entitled: "27,5", carryover_override: "2" }, { employee_id: 3, days_entitled: 30 }] });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(2);
    expect(sb._tables.VACATION_ENTITLEMENT.find(e => e.EMPLOYEE_ID === 2)).toMatchObject({ DAYS_ENTITLED: 27.5, CARRYOVER_OVERRIDE: 2 });
    expect(sb._tables.VACATION_ENTITLEMENT.find(e => e.EMPLOYEE_ID === 3)).toMatchObject({ DAYS_ENTITLED: 30, YEAR: 2026 });
  });
});

describe("H4 Mitarbeiter-Import: dieselben Rechte wie in der Oberfläche", () => {
  const { DOMAINS } = require("../services/importService");
  const authorize = DOMAINS.employee.authorizeCommit;
  const caller = (keys, frei = null) => ({
    can: (k) => keys.includes(k),
    keysBeyond: (ks) => [...ks].filter(k => !keys.includes(k)),
    seatsLeft: async () => frei,
  });
  const row = (extra = {}, db = {}) => ({ _extra: extra, _dbRow: { ACTIVE: 1, ...db } });
  const sb = makeFakeSupabase({ ROLE_PERMISSION: [{ ROLE_ID: 1, PERMISSION: { KEY: "roles.edit" } }, { ROLE_ID: 3, PERMISSION: { KEY: "employees.view" } }] });
  const run = (c, { toInsert = [], toMerge = [] }) => authorize({ toInsert, toMerge, wanted: [...toInsert, ...toMerge], caller: c, supabase: sb });

  test("Kostensätze ohne Gehaltsrecht → 403", async () => {
    await expect(run(caller(["employees.create"]), { toInsert: [row({ costRate: { value: 50, from: "2026-01-01" } })] }))
      .rejects.toMatchObject({ status: 403, message: expect.stringMatching(/Kostensätze/) });
  });
  test("Administratorrolle ohne die Rechte darin → 403", async () => {
    await expect(run(caller(["employees.create", "employees.role.assign", "employees.view"]), { toInsert: [row({ roleId: 1 })] }))
      .rejects.toMatchObject({ status: 403, message: expect.stringMatching(/roles\.edit/) });
  });
  test("Zusammenführen mit E-Mail ohne Zugangsrecht → 403", async () => {
    await expect(run(caller(["employees.edit"]), { toMerge: [row({}, { MAIL: "neu@x.de" })] }))
      .rejects.toMatchObject({ status: 403, message: expect.stringMatching(/E-Mail/) });
  });
  test("mehr neue Aktive als freie Plätze → 402; Inaktive zählen nicht", async () => {
    await expect(run(caller(["employees.create"], 1), { toInsert: [row(), row()] })).rejects.toMatchObject({ status: 402 });
    await expect(run(caller(["employees.create"], 1), { toInsert: [row(), row({}, { ACTIVE: 2 })] })).resolves.toBeUndefined();
  });
  test("mit allen Rechten → durch", async () => {
    await expect(run(caller(["employees.create", "employees.salary.edit", "employees.role.assign", "employees.view"]),
      { toInsert: [row({ costRate: { value: 50, from: "2026-01-01" }, roleId: 3 })] })).resolves.toBeUndefined();
  });
});

describe("M3 Stundensätze der Team-Zuordnung", () => {
  const e2p = (sb, perms) => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.tenantId = T; req.employeeId = 1;
      req.permissions = new Set(perms); req.hasPermission = (k) => req.permissions.has(k);
      next();
    });
    a.use("/employee2project", require("../routes/employee2project")(sb));
    return a;
  };
  const d = () => makeFakeSupabase({ EMPLOYEE2PROJECT: [{ ID: 1, TENANT_ID: T, EMPLOYEE_ID: 2, PROJECT_ID: 5, ROLE_ID: 2, ROLE_ABBR: "PL", ROLE_NAME: "Projektleitung", HOURLY_RATE: 95 }] });

  test("Vorbelegung ohne Recht: Rolle ja, Satz nein", async () => {
    const r = await call(e2p(d(), []), "GET", "/employee2project/preset?employee_id=2&project_id=5");
    expect(r.body).toMatchObject({ found: true, ROLE_ABBR: "PL", HOURLY_RATE: null });
  });
  test("mit „Stundensätze sehen“ mit Satz", async () => {
    const r = await call(e2p(d(), ["projects.hourly_rates.view"]), "GET", "/employee2project/preset?employee_id=2&project_id=5");
    expect(r.body.HOURLY_RATE).toBe(95);
  });
});
