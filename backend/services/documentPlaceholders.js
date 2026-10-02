"use strict";

/**
 * Platzhalter in Kopf-, Fusstexten und eigenen Textbloecken der Belege.
 *
 * EINE Liste fuer Renderer und Oberflaeche — die Einstellungen holen sie ueber
 * GET /document-templates/catalog, statt eine Kopie zu pflegen (vorher stand
 * sie zweimal da, und neue Platzhalter kamen im Frontend nie an).
 *
 * `scope`: wo der Platzhalter einen Wert hat. Anderswo bleibt er leer, statt
 * als „{{…}}" im Beleg stehen zu bleiben.
 */

const PLACEHOLDERS = [
  { token: "belegnummer",       label: "Belegnummer" },
  { token: "belegdatum",        label: "Belegdatum" },
  { token: "betrag",            label: "Zahlbetrag" },
  { token: "faellig",           label: "Fällig am",          scope: ["invoice", "mahnung"] },
  { token: "leistungszeitraum", label: "Leistungszeitraum",  scope: ["invoice"] },
  { token: "gueltig_bis",       label: "Gültig bis",         scope: ["offer"] },
  { token: "projekt",           label: "Projekt" },
  { token: "vertrag",           label: "Vertrag",            scope: ["invoice"] },
  { token: "bauvorhaben",       label: "Bauvorhaben",        scope: ["invoice", "mahnung", "nachtrag"] },
  { token: "kunde",             label: "Kunde" },
  { token: "anrede",            label: "Anrede" },
  { token: "ansprechpartner",   label: "Ansprechpartner (Büro)" },
  { token: "firma",             label: "Eigene Firma" },
  { token: "mahnstufe",         label: "Mahnstufe",          scope: ["mahnung"] },
];

const TOKENS = new Set(PLACEHOLDERS.map((p) => p.token));

/**
 * Ersetzt {{token}} durch den Wert. Bekannte Platzhalter ohne Wert werden leer,
 * unbekannte bleiben stehen (Tippfehler sieht man so im Beleg und in der
 * Vorschau, statt dass Text verschwindet).
 */
function resolvePlaceholders(text, values) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/\{\{\s*([\wäöüÄÖÜ]+)\s*\}\}/g, (m, key) => {
    const k = String(key).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(values, k)) return values[k] == null ? "" : String(values[k]);
    return TOKENS.has(k) ? "" : m;
  });
}

module.exports = { PLACEHOLDERS, resolvePlaceholders };
