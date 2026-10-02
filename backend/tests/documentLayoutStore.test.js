"use strict";

// Aufbau je Projekt und je Beleg (Vorlagen-Plan Stufe 3, Migration 0185):
// Ebenen, Speichern mit Rechten, Einfrieren beim Buchen, Versand der
// archivierten Fassung und die Textbloecke als Hinweise der E-Rechnung.

const path = require("path");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { layoutLevels, resolveLayout, CATEGORIES } = require("../services/documentLayout");
const store = require("../services/documentLayoutStore");
const { templateEnv, documentContext } = require("../services_pdf_render");
const { sampleViewModel } = require("../services/documentSamples");
const { sanitizeTheme } = require("../services_theme_schema");
const { referenceInvoiceData } = require("../einvoice/referenceDocument");
const { generateCiiXml } = require("../services_einvoice_cii");
const { generateUblXml } = require("../services_einvoice_ubl");
const profiles = require("../einvoice/profiles");

const T = 1;
const keysVisible = (layout) => layout.body.filter((b) => b.visible).map((b) => b.key);

describe("Ebenen: Firmenvorlage → Projekt → Beleg", () => {
  it("Teilschluss nimmt den Projekt-Aufbau der Schlussrechnung, Korrektur nie deren Zahlungshinweis", () => {
    const projectLayout = {
      invoice_schluss: { hidden: ["reference"] },
      invoice_rechnung: { hidden: ["salutation"], payment: "always" },
    };
    const teil = layoutLevels({ category: "invoice_teilschluss", bodyByCategory: {}, projectLayout });
    expect(teil.projectParents).toEqual([{ hidden: ["reference"] }]);
    expect(teil.projectOwn).toBeNull();

    const korr = layoutLevels({ category: "invoice_korrektur", bodyByCategory: {}, projectLayout });
    expect(korr.projectParents).toEqual([{ hidden: ["salutation"] }]);
    const layout = resolveLayout("invoice_korrektur", [...korr.template, ...korr.projectParents]);
    expect(keysVisible(layout)).not.toContain("payment");
    expect(keysVisible(layout)).not.toContain("salutation");
  });

  it("der Beleg gewinnt vor dem Projekt, das Projekt vor der Vorlage — auch beim Kopftext", () => {
    const vm = sampleViewModel("invoice_rechnung");
    const ctx = documentContext({
      category: "invoice_rechnung", vm,
      theme: sanitizeTheme({ bodyByCategory: { invoice_rechnung: { hidden: ["reference"] } } }),
      projectLayout: { invoice_rechnung: { hidden: ["reference", "salutation"], introText: "Kopftext des Projekts" } },
      documentLayout: { hidden: [], introText: "Kopftext dieser Rechnung", order: ["letterhead", "text:a1"], texts: { "text:a1": "Hinweis zu {{belegnummer}}" } },
      placeholders: { belegnummer: "RE-2026-0042" },
    });
    expect(keysVisible(ctx.layout)).toEqual(expect.arrayContaining(["reference", "salutation"]));
    expect(ctx.text1).toBe("Kopftext dieser Rechnung");
    const html = templateEnv().render(path.join("modern_a", CATEGORIES.invoice_rechnung.template), ctx);
    expect(html).toContain("Kopftext dieser Rechnung");
    expect(html).toContain("Hinweis zu RE-2026-0042");
    expect(html).not.toContain("Kopftext des Projekts");
  });
});

