"use strict";

/**
 * Best-effort E-Mail-Benachrichtigung aus der Owner-Konsole.
 *
 * Eigener, von der Tenant-App unabhaengiger nodemailer-SMTP-Transport (Eusend
 * oder jeder andere SMTP-Anbieter). Konfiguration ueber ENV — dieselben
 * Variablennamen wie in der Tenant-App, aber ein eigener Wertesatz moeglich:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * WICHTIG: wirft NIE. Ist kein SMTP_HOST gesetzt oder schlaegt der Versand
 * fehl, wird nur geloggt — die ausloesende Aktion (Antwort speichern) bleibt
 * erfolgreich.
 */

const nodemailer = require("nodemailer");

function clean(v) {
  return v ? String(v).trim().replace(/^["']+|["']+$/g, "").trim() : "";
}

let cachedTransport = null;

function getTransport() {
  const host = clean(process.env.SMTP_HOST);
  if (!host) return null;
  if (cachedTransport) return cachedTransport;
  const user = clean(process.env.SMTP_USER);
  cachedTransport = nodemailer.createTransport({
    host,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth:   user ? { user, pass: clean(process.env.SMTP_PASS) } : undefined,
    connectionTimeout: 15000,
    greetingTimeout:   10000,
    socketTimeout:     20000,
  });
  return cachedTransport;
}

/** @returns {Promise<{ sent: boolean, reason?: string }>} */
async function notify({ to, subject, html, text, replyTo }) {
  const transport = getTransport();
  const from = clean(process.env.SMTP_FROM) || clean(process.env.SMTP_USER);
  if (!transport || !from) {
    console.info("[notify] übersprungen — SMTP_HOST/SMTP_FROM nicht gesetzt.");
    return { sent: false, reason: "not_configured" };
  }
  if (!to) return { sent: false, reason: "no_recipient" };
  try {
    await transport.sendMail({ from, to, subject, html: html || text, text, replyTo });
    return { sent: true };
  } catch (e) {
    console.warn("[notify] Versand fehlgeschlagen:", e?.message || e);
    return { sent: false, reason: "error" };
  }
}

module.exports = { notify };
