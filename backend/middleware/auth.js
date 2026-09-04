const jwt = require("jsonwebtoken");

/**
 * Prueft ein Token als SITZUNG.
 *
 * Der Zweck-Anspruch entscheidet: Spezial-Token (Passwort-Reset mit
 * purpose:"reset", Einladungen) duerfen keine Sitzung sein. Sonst wirkt ein
 * abgefangener Reset-Link wie eine Anmeldung.
 *
 * WARUM ALS EIGENE FUNKTION: Die Regel stand nur in der Middleware. Die
 * Endpunkte /auth/me und /auth/me/password liegen aber am oeffentlichen
 * Router — sie laufen an der Middleware vorbei und riefen jwt.verify selbst
 * auf, ohne den Zweck zu pruefen (Sicherheitsaudit 2026-09-03, M2). Eine
 * zweite Formulierung derselben Regel waere genau der Weg, auf dem beide
 * wieder auseinanderlaufen.
 *
 * @throws {Error} bei ungueltiger Signatur, Ablauf oder falschem Zweck
 */
function verifySessionToken(token, secret = process.env.JWT_SECRET) {
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  const decoded = jwt.verify(token, secret);
  if (decoded.purpose) {
    const err = new Error("Ungültiges Token für diese Anfrage.");
    err.code = "WRONG_PURPOSE";
    throw err;
  }
  return decoded;
}

/** "Bearer <token>" -> "<token>"; leerer String, wenn nichts brauchbar ist. */
function bearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
}

module.exports = (_supabase) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required");

  return function authMiddleware(req, res, next) {
    const token = bearerToken(req);

    if (!token) {
      return res.status(401).json({ error: "Nicht authentifiziert" });
    }

    let decoded;
    try {
      decoded = verifySessionToken(token, secret);
    } catch (e) {
      if (e?.code === "WRONG_PURPOSE") {
        return res.status(401).json({ error: "Ungültiges Token für diese Anfrage." });
      }
      return res.status(401).json({ error: "Sitzung abgelaufen oder ungültig. Bitte neu anmelden." });
    }

    req.userId     = decoded.employee_id;
    req.employeeId = decoded.employee_id;
    req.tenantId   = decoded.tenant_id;
    // Ausstellungszeitpunkt fuer die Sitzungs-Ruecknahme (middleware/sessionGuard.js).
    // Sie kann das Token nicht selbst pruefen, weil sie hinter tenantScope
    // laufen muss — hier ist der einzige Ort, an dem die Claims vorliegen.
    req.tokenIssuedAt = decoded.iat ?? null;
    next();
  };
};

module.exports.verifySessionToken = verifySessionToken;
module.exports.bearerToken = bearerToken;
