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
// Gespeichert wird nur, was das Schema durchlaesst — auch Werte, die der
// Renderer spaeter ins CSS schreibt (services_theme_schema.js).
const { sanitizeTheme } = require("../services_theme_schema");

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

/**
 * Gehoert die Vorlage einer Firma des Mandanten?
 *
 * DOCUMENT_TEMPLATE haengt ueber COMPANY_ID am Mandanten, nicht ueber eine
 * eigene TENANT_ID. Die ID-basierten Operationen (patch, duplicate, publish,
 * archive, set-default) filterten frueher gar nicht: ein Nutzer konnte die
 * Vorlage eines fremden Mandanten duplizieren und damit deren THEME_JSON samt
 * Farben, Kopf-/Fusstexten und Logo-Verweis auslesen — oder die fremde
 * Standardvorlage umstellen, sodass alle kuenftigen Belege des Opfers mit
 * einem manipulierten Layout gerendert werden (Pentest 2026-08-06).
 */
async function assertTemplateInTenant(supabase, id, tenantId) {
  if (tenantId === undefined || tenantId === null || tenantId === "") {
    throw new Error("assertTemplateInTenant: tenantId ist erforderlich");
  }
  const companyIds = await resolveCompanyIds(supabase, tenantId);
  if (!companyIds.length) throw { status: 404, message: "not found" };

  const { data, error } = await supabase
    .from("DOCUMENT_TEMPLATE")
    .select("ID")
    .eq("ID", id)
    .in("COMPANY_ID", companyIds)
    .maybeSingle();
  if (error) throw { status: 500, message: error.message };
  if (!data) throw { status: 404, message: "not found" };
  return data.ID;
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

  const theme = sanitizeTheme(theme_json);
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

async function patchDocumentTemplate(supabase, { id, body, tenantId }) {
  await assertTemplateInTenant(supabase, id, tenantId);
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
  if (theme_json !== undefined) patch.THEME_JSON = sanitizeTheme(theme_json);
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

async function duplicateDocumentTemplate(supabase, { id, tenantId }) {
  await assertTemplateInTenant(supabase, id, tenantId);
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

async function publishDocumentTemplate(supabase, { id, tenantId }) {
  await assertTemplateInTenant(supabase, id, tenantId);
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

async function archiveDocumentTemplate(supabase, { id, tenantId }) {
  await assertTemplateInTenant(supabase, id, tenantId);
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

async function setDefaultDocumentTemplate(supabase, { id, tenantId }) {
  await assertTemplateInTenant(supabase, id, tenantId);
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

const BRANDING_DOC_TYPES = ["INVOICE", "ADVANCE_INVOICE", "OFFER"];

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

  // Gemeinsames Branding (brand/header/footer) aus der INVOICE-Default.
  const theme = sanitizeTheme(themeByType.INVOICE || def);

  // Anhänge je BELEG-KATEGORIE. Bevorzugt theme.blocksByCategory; sonst Migration
  // aus alten per-DOC_TYPE-blocks (INVOICE -> Rechnung+Schluss, PP -> Abschlag,
  // OFFER -> Angebot), sonst Default.
  const stored = theme.blocksByCategory && typeof theme.blocksByCategory === "object" ? theme.blocksByCategory : {};
  const fromTypeBlocks = (dt) => {
    const t = themeByType[dt];
    return (t && t.blocks && typeof t.blocks === "object") ? { ...def.blocks, ...t.blocks } : { ...def.blocks };
  };
  const pick = (cat, fallbackDt) =>
    (stored[cat] && typeof stored[cat] === "object") ? { ...def.blocks, ...stored[cat] } : fromTypeBlocks(fallbackDt);
  const blocksByCategory = {
    invoice_rechnung:  pick("invoice_rechnung",  "INVOICE"),
    invoice_schluss:   pick("invoice_schluss",   "INVOICE"),
    invoice_abschlags: pick("invoice_abschlags", "ADVANCE_INVOICE"),
    offer_angebot:     pick("offer_angebot",     "OFFER"),
  };
  // Alle uebrigen Kategorien (Teilschluss, Korrektur, Storno, Mahnung,
  // Auftragsbestaetigung, Nachtrag) nur, wenn sie eine eigene Einstellung
  // haben — sonst erben sie (documentLayout.categoryChain).
  for (const [cat, v] of Object.entries(stored)) if (!blocksByCategory[cat]) blocksByCategory[cat] = v;

  return { theme: { ...theme, blocksByCategory }, blocksByCategory, companyId };
}

async function saveBrandingTheme(supabase, { tenantId, theme_json, blocks_by_category }) {
  const companyIds = await resolveCompanyIds(supabase, tenantId);
  if (companyIds.length === 0) throw { status: 404, message: "Kein Unternehmen für diesen Mandanten gefunden." };

  const shared = theme_json && typeof theme_json === "object" ? theme_json : defaultTheme();
  // Anhaenge je Kategorie: ausdruecklich uebergeben oder im Theme selbst. Eine
  // Kategorie ohne Eintrag erbt beim Rendern (Teilschluss → Schluss …).
  const blocksByCategory = blocks_by_category && typeof blocks_by_category === "object"
    ? blocks_by_category : shared.blocksByCategory;
  // brand/header/Aufbau global; identisch in JEDER DOC_TYPE-Default-Vorlage,
  // damit der Renderer (lädt je DOC_TYPE) immer die richtige Kategorie findet.
  const theme = sanitizeTheme({ ...shared, blocksByCategory });
  const nowIso = new Date().toISOString();

  for (const companyId of companyIds) {
    for (const docType of BRANDING_DOC_TYPES) {
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
        // TENANT_ID ausdruecklich: eine Vorlage ohne Mandant sieht unter RLS
        // niemand — beim naechsten Speichern legte die Schleife sie erneut an
        // und scheiterte am Index document_template_one_default_published
        // (Migration 0187).
        const insertRow = {
          TENANT_ID: tenantId, COMPANY_ID: companyId, NAME: "Standard", DOC_TYPE: docType,
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

// ---------------------------------------------------------------------------
// Vorlagen-Varianten (Vorlagen-Plan Stufe 5, Entscheidung D3)
//
// Neben dem „Standard" (die Default-Vorlage je Belegart, gepflegt ueber
// getBrandingTheme/saveBrandingTheme) kann ein Buero benannte Varianten
// fuehren — z. B. „Oeffentliche Auftraggeber". Eine Variante ist EINE Zeile
// mit DOC_TYPE 'VARIANT' und einem vollstaendigen Theme; der Lebenszyklus
// darunter (Entwurf/Veroeffentlicht/Version) bleibt verborgen. 'VARIANT'
// statt einer Belegart, damit loadTemplate() sie nie als Standard einer
// Belegart findet. Gewaehlt wird je Beleg (INVOICE/ADVANCE_INVOICE.
// DOCUMENT_TEMPLATE_ID); beim Buchen friert der Theme-Snapshot sie ein.
// Entfernen archiviert nur: Entwuerfe, die sie noch tragen, rendern weiter.
// ---------------------------------------------------------------------------

const VARIANT = "VARIANT";

function cleanVariantName(raw) {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw { status: 400, message: "Bitte einen Namen angeben." };
  if (name.length > 80) throw { status: 400, message: "Der Name ist zu lang (höchstens 80 Zeichen)." };
  if (/^standard$/i.test(name)) throw { status: 400, message: "„Standard“ ist die Vorlage ohne Variante." };
  return name;
}

async function listVariants(supabase, { tenantId }) {
  const companyIds = await resolveCompanyIds(supabase, tenantId);
  if (!companyIds.length) return [];
  const { data, error } = await supabase
    .from("DOCUMENT_TEMPLATE")
    .select("ID, NAME, UPDATED_AT, IS_ACTIVE")
    .in("COMPANY_ID", companyIds)
    .eq("DOC_TYPE", VARIANT)
    .eq("IS_ACTIVE", true)
    .order("NAME", { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.ID, name: r.NAME, updatedAt: r.UPDATED_AT }));
}

async function loadVariantRow(supabase, { tenantId, id }) {
  await assertTemplateInTenant(supabase, id, tenantId);
  const { data, error } = await supabase.from("DOCUMENT_TEMPLATE").select("*").eq("ID", id).maybeSingle();
  if (error) throw error;
  if (!data || data.DOC_TYPE !== VARIANT) throw { status: 404, message: "Vorlage nicht gefunden." };
  return data;
}

async function getVariant(supabase, { tenantId, id }) {
  const row = await loadVariantRow(supabase, { tenantId, id });
  return { id: row.ID, name: row.NAME, active: row.IS_ACTIVE !== false, theme: sanitizeTheme(row.THEME_JSON) };
}

async function assertVariantNameFree(supabase, tenantId, name, exceptId = null) {
  const taken = (await listVariants(supabase, { tenantId }))
    .some((v) => v.name.toLowerCase() === name.toLowerCase() && v.id !== exceptId);
  if (taken) throw { status: 409, message: `Eine Vorlage „${name}“ gibt es schon.` };
}

/** Neue Variante als Kopie des Standards (oder einer anderen Variante). */
async function createVariant(supabase, { tenantId, name, copyFrom = null }) {
  const clean = cleanVariantName(name);
  await assertVariantNameFree(supabase, tenantId, clean);
  const companyId = await resolveCompanyId(supabase, tenantId);
  if (!companyId) throw { status: 404, message: "Kein Unternehmen für diesen Mandanten gefunden." };
  const theme = copyFrom
    ? (await getVariant(supabase, { tenantId, id: copyFrom })).theme
    : (await getBrandingTheme(supabase, { tenantId })).theme;
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from("DOCUMENT_TEMPLATE").insert([{
    COMPANY_ID: companyId, NAME: clean, DOC_TYPE: VARIANT,
    STATUS: "PUBLISHED", VERSION: 1, FAMILY_ID: null,
    LAYOUT_KEY: "modern_a", THEME_JSON: sanitizeTheme(theme), LOGO_ASSET_ID: null,
    IS_DEFAULT: false, IS_ACTIVE: true, PUBLISHED_AT: nowIso, UPDATED_AT: nowIso,
  }]).select("ID, NAME").maybeSingle();
  if (error) throw error;
  return { id: data.ID, name: data.NAME };
}

async function saveVariant(supabase, { tenantId, id, name, theme_json }) {
  const row = await loadVariantRow(supabase, { tenantId, id });
  if (row.IS_ACTIVE === false) throw { status: 409, message: "Die Vorlage ist entfernt." };
  const patch = { UPDATED_AT: new Date().toISOString() };
  if (name !== undefined) {
    patch.NAME = cleanVariantName(name);
    await assertVariantNameFree(supabase, tenantId, patch.NAME, row.ID);
  }
  if (theme_json !== undefined) patch.THEME_JSON = sanitizeTheme(theme_json);
  const { error } = await supabase.from("DOCUMENT_TEMPLATE").update(patch).eq("ID", row.ID);
  if (error) throw error;
  return { ok: true };
}

async function archiveVariant(supabase, { tenantId, id }) {
  const row = await loadVariantRow(supabase, { tenantId, id });
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("DOCUMENT_TEMPLATE")
    .update({ IS_ACTIVE: false, STATUS: "ARCHIVED", ARCHIVED_AT: nowIso, UPDATED_AT: nowIso })
    .eq("ID", row.ID);
  if (error) throw error;
  return { ok: true };
}

/** Fuer die Auswahl je Beleg: nur eine (aktive) Variante des eigenen Mandanten. */
async function assertUsableVariant(supabase, { tenantId, id }) {
  const row = await loadVariantRow(supabase, { tenantId, id });
  if (row.IS_ACTIVE === false) throw { status: 409, message: "Diese Vorlage ist entfernt." };
  return row.ID;
}

module.exports = {
  VARIANT, listVariants, getVariant, createVariant, saveVariant, archiveVariant, assertUsableVariant,
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
