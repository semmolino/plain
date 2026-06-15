"use strict";

/**
 * Generiert backend/migrations/0070b_license_capabilities_seed.sql aus dem
 * Capability-Manifest. NICHT von Hand editieren — `npm run license:gen`.
 *
 * Spielt Module, Capabilities und Capability→Permission-Links ein und füllt den
 * internen Plan 'full' mit ALLEN Capabilities (NUMERIC_LIMIT NULL = unbegrenzt).
 * Idempotent (ON CONFLICT). Voraussetzung: 0070 hat die Tabellen + Plan 'full' angelegt.
 */

const fs = require("fs");
const path = require("path");
const registry = require("./registry");

const OUT = path.join(__dirname, "..", "migrations", "0070b_license_capabilities_seed.sql");
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const qn = (s) => (s === null || s === undefined ? "NULL" : q(s));

function build() {
  const modules = registry.getModules();
  const caps = registry.getCapabilities();
  const links = registry.capabilityPermissionLinks();

  const L = [];
  L.push("-- ─────────────────────────────────────────────────────────────────────────────");
  L.push("-- Migration 0070b: License Capabilities Seed  (AUTO-GENERIERT)");
  L.push("-- ─────────────────────────────────────────────────────────────────────────────");
  L.push("-- NICHT VON HAND EDITIEREN. Quelle: backend/licensing/capabilities.manifest.js");
  L.push("-- Neu erzeugen mit:  npm run license:gen  (--prefix backend)");
  L.push("-- Voraussetzung: Migration 0070 (Tabellen + Plan 'full') ist eingespielt.");
  L.push("-- ─────────────────────────────────────────────────────────────────────────────");
  L.push("");

  // Module
  L.push('-- 1. Module');
  L.push('INSERT INTO "LICENSE_MODULE" ("KEY","LABEL_DE","POSITION") VALUES');
  L.push(
    modules.map((m) => `  (${q(m.key)}, ${q(m.labelDe)}, ${m.position || 0})`).join(",\n") + "\n" +
    'ON CONFLICT ("KEY") DO UPDATE SET "LABEL_DE" = EXCLUDED."LABEL_DE", "POSITION" = EXCLUDED."POSITION";'
  );
  L.push("");

  // Capabilities
  L.push('-- 2. Capabilities');
  L.push('INSERT INTO "LICENSE_CAPABILITY" ("KEY","MODULE_KEY","LABEL_DE","TYPE","UNIT","POSITION") VALUES');
  L.push(
    caps.map((c, i) =>
      `  (${q(c.key)}, ${q(c.module)}, ${q(c.labelDe)}, ${q(c.type)}, ${qn(c.unit || null)}, ${(i + 1) * 10})`
    ).join(",\n") + "\n" +
    'ON CONFLICT ("KEY") DO UPDATE SET\n' +
    '  "MODULE_KEY" = EXCLUDED."MODULE_KEY",\n' +
    '  "LABEL_DE"   = EXCLUDED."LABEL_DE",\n' +
    '  "TYPE"       = EXCLUDED."TYPE",\n' +
    '  "UNIT"       = EXCLUDED."UNIT",\n' +
    '  "POSITION"   = EXCLUDED."POSITION";'
  );
  L.push("");

  // Capability → Permission
  L.push('-- 3. Capability → Permission (Layer-Verknüpfung)');
  if (links.length === 0) {
    L.push("-- (keine Verknüpfungen im Manifest)");
  } else {
    L.push('INSERT INTO "CAPABILITY_PERMISSION" ("CAPABILITY_KEY","PERMISSION_KEY") VALUES');
    L.push(
      links.map((l) => `  (${q(l.capabilityKey)}, ${q(l.permissionKey)})`).join(",\n") + "\n" +
      "ON CONFLICT DO NOTHING;"
    );
  }
  L.push("");

  // Full-Plan ⊇ alle Capabilities
  L.push("-- 4. Interner Plan 'full' bekommt ALLE Capabilities (Limit NULL = unbegrenzt)");
  L.push('INSERT INTO "PLAN_CAPABILITY" ("PLAN_ID","CAPABILITY_KEY","NUMERIC_LIMIT")');
  L.push('  SELECT p."ID", c."KEY", NULL');
  L.push('  FROM "LICENSE_PLAN" p CROSS JOIN "LICENSE_CAPABILITY" c');
  L.push('  WHERE p."KEY" = \'full\'');
  L.push("ON CONFLICT DO NOTHING;");
  L.push("");

  return L.join("\n");
}

if (require.main === module) {
  const sql = build();
  fs.writeFileSync(OUT, sql, "utf8");
  console.log(`✅  geschrieben: ${path.relative(path.join(__dirname, "..", ".."), OUT).replace(/\\/g, "/")}`);
}

module.exports = { build };
