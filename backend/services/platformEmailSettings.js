"use strict";

/**
 * Liest die plattformweite SMTP-Konfiguration (PLATFORM_EMAIL_SETTINGS,
 * Migration 0112). Read-only aus Sicht des Tenant-Backends — verwaltet wird
 * sie ausschliesslich ueber die Owner-Konsole
 * (owner-console/services/platformEmailSettings.js). Beide Dienste sprechen
 * direkt dieselbe Supabase-DB, kein HTTP-Aufruf zwischen ihnen noetig.
 *
 * Ergebnis wird 5 Minuten gecacht, damit nicht jede E-Mail einen DB-Roundtrip
 * ausloest. Aenderungen in der Owner-Konsole wirken sich dadurch mit bis zu
 * 5 Minuten Verzoegerung aus.
 */

const { createClient } = require("@supabase/supabase-js");
const platformCrypto = require("./platformCrypto");

const CACHE_TTL_MS = 5 * 60_000;
let cache = { exp: 0, value: undefined };

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _supabase;
}

function isMissingRelation(error) {
  return error && /relation .* does not exist|does not exist|could not find the table/i.test(error.message || "");
}

/**
 * @returns {Promise<{host:string, port:number, secure:boolean, user?:string,
 *   pass?:string, from?:string, fromName?:string}|null>} null, wenn keine
 *   Zeile/kein Host hinterlegt ist (Aufrufer faellt auf SMTP_*-ENV zurueck).
 */
async function getSettings() {
  const now = Date.now();
  if (cache.exp > now) return cache.value;

  let value = null;
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("PLATFORM_EMAIL_SETTINGS")
        .select("*")
        .eq("ID", 1)
        .maybeSingle();
      if (error && !isMissingRelation(error)) throw error;
      if (data && data.SMTP_HOST) {
        value = {
          host:     data.SMTP_HOST,
          port:     Number(data.SMTP_PORT) || 465,
          secure:   !!data.SMTP_SECURE,
          user:     data.SMTP_USER || undefined,
          pass:     data.SMTP_PASS_ENC ? platformCrypto.decrypt(data.SMTP_PASS_ENC) : undefined,
          from:     data.SMTP_FROM || data.SMTP_USER || undefined,
          fromName: data.FROM_NAME || undefined,
        };
      }
    } catch (e) {
      console.warn("[platformEmailSettings] DB-Lesen fehlgeschlagen, ENV-Fallback:", e?.message || e);
      value = null;
    }
  }

  cache = { exp: now + CACHE_TTL_MS, value };
  return value;
}

/** Fuer Tests / manuelles Erzwingen eines Neu-Lesens. */
function invalidate() {
  cache = { exp: 0, value: undefined };
}

module.exports = { getSettings, invalidate };
