"use strict";

const svc = require("../services/documentTemplates");

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
    const data = await svc.patchDocumentTemplate(supabase, { id, body: req.body });
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
    const data = await svc.duplicateDocumentTemplate(supabase, { id });
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
    const data = await svc.publishDocumentTemplate(supabase, { id });
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
    const data = await svc.archiveDocumentTemplate(supabase, { id });
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
    const data = await svc.setDefaultDocumentTemplate(supabase, { id });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
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
};
