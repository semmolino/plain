"use strict";

// Gesamtprojekt auf Belegen (Stufe 3, docs/GESAMTPROJEKT_CONCEPT.md):
// die Zeile „Bauvorhaben: …" auf Rechnung, Storno, Mahnung und Nachtrag und
// der Platzhalter {{bauvorhaben}} in E-Mails und Kopf-/Fusstexten.
// Festgehalten wird:
//   - die Zeile erscheint NUR bei Projekten in einem Gesamtprojekt — fuer alle
//     anderen Belege aendert sich nichts,
//   - sie ist in der Dokumentvorlage abschaltbar,
//   - ein fremdes Gesamtprojekt erscheint nie, auch nicht ueber eine Zuordnung,
//   - im Deploy-Fenster (Spalte fehlt noch) entsteht der Beleg trotzdem.

const path = require("path");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { bauvorhabenForProject } = require("../services/gesamtprojekte");
const { templateEnv, renderPreviewDoc } = require("../services_pdf_render");
const { defaultTheme } = require("../services_theme_defaults");
const { composeInvoiceEmail } = require("../services/emailTemplates");
const { buildNachtragPdfViewModel } = require("../services/nachtraege");

const T = 7, F = 99;

function welt(extra = {}) {
  return makeFakeSupabase({
    PROJECT_GROUP: [
      { ID: 1, TENANT_ID: T, ABBR: "2026-014", NAME: "Schule Nord" },
      { ID: 9, TENANT_ID: F, ABBR: "X", NAME: "Fremdes Vorhaben" },
    ],
    PROJECT: [
      { ID: 10, TENANT_ID: T, ABBR: "2026-014", NAME: "Schule Nord LPH 1–4", PROJECT_GROUP_ID: 1 },
      { ID: 13, TENANT_ID: T, ABBR: "2026-041", NAME: "Kita Süd", PROJECT_GROUP_ID: null },
      // Zuordnung zeigt ueber die Mandantengrenze (Fremdschluessel prueft sie nicht)
      { ID: 14, TENANT_ID: T, ABBR: "2026-042", NAME: "Verirrt", PROJECT_GROUP_ID: 9 },
    ],
    ...extra,
  });
}

/** PROJECT-Abfragen auf PROJECT_GROUP_ID scheitern wie vor Migration 0181. */
function ohneSpalte(db, message = "column PROJECT.PROJECT_GROUP_ID does not exist") {
  const orig = db.from.bind(db);
  db.from = (t) => {
    const b = orig(t);
    if (t !== "PROJECT") return b;
    const not = b.not.bind(b);
    b.not = (col, ...rest) => {
      if (col === "PROJECT_GROUP_ID") {
        const fail = {
          in: () => fail, eq: () => fail,
          then: (res) => Promise.resolve({ data: null, error: { message } }).then(res),
        };
        return fail;
      }
      return not(col, ...rest);
    };
    return b;
  };
  return db;
}

describe("bauvorhabenForProject", () => {
  test("Name des Gesamtprojekts", async () => {
    expect(await bauvorhabenForProject(welt(), { tenantId: T, projectId: 10 })).toBe("Schule Nord");
  });

  test("ohne Gesamtprojekt, ohne Projekt: leer", async () => {
    const db = welt();
    expect(await bauvorhabenForProject(db, { tenantId: T, projectId: 13 })).toBe("");
    expect(await bauvorhabenForProject(db, { tenantId: T, projectId: null })).toBe("");
  });

  test("fremdes Gesamtprojekt erscheint nie", async () => {
    expect(await bauvorhabenForProject(welt(), { tenantId: T, projectId: 14 })).toBe("");
    // fremder Mandant fragt ein eigenes Projekt ab
    expect(await bauvorhabenForProject(welt(), { tenantId: F, projectId: 10 })).toBe("");
  });

  test("Deploy-Fenster: leer statt Fehler, ohne Warnung", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await bauvorhabenForProject(ohneSpalte(welt()), { tenantId: T, projectId: 10 })).toBe("");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("anderer Lesefehler: Beleg entsteht trotzdem, aber protokolliert", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const db = ohneSpalte(welt(), "connection reset");
      expect(await bauvorhabenForProject(db, { tenantId: T, projectId: 10 })).toBe("");
      expect(warn).toHaveBeenCalledWith("[BAUVORHABEN]", "connection reset");
    } finally {
      warn.mockRestore();
    }
  });
});

// ── Vorlagen ────────────────────────────────────────────────────────────────

const env = templateEnv();
const theme = defaultTheme();
const aus = { ...theme, header: { ...theme.header, showBauvorhaben: false } };
const render = (tpl, ctx) => env.render(path.join("modern_a", tpl), ctx);

const invoiceCtx = (over = {}) => ({
  theme, themeHead: "", inv: { buyer: {}, seller: {}, totals: {}, lines: [] },
  discounts: {}, securityRetention: {}, projectName: "2026-031 – Schule Nord LPH 5–8",
  bauvorhaben: "Schule Nord", ...over,
});

