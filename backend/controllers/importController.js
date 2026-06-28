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

function getTemplate(req, res) {
  try {
    const { buffer, filename } = svc.buildTemplate(req.params.domain);
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
      mapping: parseMapping(req), supabase, tenantId: req.tenantId,
    });
    res.json({ data });
  } catch (e) { fail(res, e); }
}

async function postCommit(req, res, supabase) {
  try {
    if (!req.file) throw { status: 400, message: "Keine Datei hochgeladen" };
    const data = await svc.commit({
      domainKey: req.params.domain, buffer: req.file.buffer, filename: req.file.originalname,
      mapping: parseMapping(req), duplicateMode: req.body?.duplicateMode || "skip",
      structureMode: req.body?.structureMode || "single",
      supabase, tenantId: req.tenantId, employeeId: req.employeeId,
    });
    res.json({ data });
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

module.exports = { getDomains, getTemplate, postPreview, postCommit, getBatches, postRollback };
