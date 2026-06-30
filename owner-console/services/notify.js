"use strict";

/**
 * Best-effort E-Mail-Benachrichtigung aus der Owner-Konsole.
 *
 * Nutzt den Resend-Transport des Haupt-Backends (HTTPS, Port 443) wieder —
 * dieselbe Konfiguration wie die Tenant-App:
 *   RESEND_API_KEY  — API-Key
 *   EMAIL_FROM      — verifizierter Absender, z. B. "plan&simple <noreply@deine-domain.de>"
 *
 * WICHTIG: wirft NIE. Ist Resend nicht konfiguriert oder schlägt der Versand
 * fehl, wird nur geloggt — die auslösende Aktion (Antwort speichern) bleibt
 * erfolgreich. So lässt sich die Funktion bauen, bevor Resend produktiv läuft.
 */

const path = require("path");
const { sendViaResend } = require(path.join(__dirname, "..", "..", "backend", "services_email_resend"));

function clean(v) {
  return v ? String(v).trim().replace(/^["']+|["']+$/g, "").trim() : "";
}

/** @returns {Promise<{ sent: boolean, reason?: string }>} */
async function notify({ to, subject, html, text, replyTo }) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  const from = clean(process.env.EMAIL_FROM);
  if (!apiKey || !from) {
    console.info("[notify] übersprungen — RESEND_API_KEY/EMAIL_FROM nicht gesetzt.");
    return { sent: false, reason: "not_configured" };
  }
  if (!to) return { sent: false, reason: "no_recipient" };
  try {
    await sendViaResend({ apiKey, from, to, subject, html: html || text, text, replyTo });
    return { sent: true };
  } catch (e) {
    console.warn("[notify] Versand fehlgeschlagen:", e?.message || e);
    return { sent: false, reason: "error" };
  }
}

module.exports = { notify };
