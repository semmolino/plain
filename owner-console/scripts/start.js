#!/usr/bin/env node
"use strict";

// ============================================================================
// start.js — Startbefehl der Owner-Konsole
//
// Richtet in dieser Reihenfolge ein und haengt die drei Teile aneinander:
//
//   1. scalingo db-tunnel   — Weg zur Scalingo-PostgreSQL (SSH, 127.0.0.1)
//   2. PostgREST            — davor, lokal, nur auf 127.0.0.1
//   3. node server.js       — die Konsole, mit POSTGREST_URL darauf gerichtet
//
// WARUM DIESER UMWEG
//   Die Anwendung spricht ihre Datenbank seit dem Umzug ueber PostgREST an,
//   und PostgREST lauscht im Scalingo-Container nur auf 127.0.0.1 — von aussen
//   gibt es dorthin keinen Weg. Die Konsole laeuft aber auf dem Arbeitsplatz.
//   Sie bekommt deshalb ihr EIGENES PostgREST, das durch den Tunnel auf
//   dieselbe Datenbank zeigt. Dieselbe Mechanik, dieselben Policies, nur der
//   Prozess steht woanders.
//
//   Die Alternative waere, die Konsole mit ins Netz zu stellen. Sie ist "God
//   Mode" — sie sieht alle Mandanten. Solange sie auf dem Arbeitsplatz laeuft,
//   gibt es dafuer keine oeffentliche Adresse, die jemand finden koennte.
//
// DAS JWT-GEHEIMNIS WIRD JE START NEU GEWUERFELT
//   Es gilt nur zwischen zwei Prozessen auf demselben Rechner, die beide hier
//   gestartet werden. Ein festes Geheimnis waere eine Datei mehr, die
//   irgendwann irgendwo landet — ohne dass es etwas besser machen wuerde.
//
// ENDET EINER, ENDEN ALLE
//   Gleiche Regel wie in bin/start-web.sh: ein halb totes Gespann ist
//   schlimmer als ein sauberer Abbruch, weil die Konsole sonst weiter
//   antwortet und nur keine Daten mehr findet.
// ============================================================================

require("dotenv").config();

const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");

const { sicherstellen: postgrestSicherstellen } = require("./postgrestHolen");
const laufzeit = require("./laufzeit");

const IST_WINDOWS = process.platform === "win32";

const KONFIG = {
  app: process.env.SCALINGO_APP || "planandsimple",
  tunnelPort: Number(process.env.KONSOLE_TUNNEL_PORT || 10000),
  pgrstPort: Number(process.env.KONSOLE_PGRST_PORT || 3011),
  identity: process.env.SCALINGO_SSH_IDENTITY || standardIdentity(),
};

/**
 * Der Scalingo-Client, mit vollem Pfad.
 *
 * Er wird ueblicherweise nach ~/bin entpackt, und dieser Ordner liegt unter
 * Windows NICHT im PATH — die Git-Bash haengt ihn von sich aus an, die
 * Eingabeaufforderung nicht. Ein blosses "scalingo" funktioniert deshalb im
 * Terminal des Entwicklers und scheitert beim Doppelklick auf
 * start-konsole.cmd, mit einer Meldung, die nach "nicht angemeldet" aussieht.
 */
function scalingoBinaer() {
  if (process.env.SCALINGO_CLI) return process.env.SCALINGO_CLI;

  const namen = IST_WINDOWS ? ["scalingo.exe", "scalingo.cmd"] : ["scalingo"];
  const orte = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  orte.push(path.join(os.homedir(), "bin"), path.join(os.homedir(), ".local", "bin"));
  if (process.env.ProgramFiles) orte.push(path.join(process.env.ProgramFiles, "Scalingo"));

  for (const ort of orte) {
    for (const name of namen) {
      const p = path.join(ort, name);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* weiter */ }
    }
  }
  throw new Error(
    "Der Scalingo-Client wurde nicht gefunden.\n" +
    "  Installieren: https://cli.scalingo.com\n" +
    "  Liegt er schon irgendwo? Dann SCALINGO_CLI in der .env auf die Datei zeigen lassen,\n" +
    `  z.B. SCALINGO_CLI=${path.join(os.homedir(), "bin", namen[0])}`
  );
}

/**
 * Der Scalingo-Client sucht seinen SSH-Schluessel standardmaessig unter
 * ~/.ssh/id_rsa und meldet sonst "fail to read SSH private key" — auch dann,
 * wenn direkt daneben ein ed25519-Schluessel liegt, der bei Scalingo
 * hinterlegt ist. Deshalb wird hier selbst gesucht.
 */
