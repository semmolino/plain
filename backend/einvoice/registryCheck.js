"use strict";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DRIFT-CHECK — hält die BT-Registry gegen den Code und gegen das echte XML
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Läuft als CLI (`npm run einvoice:check`) UND als Jest-Test
 * (`tests/einvoice_mapping.test.js`, also bei jedem Push).
 *
 * Geprüft wird:
 *
 *   1. **Integrität** — eindeutige Kennungen, bekannte Gruppen, zulässiger
 *      Status, und: ein Eintrag mit Pfad muss 'emitted' sein, einer ohne Pfad
 *      darf es nicht sein. Eine Zeile, die behauptet ausgegeben zu werden und
 *      keinen Pfad nennt, ist genau die Sorte Aussage, die in der Excel stand.
 *
 *   2. **Abdeckung vorwärts** — jeder Pfad einer 'emitted'-Zeile muss in einem
 *      der Musterbelege tatsächlich vorkommen. Fängt: Feld aus dem Builder
 *      entfernt, Zeile blieb stehen. Und: Element umbenannt.
 *
 *   3. **Abdeckung rückwärts** — jedes Blattelement der erzeugten Dokumente
 *      muss von einer Zeile oder von `STRUCTURAL_PATHS` beansprucht sein.
 *      Fängt: neues Feld im Builder ergänzt, Tabelle nicht nachgezogen. Das
 *      ist die Richtung, die eine gepflegte Tabelle NIE hat.
 *
 *   4. **Validator** — jedes `btField`, das eine Prüfregel meldet, muss es in
 *      der Registry geben. Fängt: Regel meldet eine erfundene BT-Nummer.
 *
 *   5. **Quelltext** — jede BT-Nummer, die in den E-Rechnungs-Dateien als
 *      Kommentar oder String steht, muss existieren. Fängt: Tippfehler
 *      (BT-1156) und BT-Nummern, die es nicht gibt.
 *
 * Rückgabe: { errors: string[], warnings: string[], stats }
 */

const fs = require("fs");
const path = require("path");

const registry = require("./btRegistry");
const { leafPaths } = require("./xmlPaths");
const { referenceDocuments } = require("./referenceDocument");

const BACKEND_DIR = path.join(__dirname, "..");

// Dateien, in denen BT-Nummern vorkommen dürfen und geprüft werden.
const SOURCE_FILES = [
  "services_einvoice_data.js",
  "services_einvoice_cii.js",
  "services_einvoice_ubl.js",
  "services_einvoice_validator.js",
  "services_einvoice_pdf_embed.js",
];

const VALID_STATUS = new Set(["emitted", "loaded-unused", "unsupported"]);
const VALID_CARDINALITY = /^[01]\.\.[1n]$/;

// BT-Nummern, die in Kommentaren stehen dürfen, obwohl die Registry sie nicht
// führt. Bewusst leer — wer eine braucht, trägt sie mit Begründung ein.
const COMMENT_BT_EXEMPT = new Set();

