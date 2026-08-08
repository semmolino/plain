"use strict";

/**
 * Plattform-weite SMTP-Konfiguration (globaler Mailversand der Tenant-App).
 * Verwaltet ueber die Owner-Konsole, gespeichert in PLATFORM_EMAIL_SETTINGS
 * (Migration 0112) — genau eine Zeile (ID=1). Das Passwort ist AES-256-GCM-
 * verschluesselt (siehe ./platformCrypto).
 *
 * backend/services/platformEmailSettings.js liest dieselbe Tabelle direkt
 * (read-only, eigener Supabase-Client, eigenes PLATFORM_ENC_KEY-ENV) — kein
 * HTTP-Aufruf zwischen den beiden Diensten noetig, beide sprechen dieselbe
 * Supabase-DB.
 */

const nodemailer = require("nodemailer");
const dns = require("dns").promises;
const net = require("net");
const { supabase } = require("./db");
const platformCrypto = require("./platformCrypto");

const ROW_ID = 1;

async function loadRow() {
  const { data, error } = await supabase
    .from("PLATFORM_EMAIL_SETTINGS")
    .select("*")
    .eq("ID", ROW_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

/** Sichere Repraesentation fuers Settings-UI (OHNE Passwort). */
async function getSettings() {
  const row = await loadRow();
  return {
    smtp_host:            row?.SMTP_HOST || "",
    smtp_port:            row?.SMTP_PORT ?? 465,
    smtp_secure:          row?.SMTP_SECURE ?? true,
    smtp_user:            row?.SMTP_USER || "",
    smtp_from:            row?.SMTP_FROM || "",
    from_name:            row?.FROM_NAME || "",
    pass_set:             !!(row && row.SMTP_PASS_ENC),
    encryption_available: platformCrypto.isConfigured(),
  };
}

/**
 * Speichert (update) die Plattform-SMTP-Einstellungen. Body-Felder snake_case.
 * Das Passwort wird nur geaendert, wenn `smtp_pass` (nicht-leer) gesendet wird.
 */
async function saveSettings({ smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from, from_name }) {
  const host = String(smtp_host || "").trim();
  let port = parseInt(smtp_port, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) port = 465;

  const payload = {
    SMTP_HOST:   host || null,
    SMTP_PORT:   port,
    SMTP_SECURE: !!smtp_secure,
    SMTP_USER:   String(smtp_user || "").trim() || null,
    SMTP_FROM:   String(smtp_from || "").trim() || null,
    FROM_NAME:   String(from_name || "").trim() || null,
    UPDATED_AT:  new Date().toISOString(),
  };

  if (typeof smtp_pass === "string" && smtp_pass) {
    payload.SMTP_PASS_ENC = platformCrypto.encrypt(smtp_pass); // wirft 503, wenn PLATFORM_ENC_KEY fehlt
  }

  const { error } = await supabase.from("PLATFORM_EMAIL_SETTINGS").update(payload).eq("ID", ROW_ID);
  if (error) throw new Error(error.message);

  return getSettings();
}

async function resolveIPv4(host) {
  if (!host || net.isIP(host)) return null;
  try {
    const { address } = await dns.lookup(host, { family: 4 });
    return address || null;
  } catch {
    return null;
  }
}

/** Baut einen nodemailer-Transport + Absender aus der aktuellen DB-Konfiguration. */
async function buildTransport() {
  const row = await loadRow();
  if (!row || !row.SMTP_HOST) {
    throw { status: 400, message: "Keine SMTP-Konfiguration gespeichert. Bitte zuerst Host (und ggf. Zugangsdaten) speichern." };
  }
  const pass = row.SMTP_PASS_ENC ? platformCrypto.decrypt(row.SMTP_PASS_ENC) : undefined;
  const ipv4 = await resolveIPv4(row.SMTP_HOST);
  const fromAddress = row.SMTP_FROM || row.SMTP_USER;
  return {
    transport: nodemailer.createTransport({
      host:       ipv4 || row.SMTP_HOST,
      port:       Number(row.SMTP_PORT) || 465,
      secure:     !!row.SMTP_SECURE,
      servername: ipv4 ? row.SMTP_HOST : undefined,
      auth:       row.SMTP_USER ? { user: row.SMTP_USER, pass } : undefined,
      connectionTimeout: 15000,
      greetingTimeout:   10000,
      socketTimeout:     20000,
    }),
    from: row.FROM_NAME && fromAddress ? `"${row.FROM_NAME}" <${fromAddress}>` : fromAddress,
  };
}

/** Sendet eine Testmail ueber die gespeicherte Konfiguration. */
async function testConnection(to) {
  const { transport, from } = await buildTransport();
  if (!from) throw { status: 400, message: "Keine Absenderadresse hinterlegt." };
  await transport.sendMail({
    from,
    to,
    subject: "plan&simple — Owner-Konsole Test-E-Mail",
    text: "Diese Testnachricht bestätigt, dass die zentrale SMTP-Konfiguration funktioniert.",
    html: "<p>Diese Testnachricht bestätigt, dass die zentrale SMTP-Konfiguration funktioniert.</p>",
  });
}

module.exports = { getSettings, saveSettings, testConnection };
