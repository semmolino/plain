"use strict";

const express = require("express");
const path = require("path");
const registry = require(path.join(__dirname, "..", "..", "backend", "licensing", "registry"));
const { supabase } = require("../services/db");
const { writeChangeLog } = require("../services/audit");
const { loadInbox } = require("../services/inbox");
const { readCatalog, invalidate: invalidateCatalog, gateUsage } = require("../services/catalog");

const router = express.Router();

/** Steht der Key im Code-Manifest? (für „kommt beim Seed zurück"-Hinweis) */
function registryHas(key) {
  return registry.allCapabilityKeys().includes(key);
}

const CAP_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/; // modul.fähigkeit(.sub)
const MODULE_KEY_RE = /^[a-z][a-z0-9_]{1,49}$/;
const CAP_TYPES = new Set(["boolean", "metered"]);

/** Prüft anhand des (DB-)Katalogs, ob eine Capability existiert. */
async function capExists(capKey) {
  const cat = await readCatalog();
  return cat.capabilities.some((c) => c.key === capKey);
}

// Capability-Katalog. Quelle ist die DB (editierbar); solange die Tabellen leer/
// fehlen, liefert der Service den Manifest-Fallback.
router.get("/capabilities", async (_req, res) => {
  try {
    const cat = await readCatalog();
    res.json({ modules: cat.modules, capabilities: cat.capabilities, fromDb: cat.fromDb });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
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
  const cat = await readCatalog();
  const capabilities = cat.capabilities.map((c) => ({
    key: c.key, module: c.module, labelDe: c.labelDe, type: c.type, unit: c.unit || null,
    inManifest: c.inManifest,
    permissionKeys: byCap[c.key] || [],
  }));
  res.json({
    modules: cat.modules,
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
  if (!(await capExists(capKey))) return res.status(400).json({ error: `Unbekannte Capability: ${capKey}` });
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
  if (!(await capExists(capKey))) return res.status(400).json({ error: `Unbekannte Capability: ${capKey}` });
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
  const cat = await readCatalog();
  const caps = cat.capabilities;
  const { data: plans, error } = await supabase
    .from("LICENSE_PLAN").select("ID, KEY, NAME_DE, POSITION").order("POSITION", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  const { data: pc } = await supabase.from("PLAN_CAPABILITY")
    .select("PLAN_ID, CAPABILITY_KEY, NUMERIC_LIMIT");
  const enabled = new Set((pc || []).map((r) => `${r.PLAN_ID}:${r.CAPABILITY_KEY}`));
  const limit = new Map((pc || []).map((r) => [`${r.PLAN_ID}:${r.CAPABILITY_KEY}`, r.NUMERIC_LIMIT]));
  res.json({
    plans: plans || [],
    modules: cat.modules,
    capabilities: caps.map((c) => ({ key: c.key, module: c.module, labelDe: c.labelDe, type: c.type, unit: c.unit || null })),
    cells: (plans || []).flatMap((p) => caps.map((c) => ({
      plan_id: p.ID,
      capability_key: c.key,
      enabled: enabled.has(`${p.ID}:${c.key}`),
      numeric_limit: limit.get(`${p.ID}:${c.key}`) ?? null,
    }))),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Katalog-Verwaltung (DB): Module + Capabilities anlegen/umbenennen/
//  umgruppieren/sortieren/löschen. Der KEY ist unveränderlich (Code-Gates und
//  Rechte-Verknüpfungen hängen daran); nur Label/Modul/Position/Einheit/Typ sind
//  editierbar. Löschen einer code-referenzierten Capability wird verhindert.
// ═══════════════════════════════════════════════════════════════════════════

async function nextPosition(table, moduleKey) {
  let q = supabase.from(table).select("POSITION");
  if (moduleKey) q = q.eq("MODULE_KEY", moduleKey);
  const { data } = await q;
  const max = (data || []).reduce((m, r) => Math.max(m, r.POSITION || 0), 0);
  return max + 10;
}

// ── Module ──────────────────────────────────────────────────────────────────
router.post("/modules", async (req, res) => {
  const { key, label_de, position } = req.body || {};
  if (!key || !label_de) return res.status(400).json({ error: "key und label_de erforderlich." });
  if (!MODULE_KEY_RE.test(String(key))) return res.status(400).json({ error: "Modul-Schlüssel: Kleinbuchstaben/Zahlen/_ (2–50 Zeichen)." });
  const { data, error } = await supabase.from("LICENSE_MODULE").insert([{
    KEY: key, LABEL_DE: label_de, POSITION: position ?? (await nextPosition("LICENSE_MODULE")),
  }]).select("*").single();
  if (error) {
    if (/duplicate key/i.test(error.message)) return res.status(409).json({ error: `Modul „${key}" existiert bereits.` });
    return res.status(400).json({ error: error.message });
  }
  invalidateCatalog();
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_MODULE", entityRef: key, action: "create", after: data, req });
  res.json({ module: data });
});

router.patch("/modules/:key", async (req, res) => {
  const key = req.params.key;
  const patch = {};
  if ("label_de" in (req.body || {})) patch.LABEL_DE = req.body.label_de;
  if ("position" in (req.body || {})) patch.POSITION = req.body.position;
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Keine Änderung übergeben." });
  const { data, error } = await supabase.from("LICENSE_MODULE").update(patch).eq("KEY", key).select("*").maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Modul nicht gefunden." });
  invalidateCatalog();
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_MODULE", entityRef: key, action: "update", after: data, req });
  res.json({ module: data });
});

router.delete("/modules/:key", async (req, res) => {
  const key = req.params.key;
  const { count } = await supabase.from("LICENSE_CAPABILITY").select("KEY", { count: "exact", head: true }).eq("MODULE_KEY", key);
  if ((count || 0) > 0) {
    return res.status(409).json({ error: `Modul enthält noch ${count} Capability(s). Erst umgruppieren.`, capability_count: count });
  }
  const { data, error } = await supabase.from("LICENSE_MODULE").delete().eq("KEY", key).select("KEY");
  if (error) return res.status(400).json({ error: error.message });
  if (!data || !data.length) return res.status(404).json({ error: "Modul nicht gefunden." });
  invalidateCatalog();
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_MODULE", entityRef: key, action: "delete", req });
  res.json({ ok: true });
});

// ── Capabilities ────────────────────────────────────────────────────────────
router.post("/capabilities", async (req, res) => {
  const { key, module, label_de, type, unit } = req.body || {};
  if (!key || !module || !label_de) return res.status(400).json({ error: "key, module und label_de erforderlich." });
  if (!CAP_KEY_RE.test(String(key))) return res.status(400).json({ error: "Schlüssel-Format: modul.fähigkeit (z. B. reports.forecast)." });
  const capType = type || "boolean";
  if (!CAP_TYPES.has(capType)) return res.status(400).json({ error: "type muss 'boolean' oder 'metered' sein." });
  if (capType === "metered" && !unit) return res.status(400).json({ error: "Mengenbasierte Capability braucht eine Einheit (unit)." });

  const cat = await readCatalog();
  if (cat.capabilities.some((c) => c.key === key)) return res.status(409).json({ error: `Capability „${key}" existiert bereits.` });
  if (!cat.modules.some((m) => m.key === module)) return res.status(400).json({ error: `Unbekanntes Modul: ${module}` });

  const row = {
    KEY: key, MODULE_KEY: module, LABEL_DE: label_de, TYPE: capType,
    UNIT: capType === "metered" ? unit : null, POSITION: await nextPosition("LICENSE_CAPABILITY"),
  };
  const { data, error } = await supabase.from("LICENSE_CAPABILITY").insert([row]).select("*").single();
  if (error) {
    if (/foreign key/i.test(error.message)) return res.status(400).json({ error: `Unbekanntes Modul: ${module}` });
    return res.status(400).json({ error: error.message });
  }
  // Wie der Seed: neue Capability dem internen 'full'-Plan hinzufügen, damit
  // Bestand/interne Tenants sie ebenfalls erhalten (Additionen propagieren).
  const { data: full } = await supabase.from("LICENSE_PLAN").select("ID").eq("KEY", "full").maybeSingle();
  if (full) {
    await supabase.from("PLAN_CAPABILITY").upsert(
      [{ PLAN_ID: full.ID, CAPABILITY_KEY: key, NUMERIC_LIMIT: null }],
      { onConflict: "PLAN_ID,CAPABILITY_KEY" }
    );
  }
  invalidateCatalog();
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_CAPABILITY", entityRef: key, action: "create", after: data, req });
  res.json({ capability: data });
});

router.patch("/capabilities/:key", async (req, res) => {
  const key = req.params.key;
  const body = req.body || {};
  const patch = {};
  if ("label_de" in body) patch.LABEL_DE = body.label_de;
  if ("module" in body) patch.MODULE_KEY = body.module;      // umgruppieren
  if ("position" in body) patch.POSITION = body.position;    // sortieren
  if ("unit" in body) patch.UNIT = body.unit || null;
  if ("type" in body) {
    if (!CAP_TYPES.has(body.type)) return res.status(400).json({ error: "type muss 'boolean' oder 'metered' sein." });
    patch.TYPE = body.type;
    if (body.type === "boolean") patch.UNIT = null;
  }
  // KEY bewusst NICHT patchbar.
  if ("key" in body && body.key !== key) return res.status(400).json({ error: "Der Schlüssel ist unveränderlich (Code-Gates hängen daran). Bitte neu anlegen." });
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Keine Änderung übergeben." });

  if (patch.MODULE_KEY) {
    const cat = await readCatalog();
    if (!cat.modules.some((m) => m.key === patch.MODULE_KEY)) return res.status(400).json({ error: `Unbekanntes Modul: ${patch.MODULE_KEY}` });
  }
  const { data, error } = await supabase.from("LICENSE_CAPABILITY").update(patch).eq("KEY", key).select("*").maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Capability nicht gefunden." });
  invalidateCatalog();
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_CAPABILITY", entityRef: key, action: "update", after: data, req });
  res.json({ capability: data });
});

router.delete("/capabilities/:key", async (req, res) => {
  const key = req.params.key;
  const force = req.body?.force === true || req.query.force === "true";

  // 1) Code-Gates: hart blockieren — das Entfernen würde ein im Code geprüftes
  //    Feature ungegatet machen. Der Owner kann das nicht aus der Konsole lösen.
  const locations = gateUsage()[key];
  if (Array.isArray(locations) && locations.length) {
    return res.status(409).json({
      error: `„${key}" wird im Code über ein Feature-Gate geprüft und kann nicht gelöscht werden. Zuerst im Code entfernen.`,
      code_gated: true, locations,
    });
  }

  // 2) Plan-/Override-Nutzung: Löschen kaskadiert (FK ON DELETE CASCADE) — vor
  //    Datenverlust warnen und nur mit force ausführen.
  const [{ count: planCount }, { count: ovCount }, { count: permCount }] = await Promise.all([
    supabase.from("PLAN_CAPABILITY").select("CAPABILITY_KEY", { count: "exact", head: true }).eq("CAPABILITY_KEY", key),
    supabase.from("TENANT_ENTITLEMENT_OVERRIDE").select("CAPABILITY_KEY", { count: "exact", head: true }).eq("CAPABILITY_KEY", key),
    supabase.from("CAPABILITY_PERMISSION").select("CAPABILITY_KEY", { count: "exact", head: true }).eq("CAPABILITY_KEY", key),
  ]);
  if (!force && ((planCount || 0) > 0 || (ovCount || 0) > 0 || (permCount || 0) > 0)) {
    return res.status(409).json({
      error: "Diese Capability ist noch in Verwendung. Löschen entfernt sie aus Plänen, Ausnahmen und Funktions-Zuordnungen.",
      requires_force: true, plan_count: planCount || 0, override_count: ovCount || 0, permission_count: permCount || 0,
    });
  }

  const { data, error } = await supabase.from("LICENSE_CAPABILITY").delete().eq("KEY", key).select("KEY");
  if (error) return res.status(400).json({ error: error.message });
  if (!data || !data.length) return res.status(404).json({ error: "Capability nicht gefunden." });
  invalidateCatalog();

  const wasInManifest = registryHas(key);
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_CAPABILITY", entityRef: key, action: "delete",
    context: { in_manifest: wasInManifest }, req });
  res.json({
    ok: true,
    was_in_manifest: wasInManifest,
    note: wasInManifest
      ? "Diese Capability steht auch im Code-Manifest — beim nächsten Seed käme sie zurück. Zum dauerhaften Entfernen bitte auch aus capabilities.manifest.js löschen."
      : null,
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
