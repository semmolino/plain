"use strict";

const svc = require("../services/documentTemplates");
const pdfRender = require("../services_pdf_render");

async function listDocumentTemplates(req, res, supabase) {
  const docType = String(req.query.doc_type || "").toUpperCase().trim();
  if (!docType) return res.status(400).json({ error: "doc_type is required" });
  try {
    const data = await svc.listDocumentTemplates(supabase, { tenantId: req.tenantId, docType });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function createDocumentTemplate(req, res, supabase) {
  const { name, doc_type, layout_key, theme_json, logo_asset_id } = req.body || {};
  const docType = String(doc_type || "").toUpperCase().trim();
  if (!docType) return res.status(400).json({ error: "doc_type is required" });
  const tplName = String(name || "").trim() || `${docType} Vorlage`;
  try {
    const data = await svc.createDocumentTemplate(supabase, {
      tenantId: req.tenantId,
      name: tplName,
      doc_type: docType,
      layout_key: String(layout_key || "modern_a").trim(),
      theme_json,
      logo_asset_id,
    });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function patchDocumentTemplate(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
  try {
    const data = await svc.patchDocumentTemplate(supabase, { id, body: req.body, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function duplicateDocumentTemplate(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
  try {
    const data = await svc.duplicateDocumentTemplate(supabase, { id, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function publishDocumentTemplate(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
  try {
    const data = await svc.publishDocumentTemplate(supabase, { id, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function archiveDocumentTemplate(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
  try {
    const data = await svc.archiveDocumentTemplate(supabase, { id, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function setDefaultDocumentTemplate(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
  try {
    const data = await svc.setDefaultDocumentTemplate(supabase, { id, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

// Seitenansicht in Einstellungen → Dokumentvorlagen: rendert einen Beispielbeleg
// mit der (ungespeicherten) Gestaltung als PDF.
async function previewDocumentTemplatePdf(req, res, supabase) {
  try {
    const theme = req.body?.theme_json && typeof req.body.theme_json === "object" ? req.body.theme_json : {};
    const category = String(req.body?.category || "invoice_rechnung");
    const { pdf } = await pdfRender.renderPreviewDoc({ supabase, tenantId: req.tenantId, theme, category, asPdf: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="Vorschau.pdf"');
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || String(err) });
  }
}

// ── Vorlagen-Varianten (D3) ──────────────────────────────────────────────────
const fail = (res, err) => res.status(err?.status || 500).json({ error: err?.message || String(err) });

async function listVariants(req, res, supabase) {
  try { res.json({ data: await svc.listVariants(supabase, { tenantId: req.tenantId }) }); } catch (e) { fail(res, e); }
}
async function getVariant(req, res, supabase) {
  try { res.json({ data: await svc.getVariant(supabase, { tenantId: req.tenantId, id: Number(req.params.id) }) }); } catch (e) { fail(res, e); }
}
async function createVariant(req, res, supabase) {
  try {
    const b = req.body || {};
    res.status(201).json({ data: await svc.createVariant(supabase, { tenantId: req.tenantId, name: b.name, copyFrom: b.copy_from ? Number(b.copy_from) : null }) });
  } catch (e) { fail(res, e); }
}
async function saveVariant(req, res, supabase) {
  try {
    const b = req.body || {};
    res.json({ data: await svc.saveVariant(supabase, { tenantId: req.tenantId, id: Number(req.params.id), name: b.name, theme_json: b.theme_json }) });
  } catch (e) { fail(res, e); }
}
async function archiveVariant(req, res, supabase) {
  try { res.json({ data: await svc.archiveVariant(supabase, { tenantId: req.tenantId, id: Number(req.params.id) }) }); } catch (e) { fail(res, e); }
}

// ── Katalog: Kategorien, Bausteine, Platzhalter ──────────────────────────────
// Die Einstellungen holen den Aufbau je Belegart von hier statt eine Kopie der
// Registry zu pflegen (services/documentLayout.js → documentCatalog).
const { documentCatalog } = require("../services/documentLayout");

async function getCatalog(_req, res) {
  res.json({ data: documentCatalog() });
}

// ── Branding (vereinfachter Pfad fuer den Branding-Tab) ──────────────────────
// Eine Marke fuer alle Belegtypen: liest/schreibt das Default-Theme gesammelt.
async function getBranding(req, res, supabase) {
  try {
    const data = await svc.getBrandingTheme(supabase, { tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || String(err) });
  }
}

async function saveBranding(req, res, supabase) {
  try {
    const data = await svc.saveBrandingTheme(supabase, {
      tenantId: req.tenantId,
      theme_json: req.body?.theme_json,
      blocks_by_category: req.body?.blocks_by_category,
    });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || String(err) });
  }
}

module.exports = {
  listDocumentTemplates,
  createDocumentTemplate,
  patchDocumentTemplate,
  duplicateDocumentTemplate,
  publishDocumentTemplate,
  archiveDocumentTemplate,
  setDefaultDocumentTemplate,
  getBranding,
  saveBranding,
  getCatalog,
  previewDocumentTemplatePdf,
  listVariants, getVariant, createVariant, saveVariant, archiveVariant,
};
