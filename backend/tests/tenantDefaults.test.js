"use strict";

// Vorbelegungen (Runde 12): feste Liste, Recht je Schlüssel, Werte geprüft,
// nichts halb geschrieben — und die Leser, die an leeren Zeilen scheiterten.
const express = require("express");
const makeRouter = require("../routes/stammdaten");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { getSettings } = require("../services/budgetWarnings");
const { resolveCostFactor } = require("../services/wipReport");

function buildApp(supabase, ctx) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = ctx.tenantId;
    req.employeeId = ctx.employeeId ?? 1;
    req.permissions = new Set(ctx.permissions || []);
    req.hasPermission = (k) => req.permissions.has(k);
    next();
  });
  app.use("/stammdaten", makeRouter(supabase));
  return app;
}
async function request(supabase, ctx, method, path, body) {
  const server = buildApp(supabase, ctx).listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { "content-type": "application/json" }, body: body != null ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally { server.close(); }
}

const T = 1;
const DEF = { tenantId: T, permissions: ["settings.defaults.edit"] };
function tables() {
  return {
    TENANT_SETTINGS: [
      { TENANT_ID: T, KEY: "offer_valid_days", VALUE: "30" },
      { TENANT_ID: T, KEY: "monatsabschluss_last_report_data", VALUE: "{\"umsatz\":123456}" },
      { TENANT_ID: T, KEY: "co_1_logo_data_uri", VALUE: "data:image/png;base64,AAAA" },
      { TENANT_ID: 2, KEY: "offer_valid_days", VALUE: "90" },
    ],
    COMPANY: [{ ID: 1, TENANT_ID: T }, { ID: 7, TENANT_ID: 2 }],
    ASSET: [{ ID: 11, COMPANY_ID: 1 }, { ID: 12, COMPANY_ID: 7 }],
    VAT: [{ ID: 3, VAT: "USt 19" }],
    CURRENCY: [{ ID: 1, ABBR: "EUR" }],
    COUNTRY: [{ ID: 1, ABBR: "DE" }],
    PROJECT_STATUS: [{ ID: 2, ABBR: "Laufend" }],
    OFFER_STATUS: [{ ID: 1, ABBR: "Offen" }],
    PAYMENT_MEANS: [{ ID: 1, ABBR: "58" }],
    ROLE: [{ ID: 5, TENANT_ID: T, ABBR: "PL", NAME: "Projektleitung", HOURLY_RATE: 95 }],
  };
}
const setting = (sb, key, tenant = T) => sb._tables.TENANT_SETTINGS.find(r => r.TENANT_ID === tenant && r.KEY === key);

describe("GET /stammdaten/defaults", () => {
  it("liefert nur Vorbelegungen — keinen Monatsabschluss-Bericht, kein Logo, nichts von anderen Büros", async () => {
    const r = await request(makeFakeSupabase(tables()), { tenantId: T, permissions: [] }, "GET", "/stammdaten/defaults");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ offer_valid_days: "30" });
  });
});

