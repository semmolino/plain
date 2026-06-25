"use strict";

const svc = require("../services/bookingTypes");

async function list(req, res, supabase) {
  try {
    const projectId = req.query.project_id ? Number(req.query.project_id) : null;
    const activeOnly = req.query.active === "1" || req.query.active === "true";
    const data = await svc.listBookingTypes(supabase, { tenantId: req.tenantId, projectId, activeOnly });
    res.json({ data });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

// Auswahlliste beim Buchen (global + projektbezogen, nur aktive).
async function listSelectable(req, res, supabase) {
  try {
    const projectId = req.query.project_id ? Number(req.query.project_id) : null;
    const data = await svc.listSelectableForBooking(supabase, { tenantId: req.tenantId, projectId });
    res.json({ data });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

// ── Projektpreise (Preislisten) ──────────────────────────────────────────────
async function listProjectPrices(req, res, supabase) {
  try {
    const projectId = req.query.project_id ? Number(req.query.project_id) : null;
    const data = await svc.listProjectPriceList(supabase, { tenantId: req.tenantId, projectId });
    res.json({ data });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function upsertProjectPrice(req, res, supabase) {
  try {
    const b = req.body || {};
    const data = await svc.upsertProjectPrice(supabase, {
      tenantId: req.tenantId,
      projectId: b.project_id,
      bookingTypeId: b.booking_type_id,
      spRate: b.sp_rate,
      cpRate: b.cp_rate,
    });
    res.json({ success: true, data });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function create(req, res, supabase) {
  try {
    const data = await svc.createBookingType(supabase, { tenantId: req.tenantId, body: req.body || {} });
    res.json({ data });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function patch(req, res, supabase) {
  try {
    const data = await svc.patchBookingType(supabase, { tenantId: req.tenantId, id: req.params.id, body: req.body || {} });
    res.json({ data });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function remove(req, res, supabase) {
  try {
    await svc.deleteBookingType(supabase, { tenantId: req.tenantId, id: req.params.id });
    res.json({ success: true });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

module.exports = { list, listSelectable, listProjectPrices, upsertProjectPrice, create, patch, remove };
