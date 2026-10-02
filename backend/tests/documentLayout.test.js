"use strict";

// Aufbau der Belege (services/documentLayout.js) und seine Wirkung in den
// echten Vorlagen: Reihenfolge, Ausblenden, eigene Textbloecke,
// Seitenumbrueche, Zahlungshinweis — mit den Leitplanken.

const path = require("path");
const { resolveLayout, sanitizeLayoutOverride, invoiceCategory, categoryChain, describeCategory, CATEGORIES } =
  require("../services/documentLayout");
const { templateEnv, documentContext, renderPreviewDoc } = require("../services_pdf_render");
const { sampleViewModel } = require("../services/documentSamples");
const { sanitizeTheme } = require("../services_theme_schema");

const keys = (layout) => layout.body.filter((b) => b.visible).map((b) => b.key);

describe("resolveLayout", () => {
  it("ohne Abweichung: die Standardreihenfolge der Kategorie", () => {
    expect(keys(resolveLayout("invoice_rechnung"))).toEqual(CATEGORIES.invoice_rechnung.body);
  });

  it("Reihenfolge einer Ebene; Nicht-Genanntes hängt hinten an, Briefkopf bleibt vorn", () => {
    const l = resolveLayout("invoice_rechnung", [{ order: ["amounts", "letterhead", "intro"] }]);
    expect(keys(l).slice(0, 4)).toEqual(["letterhead", "amounts", "intro", "reference"]);
    expect(keys(l)).toHaveLength(CATEGORIES.invoice_rechnung.body.length);
  });

  it("Pflichtbausteine lassen sich nicht ausblenden, andere schon", () => {
    const l = resolveLayout("invoice_rechnung", [{ hidden: ["amounts", "title", "letterhead", "salutation"] }]);
    expect(keys(l)).toContain("amounts");
    expect(keys(l)).toContain("title");
    expect(keys(l)).not.toContain("salutation");
  });

  it("spätere Ebene ersetzt hidden der früheren (Beleg zeigt, was die Vorlage ausblendet)", () => {
    const l = resolveLayout("invoice_rechnung", [{ hidden: ["salutation"] }, { hidden: [] }]);
    expect(keys(l)).toContain("salutation");
  });

  it("eigene Textblöcke an beliebiger Stelle, nur mit gültigem Schlüssel", () => {
    const l = resolveLayout("invoice_rechnung", [{
      order: ["letterhead", "title", "text:abc1", "amounts", "text:../evil"],
      texts: { "text:abc1": "Gilt nur für dieses Projekt.", "text:../evil": "x" },
    }]);
    const t = l.body.find((b) => b.key === "text:abc1");
    expect(t).toMatchObject({ kind: "text", text: "Gilt nur für dieses Projekt.", visible: true });
    expect(l.body.map((b) => b.key)).not.toContain("text:../evil");
    expect(l.body.findIndex((b) => b.key === "text:abc1")).toBe(2);
  });

  it("unbekannte Bausteine einer Kategorie fallen weg", () => {
    const l = resolveLayout("mahnung", [{ order: ["positions", "comment", "closing"] }]);
    expect(l.body.map((b) => b.key)).not.toContain("positions");
    expect(l.body.map((b) => b.key)).not.toContain("comment");
  });

  it("Zahlungshinweis: auto = nur ohne Fußtext, always/never wie angegeben", () => {
    const pay = (o, ctx) => resolveLayout("invoice_rechnung", o, ctx).body.find((b) => b.key === "payment");
    expect(pay([], { hasClosingText: false }).visible).toBe(true);
    expect(pay([], { hasClosingText: true }).visible).toBe(false);
    expect(pay([{ payment: "always" }], { hasClosingText: true }).visible).toBe(true);
    expect(pay([{ payment: "never" }], { hasClosingText: false }).visible).toBe(false);
  });

  it("Seitenumbruch vor einem Baustein, nie vor dem Briefkopf", () => {
    const l = resolveLayout("invoice_rechnung", [{ pageBreaks: ["amounts", "letterhead"] }]);
    expect(l.body.find((b) => b.key === "amounts").pageBreakBefore).toBe(true);
    expect(l.body.find((b) => b.key === "letterhead").pageBreakBefore).toBe(false);
  });

  it("Texte werden begrenzt", () => {
    const o = sanitizeLayoutOverride({ texts: { "text:a": "x".repeat(10000) } }, "invoice_rechnung");
    expect(o.texts["text:a"].length).toBe(4000);
  });
});

describe("Kategorien", () => {
  it("Rechnungsarten werden richtig zugeordnet", () => {
    expect(invoiceCategory("rechnung", "INVOICE")).toBe("invoice_rechnung");
    expect(invoiceCategory("partial_payment", "ADVANCE_INVOICE")).toBe("invoice_abschlags");
    expect(invoiceCategory("teilschlussrechnung", "INVOICE")).toBe("invoice_teilschluss");
    expect(invoiceCategory("gutschrift", "INVOICE")).toBe("invoice_korrektur");
    expect(invoiceCategory("stornorechnung", "INVOICE")).toBe("invoice_storno");
  });

  it("Teilschluss erbt von Schluss, Korrektur von Rechnung", () => {
    expect(categoryChain("invoice_teilschluss")).toEqual(["invoice_teilschluss", "invoice_schluss"]);
    expect(categoryChain("invoice_korrektur")).toEqual(["invoice_korrektur", "invoice_rechnung"]);
  });

  it("describeCategory nennt Sperren und Modi für die Oberfläche", () => {
    const d = describeCategory("invoice_schluss");
    expect(d.body.find((b) => b.key === "amounts")).toMatchObject({ locked: true });
    expect(d.body.find((b) => b.key === "payment").modes).toEqual(["auto", "always", "never"]);
    expect(d.appendices.map((a) => a.key)).toContain("showTec");
  });
});

