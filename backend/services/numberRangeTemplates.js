"use strict";

/**
 * Konfigurierbare Nummernkreis-Templates pro Company / DocType.
 * Tokens:
 *   {COUNTER}            ungeppadt
 *   {COUNTER:0000}       genullt
 *   {YEAR4}              4-stelliges Jahr
 *   {YEAR2}              2-stelliges Jahr
 *   {MONTH:00}           Monat
 *   {DAY:00}             Tag
 *
 * Reset-Verhalten: Counter pro Jahr (wie bisher, hartkodiert -- keine
 * weitere Reset-Konfiguration noetig laut User-Entscheidung).
 */

const ALLOWED_DOC_TYPES = ["PROJECT", "OFFER", "INVOICE"];

const TOKEN_REGEX = /\{(COUNTER(?::0+)?|YEAR4|YEAR2|MONTH:00|DAY:00)\}/g;

/**
 * Pruefen, ob ein Template valid ist:
 *  - enthaelt mindestens {COUNTER} oder {COUNTER:0+}  (sonst Kollisionen)
 *  - keine unbekannten Tokens
 *  - nicht laenger als 80 Zeichen (Datenbank-Spalten-Grenze; INVOICE_NUMBER etc.)
 */
function validateTemplate(template) {
  if (typeof template !== "string" || template.length === 0) {
    return { ok: false, error: "Template darf nicht leer sein." };
  }
  if (template.length > 80) {
    return { ok: false, error: "Template darf max. 80 Zeichen lang sein." };
  }
  // Counter-Pflicht
  if (!/\{COUNTER(?::0+)?\}/.test(template)) {
    return { ok: false, error: "Template muss {COUNTER} oder {COUNTER:0000} enthalten." };
  }
  // Unbekannte Tokens?
  const unknown = [];
  const allTokens = template.match(/\{[^}]*\}/g) || [];
  for (const t of allTokens) {
    if (!t.match(TOKEN_REGEX)) unknown.push(t);
  }
  if (unknown.length > 0) {
    return { ok: false, error: `Unbekannte Bausteine: ${unknown.join(", ")}` };
  }
  return { ok: true };
}

/** Rendert ein Template lokal (fuer die Preview im UI). */
function renderTemplate(template, { counter = 1, now = new Date() } = {}) {
  let s = template;
  const yr4   = String(now.getFullYear());
  const yr2   = String(now.getFullYear() % 100).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day   = String(now.getDate()).padStart(2, "0");

  s = s.replaceAll("{YEAR4}",    yr4);
  s = s.replaceAll("{YEAR2}",    yr2);
  s = s.replaceAll("{MONTH:00}", month);
  s = s.replaceAll("{DAY:00}",   day);
  s = s.replace(/\{COUNTER:(0+)\}/g, (_m, pad) =>
    String(counter).padStart(pad.length, "0"),
  );
  s = s.replaceAll("{COUNTER}", String(counter));
  return s;
}

async function listTemplates(supabase, { tenantId }) {
  try {
    const { data, error } = await supabase
      .from("NUMBER_RANGE_TEMPLATE")
      .select("ID, COMPANY_ID, DOC_TYPE, TEMPLATE, UPDATED_AT")
      .eq("TENANT_ID", tenantId);
    if (error) {
      if (/relation .* does not exist/i.test(error.message)) return [];
      throw { status: 500, message: error.message };
    }
    return data || [];
  } catch (e) {
    if (e?.status) throw e;
    throw { status: 500, message: e?.message || String(e) };
  }
}

async function upsertTemplate(supabase, { tenantId, employeeId, companyId, docType, template }) {
  if (!ALLOWED_DOC_TYPES.includes(docType)) {
    throw { status: 400, message: `DOC_TYPE muss einer von ${ALLOWED_DOC_TYPES.join(", ")} sein.` };
  }
  const v = validateTemplate(template);
  if (!v.ok) throw { status: 400, message: v.error };
  if (!companyId) throw { status: 400, message: "company_id fehlt." };

  const { error } = await supabase
    .from("NUMBER_RANGE_TEMPLATE")
    .upsert({
      TENANT_ID:  tenantId,
      COMPANY_ID: companyId,
      DOC_TYPE:   docType,
      TEMPLATE:   template,
      UPDATED_AT: new Date().toISOString(),
      UPDATED_BY: employeeId,
    }, { onConflict: "COMPANY_ID,DOC_TYPE" });
  if (error) throw { status: 500, message: error.message };
  return { ok: true };
}

module.exports = { ALLOWED_DOC_TYPES, validateTemplate, renderTemplate, listTemplates, upsertTemplate };
