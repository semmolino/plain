#!/usr/bin/env node
// ============================================================================
// security-scan.mjs — die maschinell pruefbare Haelfte des Sicherheitsaudits
//
// WARUM ES DAS GIBT
//   Die Befunde des Pentests vom 2026-08-06 waren keine exotischen Luecken,
//   sondern WIEDERHOLUNGEN: ein vergessenes Permission-Gate, ein Mandant aus
//   dem angefragten Objekt statt aus der Sitzung, eine Datei mit dem MIME-Typ
//   aus der Datenbank. Solche Muster findet ein Mensch beim dritten Mal nicht
//   mehr zuverlaessig — ein Skript schon.
//
//   Geprueft wird die QUELLE, nicht die laufende Anwendung. Das faellt auch
//   dann auf, wenn jemand SPAETER eine Route ohne Gate ergaenzt — und genau so
//   sind die Luecken entstanden.
//
// RATSCHENPRINZIP
//   Der Bestand steht in scripts/security-baseline.json. Gemeldet wird nur,
//   was NEU hinzukommt. Damit ist der Lauf ab heute gruen, ohne dass die
//   Altlast unsichtbar wird — sie steht in der Baseline und im Bericht
//   docs/SECURITY_AUDIT_2026-09-03.md. Behobenes verschwindet von selbst;
//   die Baseline schrumpfen zu lassen ist die Arbeit, nicht ein Nebeneffekt.
//
// AUFRUF
//   node scripts/security-scan.mjs                    Bestand vs. Baseline
//   node scripts/security-scan.mjs --all              alles, auch Bekanntes
//   node scripts/security-scan.mjs --json             maschinenlesbar
//   node scripts/security-scan.mjs --deps             zusaetzlich npm audit
//   node scripts/security-scan.mjs --update-baseline  Bestand festschreiben
//
// Exit 1, sobald ein NEUER Verstoss auftaucht. Sonst Exit 0.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PFAD = join(ROOT, "scripts", "security-baseline.json");

const argv = new Set(process.argv.slice(2));
const ALLES = argv.has("--all");
const JSON_AUS = argv.has("--json");
const MIT_DEPS = argv.has("--deps");
const BASIS_SCHREIBEN = argv.has("--update-baseline");

const befunde = [];
const add = (check, schwere, datei, zeile, text, hinweis) =>
  befunde.push({ check, schwere, datei, zeile, text: String(text).trim().slice(0, 140), hinweis });

const lies = (p) => readFileSync(join(ROOT, p), "utf8");
const zeilen = (p) => lies(p).split(/\r?\n/);
const dateienIn = (verz, filter = /\.js$/) =>
  existsSync(join(ROOT, verz))
    ? readdirSync(join(ROOT, verz)).filter((f) => filter.test(f)).map((f) => verz + "/" + f)
    : [];

const ROUTES = dateienIn("backend/routes");
const SERVICES = dateienIn("backend/services");
const CONTROLLERS = dateienIn("backend/controllers");
const FLACH = dateienIn("backend", /^services_.*\.js$/);

// ── G1 · Mutierende Endpunkte ohne Permission-Gate ──────────────────────────
// Der haeufigste Befund von 2026-08-06. Ein Gate kann an DREI Stellen sitzen,
// und alle drei sind legitim — wer nur die erste kennt, meldet 40 Fehlalarme
// und wird danach ignoriert:
//   1. an der Route:            router.post("/x", requirePermission("a.b"), …)
//   2. am Router:               router.use(requirePermission("a.b"))
//   3. im Handler:              if (!req.hasPermission("a.b")) return 403
//      — noetig, wenn das verlangte Recht vom Inhalt abhaengt (eigener Antrag
//        vs. Erfassung fuer andere, siehe routes/abwesenheit.js)
//   4. im Controller, an den der Handler delegiert
// Ausgenommen sind die oeffentlichen Router (vor der authChain, eigene
// Schranken) und self-scoped Endpunkte. Beide Listen stehen namentlich hier,
// damit die Ausnahme eine Entscheidung bleibt und kein Regex-Nebeneffekt.
const GATE_AUSNAHMEN = [
  /routes\/auth\.js$/,      // oeffentlich, eigene Rate-Limiter
  /routes\/webhooks\.js$/,  // signaturgeprueft, kein JWT
  /routes\/tracking\.js$/,  // oeffentlich, cookieless, eigenes Limit
];
// Router, deren mutierende Endpunkte ausschliesslich eigene Daten schreiben —
// der Mitarbeiter kommt aus der Sitzung, nicht aus der Nutzlast.
const SELF_SCOPED_DATEIEN = [/routes\/recents\.js$/, /routes\/notifications\.js$/, /routes\/push\.js$/];
const SELF_SCOPED = /\/me\b|text-snippets|read-all|:id\/read|subscribe|recents|\/consent/;

