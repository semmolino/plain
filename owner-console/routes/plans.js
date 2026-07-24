"use strict";

const express = require("express");
const path = require("path");
const registry = require(path.join(__dirname, "..", "..", "backend", "licensing", "registry"));
const { supabase } = require("../services/db");
const { writeChangeLog } = require("../services/audit");

const router = express.Router();

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

function intParam(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function capLabel(key) {
  return registry.getCapability(key)?.labelDe || key;
}

// Plan anlegen
router.post("/plans", async (req, res) => {
  const { key, name_de, description_de, price_monthly, price_yearly, position } = req.body || {};
  if (!key || !name_de) return res.status(400).json({ error: "key und name_de erforderlich." });
  if (!KEY_RE.test(String(key))) {
    return res.status(400).json({ error: "Schlüssel: Kleinbuchstaben, Zahlen und _ (2–40 Zeichen), beginnend mit einem Buchstaben." });
  }
  for (const [label, v] of [["€/Monat", price_monthly], ["€/Jahr", price_yearly]]) {
    if (v != null && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
      return res.status(400).json({ error: `${label}: ungültiger Betrag.` });
    }
  }

  const { data, error } = await supabase.from("LICENSE_PLAN").insert([{
    KEY: key, NAME_DE: name_de, DESCRIPTION_DE: description_de || null,
    PRICE_MONTHLY: price_monthly ?? null, PRICE_YEARLY: price_yearly ?? null, POSITION: position ?? 0,
  }]).select("*").single();
  if (error) {
    if (/duplicate key/i.test(error.message)) return res.status(409).json({ error: `Der Schlüssel „${key}" ist bereits vergeben.` });
    return res.status(400).json({ error: error.message });
  }
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_PLAN", entityRef: data.ID, action: "create",
    after: data, context: { plan_name: data.NAME_DE }, req });
  res.json({ plan: data });
});

// Plan bearbeiten
router.patch("/plans/:id", async (req, res) => {
  const id = intParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Ungültige Plan-ID." });
  const { data: before } = await supabase.from("LICENSE_PLAN").select("*").eq("ID", id).maybeSingle();
  if (!before) return res.status(404).json({ error: "Plan nicht gefunden." });

  const FIELDS = {
    name_de: "NAME_DE", description_de: "DESCRIPTION_DE", price_monthly: "PRICE_MONTHLY",
    price_yearly: "PRICE_YEARLY", position: "POSITION", is_active: "IS_ACTIVE", is_default: "IS_DEFAULT",
  };
  const patch = {};
  for (const [k, col] of Object.entries(FIELDS)) if (k in (req.body || {})) patch[col] = req.body[k];
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: "Keine Änderung übergeben." });

  // Einen aktiven Plan zu deaktivieren, auf dem noch Mandanten sitzen, ist
  // fast immer ein Versehen — sie behielten den Plan stillschweigend.
  if (patch.IS_ACTIVE === false && before.IS_ACTIVE) {
    const { count } = await supabase
      .from("TENANT_LICENSE").select("TENANT_ID", { count: "exact", head: true }).eq("PLAN_ID", id);
    if ((count || 0) > 0 && !req.body?.force) {
      return res.status(409).json({
        error: `Auf diesem Plan sitzen noch ${count} Mandant(en). Erst umziehen oder „force" senden.`,
        tenant_count: count,
      });
    }
  }
  // Genau ein Standard-Plan: der bisherige wird zurückgesetzt.
  if (patch.IS_DEFAULT === true) {
    await supabase.from("LICENSE_PLAN").update({ IS_DEFAULT: false }).eq("IS_DEFAULT", true);
  }
  patch.UPDATED_AT = new Date().toISOString();

  const { data, error } = await supabase.from("LICENSE_PLAN").update(patch).eq("ID", id).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_PLAN", entityRef: id, action: "update",
    before, after: data, context: { plan_name: data.NAME_DE }, req });
  res.json({ plan: data });
});

