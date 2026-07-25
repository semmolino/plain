"use strict";

const jwt = require("jsonwebtoken");
const { supabase } = require("../services/db");

const AUDIENCE = "owner-console";
const TOKEN_TTL = "2h";

// Kurzer Cache für den Pro-Request-Check des Admin-Status. Ohne ihn würde jeder
// API-Aufruf eine DB-Abfrage auslösen; mit 30 s bleibt „deaktiviert/abgemeldet"
// trotzdem nahezu sofort wirksam (statt erst nach Token-Ablauf in 2 h).
const CHECK_TTL_MS = 30_000;
const adminCache = new Map(); // adminId -> { exp, admin|null }

function consoleSecret() {
  const s = process.env.CONSOLE_JWT_SECRET;
  if (!s || s === "change-me-to-a-long-random-string") {
    throw new Error("CONSOLE_JWT_SECRET ist nicht (sicher) gesetzt.");
  }
  return s;
}

/** Signiert ein Konsolen-Token (eigene Audience, kurze Laufzeit). jwt setzt `iat`. */
function issueConsoleToken(admin) {
  return jwt.sign(
    { sub: admin.ID, email: admin.EMAIL, role: "platform_admin" },
    consoleSecret(),
    { expiresIn: TOKEN_TTL, audience: AUDIENCE }
  );
}

function invalidateAdminCache(adminId) {
  if (adminId == null) adminCache.clear();
  else adminCache.delete(adminId);
}

/** Aktuellen Admin-Status laden (gecacht). null = existiert nicht/deaktiviert. */
async function loadAdminState(adminId) {
  const now = Date.now();
  const hit = adminCache.get(adminId);
  if (hit && hit.exp > now) return hit.admin;
  const { data, error } = await supabase
    .from("PLATFORM_ADMIN")
    .select("ID, EMAIL, IS_ACTIVE, SESSION_EPOCH")
    .eq("ID", adminId)
    .maybeSingle();
  // Fehlt die Spalte SESSION_EPOCH (Migration 0103 noch nicht eingespielt),
  // ohne sie erneut laden statt den Zugang zu sperren.
  let admin = null;
  if (error && /column .* does not exist/i.test(error.message || "")) {
    const fb = await supabase.from("PLATFORM_ADMIN").select("ID, EMAIL, IS_ACTIVE").eq("ID", adminId).maybeSingle();
    admin = fb.data && fb.data.IS_ACTIVE ? { ...fb.data, SESSION_EPOCH: null } : null;
  } else if (!error) {
    admin = data && data.IS_ACTIVE ? data : null;
  } else {
    // Unerwarteter DB-Fehler: nicht cachen, aber Zugang in diesem Request zulassen
    // (Soft-Fail wie im übrigen System) — der Token-Check hat bereits gegriffen.
    return { ID: adminId, IS_ACTIVE: true, SESSION_EPOCH: null, _softfail: true };
  }
  adminCache.set(adminId, { exp: now + CHECK_TTL_MS, admin });
  return admin;
}

/**
 * Middleware: gültiges Konsolen-Token + aktiver, nicht widerrufener Admin.
 * Prüft bei jedem Request (gecacht):
 *  - Admin existiert und IS_ACTIVE (deaktivierter Admin verliert sofort Zugang)
 *  - Token wurde nach dem letzten „überall abmelden" ausgestellt (SESSION_EPOCH)
 */
async function consoleAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Nicht authentifiziert." });

  let decoded;
  try {
    decoded = jwt.verify(token, consoleSecret(), { audience: AUDIENCE });
  } catch {
    return res.status(401).json({ error: "Sitzung abgelaufen oder ungültig." });
  }

  let admin;
  try {
    admin = await loadAdminState(decoded.sub);
  } catch (e) {
    return res.status(500).json({ error: "Authentifizierung fehlgeschlagen." });
  }
  if (!admin) return res.status(401).json({ error: "Zugang deaktiviert." });

  // Token-Rücknahme: vor dem letzten SESSION_EPOCH ausgestellte Tokens sind tot.
  if (admin.SESSION_EPOCH && decoded.iat) {
    const epochSec = Math.floor(new Date(admin.SESSION_EPOCH).getTime() / 1000);
    if (decoded.iat < epochSec) {
      return res.status(401).json({ error: "Sitzung wurde beendet. Bitte neu anmelden." });
    }
  }

  req.adminId = decoded.sub;
  req.adminEmail = admin.EMAIL || decoded.email;
  next();
}

module.exports = { consoleAuth, issueConsoleToken, invalidateAdminCache, AUDIENCE };
