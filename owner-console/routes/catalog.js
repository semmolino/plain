"use strict";

const express = require("express");
const path = require("path");
// Quelle der Wahrheit für Capabilities ist das Manifest der Hauptanwendung.
const registry = require(path.join(__dirname, "..", "..", "backend", "licensing", "registry"));
const { supabase } = require("../services/db");
const { writeChangeLog } = require("../services/audit");
const { loadInbox } = require("../services/inbox");

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
  const byPerm = {};
  for (const l of links || []) {
    (byCap[l.CAPABILITY_KEY] ||= []).push(l.PERMISSION_KEY);
    (byPerm[l.PERMISSION_KEY] ||= []).push(l.CAPABILITY_KEY);
  }
  const capabilities = registry.getCapabilities().map((c) => ({
    key: c.key, module: c.module, labelDe: c.labelDe, type: c.type, unit: c.unit || null,
    since: c.since || null,
    permissionKeys: byCap[c.key] || [],
  }));
  res.json({
    modules: registry.getModules(),
    capabilities,
    // capabilityKeys je Recht: die UI zeigt damit an, wo ein Recht schon hängt
    // (Mehrfachzuordnung ist erlaubt, aber fast immer ein Versehen).
    permissions: (perms || []).map((p) => ({
      key: p.KEY, label: p.LABEL_DE, module: p.MODULE,
      capabilityKeys: byPerm[p.KEY] || [],
    })),
  });
});

/** Prüft, dass das RBAC-Recht im Katalog existiert — sonst quittiert der FK mit
 *  einer für den Owner unlesbaren Postgres-Meldung. */
async function permissionExists(permKey) {
  const { data, error } = await supabase.from("PERMISSION").select("KEY").eq("KEY", permKey).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

// Capability <-> Funktion (RBAC-Recht) zuordnen / entfernen (auditiert).
router.put("/capabilities/:capKey/permissions/:permKey", async (req, res) => {
  const { capKey, permKey } = req.params;
  if (!registry.getCapability(capKey)) return res.status(400).json({ error: `Unbekannte Capability: ${capKey}` });
  try {
    if (!(await permissionExists(permKey))) {
      return res.status(400).json({ error: `Unbekannte Funktion (RBAC-Recht): ${permKey}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  const { error } = await supabase.from("CAPABILITY_PERMISSION")
    .upsert([{ CAPABILITY_KEY: capKey, PERMISSION_KEY: permKey }], { onConflict: "CAPABILITY_KEY,PERMISSION_KEY" });
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "CAPABILITY_PERMISSION", entityRef: `${capKey}:${permKey}`, action: "create", after: { capability: capKey, permission: permKey } });
  res.json({ ok: true });
});

// Mehrere Funktionen auf einmal zuordnen (Massenzuweisung aus dem Funktionen-Tab).
router.post("/capabilities/:capKey/permissions", async (req, res) => {
  const { capKey } = req.params;
  const keys = Array.isArray(req.body?.permission_keys) ? req.body.permission_keys : null;
  if (!registry.getCapability(capKey)) return res.status(400).json({ error: `Unbekannte Capability: ${capKey}` });
  if (!keys || keys.length === 0) return res.status(400).json({ error: "permission_keys (Array) erforderlich." });
  if (keys.length > 200) return res.status(400).json({ error: "Zu viele Einträge auf einmal (max. 200)." });

  const { data: known, error: kErr } = await supabase.from("PERMISSION").select("KEY").in("KEY", keys);
  if (kErr) return res.status(500).json({ error: kErr.message });
  const knownKeys = new Set((known || []).map((k) => k.KEY));
  const unknown = keys.filter((k) => !knownKeys.has(k));
  if (unknown.length) return res.status(400).json({ error: `Unbekannte Funktionen: ${unknown.join(", ")}` });

  const { error } = await supabase.from("CAPABILITY_PERMISSION").upsert(
    keys.map((k) => ({ CAPABILITY_KEY: capKey, PERMISSION_KEY: k })),
    { onConflict: "CAPABILITY_KEY,PERMISSION_KEY" }
  );
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({
    actor: req.adminEmail, entity: "CAPABILITY_PERMISSION", entityRef: capKey, action: "create",
    after: { capability: capKey, permissions: keys },
  });
  res.json({ ok: true, added: keys.length });
});

router.delete("/capabilities/:capKey/permissions/:permKey", async (req, res) => {
  const { capKey, permKey } = req.params;
  const { data, error } = await supabase.from("CAPABILITY_PERMISSION")
    .delete().eq("CAPABILITY_KEY", capKey).eq("PERMISSION_KEY", permKey).select("CAPABILITY_KEY");
  if (error) return res.status(400).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: "Zuordnung nicht gefunden." });
  await writeChangeLog({ actor: req.adminEmail, entity: "CAPABILITY_PERMISSION", entityRef: `${capKey}:${permKey}`, action: "delete", before: { capability: capKey, permission: permKey } });
  res.json({ ok: true });
});

// Pläne inkl. zugeordneter Capabilities + Mandantenzahl (für Löschschutz)
router.get("/plans", async (_req, res) => {
  const { data: plans, error } = await supabase
    .from("LICENSE_PLAN").select("*").order("POSITION", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  const [{ data: pc }, { data: tl }] = await Promise.all([
    supabase.from("PLAN_CAPABILITY").select("PLAN_ID, CAPABILITY_KEY, NUMERIC_LIMIT"),
    supabase.from("TENANT_LICENSE").select("PLAN_ID"),
  ]);
  const byPlan = {};
  for (const row of pc || []) {
    (byPlan[row.PLAN_ID] ||= []).push({ capability_key: row.CAPABILITY_KEY, numeric_limit: row.NUMERIC_LIMIT });
  }
  const tenantCount = {};
  for (const row of tl || []) tenantCount[row.PLAN_ID] = (tenantCount[row.PLAN_ID] || 0) + 1;
  res.json({
    plans: (plans || []).map((p) => ({
      ...p, capabilities: byPlan[p.ID] || [], tenant_count: tenantCount[p.ID] || 0,
    })),
  });
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
    modules: registry.getModules(),
    capabilities: caps.map((c) => ({ key: c.key, module: c.module, labelDe: c.labelDe, type: c.type, unit: c.unit || null })),
    cells: (plans || []).flatMap((p) => caps.map((c) => ({
      plan_id: p.ID,
      capability_key: c.key,
      enabled: enabled.has(`${p.ID}:${c.key}`),
      numeric_limit: limit.get(`${p.ID}:${c.key}`) ?? null,
    }))),
  });
});

// Inbox: alle offenen Lizenz-Aufgaben (Drift zwischen Code, Manifest und DB).
// Regeln + Begründung: backend/licensing/inboxRules.js
router.get("/inbox", async (_req, res) => {
  try {
    res.json(await loadInbox());
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

module.exports = router;