// Einzelne Endpunkte, die POST benutzen, ohne etwas zu aendern — sie brauchen
// den Body und koennen deshalb kein GET sein. Sie hier namentlich zu fuehren
// ist ehrlicher, als sie in die Baseline zu legen: dort saehen sie aus wie
// offene Luecken. Wer einen Eintrag ergaenzt, begruendet ihn in derselben
// Zeile — und muss dann auch belegen koennen, dass wirklich nichts geschrieben
// wird.
const KEIN_SCHREIBVORGANG = [
  { datei: /routes\/arbzg\.js$/, pfad: "/preflight" }, // Live-Validierung der Arbeitszeitregeln
];
const HAT_GATE_DIREKT = /require(Any)?Permission\s*\(|hasPermission\s*\(/;

/**
 * Gates haengen oft an einem BENANNTEN Zwischenstueck statt direkt an der
 * Route. Zwei Formen kommen vor:
 *
 *     const GUARD = requirePermission("import.manage")        // Konstante
 *     function uploadGuard(req, res, next) { … hasPermission … }  // Funktion
 *     router.post("/x", GUARD, uploadGuard, …)
 *
 * Beide muessen aufgeloest werden. Ein Scanner, der eine Korrektur nicht
 * anerkennt, wird zu Recht ignoriert — und dann faellt auch das auf, was er
 * richtig meldet.
 */
function gateKonstanten(inhalt) {
  const namen = [
    // const GUARD = requirePermission(…)
    ...[...inhalt.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require(?:Any)?Permission\s*\(/g)].map((m) => m[1]),
    // function xyzGuard(req, res, next) { … hasPermission(…) … }
    ...[...inhalt.matchAll(/function\s+(\w+)\s*\([^)]*\bnext\b[^)]*\)\s*\{([\s\S]{0,600}?)\n\s*\}/g)]
      .filter((m) => /hasPermission\s*\(|require(?:Any)?Permission\s*\(/.test(m[2]))
      .map((m) => m[1]),
  ];
  return namen.length ? new RegExp("[,(]\\s*(" + namen.join("|") + ")\\s*[,)]") : null;
}
// Der Handler prueft selbst, dass der Datensatz dem angemeldeten Mitarbeiter
// gehoert — das ist eine Besitzpruefung und ersetzt hier das Rollenrecht.
// Zwei Schreibweisen kommen vor: der direkte Filter, und eine Hilfsfunktion
// mit ownerOnly-Schalter (routes/service.js: loadParent(kind, id, req, true)).
const BESITZPRUEFUNG = /\.eq\(\s*["']EMPLOYEE_ID["']\s*,\s*req\.employeeId|loadParent\([^)]*,\s*true\s*\)/;

/** Sitzt das Gate im Controller, an den die Route delegiert? */
function controllerGatet(routenDatei, blockText) {
  const m = blockText.match(/ctrl\.(\w+)\s*\(/);
  if (!m) return false;
  const req = lies(routenDatei).match(/require\(["']\.\.\/controllers\/([\w.-]+)["']\)/);
  if (!req) return false;
  const ctrlDatei = "backend/controllers/" + req[1].replace(/\.js$/, "") + ".js";
  if (!existsSync(join(ROOT, ctrlDatei))) return false;
  const inhalt = lies(ctrlDatei);
  // Funktionskoerper ab der Definition bis zur naechsten Top-Level-Definition.
  const start = inhalt.search(new RegExp("(async\\s+function|exports\\.|const)\\s+" + m[1] + "\\b"));
  if (start < 0) return false;
  const rest = inhalt.slice(start);
  const ende = rest.slice(1).search(/\n(async function|exports\.|const \w+ = async)/);
  return HAT_GATE_DIREKT.test(ende > 0 ? rest.slice(0, ende) : rest);
}

for (const datei of ROUTES) {
  if (GATE_AUSNAHMEN.some((r) => r.test(datei))) continue;
  if (SELF_SCOPED_DATEIEN.some((r) => r.test(datei))) continue;
  const alle = zeilen(datei);
  const ganz = alle.join("\n");
  // Gate-Konstanten dieser Datei aufloesen (const GUARD = requirePermission(…)).
  const konstante = gateKonstanten(ganz);
  const hatGate = (text) => HAT_GATE_DIREKT.test(text) || (konstante ? konstante.test(text) : false);
  // Router-weites Gate deckt die ganze Datei ab — auch ueber eine Konstante
  // (routes/import.js: const GUARD = requirePermission("import.manage")).
  if (/router\.use\(\s*require(Any)?Permission\s*\(/.test(ganz)) continue;
  alle.forEach((text, i) => {
    if (!/^\s*router\.(post|put|patch|delete)\s*\(/.test(text)) return;
    if (SELF_SCOPED.test(text)) return;
    if (KEIN_SCHREIBVORGANG.some((a) => a.datei.test(datei) && text.includes(a.pfad))) return;
    // Handlerkoerper: bis zur naechsten Router-Registrierung.
    let ende = i + 1;
    while (ende < alle.length && !/^\s*router\.(get|post|put|patch|delete|use)\s*\(/.test(alle[ende])) ende++;
    const block = alle.slice(i, ende).join("\n");
    if (hatGate(block)) return;
    if (BESITZPRUEFUNG.test(block)) return;
    if (controllerGatet(datei, block)) return;
    add("G1", "hoch", datei, i + 1, text,
      "Mutierender Endpunkt ohne Permission-Pruefung — weder an der Route noch im Handler noch im Controller. Passende Permission aus Migration 0062 waehlen oder als self-scoped begruenden (docs/RBAC_DEVELOPMENT_CHECKLIST.md).");
  });
}

// ── I1 · Filter-Injektion in .or() ──────────────────────────────────────────
// PostgREST liest den .or()-Ausdruck als Struktur. Ein Komma oder eine Klammer
// aus einer Nutzereingabe erweitert damit die Bedingung. Die Mandantengrenze
// haelt (das .eq("TENANT_ID") bleibt per AND davor), aber INNERHALB des
// Mandanten laesst sich ueber Treffer/kein-Treffer jede Spalte zeichenweise
// ausfragen — auch EMPLOYEE.PASSWORD.
for (const datei of [...SERVICES, ...ROUTES, ...CONTROLLERS]) {
  const alleZeilen = zeilen(datei);
  const dateiText = alleZeilen.join("\n");
  // Variablen, die in dieser Datei aus einer Neutralisierung stammen:
  //     const sq = suchwert(q)
  const neutralisiert = new Set(
    [...dateiText.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:suchwert|exakterWert)\s*\(/g)].map((m) => m[1])
  );
  alleZeilen.forEach((text, i) => {
    // Kommentare und Dokumentationsbeispiele sind kein Code.
    if (/^\s*(\*|\/\/)/.test(text)) return;
    const m = text.match(/\.or\(\s*`([^`]*)`/);
    if (!m || !/\$\{/.test(m[1])) return;
    const eingesetzt = [...m[1].matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1].trim());
    // Unbedenklich: Zahlen, IDs und alles, was durch pgrestFilter gelaufen ist.
    const unsicher = eingesetzt.filter((v) =>
      !/^Number\(|^parseInt\(|[Ii]d$|^esc$|^escaped$|^suchwert\(|^exakterWert\(/.test(v)
      && !neutralisiert.has(v));
    if (unsicher.length === 0) return;
    add("I1", "mittel", datei, i + 1, text,
      "Nutzereingabe (" + unsicher.join(", ") + ") unescaped im .or()-Ausdruck. Vor dem Einsetzen , ( ) % _ * neutralisieren (Vorlage: likeEscape in routes/auth.js).");
  });
}

// ── F1 · Content-Type aus der Datenbank ─────────────────────────────────────
// Ein als image/svg+xml abgelegtes Asset wird sonst als Dokument im eigenen
// Origin ausgefuehrt. Mit abgeschalteter CSP und dem JWT im localStorage ist
// das ein Weg zum Sitzungsdiebstahl. routes/branding.js macht es richtig
// (Allowlist + nosniff) und ist die Vorlage.
for (const datei of [...ROUTES, ...CONTROLLERS, ...SERVICES]) {
  const inhalt = lies(datei);
  const hatAllowlist = /ERLAUBT|ALLOWED_(MIME|CONTENT)|allowlist/i.test(inhalt);
  zeilen(datei).forEach((text, i) => {
    if (!/setHeader\(\s*["']Content-Type["']\s*,/.test(text)) return;
    if (!/\.(MIME_TYPE|CONTENT_TYPE|mimetype)\b/.test(text)) return;
    if (hatAllowlist) return;
    add("F1", "hoch", datei, i + 1, text,
      "MIME-Typ ungeprueft aus der Datenbank. Allowlist wie in routes/branding.js setzen oder als attachment ausliefern.");
  });
}

// ── T1 · Mandant aus dem Objekt statt aus der Sitzung ───────────────────────
// Das Muster hinter mehreren Befunden von 2026-08-06: geprueft wird dann nur,
// dass ein fremder Datensatz zu seinem eigenen Mandanten gehoert — die
// Pruefung ist wirkungslos. Hintergrunddienste sind ausgenommen, sie
// iterieren per Entwurf ueber alle Mandanten.
const CHECKER = /Checker\.js$|monatsabschluss\.js$|tenantGuard\.js$|routes\/auth\.js$/;
for (const datei of [...SERVICES, ...ROUTES, ...CONTROLLERS, ...FLACH]) {
  if (CHECKER.test(datei)) continue;
  zeilen(datei).forEach((text, i) => {
    if (!/tenantId\s*=\s*\w+\??\.\s*TENANT_ID/.test(text)) return;
    if (/^\s*(\*|\/\/)/.test(text)) return; // Kommentar
    add("T1", "mittel", datei, i + 1, text,
      "Mandant aus dem angefragten Datensatz abgeleitet. services/tenantGuard.js benutzen — Pruefung gegen req.tenantId, nicht gegen das Objekt.");
  });
}

// ── S1 · Direkter Dateisystemzugriff ────────────────────────────────────────
// Auf Scalingo gibt es keine dauerhafte Platte; ausserdem ist jeder eigene
// Pfadbau ein Traversal-Kandidat. Ablage laeuft ueber objectStorage.
const FS_ERLAUBT = /objectStorage\.js$|scripts\/|demo\/|tests\//;
for (const datei of [...SERVICES, ...ROUTES, ...CONTROLLERS]) {
  if (FS_ERLAUBT.test(datei)) continue;
  zeilen(datei).forEach((text, i) => {
    if (!/\bfs\.(write|append|create(Read|Write)Stream|unlink|mkdir)/.test(text)) return;
    add("S1", "mittel", datei, i + 1, text,
      "Direkter Dateisystemzugriff. Ueber services/objectStorage.js gehen (docs/OBJECT_STORAGE.md).");
  });
}

// ── E1 · Startsicherungen in server.js ──────────────────────────────────────
// Regressionsschutz fuer Schutzmassnahmen, die schon da sind: sie verschwinden
// leise, wenn jemand sie beim Umbauen entfernt.
const server = lies("backend/server.js");
const PFLICHT = [
  [/JWT_SECRET[\s\S]{0,200}process\.exit\(1\)/, "Startabbruch bei fehlendem oder unsicherem JWT_SECRET"],
  [/helmet\(/, "helmet als Security-Header-Schicht"],
  [/allowedOrigins/, "CORS-Allowlist statt cors() ohne Argument"],
  [/trust proxy/, "app.set(trust proxy) — ohne das teilen sich alle Clients einen Rate-Limit-Bucket"],
  [/authChain/, "gemeinsame authChain vor allen geschuetzten Routern"],
];
for (const [muster, was] of PFLICHT) {
  if (!muster.test(server)) add("E1", "hoch", "backend/server.js", 0, was, "Startsicherung fehlt: " + was);
}
// CSP ist bewusst aus (SPA-Bundles + PDF-Auslieferung). Sichtbar halten, nicht anmahnen.
if (/contentSecurityPolicy:\s*false/.test(server)) {
  add("E1", "hinweis", "backend/server.js", 0, "contentSecurityPolicy: false",
    "CSP ist abgeschaltet — deshalb wiegen F1-Befunde schwerer. Siehe docs/SECURITY_AUDIT_CONCEPT.md, Pruefbereich 4.");
}

// ── X1 · Verdaechtige Dateien im Git-Index ──────────────────────────────────
try {
  const getrackt = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  for (const f of getrackt) {
    if (/(^|\/)\.env$|(^|\/)\.env\.(?!example)|\.pem$|\.p12$|id_rsa/.test(f)) {
      add("X1", "kritisch", f, 0, f,
        "Sieht nach einem Geheimnis im Repository aus. Inhalt pruefen, betroffenes Geheimnis rotieren, Datei aus Index und Historie entfernen.");
    }
  }
  const nm = getrackt.filter((f) => f.includes("node_modules/")).length;
  if (nm > 0) {
    add("X1", "mittel", "node_modules", 0, nm + " Dateien unter node_modules/ sind versioniert",
      "Versionierte Abhaengigkeiten verdecken Manipulationen und weichen von package-lock.json ab. Mit git rm -r --cached aus dem Index nehmen.");
  }
} catch { /* kein git verfuegbar */ }

// ── D1 · Verwundbare Abhaengigkeiten (nur mit --deps) ───────────────────────
if (MIT_DEPS) {
  const auswerten = (roh, ort) => {
    const j = JSON.parse(roh);
    for (const [name, v] of Object.entries(j.vulnerabilities || {})) {
      if (v.severity !== "high" && v.severity !== "critical") continue;
      add("D1", v.severity === "critical" ? "kritisch" : "hoch", ort + "/package.json", 0,
        name + " (" + v.severity + ")",
        "npm audit: " + name + ". Behebbar: " + JSON.stringify(v.fixAvailable));
    }
  };
  for (const [ort, flags] of [["backend", "--omit=dev"], ["frontend-react", ""]]) {
    try {
      auswerten(execSync("npm audit --json " + flags, { cwd: join(ROOT, ort), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }), ort);
    } catch (e) {
      // npm audit endet bei Funden mit Exit != 0 — die Ausgabe steht trotzdem in stdout.
      try { auswerten(String(e.stdout || ""), ort); }
      catch {
        add("D1", "hinweis", ort + "/package.json", 0, "npm audit nicht auswertbar",
          "Ohne Netz oder ohne installierte Abhaengigkeiten liefert npm audit nichts. Lauf wiederholen, wenn verfuegbar.");
      }
    }
  }
}

// ── Baseline-Abgleich ───────────────────────────────────────────────────────
// Fingerabdruck ohne Zeilennummer: verschobener Code soll nicht als neuer
// Befund gelten, geaenderter Code schon.
const fp = (b) => b.check + "|" + b.datei + "|" + b.text;
const baseline = existsSync(BASELINE_PFAD) ? JSON.parse(readFileSync(BASELINE_PFAD, "utf8")) : { eintraege: [] };
const bekannt = new Set(baseline.eintraege || []);

// Abhaengigkeiten (D1) gehoeren NICHT in die Baseline: die Liste aendert sich
// mit jedem Advisory, und ein eingefrorener Bestand hiesse, kuenftige Meldungen
// stumm zu schalten. Sie werden immer gezeigt; scheitern lassen nur kritische.
const istQuelle = (b) => b.check !== "D1";
const quellbefunde = befunde.filter(istQuelle);
const neu = quellbefunde.filter((b) => !bekannt.has(fp(b)));
const behoben = [...bekannt].filter((k) => !quellbefunde.some((b) => fp(b) === k));
const kritischeDeps = befunde.filter((b) => b.check === "D1" && b.schwere === "kritisch");

if (BASIS_SCHREIBEN) {
  writeFileSync(BASELINE_PFAD, JSON.stringify({
    erzeugt: new Date().toISOString().slice(0, 10),
    hinweis: "Bekannter Bestand. Nur NEUE Verstoesse lassen den Lauf fehlschlagen. Diese Liste soll schrumpfen, nicht wachsen.",
    eintraege: quellbefunde.map(fp).sort(),
  }, null, 2) + "\n");
  console.log("Baseline aktualisiert: " + quellbefunde.length + " Eintraege -> " + relative(ROOT, BASELINE_PFAD));
  process.exit(0);
}

// Dependency-Funde immer zeigen, Quellbefunde nur wenn neu (oder --all).
const zuZeigen = ALLES ? befunde : [...neu, ...befunde.filter((b) => b.check === "D1")];

if (JSON_AUS) {
  console.log(JSON.stringify({ gesamt: befunde.length, neu: neu.length, behoben: behoben.length, befunde: zuZeigen }, null, 2));
} else {
  const RANG = { kritisch: 0, hoch: 1, mittel: 2, hinweis: 3 };
  zuZeigen.sort((a, b) => (RANG[a.schwere] - RANG[b.schwere]) || a.datei.localeCompare(b.datei));
  console.log("\nSicherheitsscan — " + befunde.length + " Befunde gesamt, " + neu.length + " neu, " + behoben.length + " seit der Baseline behoben\n");
  for (const b of zuZeigen) {
    console.log("[" + b.schwere.toUpperCase() + "] " + b.check + "  " + b.datei + (b.zeile ? ":" + b.zeile : ""));
    console.log("    " + b.text);
    console.log("    -> " + b.hinweis + "\n");
  }
  if (behoben.length) console.log(behoben.length + " Baseline-Eintraege treffen nicht mehr zu — mit --update-baseline festschreiben.\n");
  if (!zuZeigen.length) console.log("Keine neuen Verstoesse.\n");
}

process.exit(neu.length > 0 || kritischeDeps.length > 0 ? 1 : 0);
