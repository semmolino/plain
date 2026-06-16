"use strict";

/**
 * License-Middleware (Phase L2 — Soft-Enforcement)
 *
 * Laedt fuer jeden authentifizierten Request das effektive Entitlement des
 * Tenants und legt es an req.license ab. KEIN hartes Enforcement in L2:
 * - licenseMiddleware setzt req.license + req.hasFeature(key)
 * - requireFeature() existiert bereits (402), wird aber in L2 noch NICHT
 *   auf Routen angewendet — das ist L3.
 *
 * Soft-Fail wie bei den Permissions: fehlt die Lizenz-Migration (0070) oder gibt
 * es (noch) keine TENANT_LICENSE-Zeile, gilt der Tenant als "unrestricted"
 * (alles erlaubt) -> keine Verhaltensaenderung.
 *
 * Effektive Capabilities = Plan-Capabilities ∪ Override(grant) − Override(revoke).
 */

const TTL_MS = 60_000;
const cache = new Map(); // tenantId -> { exp:number, ent: Entitlement|null }
let capPermCache = { exp: 0, map: null }; // global: permKey -> Set<capKey>

function isSchemaMissing(err) {
  return err && /relation .* does not exist|column .* does not exist/i.test(err.message || "");
}

/**
 * Reine Berechnung des Entitlements (ohne DB) — testbar.
 * @param {{planCapabilities:{key:string,limit:number|null}[], overrides:{key:string,mode:'grant'|'revoke',limit:number|null,expiresAtMs:number|null}[], nowMs:number}} input
 * @returns {{capabilities:Set<string>, limits:Map<string,number>}}
 */
function computeEntitlement({ planCapabilities = [], overrides = [], nowMs = Date.now() }) {
  const capabilities = new Set();
  const limits = new Map();
  for (const c of planCapabilities) {
    capabilities.add(c.key);
    if (c.limit != null) limits.set(c.key, c.limit);
  }
  for (const o of overrides) {
    if (o.expiresAtMs != null && o.expiresAtMs < nowMs) continue; // abgelaufen
    if (o.mode === "grant") {
      capabilities.add(o.key);
      if (o.limit != null) limits.set(o.key, o.limit);
    } else if (o.mode === "revoke") {
      capabilities.delete(o.key);
      limits.delete(o.key);
    }
  }
  return { capabilities, limits };
}

/** Laedt das Entitlement eines Tenants aus der DB. null = Soft-Fail/unrestricted. */
async function loadEntitlement(supabase, tenantId) {
  if (!tenantId) return null;
  try {
    const { data: lic, error: e1 } = await supabase
      .from("TENANT_LICENSE")
      .select("PLAN_ID, STATE")
      .eq("TENANT_ID", tenantId)
      .maybeSingle();
    if (e1) { if (isSchemaMissing(e1)) return null; throw e1; }
    if (!lic) return null; // keine Lizenz-Zeile -> unrestricted (Soft-Fail)

    const { data: pc, error: e2 } = await supabase
      .from("PLAN_CAPABILITY")
      .select("CAPABILITY_KEY, NUMERIC_LIMIT")
      .eq("PLAN_ID", lic.PLAN_ID);
    if (e2) { if (isSchemaMissing(e2)) return null; throw e2; }

    const { data: ov, error: e3 } = await supabase
      .from("TENANT_ENTITLEMENT_OVERRIDE")
      .select("CAPABILITY_KEY, MODE, NUMERIC_LIMIT, EXPIRES_AT")
      .eq("TENANT_ID", tenantId);
    if (e3) { if (isSchemaMissing(e3)) return null; throw e3; }

    const { capabilities, limits } = computeEntitlement({
      planCapabilities: (pc || []).map((r) => ({ key: r.CAPABILITY_KEY, limit: r.NUMERIC_LIMIT })),
      overrides: (ov || []).map((r) => ({
        key: r.CAPABILITY_KEY,
        mode: r.MODE,
        limit: r.NUMERIC_LIMIT,
        expiresAtMs: r.EXPIRES_AT ? new Date(r.EXPIRES_AT).getTime() : null,
      })),
      nowMs: Date.now(),
    });

    return { unrestricted: false, planId: lic.PLAN_ID, state: lic.STATE, capabilities, limits };
  } catch (e) {
    console.warn("[license] load failed:", e?.message);
    return null; // Soft-Fail: kein Enforcement bei Lade-Fehler
  }
}

