"use strict";

/**
 * Spalteninventar aus db/schema/inventar_*.txt.
 *
 * WOZU: das In-Memory-Fake (fakeSupabase.js) akzeptiert jeden Tabellen- und
 * Spaltennamen. Das macht es schnell und unabhaengig von einer Datenbank, aber
 * es heisst auch: ein Insert auf eine Spalte, die es gar nicht gibt, faellt in
 * keinem Test auf. Genau so standen die Rollenspalten monatelang im Insert der
 * Nachtrags-Freigabe auf PROJECT_STRUCTURE, obwohl die Tabelle sie nie hatte -
 * 725 gruene Tests und trotzdem ein 500er im Betrieb.
 *
 * Und: Altbezeichner aus der Umbenennung hier nicht ausschreiben. Der CI-Job
 * `rename-guard` sucht sie im ganzen Repo - auch in Kommentaren.
 *
 * Mit diesem Inventar kann das Fake auf Wunsch streng werden und sich verhalten
 * wie PostgREST: unbekannte Spalte -> Fehler.
 *
 * Das Inventar ist ein Abzug der laufenden Datenbank, kein generiertes
 * Artefakt. Es veraltet also. Ein fehlendes oder altes Inventar darf keinen
 * Test zum Scheitern bringen, deshalb meldet `load()` in dem Fall `null` und
 * die strenge Pruefung schaltet sich still ab - lieber keine Pruefung als eine,
 * die bei jedem Schema-Ausbau grundlos rot wird.
 */

const fs = require("fs");
const path = require("path");

const SCHEMA_DIR = path.join(__dirname, "..", "..", "..", "db", "schema");

let cache; // undefined = noch nicht geladen, null = kein Inventar vorhanden

/** Jüngste Inventardatei, oder null. */
function neuestesInventar() {
  let dateien;
  try {
    dateien = fs.readdirSync(SCHEMA_DIR).filter((f) => /^inventar_.*\.txt$/.test(f)).sort();
  } catch {
    return null;
  }
  return dateien.length ? path.join(SCHEMA_DIR, dateien[dateien.length - 1]) : null;
}

/**
 * @returns {Map<string, Set<string>>|null} Tabellenname (ohne Schema) -> Spalten.
 *   Tabellen aus anderen Schemas als public stehen zusaetzlich qualifiziert drin.
 */
function load() {
  if (cache !== undefined) return cache;
  const datei = neuestesInventar();
  if (!datei) { cache = null; return cache; }

  const map = new Map();
  let aktuell = null;
  for (const zeile of fs.readFileSync(datei, "utf8").split(/\r?\n/)) {
    const kopf = /^--\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*$/.exec(zeile);
    if (kopf) {
      const [, schema, tabelle] = kopf;
      aktuell = new Set();
      map.set(tabelle, aktuell);
      if (schema !== "public") map.set(`${schema}.${tabelle}`, aktuell);
      continue;
    }
    const spalte = /^\s{2}([A-Za-z0-9_\-]+)\s{2,}/.exec(zeile);
    if (spalte && aktuell) aktuell.add(spalte[1]);
  }
  cache = map.size ? map : null;
  return cache;
}

/**
 * Prueft die Schluessel einer zu schreibenden Zeile gegen das Inventar.
 * @returns {string[]} Spalten, die es auf dieser Tabelle nicht gibt. Leer, wenn
 *   alles stimmt ODER die Tabelle im Inventar unbekannt ist (dann laesst sich
 *   nichts sagen, und Schweigen ist besser als ein Fehlalarm).
 */
function unbekannteSpalten(tabelle, zeile) {
  const map = load();
  if (!map) return [];
  const spalten = map.get(tabelle);
  if (!spalten) return [];
  return Object.keys(zeile || {}).filter((k) => !spalten.has(k));
}

module.exports = { load, unbekannteSpalten, neuestesInventar };
