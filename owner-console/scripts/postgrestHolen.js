#!/usr/bin/env node
"use strict";

// ============================================================================
// postgrestHolen.js — PostgREST fuer den Arbeitsplatz holen
//
// Gegenstueck zu bin/fetch-postgrest.sh, das dasselbe beim Scalingo-Build fuer
// Linux tut. Die Version wird bewusst DORT ausgelesen statt hier ein zweites
// Mal hingeschrieben: laufen die beiden auseinander, prueft die Konsole gegen
// ein anderes PostgREST als das, das im Betrieb antwortet — und das ist genau
// die Art Abweichung, die man erst merkt, wenn sie schon etwas angerichtet hat.
//
// WINDOWS BRAUCHT LIBPQ DAZU
//   Das Linux-Binary ist statisch gelinkt und braucht nichts weiter. Das
//   Windows-Binary nicht: es laedt libpq.dll und deren vier Begleiter nach.
//   Fehlen sie, startet postgrest.exe mit
//       "error while loading shared libraries: LIBPQ.dll"
//   und sonst nichts — kein Hinweis darauf, dass eine DLL gemeint ist, die man
//   sich selbst danebenlegen muss.
//
//   Ein offizielles Einzelpaket dafuer gibt es nicht; die PostgreSQL-Binaries
//   sind 315 MB fuer fuenf Dateien. Deshalb werden sie aus einer bereits
//   vorhandenen Installation kopiert (PostgreSQL-Client, TablePlus, pgAdmin).
//   Nach dem Kopieren steht alles in bin/ — eine spaetere Deinstallation der
//   Quelle macht die Konsole also nicht wieder kaputt.
//
// Das Ergebnis wird nachgewiesen, nicht behauptet: zum Schluss laeuft
// `postgrest --version`. Nur wenn das antwortet, gilt der Schritt als fertig.
// ============================================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const WURZEL = path.join(__dirname, "..");
const BIN_DIR = path.join(WURZEL, "bin");
const IST_WINDOWS = process.platform === "win32";
const ZIEL = path.join(BIN_DIR, IST_WINDOWS ? "postgrest.exe" : "postgrest");

// Die vollstaendige Kette hinter postgrest.exe 14.16: libpq zieht OpenSSL und
// gettext/iconv nach, libintl wiederum libwinpthread.
const LIBPQ_DLLS = [
  "libpq.dll",
  "libcrypto-3-x64.dll",
  "libssl-3-x64.dll",
  "libintl-9.dll",
  "libiconv-2.dll",
  "libwinpthread-1.dll",
];

/** Version aus bin/fetch-postgrest.sh — eine Quelle fuer beide Wege. */
function version() {
  if (process.env.POSTGREST_VERSION) return process.env.POSTGREST_VERSION;
  const skript = path.join(WURZEL, "..", "bin", "fetch-postgrest.sh");
  try {
    const treffer = fs.readFileSync(skript, "utf8").match(/POSTGREST_VERSION:-(v[\d.]+)/);
    if (treffer) return treffer[1];
  } catch { /* Skript nicht da -> Standard unten */ }
  return "v14.16";
}

function archivName(v) {
  if (IST_WINDOWS) return `postgrest-${v}-windows-x86-64.zip`;
  if (process.platform === "darwin") {
    return `postgrest-${v}-macos-${process.arch === "arm64" ? "aarch64" : "x86-64"}.tar.xz`;
  }
  return `postgrest-${v}-linux-static-x86-64.tar.xz`;
}

/**
 * Entpacken ohne zusaetzliche Abhaengigkeit.
 * Auf Windows zuerst PowerShell: das `tar` in der Git-Bash ist GNU tar und
 * haelt "C:\…" fuer einen Rechnernamen ("Cannot connect to C: resolve failed").
 */
function entpacken(archiv, nach) {
  const wege = IST_WINDOWS
    ? [() => expandArchive(archiv, nach), () => tarX(archiv, nach)]
    : [() => tarX(archiv, nach)];
  let letzter;
  for (const weg of wege) {
    try { return weg(); } catch (e) { letzter = e; }
  }
  throw letzter;
}
const tarX = (a, n) => execFileSync("tar", ["-xf", a, "-C", n], { stdio: "pipe" });
const expandArchive = (a, n) => execFileSync("powershell", [
  "-NoProfile", "-Command",
  `Expand-Archive -LiteralPath '${a}' -DestinationPath '${n}' -Force`,
], { stdio: "pipe" });

/** Ordner, in denen auf diesem Rechner eine libpq liegen kann. */
function libpqQuellen() {
  const orte = [];
  if (process.env.PGRST_LIBPQ_DIR) orte.push(process.env.PGRST_LIBPQ_DIR);
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const glob = (basis, unter) => {
    try {
      return fs.readdirSync(basis, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(basis, e.name, unter));
    } catch { return []; }
  };
  orte.push(...glob(path.join(pf, "PostgreSQL"), "bin"));       // offizieller Client
  orte.push(path.join(pf, "TablePlus", "x64"));
  orte.push(...glob(path.join(pf, "pgAdmin 4"), "runtime"));
  return orte;
}

