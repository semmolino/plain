"use strict";

/**
 * exportTenant — schreibt einen kompletten Snapshot eines Mandanten als JSON.
 *
 * READ-ONLY: führt ausschließlich SELECTs aus, verändert nichts. Damit kannst du
 * gefahrlos prüfen, welche Tabellen/Datensätze erfasst werden, bevor importTenant
 * (Wipe + Reinsert) gebaut wird.
 *
 * Strategie: IDs werden 1:1 mitexportiert (kein Remap). importTenant setzt den
 * Demo-Mandanten später auf exakt diesen Stand zurück (gleiche IDs → FK-Integrität
 * ohne Remapping). Nur für den Demo-Mandanten gedacht.
 *
 * Nutzung (Env SUPABASE_URL + SUPABASE_SERVICE_KEY):
 *   node demo/exportTenant.js --tenant 42 --out demo/snapshot.json
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

// Mandanten-bezogene Tabellen mit eigener TENANT_ID-Spalte. Reihenfolge grob
// Eltern→Kind (für den späteren Import relevant; beim Export egal).
// Defensiv: existiert eine Tabelle/Spalte nicht, wird sie übersprungen.
const TENANT_TABLES = [
  "COMPANY", "DEPARTMENT", "EMPLOYEE", "USER_ROLE",
  "ADDRESS", "CONTACTS",
  "BREAK_RULE", "WORKING_TIME_MODEL", "EMPLOYEE_WORK_MODEL", "EMPLOYEE_CP_RATE",
  "OFFER", "OFFER_STRUCTURE",
  "FEE_CALCULATION_MASTER", "FEE_CALCULATION_PHASE", "FEE_CALCULATION_BL", "FEE_CALCULATION_SURCHARGE",
  "PROJECT", "PROJECT_STRUCTURE", "EMPLOYEE2PROJECT", "CONTRACT", "PROJECT_PROGRESS",
  "BUDGET_WARNING_RULE",
  "TEC",
  "INVOICE", "PARTIAL_PAYMENT",
  "TEXT_TEMPLATE", "MAHNUNG_SETTINGS",
  "NOTIFICATION_TYPE_CONFIG", "NOTIFICATION_SCHEDULE_CONFIG", "NOTIFICATION",
  "DOCUMENT_TEMPLATE",
  "TENANT_SETTINGS",
  "USER_ACHIEVEMENT", "RECENT_VIEW",
];

// Über COMPANY_ID statt TENANT_ID angebunden.
const COMPANY_TABLES = ["ASSET", "DOCUMENT_NUMBER_RANGE"];

// Über Eltern-IDs angebunden (kein TENANT_ID): table -> via.
const PARENT_TABLES = [
  { table: "ROLE_PERMISSION", column: "ROLE_ID",     via: "userRoleIds" },
  { table: "EMPLOYEE_ROLE",   column: "EMPLOYEE_ID", via: "employeeIds" },
];

async function selectAll(supabase, table, filterCol, value) {
  // value kann Skalar (eq) oder Array (in) sein.
  let q = supabase.from(table).select("*");
  q = Array.isArray(value) ? q.in(filterCol, value.length ? value : [-1]) : q.eq(filterCol, value);
  const { data, error } = await q;
  if (error) return { skipped: true, reason: error.message, rows: [] };
  return { skipped: false, rows: data || [] };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error("✗ SUPABASE_URL und SUPABASE_SERVICE_KEY müssen gesetzt sein."); process.exit(1); }

  const tenantId = parseInt(arg("tenant", process.env.DEMO_TENANT_ID), 10);
  if (!Number.isFinite(tenantId)) { console.error("✗ --tenant <ID> ist erforderlich."); process.exit(1); }
  const outFile = path.resolve(arg("out", `demo/snapshot-tenant-${tenantId}.json`));

  const supabase = createClient(url, key);
  const snapshot = { tenantId, exportedAt: new Date().toISOString(), tables: {} };
  const summary = [];
  const skipped = [];

  // TENANTS-Zeile selbst
  {
    const { data, error } = await supabase.from("TENANTS").select("*").eq("ID", tenantId).maybeSingle();
    if (!error && data) { snapshot.tables.TENANTS = [data]; summary.push(`TENANTS: 1`); }
    else { skipped.push(`TENANTS (${error?.message || "nicht gefunden"})`); }
  }

  // TENANT_ID-Tabellen
  for (const table of TENANT_TABLES) {
    const r = await selectAll(supabase, table, "TENANT_ID", tenantId);
    if (r.skipped) { skipped.push(`${table} (${r.reason})`); continue; }
    snapshot.tables[table] = r.rows; summary.push(`${table}: ${r.rows.length}`);
  }

  // Company-gebundene Tabellen
  const companyIds = (snapshot.tables.COMPANY || []).map(c => c.ID);
  for (const table of COMPANY_TABLES) {
    const r = await selectAll(supabase, table, "COMPANY_ID", companyIds);
    if (r.skipped) { skipped.push(`${table} (${r.reason})`); continue; }
    snapshot.tables[table] = r.rows; summary.push(`${table}: ${r.rows.length}`);
  }

  // Eltern-gebundene Tabellen
  const ids = {
    userRoleIds: (snapshot.tables.USER_ROLE || []).map(r => r.ID),
    employeeIds: (snapshot.tables.EMPLOYEE  || []).map(r => r.ID),
  };
  for (const { table, column, via } of PARENT_TABLES) {
    const r = await selectAll(supabase, table, column, ids[via]);
    if (r.skipped) { skipped.push(`${table} (${r.reason})`); continue; }
    snapshot.tables[table] = r.rows; summary.push(`${table}: ${r.rows.length}`);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), "utf8");

  console.log(`✅ Snapshot geschrieben: ${outFile}`);
  console.log("   Erfasst:\n     " + summary.join("\n     "));
  if (skipped.length) {
    console.log("   Übersprungen (Tabelle/Spalte fehlt o. ä.) — bitte melden, damit ich die Liste anpasse:\n     " + skipped.join("\n     "));
  }
}

main().catch(e => { console.error("✗ Unerwarteter Fehler:", e?.message || e); process.exit(1); });
