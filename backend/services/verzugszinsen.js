"use strict";

/**
 * Verzugszinsen und Verzugspauschale nach § 288 BGB (Vorlagen-Plan Stufe 5).
 *
 *   Zinssatz   Basiszinssatz + 9 Prozentpunkte, wenn kein Verbraucher beteiligt
 *              ist (Abs. 2), sonst + 5 Prozentpunkte (Abs. 1)
 *   Zeitraum   ab dem Tag nach der Faelligkeit bis zum Mahndatum (kalender-
 *              maessig bestimmte Faelligkeit, § 286 Abs. 2 Nr. 1), act/365
 *   Pauschale  40 € gegenueber Unternehmern (Abs. 5)
 *
 * Bewusst vereinfacht: ein Satz fuer den ganzen Zeitraum — der aktuelle, den
 * das Buero hinterlegt hat. Er steht mit Wert und Stichtag auf der Mahnung,
 * damit der Empfaenger nachrechnen kann. Ohne hinterlegten Basiszinssatz
 * gibt es keine Zinsen: lieber keine als falsche.
 */

const FLAT_FEE_EUR = 40;
const round2 = (n) => Math.round(n * 100) / 100;

function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(toIso).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * @param open         offener Betrag (brutto)
 * @param dueDate      Faelligkeit (YYYY-MM-DD)
 * @param today        Mahndatum (YYYY-MM-DD)
 * @param basePercent  Basiszinssatz in % (kann negativ sein) — null: keine Zinsen
 * @param consumer     Schuldner ist Verbraucher
 * @returns {{ amount, ratePercent, points, days }|null}
 */
function verzugszinsen({ open, dueDate, today, basePercent, consumer }) {
  if (basePercent === null || basePercent === undefined || !Number.isFinite(Number(basePercent))) return null;
  if (!dueDate || !(Number(open) > 0)) return null;
  const days = daysBetween(dueDate, today);
  if (days <= 0) return null;
  const points = consumer ? 5 : 9;
  const ratePercent = round2(Number(basePercent) + points);
  if (ratePercent <= 0) return null;
  const amount = round2(Number(open) * ratePercent / 100 * days / 365);
  return amount > 0 ? { amount, ratePercent, points, days } : null;
}

/** 40 € nur gegenueber Unternehmern. */
function verzugspauschale({ consumer }) {
  return consumer ? 0 : FLAT_FEE_EUR;
}

module.exports = { verzugszinsen, verzugspauschale, daysBetween, FLAT_FEE_EUR };
