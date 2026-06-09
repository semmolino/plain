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

/** Soft-fail Loader: wenn Migration 0062 noch nicht gelaufen ist, liefere leeren Set. */
async function loadPermissions(supabase, employeeId) {
  if (!employeeId) return new Set();
  try {
    const { data, error } = await supabase
      .from("EMPLOYEE_ROLE")
      .select(`
        ROLE_ID,
        USER_ROLE!inner ( ID,
          ROLE_PERMISSION ( PERMISSION_ID, PERMISSION!inner ( KEY ) )
        )
      `)
      .eq("EMPLOYEE_ID", employeeId);
    if (error) {
      if (/relation .* does not exist|column .* does not exist/i.test(error.message)) {
        // Migration noch nicht durch — Foundation-Phase erlaubt vollen Zugriff
        return null;
      }
      throw error;
    }
    const keys = new Set();
    for (const row of data || []) {
      const rps = row.USER_ROLE?.ROLE_PERMISSION || [];
      for (const rp of rps) {
        const k = rp.PERMISSION?.KEY;
        if (k) keys.add(k);
      }
    }
    return keys;
  } catch (e) {
    console.warn("[permissions] load failed:", e?.message);
    return null;  // soft-fail: kein Enforcement bei Lade-Fehler
  }
}

function makeMiddleware(supabase) {
  return async function permissionsMiddleware(req, res, next) {
    const set = await loadPermissions(supabase, req.employeeId);
    // Wenn null: Migration fehlt oder Loader scheiterte → wir markieren als "unrestricted"
    req._permissionsUnrestricted = (set === null);
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
