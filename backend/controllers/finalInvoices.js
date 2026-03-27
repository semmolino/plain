"use strict";

const svc    = require("../services/finalInvoices");
const invSvc = require("../services/invoices");
const { loadInvoiceData } = require("../services_einvoice_data");
const { generateUblXml }  = require("../services_einvoice_ubl");
const { generateCiiXml }  = require("../services_einvoice_cii");

async function getPhases(req, res, supabase) {
  try {
    const data = await svc.getPhases(supabase, { id: req.params.id, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function savePhases(req, res, supabase) {
  const b = req.body || {};
  const structureIds = Array.isArray(b.structure_ids)
    ? b.structure_ids.map(Number).filter((n) => Number.isFinite(n))
    : [];
  try {
    const totals = await svc.savePhases(supabase, {
      id: req.params.id,
      tenantId: req.tenantId,
      structureIds,
    });
    res.json({ ok: true, ...totals });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function getDeductions(req, res, supabase) {
  try {
    const data = await svc.getDeductions(supabase, { id: req.params.id, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function saveDeductions(req, res, supabase) {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  try {
    const totals = await svc.saveDeductions(supabase, {
      id: req.params.id,
      tenantId: req.tenantId,
      items,
    });
    res.json({ ok: true, ...totals });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function getFinalInvoice(req, res, supabase) {
  try {
    const data = await svc.getFinalInvoice(supabase, { id: req.params.id, tenantId: req.tenantId });
    res.json(data);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function bookFinalInvoice(req, res, supabase) {
  try {
    const result = await svc.bookFinalInvoice(supabase, { id: req.params.id, tenantId: req.tenantId });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

// ---------------------------------------------------------------------------
// Shared helper: load a Schlussrechnung row (minimal fields)
// ---------------------------------------------------------------------------
async function loadFinalInvoiceRow(supabase, id) {
  const { data, error } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, INVOICE_TYPE, DOCUMENT_XML_ASSET_ID, DOCUMENT_XML_PROFILE, INVOICE_NUMBER, COMPANY_ID")
    .eq("ID", id)
    .maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (!data)  throw Object.assign(new Error("INVOICE nicht gefunden"), { status: 404 });
  const type = String(data.INVOICE_TYPE || "");
  if (type !== "schlussrechnung" && type !== "teilschlussrechnung") {
    throw Object.assign(new Error("Kein Schluss-/Teilschlussrechnung"), { status: 400 });
  }
  return data;
}

// ---------------------------------------------------------------------------
// GET /api/final-invoices/:id/einvoice/ubl
// ---------------------------------------------------------------------------
async function getEinvoiceUbl(req, res, supabase) {
  const id       = parseInt(String(req.params.id || ""), 10);
  const download = String(req.query.download || "") === "1";
  const preview  = String(req.query.preview  || "") === "1";

  let row;
  try { row = await loadFinalInvoiceRow(supabase, id); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message }); }

  const fname = `XRechnung_${row.INVOICE_NUMBER || row.ID}.xml`;

  if (!preview && String(row.STATUS_ID) === "2" && row.DOCUMENT_XML_ASSET_ID && row.DOCUMENT_XML_PROFILE === "xrechnung-ubl") {
    return invSvc.streamXmlAsset({ supabase, res, assetId: row.DOCUMENT_XML_ASSET_ID, dispositionName: fname, download });
  }

  try {
    const data = await loadInvoiceData(supabase, id, "INVOICE", req.tenantId);
    const xml  = generateUblXml(data);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${fname}"`);
    return res.send(xml);
  } catch (err) {
    console.error("[EINVOICE_UBL_FINAL]", { id, error: err?.message, stack: err?.stack });
    return res.status(500).json({ error: `E-Rechnung (UBL) konnte nicht erzeugt werden: ${err?.message || err}` });
  }
}

// ---------------------------------------------------------------------------
// POST /api/final-invoices/:id/einvoice/ubl/snapshot
// ---------------------------------------------------------------------------
async function postEinvoiceUblSnapshot(req, res, supabase) {
  const id = parseInt(String(req.params.id || ""), 10);

  let row;
  try { row = await loadFinalInvoiceRow(supabase, id); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message }); }

  if (String(row.STATUS_ID) !== "2") {
    return res.status(400).json({ error: "Snapshot ist nur fuer gebuchte Rechnungen (STATUS_ID=2) erlaubt" });
  }
  if (row.DOCUMENT_XML_ASSET_ID) {
    return res.json({ success: true, invoice_id: row.ID, xml_asset_id: row.DOCUMENT_XML_ASSET_ID, already_existed: true });
  }

  const fname = `XRechnung_${row.INVOICE_NUMBER || row.ID}.xml`;
  try {
    const data     = await loadInvoiceData(supabase, id, "INVOICE", req.tenantId);
    const xml      = generateUblXml(data);
    const xmlAsset = await invSvc.storeGeneratedXmlAsAsset({ supabase, companyId: row.COMPANY_ID, fileName: fname, xmlString: xml, assetType: "XML_XRECHNUNG_INVOICE" });

    const { error: upErr } = await supabase.from("INVOICE").update({
      DOCUMENT_XML_ASSET_ID:    xmlAsset?.ID ?? null,
      DOCUMENT_XML_PROFILE:     "xrechnung-ubl",
      DOCUMENT_XML_RENDERED_AT: new Date().toISOString(),
    }).eq("ID", id);

    if (upErr) {
      await invSvc.bestEffortDeleteAsset({ supabase, asset: xmlAsset });
      throw new Error(upErr.message);
    }
    return res.json({ success: true, invoice_id: row.ID, xml_asset_id: xmlAsset.ID, already_existed: false });
  } catch (e) {
    console.error("[EINVOICE_UBL_SNAPSHOT_FINAL]", { id, error: e?.message, stack: e?.stack });
    return res.status(500).json({ error: `Snapshot konnte nicht erzeugt werden: ${e?.message || e}` });
  }
}

// ---------------------------------------------------------------------------
// GET /api/final-invoices/:id/einvoice/cii?profile=EN16931
// ---------------------------------------------------------------------------
async function getEinvoiceCii(req, res, supabase) {
  const id       = parseInt(String(req.params.id || ""), 10);
  const profile  = String(req.query.profile  || "EN16931").toUpperCase();
  const download = String(req.query.download || "") === "1";
  const preview  = String(req.query.preview  || "") === "1";

  let row;
  try { row = await loadFinalInvoiceRow(supabase, id); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message }); }

  const fname      = `ZUGFeRD_${row.INVOICE_NUMBER || row.ID}.xml`;
  const profileKey = `zugferd-${profile.toLowerCase()}`;

  if (!preview && String(row.STATUS_ID) === "2" && row.DOCUMENT_XML_ASSET_ID && row.DOCUMENT_XML_PROFILE === profileKey) {
    return invSvc.streamXmlAsset({ supabase, res, assetId: row.DOCUMENT_XML_ASSET_ID, dispositionName: fname, download });
  }

  try {
    const data = await loadInvoiceData(supabase, id, "INVOICE", req.tenantId);
    const xml  = generateCiiXml(data, profile);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${fname}"`);
    return res.send(xml);
  } catch (err) {
    console.error("[EINVOICE_CII_FINAL]", { id, profile, error: err?.message, stack: err?.stack });
    return res.status(500).json({ error: `E-Rechnung (CII) konnte nicht erzeugt werden: ${err?.message || err}` });
  }
}

// ---------------------------------------------------------------------------
// POST /api/final-invoices/:id/einvoice/cii/snapshot?profile=EN16931
// ---------------------------------------------------------------------------
async function postEinvoiceCiiSnapshot(req, res, supabase) {
  const id      = parseInt(String(req.params.id || ""), 10);
  const profile = String(req.query.profile || "EN16931").toUpperCase();

  let row;
  try { row = await loadFinalInvoiceRow(supabase, id); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message }); }

  if (String(row.STATUS_ID) !== "2") {
    return res.status(400).json({ error: "Snapshot ist nur fuer gebuchte Rechnungen (STATUS_ID=2) erlaubt" });
  }
  if (row.DOCUMENT_XML_ASSET_ID) {
    return res.json({ success: true, invoice_id: row.ID, xml_asset_id: row.DOCUMENT_XML_ASSET_ID, already_existed: true });
  }

  const fname = `ZUGFeRD_${row.INVOICE_NUMBER || row.ID}.xml`;
  try {
    const data     = await loadInvoiceData(supabase, id, "INVOICE", req.tenantId);
    const xml      = generateCiiXml(data, profile);
    const xmlAsset = await invSvc.storeGeneratedXmlAsAsset({ supabase, companyId: row.COMPANY_ID, fileName: fname, xmlString: xml, assetType: "XML_ZUGFERD_INVOICE" });

    const { error: upErr } = await supabase.from("INVOICE").update({
      DOCUMENT_XML_ASSET_ID:    xmlAsset?.ID ?? null,
      DOCUMENT_XML_PROFILE:     `zugferd-${profile.toLowerCase()}`,
      DOCUMENT_XML_RENDERED_AT: new Date().toISOString(),
    }).eq("ID", id);

    if (upErr) {
      await invSvc.bestEffortDeleteAsset({ supabase, asset: xmlAsset });
      throw new Error(upErr.message);
    }
    return res.json({ success: true, invoice_id: row.ID, xml_asset_id: xmlAsset.ID, already_existed: false });
  } catch (e) {
    console.error("[EINVOICE_CII_SNAPSHOT_FINAL]", { id, error: e?.message, stack: e?.stack });
    return res.status(500).json({ error: `Snapshot konnte nicht erzeugt werden: ${e?.message || e}` });
  }
}

module.exports = {
  getPhases,
  savePhases,
  getDeductions,
  saveDeductions,
  getFinalInvoice,
  bookFinalInvoice,
  getEinvoiceUbl,
  postEinvoiceUblSnapshot,
  getEinvoiceCii,
  postEinvoiceCiiSnapshot,
};
