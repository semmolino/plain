#!/usr/bin/env node
/**
 * Prueft, ob die Migrationen aus APPLIED_BASELINE.txt wirklich angewendet sind.
 *
 * WARUM DAS NOETIG IST
 *   Die Baseline ist eine Behauptung ueber die Vergangenheit: was dort steht,
 *   wird vermerkt und NIE ausgefuehrt. Stimmt ein Eintrag nicht, laeuft die
 *   Migration nie - und niemand merkt es, weil der Runner "nichts einzuspielen"
 *   meldet.
 *
 *   Genau so war 0135_tenant_signup_approval.sql dran: in der Baseline
 *   vermerkt, aber TENANTS."SIGNUP_STATE" existierte nicht. Die Folge war keine
 *   Fehlermeldung, sondern eine abgeschaltete Sicherung - die Anmeldung fing den
 *   fehlenden Wert ab und liess durch ("SIGNUP_STATE nicht lesbar, lasse
 *   durch"). Beide Tore vor der Registrierung eines neuen Mandanten waren damit
 *   wirkungslos.
 *
 * WAS GEPRUEFT WIRD
 *   Jede Datei, die in _migrations als angewendet vermerkt ist - das ist die
 *   eigentliche Behauptung, und sie umfasst die Baseline-Eintraege, weil der
 *   Runner sie dort eintraegt. Aus jeder werden die Strukturaussagen gelesen,
 *   die sich nachpruefen lassen - CREATE TABLE, ADD COLUMN, CREATE FUNCTION -
 *   und gegen den Katalog gehalten. Das ist keine vollstaendige Pruefung:
 *   Daten-Migrationen, UPDATEs und Policies bleiben aussen vor. Es findet die
 *   Klasse von Fehlern, bei der eine Datei gar nicht gelaufen ist.
 *
 *   Bewusst NICHT nur die Baseline-Datei: wer einen Eintrag dort entfernt, hat
 *   das Problem damit nicht behoben - die Zeile in _migrations bleibt, die
 *   Migration gilt weiter als erledigt, und ein Pruefer, der nur die Baseline
 *   liest, meldet ploetzlich "kein Drift".
 *
 * BEHEBUNG
 *   Ein Befund heisst: die Datei ist als angewendet vermerkt, ist es aber nicht.
 *   Beides muss zurueck - der Eintrag in APPLIED_BASELINE.txt (sonst wird sie
 *   beim naechsten Lauf wieder vermerkt) und die Zeile in _migrations (sonst
 *   gilt sie weiter als erledigt). --unmark erledigt den zweiten Teil.
 *
 * Aufruf:  node backend/scripts/migration-drift.mjs
 *          node backend/scripts/migration-drift.mjs --unmark [--confirm]
 * Braucht DATABASE_URL (Tunnel: scripts/scalingo/04_db_tunnel.sh).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require("dotenv").config({ path: path.join(HERE, "..", ".env") });
const { Client } = require("pg");

const MIGRATIONS = path.join(HERE, "..", "migrations");
const BASELINE = path.join(MIGRATIONS, "APPLIED_BASELINE.txt");
const RENAME_MAP = path.join(HERE, "rename", "rename-map.json");

/**
 * Abgeschlossene Umbenennungen, damit alte Migrationen nicht als "nie gelaufen"
 * gelten, nur weil ihre Tabelle inzwischen anders heisst. Migration 0033 legt
 * die Kostensatz-Historie unter ihrem damaligen Namen an; die Tabelle gibt es,
 * sie heisst seit Block 01 anders. Alte Namen stehen hier bewusst NICHT
 * ausgeschrieben - der Guard sucht danach.
 */
function erledigteUmbenennungen() {
  const tabellen = new Map();
  const spalten = new Map(); // "TABELLE.SPALTE" -> neue Spalte
  if (!fs.existsSync(RENAME_MAP)) return { tabellen, spalten };
  const map = JSON.parse(fs.readFileSync(RENAME_MAP, "utf8"));
  for (const block of map.blocks || []) {
    if (block.status !== "done") continue;
    for (const t of block.tables || []) {
      if (t.to) tabellen.set(t.from, t.to);
      for (const c of t.columns || []) spalten.set(`${t.from}.${c.from}`, c.to);
    }
  }
  return { tabellen, spalten };
}
const UMBENANNT = erledigteUmbenennungen();

/** Namen auf den heutigen Stand bringen. */
const heute = {
  tabelle: (t) => UMBENANNT.tabellen.get(t) ?? t,
  /*
   * Die Spalte muss unter BEIDEN Tabellennamen gesucht werden. Eine alte
   * Migration nennt die Tabelle so, wie sie damals hiess; der Block, der die
   * Spalte umbenannt hat, fuehrt sie unter dem Namen, den die Tabelle zu
   * SEINEM Zeitpunkt trug. Wurde die Tabelle dazwischen umbenannt, treffen
   * sich die beiden Schluessel nie - und eine laengst eingespielte Migration
   * gilt als "nie gelaufen".
   */
  spalte: (t, c) =>
    UMBENANNT.spalten.get(`${t}.${c}`) ??
    UMBENANNT.spalten.get(`${UMBENANNT.tabellen.get(t) ?? t}.${c}`) ??
    c,
};

const UNMARK = process.argv.includes("--unmark");
const CONFIRM = process.argv.includes("--confirm");

if (!process.env.DATABASE_URL) {
  console.error("\n  DATABASE_URL fehlt - erst den Tunnel oeffnen.\n");
  process.exit(1);
}

const baseline = new Set(
  fs.readFileSync(BASELINE, "utf8")
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
);

