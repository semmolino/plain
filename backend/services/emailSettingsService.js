"use strict";

/**
 * emailSettingsService — Per-Tenant Absenderidentitaet (kein SMTP mehr).
 *
 * SMTP-Zugangsdaten kommen ausschliesslich aus den globalen ENV-Variablen
 * (SMTP_HOST/PORT/SECURE/USER/PASS, siehe emailService.js). Ein Mandant kann
 * hier nur seine Absenderadresse, seinen Anzeigenamen und seine Antwort-an-
 * Adresse hinterlegen (TENANT_EMAIL_SETTINGS, Migration 0074/0111).
 */

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

/**
 * Liefert die fuer das Settings-UI sichere Repraesentation.
 */
async function getSettingsForApi(supabase, { tenantId }) {
  const row = await loadRow(supabase, tenantId);
  return {
    enabled:   !!(row && row.ENABLED),
    smtp_from: row?.SMTP_FROM || "",
    from_name: row?.FROM_NAME || "",
    reply_to:  row?.REPLY_TO  || "",
  };
}

/**
 * Speichert (upsert) die Absenderidentitaet eines Tenants. Body-Felder
 * snake_case. SMTP-Zugangsdaten werden NIE vom Request uebernommen — die
 * kommen ausschliesslich aus den globalen ENV-Variablen.
 */
async function saveSettings(supabase, { tenantId, body }) {
  const b = body || {};
  const payload = {
    TENANT_ID:  tenantId,
    ENABLED:    !!b.enabled,
    SMTP_FROM:  (b.smtp_from || "").trim() || null,
    FROM_NAME:  (b.from_name || "").trim() || null,
    REPLY_TO:   (b.reply_to  || "").trim() || null,
    UPDATED_AT: new Date().toISOString(),
  };

  const existing = await loadRow(supabase, tenantId);
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
 * Liefert die Absenderkonfiguration eines Tenants (kein Transport — die
 * SMTP-Verbindung baut emailService.js immer aus den globalen ENV-Variablen).
 * @returns {Promise<{enabled:boolean, from?:string, fromName?:string, replyTo?:string}|null>}
 *   null, wenn fuer den Tenant nichts hinterlegt ist.
 */
async function getTenantSenderConfig(supabase, tenantId) {
  if (!supabase || !tenantId) return null;
  const row = await loadRow(supabase, tenantId);
  if (!row) return null;
  return {
    enabled:  !!row.ENABLED,
    from:     row.SMTP_FROM || undefined,
    fromName: row.FROM_NAME || undefined,
    replyTo:  row.REPLY_TO  || undefined,
  };
}

module.exports = { getSettingsForApi, saveSettings, getTenantSenderConfig };