function runRegistryCheck() {
  const errors = [];
  const warnings = [];

  const entries = registry.all();

  // ── 1. Integrität ─────────────────────────────────────────────────────────
  const seen = new Set();
  for (const e of entries) {
    const where = `Registry ${e.id}`;
    if (!/^BT-\d+$/.test(e.id)) errors.push(`${where}: Kennung ist keine BT-Nummer.`);
    if (seen.has(e.id)) errors.push(`${where}: doppelt vergeben.`);
    seen.add(e.id);

    if (!VALID_STATUS.has(e.status)) errors.push(`${where}: unbekannter Status "${e.status}".`);
    if (!e.labelDe) errors.push(`${where}: labelDe fehlt.`);
    if (e.group && !registry.GROUPS[e.group]) errors.push(`${where}: unbekannte Gruppe "${e.group}".`);
    if (!VALID_CARDINALITY.test(e.cardinality)) {
      errors.push(`${where}: Kardinalität "${e.cardinality}" hat nicht die Form 0..1 / 1..1 / 0..n / 1..n.`);
    }

    const hasPath = !!(e.cii || e.ubl);
    if (hasPath && e.status !== "emitted") {
      errors.push(`${where}: nennt einen XML-Pfad, ist aber als "${e.status}" geführt.`);
    }
    if (!hasPath && e.status === "emitted") {
      errors.push(`${where}: ist als "emitted" geführt, nennt aber keinen XML-Pfad.`);
    }
    if (e.status === "emitted" && !e.source) {
      errors.push(`${where}: ausgegebenes Feld ohne Herkunftsangabe (source).`);
    }
    if (e.status === "loaded-unused" && !e.data) {
      errors.push(`${where}: als "loaded-unused" geführt, nennt aber kein Feld im Datenmodell.`);
    }
    if (e.status === "unsupported" && (e.data || e.source)) {
      errors.push(`${where}: als "unsupported" geführt, nennt aber Herkunft oder Datenfeld.`);
    }
    if (e.status !== "emitted" && !e.note && e.status === "loaded-unused") {
      warnings.push(`${where}: geladen und nie ausgegeben, ohne Begründung.`);
    }
  }

  // ── 2./3. Abdeckung gegen die Musterbelege ────────────────────────────────
  const { ciiPaths, ublPaths, perDocument } = renderReferencePaths();

  const claimedCii = new Set();
  const claimedUbl = new Set();
  for (const e of entries) {
    if (e.cii) claimedCii.add(e.cii);
    if (e.ubl) claimedUbl.add(e.ubl);
  }
  for (const s of registry.structuralPaths()) {
    (s.path.startsWith(registry.CII_ROOT) ? claimedCii : claimedUbl).add(s.path);
  }

  // vorwärts
  for (const e of registry.emitted()) {
    if (e.cii && !ciiPaths.has(e.cii)) {
      errors.push(`Registry ${e.id}: CII-Pfad kommt in keinem Musterbeleg vor — ${e.cii}`);
    }
    if (e.ubl && !ublPaths.has(e.ubl)) {
      errors.push(`Registry ${e.id}: UBL-Pfad kommt in keinem Musterbeleg vor — ${e.ubl}`);
    }
  }

  // rückwärts
  for (const p of ciiPaths) {
    if (!claimedCii.has(p)) errors.push(`CII-Element ohne Registry-Eintrag: ${p}`);
  }
  for (const p of ublPaths) {
    if (!claimedUbl.has(p)) errors.push(`UBL-Element ohne Registry-Eintrag: ${p}`);
  }

  // Strukturpfade, die es nicht mehr gibt, wären stille Altlast.
  for (const s of registry.structuralPaths()) {
    const pool = s.path.startsWith(registry.CII_ROOT) ? ciiPaths : ublPaths;
    if (!pool.has(s.path)) {
      warnings.push(`Strukturpfad kommt in keinem Musterbeleg mehr vor: ${s.path}`);
    }
  }

  // ── 4. Validator-Regeln ───────────────────────────────────────────────────
  const validatorSrc = readSource("services_einvoice_validator.js");
  for (const m of validatorSrc.matchAll(/mk(?:Error|Warning)\(\s*'([^']*)'\s*,\s*'(BT-\d+|BG-\d+)'/g)) {
    const [, rule, field] = m;
    if (field.startsWith("BG-")) {
      if (!registry.GROUPS[field]) errors.push(`Validator-Regel ${rule} meldet unbekannte Gruppe ${field}.`);
      continue;
    }
    if (!registry.has(field)) errors.push(`Validator-Regel ${rule} meldet unbekanntes Feld ${field}.`);
  }

  // ── 5. BT-Nummern im Quelltext ────────────────────────────────────────────
  for (const file of SOURCE_FILES) {
    const src = readSource(file);
    for (const m of src.matchAll(/\bBT-(\d+)\b/g)) {
      const id = `BT-${m[1]}`;
      if (!registry.has(id) && !COMMENT_BT_EXEMPT.has(id)) {
        errors.push(`${file}: nennt ${id}, die Registry kennt es nicht.`);
      }
    }
  }

  return {
    errors,
    warnings,
    stats: {
      ...registry.coverage(),
      musterbelege: perDocument.length,
      ciiBlattpfade: ciiPaths.size,
      ublBlattpfade: ublPaths.size,
    },
  };
}

/** Musterbelege rendern und ihre Blattpfade einsammeln. */
function renderReferencePaths() {
  // Lazy, damit ein Ladefehler in den Buildern hier als Fehler sichtbar wird
  // und nicht schon beim Import dieser Datei.
  const { generateCiiXml } = require("../services_einvoice_cii");
  const { generateUblXml } = require("../services_einvoice_ubl");

  const ciiPaths = new Set();
  const ublPaths = new Set();
  const perDocument = [];

  for (const doc of referenceDocuments()) {
    const cii = generateCiiXml(doc.data, "EXTENDED");
    const ubl = generateUblXml(doc.data);
    for (const l of leafPaths(cii)) ciiPaths.add(l.path);
    for (const l of leafPaths(ubl)) ublPaths.add(l.path);
    perDocument.push({ name: doc.name, cii, ubl });
  }

  return { ciiPaths, ublPaths, perDocument };
}

function readSource(name) {
  return fs.readFileSync(path.join(BACKEND_DIR, name), "utf8");
}

module.exports = { runRegistryCheck, renderReferencePaths };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const { errors, warnings, stats } = runRegistryCheck();
  console.log("E-Rechnung — Mapping-Drift-Check");
  console.log(
    `  ${stats.emitted} Felder ausgegeben, ${stats["loaded-unused"]} geladen aber ungenutzt, `
    + `${stats.unsupported} nicht unterstützt (${stats.total} insgesamt katalogisiert)`
  );
  console.log(`  ${stats.musterbelege} Musterbelege, ${stats.ciiBlattpfade} CII- und ${stats.ublBlattpfade} UBL-Blattpfade geprüft`);
  for (const w of warnings) console.warn(`  [Warnung] ${w}`);
  for (const e of errors) console.error(`  [Fehler]  ${e}`);
  if (errors.length) {
    console.error(`\n${errors.length} Fehler. Siehe docs/EINVOICE_BT_MAPPING.md und backend/einvoice/btRegistry.js.`);
    process.exit(1);
  }
  console.log("\nKein Drift.");
}