/** Behauptungen aus einer Migrationsdatei, die im Katalog nachpruefbar sind. */
function claims(sql) {
  const out = [];
  // Kommentare raus, damit auskommentierte Beispiele nicht mitzaehlen.
  const s = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  for (const m of s.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([A-Za-z0-9_]+)"?/gi)) {
    out.push({ kind: "table", table: m[1] });
  }
  // Schemaqualifiziert oder nicht: bei "REPORTING"."FN_X" ist der Name der
  // ZWEITE Teil. Ohne diese Unterscheidung wird das Schema als Funktionsname
  // gelesen und als fehlend gemeldet.
  for (const m of s.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?([A-Za-z0-9_]+)"?(?:\s*\.\s*"?([A-Za-z0-9_]+)"?)?/gi)) {
    out.push({ kind: "function", name: m[2] || m[1] });
  }
  // ALTER TABLE X ... ADD COLUMN a, ADD COLUMN b - ein ALTER, mehrere Spalten.
  for (const m of s.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([A-Za-z0-9_]+)"?([\s\S]*?);/gi)) {
    const table = m[1];
    for (const c of m[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_\-]+)"?/gi)) {
      out.push({ kind: "column", table, column: c[1] });
    }
  }
  return out;
}

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const vermerkt = (await c.query(
  "SELECT filename FROM _migrations ORDER BY filename")).rows.map((r) => r.filename);

const tables = new Set((await c.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map((r) => r.table_name));
const cols = new Set((await c.query(
  `SELECT table_name || '.' || column_name AS k FROM information_schema.columns WHERE table_schema='public'`)).rows.map((r) => r.k));
const fns = new Set((await c.query(
  `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')`)).rows.map((r) => r.proname));

const befunde = [];
let geprueft = 0;

for (const datei of vermerkt) {
  const voll = path.join(MIGRATIONS, datei);
  if (!fs.existsSync(voll)) { befunde.push({ datei, was: "Datei fehlt im Repo" }); continue; }
  for (const cl of claims(fs.readFileSync(voll, "utf8"))) {
    geprueft++;
    // Gegen den HEUTIGEN Namen pruefen: eine Migration von 2024 nennt die
    // Tabelle so, wie sie damals hiess.
    const tab = cl.table ? heute.tabelle(cl.table) : null;
    if (cl.kind === "table" && !tables.has(tab)) {
      befunde.push({ datei, was: `Tabelle "${tab}" fehlt` });
    } else if (cl.kind === "column") {
      const sp = heute.spalte(cl.table, cl.column);
      if (tables.has(tab) && !cols.has(`${tab}.${sp}`)) {
        befunde.push({ datei, was: `Spalte "${tab}"."${sp}" fehlt` });
      }
    } else if (cl.kind === "function" && !fns.has(cl.name)) {
      befunde.push({ datei, was: `Funktion ${cl.name}() fehlt` });
    }
  }
}

const ausBaseline = vermerkt.filter((f) => baseline.has(f)).length;
console.log(
  `\n  ${vermerkt.length} in _migrations vermerkt (davon ${ausBaseline} aus der Baseline), ` +
  `${geprueft} nachpruefbare Aussagen.\n`
);
if (befunde.length === 0) {
  console.log("  Kein Drift: alles, was sich pruefen laesst, ist da.\n");
} else {
  console.log(`  ${befunde.length} Befund(e) - diese Migration ist vermutlich nie gelaufen:\n`);
  const proDatei = new Map();
  for (const b of befunde) {
    if (!proDatei.has(b.datei)) proDatei.set(b.datei, []);
    proDatei.get(b.datei).push(b.was);
  }
  for (const [datei, liste] of proDatei) {
    console.log(`  ${datei}`);
    for (const w of liste) console.log(`      ${w}`);
  }
  console.log(
    "\n  Behebung, beide Haelften:" +
    "\n    1. Eintrag aus APPLIED_BASELINE.txt entfernen" +
    "\n    2. Zeile aus _migrations loeschen  ->  --unmark --confirm" +
    "\n  Voraussetzung: die Datei ist wiederholbar geschrieben" +
    "\n  (IF NOT EXISTS / ON CONFLICT). Danach spielt der naechste Deploy sie ein.\n"
  );
  process.exitCode = 1;
}

if (UNMARK) {
  const dateien = [...new Set(befunde.map((b) => b.datei))];
  if (dateien.length === 0) {
    console.log("  Nichts zu entmarken.\n");
  } else {
    const vermerkt = (await c.query(
      "SELECT filename FROM _migrations WHERE filename = ANY($1) ORDER BY filename", [dateien])).rows;
    console.log(`  ${CONFIRM ? "Loesche" : "Wuerde loeschen"}: ${vermerkt.length} Vermerk(e) in _migrations\n`);
    for (const r of vermerkt) console.log(`    ${r.filename}`);
    if (!CONFIRM) {
      console.log("\n  Trockenlauf. --confirm fuehrt es aus.\n");
    } else {
      await c.query("BEGIN");
      try {
        const r = await c.query("DELETE FROM _migrations WHERE filename = ANY($1)", [dateien]);
        await c.query("COMMIT");
        console.log(`\n  ${r.rowCount} Vermerk(e) geloescht - die Dateien gelten wieder als ausstehend.`);
        console.log("  Jetzt APPLIED_BASELINE.txt pruefen und deployen.\n");
      } catch (e) {
        await c.query("ROLLBACK");
        console.error(`\n  Fehlgeschlagen: ${e.message}\n`);
        process.exitCode = 1;
      }
    }
  }
}

await c.end();
