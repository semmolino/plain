/**
 * Shared email service mit zwei Versand-Wegen (Provider-Abstraktion):
 *
 *   A) Resend HTTPS-API (BEVORZUGT, wenn RESEND_API_KEY gesetzt ist)
 *      — laeuft ueber Port 443 und funktioniert daher auch dort, wo ausgehender
 *        SMTP-Verkehr blockiert ist (Railway Free/Hobby). Beste Zustellbarkeit.
 *      — Absender = verifizierte Plattform-Domain (EMAIL_FROM). Pro Tenant wird
 *        der Anzeigename (FROM_NAME) und die Antwort-Adresse (REPLY_TO / eigene
 *        E-Mail) gesetzt, damit Antworten beim Mandanten landen.
 *
 *   B) SMTP via nodemailer (Fallback, nur wo Egress erlaubt ist, z.B. Railway Pro
 *      / Self-Host). Per-Tenant SMTP (TENANT_EMAIL_SETTINGS) oder globale
 *      SMTP_*-ENV-Variablen.
 *
 * Auswahl: RESEND_API_KEY gesetzt -> Resend, sonst SMTP.
 */
const nodemailer = require("nodemailer");
const dns = require("dns").promises;
const net = require("net");
const { sendViaResend } = require("../services_email_resend");

/** Entfernt Whitespace und umschliessende Anfuehrungszeichen aus ENV-Werten. */
function clean(v) {
  if (!v) return "";
  return String(v).trim().replace(/^["']+|["']+$/g, "").trim();
}

/** Zerlegt "Name <addr@domain>" oder "addr@domain" in { name, address }. */
function parseFrom(s) {
  if (!s) return { name: "", address: "" };
  const m = /^\s*"?([^"<]*)"?\s*<\s*([^>]+)\s*>\s*$/.exec(s);
  if (m) return { name: m[1].trim(), address: m[2].trim() };
  return { name: "", address: String(s).trim() };
}

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

/** Globaler ENV-Transport (System-Absender). @returns {Promise<object|null>} */
async function createEnvMailer() {
  if (!process.env.SMTP_HOST) return null;
  return buildTransport({
    host:   process.env.SMTP_HOST,
    port:   process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === "true",
    user:   process.env.SMTP_USER,
    pass:   process.env.SMTP_PASS,
  });
}

/** Baut einen Transport aus einer aufgeloesten Tenant-Konfiguration. */
function createTenantMailer(cfg) {
  return buildTransport({
    host:   cfg.host,
    port:   cfg.port,
    secure: cfg.secure,
    user:   cfg.user,
    pass:   cfg.pass,
  });
}

/**
 * Loest den zu verwendenden Transport + Absender auf.
 * @returns {Promise<{ transport: object, from: string, replyTo?: string }|null>}
 */
