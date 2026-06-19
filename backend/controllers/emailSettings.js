"use strict";

const svc          = require("../services/emailSettingsService");
const { sendMail } = require("../services/emailService");

async function get(req, res, supabase) {
  try {
    const data = await svc.getSettingsForApi(supabase, { tenantId: req.tenantId });
    return res.json(data);
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function save(req, res, supabase) {
  try {
    const data = await svc.saveSettings(supabase, { tenantId: req.tenantId, body: req.body });
    return res.json(data);
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

// POST /email-settings/test — sendet eine Testnachricht ueber die GESPEICHERTE
// Tenant-Konfiguration (ENABLED egal), damit vor dem Aktivieren geprueft werden kann.
async function test(req, res, supabase) {
  try {
    const to = (req.body?.to || "").trim();
    if (!to) return res.status(400).json({ error: "Empfaenger-Adresse (to) erforderlich" });
    await sendMail({
      supabase,
      tenantId:      req.tenantId,
      requireTenant: true,
      to,
      subject: "PlaIn — SMTP-Testnachricht",
      text:    "Diese Testnachricht bestaetigt, dass deine SMTP-Einstellungen in PlaIn funktionieren.",
      html:    "<p>Diese Testnachricht bestätigt, dass deine SMTP-Einstellungen in PlaIn funktionieren.</p>",
    });
    return res.json({ sent: true });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

module.exports = { get, save, test };
