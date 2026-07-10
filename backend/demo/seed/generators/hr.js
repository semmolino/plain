"use strict";

/**
 * Generator: HR-Bewegungen (Abwesenheit/Urlaub).
 *
 * PLATZHALTER — wird in der nächsten Iteration über die Abwesenheits-Tabellen
 * (Migration 0086) umgesetzt: pro Mitarbeiter/Jahr Urlaubs- und Krankheitstage
 * innerhalb des Beschäftigungsfensters, konsistent mit dem Zeitkonto.
 */

async function generate({ log }) {
  log("  HR-Bewegungen: folgt in der nächsten Iteration (noch nicht implementiert).");
  return { skipped: true };
}

module.exports = { generate };