function standardIdentity() {
  const ssh = path.join(os.homedir(), ".ssh");
  for (const name of ["id_ed25519", "id_rsa", "id_ecdsa"]) {
    const p = path.join(ssh, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const kinder = [];
let beendet = false;

function starte(name, befehl, argumente, optionen = {}) {
  // shell:true, weil `scalingo` auf Windows als .cmd/.exe im PATH liegt und
  // spawn ohne Shell die Endung nicht aufloest.
  const kind = spawn(befehl, argumente, { shell: true, windowsHide: true, ...optionen });
  kind.on("exit", (code) => {
    if (beendet) return;
    console.error(`\n[start] ${name} ist beendet (Code ${code}) — Konsole wird heruntergefahren.`);
    alleBeenden(code === 0 ? 1 : code || 1);
  });
  kinder.push({ name, kind });
  return kind;
}

function alleBeenden(code) {
  if (beendet) return;
  beendet = true;
  laufzeit.entfernen();
  for (const { kind } of kinder) {
    if (!kind.pid || kind.exitCode !== null) continue;
    try {
      // shell:true erzeugt einen Zwischenprozess — ohne /T bliebe das
      // eigentliche Programm (Tunnel, PostgREST) als Waise zurueck und der
      // Port waere beim naechsten Start belegt.
      if (IST_WINDOWS) execFileSync("taskkill", ["/pid", String(kind.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-kind.pid, "SIGTERM");
    } catch { /* schon weg */ }
  }
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => alleBeenden(0));

// ── Hilfen ──────────────────────────────────────────────────────────────────

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

function portOffen(port) {
  return new Promise((fertig) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const schliessen = (ergebnis) => { s.destroy(); fertig(ergebnis); };
    s.setTimeout(1000);
    s.on("connect", () => schliessen(true));
    s.on("timeout", () => schliessen(false));
    s.on("error", () => schliessen(false));
  });
}

async function wartenAufPort(port, was, sekunden = 45) {
  for (let i = 0; i < sekunden * 2; i++) {
    if (beendet) return false;
    if (await portOffen(port)) return true;
    await schlafen(500);
  }
  throw new Error(`${was} ist nach ${sekunden}s nicht auf Port ${port} erreichbar.`);
}

/**
 * Die Verbindungszeichenfolge der Datenbank — aus der App, nicht aus einer
 * lokalen Datei. Sie enthaelt das Passwort und wird deshalb nirgends
 * ausgegeben, auch nicht in einer Fehlermeldung.
 */
function dbUrlHolen(scalingo) {
  try {
    return execFileSync(
      `"${scalingo}"`, ["--app", KONFIG.app, "env-get", "SCALINGO_POSTGRESQL_URL"],
      { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (e) {
    // stderr mitgeben, aber nie stdout: dort steht die Zeichenfolge mit dem
    // Passwort, auch wenn der Aufruf danach scheitert.
    const meldung = String(e.stderr || "").trim().split("\n").slice(0, 3).join("\n  ");
    throw new Error(
      `Die Datenbank-Adresse von "${KONFIG.app}" ist nicht abrufbar.\n` +
      (meldung ? `  ${meldung}\n` : "") +
      "  Angemeldet?  scalingo login\n" +
      `  Richtige App? SCALINGO_APP in der .env setzen (aktuell: ${KONFIG.app})`
    );
  }
}

/**
 * Dieselbe Datenbank, aber ueber den Tunnel.
 *
 * sslmode wird bewusst auf "prefer" gesetzt: das Zertifikat der Datenbank
 * lautet auf ihren Scalingo-Namen, hier steht aber 127.0.0.1 davor. Die
 * Strecke selbst ist trotzdem verschluesselt — sie laeuft im SSH-Tunnel.
 */
function aufTunnelUmschreiben(dbUrl, port) {
  const m = dbUrl.match(/^(postgres(?:ql)?:\/\/)([^:@/]+)(?::([^@/]*))?@[^/?]+(\/[^?]*)?/);
  if (!m) throw new Error("Die Datenbank-Adresse hat ein unerwartetes Format.");
  const [, schema, benutzer, passwort, pfad] = m;
  const anmeldung = passwort !== undefined ? `${benutzer}:${passwort}` : benutzer;
  return {
    uri: `${schema}${anmeldung}@127.0.0.1:${port}${pfad || ""}?sslmode=prefer`,
    rolle: decodeURIComponent(benutzer),
  };
}

// ── Ablauf ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("── plan&simple · Owner-Konsole ──────────────────────────────");

  const binaer = await postgrestSicherstellen({ still: true });
  const scalingo = scalingoBinaer();
  const dbUrl = dbUrlHolen(scalingo);
  const { uri, rolle } = aufTunnelUmschreiben(dbUrl, KONFIG.tunnelPort);

  // 1. Tunnel
  if (await portOffen(KONFIG.tunnelPort)) {
    console.log(`[start] Tunnel: Port ${KONFIG.tunnelPort} ist bereits offen — wird weiterverwendet.`);
  } else {
    if (!KONFIG.identity) {
      throw new Error(
        "Kein SSH-Schluessel unter ~/.ssh gefunden. `scalingo db-tunnel` braucht einen.\n" +
        "  Erzeugen:    ssh-keygen -t ed25519\n" +
        "  Hinterlegen: scalingo keys-add arbeitsplatz ~/.ssh/id_ed25519.pub"
      );
    }
    console.log(`[start] Tunnel zu ${KONFIG.app} (Schluessel: ${KONFIG.identity}) …`);
    const tunnel = starte("Tunnel", `"${scalingo}"`, [
      "--app", KONFIG.app,
      "db-tunnel",
      "--identity", `"${KONFIG.identity}"`,
      "--port", String(KONFIG.tunnelPort),
      "SCALINGO_POSTGRESQL_URL",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    // Der Tunnel meldet seine Startprobleme (fehlender Schluessel, keine
    // Berechtigung) auf stderr und laeuft danach still weiter.
    tunnel.stderr.on("data", (d) => process.stderr.write(`[tunnel] ${d}`));
    await wartenAufPort(KONFIG.tunnelPort, "Der Tunnel");
  }

  // 2. PostgREST
  const jwtGeheimnis = crypto.randomBytes(48).toString("base64url");
  console.log(`[start] PostgREST auf 127.0.0.1:${KONFIG.pgrstPort} (Rolle ${rolle}) …`);
  const pgrst = starte("PostgREST", `"${binaer}"`, [], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PGRST_DB_URI: uri,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(KONFIG.pgrstPort),
      PGRST_DB_SCHEMAS: "public",
      PGRST_JWT_SECRET: jwtGeheimnis,
      // Kein PGRST_DB_ANON_ROLE: ohne gueltiges Token wird jede Abfrage
      // abgewiesen. Der Port ist zwar nur lokal erreichbar, aber "nur lokal"
      // ist keine Zugangskontrolle.
      PGRST_DB_POOL: "4",
    },
  });
  pgrst.stdout.on("data", (d) => process.stdout.write(`[postgrest] ${d}`));
  pgrst.stderr.on("data", (d) => process.stderr.write(`[postgrest] ${d}`));
  await wartenAufPort(KONFIG.pgrstPort, "PostgREST");

  // 3. Konsole
  const umgebung = {
    postgrestUrl: `http://127.0.0.1:${KONFIG.pgrstPort}`,
    jwtGeheimnis,
    // Ohne Rollen-Claim weist PostgREST jede Abfrage ab (PGRST302), und das
    // sieht in der Konsole aus wie "keine Daten", nicht wie ein Fehler.
    rolle,
    herkunft: `Scalingo · ${KONFIG.app} (Tunnel 127.0.0.1:${KONFIG.tunnelPort})`,
  };
  const port = Number(process.env.CONSOLE_PORT || 4000);
  if (await portOffen(port)) {
    throw new Error(
      `Auf Port ${port} laeuft schon etwas — vermutlich eine zweite Konsole.\n` +
      `  Das andere Fenster benutzen oder dort beenden (Strg+C), dann neu starten.`
    );
  }

  // Erst hier, nicht frueher: bis zu diesem Punkt kann der Start noch
  // abbrechen, und ein Abbruch soll keine Spur hinterlassen, die Hilfsskripte
  // fuer einen laufenden Stapel halten.
  laufzeit.schreiben(umgebung);

  console.log(`[start] Konsole auf http://localhost:${port}\n`);

  // Browser erst, wenn wirklich jemand antwortet. Der Tunnel braucht ein paar
  // Sekunden; eine Fehlerseite als erster Eindruck waere unnoetig.
  // Bewusst NICHT ueber starte(): der Aufrufer ist sofort wieder weg, und die
  // Regel "endet einer, enden alle" wuerde den ganzen Stapel mitnehmen.
  if (process.env.KONSOLE_BROWSER !== "aus") {
    wartenAufPort(port, "Die Konsole", 30)
      .then(() => spawn(IST_WINDOWS ? "start" : "open", ['""', `http://localhost:${port}`],
        { shell: true, stdio: "ignore", detached: true }).unref())
      .catch(() => { /* der Server meldet selbst, wenn er nicht hochkommt */ });
  }

  starte("Konsole", "node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: {
      ...process.env,
      POSTGREST_URL: umgebung.postgrestUrl,
      PGRST_JWT_SECRET: umgebung.jwtGeheimnis,
      PGRST_ROLE: umgebung.rolle,
      KONSOLE_DB_HERKUNFT: umgebung.herkunft,
    },
  });
}

main().catch((e) => {
  console.error(`\n[start] FEHLER: ${e.message}\n`);
  alleBeenden(1);
});
