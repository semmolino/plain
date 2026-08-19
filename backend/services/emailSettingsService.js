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

/** Grobe Plausibilitaet — Tippfehler abfangen, nicht RFC 5322 nachbauen. */
function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
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
    bcc_to:    row?.BCC_TO    || "",
  };
}

/**
 * Speichert (upsert) die Absenderidentitaet eines Tenants. Body-Felder
 * snake_case. SMTP-Zugangsdaten werden NIE vom Request uebernommen — die
 * kommen ausschliesslich aus den globalen ENV-Variablen.
 */
async function saveSettings(supabase, { tenantId, body }) {
  const b = body || {};
  // BCC geht an eine Adresse, die der Kunde NICHT sieht — ein Tippfehler
  // schickt Belege still an jemand Fremdes. Deshalb hier hart pruefen.
  const bcc = (b.bcc_to || "").trim();
  if (bcc && !isEmail(bcc)) {
    throw { status: 400, message: "Die Adresse für die Kopie (BCC) ist keine gültige E-Mail-Adresse." };
  }
  const payload = {
    TENANT_ID:  tenantId,
    ENABLED:    !!b.enabled,
    SMTP_FROM:  (b.smtp_from || "").trim() || null,
    FROM_NAME:  (b.from_name || "").trim() || null,
    REPLY_TO:   (b.reply_to  || "").trim() || null,
    BCC_TO:     bcc || null,
    UPDATED_AT: new Date().toISOString(),
  };

  const existing = await loadRow(supabase, tenantId);
  const write = async (data) => {
    const { error } = existing
      ? await supabase.from(TABLE).update(data).eq("TENANT_ID", tenantId)
      : await supabase.from(TABLE).insert(data);
    return error;
  };

  let error = await write(payload);
  // Migration 0130 (Spalte BCC_TO) noch nicht eingespielt: die uebrigen
  // Einstellungen trotzdem speichern — sonst blockiert eine fehlende Migration
  // das ganze Formular. Nur wenn wirklich eine Kopie-Adresse gewuenscht ist,
  // muss der Nutzer es erfahren.
  if (error && isMissingRelation(error)) {
    const { BCC_TO, ...ohneBcc } = payload;
    const retryError = await write(ohneBcc);
    if (retryError) throw retryError;
    if (BCC_TO) {
      throw { status: 503, message: "Kopie-Adresse konnte nicht gespeichert werden — Migration 0130 fehlt. Die übrigen Einstellungen wurden gespeichert." };
    }
    error = null;
  }
  if (error) throw error;

  return getSettingsForApi(supabase, { tenantId });
}

/**
 * Liefert die Absenderkonfiguration eines Tenants (kein Transport — die
 * SMTP-Verbindung baut emailService.js immer aus den globalen ENV-Variablen).
 * @returns {Promise<{enabled:boolean, from?:string, fromName?:string, replyTo?:string, bccTo?:string}|null>}
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
    // Haengt bewusst NICHT an ENABLED: die Kopie ist unabhaengig davon, ob der
    // Mandant eine eigene Absenderidentitaet nutzt oder den System-Absender.
    bccTo:    row.BCC_TO    || undefined,
  };
}

module.exports = { getSettingsForApi, saveSettings, getTenantSenderConfig };
