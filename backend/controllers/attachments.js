"use strict";

const svc = require("../services/attachments");

function docTypeFromPath(req) {
  // mounted under /api/v1/invoices/:id/attachments and /api/v1/partial-payments/:id/attachments
  return req.baseUrl.includes("partial-payments") ? "PARTIAL_PAYMENT" : "INVOICE";
}

async function list(req, res, supabase) {
  try {
    const docType = docTypeFromPath(req);
    const docId = parseInt(req.params.id, 10);
    const data = await svc.listAttachments(supabase, { docType, docId, tenantId: req.tenantId });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function add(req, res, supabase) {
  try {
    const docType = docTypeFromPath(req);
    const docId = parseInt(req.params.id, 10);
    const b = req.body || {};
    const data = await svc.addAttachment(supabase, {
      docType, docId, tenantId: req.tenantId,
      assetId: b.asset_id,
      description: b.description,
      attachmentTypeCode: b.attachment_type_code,
      documentReference: b.document_reference,
    });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function patch(req, res, supabase) {
  try {
    const id = parseInt(req.params.attId, 10);
    const data = await svc.patchAttachment(supabase, { id, tenantId: req.tenantId, body: req.body || {} });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function remove(req, res, supabase) {
  try {
    const id = parseInt(req.params.attId, 10);
    await svc.deleteAttachment(supabase, { id, tenantId: req.tenantId });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

module.exports = { list, add, patch, remove };
