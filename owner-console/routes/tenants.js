"use strict";

const express = require("express");
const { supabase } = require("../services/db");
const { writeChangeLog } = require("../services/audit");

const router = express.Router();

// Tenant-Lizenzen auflisten
router.get("/tenants", async (_req, res) => {
  const { data, error } = await supabase
    .from("TENANT_LICENSE")
    .select("TENANT_ID, PLAN_ID, PLAN_VERSION, STATE, STARTS_AT, VALID_UNTIL, TRIAL_UNTIL, GRACE_UNTIL");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ tenants: data || [] });
});

// Per-Tenant-Override (Add-On / Sonderdeal): grant oder revoke
router.post("/tenants/:id/overrides", async (req, res) => {
  const tenantId = Number(req.params.id);
  const { capability_key, mode, numeric_limit, reason, expires_at } = req.body || {};
  if (!capability_key || !["grant", "revoke"].includes(mode)) {
    return res.status(400).json({ error: "capability_key und mode (grant|revoke) erforderlich." });
  }
  const { data, error } = await supabase.from("TENANT_ENTITLEMENT_OVERRIDE").upsert(
    [{
      TENANT_ID: tenantId, CAPABILITY_KEY: capability_key, MODE: mode,
      NUMERIC_LIMIT: numeric_limit ?? null, REASON: reason || null,
      EXPIRES_AT: expires_at || null, CREATED_BY: req.adminEmail,
    }],
    { onConflict: "TENANT_ID,CAPABILITY_KEY" }
  ).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({
    actor: req.adminEmail, entity: "TENANT_ENTITLEMENT_OVERRIDE",
    entityRef: `${tenantId}:${capability_key}`, action: "update", after: data,
  });
  res.json({ override: data });
});

module.exports = router;