describe("Vorlagen: Zeile „Bauvorhaben“", () => {
  test.each(["invoice.njk", "storno.njk"])("%s: steht über der Projektzeile", (tpl) => {
    const html = render(tpl, invoiceCtx());
    expect(html).toContain('<span class="rl">Bauvorhaben:</span><span>Schule Nord</span>');
    expect(html.indexOf("Bauvorhaben:")).toBeLessThan(html.indexOf("Projekt:"));
  });

  test.each(["invoice.njk", "storno.njk"])("%s: ohne Gesamtprojekt und abgeschaltet keine Zeile", (tpl) => {
    expect(render(tpl, invoiceCtx({ bauvorhaben: "" }))).not.toContain("Bauvorhaben");
    expect(render(tpl, invoiceCtx({ theme: aus }))).not.toContain("Bauvorhaben");
    // Vorlagen von vor dieser Einstellung kennen den Schluessel nicht: an
    const alt = { ...theme, header: { showLogo: true, logoPosition: "right" } };
    expect(render(tpl, invoiceCtx({ theme: alt }))).toContain("Bauvorhaben:");
  });

  test("Mahnung: unter dem Betreff", () => {
    const ctx = { theme, seller: {}, buyer: {}, invoiceNumber: "R-1", mahnstufeLabel: "1. Mahnung", bauvorhaben: "Schule Nord" };
    expect(render("mahnung.njk", ctx)).toMatch(/Betreff: 1\. Mahnung zu Rechnung R-1<br><span class="subject-ref">Bauvorhaben: Schule Nord<\/span>/);
    expect(render("mahnung.njk", { ...ctx, theme: aus })).not.toContain("Bauvorhaben");
    expect(render("mahnung.njk", { ...ctx, bauvorhaben: "" })).not.toContain("Bauvorhaben");
  });

  test("Nachtrag: im Kopf vor dem Projekt", () => {
    const ctx = { theme, nachtrag: { ABBR: "N-1" }, seller: {}, buyer: {}, structureRows: [], projectName: "2026-014 — Schule Nord", bauvorhaben: "Schule Nord" };
    const html = render("nachtrag.njk", ctx);
    expect(html).toContain('<td class="ml">Bauvorhaben</td><td class="mv">Schule Nord</td>');
    expect(render("nachtrag.njk", { ...ctx, theme: aus })).not.toContain("Bauvorhaben");
  });

  test("Live-Vorschau folgt dem Schalter", async () => {
    const db = makeFakeSupabase({ COMPANY: [] });
    const an = await renderPreviewDoc({ supabase: db, tenantId: T, theme });
    const ab = await renderPreviewDoc({ supabase: db, tenantId: T, theme: aus });
    expect(an.html).toContain("Bauvorhaben");
    expect(ab.html).not.toContain("Bauvorhaben");
  });
});

// ── Datenwege ───────────────────────────────────────────────────────────────

describe("Datenwege", () => {
  test("E-Mail: {{bauvorhaben}} wird aufgelöst, ohne Gesamtprojekt leer", async () => {
    const db = welt({
      INVOICE: [
        { ID: 1, TENANT_ID: T, INVOICE_NUMBER: "R-1", INVOICE_DATE: "2026-09-30", PROJECT_ID: 10, INVOICE_TYPE: "rechnung", TOTAL_AMOUNT_GROSS: 119, TOTAL_AMOUNT_NET: 100, VAT_PERCENT: 19 },
        { ID: 2, TENANT_ID: T, INVOICE_NUMBER: "R-2", INVOICE_DATE: "2026-09-30", PROJECT_ID: 13, INVOICE_TYPE: "rechnung", TOTAL_AMOUNT_GROSS: 119, TOTAL_AMOUNT_NET: 100, VAT_PERCENT: 19 },
      ],
      COMPANY: [{ ID: 3, TENANT_ID: T, COMPANY_NAME_1: "Büro" }],
    });
    const mit = await composeInvoiceEmail(db, { tenantId: T, docType: "INVOICE", docId: 1, subject: "BV {{bauvorhaben}}", body: "x" });
    expect(mit.subject).toBe("BV Schule Nord");
    const ohne = await composeInvoiceEmail(db, { tenantId: T, docType: "INVOICE", docId: 2, subject: "BV {{bauvorhaben}}", body: "x" });
    expect(ohne.subject).toBe("BV ");
  });

  test("Nachtrags-PDF trägt das Gesamtprojekt seines Projekts", async () => {
    const db = welt({
      NACHTRAG: [{ ID: 4, TENANT_ID: T, PROJECT_ID: 10, ABBR: "N-1", NAME: "Mehrleistung" }],
      NACHTRAG_STRUCTURE: [],
    });
    const vm = await buildNachtragPdfViewModel(db, { nachtragId: 4, tenantId: T });
    expect(vm.bauvorhaben).toBe("Schule Nord");
  });
});
