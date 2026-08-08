/**
 * Shared email service.
 *
 * SMTP-Verbindung + Standard-Absender kommen aus der zentralen, ueber die
 * Owner-Konsole verwalteten Plattform-Konfiguration (PLATFORM_EMAIL_SETTINGS,
 * Migration 0112, Passwort AES-256-GCM-verschluesselt via PLATFORM_ENC_KEY) —
 * mit den globalen SMTP_*-ENV-Variablen als Fallback, falls dort nichts
 * hinterlegt ist (siehe platformEmailSettings.js).
 *
 * Mandanten koennen NUR ihre Absenderidentitaet ueberschreiben
 * (smtp_from/from_name/reply_to aus TENANT_EMAIL_SETTINGS), wenn sie das in
 * den E-Mail-Einstellungen aktiviert haben (ENABLED=true).
 */
const nodemailer = require("nodemailer");
const dns = require("dns").promises;
const net = require("net");
const platformEmailSettings = require("./platformEmailSettings");

// Explizite Timeouts: ohne diese wartet nodemailer bei falschem Port/Secure
// oder geblocktem Egress bis zu ~2 Min und der Aufrufer "haengt". Lieber schnell
// mit einer aussagekraeftigen Fehlermeldung scheitern.
const SMTP_TIMEOUTS = {
  connectionTimeout: 15000, // TCP-Verbindung
  greetingTimeout:   10000, // SMTP-Begruessung (haeufig bei Port/Secure-Mismatch)
  socketTimeout:     20000, // Inaktivitaet auf der Verbindung
};

/**
 * Loest einen Hostnamen explizit auf eine IPv4-Adresse auf.
 *
 * Hintergrund: Auf IPv6-only-Plattformen (z.B. Railway) bevorzugt/erzwingt
 * nodemailer eine IPv6-Verbindung, die mangels IPv6-Egress mit ENETUNREACH
 * scheitert. Geben wir nodemailer direkt ein IPv4-Literal als `host`, umgeht es
 * die eigene (zu strikte) Adressauswahl und verbindet via IPv4-NAT. Der
 * Original-Hostname wird separat als `servername` fuer SNI/Zertifikat gesetzt.
 *
 * @returns {Promise<string|null>} IPv4-Adresse oder null (dann Hostname nutzen).
 */
async function resolveIPv4(host) {
  if (!host || net.isIP(host)) return null; // bereits IP-Literal -> nichts zu tun
  try {
    const { address } = await dns.lookup(host, { family: 4 });
    return address || null;
  } catch {
    return null; // keine A-Records -> nodemailer mit Hostnamen versuchen lassen
  }
}

/** Baut einen nodemailer-Transport; erzwingt IPv4, behaelt SNI auf dem Hostnamen. */
async function buildTransport({ host, port, secure, user, pass }) {
  const ipv4 = await resolveIPv4(host);
  return nodemailer.createTransport({
    host:       ipv4 || host,
    port:       Number(port) || 587,
    secure:     !!secure,
    // Bei IPv4-Literal: SNI + Zertifikatspruefung weiterhin gegen den Hostnamen.
    servername: ipv4 ? host : undefined,
    auth:       user ? { user, pass } : undefined,
    ...SMTP_TIMEOUTS,
  });
}

/** Zerlegt "Name <addr@domain>" oder "addr@domain" in { name, address }. */
function parseFrom(s) {
  if (!s) return { name: "", address: "" };
  const m = /^\s*"?([^"<]*)"?\s*<\s*([^>]+)\s*>\s*$/.exec(s);
  if (m) return { name: m[1].trim(), address: m[2].trim() };
  return { name: "", address: String(s).trim() };
}

function composeFrom(name, address) {
  return name ? `"${name}" <${address}>` : address;
}

/**
 * Loest die Plattform-Mailverbindung + Standard-Absender auf: zuerst
 * PLATFORM_EMAIL_SETTINGS (DB, Owner-Konsole), sonst SMTP_*-ENV.
 * @returns {Promise<{ transport: object, fromAddress: string, fromName: string }|null>}
 */
async function resolvePlatformMailer() {
  const dbCfg = await platformEmailSettings.getSettings();
  if (dbCfg) {
    return {
      transport:   await buildTransport(dbCfg),
      fromAddress: dbCfg.from || "",
      fromName:    dbCfg.fromName || "",
    };
  }

  if (!process.env.SMTP_HOST) return null;
  const parsed = parseFrom(process.env.SMTP_FROM || process.env.SMTP_USER);
  return {
    transport: await buildTransport({
      host:   process.env.SMTP_HOST,
      port:   process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === "true",
      user:   process.env.SMTP_USER,
      pass:   process.env.SMTP_PASS,
    }),
    fromAddress: parsed.address,
    fromName:    parsed.name,
  };
}

