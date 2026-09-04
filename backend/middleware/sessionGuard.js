"use strict";

/**
 * Sitzungs-Rücknahme: macht Tokens vor ihrem Ablauf ungültig.
 *
 * WARUM (Sicherheitsaudit 2026-09-03, M4)
 *   Ein Token gilt 8 Stunden. Ohne diese Prüfung wirken Rollenentzug,
 *   Deaktivierung und Passwortwechsel erst nach Ablauf — ein ausgeschiedener
 *   Mitarbeiter arbeitet so lange weiter, und ein abgeflossenes Token bleibt
 *   einen Arbeitstag lang brauchbar.
 *
 * WO SIE HÄNGT — und warum nicht in authMiddleware
 *   Sie MUSS hinter tenantScope laufen. authMiddleware setzt req.tenantId erst
 *   selbst; davor liegt kein Mandanten-Claim an, und eine EMPLOYEE-Abfrage
 *   liefe unter RLS in den claimlosen Rückfall: null Zeilen, also "Mitarbeiter
 *   gibt es nicht" — jeder Nutzer wäre ausgesperrt. Deshalb eigene Middleware
 *   in der authChain statt einer Erweiterung von authMiddleware.
 *
 * VERFAHREN
 *   Jedes JWT trägt seinen Ausstellungszeitpunkt (iat). Ist EMPLOYEE.SESSION_EPOCH
 *   neuer, ist das Token tot. Dasselbe Verfahren nutzt die Owner-Konsole
 *   (owner-console/middleware/consoleAuth.js). "Überall abmelden" ist damit ein
 *   einziges UPDATE.
 *
 * SOFT-FAIL
 *   Fehlt die Spalte (Migration 0134 nicht eingespielt) oder scheitert die
 *   Abfrage, läuft der Request weiter. Ein Datenbankschluckauf darf keine
 *   Anmeldung kippen — die Signaturprüfung hat vorher bereits gegriffen. Ohne
 *   Migration verhält sich alles exakt wie bisher.
 */

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // employeeId -> { exp, state }

let spalteFehltGemeldet = false;

/** Zwischenspeicher für einen Mitarbeiter (oder alle) verwerfen. */
function invalidateSession(employeeId) {
  if (employeeId == null) cache.clear();
  else cache.delete(Number(employeeId));
}

/**
 * Setzt SESSION_EPOCH auf jetzt — alle bestehenden Tokens dieses Mitarbeiters
 * werden ungültig. Best-effort: schlägt es fehl (fehlende Spalte), bleibt das
 * bisherige Verhalten. Der Aufrufer soll daran nicht scheitern; ein
 * Passwortwechsel, der wegen einer fehlenden Spalte abbricht, wäre schlimmer
 * als eine Sitzung, die noch läuft.
 */
async function revokeSessions(supabase, employeeId) {
  if (!employeeId) return false;
  try {
    const { error } = await supabase
      .from("EMPLOYEE")
      .update({ SESSION_EPOCH: new Date().toISOString() })
      .eq("ID", employeeId);
    invalidateSession(employeeId);
    if (error) {
      if (!/column .* does not exist/i.test(error.message || "")) {
        console.warn("[sessionGuard] revoke fehlgeschlagen:", error.message);
      }
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[sessionGuard] revoke fehlgeschlagen:", e?.message || e);
    return false;
  }
}

async function ladeZustand(supabase, employeeId) {
  const jetzt = Date.now();
  const treffer = cache.get(employeeId);
  if (treffer && treffer.exp > jetzt) return treffer.state;

  const { data, error } = await supabase
    .from("EMPLOYEE")
    .select("ID, ACTIVE, SESSION_EPOCH")
    .eq("ID", employeeId)
    .maybeSingle();

  if (error) {
    if (/column .* does not exist/i.test(error.message || "")) {
      if (!spalteFehltGemeldet) {
        spalteFehltGemeldet = true;
        console.warn("[sessionGuard] SESSION_EPOCH fehlt — Migration 0134 nicht eingespielt. Sitzungen bleiben bis zum Ablauf gueltig.");
      }
      return null; // Soft-Fail
    }
    throw error;
  }

  // Kein Treffer heisst hier NICHT "gibt es nicht": ohne Mandanten-Claim
  // liefert RLS ebenfalls nichts. Diese Middleware laeuft zwar hinter
  // tenantScope, aber lieber durchlassen als bei einer Unstimmigkeit im
  // Datenweg alle aussperren.
  const state = data || null;
  cache.set(employeeId, { exp: jetzt + CACHE_TTL_MS, state });
  return state;
}

function makeMiddleware(supabase) {
  return async function sessionGuard(req, res, next) {
    if (!req.employeeId || !req.tokenIssuedAt) return next();

    let state;
    try {
      state = await ladeZustand(supabase, req.employeeId);
    } catch (e) {
      console.warn("[sessionGuard] Zustand nicht lesbar, lasse durch:", e?.message || e);
      return next();
    }
    if (!state) return next(); // Soft-Fail (siehe oben)

    if (state.ACTIVE === 2) {
      return res.status(403).json({ error: "Dieser Benutzer ist inaktiv. Bitte Administrator kontaktieren." });
    }

    if (state.SESSION_EPOCH) {
      const epochSek = Math.floor(new Date(state.SESSION_EPOCH).getTime() / 1000);
      if (Number.isFinite(epochSek) && req.tokenIssuedAt < epochSek) {
        return res.status(401).json({ error: "Sitzung wurde beendet. Bitte neu anmelden." });
      }
    }

    return next();
  };
}

module.exports = { makeMiddleware, revokeSessions, invalidateSession, _cache: cache };
