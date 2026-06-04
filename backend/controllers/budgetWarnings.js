'use strict';

const svc = require('../services/budgetWarnings');

async function getOverview(req, res, supabase) {
  try {
    const projectId = Number(req.params.projectId);
    if (!projectId) return res.status(400).json({ error: 'projectId fehlt' });
    const data = await svc.getProjectOverview(supabase, {
      tenantId: req.tenantId, projectId,
    });
    res.json({ data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

async function createRule(req, res, supabase) {
  try {
    const projectId = Number(req.params.projectId);
    if (!projectId) return res.status(400).json({ error: 'projectId fehlt' });
    const data = await svc.createRule(supabase, {
      tenantId: req.tenantId, projectId, body: req.body, employeeId: req.employeeId,
    });
    res.json({ data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

async function updateRule(req, res, supabase) {
  try {
    const ruleId = Number(req.params.ruleId);
    if (!ruleId) return res.status(400).json({ error: 'ruleId fehlt' });
    const data = await svc.updateRule(supabase, {
      tenantId: req.tenantId, ruleId, body: req.body,
    });
    res.json({ data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

async function deleteRule(req, res, supabase) {
  try {
    const ruleId = Number(req.params.ruleId);
    if (!ruleId) return res.status(400).json({ error: 'ruleId fehlt' });
    const data = await svc.deleteRule(supabase, {
      tenantId: req.tenantId, ruleId,
    });
    res.json({ data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

async function setProjectMute(req, res, supabase) {
  try {
    const projectId = Number(req.params.projectId);
    if (!projectId) return res.status(400).json({ error: 'projectId fehlt' });
    const data = await svc.setProjectMute(supabase, {
      tenantId: req.tenantId, projectId, muted: !!req.body?.muted,
    });
    res.json({ data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

module.exports = {
  getOverview,
  createRule,
  updateRule,
  deleteRule,
  setProjectMute,
};
