"use strict";

const express = require("express");
const path = require("path");
// Quelle der Wahrheit für Capabilities ist das Manifest der Hauptanwendung.
const registry = require(path.join(__dirname, "..", "..", "backend", "licensing", "registry"));
const { supabase } = require("../services/db");
const { writeChangeLog } = require("../services/audit");

const router = express.Router();

// Capability-Katalog (read-only — kommt aus dem Code-Manifest)
router.get("/capabilities", (_req, res) => {
  res.json({ modules: registry.getModules(), capabilities: registry.getCapabilities() });
});

// Detail-Matrix (Stufe 2a, EDITIERBAR): Capability -> Funktionen (RBAC-Rechte).
// Quelle der Zuordnung ist die DB (CAPABILITY_PERMISSION); das Manifest war nur
// der Initial-Seed. Liefert zusätzlich den vollen Permission-Katalog (für den Picker).
router.get("/capabilities/functions", async (_req, res) => {
  const { data: perms, error: e1 } = await supabase
    .from("PERMISSION").select("KEY, LABEL_DE, MODULE").order("POSITION", { ascending: true });
  if (e1) return res.status(500).json({ error: e1.message });
  const { data: links, error: e2 } = await supabase
    .from("CAPABILITY_PERMISSION").select("CAPABILITY_KEY, PERMISSION_KEY");
  if (e2) return res.status(500).json({ error: e2.message });
  const byCap = {};
  for (const l of links || []) (byCap[l.CAPABILITY_KEY] ||= []).push(l.PERMISSION_KEY);
  const capabilities = registry.getCapabilities().map((c) => ({
    key: c.key, module: c.module, labelDe: c.labelDe, type: c.type, unit: c.unit || null,
    permissionKeys: byCap[c.key] || [],
  }));
  res.json({
    modules: registry.getModules(),
    capabilities,
    permissions: (perms || []).map((p) => ({ key: p.KEY, label: p.LABEL_DE, module: p.MODULE })),
  });
});

// Capability <-> Funktion (RBAC-Recht) zuordnen / entfernen (auditiert).
router.put("/capabilities/:capKey/permissions/:permKey", async (req, res) => {
  const { capKey, permKey } = req.params;
  if (!registry.getCapability(capKey)) return res.status(400).json({ error: `Unbekannte Capability: ${capKey}` });
  const { error } = await supabase.from("CAPABILITY_PERMISSION")
    .upsert([{ CAPABILITY_KEY: capKey, PERMISSION_KEY: permKey }], { onConflict: "CAPABILITY_KEY,PERMISSION_KEY" });
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "CAPABILITY_PERMISSION", entityRef: `${capKey}:${permKey}`, action: "create", after: { capability: capKey, permission: permKey } });
  res.json({ ok: true });
});

router.delete("/capabilities/:capKey/permissions/:permKey", async (req, res) => {
  const { capKey, permKey } = req.params;
  const { error } = await supabase.from("CAPABILITY_PERMISSION")
    .delete().eq("CAPABILITY_KEY", capKey).eq("PERMISSION_KEY", permKey);
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "CAPABILITY_PERMISSION", entityRef: `${capKey}:${permKey}`, action: "delete" });
  res.json({ ok: true });
});

// Pläne inkl. zugeordneter Capabilities
router.get("/plans", async (_req, res) => {
  const { data: plans, error } = await supabase
    .from("LICENSE_PLAN").select("*").order("POSITION", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  const { data: pc } = await supabase.from("PLAN_CAPABILITY")
    .select("PLAN_ID, CAPABILITY_KEY, NUMERIC_LIMIT");
  const byPlan = {};
  for (const row of pc || []) {
    (byPlan[row.PLAN_ID] ||= []).push({ capability_key: row.CAPABILITY_KEY, numeric_limit: row.NUMERIC_LIMIT });
  }
  res.json({ plans: (plans || []).map((p) => ({ ...p, capabilities: byPlan[p.ID] || [] })) });
});

// Matrix Plan × Capability als boolesches Grid (+ Limits)
router.get("/matrix", async (_req, res) => {
  const caps = registry.getCapabilities();
  const { data: plans, error } = await supabase
    .from("LICENSE_PLAN").select("ID, KEY, NAME_DE, POSITION").order("POSITION", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  const { data: pc } = await supabase.from("PLAN_CAPABILITY")
    .select("PLAN_ID, CAPABILITY_KEY, NUMERIC_LIMIT");
  const enabled = new Set((pc || []).map((r) => `${r.PLAN_ID}:${r.CAPABILITY_KEY}`));
  const limit = new Map((pc || []).map((r) => [`${r.PLAN_ID}:${r.CAPABILITY_KEY}`, r.NUMERIC_LIMIT]));
  res.json({
    plans: plans || [],
    capabilities: caps.map((c) => ({ key: c.key, module: c.module, labelDe: c.labelDe, type: c.type, unit: c.unit || null })),
    cells: (plans || []).flatMap((p) => caps.map((c) => ({
      plan_id: p.ID,
      capability_key: c.key,
      enabled: enabled.has(`${p.ID}:${c.key}`),
      numeric_limit: limit.get(`${p.ID}:${c.key}`) ?? null,
    }))),
  });
});

// Inbox: Capabilities aus dem Manifest, die KEINEM Plan zugeordnet sind
// (= "neue Funktion dazugekommen, Entscheidung nötig").
router.get("/inbox", async (_req, res) => {
  const all = registry.allCapabilityKeys();
  const { data: pc, error } = await supabase.from("PLAN_CAPABILITY").select("CAPABILITY_KEY");
  if (error) return res.status(500).json({ error: error.message });
  const mapped = new Set((pc || []).map((r) => r.CAPABILITY_KEY));
  const unmapped = all.filter((k) => !mapped.has(k));
  res.json({ unmapped, count: unmapped.length });
});

module.exports = router;
