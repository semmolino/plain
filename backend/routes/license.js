"use strict";

const express = require("express");
const { getUsage } = require("../middleware/limits");

/**
 * Liefert das effektive Entitlement des eingeloggten Tenants ans Frontend
 * (analog /permissions/me). req.license wird von der licenseMiddleware gesetzt.
 */
module.exports = (supabase) => {
  const router = express.Router();

  router.get("/me", (req, res) => {
    const lic = req.license || {};
    res.json({
      unrestricted: !!req._licenseUnrestricted,
      plan_id: lic.planId ?? null,
      state: lic.state ?? null,
      // 'read_only' -> Frontend zeigt Banner + versteckt Schreib-Aktionen.
      restriction: lic.restriction ?? null,
      capabilities: [...(lic.capabilities || [])],
      limits: Object.fromEntries(lic.limits || []),
    });
  });

  // Aktuelle Nutzung der Mengenlimits (IST vs. Grenze) — für „8 von 10"-Anzeigen.
  router.get("/usage", async (req, res) => {
    try {
      res.json({ usage: await getUsage(supabase, req) });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  return router;
};
