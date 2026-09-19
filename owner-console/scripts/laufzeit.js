"use strict";

// ============================================================================
// laufzeit.js — was der laufende Stapel den Hilfsskripten mitteilt
//
// scripts/start.js wuerfelt das JWT-Geheimnis bei jedem Start neu (siehe dort).
// Damit kann ein zweites Skript — `npm run create-admin` etwa — nicht einfach
// mitsprechen: es kennt weder Port noch Geheimnis. Deshalb hinterlegt start.js
// beides hier, solange es laeuft, und raeumt es beim Beenden wieder weg.
//
// Die Datei enthaelt ein kurzlebiges Geheimnis fuer einen Dienst, der nur auf
// 127.0.0.1 lauscht. Sie liegt trotzdem mit 0600 und in .gitignore — ein
// Geheimnis, das man "eigentlich nicht schuetzen muss", ist genau das, das
// spaeter in einem Archiv auftaucht.
// ============================================================================

const fs = require("fs");
const path = require("path");

const DATEI = path.join(__dirname, "..", "bin", "laufzeit.json");

function schreiben(daten) {
  fs.mkdirSync(path.dirname(DATEI), { recursive: true });
  fs.writeFileSync(DATEI, JSON.stringify({ ...daten, pid: process.pid }, null, 2), { mode: 0o600 });
}

/**
 * Beim Beenden nur die EIGENE Datei wegraeumen.
 *
 * Ein zweiter Start, der an einem belegten Port scheitert, haette sonst dem
 * laufenden ersten die Datei unter den Fuessen weggezogen — und damit dessen
 * Hilfsskripte lahmgelegt, ohne dass irgendwo etwas davon stuende. Eine
 * Datei, deren Prozess nachweislich tot ist, raeumt lesen() dagegen weg.
 */
const loeschen = () => { try { fs.unlinkSync(DATEI); } catch { /* schon weg */ } };

function entfernen() {
  let vorhanden;
  try { vorhanden = JSON.parse(fs.readFileSync(DATEI, "utf8")); } catch { return; }
  if (vorhanden.pid !== process.pid) return;
  loeschen();
}

/**
 * Liest die Datei — aber nur, wenn der Stapel dazu noch laeuft.
 *
 * Wird start.js hart abgeschossen (Task-Manager, taskkill /F), bleibt die
 * Datei liegen. Ein Hilfsskript wuerde sich dann an einen Port haengen, hinter
 * dem nichts mehr ist, und einen Verbindungsfehler melden statt der einen
 * Zeile, die weiterhilft. Ein Signal 0 kostet nichts und beantwortet genau
 * diese Frage.
 */
function lesen() {
  let daten;
  try { daten = JSON.parse(fs.readFileSync(DATEI, "utf8")); } catch { return null; }
  try { process.kill(daten.pid, 0); } catch { loeschen(); return null; }
  return daten;
}

/**
 * Setzt die Umgebung eines Hilfsskripts auf den laufenden Stapel.
 * Gibt zurueck, ob etwas gefunden wurde — der Aufrufer entscheidet, ob das
 * ein Abbruchgrund ist.
 */
function anwenden() {
  if (process.env.POSTGREST_URL) return true;   // von aussen gesetzt: Vorrang
  const l = lesen();
  if (!l) return false;
  process.env.POSTGREST_URL = l.postgrestUrl;
  process.env.PGRST_JWT_SECRET = l.jwtGeheimnis;
  process.env.PGRST_ROLE = l.rolle;
  process.env.KONSOLE_DB_HERKUNFT = l.herkunft;
  return true;
}

const HINWEIS =
  "Kein laufender Datenbankzugang gefunden.\n" +
  "  Die Konsole in einem zweiten Fenster starten (npm start) und diesen Befehl\n" +
  "  danach erneut ausfuehren — er benutzt dann denselben Tunnel.";

module.exports = { schreiben, entfernen, lesen, anwenden, DATEI, HINWEIS };
