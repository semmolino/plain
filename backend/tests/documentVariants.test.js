"use strict";

// Vorlagen-Varianten (Vorlagen-Plan Stufe 5, D3): benannte Vorlagen neben dem
// Standard, je Beleg waehlbar — nur aus dem eigenen Mandanten.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const svc = require("../services/documentTemplates");
const store = require("../services/documentLayoutStore");
const { loadTemplate } = require("../services_pdf_render");

const db = () => makeFakeSupabase({
  COMPANY: [{ ID: 10, TENANT_ID: 1 }, { ID: 20, TENANT_ID: 2 }],
  DOCUMENT_TEMPLATE: [
    { ID: 1, COMPANY_ID: 10, TENANT_ID: 1, DOC_TYPE: "INVOICE", IS_DEFAULT: true, IS_ACTIVE: true, STATUS: "PUBLISHED", NAME: "Standard",
      THEME_JSON: { brand: { accentColor: "#1e3a5f", primaryColor: "#1e3a5f", fontFamily: "inter" }, layout: { style: "klar" } } },
    { ID: 9, COMPANY_ID: 20, TENANT_ID: 2, DOC_TYPE: "VARIANT", IS_DEFAULT: false, IS_ACTIVE: true, STATUS: "PUBLISHED", NAME: "Fremd",
      THEME_JSON: { brand: { accentColor: "#ff0000" } } },
  ],
  INVOICE: [{ ID: 7, TENANT_ID: 1, STATUS_ID: 1, INVOICE_TYPE: "rechnung", COMPANY_ID: 10 }],
});

describe("Varianten verwalten", () => {
  it("neu als Kopie des Standards; Name Pflicht, eindeutig, nicht „Standard“", async () => {
    const sb = db();
    const v = await svc.createVariant(sb, { tenantId: 1, name: "  Öffentliche   Auftraggeber " });
    expect(v.name).toBe("Öffentliche Auftraggeber");
    const full = await svc.getVariant(sb, { tenantId: 1, id: v.id });
    expect(full.theme.layout.style).toBe("klar");
    expect(full.theme.brand.fontFamily).toBe("inter");
    await expect(svc.createVariant(sb, { tenantId: 1, name: "öffentliche auftraggeber" })).rejects.toMatchObject({ status: 409 });
    await expect(svc.createVariant(sb, { tenantId: 1, name: " " })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createVariant(sb, { tenantId: 1, name: "Standard" })).rejects.toMatchObject({ status: 400 });
  });

  it("Liste nur eigene und aktive; Speichern bereinigt das Theme; Entfernen archiviert", async () => {
    const sb = db();
    const v = await svc.createVariant(sb, { tenantId: 1, name: "Kurzform" });
    expect((await svc.listVariants(sb, { tenantId: 1 })).map((x) => x.name)).toEqual(["Kurzform"]);
    await svc.saveVariant(sb, { tenantId: 1, id: v.id, theme_json: { layout: { style: "barock", din: "B" } } });
    expect((await svc.getVariant(sb, { tenantId: 1, id: v.id })).theme.layout).toMatchObject({ style: "standard", din: "B" });
    await svc.archiveVariant(sb, { tenantId: 1, id: v.id });
    expect(await svc.listVariants(sb, { tenantId: 1 })).toEqual([]);
    await expect(svc.getVariant(sb, { tenantId: 1, id: 9 })).rejects.toMatchObject({ status: 404 });
  });
});

describe("Vorlage laden", () => {
  it("per ID nur aus dem eigenen Mandanten — fremd: der Standard", async () => {
    const sb = db();
    expect((await loadTemplate({ supabase: sb, companyId: 10, docType: "INVOICE", templateId: 9, tenantId: 1 })).ID).toBe(1);
  });
});

describe("Variante je Beleg", () => {
  it("eigene aktive Variante setzen, null = Standard; fremde 404, entfernte 409", async () => {
    const sb = db();
    const v = await svc.createVariant(sb, { tenantId: 1, name: "Öffentliche AG" });
    await store.saveLayouts({ supabase: sb, tenantId: 1, table: "INVOICE", id: 7, body: { templateId: v.id } });
    expect(sb._tables.INVOICE[0].DOCUMENT_TEMPLATE_ID).toBe(v.id);
    await expect(store.saveLayouts({ supabase: sb, tenantId: 1, table: "INVOICE", id: 7, body: { templateId: 9 } }))
      .rejects.toMatchObject({ status: 404 });
    await store.saveLayouts({ supabase: sb, tenantId: 1, table: "INVOICE", id: 7, body: { templateId: null } });
    expect(sb._tables.INVOICE[0].DOCUMENT_TEMPLATE_ID).toBeNull();
    await svc.archiveVariant(sb, { tenantId: 1, id: v.id });
    await expect(store.saveLayouts({ supabase: sb, tenantId: 1, table: "INVOICE", id: 7, body: { templateId: v.id } }))
      .rejects.toMatchObject({ status: 409 });
  });
});
