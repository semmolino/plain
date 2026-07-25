"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { authenticator } = require("otplib");
const { supabase } = require("../services/db");
const { issueConsoleToken, consoleAuth, invalidateAdminCache } = require("../middleware/consoleAuth");
const { loginLimiter } = require("../middleware/rateLimit");
const { writeChangeLog } = require("../services/audit");

const router = express.Router();

// 2FA verpflichtend? Standard AUS, damit sich niemand aussperrt. Nach dem
// Einrichten von 2FA auf "true" setzen (Railway-Env), dann ist Login ohne
// hinterlegtes TOTP nicht mehr möglich.
const REQUIRE_TOTP = process.env.CONSOLE_REQUIRE_TOTP === "true";

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
  } else if (REQUIRE_TOTP) {
    // 2FA erzwungen, aber für diesen Admin nicht eingerichtet -> Login verweigern.
    await denyReason("2FA verpflichtend, aber nicht eingerichtet");
    return;
  }

  await supabase.from("PLATFORM_ADMIN").update({ LAST_LOGIN_AT: new Date().toISOString() }).eq("ID", admin.ID);
  await writeChangeLog({
    actor: admin.EMAIL, entity: "CONSOLE_AUTH", entityRef: admin.EMAIL, action: "login",
    context: { two_factor: !!admin.TOTP_SECRET }, req,
  });
  return res.json({ token: issueConsoleToken(admin), email: admin.EMAIL, two_factor: !!admin.TOTP_SECRET });
});

// ── Aktueller Admin + Sicherheitsstatus ──────────────────────────────────────
router.get("/me", consoleAuth, async (req, res) => {
  const { data } = await supabase
    .from("PLATFORM_ADMIN").select("TOTP_SECRET, LAST_LOGIN_AT").eq("ID", req.adminId).maybeSingle();
  res.json({
    admin_id: req.adminId,
    email: req.adminEmail,
    totp_enabled: !!(data && data.TOTP_SECRET),
    require_totp: REQUIRE_TOTP,
    last_login_at: data?.LAST_LOGIN_AT ?? null,
  });
});

// ── 2FA einrichten: Schritt 1 — Secret erzeugen (noch nicht aktiv) ───────────
router.post("/totp/setup", consoleAuth, async (req, res) => {
  const secret = authenticator.generateSecret();
  const { error } = await supabase
    .from("PLATFORM_ADMIN").update({ TOTP_PENDING_SECRET: secret }).eq("ID", req.adminId);
  if (error) return res.status(500).json({ error: error.message });
  const otpauth = authenticator.keyuri(req.adminEmail, "plan&simple Owner-Konsole", secret);
  res.json({ secret, otpauth });
});

// ── 2FA einrichten: Schritt 2 — mit erstem gültigen Code bestätigen ──────────
router.post("/totp/confirm", consoleAuth, async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: "Code erforderlich." });
  const { data: admin } = await supabase
    .from("PLATFORM_ADMIN").select("TOTP_PENDING_SECRET").eq("ID", req.adminId).maybeSingle();
  if (!admin?.TOTP_PENDING_SECRET) return res.status(400).json({ error: "Keine Einrichtung offen. Bitte neu starten." });
  if (!authenticator.verify({ token: String(code), secret: admin.TOTP_PENDING_SECRET })) {
    return res.status(400).json({ error: "Code ungültig. Bitte erneut versuchen." });
  }
  // Aktivieren + alle bestehenden Sitzungen beenden (SESSION_EPOCH hochsetzen).
  const { error } = await supabase.from("PLATFORM_ADMIN").update({
    TOTP_SECRET: admin.TOTP_PENDING_SECRET, TOTP_PENDING_SECRET: null, SESSION_EPOCH: new Date().toISOString(),
  }).eq("ID", req.adminId);
  if (error) return res.status(500).json({ error: error.message });
  invalidateAdminCache(req.adminId);
  await writeChangeLog({ actor: req.adminEmail, entity: "CONSOLE_AUTH", entityRef: req.adminEmail, action: "update", context: { two_factor: "aktiviert" }, req });
  res.json({ ok: true });
});

// ── 2FA deaktivieren (nur mit gültigem Code; nicht wenn erzwungen) ───────────
router.post("/totp/disable", consoleAuth, async (req, res) => {
  if (REQUIRE_TOTP) return res.status(403).json({ error: "2FA ist verpflichtend und kann nicht deaktiviert werden." });
  const { code } = req.body || {};
  const { data: admin } = await supabase
    .from("PLATFORM_ADMIN").select("TOTP_SECRET").eq("ID", req.adminId).maybeSingle();
  if (!admin?.TOTP_SECRET) return res.status(400).json({ error: "2FA ist nicht aktiv." });
  if (!code || !authenticator.verify({ token: String(code), secret: admin.TOTP_SECRET })) {
    return res.status(400).json({ error: "Gültiger 2FA-Code erforderlich, um 2FA zu deaktivieren." });
  }
  const { error } = await supabase.from("PLATFORM_ADMIN")
    .update({ TOTP_SECRET: null, TOTP_PENDING_SECRET: null }).eq("ID", req.adminId);
  if (error) return res.status(500).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "CONSOLE_AUTH", entityRef: req.adminEmail, action: "update", context: { two_factor: "deaktiviert" }, req });
  res.json({ ok: true });
});

// ── Überall abmelden: alle Tokens dieses Admins sofort ungültig machen ───────
router.post("/logout-all", consoleAuth, async (req, res) => {
  const { error } = await supabase
    .from("PLATFORM_ADMIN").update({ SESSION_EPOCH: new Date().toISOString() }).eq("ID", req.adminId);
  if (error) return res.status(500).json({ error: error.message });
  invalidateAdminCache(req.adminId);
  await writeChangeLog({ actor: req.adminEmail, entity: "CONSOLE_AUTH", entityRef: req.adminEmail, action: "update", context: { session: "überall abgemeldet" }, req });
  res.json({ ok: true });
});

module.exports = router;
