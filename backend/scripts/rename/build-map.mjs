#!/usr/bin/env node
/**
 * Erzeugt rename-map.json aus der LAUFENDEN Datenbank.
 *
 * WARUM ERZEUGT STATT GETIPPT: die Vorlage nannte je Spalte eine Tabelle. Welche
 * Tabellen dieselbe Spalte sonst noch tragen, steht im Schema - und genau davon
 * haengt ab, ob der Codemod eine Umbenennung uebernehmen darf (scope "global")
 * oder ob jede Fundstelle einzeln beurteilt werden muss ("table"). Beim ersten
 * Lauf gegen den Repo-Dump fehlten dadurch acht Traegertabellen; gegen die
 * laufende Datenbank kann das nicht passieren.
 *
 * Quelle ist bewusst die Datenbank und nicht db/schema/*.sql: der Dump im Repo
 * war vier Wochen alt und kannte TEC_REBOOKING nicht, dessen Migration
 * (0139_booking_rebook.sql) in der Datenbank als eingespielt vermerkt ist,
 * waehrend die Datei im Repository fehlt.
 *
 * Aufruf:  node backend/scripts/rename/build-map.mjs [--write]
 * Braucht DATABASE_URL (Tunnel: scripts/scalingo/04_db_tunnel.sh).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require("dotenv").config({ path: path.join(HERE, "..", "..", ".env") });
const { Client } = require("pg");

const WRITE = process.argv.includes("--write");
const OUT = path.join(HERE, "rename-map.json");

// ---------------------------------------------------------------- die Vorlage
//
// Spaltenfamilien: der Zielname gilt fuer JEDE Tabelle, die die Quellspalte
// traegt. Welche das sind, ermittelt das Skript - nicht diese Liste.
const FAMILIES = [
  { block: "01-cost-rate",      from: "CP_RATE",          to: "COST_RATE",               api: true },
  { block: "01-cost-rate",      from: "CP_TOT",           to: "COST_TOTAL",              api: true },
  { block: "02-hourly-rate",    from: "SP_RATE",          to: "HOURLY_RATE",             api: true },
  { block: "02-hourly-rate",    from: "SP_TOT",           to: "HOURLY_RATE_TOTAL",       api: true },
  { block: "02-hourly-rate",    from: "SP_RATE_BEFORE",   to: "HOURLY_RATE_BEFORE",      api: true },
  { block: "02-hourly-rate",    from: "SP_RATE_AFTER",    to: "HOURLY_RATE_AFTER",       api: true },
  { block: "02-hourly-rate",    from: "SP_TOT_BEFORE",    to: "HOURLY_RATE_TOTAL_BEFORE", api: true },
  { block: "02-hourly-rate",    from: "SP_TOT_AFTER",     to: "HOURLY_RATE_TOTAL_AFTER", api: true },
  { block: "03-role-name",      from: "ROLE_NAME_SHORT",  to: "ROLE_ABBR",               api: true },
  { block: "03-role-name",      from: "ROLE_NAME_LONG",   to: "ROLE_NAME",               api: true },
  { block: "04-employee-abbr",  from: "SHORT_NAME",       to: "ABBR",                    api: { from: "short_name", to: "abbr" } },
  { block: "05-advance-invoice", from: "PARTIAL_PAYMENT_NUMBER",     to: "ADVANCE_INVOICE_NUMBER",     api: true },
  { block: "05-advance-invoice", from: "PARTIAL_PAYMENT_DATE",       to: "ADVANCE_INVOICE_DATE",       api: true },
  { block: "05-advance-invoice", from: "PARTIAL_PAYMENT_ADDRESS_ID", to: "ADVANCE_INVOICE_ADDRESS_ID", api: true },
  { block: "05-advance-invoice", from: "PARTIAL_PAYMENT_CONTACT_ID", to: "ADVANCE_INVOICE_CONTACT_ID", api: true },
  { block: "05-advance-invoice", from: "PARTIAL_PAYMENT_ID",         to: "ADVANCE_INVOICE_ID",         api: true },
  { block: "05-advance-invoice", from: "PARTIAL_PAYMENTS",           to: "ADVANCE_INVOICED",           api: true },
  { block: "06-booking",        from: "DATE_VOUCHER",     to: "BOOKING_DATE",            api: true },
  { block: "06-booking",        from: "TEC_ID",           to: "BOOKING_ID",              api: true },
  { block: "07-abbr",           from: "NAME_SHORT",       to: "ABBR",                    api: { from: "name_short", to: "abbr" } },
  { block: "08-name",           from: "NAME_LONG",        to: "NAME",                    api: { from: "name_long",  to: "name" } },
];

const TABLE_RENAMES = {
  "01-cost-rate":       { EMPLOYEE_CP_RATE: "EMPLOYEE_COST_RATE" },
  // 02-hourly-rate hatte PROJECT_SP_RATES -> PROJECT_HOURLY_RATES. Die Tabelle
  // war bereits tot, als sie umbenannt wurde, und ist mit Migration 0161
  // entfallen. Der Eintrag muss deshalb raus: verify wuerde sonst dauerhaft
  // "new table PROJECT_HOURLY_RATES missing" melden - ein Befund, der keiner
  // ist und die echten zudeckt.
  "05-advance-invoice": { PARTIAL_PAYMENT: "ADVANCE_INVOICE", PARTIAL_PAYMENT_STRUCTURE: "ADVANCE_INVOICE_STRUCTURE" },
  "06-booking":         { TEC: "BOOKING", TEC_REBOOKING: "BOOKING_REBOOKING" },
};

const BLOCK_ORDER = [
  "01-cost-rate", "02-hourly-rate", "03-role-name", "04-employee-abbr",
  "05-advance-invoice", "06-booking", "07-abbr", "08-name",
];

const NOTES = {
  "01-cost-rate": "CP_* -> COST_*. Kleinster Block, Probelauf fuer die ganze Kette.",
  "02-hourly-rate": "SP_* -> HOURLY_RATE*. Beruehrt die Honorarkalkulation - hoai-kalkulation-reviewer einplanen.",
  "03-role-name": "ROLE_NAME_SHORT/_LONG -> ROLE_ABBR/ROLE_NAME. Keine SQL-Objekte betroffen.",
  "04-employee-abbr": "EMPLOYEE.SHORT_NAME -> ABBR. Der Zwilling short_name steht in der Anmeldeantwort (routes/auth.js) und im Auth-Store - nach diesem Block zuerst die Anmeldung pruefen.",
  "05-advance-invoice": "PARTIAL_PAYMENT -> ADVANCE_INVOICE. Fachlich der schwerste Block: beruehrt die E-Rechnung (services_einvoice_data.js, Vorauszahlungs-BTs) und den Snapshot-Test tests/einvoice_cii_snapshot.test.js. erechnung-reviewer einplanen.",
  "06-booking": "TEC -> BOOKING. Die Oberflaechentexte sind bereits vorab umformuliert (Commit 67e1abc). ARBZG_AUDIT hat Schutz-Trigger gegen Aenderungen - pruefen, ob sie einem ALTER im Weg stehen.",
  "07-abbr": "NAME_SHORT -> ABBR auf allen Traegern. Groesster Block.",
  "08-name": "NAME_LONG -> NAME auf allen Traegern.",
};

// ------------------------------------------------------------------- Schema
const SCHEMAS = `n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_%'`;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(
  `SELECT c.table_schema AS schema, c.table_name AS "table", c.column_name AS col
     FROM information_schema.columns c
     JOIN pg_namespace n ON n.nspname = c.table_schema
     JOIN pg_class k ON k.relname = c.table_name AND k.relnamespace = n.oid AND k.relkind = 'r'
    WHERE ${SCHEMAS}`
);
await client.end();

const carriers = new Map(); // Spalte -> [{schema, table}]
const colsOf = new Map();   // "schema.table" -> Set(Spalten)
for (const r of rows) {
  if (!carriers.has(r.col)) carriers.set(r.col, []);
  carriers.get(r.col).push({ schema: r.schema, table: r.table });
  const k = `${r.schema}.${r.table}`;
  if (!colsOf.has(k)) colsOf.set(k, new Set());
  colsOf.get(k).add(r.col);
}
const has = (schema, table, col) => colsOf.get(`${schema}.${table}`)?.has(col) ?? false;

// ------------------------------------------------------------------ bauen
const problems = [];
const perBlock = new Map(BLOCK_ORDER.map((id) => [id, new Map()])); // id -> table -> entry

const entryFor = (blockId, schema, table) => {
  const m = perBlock.get(blockId);
  const key = schema === "public" ? table : `${schema}.${table}`;
  if (!m.has(key)) m.set(key, { from: table, to: TABLE_RENAMES[blockId]?.[table] ?? null, columns: [] });
  return m.get(key);
};

// Tabellen-Umbenennungen zuerst, damit sie auch ohne Spalten auftauchen
for (const [blockId, ren] of Object.entries(TABLE_RENAMES)) {
  for (const [from, to] of Object.entries(ren)) {
    if (!colsOf.has(`public.${from}`)) problems.push(`FEHLT: Tabelle ${from}`);
    if (colsOf.has(`public.${to}`)) problems.push(`KOLLISION: Zieltabelle ${to} existiert bereits`);
    entryFor(blockId, "public", from);
  }
}

for (const f of FAMILIES) {
  const list = carriers.get(f.from) || [];
  if (list.length === 0) { problems.push(`LEER: keine Tabelle traegt ${f.from}`); continue; }
  for (const { schema, table } of list) {
    if (has(schema, table, f.to)) {
      problems.push(`KOLLISION: ${schema}.${table}."${f.to}" existiert bereits (Quelle ${f.from})`);
    }
    entryFor(f.block, schema, table).columns.push({
      from: f.from, to: f.to, scope: "global", api: f.api,
    });
  }
}

// Zwei Quellen, ein Ziel auf derselben Tabelle?
const seen = new Map();
for (const [blockId, m] of perBlock) {
  for (const [key, t] of m) {
    for (const c of t.columns) {
      const k = `${key}.${c.to}`;
      if (seen.has(k)) problems.push(`DOPPELTES ZIEL: ${k} <- ${seen.get(k)} und ${blockId}:${c.from}`);
      seen.set(k, `${blockId}:${c.from}`);
    }
  }
}

const blocks = BLOCK_ORDER.map((id) => ({
  id, status: "planned", note: NOTES[id],
  tables: [...perBlock.get(id).values()].sort((a, b) => a.from.localeCompare(b.from)),
}));

console.log("===== PROBLEME =====");
console.log(problems.length ? problems.join("\n") : "  keine");
console.log("\n===== UMFANG =====");
for (const b of blocks) {
  const n = b.tables.reduce((s, t) => s + t.columns.length, 0);
  const tr = b.tables.filter((t) => t.to).length;
  console.log(`  ${b.id.padEnd(20)} ${tr} Tabelle(n), ${String(n).padStart(2)} Spalte(n)`);
}

if (!WRITE) {
  console.log("\n  Trockenlauf. --write schreibt rename-map.json.\n");
  process.exit(problems.length ? 1 : 0);
}

const old = JSON.parse(fs.readFileSync(OUT, "utf8"));
fs.writeFileSync(OUT, JSON.stringify({ ...old, blocks }, null, 2) + "\n");
console.log(`\n  geschrieben: ${path.relative(process.cwd(), OUT)}\n`);
if (problems.length) process.exit(1);
