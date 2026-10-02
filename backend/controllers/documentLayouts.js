"use strict";

// Aufbau je Beleg und je Projekt (Vorlagen-Plan Stufe 3) — fuer Rechnungen
// (INVOICE: Einzel-, Schluss-, Teilschlussrechnung, Korrektur) und Abschlaege
// (ADVANCE_INVOICE). Eingehaengt in routes/invoices.js und
// routes/partialPayments.js:
//   GET  /:id/layout         Ebenen und Standardtexte (invoices.view)
//   PUT  /:id/layout         { document?, project? } (Entwurfsrecht; project
//                            zusaetzlich projects.edit)
//   POST /:id/pdf/preview    HTML mit ungespeicherten Abweichungen
//                            (invoices.download_pdf; „/pdf/" zaehlt im
//                            Limiter als teuer)

const { layoutLevels } = require("../services/documentLayout");
const store = require("../services/documentLayoutStore");
const { loadTemplate, injectStandardTexts, buildDocumentHtml } = require("../services_pdf_render");
const { sanitizeTheme } = require("../services_theme_schema");

const canEditProject = (req) => !!(req._permissionsUnrestricted || (req.permissions && req.permissions.has("projects.edit")));
const fail = (res, e) => res.status(e?.status || 500).json({ error: e?.message || String(e) });

function parseId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw { status: 400, message: "Ungültige ID." };
  return id;
}

function documentLayoutHandlers(table) {
  async function getLayout(req, res, supabase) {
    try {
      const id = parseId(req);
      const doc = await store.loadDoc(supabase, req.tenantId, table, id);
      const { category, projectLayout, documentLayout } = await store.loadDocumentLayouts({ supabase, tenantId: req.tenantId, table, doc });
      const booked = String(doc.STATUS_ID) === "2";
      const snap = booked && doc.DOCUMENT_THEME_SNAPSHOT_JSON && typeof doc.DOCUMENT_THEME_SNAPSHOT_JSON === "object"
        ? doc.DOCUMENT_THEME_SNAPSHOT_JSON : null;
      const tpl = snap ? null : await loadTemplate({ supabase, companyId: doc.COMPANY_ID, docType: table, templateId: null });
      const theme = sanitizeTheme(snap || tpl.THEME_JSON);
      const levels = layoutLevels({ category, bodyByCategory: theme.bodyByCategory, projectLayout });
      // Was ohne eigene Texte dasteht: Text am Beleg (Altbestand) oder Standardtext
      const texts = { text1: String(doc.TEXT_1 ?? "").trim(), text2: String(doc.TEXT_2 ?? "").trim() };
      await injectStandardTexts(supabase, texts, req.tenantId, category);
      res.json({ data: {
        category, booked,
        projectId: doc.PROJECT_ID ?? null,
        canEditProject: canEditProject(req),
        template: levels.template,
        projectParents: levels.projectParents,
        project: levels.projectOwn,
        document: documentLayout,
        standardTexts: { intro: texts.text1 || null, closing: texts.text2 || null },
      } });
    } catch (e) { fail(res, e); }
  }

  async function putLayout(req, res, supabase) {
    try {
      const id = parseId(req);
      const data = await store.saveLayouts({
        supabase, tenantId: req.tenantId, table, id, body: req.body, canEditProject: canEditProject(req),
      });
      res.json({ data });
    } catch (e) { fail(res, e); }
  }

  async function previewHtml(req, res, supabase) {
    try {
      const id = parseId(req);
      const b = req.body && typeof req.body === "object" ? req.body : {};
      const layoutPreview = {};
      if (Object.prototype.hasOwnProperty.call(b, "document")) layoutPreview.document = b.document;
      if (Object.prototype.hasOwnProperty.call(b, "project")) layoutPreview.project = b.project;
      const releasePpIds = Array.isArray(b.release_pp_ids)
        ? b.release_pp_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
      const { html } = await buildDocumentHtml({
        supabase, tenantId: req.tenantId, docType: table, docId: id, layoutPreview, previewReleasePpIds: releasePpIds,
      });
      res.json({ html });
    } catch (e) { fail(res, e); }
  }

  return { getLayout, putLayout, previewHtml };
}

module.exports = { documentLayoutHandlers };
