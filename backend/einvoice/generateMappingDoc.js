"use strict";

/**
 * Erzeugt `docs/EINVOICE_BT_MAPPING.md` aus der BT-Registry.
 *
 * Das ist der Ersatz für die Excel-Tabelle — mit einem Unterschied: die
 * Tabelle wird nicht mehr gepflegt, sondern abgeleitet. Sie kann deshalb nicht
 * mehr von der Wirklichkeit abweichen, sondern nur noch veraltet im Repo
 * liegen, und genau das fängt der Test in `tests/einvoice_mapping.test.js`.
 *
 * Aufruf:  npm run einvoice:gen  (aus backend/)
 *
 * Die erzeugte Datei gehört mit ins Commit — sonst ist sie im Review nicht zu
 * sehen, und das war der halbe Grund, die Excel loszuwerden.
 */

const fs = require("fs");
const path = require("path");

const registry = require("./btRegistry");
const codelists = require("./codelists");
const profiles = require("./profiles");

const DOC_PATH = path.join(__dirname, "..", "..", "docs", "EINVOICE_BT_MAPPING.md");

const STATUS_LABEL = {
  emitted: "✅ ausgegeben",
  "loaded-unused": "⚠️ geladen, ungenutzt",
  unsupported: "— nicht unterstützt",
};

