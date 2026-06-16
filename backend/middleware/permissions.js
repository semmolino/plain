"use strict";

/**
 * Permissions-Middleware (Phase 0 — Foundation)
 *
 * Laedt fuer jeden authentifizierten Request die Permission-Keys des Users
 * und legt sie an req.permissions ab (Set<string>).
 *
 * Verbrauch:
 *   - permissionsMiddleware(supabase) als Express-Middleware nach authMiddleware
 *   - requirePermission('invoices.edit') als Route-Guard
 *   - req.hasPermission('invoices.edit') als Helper im Handler
 *
 * Phase 0: Middleware ist eingebaut, aber requirePermission ist (bewusst)
 * noch nicht auf alle Routen angewendet. Wir starten mit den Admin-Routen
 * fuer Rollen-Verwaltung und rollen schrittweise aus.
 */

const ADMIN_BYPASS = false;  // KEIN System-weiter Bypass — Admin = Rolle mit allen Permissions

/** Soft-fail Loader: wenn Migration 0062 noch nicht gelaufen ist, liefere null
 *  (-> unrestricted Mode). Sonst Set aller Permission-Keys des Users.
 *
 *  Wir verwenden bewusst DREI separate Queries statt eines nested Joins,
 *  weil supabase-js die FK-Auflosung bei nicht-konventionellen Spaltennamen
 *  (ROLE_ID -> USER_ROLE) zickig macht. Drei kleine Queries sind schneller
 *  als eine kaputte. */
async function loadPermissions(supabase, employeeId) {
  if (!employeeId) return new Set();
  try {
    // 1) Welche Rollen hat der Mitarbeiter?
    const { data: ers, error: er1 } = await supabase
      .from("EMPLOYEE_ROLE")
      .select("ROLE_ID")
      .eq("EMPLOYEE_ID", employeeId);
    if (er1) {
      if (/relation .* does not exist|column .* does not exist/i.test(er1.message)) {
        return null;
      }
      throw er1;
    }
    const roleIds = [...new Set((ers || []).map(r => r.ROLE_ID).filter(Boolean))];
    if (roleIds.length === 0) return new Set();

    // 2) Welche Permission-IDs haengen an diesen Rollen?
    const { data: rps, error: er2 } = await supabase
      .from("ROLE_PERMISSION")
      .select("PERMISSION_ID")
      .in("ROLE_ID", roleIds);
    if (er2) {
      if (/relation .* does not exist|column .* does not exist/i.test(er2.message)) {
        return null;
      }
      throw er2;
    }
    const permIds = [...new Set((rps || []).map(r => r.PERMISSION_ID).filter(Boolean))];
    if (permIds.length === 0) return new Set();

    // 3) Permission-Keys auflesen
    const { data: perms, error: er3 } = await supabase
      .from("PERMISSION")
      .select("KEY")
      .in("ID", permIds);
    if (er3) {
      if (/relation .* does not exist|column .* does not exist/i.test(er3.message)) {
        return null;
      }
      throw er3;
    }
    const keys = new Set((perms || []).map(p => p.KEY).filter(Boolean));
    return keys;
  } catch (e) {
    console.warn("[permissions] load failed:", e?.message);
    return null;  // soft-fail: kein Enforcement bei Lade-Fehler
  }
}

const { loadPermissionCapabilityMap, suppressUnlicensed } = require("./license");

function makeMiddleware(supabase) {
  return async function permissionsMiddleware(req, res, next) {
    let set = await loadPermissions(supabase, req.employeeId);
    // Wenn null: Migration fehlt oder Loader scheiterte → wir markieren als "unrestricted"
    req._permissionsUnrestricted = (set === null);
    // Lizenz-Engine (L3): Rechte unlizenzierter Capabilities aus dem effektiven Set
    // entfernen. req.license stammt aus licenseMiddleware (laeuft DAVOR). Bei
    // unrestricted (Soft-Fail / keine Lizenz-Migration / Plan 'full') -> keine
    // Aenderung. Wirkt auf Frontend (Can/Tabs via /permissions/me) UND Backend
    // (requirePermission) gleichermassen.
    if (set && req.license && !req._licenseUnrestricted) {
      const map = await loadPermissionCapabilityMap(supabase);
      set = suppressUnlicensed(set, req.license.capabilities, map);
    }
    req.permissions = set || new Set();
    req.hasPermission = (key) => req._permissionsUnrestricted || req.permissions.has(key);
    next();
  };
}

/** Route-Guard: 403 falls Permission fehlt. Akzeptiert string ODER array (alle muessen vorhanden sein). */
function requirePermission(...keys) {
  const flat = keys.flat();
  return (req, res, next) => {
    if (req._permissionsUnrestricted) return next();  // Foundation-Phase / Soft-Fail
    if (ADMIN_BYPASS && req.permissions.has('*')) return next();
    for (const k of flat) {
      if (!req.permissions.has(k)) {
        return res.status(403).json({ error: `Fehlende Berechtigung: ${k}` });
      }
    }
    next();
  };
}

/** Route-Guard: 403 falls KEINE der Keys vorhanden ist (OR-Logik). */
function requireAnyPermission(...keys) {
  const flat = keys.flat();
  return (req, res, next) => {
    if (req._permissionsUnrestricted) return next();
    if (ADMIN_BYPASS && req.permissions.has('*')) return next();
    if (flat.some(k => req.permissions.has(k))) return next();
    return res.status(403).json({ error: `Fehlende Berechtigung (eine von): ${flat.join(', ')}` });
  };
}

module.exports = { makeMiddleware, requirePermission, requireAnyPermission };
