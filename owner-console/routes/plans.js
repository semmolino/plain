"use strict";

const express = require("express");
const path = require("path");
const registry = require(path.join(__dirname, "..", "..", "backend", "licensing", "registry"));
const { supabase } = require("../services/db");
const { writeChangeLog } = require("../services/audit");

const router = express.Router();

// Plan anlegen
router.post("/plans", async (req, res) => {
  const { key, name_de, description_de, price_monthly, price_yearly, position } = req.body || {};
  if (!key || !name_de) return res.status(400).json({ error: "key und name_de erforderlich." });
  const { data, error } = await supabase.from("LICENSE_PLAN").insert([{
    KEY: key, NAME_DE: name_de, DESCRIPTION_DE: description_de || null,
    PRICE_MONTHLY: price_monthly ?? null, PRICE_YEARLY: price_yearly ?? null, POSITION: position ?? 0,
  }]).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_PLAN", entityRef: data.ID, action: "create", after: data });
  res.json({ plan: data });
});

// Plan bearbeiten
router.patch("/plans/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { data: before } = await supabase.from("LICENSE_PLAN").select("*").eq("ID", id).maybeSingle();
  if (!before) return res.status(404).json({ error: "Plan nicht gefunden." });

  const FIELDS = {
    name_de: "NAME_DE", description_de: "DESCRIPTION_DE", price_monthly: "PRICE_MONTHLY",
    price_yearly: "PRICE_YEARLY", position: "POSITION", is_active: "IS_ACTIVE",
  };
  const patch = {};
  for (const [k, col] of Object.entries(FIELDS)) if (k in (req.body || {})) patch[col] = req.body[k];
  patch.UPDATED_AT = new Date().toISOString();

  const { data, error } = await supabase.from("LICENSE_PLAN").update(patch).eq("ID", id).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_PLAN", entityRef: id, action: "update", before, after: data });
  res.json({ plan: data });
});

// Matrix-Zelle setzen/entfernen: Capability in Plan an/aus (+ optionales Limit)
router.put("/plans/:id/capabilities/:capKey", async (req, res) => {
  const planId = Number(req.params.id);
  const capKey = req.params.capKey;
  const { enabled, numeric_limit } = req.body || {};

  // Kein Phantom-Mapping: Capability muss im Manifest existieren.
  if (!registry.getCapability(capKey)) return res.status(400).json({ error: `Unbekannte Capability: ${capKey}` });

  const ref = `${planId}:${capKey}`;
  if (enabled) {
    const { error } = await supabase.from("PLAN_CAPABILITY").upsert(
      [{ PLAN_ID: planId, CAPABILITY_KEY: capKey, NUMERIC_LIMIT: numeric_limit ?? null }],
      { onConflict: "PLAN_ID,CAPABILITY_KEY" }
    );
    if (error) return res.status(400).json({ error: error.message });
    await writeChangeLog({ actor: req.adminEmail, entity: "PLAN_CAPABILITY", entityRef: ref, action: "update",
      after: { plan_id: planId, capability_key: capKey, numeric_limit: numeric_limit ?? null } });
  } else {
    const { error } = await supabase.from("PLAN_CAPABILITY").delete().eq("PLAN_ID", planId).eq("CAPABILITY_KEY", capKey);
    if (error) return res.status(400).json({ error: error.message });
    await writeChangeLog({ actor: req.adminEmail, entity: "PLAN_CAPABILITY", entityRef: ref, action: "delete" });
  }
  res.json({ ok: true });
});

module.exports = router;