// Plan löschen — nur wenn kein Mandant darauf sitzt.
router.delete("/plans/:id", async (req, res) => {
  const id = intParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Ungültige Plan-ID." });
  const { data: before } = await supabase.from("LICENSE_PLAN").select("*").eq("ID", id).maybeSingle();
  if (!before) return res.status(404).json({ error: "Plan nicht gefunden." });

  const { count } = await supabase
    .from("TENANT_LICENSE").select("TENANT_ID", { count: "exact", head: true }).eq("PLAN_ID", id);
  if ((count || 0) > 0) {
    return res.status(409).json({ error: `Löschen nicht möglich: ${count} Mandant(en) nutzen diesen Plan.`, tenant_count: count });
  }
  if (before.IS_DEFAULT) return res.status(409).json({ error: "Der Standard-Plan kann nicht gelöscht werden." });

  const { error } = await supabase.from("LICENSE_PLAN").delete().eq("ID", id);
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_PLAN", entityRef: id, action: "delete",
    before, context: { plan_name: before.NAME_DE }, req });
  res.json({ ok: true });
});

// Plan duplizieren (inkl. Capabilities) — Basis für "Pro" aus "Basis" o.ä.
router.post("/plans/:id/duplicate", async (req, res) => {
  const id = intParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Ungültige Plan-ID." });
  const { key, name_de } = req.body || {};
  if (!key || !name_de) return res.status(400).json({ error: "key und name_de erforderlich." });
  if (!KEY_RE.test(String(key))) return res.status(400).json({ error: "Ungültiger Schlüssel." });

  const { data: src } = await supabase.from("LICENSE_PLAN").select("*").eq("ID", id).maybeSingle();
  if (!src) return res.status(404).json({ error: "Vorlage nicht gefunden." });

  const { data: plan, error } = await supabase.from("LICENSE_PLAN").insert([{
    KEY: key, NAME_DE: name_de, DESCRIPTION_DE: src.DESCRIPTION_DE,
    PRICE_MONTHLY: src.PRICE_MONTHLY, PRICE_YEARLY: src.PRICE_YEARLY,
    POSITION: (src.POSITION ?? 0) + 1, IS_ACTIVE: false,
  }]).select("*").single();
  if (error) {
    if (/duplicate key/i.test(error.message)) return res.status(409).json({ error: `Der Schlüssel „${key}" ist bereits vergeben.` });
    return res.status(400).json({ error: error.message });
  }

  const { data: caps } = await supabase.from("PLAN_CAPABILITY")
    .select("CAPABILITY_KEY, NUMERIC_LIMIT").eq("PLAN_ID", id);
  if (caps?.length) {
    await supabase.from("PLAN_CAPABILITY").insert(
      caps.map((c) => ({ PLAN_ID: plan.ID, CAPABILITY_KEY: c.CAPABILITY_KEY, NUMERIC_LIMIT: c.NUMERIC_LIMIT }))
    );
  }
  await writeChangeLog({ actor: req.adminEmail, entity: "LICENSE_PLAN", entityRef: plan.ID, action: "create",
    after: plan, context: { plan_name: plan.NAME_DE, duplicated_from: src.NAME_DE }, req });
  res.json({ plan, copied_capabilities: caps?.length || 0 });
});

