"use strict";

/**
 * Drift-Check — bewacht das Capability-Manifest gegen den restlichen Code.
 *
 * Läuft als CLI (`npm run license:check`) UND als Jest-Test (CI bei jedem Push).
 *
 * Geprüft wird:
 *   1. Manifest-Integrität (via registry.validateManifest)
 *   2. Permission-Verweise  — jede in einer Capability genannte Permission muss
 *      im RBAC-Katalog (migrations 0062/0063/…) existieren.   [Fehler]
 *   3. Undeklarierte Code-Gates — jeder im Code verwendete Feature-Key
 *      (requireFeature / HasFeature / useFeature / hasFeature) muss im
 *      Manifest existieren.                                    [Fehler]
 *   4. Tote Capabilities — im Manifest, aber nie als Gate referenziert.
 *      Nur ab dem Moment relevant, wo überhaupt Gates existieren. [Warnung]
 *
 * Hinweis: Der DB-Abgleich (Manifest ↔ PLAN_CAPABILITY „nicht paketiert") läuft
 * nicht hier (kein DB-Zugriff in CI), sondern im Sync-/Audit-Tooling der
 * Owner-Konsole. Siehe docs/LICENSE_TIERS_CONCEPT.md §5.
 */

const fs = require("fs");
const path = require("path");
const registry = require("./registry");

const REPO_ROOT = path.join(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

// Verzeichnisse, die beim Code-Scan rekursiv durchsucht werden …
const SCAN_DIRS = [
  path.join(__dirname, ".."), // backend
  path.join(REPO_ROOT, "frontend-react", "src"),
];
// … und Verzeichnis-/Dateinamen, die übersprungen werden.
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", "playwright-report",
  "test-results", ".vite", "android", "uploads", "migrations",
  "licensing", // eigenes Tooling enthält Beispiel-Pattern in Kommentaren, keine echten Gates
]);
const CODE_EXT = new Set([".js", ".jsx", ".ts", ".tsx"]);
const MAX_FILE_BYTES = 1_000_000;

// Feature-Gate-Aufrufe, die der Scanner erkennt.
const GATE_PATTERNS = [
  /requireFeature\(\s*['"`]([^'"`]+)['"`]/g,
  /requireAnyFeature\(\s*['"`]([^'"`]+)['"`]/g,
  /\buseFeature\(\s*['"`]([^'"`]+)['"`]/g,
  /\bhasFeature\(\s*['"`]([^'"`]+)['"`]/g,
  /feature\s*=\s*\{?\s*['"`]([^'"`]+)['"`]/g, // <HasFeature feature="x"> / feature={'x'}
];

/** Liest alle Permission-Keys aus den Migration-SQL-Dateien (PERMISSION-Inserts). */
function loadCatalogPermissionKeys() {
  const keys = new Set();
  let files = [];
  try {
    files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  } catch {
    return null; // Migrations nicht gefunden → Aufrufer behandelt das tolerant
  }
  // Matcht die Wertetupel ('key','module','action', …) der PERMISSION-Inserts.
  const tuple = /\(\s*'([a-z0-9_.]+)'\s*,\s*'[a-z_]+'\s*,\s*'[a-z_]+'\s*,/g;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    if (!/INTO\s+"PERMISSION"/i.test(sql)) continue;
    let m;
    while ((m = tuple.exec(sql)) !== null) keys.add(m[1]);
  }
  return keys;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (CODE_EXT.has(path.extname(e.name))) {
      out.push(path.join(dir, e.name));
    }
  }
}

/** Scannt den Code nach Feature-Gate-Keys → Map<key, [relPath, …]>. */
function scanFeatureGateUsage() {
  const files = [];
  for (const d of SCAN_DIRS) walk(d, files);
  const usage = new Map();
  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;
    const src = fs.readFileSync(file, "utf8");
    for (const re of GATE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const key = m[1];
        const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
        if (!usage.has(key)) usage.set(key, new Set());
        usage.get(key).add(rel);
      }
    }
  }
  // Sets → Arrays
  return new Map([...usage].map(([k, v]) => [k, [...v]]));
}

/** Führt alle Drift-Prüfungen aus. @returns {{errors:string[],warnings:string[],stats:object}} */
function runDriftCheck() {
  const errors = [];
  const warnings = [];

  // 1) Manifest-Integrität
  const v = registry.validateManifest();
  errors.push(...v.errors);
  warnings.push(...v.warnings);

  // 2) Permission-Verweise
  const catalog = loadCatalogPermissionKeys();
  if (catalog === null || catalog.size === 0) {
    warnings.push("Permission-Katalog konnte nicht aus Migrationen gelesen werden — Verweis-Prüfung übersprungen.");
  } else {
    for (const { capabilityKey, permissionKey } of registry.capabilityPermissionLinks()) {
      if (!catalog.has(permissionKey)) {
        errors.push(`Capability '${capabilityKey}' verweist auf unbekannte Permission '${permissionKey}' (nicht im Katalog 0062/0063).`);
      }
    }
  }

  // 3) + 4) Code-Gates
  const manifestKeys = new Set(registry.allCapabilityKeys());
  const usage = scanFeatureGateUsage();
  for (const [key, locations] of usage) {
    if (!manifestKeys.has(key)) {
      errors.push(`Undeklariertes Feature-Gate '${key}' verwendet in: ${locations.join(", ")} — fehlt im Manifest.`);
    }
  }
  if (usage.size > 0) {
    for (const key of manifestKeys) {
      if (!usage.has(key)) warnings.push(`Capability '${key}' ist im Manifest, wird aber nirgends als Gate referenziert (tot?).`);
    }
  }

  return {
    errors,
    warnings,
    stats: {
      modules: registry.getModules().length,
      capabilities: manifestKeys.size,
      permissionLinks: registry.capabilityPermissionLinks().length,
      catalogPermissions: catalog ? catalog.size : 0,
      gateUsages: usage.size,
    },
  };
}

module.exports = { runDriftCheck, loadCatalogPermissionKeys, scanFeatureGateUsage };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const { errors, warnings, stats } = runDriftCheck();
  console.log("License Drift-Check");
  console.log(
    `  Module: ${stats.modules} · Capabilities: ${stats.capabilities} · ` +
      `Permission-Links: ${stats.permissionLinks} · Katalog-Permissions: ${stats.catalogPermissions} · ` +
      `Code-Gates: ${stats.gateUsages}`
  );
  for (const w of warnings) console.log(`  ⚠️  ${w}`);
  if (errors.length === 0) {
    console.log(`  ✅  Kein Drift (${warnings.length} Warnung(en)).`);
    process.exit(0);
  }
  for (const e of errors) console.error(`  ❌  ${e}`);
  console.error(`\n  ${errors.length} Fehler — bitte beheben.`);
  process.exit(1);
}
