"use strict";

/**
 * Generiert docs/LICENSE_CAPABILITIES.md aus dem Capability-Manifest.
 * NICHT von Hand editieren — `npm run license:gen`.
 */

const fs = require("fs");
const path = require("path");
const registry = require("./registry");

const OUT = path.join(__dirname, "..", "..", "docs", "LICENSE_CAPABILITIES.md");

function build() {
  const modules = registry.getModules();
  const caps = registry.getCapabilities();
  const links = registry.capabilityPermissionLinks().length;

  const L = [];
  L.push("# Lizenz-Capability-Katalog (auto-generiert)");
  L.push("");
  L.push("> **Nicht von Hand editieren.** Quelle: `backend/licensing/capabilities.manifest.js`.");
  L.push("> Neu erzeugen mit `npm run license:gen --prefix backend`.");
  L.push("> Architektur: [LICENSE_TIERS_CONCEPT.md](LICENSE_TIERS_CONCEPT.md) ·");
  L.push("> Workflow: [LICENSE_DEVELOPMENT_CHECKLIST.md](LICENSE_DEVELOPMENT_CHECKLIST.md).");
  L.push("");
  L.push(`**Stand:** ${registry.SINCE} · ${modules.length} Module · ${caps.length} Capabilities · ${links} Permission-Verknüpfungen`);
  L.push("");
  L.push("> Die Plan↔Capability-Zuordnung liegt in der DB (`PLAN_CAPABILITY`) und wird über die Owner-Konsole gepflegt — sie ist bewusst **nicht** Teil dieses generierten Katalogs.");
  L.push("");

  for (const m of modules) {
    const list = caps.filter((c) => c.module === m.key);
    if (list.length === 0) continue;
    L.push(`## ${m.labelDe} \`${m.key}\``);
    L.push("");
    L.push("| Capability | Bezeichnung | Typ | Gated Permissions |");
    L.push("|---|---|---|---|");
    for (const c of list) {
      const type = c.type === "metered" ? `metered (${c.unit})` : "boolean";
      const perms = (c.permissions && c.permissions.length)
        ? c.permissions.map((p) => `\`${p}\``).join(", ")
        : "—";
      L.push(`| \`${c.key}\` | ${c.labelDe} | ${type} | ${perms} |`);
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
