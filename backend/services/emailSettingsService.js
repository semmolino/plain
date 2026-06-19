"use strict";

/**
 * emailSettingsService — Per-Tenant SMTP-Konfiguration.
 *
 * Liest/schreibt TENANT_EMAIL_SETTINGS (Migration 0074) und loest die effektive
 * Transport-Konfiguration eines Tenants auf. Das SMTP-Passwort wird ueber
 * secretCrypto (AES-256-GCM) ver-/entschluesselt und NIE im Klartext ausgeliefert.
 *
 * Diese Datei kennt KEIN nodemailer — der eigentliche Versand (Transport-Aufbau)
 * liegt in emailService.js. Dadurch bleibt die Abhaengigkeitsrichtung
 * emailService -> emailSettingsService eindeutig (kein Zyklus).
 */

const secretCrypto = require("./secretCrypto");
const resend       = require("../services_email_resend");

const TABLE = "TENANT_EMAIL_SETTINGS";

/** Erkennt "Tabelle/Spalte existiert nicht" (Migration 0074 noch nicht eingespielt). */
function isMissingRelation(error) {
  return error && /relation .* does not exist|does not exist|could not find the table/i.test(error.message || "");
}

async function loadRow(supabase, tenantId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return null; // Soft-Fallback auf ENV
    throw error;
  }
  return data || null;
}

