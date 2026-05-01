"use strict";

const svc = require("../services/projekte");

async function getStatuses(req, res, supabase) {
  try {
    const data = await svc.getStatuses(supabase);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function getTypes(req, res, supabase) {
  try {
    const data = await svc.getTypes(supabase);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function getManagers(req, res, supabase) {
  try {
    const data = await svc.getManagers(supabase);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function getActiveEmployees(req, res, supabase) {
  try {
    const data = await svc.getActiveEmployees(supabase);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function getActiveRoles(req, res, supabase) {
  try {
    const data = await svc.getActiveRoles(supabase);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function createProject(req, res, supabase) {
  try {
    const project = await svc.createProject(supabase, { body: req.body, tenantId: req.tenantId });
    res.json({ data: project });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function listProjects(req, res, supabase) {
  try {
    const data = await svc.listProjects(supabase, { tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function listProjectsFull(req, res, supabase) {
  try {
    const data = await svc.listProjectsFull(supabase, { tenantId: req.tenantId, limit: req.query.limit });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function patchProject(req, res, supabase) {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "Projekt-ID fehlt" });
  try {
    const data = await svc.patchProject(supabase, { id, body: req.body, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function searchProjects(req, res, supabase) {
  const q = (req.query.q || "").toString().trim();
  if (!q || q.length < 2) return res.json({ data: [] });
  try {
    const data = await svc.searchProjects(supabase, { q, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function searchContracts(req, res, supabase) {
  const q = (req.query.q || "").toString().trim();
  const projectIdRaw = (req.query.project_id || "").toString().trim();
  if (!projectIdRaw) return res.json({ data: [] });
  if (!q || q.length < 2) return res.json({ data: [] });
  try {
    const data = await svc.searchContracts(supabase, { projectId: projectIdRaw, q });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function getProjectStructure(req, res, supabase) {
  const { id } = req.params;
  try {
    const data = await svc.getProjectStructure(supabase, { projectId: id });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function patchStructureCompletionPercents(req, res, supabase) {
  const { id } = req.params;
  const structureId = String(id || "").trim();
  if (!structureId) return res.status(400).json({ error: "ID fehlt" });

  const b = req.body || {};
  const revPctRaw = b.REVENUE_COMPLETION_PERCENT;
  const exPctRaw = b.EXTRAS_COMPLETION_PERCENT;

  const revPct = revPctRaw === undefined || revPctRaw === null || String(revPctRaw) === "" ? 0 : Number(revPctRaw);
  const exPct = exPctRaw === undefined || exPctRaw === null || String(exPctRaw) === "" ? 0 : Number(exPctRaw);

  if (!Number.isFinite(revPct) || !Number.isFinite(exPct)) {
    return res.status(400).json({ error: "Ungültige Prozentwerte" });
  }

  try {
    await svc.patchStructureCompletionPercents(supabase, { structureId, revPct, exPct });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function progressSnapshot(req, res, supabase) {
  const { id } = req.params;
  const projectId = String(id || "").trim();
  if (!projectId) return res.status(400).json({ error: "Projekt-ID fehlt" });
  try {
    const result = await svc.progressSnapshot(supabase, { projectId });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function getTecSum(req, res, supabase) {
  const { id } = req.params;
  try {
    const sum = await svc.getTecSum(supabase, { structureId: id });
    res.json({ sum });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function createStructureNode(req, res, supabase) {
  const { id: projectId } = req.params;
  try {
    const data = await svc.createStructureNode(supabase, { projectId, node: req.body || {} });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function patchStructure(req, res, supabase) {
  const { id } = req.params;
  const structureId = id;
  try {
    const computed = await svc.patchStructure(supabase, { structureId, update: req.body || {} });
    res.json({
      success: true,
      computed: {
        BILLING_TYPE_ID: computed.billingTypeId,
        REVENUE: computed.revenue,
        EXTRAS: computed.extras,
        REVENUE_COMPLETION: computed.revenueCompletion,
        EXTRAS_COMPLETION: computed.extrasCompletion,
      },
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function inheritStructure(req, res, supabase) {
  const { id } = req.params;
  const structureId = String(id || "").trim();
  if (!structureId) return res.status(400).json({ error: "ID fehlt" });

  const body = req.body || {};
  const hasBt = body.BILLING_TYPE_ID !== undefined && body.BILLING_TYPE_ID !== null && String(body.BILLING_TYPE_ID) !== "";
  const hasExtras = body.EXTRAS_PERCENT !== undefined && body.EXTRAS_PERCENT !== null && String(body.EXTRAS_PERCENT) !== "";
  if (!hasBt && !hasExtras) return res.status(400).json({ error: "Keine Felder zum Vererben übergeben" });

  const inheritBt = hasBt ? parseInt(body.BILLING_TYPE_ID, 10) : null;
  if (hasBt && (!inheritBt || Number.isNaN(inheritBt))) {
    return res.status(400).json({ error: "BILLING_TYPE_ID ungültig" });
  }
  const inheritExtras = hasExtras ? Number(body.EXTRAS_PERCENT) : null;
  if (hasExtras && !Number.isFinite(inheritExtras)) {
    return res.status(400).json({ error: "EXTRAS_PERCENT ungültig" });
  }

  try {
    const result = await svc.inheritStructure(supabase, { structureId, inheritBt, inheritExtras });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function moveStructure(req, res, supabase) {
  const { id } = req.params;
  const structureId = String(id || "").trim();
  if (!structureId) return res.status(400).json({ error: "ID fehlt" });
  const fatherRaw = (req.body || {}).father_id;
  const sortAfterId = (req.body || {}).sort_after_id; // null=prepend, '__end__'=append, id=insert after
  try {
    await svc.moveStructure(supabase, { structureId, fatherRaw, sortAfterId });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function getContractByProject(req, res, supabase) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Projekt-ID fehlt" });
  try {
    const data = await svc.getContractByProject(supabase, { projectId: id });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function patchContract(req, res, supabase) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Vertrags-ID fehlt" });
  try {
    await svc.patchContract(supabase, { contractId: id, body: req.body || {} });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function getLeistungsstand(req, res, supabase) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Projekt-ID fehlt" });
  try {
    const data = await svc.getLeistungsstand(supabase, { projectId: id });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function saveLeistungsstand(req, res, supabase) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Projekt-ID fehlt" });
  const updates = (req.body || {}).updates;
  if (!Array.isArray(updates)) return res.status(400).json({ error: "updates muss ein Array sein" });
  try {
    const result = await svc.saveLeistungsstand(supabase, { projectId: id, updates });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function deleteStructure(req, res, supabase) {
  const { id } = req.params;
  const structureId = String(id || "").trim();
  if (!structureId) return res.status(400).json({ error: "ID fehlt" });
  const cascade = String(req.query.cascade || "") === "1";
  try {
    const deleted_ids = await svc.deleteStructure(supabase, { structureId, cascade });
    res.json({ success: true, deleted_ids });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

module.exports = {
  getStatuses,
  getTypes,
  getManagers,
  getActiveEmployees,
  getActiveRoles,
  createProject,
  listProjects,
  listProjectsFull,
  patchProject,
  searchProjects,
  searchContracts,
  getProjectStructure,
  patchStructureCompletionPercents,
  progressSnapshot,
  getTecSum,
  createStructureNode,
  patchStructure,
  inheritStructure,
  moveStructure,
  deleteStructure,
  getLeistungsstand,
  saveLeistungsstand,
  getContractByProject,
  patchContract,
};
