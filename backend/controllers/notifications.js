"use strict";

const svc = require("../services/notifications");

// GET /api/v1/notifications
async function listNotifications(req, res, supabase) {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  try {
    const data = await svc.listNotifications(supabase, {
      tenantId: req.tenantId,
      userId:   req.userId,
      limit,
    });
    const count = await svc.unreadCount(supabase, { tenantId: req.tenantId, userId: req.userId });
    return res.json({ data, unread_count: count });
  } catch (e) {
    return res.status(e?.status ?? 500).json({ error: e?.message || String(e) });
  }
}

// PATCH /api/v1/notifications/:id/read
async function markRead(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Ungültige ID" });
  try {
    await svc.markRead(supabase, { id, tenantId: req.tenantId, userId: req.userId });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(e?.status ?? 500).json({ error: e?.message || String(e) });
  }
}

// POST /api/v1/notifications/read-all
async function markAllRead(req, res, supabase) {
  try {
    await svc.markAllRead(supabase, { tenantId: req.tenantId, userId: req.userId });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(e?.status ?? 500).json({ error: e?.message || String(e) });
  }
}

module.exports = { listNotifications, markRead, markAllRead };
