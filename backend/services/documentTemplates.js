"use strict";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTableMissingErr(err, tableName) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("relation") && msg.includes(String(tableName).toLowerCase()) && msg.includes("does not exist");
}

// Kanonische Theme-Defaults (v2) — gemeinsam mit dem Render-Service, damit die
// beim Anlegen einer Vorlage gespeicherte Form exakt der entspricht, die der
// Renderer erwartet (frueher liefen hier zwei abweichende defaultTheme()).
const { defaultTheme } = require("../services_theme_defaults");

async function resolveCompanyId(supabase, tenantId) {
  const { data, error } = await supabase
    .from("COMPANY")
    .select("ID")
    .eq("TENANT_ID", tenantId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.ID ?? null;
}

// ALLE Firmen des Mandanten — Branding wird fuer jede gespeichert, damit Belege
// jeder Firma (PROJECT.COMPANY_ID) ihre Default-Vorlage finden. Sonst greift das
// Branding bei Mehr-Firmen-Mandanten nicht (Render nutzt die Projekt-Firma,
// gespeichert wurde aber nur unter der ersten Firma).
async function resolveCompanyIds(supabase, tenantId) {
  const { data, error } = await supabase
    .from("COMPANY")
    .select("ID")
    .eq("TENANT_ID", tenantId);
  if (error) throw new Error(error.message);
  return (data || []).map(r => r.ID).filter(id => id != null);
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

async function listDocumentTemplates(supabase, { tenantId, docType }) {
  const companyId = await resolveCompanyId(supabase, tenantId);
  if (!companyId) throw { status: 404, message: "Kein Unternehmen für diesen Mandanten gefunden." };

  const { data, error } = await supabase
    .from("DOCUMENT_TEMPLATE")
    .select("*")
    .eq("COMPANY_ID", companyId)
    .eq("DOC_TYPE", docType)
    .order("IS_DEFAULT", { ascending: false })
    .order("NAME", { ascending: true });

  if (error) {
    if (isTableMissingErr(error, "document_template")) {
      throw { status: 501, message: "Missing table DOCUMENT_TEMPLATE. Please run backend/sql/stageA_document_templates.sql" };
    }
    throw error;
  }

  return data || [];
}

async function createDocumentTemplate(supabase, { tenantId, name, doc_type, layout_key, theme_json, logo_asset_id }) {
  const companyId = await resolveCompanyId(supabase, tenantId);
  if (!companyId) throw { status: 404, message: "Kein Unternehmen für diesen Mandanten gefunden." };

  const theme = theme_json && typeof theme_json === "object" ? theme_json : defaultTheme();
  const logoId = logo_asset_id ? parseInt(String(logo_asset_id), 10) : null;

  const insertRow = {
    COMPANY_ID: companyId,
    NAME: name || `${doc_type} Vorlage`,
    DOC_TYPE: doc_type,
    STATUS: "DRAFT",
    VERSION: 1,
    FAMILY_ID: null,
    LAYOUT_KEY: layout_key || "modern_a",
    THEME_JSON: theme,
    LOGO_ASSET_ID: logoId || null,
    IS_DEFAULT: false,
    IS_ACTIVE: true,
    PUBLISHED_AT: null,
    ARCHIVED_AT: null,
    UPDATED_AT: new Date().toISOString(),
  };

  const { data: created, error } = await supabase.from("DOCUMENT_TEMPLATE").insert([insertRow]).select("*").maybeSingle();
  if (error) {
    if (isTableMissingErr(error, "document_template")) {
      throw { status: 501, message: "Missing table DOCUMENT_TEMPLATE. Please run backend/sql/stageA_document_templates.sql" };
    }
    throw error;
  }

  let result = created;
  if (result && (result.FAMILY_ID === null || result.FAMILY_ID === undefined)) {
    const { data: updated, error: famErr } = await supabase
      .from("DOCUMENT_TEMPLATE")
      .update({ FAMILY_ID: result.ID, UPDATED_AT: new Date().toISOString() })
      .eq("ID", result.ID)
      .select("*")
      .maybeSingle();
    if (!famErr && updated) result = updated;
  }

  return result;
}

async function patchDocumentTemplate(supabase, { id, body }) {
  const { data: existing, error: exErr } = await supabase
    .from("DOCUMENT_TEMPLATE")
    .select("ID, STATUS")
    .eq("ID", id)
    .maybeSingle();
  if (exErr) throw exErr;
  if (!existing) throw { status: 404, message: "not found" };

  const st = String(existing.STATUS || "").toUpperCase();
  if (st && st !== "DRAFT") {
    throw { status: 409, message: "Only DRAFT templates can be edited. Duplicate the template to create a new draft." };
  }

  const patch = {};
  const { name, layout_key, theme_json, logo_asset_id, is_active } = body || {};

  if (name !== undefined) patch.NAME = String(name || "").trim() || null;
  if (layout_key !== undefined) patch.LAYOUT_KEY = String(layout_key || "").trim() || null;
  if (theme_json !== undefined) patch.THEME_JSON = theme_json && typeof theme_json === "object" ? theme_json : {};
  if (logo_asset_id !== undefined) {
    const v = logo_asset_id === null || logo_asset_id === "" ? null : parseInt(String(logo_asset_id), 10);
    patch.LOGO_ASSET_ID = Number.isFinite(v) ? v : null;
  }
  if (is_active !== undefined) patch.IS_ACTIVE = !!is_active;
  patch.UPDATED_AT = new Date().toISOString();

  const { data, error } = await supabase.from("DOCUMENT_TEMPLATE").update(patch).eq("ID", id).select("*").maybeSingle();
  if (error) {
    if (isTableMissingErr(error, "document_template")) {
      throw { status: 501, message: "Missing table DOCUMENT_TEMPLATE. Please run backend/sql/stageA_document_templates.sql" };
    }
    throw error;
  }
  return data;
}

async function duplicateDocumentTemplate(supabase, { id }) {
  const { data: src, error: srcErr } = await supabase.from("DOCUMENT_TEMPLATE").select("*").eq("ID", id).maybeSingle();
  if (srcErr) throw srcErr;
  if (!src) throw { status: 404, message: "not found" };

  const familyId = src.FAMILY_ID || src.ID;

  const { data: maxRow, error: maxErr } = await supabase
    .from("DOCUMENT_TEMPLATE")
    .select("VERSION")
    .eq("FAMILY_ID", familyId)
    .order("VERSION", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxErr) throw maxErr;

  const nextVersion = (parseInt(String(maxRow?.VERSION || 0), 10) || 0) + 1;
  const nowIso = new Date().toISOString();

  const copy = {
    COMPANY_ID: src.COMPANY_ID,
    NAME: `${String(src.NAME || "").trim()} (Entwurf)`,
    DOC_TYPE: src.DOC_TYPE,
    STATUS: "DRAFT",
    VERSION: nextVersion,
    FAMILY_ID: familyId,
    LAYOUT_KEY: src.LAYOUT_KEY,
    THEME_JSON: src.THEME_JSON,
    LOGO_ASSET_ID: src.LOGO_ASSET_ID || null,
    IS_DEFAULT: false,
    IS_ACTIVE: true,
    PUBLISHED_AT: null,
    ARCHIVED_AT: null,
    UPDATED_AT: nowIso,
  };

  const { data, error } = await supabase.from("DOCUMENT_TEMPLATE").insert([copy]).select("*").maybeSingle();
  if (error) throw error;
  return data;
}

async function publishDocumentTemplate(supabase, { id }) {
  const { data: tpl, error: tplErr } = await supabase.from("DOCUMENT_TEMPLATE").select("ID, STATUS").eq("ID", id).maybeSingle();
  if (tplErr) throw tplErr;
  if (!tpl) throw { status: 404, message: "not found" };

  const st = String(tpl.STATUS || "").toUpperCase();
  if (st !== "DRAFT") throw { status: 409, message: "Only DRAFT templates can be published." };

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("DOCUMENT_TEMPLATE")
    .update({ STATUS: "PUBLISHED", PUBLISHED_AT: nowIso, ARCHIVED_AT: null, UPDATED_AT: nowIso, IS_ACTIVE: true })
    .eq("ID", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function archiveDocumentTemplate(supabase, { id }) {
  const { data: tpl, error: tplErr } = await supabase.from("DOCUMENT_TEMPLATE").select("ID, STATUS").eq("ID", id).maybeSingle();
  if (tplErr) throw tplErr;
  if (!tpl) throw { status: 404, message: "not found" };

  const st = String(tpl.STATUS || "").toUpperCase();
  if (st === "ARCHIVED") throw { status: 409, message: "Template is already archived." };

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("DOCUMENT_TEMPLATE")
    .update({ STATUS: "ARCHIVED", ARCHIVED_AT: nowIso, IS_DEFAULT: false, IS_ACTIVE: false, UPDATED_AT: nowIso })
    .eq("ID", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function setDefaultDocumentTemplate(supabase, { id }) {
  const { data: tpl, error: tplErr } = await supabase
    .from("DOCUMENT_TEMPLATE")
    .select("ID, COMPANY_ID, DOC_TYPE, STATUS, IS_ACTIVE")
    .eq("ID", id)
    .maybeSingle();
  if (tplErr) {
    if (isTableMissingErr(tplErr, "document_template")) {
      throw { status: 501, message: "Missing table DOCUMENT_TEMPLATE. Please run backend/sql/stageA_document_templates.sql" };
    }
    throw tplErr;
  }
  if (!tpl) throw { status: 404, message: "not found" };

  const st = String(tpl.STATUS || "").toUpperCase();
  if (st !== "PUBLISHED" || tpl.IS_ACTIVE === false) {
    throw { status: 409, message: "Only active PUBLISHED templates can be set as default." };
  }

  const { error: clearErr } = await supabase
    .from("DOCUMENT_TEMPLATE")
    .update({ IS_DEFAULT: false })
    .eq("COMPANY_ID", tpl.COMPANY_ID)
    .eq("DOC_TYPE", tpl.DOC_TYPE);
  if (clearErr) throw clearErr;

  const { data, error } = await supabase.from("DOCUMENT_TEMPLATE").update({ IS_DEFAULT: true }).eq("ID", id).select("*").maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Branding (vereinfachter Pfad) — eine Marke fuer alle Belegtypen
// ---------------------------------------------------------------------------
// Der Branding-Tab soll fuer Nicht-Designer simpel sein: Farbe/Schrift/Logo-
// Position waehlen -> speichern -> sofort live. Der schwergewichtige Lifecycle
// (DRAFT/PUBLISHED/ARCHIVED + Versionierung) bleibt fuer eine spaetere
// Vorlagen-Verwaltung erhalten; hier upserten wir das Default-Theme direkt.

const BRANDING_DOC_TYPES = ["INVOICE", "PARTIAL_PAYMENT", "OFFER"];

async function getBrandingTheme(supabase, { tenantId }) {
  const companyId = await resolveCompanyId(supabase, tenantId);
  if (!companyId) throw { status: 404, message: "Kein Unternehmen für diesen Mandanten gefunden." };

  const def = defaultTheme();
  const themeByType = {};
  for (const docType of BRANDING_DOC_TYPES) {
    const { data, error } = await supabase
      .from("DOCUMENT_TEMPLATE")
      .select("THEME_JSON")
      .eq("COMPANY_ID", companyId)
      .eq("DOC_TYPE", docType)
      .eq("IS_DEFAULT", true)
      .maybeSingle();
    if (error && !isTableMissingErr(error, "document_template")) throw error;
    themeByType[docType] = data && data.THEME_JSON && typeof data.THEME_JSON === "object" ? data.THEME_JSON : null;
  }

  // Gemeinsames Branding (brand/header/footer) aus der INVOICE-Default; Anhänge
  // (blocks) je Belegtyp separat.
  const theme = themeByType.INVOICE || def;
  const blocksByType = {};
  for (const docType of BRANDING_DOC_TYPES) {
    const t = themeByType[docType];
    blocksByType[docType] = (t && t.blocks && typeof t.blocks === "object")
      ? { ...def.blocks, ...t.blocks }
      : { ...def.blocks };
  }

  return { theme, blocksByType, companyId };
}

async function saveBrandingTheme(supabase, { tenantId, theme_json, blocks_by_type }) {
  const companyIds = await resolveCompanyIds(supabase, tenantId);
  if (companyIds.length === 0) throw { status: 404, message: "Kein Unternehmen für diesen Mandanten gefunden." };

  const shared = theme_json && typeof theme_json === "object" ? theme_json : defaultTheme();
  const def = defaultTheme();
  const bbt = blocks_by_type && typeof blocks_by_type === "object" ? blocks_by_type : {};
  const nowIso = new Date().toISOString();

  // Pro Firma × Belegtyp die Default-Vorlage upserten. brand/header/footer sind
  // unternehmensweit gleich; blocks (Anhänge) je Belegtyp separat.
  for (const companyId of companyIds) {
    for (const docType of BRANDING_DOC_TYPES) {
      const blocks = bbt[docType] && typeof bbt[docType] === "object"
        ? { ...def.blocks, ...bbt[docType] }
        : { ...def.blocks };
      const theme = { ...shared, blocks };
      const { data: existing, error: exErr } = await supabase
        .from("DOCUMENT_TEMPLATE")
        .select("ID")
        .eq("COMPANY_ID", companyId)
        .eq("DOC_TYPE", docType)
        .eq("IS_DEFAULT", true)
        .maybeSingle();
      if (exErr) {
        if (isTableMissingErr(exErr, "document_template")) {
          throw { status: 501, message: "Missing table DOCUMENT_TEMPLATE. Please run backend/migrations/0002_document_templates.sql" };
        }
        throw exErr;
      }

      if (existing) {
        const { error } = await supabase
          .from("DOCUMENT_TEMPLATE")
          .update({ THEME_JSON: theme, IS_ACTIVE: true, UPDATED_AT: nowIso })
          .eq("ID", existing.ID);
        if (error) throw error;
      } else {
        const insertRow = {
          COMPANY_ID: companyId, NAME: "Standard", DOC_TYPE: docType,
          STATUS: "PUBLISHED", VERSION: 1, FAMILY_ID: null,
          LAYOUT_KEY: "modern_a", THEME_JSON: theme, LOGO_ASSET_ID: null,
          IS_DEFAULT: true, IS_ACTIVE: true, PUBLISHED_AT: nowIso, UPDATED_AT: nowIso,
        };
        const { data: created, error } = await supabase
          .from("DOCUMENT_TEMPLATE").insert([insertRow]).select("ID").maybeSingle();
        if (error) throw error;
        if (created && created.ID) {
          await supabase.from("DOCUMENT_TEMPLATE").update({ FAMILY_ID: created.ID }).eq("ID", created.ID);
        }
      }
    }
  }

  return { ok: true };
}

module.exports = {
  listDocumentTemplates,
  createDocumentTemplate,
  patchDocumentTemplate,
  duplicateDocumentTemplate,
  publishDocumentTemplate,
  archiveDocumentTemplate,
  setDefaultDocumentTemplate,
  getBrandingTheme,
  saveBrandingTheme,
};
