"use strict";

// Texte der Belege: Textbausteine (Migration 0184), Standardtexte mit
// Rueckfall je Kategorie und Platzhalter — auch in eigenen Textbloecken.

const path = require("path");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const texts = require("../services/documentTexts");
const { saveTextTemplate } = require("../services/mahnungenService");
const { resolvePlaceholders, PLACEHOLDERS } = require("../services/documentPlaceholders");
const { templateEnv, documentContext } = require("../services_pdf_render");
const { sampleViewModel } = require("../services/documentSamples");
const { sanitizeTheme } = require("../services_theme_schema");

const T = 1;

describe("Textbausteine", () => {
  it("legt an, prüft Pflichtfelder, Belegart und Position", async () => {
    const sb = makeFakeSupabase({ DOCUMENT_TEXT_SNIPPET: [] }, { strictSchema: true });
    const t = await texts.createText(sb, { tenantId: T, body: { label: " Gewährleistung ", text: "Die Gewährleistung beginnt mit der Abnahme.", category: "invoice_schluss", position: "closing" } });
    expect(t).toMatchObject({ label: "Gewährleistung", category: "invoice_schluss", position: "closing" });
    await expect(texts.createText(sb, { tenantId: T, body: { label: "", text: "x" } })).rejects.toMatchObject({ status: 400 });
    await expect(texts.createText(sb, { tenantId: T, body: { label: "a", text: " " } })).rejects.toMatchObject({ status: 400 });
    await expect(texts.createText(sb, { tenantId: T, body: { label: "a", text: "x", category: "fremd" } })).rejects.toMatchObject({ status: 400 });
    await expect(texts.createText(sb, { tenantId: T, body: { label: "a", text: "x", position: "oben" } })).rejects.toMatchObject({ status: 400 });
  });

  it("listet je Belegart: eigene und die für alle; fremde Mandanten nie", async () => {
    const sb = makeFakeSupabase({ DOCUMENT_TEXT_SNIPPET: [
      { ID: 1, TENANT_ID: T, CATEGORY: "invoice_schluss", POSITION: "closing", LABEL: "B", TEXT: "x", SORT_ORDER: 0 },
      { ID: 2, TENANT_ID: T, CATEGORY: null, POSITION: "free", LABEL: "A", TEXT: "y", SORT_ORDER: 0 },
      { ID: 3, TENANT_ID: T, CATEGORY: "offer_angebot", POSITION: "intro", LABEL: "C", TEXT: "z", SORT_ORDER: 0 },
      { ID: 4, TENANT_ID: 2, CATEGORY: null, POSITION: "free", LABEL: "Fremd", TEXT: "!", SORT_ORDER: 0 },
    ] });
    expect((await texts.listTexts(sb, { tenantId: T, category: "invoice_schluss" })).map((t) => t.id)).toEqual([2, 1]);
    expect((await texts.listTexts(sb, { tenantId: T })).map((t) => t.id).sort()).toEqual([1, 2, 3]);
  });

  it("ändern und löschen nur im eigenen Mandanten", async () => {
    const sb = makeFakeSupabase({ DOCUMENT_TEXT_SNIPPET: [{ ID: 5, TENANT_ID: 2, CATEGORY: null, POSITION: "free", LABEL: "Fremd", TEXT: "!", SORT_ORDER: 0 }] });
    await expect(texts.updateText(sb, { tenantId: T, id: 5, body: { label: "x" } })).rejects.toMatchObject({ status: 404 });
    await expect(texts.deleteText(sb, { tenantId: T, id: 5 })).rejects.toMatchObject({ status: 404 });
  });
});

describe("Standardtexte", () => {
  it("nur bekannte Textvorlagen-Typen", async () => {
    const sb = makeFakeSupabase({ TEXT_TEMPLATE: [] });
    await expect(saveTextTemplate(sb, { tenantId: T, documentType: "irgendwas", headerText: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(saveTextTemplate(sb, { tenantId: T, documentType: "invoice_korrektur", headerText: "x" })).resolves.toMatchObject({ ok: true });
  });
});

describe("Platzhalter", () => {
  it("bekannte ohne Wert werden leer, unbekannte bleiben stehen", () => {
    expect(resolvePlaceholders("{{betrag}} {{ gibtsnicht }} {{leistungszeitraum}}", { betrag: "1 €" })).toBe("1 € {{ gibtsnicht }} ");
  });

  it("jede Belegart kennt die Liste", () => {
    expect(PLACEHOLDERS.map((p) => p.token)).toEqual(expect.arrayContaining(["leistungszeitraum", "faellig", "betrag", "anrede", "vertrag", "ansprechpartner"]));
  });

  it("wirkt in Kopftext und eigenen Textblöcken", () => {
    const vm = sampleViewModel("invoice_rechnung");
    vm.text1 = "Für {{leistungszeitraum}} berechnen wir {{betrag}}.";
    const ctx = documentContext({
      category: "invoice_rechnung", vm,
      theme: sanitizeTheme({ bodyByCategory: { invoice_rechnung: { order: ["letterhead", "text:z1"], texts: { "text:z1": "Fällig am {{faellig}}." } } } }),
      placeholders: { leistungszeitraum: "01.09.2026–30.09.2026", betrag: "22.015,00 €", faellig: "30.10.2026" },
    });
    const html = templateEnv().render(path.join("modern_a", "invoice.njk"), ctx);
    expect(html).toContain("Für 01.09.2026–30.09.2026 berechnen wir 22.015,00 €.");
    expect(html).toContain("Fällig am 30.10.2026.");
  });
});
