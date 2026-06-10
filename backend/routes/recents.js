"use strict";

const express = require("express");
const svc = require("../services/recents");

/**
 * /api/v1/recents
 *
 *   POST   /                  -> trackt einen Zugriff
 *   GET    /?type=project     -> Liste pro Entity-Typ
 *   GET    /dashboard         -> typuebergreifender Mix
 *
 * Keine Permission-Guards: der User kann nur Datensaetze tracken/sehen,
 * die er ohnehin schon erreicht hat.
 */
module.exports = (supabase) => {
  const router = express.Router();

  router.post("/", async (req, res) => {
    try {
      const { entity_type, entity_id, label, meta } = req.body || {};
      const r = await svc.trackRecent(supabase, {
        tenantId:   req.tenantId,
        employeeId: req.employeeId,
        entityType: entity_type,
        entityId:   parseInt(entity_id, 10),
        label:      typeof label === "string" ? label.slice(0, 200) : null,
        meta:       meta && typeof meta === "object" ? meta : null,
      });
      res.json({ data: r });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/dashboard", async (req, res) => {
    try {
      const data = await svc.listDashboardRecents(supabase, {
        tenantId:   req.tenantId,
        employeeId: req.employeeId,
        limit:      req.query.limit,
        staleDays:  req.query.stale_days,
      });
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/", async (req, res) => {
    try {
      const data = await svc.listRecents(supabase, {
        tenantId:   req.tenantId,
        employeeId: req.employeeId,
        entityType: req.query.type,
        limit:      req.query.limit,
        staleDays:  req.query.stale_days,
        projectId:  req.query.project_id,
        sortBy:     req.query.sort_by,
      });
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  return router;
};