/** Update-or-insert eines Teil-Patches fuer die Tenant-Zeile. */
async function upsertRow(supabase, tenantId, patch) {
  const existing = await loadRow(supabase, tenantId);
  if (existing) {
    const { error } = await supabase.from(TABLE).update(patch).eq("TENANT_ID", tenantId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from(TABLE).insert({ TENANT_ID: tenantId, ...patch });
    if (error) throw error;
  }
}

/** Liefert den bereinigten Resend-API-Key oder wirft, wenn nicht konfiguriert. */
function requireResendKey() {
  const key = String(process.env.RESEND_API_KEY || "").trim().replace(/^["']+|["']+$/g, "");
  if (!key) throw { status: 503, message: "E-Mail-Dienst ist nicht konfiguriert (RESEND_API_KEY fehlt)." };
  return key;
}

/**
 * Liefert die fuer das Settings-UI sichere Repraesentation (OHNE Passwort).
 */
async function getSettingsForApi(supabase, { tenantId }) {
  const row = await loadRow(supabase, tenantId);
  return {
    configured:                !!(row && row.SMTP_HOST),
    enabled:                   !!(row && row.ENABLED),
    smtp_host:                 row?.SMTP_HOST  || "",
    smtp_port:                 row?.SMTP_PORT  ?? 587,
    smtp_secure:               !!(row && row.SMTP_SECURE),
    smtp_user:                 row?.SMTP_USER  || "",
    smtp_from:                 row?.SMTP_FROM  || "",
    from_name:                 row?.FROM_NAME  || "",
    reply_to:                  row?.REPLY_TO   || "",
    smtp_pass_set:             !!(row && row.SMTP_PASS_ENC),
    encryption_available:      secretCrypto.isConfigured(),
    global_fallback_available: !!process.env.SMTP_HOST,
    // Aktiver Versand-Weg: 'resend' (HTTPS-API) wenn konfiguriert, sonst 'smtp'.
    transport:                 process.env.RESEND_API_KEY ? "resend" : "smtp",
    provider_ready:            !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    // Eigene Absender-Domain des Tenants (Resend-Verifizierung).
    domain_name:               row?.RESEND_DOMAIN_NAME    || "",
    domain_status:             row?.RESEND_DOMAIN_STATUS  || "",
    domain_records:            row?.RESEND_DOMAIN_RECORDS || [],
  };
}

/**
 * Liefert NUR die Absender-Identitaet eines Tenants (Anzeigename + Antwort-
 * Adresse), unabhaengig von Host/ENABLED. Genutzt im Resend-Modus, wo keine
 * SMTP-Zugangsdaten noetig sind.
 * @returns {Promise<{from?:string, fromName?:string, replyTo?:string}|null>}
 */
async function getTenantSenderIdentity(supabase, tenantId) {
  if (!supabase || !tenantId) return null;
  const row = await loadRow(supabase, tenantId);
  if (!row) return null;
  return {
    from:           row.SMTP_FROM || row.SMTP_USER || undefined,
    fromName:       row.FROM_NAME || undefined,
    replyTo:        row.REPLY_TO  || undefined,
    domainName:     row.RESEND_DOMAIN_NAME || undefined,
    domainVerified: row.RESEND_DOMAIN_STATUS === "verified",
  };
}

// ── Absender-Domain (Resend) ──────────────────────────────────────────────────

const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Registriert die Domain des Tenants in Resend und speichert ID + DNS-Records. */
async function addTenantDomain(supabase, { tenantId, domain }) {
  const key  = requireResendKey();
  const name = String(domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!DOMAIN_RE.test(name)) {
    throw { status: 400, message: "Bitte eine gueltige Domain eingeben (z.B. kanzlei-mueller.de)." };
  }
  const region = String(process.env.RESEND_REGION || "").trim() || undefined;
  const res = await resend.createDomain(key, name, region);
  await upsertRow(supabase, tenantId, {
    RESEND_DOMAIN_ID:      res.id || null,
    RESEND_DOMAIN_NAME:    res.name || name,
    RESEND_DOMAIN_STATUS:  res.status || "pending",
    RESEND_DOMAIN_RECORDS: res.records || null,
    UPDATED_AT:            new Date().toISOString(),
  });
  return getSettingsForApi(supabase, { tenantId });
}

/** Stoesst die DNS-Verifizierung an und aktualisiert Status + Records. */
async function verifyTenantDomain(supabase, { tenantId }) {
  const key = requireResendKey();
  const row = await loadRow(supabase, tenantId);
  if (!row || !row.RESEND_DOMAIN_ID) throw { status: 400, message: "Keine Domain hinterlegt." };
  try { await resend.verifyDomain(key, row.RESEND_DOMAIN_ID); } catch { /* Verify ist nur ein Trigger */ }
  const fresh = await resend.getDomain(key, row.RESEND_DOMAIN_ID);
  await upsertRow(supabase, tenantId, {
    RESEND_DOMAIN_STATUS:  fresh.status  || row.RESEND_DOMAIN_STATUS,
    RESEND_DOMAIN_RECORDS: fresh.records || row.RESEND_DOMAIN_RECORDS,
    UPDATED_AT:            new Date().toISOString(),
  });
  return getSettingsForApi(supabase, { tenantId });
}

/** Entfernt die Domain bei Resend und leert die Spalten. */
async function removeTenantDomain(supabase, { tenantId }) {
  const key = requireResendKey();
  const row = await loadRow(supabase, tenantId);
  if (row && row.RESEND_DOMAIN_ID) {
    try { await resend.deleteDomain(key, row.RESEND_DOMAIN_ID); } catch { /* evtl. schon weg */ }
  }
  await upsertRow(supabase, tenantId, {
    RESEND_DOMAIN_ID:      null,
    RESEND_DOMAIN_NAME:    null,
    RESEND_DOMAIN_STATUS:  null,
    RESEND_DOMAIN_RECORDS: null,
    UPDATED_AT:            new Date().toISOString(),
  });
  return getSettingsForApi(supabase, { tenantId });
}

/**
 * Speichert (upsert) die SMTP-Einstellungen eines Tenants.
 * Body-Felder snake_case. Das Passwort wird nur geaendert, wenn `smtp_pass`
 * (nicht-leer) gesendet wird; `clear_password: true` loescht es.
 */
async function saveSettings(supabase, { tenantId, body }) {
  const b = body || {};
  const enabled = !!b.enabled;
  const host    = (b.smtp_host || "").trim();
  const user    = (b.smtp_user || "").trim();
  const newPass = typeof b.smtp_pass === "string" ? b.smtp_pass : "";
  const clearPw = !!b.clear_password;

  let port = parseInt(b.smtp_port, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) port = 587;

  if (enabled && !host) {
    throw { status: 400, message: "SMTP-Host ist erforderlich, um den eigenen Versand zu aktivieren." };
  }

  const existing = await loadRow(supabase, tenantId);
  const hadPass  = !!(existing && existing.SMTP_PASS_ENC);

  // Beim Aktivieren mit Benutzer muss ein Passwort vorhanden oder neu gesetzt sein.
  if (enabled && user && !hadPass && !newPass && !clearPw) {
    throw { status: 400, message: "Bitte ein SMTP-Passwort hinterlegen, bevor der Versand aktiviert wird." };
  }

  const payload = {
    TENANT_ID:   tenantId,
    ENABLED:     enabled,
    SMTP_HOST:   host || null,
    SMTP_PORT:   port,
    SMTP_SECURE: !!b.smtp_secure,
    SMTP_USER:   user || null,
    SMTP_FROM:   (b.smtp_from || "").trim() || null,
    FROM_NAME:   (b.from_name  || "").trim() || null,
    REPLY_TO:    (b.reply_to   || "").trim() || null,
    UPDATED_AT:  new Date().toISOString(),
  };

  // Passwort-Handhabung: nur anfassen, wenn explizit gewuenscht.
  if (clearPw) {
    payload.SMTP_PASS_ENC = null;
  } else if (newPass) {
    payload.SMTP_PASS_ENC = secretCrypto.encrypt(newPass); // wirft 503, wenn EMAIL_ENC_KEY fehlt
  }

  if (existing) {
    const { error } = await supabase.from(TABLE).update(payload).eq("TENANT_ID", tenantId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from(TABLE).insert(payload);
    if (error) throw error;
  }

  return getSettingsForApi(supabase, { tenantId });
}

/**
 * Loest die effektive Transport-Konfiguration eines Tenants auf.
 * @returns {object|null} {host,port,secure,user,pass,from,fromName,replyTo} oder
 *   null, wenn nichts/Disabled hinterlegt ist (=> Aufrufer faellt auf ENV zurueck).
 * @param {object} opts
 * @param {boolean} [opts.ignoreEnabled] - true fuer Test-Versand (ENABLED egal).
 */
async function getTenantTransportConfig(supabase, tenantId, { ignoreEnabled = false } = {}) {
  if (!supabase || !tenantId) return null;
  const row = await loadRow(supabase, tenantId);
  if (!row) return null;
  if (!ignoreEnabled && !row.ENABLED) return null;
  if (!row.SMTP_HOST) return null;

  let pass;
  if (row.SMTP_PASS_ENC) pass = secretCrypto.decrypt(row.SMTP_PASS_ENC);

  return {
    host:     row.SMTP_HOST,
    port:     Number(row.SMTP_PORT) || 587,
    secure:   !!row.SMTP_SECURE,
    user:     row.SMTP_USER || undefined,
    pass,
    from:     row.SMTP_FROM || row.SMTP_USER || undefined,
    fromName: row.FROM_NAME || undefined,
    replyTo:  row.REPLY_TO || undefined,
  };
}

module.exports = {
  getSettingsForApi, saveSettings, getTenantTransportConfig, getTenantSenderIdentity,
  addTenantDomain, verifyTenantDomain, removeTenantDomain,
};
