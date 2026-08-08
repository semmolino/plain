"use strict";

const express = require("express");
const svc = require("../services/platformEmailSettings");
const { writeChangeLog } = require("../services/audit");

const router = express.Router();

// GET /platform-email — Einstellungen ohne Passwort (nur pass_set-Flag).
router.get("/platform-email", async (_req, res) => {
  try {
    res.json(await svc.getSettings());
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
});

// PUT /platform-email — speichert. Passwort nur, wenn smtp_pass gesetzt ist.
router.put("/platform-email", async (req, res) => {
  try {
    const data = await svc.saveSettings(req.body || {});
    await writeChangeLog({
      actor: req.adminEmail,
      entity: "PLATFORM_EMAIL_SETTINGS",
      entityRef: "1",
      action: "update",
      // Passwort NIE ins Audit-Log — nur ob eins gesetzt ist.
      after: {
        smtp_host: data.smtp_host, smtp_port: data.smtp_port, smtp_secure: data.smtp_secure,
        smtp_user: data.smtp_user, smtp_from: data.smtp_from, from_name: data.from_name,
        pass_set: data.pass_set,
      },
      req,
    });
    res.json(data);
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
});

// POST /platform-email/test — Testmail an {to} senden.
router.post("/platform-email/test", async (req, res) => {
  try {
    const to = String(req.body?.to || "").trim();
    if (!to) return res.status(400).json({ error: "Empfänger-Adresse (to) erforderlich." });
    await svc.testConnection(to);
    res.json({ sent: true });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
});

module.exports = router;