describe("PUT /stammdaten/defaults", () => {
  it("speichert mehrere Werte auf einmal, nimmt Komma und normalisiert", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, DEF, "PUT", "/stammdaten/defaults", { values: {
      default_cash_discount_percent: "2,5", default_vat_id: "3", budget_warning_default_pcts: "100; 75 90",
      kpi_cpi_watch_threshold: "0,9", kpi_cpi_critical_threshold: "0,75",
    } });
    expect(r.status).toBe(200);
    expect(setting(sb, "default_cash_discount_percent").VALUE).toBe("2.5");
    expect(setting(sb, "default_vat_id").VALUE).toBe("3");
    expect(setting(sb, "budget_warning_default_pcts").VALUE).toBe("75, 90, 100");
    expect(setting(sb, "kpi_cpi_critical_threshold").VALUE).toBe("0.75");
  });

  it("unbekannter Schlüssel: 400, und auch die gültigen Werte daneben bleiben ungeschrieben", async () => {
    const sb = makeFakeSupabase(tables());
    for (const key of ["co_1_logo_data_uri", "monatsabschluss_enabled", "arbzg_strict_mode", "absence_carryover_expires"]) {
      const r = await request(sb, DEF, "PUT", "/stammdaten/defaults", { values: { offer_valid_days: "45", [key]: "x" } });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Unbekannte Einstellung/);
    }
    expect(setting(sb, "offer_valid_days").VALUE).toBe("30");
    expect(setting(sb, "co_1_logo_data_uri").VALUE).toBe("data:image/png;base64,AAAA");
  });

  it("die alte Einzelform geht weiter, prüft aber genauso", async () => {
    const sb = makeFakeSupabase(tables());
    expect((await request(sb, DEF, "PUT", "/stammdaten/defaults", { key: "offer_valid_days", value: "14" })).status).toBe(200);
    expect(setting(sb, "offer_valid_days").VALUE).toBe("14");
    expect((await request(sb, DEF, "PUT", "/stammdaten/defaults", { key: "logo_data_uri", value: "data:x" })).status).toBe(400);
  });

  it("ungültige Werte: 400 mit Feldnamen, nichts geschrieben", async () => {
    const cases = [
      [{ offer_valid_days: "0" }, /Gültigkeitsdauer/],
      [{ offer_valid_days: "abc" }, /Gültigkeitsdauer/],
      [{ default_cash_discount_percent: "120" }, /Skonto/],
      [{ default_se_basis: "IRGENDWAS" }, /Basis/],
      [{ budget_warning_default_pcts: "75, abc" }, /Standard-Schwellen/],
      [{ default_vat_id: "999" }, /MwSt\..*nicht gefunden/],
      [{ "tenant.theme_default": "../../x" }, /Standard-Theme/],
    ];
    for (const [values, msg] of cases) {
      const sb = makeFakeSupabase(tables());
      const ctx = { tenantId: T, permissions: ["settings.defaults.edit", "settings.company.edit"] };
      const r = await request(sb, ctx, "PUT", "/stammdaten/defaults", { values: { ...values, default_payment_term_days: "30" } });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(msg);
      expect(setting(sb, "default_payment_term_days")).toBeUndefined();
    }
  });

  it("Firma und Anmeldebild nur aus dem eigenen Büro", async () => {
    const both = { tenantId: T, permissions: ["settings.defaults.edit", "settings.company.edit"] };
    expect((await request(makeFakeSupabase(tables()), both, "PUT", "/stammdaten/defaults", { values: { default_company_id: "7" } })).status).toBe(400);
    expect((await request(makeFakeSupabase(tables()), both, "PUT", "/stammdaten/defaults", { values: { default_company_id: "1" } })).status).toBe(200);
    expect((await request(makeFakeSupabase(tables()), both, "PUT", "/stammdaten/defaults", { values: { "tenant.hero_asset_id": "12" } })).status).toBe(400);
    expect((await request(makeFakeSupabase(tables()), both, "PUT", "/stammdaten/defaults", { values: { "tenant.hero_asset_id": "11" } })).status).toBe(200);
  });

  it("Recht je Schlüssel: Branding verlangt settings.company.edit, Vorbelegungen settings.defaults.edit", async () => {
    const r1 = await request(makeFakeSupabase(tables()), DEF, "PUT", "/stammdaten/defaults", { values: { "tenant.theme_default": "dark" } });
    expect(r1.status).toBe(403);
    const company = { tenantId: T, permissions: ["settings.company.edit"] };
    expect((await request(makeFakeSupabase(tables()), company, "PUT", "/stammdaten/defaults", { values: { "tenant.theme_default": "dark" } })).status).toBe(200);
    expect((await request(makeFakeSupabase(tables()), company, "PUT", "/stammdaten/defaults", { values: { offer_valid_days: "20" } })).status).toBe(403);
    expect((await request(makeFakeSupabase(tables()), { tenantId: T, permissions: [] }, "PUT", "/stammdaten/defaults", { values: { offer_valid_days: "20" } })).status).toBe(403);
  });

  it("leer heißt entfernen — die Zeile verschwindet, statt mit VALUE null stehen zu bleiben", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, DEF, "PUT", "/stammdaten/defaults", { values: { offer_valid_days: "", budget_warning_enabled: null } });
    expect(r.status).toBe(200);
    expect(setting(sb, "offer_valid_days")).toBeUndefined();
    expect(setting(sb, "budget_warning_enabled")).toBeUndefined();
    expect(setting(sb, "offer_valid_days", 2).VALUE).toBe("90");
  });

  it("„Handlungsbedarf“ muss unter „beobachten“ liegen — auch gegen den gespeicherten Wert", async () => {
    const sb = makeFakeSupabase(tables());
    expect((await request(sb, DEF, "PUT", "/stammdaten/defaults", { values: { kpi_cpi_watch_threshold: "0,8", kpi_cpi_critical_threshold: "0,9" } })).status).toBe(400);
    expect((await request(sb, DEF, "PUT", "/stammdaten/defaults", { values: { kpi_cpi_watch_threshold: "0,9" } })).status).toBe(200);
    expect((await request(sb, DEF, "PUT", "/stammdaten/defaults", { values: { kpi_cpi_critical_threshold: "0,95" } })).status).toBe(400);
  });
});