async function resolveTransport({ supabase, tenantId, requireTenant }) {
  // 1) Per-Tenant versuchen (nur wenn Kontext vorhanden)
  if (supabase && tenantId) {
    // Lazy require -> klare Abhaengigkeitsrichtung, kein Modul-Zyklus.
    const { getTenantTransportConfig } = require("./emailSettingsService");
    const cfg = await getTenantTransportConfig(supabase, tenantId, { ignoreEnabled: !!requireTenant });
    if (cfg) {
      const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.from}>` : cfg.from;
      return { transport: await createTenantMailer(cfg), from, replyTo: cfg.replyTo };
    }
  }

  // 2) Test-Versand verlangt explizit die Tenant-Konfiguration -> kein ENV-Fallback
  if (requireTenant) {
    throw { status: 400, message: "Keine eigene SMTP-Konfiguration gefunden. Bitte zuerst SMTP-Host (und ggf. Passwort) speichern." };
  }

  // 3) Globaler ENV-Fallback (System-Absender)
  const envMailer = await createEnvMailer();
  if (envMailer) {
    return { transport: envMailer, from: process.env.SMTP_FROM || process.env.SMTP_USER };
  }
  return null;
}

/**
 * Loest einen "Sender" auf — eine Abstraktion ueber Resend ODER SMTP, mit
 * einheitlicher async `send(msg)`-Methode.
 * @returns {Promise<{ send: Function, from: string, replyTo?: string }|null>}
 */
async function resolveSender({ supabase, tenantId, requireTenant }) {
  // Tenant-Identitaet (Anzeigename + Antwort-Adresse) laden, falls vorhanden.
  let identity = null;
  if (supabase && tenantId) {
    const { getTenantSenderIdentity } = require("./emailSettingsService");
    identity = await getTenantSenderIdentity(supabase, tenantId);
  }

  // ── A) Resend HTTPS-API (bevorzugt) ───────────────────────────────────────
  // Defensiv saeubern: versehentliche Leerzeichen/Newlines/umschliessende
  // Anfuehrungszeichen aus den Railway-Variablen entfernen (haeufige Fehlerquelle).
  const apiKey   = clean(process.env.RESEND_API_KEY);
  const fromEnv  = clean(process.env.EMAIL_FROM);
  if (apiKey) {
    const base = parseFrom(fromEnv);
    // Hat der Tenant eine EIGENE verifizierte Domain + passende Absenderadresse,
    // wird daraus gesendet (echte Absender-Identitaet, DKIM-signiert). Sonst
    // Fallback auf die verifizierte Plattform-Domain (EMAIL_FROM).
    let fromAddress = base.address;
    if (identity && identity.domainVerified && identity.from && identity.domainName) {
      const dom = String(identity.from).split("@")[1];
      if (dom && dom.toLowerCase() === String(identity.domainName).toLowerCase()) {
        fromAddress = identity.from;
      }
    }
    if (!fromAddress) {
      throw { status: 503, message: 'Kein verifizierter Absender vorhanden. Bitte EMAIL_FROM in Railway setzen oder eine eigene Domain verifizieren.' };
    }
    const fromName = (identity && identity.fromName) || base.name || "PlaIn";
    const from     = `${fromName} <${fromAddress}>`;
    const replyTo  = (identity && (identity.replyTo || identity.from)) || undefined;
    return {
      from,
      replyTo,
      send: (msg) => sendViaResend({
        apiKey,
        from,
        to:          msg.to,
        subject:     msg.subject,
        html:        msg.html || msg.text,
        text:        msg.text,
        replyTo:     msg.replyTo || replyTo,
        attachments: msg.attachments,
      }),
    };
  }

  // ── B) SMTP (Fallback) ────────────────────────────────────────────────────
  const t = await resolveTransport({ supabase, tenantId, requireTenant });
  if (!t) return null;
  return {
    from:    t.from,
    replyTo: t.replyTo,
    send: async (msg) => {
      try {
        await t.transport.sendMail({
          from:        t.from,
          to:          msg.to,
          subject:     msg.subject,
          html:        msg.html || msg.text,
          text:        msg.text,
          replyTo:     msg.replyTo || t.replyTo,
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
 * @param {object}   [opts.supabase]    – Supabase-Client (fuer Per-Tenant-Identitaet)
 * @param {number}   [opts.tenantId]    – Tenant, dessen Absender-Identitaet genutzt wird
 * @param {boolean}  [opts.requireTenant] – true: im SMTP-Modus nur Tenant-SMTP (Test)
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
    throw { status: 503, message: "E-Mail-Versand ist nicht konfiguriert. Bitte RESEND_API_KEY + EMAIL_FROM (empfohlen) oder SMTP_* in Railway setzen." };
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
      return { status: 401, message: `Anmeldung am SMTP-Server abgelehnt (Benutzername/Passwort). Bei Gmail/Microsoft 365 ein App-Passwort verwenden, nicht das normale Login-Passwort. [${raw}]` };
    case "ETIMEDOUT":
    case "ESOCKET":
    case "ECONNECTION":
      return { status: 502, message: `Verbindung zum SMTP-Server fehlgeschlagen. Pruefe Host/Port und das TLS-Haekchen: Port 587 = Haekchen AUS (STARTTLS), Port 465 = Haekchen AN (TLS). Falls beides nicht hilft, blockiert die Hosting-Plattform evtl. ausgehenden SMTP-Verkehr. [${raw}]` };
    case "EENVELOPE":
      return { status: 400, message: `Absender- oder Empfaengeradresse wurde abgelehnt. [${raw}]` };
    default:
      return { status: err?.status || 502, message: raw };
  }
}

module.exports = { sendMail };
