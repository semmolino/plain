"use strict";

// ============================================================================
// db.js — Datenbankzugang der Owner-Konsole
//
// WARUM DAS HIER NICHT MEHR SELBST GEBAUT WIRD
//   Bis 09/2026 erzeugte diese Datei einen eigenen Client aus SUPABASE_URL /
//   SUPABASE_SERVICE_KEY. Beim Umzug nach Scalingo ist die Anwendung auf
//   PostgREST umgestellt worden, die Konsole nicht — sie las danach weiter die
//   abgehaengte Supabase und zeigte deren Datenstand an, ohne das irgendwo zu
//   sagen.
//
//   Aufgefallen ist es an der Lizenz-Inbox: die haelt den HEUTIGEN Code gegen
//   die Datenbank, und die Datenbank war die von vor den Umbenennungen (die
//   Buchungstabelle noch unter ihrem alten Namen, PERMISSION ohne die Rechte
//   aus 0136/0139). Ergebnis waren
//   37 "offene Lizenz-Aufgaben", die es nie gab. Dazu kam, dass die alte
//   Instanz zeitweise gar nicht mehr antwortete — daher die Meldungen
//   "TypeError: fetch failed" ueber allen sieben Quellen.
//
// DER WEG JETZT
//   Dieselbe Mechanik wie in der Anwendung (backend/db.js), nur dauerhaft im
//   Systemgeltungsbereich: die Konsole arbeitet per Definition
//   mandantenuebergreifend und ist neben dem Signup und den
//   Hintergrund-Checkern der dritte Traeger des sys-Claims
//   (backend/scripts/migration/05_rls_scalingo.sql, Abschnitt 2).
//
//   Aufgeloest wird bei JEDEM Zugriff neu. Nur so erneuert sich das Token auch
//   in einem Prozess, der seit Stunden laeuft — genau daran sind die
//   Hintergrund-Checker einmal gestorben (siehe backend/db.js).
//
// KEIN STILLER RUECKFALL
//   Ohne POSTGREST_URL wuerde backend/db.js auf den alten Supabase-Client
//   zurueckfallen. Genau dieser Rueckfall ist die Ursache von oben, deshalb
//   bricht die Konsole hier ab, statt weiterzumachen. Erreichbar ist PostgREST
//   vom Arbeitsplatz aus nur ueber `scalingo db-tunnel` — beides richtet
//   scripts/start.js ein, und darum wird die Konsole ueber `npm start`
//   gestartet und nicht mehr mit `node server.js`.
// ============================================================================

const path = require("path");

const backendDb = require(path.join(__dirname, "..", "..", "backend", "db"));

if (backendDb.mode() !== "postgrest") {
  throw new Error(
    "Die Owner-Konsole braucht POSTGREST_URL.\n" +
    "Ohne sie faellt der Datenbankzugang auf die abgehaengte Supabase zurueck und " +
    "zeigt einen veralteten Datenstand an — dieser Rueckfall ist bewusst abgeschaltet.\n" +
    "Starten mit:  npm start   (bzw. start-konsole.cmd)\n" +
    "Das oeffnet den Tunnel zur Scalingo-Datenbank und startet PostgREST davor. " +
    "Hintergrund: owner-console/README.md."
  );
}

// Bricht ab, wenn PGRST_JWT_SECRET oder die Datenbankrolle fehlen. Beides
// aeussert sich sonst nicht als Fehler, sondern als leere Ergebnisse.
backendDb.assertConfigured();

// Der Stellvertreter. runAsSystem setzt den Geltungsbereich, der db-Proxy
// loest darin den Client auf und bindet Methoden an ihn — was hier
// herauskommt, ist also fertig gebunden und bleibt gueltig, auch wenn der
// Aufruf erst danach erfolgt (supabase.from("X").select() ist ein Zugriff auf
// "from", der Rest laeuft auf dem gebundenen Client weiter).
const supabase = new Proxy(Object.create(null), {
  get(_ziel, eigenschaft) {
    return backendDb.runAsSystem(() => backendDb.db[eigenschaft]);
  },
  has(_ziel, eigenschaft) {
    return backendDb.runAsSystem(() => eigenschaft in backendDb.db);
  },
});

/**
 * Woher die Konsole liest — fuer die Kopfzeile und /health.
 *
 * Die Konsole zeigt Zahlen ueber alle Mandanten; welche Datenbank dahinter
 * steckt, muss man ihr ansehen koennen. Dass das monatelang nicht ging, ist
 * der Grund fuer diese Funktion.
 */
function datenquelle() {
  return {
    art: "postgrest",
    // Setzt scripts/start.js, z.B. "Scalingo · planandsimple (Tunnel 127.0.0.1:10000)".
    herkunft: process.env.KONSOLE_DB_HERKUNFT || process.env.POSTGREST_URL || "unbekannt",
  };
}

module.exports = { supabase, datenquelle };