describe("Leser, die an leeren Einstellungen scheiterten", () => {
  it("Budget-Warnungen: eine Zeile mit VALUE null schaltet nichts ab", async () => {
    const sb = makeFakeSupabase({ TENANT_SETTINGS: [
      { TENANT_ID: T, KEY: "budget_warning_enabled", VALUE: null },
      { TENANT_ID: T, KEY: "budget_warning_notify_pm", VALUE: null },
      { TENANT_ID: T, KEY: "budget_warning_notify_booker", VALUE: "" },
      { TENANT_ID: T, KEY: "budget_warning_default_pcts", VALUE: null },
    ] });
    expect(await getSettings(sb, T)).toEqual({ enabled: true, defaultPcts: [75, 90, 100], notifyPm: true, notifyBooker: true });
  });

  it("Budget-Warnungen: 'false' schaltet ab, gespeicherte Schwellen gelten", async () => {
    const sb = makeFakeSupabase({ TENANT_SETTINGS: [
      { TENANT_ID: T, KEY: "budget_warning_notify_pm", VALUE: "false" },
      { TENANT_ID: T, KEY: "budget_warning_default_pcts", VALUE: "80, 100" },
    ] });
    const s = await getSettings(sb, T);
    expect(s.notifyPm).toBe(false);
    expect(s.defaultPcts).toEqual([80, 100]);
  });

  it("Teilfertige Leistungen: ohne Bewertungsfaktor gilt 100 %, nicht 0 %", async () => {
    expect(await resolveCostFactor(makeFakeSupabase({ TENANT_SETTINGS: [] }), T)).toBe(100);
    expect(await resolveCostFactor(makeFakeSupabase({ TENANT_SETTINGS: [{ TENANT_ID: T, KEY: "wip_cost_factor_percent", VALUE: null }] }), T)).toBe(100);
    expect(await resolveCostFactor(makeFakeSupabase({ TENANT_SETTINGS: [{ TENANT_ID: T, KEY: "wip_cost_factor_percent", VALUE: "80" }] }), T)).toBe(80);
    expect(await resolveCostFactor(makeFakeSupabase({ TENANT_SETTINGS: [{ TENANT_ID: T, KEY: "wip_cost_factor_percent", VALUE: "0" }] }), T)).toBe(0);
  });
});

describe("Stammdaten", () => {
  it("POST /stammdaten/status gibt es nicht mehr — der Katalog ist global", async () => {
    const sb = makeFakeSupabase(tables());
    const r = await request(sb, { tenantId: T, permissions: ["settings.basedata.edit"] }, "POST", "/stammdaten/status", { abbr: "Hack" });
    expect(r.status).toBe(404);
    expect(sb._tables.PROJECT_STATUS).toHaveLength(1);
  });

  it("Stundensatz einer Rolle: Komma geht, Unsinn nicht", async () => {
    const sb = makeFakeSupabase(tables());
    const ctx = { tenantId: T, permissions: ["settings.basedata.edit"] };
    const ok = await request(sb, ctx, "PATCH", "/stammdaten/rolle/5", { abbr: "PL", name: "Projektleitung", hourly_rate: "97,50" });
    expect(ok.status).toBe(200);
    expect(sb._tables.ROLE[0].HOURLY_RATE).toBe(97.5);
    const bad = await request(sb, ctx, "PATCH", "/stammdaten/rolle/5", { abbr: "PL", hourly_rate: "abc" });
    expect(bad.status).toBe(400);
    expect(sb._tables.ROLE[0].HOURLY_RATE).toBe(97.5);
    expect((await request(sb, ctx, "PATCH", "/stammdaten/rolle/99", { abbr: "X" })).status).toBe(404);
  });
});
