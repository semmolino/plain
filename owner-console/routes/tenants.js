"use strict";

const express = require("express");
const path = require("path");
const registry = require(path.join(__dirname, "..", "..", "backend", "licensing", "registry"));
const { supabase } = require("../services/db");
const { writeChangeLog } = require("../services/audit");

const router = express.Router();

const LICENSE_STATES = ["trial", "active", "past_due", "grace", "expired"];

/** Ganzzahlige Route-Parameter sauber prüfen (Number("abc") -> NaN). */
function intParam(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Tenant-Liste.
 *
 * Quelle ist TENANTS — NICHT TENANT_LICENSE. Vorher wurde nur die Lizenztabelle
 * gelesen: jeder nach dem Einspielen von 0070 registrierte Mandant fehlte
 * dadurch komplett in der Konsole (und gilt wegen des Soft-Fails in
 * backend/middleware/license.js zugleich als „unbeschränkt").
 */
router.get("/tenants", async (_req, res) => {
  const { data: tenants, error } = await supabase
    .from("TENANTS").select("ID, TENANT, SLUG").order("ID", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const [{ data: lics }, { data: plans }, { data: emps }, { data: overrides }] = await Promise.all([
    supabase.from("TENANT_LICENSE")
      .select("TENANT_ID, PLAN_ID, PLAN_VERSION, STATE, STARTS_AT, VALID_UNTIL, TRIAL_UNTIL, GRACE_UNTIL, UPDATED_AT"),
    supabase.from("LICENSE_PLAN").select("ID, KEY, NAME_DE, VERSION"),
    supabase.from("EMPLOYEE").select("TENANT_ID"),
    supabase.from("TENANT_ENTITLEMENT_OVERRIDE").select("TENANT_ID"),
  ]);

  const licByTenant = new Map((lics || []).map((l) => [l.TENANT_ID, l]));
  const planById = new Map((plans || []).map((p) => [p.ID, p]));
  const empCount = new Map();
  for (const e of emps || []) empCount.set(e.TENANT_ID, (empCount.get(e.TENANT_ID) || 0) + 1);
  const ovCount = new Map();
  for (const o of overrides || []) ovCount.set(o.TENANT_ID, (ovCount.get(o.TENANT_ID) || 0) + 1);

  const rows = (tenants || []).map((t) => {
    const lic = licByTenant.get(t.ID) || null;
    const plan = lic ? planById.get(lic.PLAN_ID) || null : null;
    return {
      TENANT_ID: t.ID,
      NAME: t.TENANT || null,
      SLUG: t.SLUG || null,
      EMPLOYEE_COUNT: empCount.get(t.ID) || 0,
      OVERRIDE_COUNT: ovCount.get(t.ID) || 0,
      HAS_LICENSE: !!lic,
      PLAN_ID: lic?.PLAN_ID ?? null,
      PLAN_NAME: plan?.NAME_DE ?? null,
      PLAN_KEY: plan?.KEY ?? null,
      // Gepinnte Version vs. aktuelle Plan-Version: weicht sie ab, wurde der
      // Plan nach der Zuweisung verändert (siehe Migration 0102).
      PLAN_VERSION: lic?.PLAN_VERSION ?? null,
      PLAN_VERSION_CURRENT: plan?.VERSION ?? null,
      PLAN_OUTDATED: !!(lic && plan && plan.VERSION != null && lic.PLAN_VERSION !== plan.VERSION),
      STATE: lic?.STATE ?? null,
      STARTS_AT: lic?.STARTS_AT ?? null,
      VALID_UNTIL: lic?.VALID_UNTIL ?? null,
      TRIAL_UNTIL: lic?.TRIAL_UNTIL ?? null,
      GRACE_UNTIL: lic?.GRACE_UNTIL ?? null,
      UPDATED_AT: lic?.UPDATED_AT ?? null,
    };
  });

  res.json({
    tenants: rows,
    unlicensed: rows.filter((r) => !r.HAS_LICENSE).length,
  });
});

/**
 * Alle Ausnahmen (Overrides) tenantübergreifend — Bestandsschutz-Überblick.
 * Beantwortet „wer hat welche Abweichung vom Plan?" an einer Stelle.
 */
router.get("/overrides", async (_req, res) => {
  const { data: ovs, error } = await supabase
    .from("TENANT_ENTITLEMENT_OVERRIDE")
    .select("ID, TENANT_ID, CAPABILITY_KEY, MODE, NUMERIC_LIMIT, REASON, EXPIRES_AT, CREATED_AT, CREATED_BY")
    .order("CREATED_AT", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const tenantIds = [...new Set((ovs || []).map((o) => o.TENANT_ID))];
  const { data: tenants } = tenantIds.length
    ? await supabase.from("TENANTS").select("ID, TENANT").in("ID", tenantIds)
    : { data: [] };
  const nameById = new Map((tenants || []).map((t) => [t.ID, t.TENANT]));
  const now = Date.now();

  res.json({
    overrides: (ovs || []).map((o) => ({
      id: o.ID,
      tenant_id: o.TENANT_ID,
      tenant_name: nameById.get(o.TENANT_ID) || null,
      capability_key: o.CAPABILITY_KEY,
      capability_label: registry.getCapability(o.CAPABILITY_KEY)?.labelDe || o.CAPABILITY_KEY,
      mode: o.MODE,
      numeric_limit: o.NUMERIC_LIMIT,
      reason: o.REASON,
      expires_at: o.EXPIRES_AT,
      expired: !!(o.EXPIRES_AT && new Date(o.EXPIRES_AT).getTime() < now),
      is_grandfather: typeof o.REASON === "string" && o.REASON.startsWith("Bestandsschutz:"),
      created_at: o.CREATED_AT,
      created_by: o.CREATED_BY,
    })),
  });
});

/**
 * Lizenz eines Tenants setzen: Plan, Zustand und Fristen.
 * Pinnt die aktuelle Plan-VERSION, damit spätere Paketänderungen bestehende
 * Kunden nicht stillschweigend verändern (Grandfathering, siehe Migration 0102).
 */
router.patch("/tenants/:id/plan", async (req, res) => {
  const tenantId = intParam(req.params.id);
  if (!tenantId) return res.status(400).json({ error: "Ungültige Tenant-ID." });
  const { plan_id, state, valid_until, trial_until, grace_until, repin_version } = req.body || {};

  // Phantom-Zeilen verhindern: nur echte Mandanten dürfen eine Lizenz bekommen.
  const { data: tenant, error: tErr } = await supabase
    .from("TENANTS").select("ID, TENANT").eq("ID", tenantId).maybeSingle();
  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!tenant) return res.status(404).json({ error: "Unbekannter Mandant." });

  const { data: before } = await supabase
    .from("TENANT_LICENSE").select("*").eq("TENANT_ID", tenantId).maybeSingle();

  let planId = plan_id ?? before?.PLAN_ID;
  if (!planId) return res.status(400).json({ error: "plan_id erforderlich." });
  const { data: plan, error: pErr } = await supabase
    .from("LICENSE_PLAN").select("ID, VERSION, IS_ACTIVE, NAME_DE").eq("ID", planId).maybeSingle();
  if (pErr) return res.status(500).json({ error: pErr.message });
  if (!plan) return res.status(400).json({ error: "Unbekannter Plan." });

  if (state != null && !LICENSE_STATES.includes(state)) {
    return res.status(400).json({ error: `Ungültiger Zustand. Erlaubt: ${LICENSE_STATES.join(", ")}` });
  }

  const planChanged = before?.PLAN_ID !== plan.ID;
  const row = {
    TENANT_ID:    tenantId,
    PLAN_ID:      plan.ID,
    // Version neu pinnen, wenn der Plan wechselt oder es ausdrücklich verlangt wird.
    PLAN_VERSION: planChanged || repin_version ? (plan.VERSION ?? 1) : (before?.PLAN_VERSION ?? plan.VERSION ?? 1),
    STATE:        state ?? before?.STATE ?? "active",
    STARTS_AT:    before?.STARTS_AT || new Date().toISOString(),
    UPDATED_AT:   new Date().toISOString(),
  };
  if (valid_until !== undefined) row.VALID_UNTIL = valid_until || null;
  if (trial_until !== undefined) row.TRIAL_UNTIL = trial_until || null;
  if (grace_until !== undefined) row.GRACE_UNTIL = grace_until || null;

  const { data, error } = await supabase
    .from("TENANT_LICENSE").upsert([row], { onConflict: "TENANT_ID" }).select("*").single();
  if (error) return res.status(400).json({ error: error.message });

  await writeChangeLog({
    actor: req.adminEmail, entity: "TENANT_LICENSE",
    entityRef: String(tenantId), action: before ? "update" : "create",
    before, after: data,
    context: { tenant_name: tenant.TENANT, plan_name: plan.NAME_DE }, req,
  });
  res.json({ tenant_license: data });
});

/** Effektives Entitlement eines Tenants — was der Mandant real sieht. */
router.get("/tenants/:id/entitlement", async (req, res) => {
  const tenantId = intParam(req.params.id);
  if (!tenantId) return res.status(400).json({ error: "Ungültige Tenant-ID." });

  const { data: lic } = await supabase
    .from("TENANT_LICENSE").select("PLAN_ID, PLAN_VERSION, STATE").eq("TENANT_ID", tenantId).maybeSingle();
  if (!lic) {
    // Genau der Zustand, den backend/middleware/license.js als „unrestricted" behandelt.
    return res.json({
      unrestricted: true,
      reason: "Keine Lizenzzeile — die Lizenzprüfung lässt alles zu (Soft-Fail).",
      capabilities: registry.allCapabilityKeys(), limits: {}, overrides: [],
    });
  }

  const [{ data: pc }, { data: ov }] = await Promise.all([
    supabase.from("PLAN_CAPABILITY").select("CAPABILITY_KEY, NUMERIC_LIMIT").eq("PLAN_ID", lic.PLAN_ID),
    supabase.from("TENANT_ENTITLEMENT_OVERRIDE")
      .select("CAPABILITY_KEY, MODE, NUMERIC_LIMIT, REASON, EXPIRES_AT").eq("TENANT_ID", tenantId),
  ]);

  // Gleiche Reihenfolge wie computeEntitlement in backend/middleware/license.js.
  const caps = new Set();
  const limits = {};
  for (const r of pc || []) {
    caps.add(r.CAPABILITY_KEY);
    if (r.NUMERIC_LIMIT != null) limits[r.CAPABILITY_KEY] = r.NUMERIC_LIMIT;
  }
  const now = Date.now();
  for (const o of ov || []) {
    if (o.EXPIRES_AT && new Date(o.EXPIRES_AT).getTime() < now) continue;
    if (o.MODE === "grant") {
      caps.add(o.CAPABILITY_KEY);
      if (o.NUMERIC_LIMIT != null) limits[o.CAPABILITY_KEY] = o.NUMERIC_LIMIT;
    } else {
      caps.delete(o.CAPABILITY_KEY);
      delete limits[o.CAPABILITY_KEY];
    }
  }

  res.json({
    unrestricted: false,
    plan_id: lic.PLAN_ID, plan_version: lic.PLAN_VERSION, state: lic.STATE,
    capabilities: [...caps].sort(), limits, overrides: ov || [],
    missing: registry.allCapabilityKeys().filter((k) => !caps.has(k)).sort(),
  });
});

// Overrides eines Tenants auflisten
router.get("/tenants/:id/overrides", async (req, res) => {
  const tenantId = intParam(req.params.id);
  if (!tenantId) return res.status(400).json({ error: "Ungültige Tenant-ID." });
  const { data, error } = await supabase
    .from("TENANT_ENTITLEMENT_OVERRIDE")
    .select("ID, CAPABILITY_KEY, MODE, NUMERIC_LIMIT, REASON, EXPIRES_AT, CREATED_AT, CREATED_BY")
    .eq("TENANT_ID", tenantId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ overrides: data || [] });
});

// Override entfernen
router.delete("/tenants/:id/overrides/:capKey", async (req, res) => {
  const tenantId = intParam(req.params.id);
  if (!tenantId) return res.status(400).json({ error: "Ungültige Tenant-ID." });
  const capKey = req.params.capKey;
  const { data, error } = await supabase
    .from("TENANT_ENTITLEMENT_OVERRIDE")
    .delete()
    .eq("TENANT_ID", tenantId)
    .eq("CAPABILITY_KEY", capKey)
    .select("ID, CAPABILITY_KEY, MODE, NUMERIC_LIMIT, REASON");
  if (error) return res.status(400).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: "Ausnahme nicht gefunden." });
  await writeChangeLog({
    actor: req.adminEmail, entity: "TENANT_ENTITLEMENT_OVERRIDE",
    entityRef: `${tenantId}:${capKey}`, action: "delete", before: data[0], req,
  });
  res.json({ ok: true });
});