function libpqBereitstellen() {
  if (!IST_WINDOWS) return;
  const fehlende = LIBPQ_DLLS.filter((d) => !fs.existsSync(path.join(BIN_DIR, d)));
  if (!fehlende.length) return;

  for (const ort of libpqQuellen()) {
    if (!LIBPQ_DLLS.every((d) => fs.existsSync(path.join(ort, d)))) continue;
    for (const d of LIBPQ_DLLS) fs.copyFileSync(path.join(ort, d), path.join(BIN_DIR, d));
    console.log(`[postgrest] libpq kopiert aus ${ort}`);
    return;
  }

  throw new Error(
    `libpq fehlt (${fehlende.join(", ")}).\n` +
    "  PostgREST fuer Windows laedt diese DLLs zur Laufzeit nach. Entweder:\n" +
    "    • einen PostgreSQL-Client installieren:  winget install PostgreSQL.PostgreSQL\n" +
    "    • oder PGRST_LIBPQ_DIR auf einen Ordner setzen, der sie enthaelt\n" +
    "      (z.B. den bin-Ordner einer vorhandenen PostgreSQL-Installation)."
  );
}

async function postgrestHolen() {
  if (fs.existsSync(ZIEL)) return;
  const v = version();
  const url = `https://github.com/PostgREST/postgrest/releases/download/${v}/${archivName(v)}`;
  console.log(`[postgrest] lade ${v} …`);

  const antwort = await fetch(url, { redirect: "follow" });
  if (!antwort.ok) throw new Error(`Download fehlgeschlagen (HTTP ${antwort.status}): ${url}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgrst-"));
  try {
    const archiv = path.join(tmp, archivName(v));
    fs.writeFileSync(archiv, Buffer.from(await antwort.arrayBuffer()));
    entpacken(archiv, tmp);

    const gefunden = fs.readdirSync(tmp).find((n) => n === "postgrest" || n === "postgrest.exe");
    if (!gefunden) throw new Error("Binary im Archiv nicht gefunden.");

    fs.mkdirSync(BIN_DIR, { recursive: true });
    fs.copyFileSync(path.join(tmp, gefunden), ZIEL);
    if (!IST_WINDOWS) fs.chmodSync(ZIEL, 0o755);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Nachweis, dass das Binary wirklich startet — und zwar unter DENSELBEN
 * Bedingungen wie spaeter.
 *
 * Diese Pruefung lief zuerst einfach mit der Umgebung des Aufrufers. In der
 * Git-Bash ging sie dadurch durch, obwohl eine DLL fehlte: deren PATH enthaelt
 * mingw64/bin, und dort liegt libwinpthread-1.dll zufaellig auch. Per
 * Doppelklick aus dem Explorer heraus fehlte sie dann doch — mit
 * Exitcode 0xC0000135 und keiner weiteren Erklaerung.
 *
 * Deshalb wird hier bewusst mit dem kleinstmoeglichen PATH geprueft: was jetzt
 * noch laeuft, laeuft auch in der Eingabeaufforderung.
 */
function nachweisen() {
  const umgebung = IST_WINDOWS
    ? { SystemRoot: process.env.SystemRoot, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` }
    : process.env;
  try {
    return execFileSync(ZIEL, ["--version"], {
      encoding: "utf8", env: umgebung, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    const status = e.status >>> 0;                       // 0xC0000135 kommt negativ an
    const dllFehlt = status === 0xC0000135 || status === 0xC0000139;
    const fehlen = LIBPQ_DLLS.filter((d) => !fs.existsSync(path.join(BIN_DIR, d)));
    const stderr = String(e.stderr || "").trim();
    throw new Error(
      `${ZIEL} startet nicht (Status 0x${status.toString(16).toUpperCase()}).\n` +
      (dllFehlt
        ? "  Es fehlt eine DLL neben dem Binary" + (fehlen.length ? `: ${fehlen.join(", ")}` : " (Begleiter einer der kopierten).") + "\n" +
          "  Erneut holen:  npm run postgrest\n" +
          "  Oder PGRST_LIBPQ_DIR auf einen vollstaendigen PostgreSQL-bin-Ordner setzen."
        : stderr || "  Keine weitere Ausgabe.")
    );
  }
}

/** Holt alles Noetige und weist nach, dass es laeuft. Gibt den Pfad zurueck. */
async function sicherstellen({ still = false } = {}) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  await postgrestHolen();
  libpqBereitstellen();
  const ausgabe = nachweisen();
  if (!still) console.log(`[postgrest] ${ausgabe} — ${ZIEL}`);
  return ZIEL;
}

module.exports = { sicherstellen, PFAD: ZIEL };

if (require.main === module) {
  sicherstellen().catch((e) => {
    console.error(`[postgrest] FEHLER: ${e.message}`);
    process.exit(1);
  });
}
