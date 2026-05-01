"use strict";

const svc = require("../services/buchungen");

async function createBuchung(req, res, supabase) {
  try {
    await svc.createBuchung(supabase, { body: req.body, tenantId: req.tenantId });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function patchBuchung(req, res, supabase) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID fehlt" });
  try {
    const data = await svc.patchBuchung(supabase, { id, body: req.body, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function deleteBuchung(req, res, supabase) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID fehlt" });
  try {
    await svc.deleteBuchung(supabase, { id });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function listBuchungenByProject(req, res, supabase) {
  const projectId = req.params.id;
  try {
    const data = await svc.listBuchungenByProject(supabase, { projectId, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function createTimerDraft(req, res, supabase) {
  try {
    const data = await svc.createTimerDraft(supabase, { body: req.body });
    res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function listDraftsByEmployee(req, res, supabase) {
  const { employee_id, date } = req.query;
  try {
    const data = await svc.listDraftsByEmployee(supabase, { employeeId: employee_id, date });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function confirmDrafts(req, res, supabase) {
  const { ids } = req.body || {};
  try {
    const result = await svc.confirmDrafts(supabase, { ids });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function deleteDraft(req, res, supabase) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID fehlt" });
  try {
    await svc.deleteDraft(supabase, { id });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function patchDraftDescription(req, res, supabase) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID fehlt" });
  const { description } = req.body || {};
  try {
    await svc.patchDraftDescription(supabase, { id, description: description ?? "" });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

module.exports = {
  createBuchung,
  patchBuchung,
  deleteBuchung,
  listBuchungenByProject,
  createTimerDraft,
  listDraftsByEmployee,
  confirmDrafts,
  deleteDraft,
  patchDraftDescription,
};
