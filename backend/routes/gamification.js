"use strict";

const express = require("express");
const { requirePermission } = require("../middleware/permissions");

/**
 * Engagement-Konfiguration pro Tenant.
 *
 * Liest 5 Flags aus TENANT_SETTINGS:
 *   gamification.enabled            (Master-Schalter)
 *   gamification.setup_checklist
 *   gamification.streaks
 *   gamification.achievements
 *   gamification.recaps
 *
 * Default beim Lesen: alles aktiviert. Schreiben gated mit
 * settings.notifications.edit (gleiche Familie wie restliche Engagement-
 * Konfigurationen).
 */

const KEYS = {
  enabled:         "gamification.enabled",
  setup_checklist: "gamification.setup_checklist",
  streaks:         "gamification.streaks",
  achievements:    "gamification.achievements",
  recaps:          "gamification.recaps",
};

function parseBool(v, def = true) {
  if (v == null) return def;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

async function readConfig(supabase, tenantId) {
  const { data, error } = await supabase
    .from("TENANT_SETTINGS")
    .select("KEY, VALUE")
    .eq("TENANT_ID", tenantId)
    .in("KEY", Object.values(KEYS));
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) {
      return { enabled: true, setup_checklist: true, streaks: true, achievements: true, recaps: true };
    }
    throw error;
  }
  const map = new Map((data || []).map(r => [r.KEY, r.VALUE]));
  return {
    enabled:         parseBool(map.get(KEYS.enabled),         true),
    setup_checklist: parseBool(map.get(KEYS.setup_checklist), true),
    streaks:         parseBool(map.get(KEYS.streaks),         true),
    achievements:    parseBool(map.get(KEYS.achievements),    true),
    recaps:          parseBool(map.get(KEYS.recaps),          true),
  };
}

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/config", async (req, res) => {
    try {
      const cfg = await readConfig(supabase, req.tenantId);
      res.json({ data: cfg });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  router.put("/config", requirePermission("settings.notifications.edit"), async (req, res) => {
    try {
      const body = req.body || {};
      const rows = [];
      const nowIso = new Date().toISOString();
      for (const [field, key] of Object.entries(KEYS)) {
        if (body[field] == null) continue;
        rows.push({ TENANT_ID: req.tenantId, KEY: key, VALUE: parseBool(body[field]) ? "true" : "false", UPDATED_AT: nowIso });
      }
      if (rows.length > 0) {
        const { error } = await supabase
          .from("TENANT_SETTINGS")
          .upsert(rows, { onConflict: "TENANT_ID,KEY" });
        if (error) throw error;
      }
      const cfg = await readConfig(supabase, req.tenantId);
      res.json({ data: cfg });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  return router;
};
