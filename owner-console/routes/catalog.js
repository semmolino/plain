"use strict";

const express = require("express");
const path = require("path");
// Quelle der Wahrheit für Capabilities ist das Manifest der Hauptanwendung.
const registry = require(path.join(__dirname, "..", "..", "backend", "licensing", "registry"));
const { supabase } = require("../services/db");

const router = express.Router();

// Capability-Katalog (read-only — kommt aus dem Code-Manifest)
router.get("/capabilities", (_req, res) => {
  res.json({ modules: registry.getModules(), capabilities: registry.getCapabilities() });
});

// Detail-Ansicht: pro Capability die konkreten Funktionen (RBAC-Rechte) MIT Labels.
// read-only (Stufe 1). Labels kommen aus der PERMISSION-Tabelle.
router.get("/capabilities/functions", async (_req, res) => {
  const caps = registry.getCapabilities();
  const keys = [...new Set(caps.flatMap((c) => c.permissions || []))];
  const labelMap = {};
  if (keys.length) {
    const { data, error } = await supabase.from("PERMISSION").select("KEY, LABEL_DE").in("KEY", keys);
    if (error) return res.status(500).json({ error: error.message });
    for (const p of data || []) labelMap[p.KEY] = p.LABEL_DE;
  }
  const capabilities = caps.map((c) => ({
    key: c.key, module: c.module, labelDe: c.labelDe, type: c.type, unit: c.unit || null,
    functions: (c.permissions || []).map((k) => ({ key: k, label: labelMap[k] || k })),
  }));
  res.json({ modules: registry.getModules(), capabilities });
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
