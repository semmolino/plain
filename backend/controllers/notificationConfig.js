'use strict';

const svc = require('../services/notificationConfig');

async function listAll(req, res, supabase) {
  try {
    const data = await svc.listAllForAdmin(supabase, req.tenantId);
    res.json({ data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

async function upsert(req, res, supabase) {
  try {
    const typeKey = String(req.params.typeKey || '').trim();
    if (!typeKey) return res.status(400).json({ error: 'typeKey fehlt' });
    const data = await svc.upsertConfig(supabase, {
      tenantId:  req.tenantId,
      typeKey,
      body:      req.body || {},
      employeeId: req.employeeId,
    });
    res.json({ data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

// POST /notification-config/:typeKey/preview
// Empfaenger-Vorschau fuer einen noch nicht gespeicherten Entwurf. Schreibt
// nichts — POST nur, weil der Entwurf im Body steckt.
async function preview(req, res, supabase) {
  try {
    const typeKey = String(req.params.typeKey || '').trim();
    if (!typeKey) return res.status(400).json({ error: 'typeKey fehlt' });
    const data = await svc.previewAudience(supabase, req.tenantId, typeKey, req.body || {});
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

module.exports = { listAll, upsert, preview };
