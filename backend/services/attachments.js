"use strict";

/**
 * services/attachments.js — INVOICE_ATTACHMENT CRUD
 *
 * Anlagen zu Rechnungen / Abschlagsrechnungen werden als BG-24
 * AdditionalDocumentReference in die XRechnung / ZUGFeRD XML
 * eingebettet (base64). Die Dateien selbst liegen als ASSET in der
 * bestehenden Asset-Infrastruktur (backend/uploads/...).
 */

const path = require("path");
const fs = require("fs");

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/xml",
  "text/xml",
]);

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;  // 10 MB pro Anlage
const MAX_TOTAL_BYTES      = 50 * 1024 * 1024;  // 50 MB Gesamtsumme

function ensureDocKey(docType) {
  if (docType !== "INVOICE" && docType !== "PARTIAL_PAYMENT") {
    throw { status: 400, message: `Ungueltiger docType: ${docType}` };
  }
  return docType === "INVOICE" ? "INVOICE_ID" : "PP_ID";
}

async function listAttachments(supabase, { docType, docId, tenantId }) {
  const key = ensureDocKey(docType);
  const { data, error } = await supabase
    .from("INVOICE_ATTACHMENT")
    .select(`
      ID, TENANT_ID, INVOICE_ID, PP_ID, ASSET_ID,
      DESCRIPTION, ATTACHMENT_TYPE_CODE, DOCUMENT_REFERENCE,
      POSITION, CREATED_AT,
      ASSET:ASSET_ID ( ID, FILE_NAME, MIME_TYPE, FILE_SIZE )
    `)
    .eq(key, docId)
    .eq("TENANT_ID", tenantId)
    .order("POSITION", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function addAttachment(supabase, { docType, docId, tenantId, assetId, description, attachmentTypeCode, documentReference }) {
  const key = ensureDocKey(docType);

  // Validate asset belongs to tenant + check MIME and size
  const { data: asset, error: aErr } = await supabase
    .from("ASSET")
    .select("ID, COMPANY_ID, MIME_TYPE, FILE_SIZE, FILE_NAME")
    .eq("ID", assetId)
    .maybeSingle();
  if (aErr) throw new Error(aErr.message);
  if (!asset) throw { status: 404, message: "Asset nicht gefunden" };
  if (!ALLOWED_MIME.has(String(asset.MIME_TYPE || "").toLowerCase())) {
    throw { status: 400, message: `MIME-Typ nicht erlaubt fuer E-Rechnungs-Anlage: ${asset.MIME_TYPE}` };
  }
  if (Number(asset.FILE_SIZE || 0) > MAX_ATTACHMENT_BYTES) {
    throw { status: 400, message: `Anlage zu gross (max. ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB).` };
  }

  // Check cumulative size
  const existing = await listAttachments(supabase, { docType, docId, tenantId });
  const existingTotal = existing.reduce((s, a) => s + Number(a.ASSET?.FILE_SIZE || 0), 0);
  if (existingTotal + Number(asset.FILE_SIZE || 0) > MAX_TOTAL_BYTES) {
    throw { status: 400, message: `Gesamtgroesse aller Anlagen wuerde ${MAX_TOTAL_BYTES / 1024 / 1024} MB ueberschreiten.` };
  }

  const nextPos = existing.length > 0
    ? Math.max(...existing.map(a => Number(a.POSITION || 0))) + 1
    : 0;

  const insertRow = {
    TENANT_ID: tenantId,
    [key]: parseInt(docId, 10),
    ASSET_ID: parseInt(assetId, 10),
    DESCRIPTION: description?.trim() || asset.FILE_NAME || null,
    ATTACHMENT_TYPE_CODE: attachmentTypeCode || "916",
    DOCUMENT_REFERENCE: documentReference?.trim() || null,
    POSITION: nextPos,
  };

  const { data, error } = await supabase
    .from("INVOICE_ATTACHMENT")
    .insert([insertRow])
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function patchAttachment(supabase, { id, tenantId, body }) {
  const allowed = ["DESCRIPTION", "ATTACHMENT_TYPE_CODE", "DOCUMENT_REFERENCE", "POSITION"];
  const update = {};
  for (const k of allowed) {
    const lower = k.toLowerCase();
    if (body[lower] !== undefined) update[k] = body[lower];
  }
  if (Object.keys(update).length === 0) return null;

  const { data, error } = await supabase
    .from("INVOICE_ATTACHMENT")
    .update(update)
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteAttachment(supabase, { id, tenantId }) {
  const { error } = await supabase
    .from("INVOICE_ATTACHMENT")
    .delete()
    .eq("ID", id)
    .eq("TENANT_ID", tenantId);
  if (error) throw new Error(error.message);
}

/**
 * Laedt Anlagen inkl. base64 Inhalt — wird von services_einvoice_data
 * aufgerufen um die XML-Embedding zu fuettern.
 *
 * Returns: [{ id, description, attachmentTypeCode, documentReference,
 *   fileName, mimeType, fileSize, base64 }]
 */
async function loadAttachmentsForXml(supabase, { docType, docId, tenantId }) {
  const items = await listAttachments(supabase, { docType, docId, tenantId });
  const uploadRoot = path.join(__dirname, "..", "uploads");

  const out = [];
  for (const a of items) {
    if (!a.ASSET) continue;
    const { data: full, error } = await supabase
      .from("ASSET")
      .select("STORAGE_KEY, MIME_TYPE, FILE_NAME, FILE_SIZE")
      .eq("ID", a.ASSET_ID)
      .maybeSingle();
    if (error || !full?.STORAGE_KEY) continue;

    const filePath = path.join(uploadRoot, full.STORAGE_KEY);
    if (!fs.existsSync(filePath)) continue;

    const buf = fs.readFileSync(filePath);
    out.push({
      id: a.ID,
      description: a.DESCRIPTION || full.FILE_NAME,
      attachmentTypeCode: a.ATTACHMENT_TYPE_CODE || "916",
      documentReference: a.DOCUMENT_REFERENCE || `ATT-${a.ID}`,
      fileName: full.FILE_NAME,
      mimeType: full.MIME_TYPE,
      fileSize: full.FILE_SIZE,
      base64: buf.toString("base64"),
    });
  }
  return out;
}

module.exports = {
  listAttachments,
  addAttachment,
  patchAttachment,
  deleteAttachment,
  loadAttachmentsForXml,
  ALLOWED_MIME,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_BYTES,
};
