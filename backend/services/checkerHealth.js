"use strict";

// ---------------------------------------------------------------------------
// Laufprotokoll der Hintergrund-Checker — im Arbeitsspeicher, ohne Tabelle.
//
// WARUM ES DAS GIBT
//   Wenn eine geplante Erinnerung ausbleibt, gibt es drei Verdaechtige:
//     1. Der Checker lief gar nicht (Timer, DISABLE_BACKGROUND_JOBS, Neustart).
//     2. Er lief, sah aber keine Daten (Zeitplan trifft nicht, Datenbankfehler).
//     3. Er lief und schrieb, nur der Push kam nicht an.
//   Von aussen sahen alle drei gleich aus: nichts passiert. Genau daran ist die
//   Suche zweimal vorbeigelaufen — deshalb protokolliert jeder Lauf jetzt, was
//   er gesehen und geschrieben hat.
//
//   Bewusst nur im Speicher: ein Neustart loescht das Protokoll, und genau das
//   ist die richtige Aussage — nach einem Neustart hat noch kein Lauf
//   stattgefunden. Eine Tabelle waere hier mehr Buchhaltung als Erkenntnis.
// ---------------------------------------------------------------------------

const START_ZEIT = new Date().toISOString();

// name -> { zuletztUm, dauerMs, gesehen, erstellt, fehler, laeufe }
const protokoll = new Map();

function eintrag(name) {
  if (!protokoll.has(name)) {
    protokoll.set(name, {
      zuletztUm: null, dauerMs: null,
      gesehen: null, erstellt: null,
      zuletztErstellt: null, zuletztErstelltUm: null,
      fehler: null, laeufe: 0,
    });
  }
  return protokoll.get(name);
}

// Vom Checker aufzurufen, sobald er weiss, was er vorgefunden hat.
//   gesehen  — Anzahl gepruefter Datensaetze (Rechnungen, Zeitplaene, …)
//   erstellt — Anzahl geschriebener Benachrichtigungen
//   fehler   — Meldung, wenn eine Abfrage scheiterte
function melde(name, { gesehen = null, erstellt = null, fehler = null } = {}) {
  const e = eintrag(name);
  if (gesehen  !== null) e.gesehen  = gesehen;
  if (erstellt !== null) e.erstellt = erstellt;
  if (fehler   !== null) e.fehler   = String(fehler);

  // Der letzte Lauf MIT Wirkung, getrennt vom letzten Lauf ueberhaupt.
  //
  // Seit die zeitplangesteuerten Checker minuetlich pruefen (statt stuendlich),
  // ist der letzte Lauf fast immer ein leerer — "0 erstellt" waere die Antwort
  // auf jede Frage, auch eine Minute nachdem drei Erinnerungen rausgingen.
  // Diese beiden Felder bewahren, was sonst im Takt untergeht.
  if (erstellt !== null && erstellt > 0) {
    e.zuletztErstellt   = erstellt;
    e.zuletztErstelltUm = new Date().toISOString();
  }
}

// Umschliesst einen Checker-Lauf: Zeitstempel, Dauer und unerwartete Fehler.
// Der Lauf selbst bleibt unveraendert — er meldet sein Ergebnis ueber melde().
async function laufe(name, fn) {
  const e = eintrag(name);
  const start = Date.now();
  e.fehler = null;          // jeder Lauf beginnt ohne Vorbelastung
  e.gesehen = null;
  e.erstellt = null;
  try {
    return await fn();
  } catch (err) {
    e.fehler = err?.message || String(err);
    throw err;
  } finally {
    e.zuletztUm = new Date().toISOString();
    e.dauerMs   = Date.now() - start;
    e.laeufe   += 1;
  }
}

function status() {
  const checker = {};
  for (const [name, e] of protokoll) checker[name] = { ...e };
  return { prozessStartUm: START_ZEIT, checker };
}

// Nur fuer Tests.
function _zuruecksetzen() {
  protokoll.clear();
}

module.exports = { melde, laufe, status, _zuruecksetzen };