describe("Speichern", () => {
  const db = (inv = {}) => makeFakeSupabase({
    INVOICE: [{ ID: 7, TENANT_ID: T, STATUS_ID: 1, PROJECT_ID: 3, INVOICE_TYPE: "rechnung", ...inv }],
    PROJECT: [
      { ID: 3, TENANT_ID: T, DOCUMENT_LAYOUT_JSON: { invoice_schluss: { hidden: ["reference"] } } },
      { ID: 4, TENANT_ID: 2, DOCUMENT_LAYOUT_JSON: null },
    ],
  });

  it("Beleg-Ebene bereinigt, leer heißt keine", async () => {
    const sb = db();
    await store.saveLayouts({ supabase: sb, tenantId: T, table: "INVOICE", id: 7, body: { document: { hidden: ["salutation", "amounts", "erfunden"], payment: "irgendwas" } } });
    expect(sb._tables.INVOICE[0].DOCUMENT_LAYOUT_JSON).toEqual({ hidden: ["salutation"] });
    await store.saveLayouts({ supabase: sb, tenantId: T, table: "INVOICE", id: 7, body: { document: {} } });
    expect(sb._tables.INVOICE[0].DOCUMENT_LAYOUT_JSON).toBeNull();
  });

  it("Projekt-Ebene nur mit projects.edit; andere Kategorien bleiben stehen; null entfernt", async () => {
    const sb = db();
    await expect(store.saveLayouts({ supabase: sb, tenantId: T, table: "INVOICE", id: 7, body: { project: { hidden: ["salutation"] } } }))
      .rejects.toMatchObject({ status: 403 });
    await store.saveLayouts({ supabase: sb, tenantId: T, table: "INVOICE", id: 7, canEditProject: true, body: { project: { hidden: ["salutation"] }, document: null } });
    expect(sb._tables.PROJECT[0].DOCUMENT_LAYOUT_JSON).toEqual({
      invoice_schluss: { hidden: ["reference"] },
      invoice_rechnung: { hidden: ["salutation"] },
    });
    await store.saveLayouts({ supabase: sb, tenantId: T, table: "INVOICE", id: 7, canEditProject: true, body: { project: null } });
    expect(sb._tables.PROJECT[0].DOCUMENT_LAYOUT_JSON).toEqual({ invoice_schluss: { hidden: ["reference"] } });
  });

  it("gebucht: 409; fremder Beleg: 404", async () => {
    await expect(store.saveLayouts({ supabase: db({ STATUS_ID: 2 }), tenantId: T, table: "INVOICE", id: 7, body: { document: { hidden: ["salutation"] } } }))
      .rejects.toMatchObject({ status: 409 });
    await expect(store.saveLayouts({ supabase: db(), tenantId: 2, table: "INVOICE", id: 7, body: { document: null } }))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe("Einfrieren beim Buchen", () => {
  it("gebucht mit Snapshot: der Projekt-Aufbau vom Buchen, nicht der heutige", async () => {
    const sb = makeFakeSupabase({
      PROJECT: [{ ID: 3, TENANT_ID: T, DOCUMENT_LAYOUT_JSON: { invoice_rechnung: { hidden: ["salutation"] } } }],
      INVOICE: [{ ID: 7, TENANT_ID: T, STATUS_ID: 1, PROJECT_ID: 3, INVOICE_TYPE: "rechnung" }],
    });
    await store.freezeLayoutSnapshot(sb, { table: "INVOICE", id: 7, tenantId: T, projectLayout: null });
    expect(sb._tables.INVOICE[0].DOCUMENT_LAYOUT_SNAPSHOT_JSON).toEqual({ project: {} });

    const booked = { ...sb._tables.INVOICE[0], STATUS_ID: 2 };
    expect((await store.loadDocumentLayouts({ supabase: sb, tenantId: T, table: "INVOICE", doc: booked })).projectLayout).toEqual({});
    // Entwurf und Altbestand ohne Snapshot: der heutige Stand
    expect((await store.loadDocumentLayouts({ supabase: sb, tenantId: T, table: "INVOICE", doc: { ...booked, DOCUMENT_LAYOUT_SNAPSHOT_JSON: null } })).projectLayout)
      .toEqual({ invoice_rechnung: { hidden: ["salutation"] } });
  });
});

describe("Versand und Hybrid-PDF nehmen die archivierte Fassung", () => {
  it("gebucht mit PDF-Asset: kein neuer Render", async () => {
    jest.resetModules();
    const readPdfAssetBuffer = jest.fn(async () => Buffer.from("ARCHIV"));
    jest.doMock("../services/generatedAssets", () => ({ ...jest.requireActual("../services/generatedAssets"), readPdfAssetBuffer }));
    const { documentPdfBuffer } = require("../services_pdf_render");
    const sb = makeFakeSupabase({ INVOICE: [{ ID: 7, TENANT_ID: T, STATUS_ID: 2, DOCUMENT_PDF_ASSET_ID: 55 }] });
    const buf = await documentPdfBuffer({ supabase: sb, tenantId: T, docType: "INVOICE", docId: 7 });
    expect(buf.toString()).toBe("ARCHIV");
    expect(readPdfAssetBuffer).toHaveBeenCalledWith(expect.objectContaining({ assetId: 55, tenantId: T }));
    jest.dontMock("../services/generatedAssets");
  });
});

describe("E-Rechnung: eigene Textblöcke als Hinweise (BT-22)", () => {
  it("CII und UBL tragen sie nach dem Kommentar", () => {
    const data = { ...referenceInvoiceData(), comment: "Kommentar", layoutNotes: ["Es gelten unsere AGB.", "Abnahme am 12.09.2026"] };
    const cii = generateCiiXml(data, profiles.CII_DEFAULT_PROFILE);
    expect(cii).toContain("<ram:IncludedNote><ram:Content>Es gelten unsere AGB.</ram:Content></ram:IncludedNote>");
    expect(cii.indexOf("Kommentar")).toBeLessThan(cii.indexOf("Es gelten unsere AGB."));
    const ubl = generateUblXml(data);
    expect(ubl).toContain("<cbc:Note>Abnahme am 12.09.2026</cbc:Note>");
  });
});
