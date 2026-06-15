"use strict";

/**
 * Generiert docs/LICENSE_CAPABILITIES.md aus dem Capability-Manifest.
 * NICHT von Hand editieren — `npm run license:gen`.
 *
 * Zeigt pro Capability die KONKRETEN Funktionen dahinter (die Labels der
 * verknuepften RBAC-Permissions), damit klar ist, was ein Flag freischaltet.
 */

const fs = require("fs");
const path = require("path");
const registry = require("./registry");

const OUT = path.join(__dirname, "..", "..", "docs", "LICENSE_CAPABILITIES.md");

/** Liest KEY -> LABEL_DE der Permissions aus den Migrationen (fuer die Detail-Spalte). */
function loadPermissionLabels() {
  const dir = path.join(__dirname, "..", "migrations");
  const map = new Map();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  } catch {
    return map;
  }
  // Matcht ('modul.aktion','module','action','LABEL_DE', ...). Key mit Punkt ->
  // schliesst MODULE-IN-Listen ('dashboard','addresses',…) aus.
  const re = /\(\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'\s*,\s*'[a-z_]+'\s*,\s*'[a-z_]+'\s*,\s*'([^']*)'/g;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    if (!/INTO\s+"PERMISSION"/i.test(sql)) continue;
    let m;
    while ((m = re.exec(sql)) !== null) map.set(m[1], m[2]);
  }
  return map;
}

function build() {
  const modules = registry.getModules();
  const caps = registry.getCapabilities();
  const links = registry.capabilityPermissionLinks().length;
  const labels = loadPermissionLabels();

  const L = [];
  L.push("# Lizenz-Capability-Katalog (auto-generiert)");
  L.push("");
  L.push("> **Nicht von Hand editieren.** Quelle: `backend/licensing/capabilities.manifest.js`.");
  L.push("> Neu erzeugen mit `npm run license:gen --prefix backend`.");
  L.push("> Architektur: [LICENSE_TIERS_CONCEPT.md](LICENSE_TIERS_CONCEPT.md) ·");
  L.push("> Workflow: [LICENSE_DEVELOPMENT_CHECKLIST.md](LICENSE_DEVELOPMENT_CHECKLIST.md).");
  L.push("");
  L.push(`**Stand:** ${registry.SINCE} · ${modules.length} Module · ${caps.length} Capabilities · ${links} Permission-Verknuepfungen`);
  L.push("");
  L.push("Jede **Capability** ist ein Schalter, den du je Lizenztyp in der Matrix an/aus stellst.");
  L.push("Die Spalte **Enthaltene Funktionen** zeigt, welche konkreten Aktionen/Ansichten dahinter liegen");
  L.push("(= die zugehoerigen RBAC-Rechte). Ein Strich (eigene Funktion) = Feature ohne separates Recht, greift direkt.");
  L.push("");
  L.push("> Die Plan-zu-Capability-Zuordnung selbst liegt in der DB (`PLAN_CAPABILITY`) und wird in der Owner-Konsole gepflegt — bewusst **nicht** Teil dieses generierten Katalogs.");
  L.push("");

  for (const m of modules) {
    const list = caps.filter((c) => c.module === m.key);
    if (list.length === 0) continue;
    L.push(`## ${m.labelDe} \`${m.key}\``);
    L.push("");
    L.push("| Capability | Typ | Enthaltene Funktionen |");
    L.push("|---|---|---|");
    for (const c of list) {
      const type = c.type === "metered" ? `metered (${c.unit})` : "boolean";
      const fns = (c.permissions && c.permissions.length)
        ? c.permissions.map((p) => labels.get(p) || `\`${p}\``).join("; ")
        : "— eigene Funktion";
      L.push(`| **${c.labelDe}**<br>\`${c.key}\` | ${type} | ${fns} |`);
    }
    L.push("");
  }

  return L.join("\n");
}

if (require.main === module) {
  const md = build();
  fs.writeFileSync(OUT, md, "utf8");
  console.log(`✅  geschrieben: ${path.relative(path.join(__dirname, "..", ".."), OUT).replace(/\\/g, "/")}`);
}

module.exports = { build };