describe("Wirkung in den Vorlagen", () => {
  const render = (category, theme, mutate, overrides) => {
    const vm = sampleViewModel(category);
    if (mutate) mutate(vm);
    const ctx = documentContext({ category, vm, theme: sanitizeTheme(theme), overrides });
    return templateEnv().render(path.join("modern_a", CATEGORIES[category].template), ctx);
  };

  it("Einstellung der Firma: Anrede aus, Kommentar vor den Titel, Hinweisblock nach den Beträgen", () => {
    const html = render("invoice_rechnung", { bodyByCategory: { invoice_rechnung: {
      hidden: ["salutation"], order: ["letterhead", "comment", "title", "amounts", "text:h1"],
      texts: { "text:h1": "Bitte beachten Sie <unsere> AGB." },
    } } });
    expect(html).not.toContain("Sehr geehrte Frau Ludwig");
    expect(html.indexOf("Nebenleistung Brandschutz")).toBeLessThan(html.indexOf('class="doc-title"'));
    expect(html.indexOf("Bitte beachten Sie")).toBeGreaterThan(html.indexOf("Rechnungssumme"));
    expect(html).toContain("Bitte beachten Sie &lt;unsere&gt; AGB.");
  });

  it("Teilschluss nimmt die Einstellung der Schlussrechnung, solange er keine eigene hat", () => {
    const theme = { bodyByCategory: { invoice_schluss: { hidden: ["reference"] } } };
    expect(render("invoice_teilschluss", theme)).not.toContain('class="ref-block"');
    expect(render("invoice_teilschluss", { bodyByCategory: { ...theme.bodyByCategory, invoice_teilschluss: { hidden: [] } } }))
      .toContain('class="ref-block"');
  });

  it("Zahlungshinweis „immer\" steht auch neben einem Fußtext", () => {
    const html = render("invoice_rechnung", { bodyByCategory: { invoice_rechnung: { payment: "always" } } },
      (vm) => { vm.text2 = "Eigener Fußtext"; });
    expect(html).toContain("Eigener Fußtext");
    expect(html).toContain("Bitte überweisen Sie");
  });

  it("Korrektur erbt den Aufbau der Rechnung, aber nie deren Zahlungshinweis", () => {
    const theme = { bodyByCategory: { invoice_rechnung: { hidden: ["reference"], payment: "always" } } };
    const html = render("invoice_korrektur", theme);
    expect(html).not.toContain('class="ref-block"');
    expect(html).not.toContain("Bitte überweisen Sie");
    // eine eigene Einstellung der Korrektur gilt weiterhin
    expect(render("invoice_korrektur", { bodyByCategory: { ...theme.bodyByCategory, invoice_korrektur: { payment: "always" } } }))
      .toContain("Bitte überweisen Sie");
  });

  it("Seitenumbruch vor den Beträgen", () => {
    const html = render("invoice_rechnung", { bodyByCategory: { invoice_rechnung: { pageBreaks: ["amounts"] } } });
    const brk = html.indexOf("layout-page-break");
    expect(brk).toBeGreaterThan(0);
    expect(brk).toBeLessThan(html.indexOf('class="calc-table"'));
  });

  it("Angebot: Bestellblatt abschaltbar, Reihenfolge der Anhänge folgt der Gestaltung", () => {
    const off = render("offer_angebot", { blocksByCategory: { offer_angebot: { showOrderSheet: false } } });
    expect(off).toContain("HOAI-Honorarübersicht");
    expect(off).not.toContain("Unterschrift, Firmenstempel (Auftraggeber)");
    const swapped = render("offer_angebot", { blocksByCategory: { offer_angebot: { order: ["showOrderSheet", "showHonorar"] } } });
    expect(swapped.indexOf("Unterschrift, Firmenstempel (Auftraggeber)")).toBeLessThan(swapped.indexOf("HOAI-Honorarübersicht"));
  });
});

describe("Vorschau rendert die echten Vorlagen", () => {
  const sb = { from: () => ({ select() { return this; }, eq() { return this; }, limit() { return this; }, maybeSingle: async () => ({ data: null }) }) };
  const MARK = {
    invoice_rechnung: "Rechnungssumme", invoice_abschlags: "Erbrachtes Honorar", invoice_teilschluss: "abzgl. geleistete Abschlagszahlungen",
    invoice_schluss: "abzgl. geleistete Abschlagszahlungen", invoice_korrektur: "Korrektur zu Rechnung", invoice_storno: "Stornobetrag",
    mahnung: "Gesamtbetrag jetzt fällig", offer_angebot: "Bestellblatt", offer_ab: "Auftragsbestätigung", nachtrag: "Nachtragssumme",
  };
  for (const [category, mark] of Object.entries(MARK)) {
    it(category, async () => {
      const { html } = await renderPreviewDoc({ supabase: sb, tenantId: 1, theme: {}, category });
      expect(html).toContain(mark);
      expect(html).not.toMatch(/undefined|NaN/);
    });
  }

  it("zahlbare Belege bekommen einen echten GiroCode", async () => {
    const { html } = await renderPreviewDoc({ supabase: sb, tenantId: 1, theme: {}, category: "invoice_rechnung" });
    expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="GiroCode">/);
  });
});