/**
 * Loest einen "Sender" auf — Plattform-SMTP-Transport + Absenderidentitaet,
 * mit einheitlicher async `send(msg)`-Methode.
 * @returns {Promise<{ send: Function, from: string, replyTo?: string }|null>}
 */
async function resolveSender({ supabase, tenantId, requireTenant }) {
  const platform = await resolvePlatformMailer();
  if (!platform) return null;

  let fromAddress = platform.fromAddress;
  let fromName    = platform.fromName;
  let replyTo;

  if (supabase && tenantId) {
    const { getTenantSenderConfig } = require("./emailSettingsService");
    const cfg = await getTenantSenderConfig(supabase, tenantId);
    if (cfg && (cfg.enabled || requireTenant)) {
      fromAddress = cfg.from     || platform.fromAddress;
      fromName    = cfg.fromName || platform.fromName;
      replyTo     = cfg.replyTo;
    } else if (requireTenant) {
      throw { status: 400, message: "Keine Absender-Einstellungen gefunden. Bitte zuerst eine Absenderadresse speichern." };
    }
  } else if (requireTenant) {
    throw { status: 400, message: "Kein Mandantenkontext vorhanden." };
  }

  if (!fromAddress) {
    throw { status: 503, message: "Kein Absender konfiguriert. Bitte SMTP_FROM in Railway setzen oder eine eigene Absenderadresse hinterlegen." };
  }

  const from = composeFrom(fromName, fromAddress);

  return {
    from,
    replyTo,
    send: async (msg) => {
      try {
        await platform.transport.sendMail({
          from,
          to:          msg.to,
          subject:     msg.subject,
          html:        msg.html || msg.text,
          text:        msg.text,
          replyTo:     msg.replyTo || replyTo,
          attachments: msg.attachments,
        });
      } catch (err) {
        throw enrichSmtpError(err);
      }
    },
  };
}

/**
 * Send an email.
 * @param {object} opts
 * @param {object}   [opts.supabase]    – Supabase-Client (fuer Per-Tenant-Absenderidentitaet)
 * @param {number}   [opts.tenantId]    – Tenant, dessen Absenderidentitaet genutzt wird
 * @param {boolean}  [opts.requireTenant] – true: Absender MUSS aus den Tenant-Einstellungen kommen (Test)
 * @param {string}   opts.to            – recipient address
 * @param {string}   opts.subject
 * @param {string}   [opts.html]        – HTML body (preferred)
 * @param {string}   [opts.text]        – plain-text fallback
 * @param {string}   [opts.replyTo]     – Antwort-an (override)
 * @param {Array}    [opts.attachments] – nodemailer-Style attachments
 * @throws {{ status: number, message: string }} when no transport is available
 */
async function sendMail({ supabase, tenantId, requireTenant, to, subject, html, text, replyTo, attachments }) {
  const sender = await resolveSender({ supabase, tenantId, requireTenant });
  if (!sender) {
    throw { status: 503, message: "E-Mail-Versand ist nicht konfiguriert. Bitte SMTP_* (z.B. Eusend-Zugangsdaten) in Railway setzen oder in der Owner-Konsole hinterlegen." };
  }
  await sender.send({ to, subject, html, text, replyTo, attachments });
}

/**
 * Uebersetzt nodemailer-Fehlercodes in actionable deutsche Meldungen, damit der
 * Nutzer im UI direkt sieht, was zu tun ist (statt "Connection timeout").
 */
function enrichSmtpError(err) {
  const code = err && err.code;
  const raw  = (err && err.message) || String(err);
  switch (code) {
    case "EAUTH":
      return { status: 401, message: `Anmeldung am SMTP-Server abgelehnt (Benutzername/Passwort). [${raw}]` };
    case "ETIMEDOUT":
    case "ESOCKET":
    case "ECONNECTION":
      return { status: 502, message: `Verbindung zum SMTP-Server fehlgeschlagen. Pruefe die SMTP-Konfiguration in der Owner-Konsole bzw. SMTP_HOST/SMTP_PORT/SMTP_SECURE in Railway. [${raw}]` };
    case "EENVELOPE":
      return { status: 400, message: `Absender- oder Empfaengeradresse wurde abgelehnt. [${raw}]` };
    default:
      return { status: err?.status || 502, message: raw };
  }
}

module.exports = { sendMail };
