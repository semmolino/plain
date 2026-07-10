"use strict";

/**
 * Supabase-Service-Client für die Seed-Skripte — identisch konfiguriert wie im
 * Backend (server.js): Service-Role-Key, damit dieselbe Business-Logik in den
 * Services greift. Läuft lokal mit gesetzten SUPABASE_URL + SUPABASE_SERVICE_KEY.
 */

const { createClient } = require("@supabase/supabase-js");

function makeSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("✗ SUPABASE_URL und SUPABASE_SERVICE_KEY müssen gesetzt sein.");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// Einfacher CLI-Argument-Leser: --name value  bzw.  --flag (boolean).
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const val = process.argv[i + 1];
  if (val === undefined || val.startsWith("--")) return true; // Flag
  return val;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

module.exports = { makeSupabase, arg, hasFlag };
