#!/usr/bin/env node
/**
 * Rauchtest fuer die Umbenennung.
 *
 * WARUM ES DEN GIBT: keine vorhandene Testsuite kann einen Rename-Fehler
 * finden. Jest laeuft gegen backend/tests/helpers/fakeSupabase.js, das jeden
 * Tabellen- und Spaltennamen akzeptiert; Playwright mockt /api/v1/** per
 * page.route; Schema-Typen fuer tsc gibt es nicht. Nach einem Block ist dieser
 * Lauf die einzige Stelle, an der Code und Datenbank wirklich aufeinander
 * treffen.
 *
 * Was er prueft:
 *   1. Erreichbarkeit   - jeder Endpunkt antwortet. Eine vergessene Spalte in
 *                         .select() oder in einem Objekt-Key meldet PostgREST
 *                         laut (PGRST204), das faellt hier auf.
 *   2. Neue Namen da    - jeder "to"-Name aus rename-map.json taucht in
 *                         mindestens einer Antwort auf. Fehlt einer, liefert
 *                         eine Funktion oder View ihn nicht - der haeufigste
 *                         stille Ausfall, weil ein View seine alten
 *                         Ausgabespalten behaelt.
 *   3. Alte Namen weg   - kein "from"-Name taucht noch in einer Antwort auf.
 *   4. PDFs rendern     - die zweite stille Klasse: ein Feldname in einem
 *                         Nunjucks-Template wird zu undefined und das Dokument
 *                         bleibt einfach leer, ohne Fehler.
 *
 * Aufruf:
 *   SMOKE_EMAIL=… SMOKE_PASSWORD=… node backend/scripts/rename/smoke.mjs
 *   SMOKE_BASE_URL=https://…  (Standard: http://localhost:3000)
 *   --block <id>   nur die Namen dieses Blocks pruefen
 *   --keep         gerenderte PDFs behalten statt nur zu messen
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP_FILE = path.join(HERE, "rename-map.json");

const BASE = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const args = process.argv.slice(2);
const BLOCK = args.includes("--block") ? args[args.indexOf("--block") + 1] : null;
const KEEP = args.includes("--keep");

if (!EMAIL || !PASSWORD) {
  console.error("\n  SMOKE_EMAIL und SMOKE_PASSWORD muessen gesetzt sein.\n");
  process.exit(1);
}

let token = null;
const fails = [];
const notes = [];
/** Jeder JSON-Key, der in irgendeiner Antwort vorkam. */
const seenKeys = new Set();
/** Jeder String-Wert - Fehlermeldungen nennen Spaltennamen im Klartext. */
const seenText = [];

const note = (s) => { notes.push(s); console.log(s); };
const failure = (s) => { fails.push(s); console.log(`  FEHLER  ${s}`); };

// --------------------------------------------------------------------- HTTP