// Matrix-Zelle setzen/entfernen: Capability in Plan an/aus (+ optionales Limit)
router.put("/plans/:id/capabilities/:capKey", async (req, res) => {
  const planId = intParam(req.params.id);
  if (!planId) return res.status(400).json({ error: "Ungültige Plan-ID." });
  const capKey = req.params.capKey;
  const { enabled, numeric_limit } = req.body || {};

  // Kein Phantom-Mapping: Capability muss im Manifest existieren.
  const cap = registry.getCapability(capKey);
  if (!cap) return res.status(400).json({ error: `Unbekannte Capability: ${capKey}` });
  if (numeric_limit != null && (!Number.isInteger(Number(numeric_limit)) || Number(numeric_limit) < 0)) {
    return res.status(400).json({ error: "Limit muss eine ganze Zahl ≥ 0 sein." });
  }

  const { data: plan } = await supabase.from("LICENSE_PLAN").select("ID, NAME_DE").eq("ID", planId).maybeSingle();
  if (!plan) return res.status(404).json({ error: "Plan nicht gefunden." });

  const ref = `${planId}:${capKey}`;
  const context = { plan_name: plan.NAME_DE, capability_label: cap.labelDe };
  if (enabled) {
    const { error } = await supabase.from("PLAN_CAPABILITY").upsert(
      [{ PLAN_ID: planId, CAPABILITY_KEY: capKey, NUMERIC_LIMIT: numeric_limit ?? null }],
      { onConflict: "PLAN_ID,CAPABILITY_KEY" }
    );
    if (error) return res.status(400).json({ error: error.message });
    await writeChangeLog({ actor: req.adminEmail, entity: "PLAN_CAPABILITY", entityRef: ref, action: "update",
      after: { plan_id: planId, capability_key: capKey, numeric_limit: numeric_limit ?? null }, context, req });
  } else {
    const { error } = await supabase.from("PLAN_CAPABILITY").delete().eq("PLAN_ID", planId).eq("CAPABILITY_KEY", capKey);
    if (error) return res.status(400).json({ error: error.message });
    await writeChangeLog({ actor: req.adminEmail, entity: "PLAN_CAPABILITY", entityRef: ref, action: "delete",
      before: { plan_id: planId, capability_key: capKey }, context, req });
  }
  res.json({ ok: true });
});

/**
 * Mehrere Zellen auf einmal setzen (Matrix: ganze Zeile/Spalte, „aus Plan
 * übernehmen"). Spart pro Klick einen Rundlauf und hält die Matrix konsistent.
 */
router.put("/plans/:id/capabilities", async (req, res) => {
  const planId = intParam(req.params.id);
  if (!planId) return res.status(400).json({ error: "Ungültige Plan-ID." });
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : null;
  if (!changes?.length) return res.status(400).json({ error: "changes (Array) erforderlich." });
  if (changes.length > 500) return res.status(400).json({ error: "Zu viele Änderungen auf einmal." });

  const unknown = changes.map((c) => c.capability_key).filter((k) => !registry.getCapability(k));
  if (unknown.length) return res.status(400).json({ error: `Unbekannte Capabilities: ${unknown.join(", ")}` });

  const { data: plan } = await supabase.from("LICENSE_PLAN").select("ID, NAME_DE").eq("ID", planId).maybeSingle();
  if (!plan) return res.status(404).json({ error: "Plan nicht gefunden." });

  const on = changes.filter((c) => c.enabled);
  const off = changes.filter((c) => !c.enabled).map((c) => c.capability_key);

  if (on.length) {
    const { error } = await supabase.from("PLAN_CAPABILITY").upsert(
      on.map((c) => ({ PLAN_ID: planId, CAPABILITY_KEY: c.capability_key, NUMERIC_LIMIT: c.numeric_limit ?? null })),
      { onConflict: "PLAN_ID,CAPABILITY_KEY" }
    );
    if (error) return res.status(400).json({ error: error.message });
  }
  if (off.length) {
    const { error } = await supabase.from("PLAN_CAPABILITY")
      .delete().eq("PLAN_ID", planId).in("CAPABILITY_KEY", off);
    if (error) return res.status(400).json({ error: error.message });
  }

  await writeChangeLog({
    actor: req.adminEmail, entity: "PLAN_CAPABILITY", entityRef: String(planId), action: "update",
    after: { added: on.map((c) => c.capability_key), removed: off },
    context: { plan_name: plan.NAME_DE, bulk: true, count: changes.length }, req,
  });
  res.json({ ok: true, added: on.length, removed: off.length });
});

module.exports = router;
