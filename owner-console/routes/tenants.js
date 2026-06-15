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

// Lizenztyp eines Tenants setzen/wechseln (Kernfall). Pinnt die Plan-Version.
router.patch("/tenants/:id/plan", async (req, res) => {
  const tenantId = Number(req.params.id);
  const { plan_id } = req.body || {};
  if (!plan_id) return res.status(400).json({ error: "plan_id erforderlich." });

  const { data: plan, error: pErr } = await supabase
    .from("LICENSE_PLAN").select("ID, VERSION").eq("ID", plan_id).maybeSingle();
  if (pErr) return res.status(500).json({ error: pErr.message });
  if (!plan) return res.status(400).json({ error: "Unbekannter Plan." });

  const { data: before } = await supabase
    .from("TENANT_LICENSE").select("*").eq("TENANT_ID", tenantId).maybeSingle();

  const row = {
    TENANT_ID:    tenantId,
    PLAN_ID:      plan.ID,
    PLAN_VERSION: plan.VERSION ?? 1,
    STATE:        before?.STATE || "active",
    STARTS_AT:    before?.STARTS_AT || new Date().toISOString(),
    UPDATED_AT:   new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("TENANT_LICENSE").upsert([row], { onConflict: "TENANT_ID" }).select("*").single();
  if (error) return res.status(400).json({ error: error.message });

  await writeChangeLog({
    actor: req.adminEmail, entity: "TENANT_LICENSE",
    entityRef: String(tenantId), action: "update", before, after: data,
  });
  res.json({ tenant_license: data });
});

// Overrides eines Tenants auflisten
router.get("/tenants/:id/overrides", async (req, res) => {
  const tenantId = Number(req.params.id);
  const { data, error } = await supabase
    .from("TENANT_ENTITLEMENT_OVERRIDE")
    .select("ID, CAPABILITY_KEY, MODE, NUMERIC_LIMIT, REASON, EXPIRES_AT, CREATED_AT, CREATED_BY")
    .eq("TENANT_ID", tenantId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ overrides: data || [] });
});

// Override entfernen
router.delete("/tenants/:id/overrides/:capKey", async (req, res) => {
  const tenantId = Number(req.params.id);
  const capKey = req.params.capKey;
  const { error } = await supabase
    .from("TENANT_ENTITLEMENT_OVERRIDE")
    .delete()
    .eq("TENANT_ID", tenantId)
    .eq("CAPABILITY_KEY", capKey);
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({
    actor: req.adminEmail, entity: "TENANT_ENTITLEMENT_OVERRIDE",
    entityRef: `${tenantId}:${capKey}`, action: "delete",
  });
  res.json({ ok: true });
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
