"use strict";

/**
 * Nutzereingaben fuer PostgREST-Filterausdruecke neutralisieren.
 *
 * DAS PROBLEM
 *   PostgREST liest den .or()-Ausdruck als STRUKTUR, nicht als Wert:
 *
 *       .or(`SHORT_NAME.ilike.%${q}%,FIRST_NAME.ilike.%${q}%`)
 *
 *   Ein Komma in q erweitert damit die Bedingung. Mit
 *
 *       ?q=x,PASSWORD.ilike.$2a$10$a*
 *
 *   entsteht eine zusaetzliche Oder-Bedingung, und ueber Treffer/kein-Treffer
 *   laesst sich der bcrypt-Hash eines Kollegen zeichenweise ausfragen — ein
 *   Orakel innerhalb des eigenen Mandanten (Sicherheitsaudit 2026-09-03, M1).
 *
 *   Die Mandantengrenze haelt dabei: das .eq("TENANT_ID", …) bleibt per AND
 *   davor, und RLS greift ohnehin. Es geht um Rechteausweitung INNERHALB
 *   eines Mandanten — die RBAC-Rolle wird umgangen, nicht der Mandant.
 *
 * WARUM ENTFERNEN UND NICHT QUOTEN
 *   PostgREST kann Werte in doppelte Anfuehrungszeichen setzen. Das waere
 *   praeziser, aendert aber das Ausdrucksformat und laesst sich hier nicht
 *   gegen eine echte Instanz pruefen — ein Fehler darin macht die Suche
 *   stumm kaputt statt unsicher. Strukturzeichen zu entfernen kann die
 *   Abfrage dagegen nicht zerbrechen: das Format bleibt exakt wie bisher,
 *   nur der Inhalt ist bereinigt. Fuer eine Teilstringsuche ist der Verlust
 *   ohne Bedeutung — niemand sucht ein Projekt nach einem Komma.
 *
 * ERSETZT
 *   Die lokalen Fassungen in services/invoices.js und services/partialPayments.js
 *   (nur % und _) sowie likeEscape() in routes/auth.js. Fuenf weitere Stellen
 *   hatten gar nichts. Genau dieses Auseinanderlaufen soll eine gemeinsame
 *   Funktion beenden.
 */

/** Struktur des Filterausdrucks: trennt Bedingungen, Gruppen und Spalte.Operator.Wert. */
const STRUKTURZEICHEN = /[,()."\\]/g;

/** LIKE-Platzhalter: % und _ in SQL, * zusaetzlich in PostgREST. */
const PLATZHALTER = /[%_*]/g;

/**
 * Bereitet eine Nutzereingabe als Teilstring-Suchwert auf.
 *
 * Verwendung unveraendert wie bisher:
 *     .or(`NAME.ilike.%${suchwert(q)}%`)
 *
 * @param {unknown} roh
 * @returns {string} ohne Strukturzeichen, mit escapten Platzhaltern
 */
function suchwert(roh) {
  return String(roh ?? "")
    .replace(STRUKTURZEICHEN, " ")
    .replace(PLATZHALTER, (c) => "\\" + c)
    .trim();
}

/**
 * Fuer Werte, die exakt verglichen werden (col.eq.<wert>) — etwa ein
 * Bundeslandkuerzel aus den Stammdaten. Platzhalter sind hier bedeutungslos,
 * Strukturzeichen aber genauso gefaehrlich.
 *
 * @param {unknown} roh
 * @returns {string}
 */
function exakterWert(roh) {
  return String(roh ?? "").replace(STRUKTURZEICHEN, "").trim();
}

module.exports = { suchwert, exakterWert };
