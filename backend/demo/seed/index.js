"use strict";

/**
 * Demo-Bewegungsdaten-Generator — Orchestrator.
 *
 * Erzeugt auf Basis der MANUELL angelegten Stammdaten (Tenant, Projekte,
 * Strukturen, Honorare, Zuordnungen) einen mehrjährigen, konsistenten Verlauf
 * an Bewegungsdaten, indem die ECHTEN Backend-Services angesteuert werden.
 * Deterministisch (fixer Seed) und wiederholbar (Reset + Seed).
 *
 * Nutzung (Env SUPABASE_URL + SUPABASE_SERVICE_KEY):
 *   node demo/seed/index.js --tenant 42 --emit-timeline     # 1) Timeline-Vorlage schreiben
 *   node demo/seed/index.js --tenant 42                       # 2) Dry-Run (nichts wird geschrieben)
 *   node demo/seed/index.js --tenant 42 --reset --apply --force   # 3) echt: Reset + Seed
 *
 * Flags:
 *   --tenant <ID>         Ziel-Mandant (oder Env DEMO_TENANT_ID)
 *   --emit-timeline       Projekt-Timeline-Vorlage schreiben und beenden
 *   --timeline <pfad>     abweichenden Timeline-Pfad verwenden
 *   --apply               tatsächlich schreiben (sonst Dry-Run)
 *   --reset               Bewegungsdaten vorher löschen (nur mit --force wirklich)
 *   --force               Sicherheitsbestätigung für destruktive Aktionen
 *   --only a,b            nur diese Domänen (bookings,progress,invoicing,hr)
 *   --skip a,b            diese Domänen auslassen
 *   --seed <n>            Zufalls-Seed überschreiben
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

const { makeSupabase, arg, hasFlag } = require("./lib/db");
const baseConfig = require("./config");
const { makeRng } = require("./lib/rng");
const { loadMasterData, summarize } = require("./lib/masterData");
const timelineLib = require("./lib/timeline");
const { resetMovements } = require("./lib/reset");

const GENERATORS = {
  bookings: require("./generators/bookings"),
  progress: require("./generators/progress"),
  invoicing: require("./generators/invoicing"),
  hr: require("./generators/hr"),
};
const ORDER = ["bookings", "progress", "invoicing", "hr"];

function parseDomains(cfg) {
  const only = arg("only", null);
  const skip = arg("skip", null);
  const set = {};
  for (const d of ORDER) set[d] = cfg.domains[d] !== false;
  if (typeof only === "string") {
    const list = only.split(",").map((s) => s.trim());
    for (const d of ORDER) set[d] = list.includes(d);
  }
  if (typeof skip === "string") {
    const list = skip.split(",").map((s) => s.trim());
    for (const d of list) if (d in set) set[d] = false;
  }
  return set;
}

async function main() {
  const tenantId = parseInt(arg("tenant", process.env.DEMO_TENANT_ID), 10);
  if (!Number.isFinite(tenantId)) {
    console.error("✗ --tenant <ID> ist erforderlich (oder DEMO_TENANT_ID).");
    process.exit(1);
  }

  const cfg = { ...baseConfig };
  const seedOverride = arg("seed", null);
  if (seedOverride && seedOverride !== true) cfg.seed = parseInt(seedOverride, 10);

  const apply = hasFlag("apply");
  const doReset = hasFlag("reset");
  const force = hasFlag("force");
  const log = (...a) => console.log(...a);

  const supabase = makeSupabase();

  // Stammdaten laden
  const md = await loadMasterData(supabase, tenantId);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(summarize(md));
  console.log("──────────────────────────────────────────────────────────────");
  if (md.errors.length) {
    console.error("✗ Abbruch — Stammdaten unvollständig:\n  " + md.errors.join("\n  "));
    process.exit(1);
  }
  if (md.warnings.length) {
    console.log("Hinweise:\n  " + md.warnings.join("\n  "));
    console.log("──────────────────────────────────────────────────────────────");
  }

  // Timeline-Vorlage schreiben und beenden
  if (hasFlag("emit-timeline")) {
    const file = timelineLib.emitTemplate(md, arg("timeline", null) === true ? null : arg("timeline", null));
    console.log(`✅ Timeline-Vorlage geschrieben: ${file}`);
    console.log("   → Start/Ende/closed pro Projekt anpassen, dann Dry-Run starten.");
    return;
  }

  // Timeline laden
  const timeline = timelineLib.load(md, arg("timeline", null) === true ? null : arg("timeline", null));
  if (!timeline.exists) {
    console.error(`✗ Keine Timeline gefunden (${timeline.file}).`);
    console.error("  Zuerst:  node demo/seed/index.js --tenant " + tenantId + " --emit-timeline");
    process.exit(1);
  }
  // Projekte ohne Timeline-Eintrag melden
  const missing = md.projects.filter((p) => !timeline.byProject.has(String(p.ID)));
  if (missing.length) {
    console.log(`Hinweis: ${missing.length} Projekt(e) ohne Timeline-Eintrag werden übersprungen.`);
  }

  const mode = apply ? "APPLY (schreibt)" : "DRY-RUN (schreibt nichts)";
  console.log(`Modus: ${mode}   ·   Seed: ${cfg.seed}`);
  if (apply && !force && doReset) {
    console.error("✗ --reset mit --apply erfordert zusätzlich --force (Sicherheitsbestätigung).");
    process.exit(1);
  }

  // Reset
  if (doReset) {
    console.log(`\n▶ Reset Bewegungsdaten (${force && apply ? "wird ausgeführt" : "Vorschau"}):`);
    const r = await resetMovements({ supabase, tenantId, apply: apply && force, log });
    if (!(apply && force)) {
      const totals = Object.entries(r.deleted).map(([t, n]) => `${t}:${n}`).join("  ");
      console.log("  (Vorschau) würde löschen → " + (totals || "nichts"));
    }
  }

  // Domänen
  const domains = parseDomains(cfg);
  const rng = makeRng(cfg.seed);
  const results = {};
  for (const d of ORDER) {
    if (!domains[d]) continue;
    console.log(`\n▶ ${d}`);
    results[d] = await GENERATORS[d].generate({
      supabase,
      md,
      timeline,
      cfg,
      rng: rng.derive(d),
      log,
      apply,
    });
  }

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log(apply ? "✅ Fertig (geschrieben)." : "✅ Dry-Run fertig — mit --apply --force echt ausführen.");
}

main().catch((e) => {
  console.error("✗ Unerwarteter Fehler:", e?.stack || e?.message || e);
  process.exit(1);
});
