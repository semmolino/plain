"use strict";

const { createClient } = require("@supabase/supabase-js");

// Service-Role-Client: die Konsole verwaltet die globalen Lizenz-Tabellen
// (planübergreifend, tenantübergreifend) — Service-Key ist hier angemessen.
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_URL und SUPABASE_SERVICE_KEY müssen gesetzt sein.");
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = { supabase };