async function call(method, urlPath, { body, raw = false } = {}) {
  const res = await fetch(`${BASE}/api/v1${urlPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { res, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* kein JSON - z.B. HTML-Fehlerseite */ }
  return { res, json, text };
}

/** Alle Keys und String-Werte einsammeln, beliebig tief. */
function harvest(value, depth = 0) {
  if (depth > 12 || value == null) return;
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 50)) harvest(v, depth + 1);
    return;
  }
  if (typeof value === "string") {
    if (value.length < 400) seenText.push(value);
    return;
  }
  if (typeof value !== "object") return;
  for (const [k, v] of Object.entries(value)) {
    seenKeys.add(k);
    harvest(v, depth + 1);
  }
}

async function probe(label, urlPath) {
  try {
    const { res, json, text } = await call("GET", urlPath);
    if (!res.ok) {
      failure(`${label}  GET ${urlPath} -> ${res.status} ${(text || "").slice(0, 200)}`);
      return null;
    }
    harvest(json);
    return json;
  } catch (e) {
    failure(`${label}  GET ${urlPath} -> ${e.message}`);
    return null;
  }
}

async function probePdf(label, urlPath) {
  try {
    const { res, buf } = await call("GET", urlPath, { raw: true });
    if (!res.ok) {
      failure(`${label}  GET ${urlPath} -> ${res.status} ${buf.toString("utf8").slice(0, 200)}`);
      return;
    }
    if (buf.subarray(0, 4).toString() !== "%PDF") {
      failure(`${label}  ${urlPath} liefert kein PDF (${buf.subarray(0, 20).toString()})`);
      return;
    }
    // Ein Dokument, dessen Felder alle undefined geworden sind, rendert weiter -
    // es wird nur duenn. Die Groesse ist der einzige automatische Hinweis darauf.
    const kb = Math.round(buf.length / 1024);
    if (buf.length < 8000) {
      failure(`${label}  ${urlPath} rendert, ist aber nur ${kb} KB - auf leere Felder pruefen`);
    } else {
      note(`  ok  ${label}  (${kb} KB)`);
    }
    if (KEEP) {
      const out = path.join(os.tmpdir(), `smoke_${label.replace(/\W+/g, "_")}.pdf`);
      fs.writeFileSync(out, buf);
      note(`      abgelegt: ${out}`);
    }
  } catch (e) {
    failure(`${label}  ${urlPath} -> ${e.message}`);
  }
}

/** Erste ID aus einer Listenantwort, egal ob {data:[…]} oder […]. */
const firstId = (payload) => {
  const rows = Array.isArray(payload) ? payload : payload?.data;
  const row = Array.isArray(rows) ? rows[0] : null;
  return row?.ID ?? row?.id ?? null;
};

// ------------------------------------------------------------------- Ablauf

async function login() {
  const { res, json, text } = await call("POST", "/auth/login", {
    body: { email: EMAIL, password: PASSWORD },
  });
  if (!res.ok || !json?.token) {
    console.error(`\n  Anmeldung fehlgeschlagen: ${res.status} ${(text || "").slice(0, 300)}\n`);
    process.exit(1);
  }
  token = json.token;
  harvest(json); // die Login-Antwort traegt selbst short_name/abbr
  note(`\n  angemeldet als ${EMAIL} an ${BASE}\n`);
}

async function run() {
  await login();

  note("=== Listen und Stammdaten ===");
  const projekte = await probe("Projekte", "/projekte");
  const angebote = await probe("Angebote", "/angebote");
  const rechnungen = await probe("Rechnungen", "/invoices");
  const abschlaege = await probe("Abschlagsrechnungen", "/partial-payments");
  const nachtraege = await probe("Nachtraege", "/nachtraege");
  const mitarbeiter = await probe("Mitarbeiter", "/mitarbeiter");
  await probe("Buchungen", "/buchungen");
  await probe("Rollen", "/roles");
  await probe("Rollenzuordnung", "/roles/employees");
  // Genau die Endpunkte, die es gibt - jede Traegertabelle der Map soll von
  // mindestens einem hier abgedeckt sein, sonst meldet checkNames() sie als
  // "nie gesehen" und man sucht an der falschen Stelle.
  for (const s of ["countries", "currencies", "departments", "billing-types",
                   "payment-means", "booking-types", "vat", "fee-zones",
                   "fee-groups", "fee-masters", "fee-surcharges-global",
                   "fee-calculation-masters", "fee-zone-criteria", "lph-blocks",
                   "din276", "typen", "rollen", "addresses", "contacts",
                   "companies", "salutations", "genders", "working-time-models",
                   "booking-text-templates", "defaults"]) {
    await probe(`Stammdaten/${s}`, `/stammdaten/${s}`);
  }

  note("\n=== Reports (RPC-gestuetzt) ===");
  await probe("Dashboard KPIs", "/reports/dashboard/kpis");
  await probe("Dashboard Projekte", "/reports/dashboard/projects");
  await probe("Dashboard monatlich", "/reports/dashboard/monthly");
  await probe("Dashboard nach Status", "/reports/dashboard/by-status");
  await probe("Projektliste", "/reports/projects/list");
  await probe("Unternehmenskennzahlen", "/reports/company-kpis");
  await probe("Teilfertige Leistungen", "/reports/wip");
  await probe("WIP-Stichtage", "/reports/wip/closings");

  const projektId = firstId(projekte);
  if (projektId) {
    await probe("Projekt-Header", `/reports/project/${projektId}/header`);
    await probe("Projekt-Struktur", `/reports/project/${projektId}/structure`);
    await probe("Projekt-Phasen", `/reports/project/${projektId}/phases`);
    await probe("Projekt-Detail", `/projekte/${projektId}`);
  } else {
    note("  uebersprungen: kein Projekt vorhanden (Projekt-Header/Struktur/Phasen)");
  }

  note("\n=== PDF-Dokumente ===");
  const pdfs = [
    ["Angebot", angebote, (id) => `/angebote/${id}/pdf`],
    ["Rechnung", rechnungen, (id) => `/invoices/${id}/pdf`],
    ["Abschlagsrechnung", abschlaege, (id) => `/partial-payments/${id}/pdf`],
    ["Nachtrag", nachtraege, (id) => `/nachtraege/${id}/pdf`],
  ];
  for (const [label, list, url] of pdfs) {
    const id = firstId(list);
    if (id) await probePdf(label, url(id));
    else note(`  uebersprungen: kein Datensatz fuer ${label}`);
  }
  await probePdf("WIP-Report", "/reports/wip/pdf");
  await probePdf("Monatsabschluss", "/stammdaten/monatsabschluss/pdf");

  checkNames();
  summarise(mitarbeiter);
}

// ------------------------------------------------- Abgleich mit rename-map
function checkNames() {
  const raw = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
  let blocks = (raw.blocks || []).filter((b) => b.status === "planned" || b.status === "done");
  if (BLOCK) blocks = blocks.filter((b) => b.id === BLOCK);

  const expectNew = new Map(); // neuer Name -> woher
  const forbidOld = new Map(); // alter Name -> woher
  for (const b of blocks) {
    for (const t of b.tables || []) {
      for (const c of t.columns || []) {
        expectNew.set(c.to, `${t.to || t.from}.${c.to}`);
        forbidOld.set(c.from, `${t.from}.${c.from}`);
        const api = c.api === true ? { from: c.from.toLowerCase(), to: c.to.toLowerCase() }
                  : (c.api && typeof c.api === "object" ? c.api : null);
        if (api) {
          expectNew.set(api.to, `${t.to || t.from}.${c.to} (Request-Feld)`);
          forbidOld.set(api.from, `${t.from}.${c.from} (Request-Feld)`);
        }
      }
    }
  }
  // Ein Name, der auf beiden Seiten steht (NAME_LONG -> NAME, waehrend NAME
  // anderswo schon existiert), ist kein Befund.
  for (const k of expectNew.keys()) forbidOld.delete(k);

  note("\n=== Namen in den Antworten ===");
  const missing = [...expectNew].filter(([n]) => !seenKeys.has(n));
  const leftover = [...forbidOld].filter(([n]) => seenKeys.has(n));

  if (leftover.length) {
    for (const [n, where] of leftover) {
      failure(`alter Name "${n}" (${where}) kommt noch in einer Antwort vor ` +
              `- vermutlich liefert ihn eine View oder Funktion`);
    }
  } else {
    note("  ok  kein alter Name in den Antworten");
  }

  if (missing.length) {
    // Kein harter Fehler: ein Feld kann fehlen, weil zu dieser Domaene schlicht
    // keine Daten da sind. Aber es ist die Liste, die man durchgehen muss.
    note(`\n  ${missing.length} neue(r) Name(n) kamen in keiner Antwort vor.`);
    note("  Das ist erwartbar, wo keine Testdaten existieren - und der Ort, an dem");
    note("  ein View mit alten Ausgabespalten auffliegt. Jeden einzeln pruefen:\n");
    for (const [n, where] of missing) note(`    ${n.padEnd(28)} ${where}`);
  } else {
    note("  ok  jeder neue Name kam mindestens einmal vor");
  }

  // Fehlermeldungen, die einen Altnamen nennen: PostgREST schreibt den
  // Spaltennamen im Klartext in die Antwort.
  const inText = [...forbidOld.keys()].filter((n) =>
    seenText.some((t) => t.includes(n) && /column|does not exist|PGRST|schema cache/i.test(t)));
  for (const n of inText) failure(`eine Fehlermeldung nennt den alten Namen "${n}"`);
}

function summarise(mitarbeiter) {
  const n = (p) => (Array.isArray(p) ? p : p?.data)?.length ?? 0;
  note(`\n=== Ergebnis ===`);
  note(`  ${n(mitarbeiter)} Mitarbeiter, ${seenKeys.size} verschiedene Feldnamen gesehen`);
  if (fails.length === 0) {
    note("\n  Rauchtest sauber.\n");
    return;
  }
  console.log(`\n  ${fails.length} Befund(e):\n`);
  for (const f of fails) console.log(`    ${f}`);
  console.log();
  process.exitCode = 1;
}

run().catch((e) => {
  console.error("\n  Abbruch:", e?.stack || e, "\n");
  process.exit(1);
});
