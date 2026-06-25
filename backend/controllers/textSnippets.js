"use strict";

const svc = require("../services/textSnippets");

async function list(req, res, supabase) {
  try {
    const data = await svc.listSnippets(supabase, { tenantId: req.tenantId, employeeId: req.employeeId });
    res.json({ data });
  } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }); }
}

async function create(req, res, supabase) {
  try {
    const data = await svc.createSnippet(supabase, { tenantId: req.tenantId, employeeId: req.employeeId, body: req.body || {} });
    res.json({ data });
  } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }); }
}

async function update(req, res, supabase) {
  try {
    const data = await svc.updateSnippet(supabase, { tenantId: req.tenantId, employeeId: req.employeeId, id: req.params.id, body: req.body || {} });
    res.json({ data });
  } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }); }
}

async function remove(req, res, supabase) {
  try {
    await svc.deleteSnippet(supabase, { tenantId: req.tenantId, employeeId: req.employeeId, id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }); }
}

module.exports = { list, create, update, remove };
