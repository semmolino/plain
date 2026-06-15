"use strict";

const jwt = require("jsonwebtoken");

const AUDIENCE = "owner-console";

function consoleSecret() {
  const s = process.env.CONSOLE_JWT_SECRET;
  if (!s || s === "change-me-to-a-long-random-string") {
    throw new Error("CONSOLE_JWT_SECRET ist nicht (sicher) gesetzt.");
  }
  return s;
}

/** Signiert ein Konsolen-Token (eigene Audience, kurze Laufzeit). */
function issueConsoleToken(admin) {
  return jwt.sign(
    { sub: admin.ID, email: admin.EMAIL, role: "platform_admin" },
    consoleSecret(),
    { expiresIn: "2h", audience: AUDIENCE }
  );
}

/** Middleware: nur gültige Konsolen-Tokens (eigene Audience) durchlassen. */
function consoleAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Nicht authentifiziert." });
  try {
    const decoded = jwt.verify(token, consoleSecret(), { audience: AUDIENCE });
    req.adminId = decoded.sub;
    req.adminEmail = decoded.email;
    next();
  } catch {
    return res.status(401).json({ error: "Sitzung abgelaufen oder ungültig." });
  }
}

module.exports = { consoleAuth, issueConsoleToken, AUDIENCE };
