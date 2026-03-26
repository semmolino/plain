"use strict";

const svc = require("../services/finalInvoices");

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

module.exports = {
  getPhases,
  savePhases,
  getDeductions,
  saveDeductions,
  getFinalInvoice,
  bookFinalInvoice,
};
