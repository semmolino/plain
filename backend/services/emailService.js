/**
 * Shared email service using nodemailer.
 *
 * Zwei Transport-Quellen:
 *   1. Per-Tenant SMTP (TENANT_EMAIL_SETTINGS, Migration 0074) — wenn der Aufrufer
 *      `supabase` + `tenantId` uebergibt und der Tenant eigene, aktivierte
 *      Zugangsdaten hinterlegt hat. Dokumente werden dann aus dem EIGENEN
 *      Postfach des Mandanten versendet.
 *   2. Globaler Fallback ueber Railway-ENV-Variablen:
 *      SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
 *      — genutzt fuer System-Mails (Passwort-Reset, Watchdog) und fuer Tenants
 *      ohne eigene Konfiguration.
 */
const nodemailer = require("nodemailer");

// Explizite Timeouts: ohne diese wartet nodemailer bei falschem Port/Secure
// oder geblocktem Egress bis zu ~2 Min und der Aufrufer "haengt". Lieber schnell
// mit einer aussagekraeftigen Fehlermeldung scheitern.
const SMTP_TIMEOUTS = {
  connectionTimeout: 15000, // TCP-Verbindung
  greetingTimeout:   10000, // SMTP-Begruessung (haeufig bei Port/Secure-Mismatch)
  socketTimeout:     20000, // Inaktivitaet auf der Verbindung
};

/** Globaler ENV-Transport (System-Absender). @returns {object|null} */
function createEnvMailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    ...SMTP_TIMEOUTS,
  });
}

/** Baut einen nodemailer-Transport aus einer aufgeloesten Tenant-Konfiguration. */
function createTenantMailer(cfg) {
  return nodemailer.createTransport({
    host:   cfg.host,
    port:   cfg.port,
    secure: cfg.secure,
    auth:   cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    ...SMTP_TIMEOUTS,
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
      return { transport: createTenantMailer(cfg), from, replyTo: cfg.replyTo };
    }
  }

  // 2) Test-Versand verlangt explizit die Tenant-Konfiguration -> kein ENV-Fallback
  if (requireTenant) {
    throw { status: 400, message: "Keine eigene SMTP-Konfiguration gefunden. Bitte zuerst SMTP-Host (und ggf. Passwort) speichern." };
  }

  // 3) Globaler ENV-Fallback (System-Absender)
  const envMailer = createEnvMailer();
  if (envMailer) {
    return { transport: envMailer, from: process.env.SMTP_FROM || process.env.SMTP_USER };
  }
  return null;
}

/**
 * Send an email.
 * @param {object} opts
 * @param {object}   [opts.supabase]    – Supabase-Client (fuer Per-Tenant-Transport)
 * @param {number}   [opts.tenantId]    – Tenant, dessen SMTP genutzt werden soll
 * @param {boolean}  [opts.requireTenant] – true: NUR Tenant-SMTP (Test), kein ENV-Fallback
 * @param {string}   opts.to            – recipient address
 * @param {string}   opts.subject
 * @param {string}   [opts.html]        – HTML body (preferred)
 * @param {string}   [opts.text]        – plain-text fallback
 * @param {string}   [opts.replyTo]     – Antwort-an (override)
 * @param {Array}    [opts.attachments] – nodemailer attachment objects
 * @throws {{ status: number, message: string }} when no transport is available
 */
async function sendMail({ supabase, tenantId, requireTenant, to, subject, html, text, replyTo, attachments }) {
  const resolved = await resolveTransport({ supabase, tenantId, requireTenant });
  if (!resolved) {
    throw { status: 503, message: "SMTP nicht konfiguriert. Bitte SMTP_HOST in den Railway-Umgebungsvariablen setzen." };
  }
  await resolved.transport.sendMail({
    from:        resolved.from,
    to,
    subject,
    html:        html || text,
    text,
    replyTo:     replyTo || resolved.replyTo,
    attachments,
  });
}

module.exports = { sendMail };
