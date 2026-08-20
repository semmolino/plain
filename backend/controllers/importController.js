"use strict";

const svc = require("../services/importService");

function fail(res, e) {
  return res.status(e?.status || 500).json({ error: e?.message || String(e) });
}

/** mapping kommt im multipart-Body als JSON-String (oder fehlt → null = Auto). */
function parseMapping(req) {
  const m = req.body?.mapping;
  if (m == null) return null;
  if (typeof m === "string") { try { return JSON.parse(m); } catch { return null; } }
  return m;
}

function getDomains(req, res) {
  try { res.json({ data: svc.listDomains() }); } catch (e) { fail(res, e); }
}

// Die Vorlage zieht ihre Auswahllisten aus dem Mandanten (Status, Kürzel,
// Adressnamen …) — deshalb braucht sie supabase + tenantId.
async function getTemplate(req, res, supabase) {
  try {
    const { buffer, filename } = await svc.buildTemplate(req.params.domain, { supabase, tenantId: req.tenantId });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) { fail(res, e); }
}

async function postPreview(req, res, supabase) {
  try {
    if (!req.file) throw { status: 400, message: "Keine Datei hochgeladen" };
    const data = await svc.preview({
      domainKey: req.params.domain, buffer: req.file.buffer, filename: req.file.originalname,
      mapping: parseMapping(req), sheetName: req.body?.sheetName || null, supabase, tenantId: req.tenantId,
    });
    res.json({ data });
  } catch (e) { fail(res, e); }
}

async function postCommit(req, res, supabase) {
  try {
    if (!req.file) throw { status: 400, message: "Keine Datei hochgeladen" };
    const data = await svc.commit({
      domainKey: req.params.domain, buffer: req.file.buffer, filename: req.file.originalname,
      mapping: parseMapping(req), sheetName: req.body?.sheetName || null, duplicateMode: req.body?.duplicateMode || "skip",
      structureMode: req.body?.structureMode || "single",
      docType: req.body?.docType || "partial",
      supabase, tenantId: req.tenantId, employeeId: req.employeeId,
    });
    res.json({ data });
  } catch (e) { fail(res, e); }
}

// Fehlerprotokoll: gleiche Datei + Zuordnung wie in der Vorschau, zurueck kommt
// eine Excel-Datei mit genau den Zeilen, die nicht importierbar waren.
async function postErrorReport(req, res, supabase) {
  try {
    if (!req.file) throw { status: 400, message: "Keine Datei hochgeladen" };
    const { buffer, filename } = await svc.errorReport({
      domainKey: req.params.domain, buffer: req.file.buffer,
      mapping: parseMapping(req), sheetName: req.body?.sheetName || null,
      supabase, tenantId: req.tenantId,
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) { fail(res, e); }
}

async function getBatches(req, res, supabase) {
  try { res.json({ data: await svc.listBatches(supabase, req.tenantId) }); } catch (e) { fail(res, e); }
}

async function postRollback(req, res, supabase) {
  try {
    const data = await svc.rollback({ batchId: parseInt(req.params.id, 10), supabase, tenantId: req.tenantId });
    res.json({ data });
  } catch (e) { fail(res, e); }
}

module.exports = { getDomains, getTemplate, postPreview, postCommit, postErrorReport, getBatches, postRollback };
