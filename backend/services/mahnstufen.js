"use strict";

/**
 * Bezeichnungen der Mahnstufen, solange ein Buero keine eigenen hinterlegt
 * hat (MAHNUNG_SETTINGS.LABEL). Vorher stand die Liste fuenfmal im Backend —
 * Renderer, Checker, E-Mail-Vorlagen, Dateinamen, Vorbelegung.
 */
const DEFAULT_LABELS = { 1: "Zahlungserinnerung", 2: "1. Mahnung", 3: "2. Mahnung", 4: "3. Mahnung" };

function defaultStufeLabel(stufe) {
  return DEFAULT_LABELS[stufe] || (Number(stufe) > 0 ? `Mahnstufe ${stufe}` : "Keine");
}

module.exports = { DEFAULT_LABELS, defaultStufeLabel };