/** Cache leeren (fuer spaetere Bump-on-Change durch die Owner-Konsole). */
function clearLicenseCache(tenantId) {
  if (tenantId == null) cache.clear();
  else cache.delete(tenantId);
  capPermCache = { exp: 0, map: null };
}

/**
 * Lädt CAPABILITY_PERMISSION (global, TTL-Cache) -> Map<permKey, Set<capKey>>.
 * Soft-Fail: bei Fehler/Schema-Mangel leere Map (= keine Suppression).
 */
async function loadPermissionCapabilityMap(supabase) {
  const now = Date.now();
  if (capPermCache.map && capPermCache.exp > now) return capPermCache.map;
  try {
    const { data, error } = await supabase
      .from("CAPABILITY_PERMISSION").select("CAPABILITY_KEY, PERMISSION_KEY");
    if (error) {
      if (isSchemaMissing(error)) { capPermCache = { exp: now + TTL_MS, map: new Map() }; return capPermCache.map; }
      throw error;
    }
    const map = new Map();
    for (const r of data || []) {
      if (!map.has(r.PERMISSION_KEY)) map.set(r.PERMISSION_KEY, new Set());
      map.get(r.PERMISSION_KEY).add(r.CAPABILITY_KEY);
    }
    capPermCache = { exp: now + TTL_MS, map };
    return map;
  } catch (e) {
    console.warn("[license] capPerm load failed:", e?.message);
    return new Map(); // fail-open: keine Suppression
  }
}

/**
 * Reine Funktion (testbar): entfernt Permissions, deren ALLE zugeordneten
 * Capabilities NICHT lizenziert sind. Permissions ohne Capability-Zuordnung
 * bleiben immer erhalten (rein RBAC-gesteuert).
 * @param {Set<string>} permKeys @param {Set<string>} licensedCaps @param {Map<string,Set<string>>} permToCaps
 * @returns {Set<string>}
 */
function suppressUnlicensed(permKeys, licensedCaps, permToCaps) {
  const out = new Set();
  for (const p of permKeys) {
    const caps = permToCaps.get(p);
    if (!caps || caps.size === 0) { out.add(p); continue; }
    let licensed = false;
    for (const c of caps) { if (licensedCaps.has(c)) { licensed = true; break; } }
    if (licensed) out.add(p);
  }
  return out;
}

function makeMiddleware(supabase) {
  return async function licenseMiddleware(req, res, next) {
    const tid = req.tenantId;
    const now = Date.now();
    let cached = cache.get(tid);
    if (!cached || cached.exp < now) {
      const ent = await loadEntitlement(supabase, tid);
      cached = { exp: now + TTL_MS, ent };
      cache.set(tid, cached);
    }
    const ent = cached.ent;
    req._licenseUnrestricted = ent === null;
    req.license = ent || { unrestricted: true, planId: null, state: null, capabilities: new Set(), limits: new Map() };
    req.hasFeature = (key) => req._licenseUnrestricted || req.license.capabilities.has(key);
    next();
  };
}

/** Route-Guard fuer L3: 402 falls Capability nicht lizenziert. (In L2 noch ungenutzt.) */
function requireFeature(...keys) {
  const flat = keys.flat();
  return (req, res, next) => {
    if (req._licenseUnrestricted) return next();
    for (const k of flat) {
      if (!req.license.capabilities.has(k)) {
        return res.status(402).json({ error: "Feature nicht in deiner Lizenz enthalten", feature: k });
      }
    }
    next();
  };
}

module.exports = {
  makeMiddleware, requireFeature, computeEntitlement, loadEntitlement, clearLicenseCache,
  loadPermissionCapabilityMap, suppressUnlicensed,
};