// Per-Tenant-Override (Add-On / Sonderdeal): grant oder revoke
router.post("/tenants/:id/overrides", async (req, res) => {
  const tenantId = intParam(req.params.id);
  if (!tenantId) return res.status(400).json({ error: "Ungültige Tenant-ID." });
  const { capability_key, mode, numeric_limit, reason, expires_at } = req.body || {};
  if (!capability_key || !["grant", "revoke"].includes(mode)) {
    return res.status(400).json({ error: "capability_key und mode (grant|revoke) erforderlich." });
  }
  if (!registry.getCapability(capability_key)) {
    return res.status(400).json({ error: `Unbekannte Capability: ${capability_key}` });
  }
  const { data: tenant } = await supabase.from("TENANTS").select("ID, TENANT").eq("ID", tenantId).maybeSingle();
  if (!tenant) return res.status(404).json({ error: "Unbekannter Mandant." });

  const { data: before } = await supabase.from("TENANT_ENTITLEMENT_OVERRIDE")
    .select("*").eq("TENANT_ID", tenantId).eq("CAPABILITY_KEY", capability_key).maybeSingle();

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
    entityRef: `${tenantId}:${capability_key}`, action: before ? "update" : "create", before, after: data,
    context: { tenant_name: tenant.TENANT, capability_label: registry.getCapability(capability_key)?.labelDe }, req,
  });
  res.json({ override: data });
});

module.exports = router;
