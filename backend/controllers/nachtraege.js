'use strict';

const svc = require('../services/nachtraege');
const { renderNachtragPdf } = require('../services_pdf_render');

async function listStatuses(req, res, supabase) {
  try {
    const data = await svc.listStatuses(supabase);
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function list(req, res, supabase) {
  try {
    const projectId = req.query.project_id ? parseInt(String(req.query.project_id), 10) : null;
    const data = await svc.list(supabase, { tenantId: req.tenantId, projectId });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function get(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.get(supabase, { tenantId: req.tenantId, nachtragId: id });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function create(req, res, supabase) {
  try {
    const data = await svc.create(supabase, { tenantId: req.tenantId, body: req.body, employeeId: req.employeeId });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function update(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.update(supabase, { tenantId: req.tenantId, nachtragId: id, body: req.body, employeeId: req.employeeId });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function remove(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    await svc.remove(supabase, { tenantId: req.tenantId, nachtragId: id });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function getStructure(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.getStructure(supabase, { tenantId: req.tenantId, nachtragId: id });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function addStructureNode(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.addStructureNode(supabase, { tenantId: req.tenantId, nachtragId: id, body: req.body });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function updateStructureNode(req, res, supabase) {
  try {
    const nodeId = parseInt(req.params.nodeId, 10);
    if (!nodeId) return res.status(400).json({ error: 'Ungültige Node-ID' });
    const data = await svc.updateStructureNode(supabase, { tenantId: req.tenantId, nodeId, body: req.body });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function deleteStructureNode(req, res, supabase) {
  try {
    const nodeId = parseInt(req.params.nodeId, 10);
    if (!nodeId) return res.status(400).json({ error: 'Ungültige Node-ID' });
    await svc.deleteStructureNode(supabase, { tenantId: req.tenantId, nodeId });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function release(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.release(supabase, { tenantId: req.tenantId, nachtragId: id, body: req.body, employeeId: req.employeeId });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function listReleases(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.listReleases(supabase, { tenantId: req.tenantId, nachtragId: id });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function saveReview(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.saveReview(supabase, { tenantId: req.tenantId, nachtragId: id, body: req.body, employeeId: req.employeeId });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function getPdf(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const download = String(req.query.download || '') === '1';
    const { pdf, nachtrag } = await renderNachtragPdf({ supabase, nachtragId: id, tenantId: req.tenantId });
    const filename = `Nachtrag_${nachtrag.NAME_SHORT || id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

module.exports = {
  listStatuses,
  list,
  get,
  create,
  update,
  remove,
  getStructure,
  addStructureNode,
  updateStructureNode,
  deleteStructureNode,
  release,
  listReleases,
  saveReview,
  getPdf,
};
