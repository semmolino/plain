"use strict";

/**
 * Mengenlimit-Durchsetzung (Hard-Limit) für metered Capabilities.
 *
 * Ablauf: req.license.limits (aus licenseMiddleware) trägt die Plan-Grenze je
 * metered Capability. Am Anlege-Punkt einer zählbaren Ressource wird der
 * IST-Bestand des Tenants gezählt und gegen die Grenze geprüft.
 *
 * Politik (mit dem Owner abgestimmt):
 *   - HARTES Limit: bei Erreichen wird das Neuanlegen mit 402 geblockt.
 *   - Bestand wird NIE rückwirkend entfernt: ein bereits über der (später
 *     gesenkten) Grenze liegender Tenant kann nur nichts Neues anlegen, bis er
 *     wieder darunter liegt.
 *   - null / unrestricted = unbegrenzt (kein Block).
 *
 * Die Zählfunktionen sind hier zentral registriert; `isOverLimit` ist pur und
 * testbar (backend/tests/license_limits.test.js).
 */

/** Registry: Capability-Key -> async (supabase, tenantId) => aktueller IST-Wert. */
const COUNTERS = {
  "limits.employees": async (supabase, tenantId) => {
    const { count, error } = await supabase
      .from("EMPLOYEE")
      .select("ID", { count: "exact", head: true })
      .eq("TENANT_ID", tenantId)
      .eq("ACTIVE", 1);
    if (error) throw error;
    return count || 0;
  },
  // Weitere metered Capabilities anschließen, sobald die Zähldefinition
  // feststeht (limits.projects_active: „aktive" Projekte je PROJECT_STATUS;
  // limits.storage_mb: Summe der Upload-Größen). Absichtlich noch nicht
  // verdrahtet — ohne saubere Definition würde falsch gezählt.
};

/** Anzeige-Metadaten (Label/Einheit) je Limit — für /license/usage. */
const LIMIT_META = {
  "limits.employees": { label: "Mitarbeiter", unit: "Mitarbeiter" },
  "limits.projects_active": { label: "Aktive Projekte", unit: "aktive Projekte" },
  "limits.storage_mb": { label: "Speicherplatz", unit: "MB" },
};

/** Pur & testbar: blockiert das Anlegen? (>= Grenze). limit==null => unbegrenzt. */
function isOverLimit(used, limit) {
  if (limit == null) return false;
  return used >= limit;
}

/** Effektive Grenze eines Tenants für eine Capability (null = unbegrenzt). */
function limitFor(req, capKey) {
  if (req._licenseUnrestricted) return null;
  const lim = req.license && req.license.limits;
  if (!lim) return null;
  const v = lim.get ? lim.get(capKey) : lim[capKey];
  return v == null ? null : v;
}

/**
 * Route-Guard: prüft VOR dem Anlegen, ob das Limit erreicht ist.
 * Nur wirksam, wenn im Plan eine Grenze gesetzt ist — sonst No-Op (wie bisher).
 */
function enforceLimit(supabase, capKey) {
  const counter = COUNTERS[capKey];
  return async function limitGuard(req, res, next) {
    try {
      const limit = limitFor(req, capKey);
      if (limit == null || !counter) return next(); // unbegrenzt / (noch) nicht zählbar
      const used = await counter(supabase, req.tenantId);
      if (isOverLimit(used, limit)) {
        const meta = LIMIT_META[capKey] || {};
        return res.status(402).json({
          error: `Limit erreicht: ${limit} ${meta.unit || ""}`.trim() + ". Für mehr bitte den Tarif erweitern.",
          limit_reached: true,
          capability: capKey,
          limit,
          used,
        });
      }
      next();
    } catch (e) {
      // Soft-Fail: ein Zählfehler darf legitime Anlage nicht blockieren.
      console.warn("[limits] check failed:", e?.message || e);
      next();
    }
  };
}

/** Aktuelle Nutzung aller (zählbaren) metered Capabilities des Tenants. */
async function getUsage(supabase, req) {
  const out = [];
  for (const [capKey, meta] of Object.entries(LIMIT_META)) {
    const limit = limitFor(req, capKey);
    const counter = COUNTERS[capKey];
    if (!counter) continue; // nur verdrahtete Zähler ausweisen
    let used = 0;
    try {
      used = await counter(supabase, req.tenantId);
    } catch (e) {
      console.warn("[limits] usage count failed:", capKey, e?.message);
      continue;
    }
    out.push({ key: capKey, label: meta.label, unit: meta.unit, used, limit });
  }
  return out;
}

module.exports = { enforceLimit, getUsage, isOverLimit, COUNTERS, LIMIT_META };
