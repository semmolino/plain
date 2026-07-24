"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { authenticator } = require("otplib");
const { supabase } = require("../services/db");
const { issueConsoleToken, consoleAuth } = require("../middleware/consoleAuth");
const { loginLimiter } = require("../middleware/rateLimit");
const { writeChangeLog } = require("../services/audit");

const router = express.Router();

// ── Login: Passwort + (falls hinterlegt) TOTP-2FA ────────────────────────────
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password, totp } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "E-Mail und Passwort erforderlich." });

  const { data: admin, error } = await supabase
    .from("PLATFORM_ADMIN")
    .select("ID, EMAIL, PASSWORD_HASH, TOTP_SECRET, IS_ACTIVE")
    .ilike("EMAIL", String(email).trim())
    .maybeSingle();

  // Einheitliche Fehlermeldung -> keine Account-Enumeration.
  // Jeder Fehlversuch wird protokolliert: die Konsole steuert alle Mandanten,
  // Anmeldeversuche sind hier sicherheitsrelevant.
  const attempted = String(email).trim();
  const denyReason = async (reason) => {
    await writeChangeLog({
      actor: attempted, entity: "CONSOLE_AUTH", entityRef: attempted,
      action: "login_failed", context: { reason }, req,
    });
    return res.status(401).json({ error: "Anmeldung fehlgeschlagen." });
  };
  if (error || !admin) return denyReason("unbekannt");
  if (!admin.IS_ACTIVE) return denyReason("deaktiviert");

  const okPw = await bcrypt.compare(password, admin.PASSWORD_HASH || "");
  if (!okPw) return denyReason("falsches Passwort");

  // 2FA: wenn ein TOTP-Secret hinterlegt ist, ist der Code Pflicht.
  if (admin.TOTP_SECRET) {
    if (!totp) return res.status(401).json({ error: "2FA-Code erforderlich.", totp_required: true });
    const okTotp = authenticator.verify({ token: String(totp), secret: admin.TOTP_SECRET });
    if (!okTotp) return denyReason("falscher 2FA-Code");
  }

  await supabase.from("PLATFORM_ADMIN").update({ LAST_LOGIN_AT: new Date().toISOString() }).eq("ID", admin.ID);
  await writeChangeLog({
    actor: admin.EMAIL, entity: "CONSOLE_AUTH", entityRef: admin.EMAIL, action: "login",
    context: { two_factor: !!admin.TOTP_SECRET }, req,
  });
  return res.json({ token: issueConsoleToken(admin), email: admin.EMAIL, two_factor: !!admin.TOTP_SECRET });
});

// ── Aktueller Admin ──────────────────────────────────────────────────────────
router.get("/me", consoleAuth, (req, res) => {
  res.json({ admin_id: req.adminId, email: req.adminEmail });
});

module.exports = router;
