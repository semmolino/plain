"use strict";

const svc = require("../services/textSnippets");

const wrap = (fn) => async (req, res, supabase) => {
  try {
    const data = await fn(req, supabase);
    res.json({ data });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
};

// ── Auswahl beim Buchen (global + eigene persönliche) ────────────────────────
const list = wrap((req, supabase) =>
  svc.listSnippets(supabase, { tenantId: req.tenantId, employeeId: req.employeeId }));

// ── Persönliche Textbausteine ────────────────────────────────────────────────
const create = wrap((req, supabase) =>
  svc.createSnippet(supabase, { tenantId: req.tenantId, employeeId: req.employeeId, body: req.body || {} }));
const update = wrap((req, supabase) =>
  svc.updateSnippet(supabase, { tenantId: req.tenantId, employeeId: req.employeeId, id: req.params.id, body: req.body || {} }));

async function remove(req, res, supabase) {
  try {
    await svc.deleteSnippet(supabase, { tenantId: req.tenantId, employeeId: req.employeeId, id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }); }
}

// ── Globale Buchungstextvorlagen (gated) ─────────────────────────────────────
const listGlobal = wrap((req, supabase) =>
  svc.listGlobal(supabase, { tenantId: req.tenantId }));
const createGlobal = wrap((req, supabase) =>
  svc.createGlobal(supabase, { tenantId: req.tenantId, body: req.body || {} }));
const updateGlobal = wrap((req, supabase) =>
  svc.updateGlobal(supabase, { tenantId: req.tenantId, id: req.params.id, body: req.body || {} }));

async function removeGlobal(req, res, supabase) {
  try {
    await svc.deleteGlobal(supabase, { tenantId: req.tenantId, id: req.params.id });
    res.json({ success: true });
  } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }); }
}

module.exports = { list, create, update, remove, listGlobal, createGlobal, updateGlobal, removeGlobal };