/** Lange XML-Pfade lesbar kürzen; der volle Pfad steht in der Registry. */
function shortPath(p) {
  if (!p) return "—";
  return "`" + p
    .replace(/^rsm:CrossIndustryInvoice\/rsm:SupplyChainTradeTransaction\//, "…/")
    .replace(/^rsm:CrossIndustryInvoice\//, "…/")
    .replace(/^Invoice\//, "")
    + "`";
}

function esc(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function build() {
  const cov = registry.coverage();
  const entries = registry.all().slice().sort((a, b) => registry.btNumber(a.id) - registry.btNumber(b.id));

  const out = [];
  out.push("# E-Rechnung — Feld-Mapping (EN 16931)");
  out.push("");
  out.push("> **Erzeugte Datei — nicht von Hand bearbeiten.**");
  out.push("> Quelle: `backend/einvoice/btRegistry.js`. Neu erzeugen mit `npm run einvoice:gen`");
  out.push("> (aus `backend/`). `npm run einvoice:check` und der Jest-Test");
  out.push("> `tests/einvoice_mapping.test.js` halten beides gegen das tatsächlich erzeugte XML.");
  out.push("");
  out.push("Diese Tabelle ersetzt die frühere `backend/config/Mapping BT.xlsx`. Der Unterschied");
  out.push("ist nicht das Format: die Excel *behauptete* ein Mapping, diese Tabelle wird aus dem");
  out.push("Code abgeleitet und gegen zwei Musterbelege geprüft — vorwärts (jede Zeile muss im");
  out.push("XML vorkommen) **und** rückwärts (jedes XML-Element muss eine Zeile haben).");
  out.push("");

  out.push("## Abdeckung");
  out.push("");
  out.push("| Zustand | Felder |");
  out.push("|---|---:|");
  out.push(`| ✅ ausgegeben | ${cov.emitted} |`);
  out.push(`| ⚠️ geladen, aber von keinem Builder ausgegeben | ${cov["loaded-unused"]} |`);
  out.push(`| — bewusst nicht unterstützt | ${cov.unsupported} |`);
  out.push(`| **katalogisiert insgesamt** | **${cov.total}** |`);
  out.push("");

  out.push("## Erzeugte Formate");
  out.push("");
  out.push("| Syntax | Kennung |");
  out.push("|---|---|");
  for (const [key, p] of Object.entries(profiles.CII_PROFILES)) {
    out.push(`| CII · ${esc(p.labelDe)}${key === profiles.CII_DEFAULT_PROFILE ? " *(Vorgabe)*" : ""} | \`${p.id}\` |`);
  }
  for (const p of Object.values(profiles.UBL_FLAVORS)) {
    out.push(`| UBL · ${esc(p.labelDe)} | \`${p.customizationId}\` |`);
  }
  out.push("");

  out.push("## Felder");
  out.push("");
  out.push("Pfade sind gekürzt: `…/` steht im CII für");
  out.push("`rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/`, im UBL entfällt das");
  out.push("führende `Invoice/`. Die vollständigen Pfade stehen in der Registry.");
  out.push("");

  const byGroup = new Map();
  for (const e of entries) {
    const key = e.group || "—";
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(e);
  }

  const groupOrder = ["—", ...Object.keys(registry.GROUPS)];
  for (const g of groupOrder) {
    const rows = byGroup.get(g);
    if (!rows || rows.length === 0) continue;
    out.push(g === "—" ? "### Dokumentebene" : `### ${g} — ${registry.GROUPS[g]}`);
    out.push("");
    out.push("| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |");
    out.push("|---|---|---|---|---|---|---|");
    for (const e of rows) {
      out.push([
        "", e.id, esc(e.labelDe), e.cardinality,
        e.source ? esc(e.source) : "—",
        shortPath(e.cii) + (e.attr ? ` *(@${e.attr})*` : ""),
        shortPath(e.ubl) + (e.attr ? ` *(@${e.attr})*` : ""),
        STATUS_LABEL[e.status], "",
      ].join(" | ").trim());
    }
    out.push("");
    const notes = rows.filter((e) => e.note || e.discriminator);
    if (notes.length) {
      for (const e of notes) {
        const disc = e.discriminator
          ? `*(Unterscheidung: CII ${e.discriminator.cii}, UBL ${e.discriminator.ubl})*`
          : "";
        const text = [esc(e.note || ""), disc].filter(Boolean).join(" ");
        out.push(`- **${e.id}** — ${text}`);
      }
      out.push("");
    }
  }

  out.push("## Strukturelemente ohne eigenen Business Term");
  out.push("");
  out.push("Elemente, die die jeweilige Syntax verlangt, die aber kein Feld der EN 16931");
  out.push("tragen. Die Rückwärtsprüfung würde sie sonst als unbeanspruchte Elemente melden —");
  out.push("wer hier einträgt statt eine Feldzeile anzulegen, muss begründen warum.");
  out.push("");
  out.push("| Pfad | Warum kein BT |");
  out.push("|---|---|");
  for (const s of registry.structuralPaths()) {
    out.push(`| ${shortPath(s.path)} | ${esc(s.reason)} |`);
  }
  out.push("");

  out.push("## Codelisten");
  out.push("");
  out.push("Wertevorräte, die nicht plan&simple vergibt, sondern die Norm. Quelle:");
  out.push("`backend/einvoice/codelists.js`.");
  out.push("");
  out.push("### UNTDID 1001 — Belegart (BT-3)");
  out.push("");
  out.push("| Code | Bedeutung | Syntax |");
  out.push("|---|---|---|");
  for (const c of Object.values(codelists.UNTDID_1001)) {
    out.push(`| \`${c.code}\` | ${esc(c.labelDe)} | ${c.syntaxes.join(", ")} |`);
  }
  out.push("");
  out.push("### UNTDID 5305 — Umsatzsteuerkategorie (BT-118 / BT-151)");
  out.push("");
  out.push("| Code | Bedeutung | Satz 0? | Befreiungsgrund nötig? | Standardtext |");
  out.push("|---|---|---|---|---|");
  for (const c of Object.values(codelists.UNTDID_5305)) {
    out.push(`| \`${c.code}\` | ${esc(c.labelDe)}${c.hintDe ? ` (${esc(c.hintDe)})` : ""} | `
      + `${c.zeroRate ? "ja" : "nein"} | ${c.requiresReason ? "ja" : "nein"} | `
      + `${c.defaultReasonDe ? esc(c.defaultReasonDe) : "—"} |`);
  }
  out.push("");
  out.push("### UNTDID 4461 — Zahlungsart (BT-81)");
  out.push("");
  out.push("| Code | Bedeutung |");
  out.push("|---|---|");
  for (const c of Object.values(codelists.UNTDID_4461)) out.push(`| \`${c.code}\` | ${esc(c.labelDe)} |`);
  out.push("");
  out.push(`plan&simple erzeugt ausschließlich \`${codelists.PAYMENT_MEANS_SEPA_CREDIT_TRANSFER}\`.`);
  out.push("");
  out.push("### UN/ECE Rec. 20 — Mengeneinheit (BT-130 / BT-150)");
  out.push("");
  out.push("| Code | Bedeutung |");
  out.push("|---|---|");
  for (const c of Object.values(codelists.UNECE_REC20)) out.push(`| \`${c.code}\` | ${esc(c.labelDe)} |`);
  out.push("");
  out.push("### UNTDID 4451 — Betreffcode der Anmerkung (BT-21)");
  out.push("");
  out.push("| Code | Bedeutung |");
  out.push("|---|---|");
  for (const c of Object.values(codelists.UNTDID_4451)) out.push(`| \`${c.code}\` | ${esc(c.labelDe)} |`);
  out.push("");

  return out.join("\n") + "\n";
}

function write() {
  fs.writeFileSync(DOC_PATH, build(), "utf8");
  return DOC_PATH;
}

module.exports = { build, write, DOC_PATH };

if (require.main === module) {
  console.log(`geschrieben: ${write()}`);
}
