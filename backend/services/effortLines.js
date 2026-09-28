'use strict';

/**
 * Aufwandszeilen eines Angebotselements nach Aufwand (Migration 0173).
 *
 * Ein Element traegt beliebig viele Zeilen Rolle · Stunden · Satz; sein
 * Honorar vor Zuschlaegen ist die Summe der Zeilenbetraege. Die alten
 * Einzelspalten (QUANTITY, HOURLY_RATE, ROLE_*) bleiben und werden hier aus
 * den Zeilen abgeleitet — Stunden als Summe, Satz und Rolle nur bei genau
 * einer Zeile. Wer sie liest (Altcode, Berichte), sieht also weiter etwas
 * Richtiges; bei mehreren Rollen ist der eine Satz schlicht nicht definiert.
 *
 * EFFORT_LINES = NULL ist Altbestand: dann gilt QUANTITY × HOURLY_RATE als die
 * eine Zeile. `nodeEffortLines` liest beides gleich — Speichern, PDF und
 * Beauftragen gehen alle durch diese Funktion, nicht durch eigene Kopien.
 */

const MAX_LINES = 30;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function toNumber(v, field, idx) {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) {
    throw { status: 400, message: `Aufwandszeile ${idx + 1}: ${field} muss eine Zahl ≥ 0 sein` };
  }
  return n;
}

function toText(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, 120);
  return s || null;
}

/**
 * Prueft und vereinheitlicht die Zeilen aus einer Anfrage. Leere Zeilen
 * (keine Rolle, keine Stunden, kein Satz) fallen weg — ein nicht ausgefuelltes
 * „+ Rolle" soll nicht als 0-h-Zeile im PDF landen.
 */
function normalizeEffortLines(raw) {
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw { status: 400, message: 'effort_lines muss eine Liste sein' };
  if (raw.length > MAX_LINES) throw { status: 400, message: `Höchstens ${MAX_LINES} Aufwandszeilen je Element` };
  const out = [];
  raw.forEach((l, idx) => {
    if (!l || typeof l !== 'object') throw { status: 400, message: `Aufwandszeile ${idx + 1} ist ungültig` };
    const roleIdRaw = l.role_id;
    const roleId = roleIdRaw === undefined || roleIdRaw === null || roleIdRaw === '' ? null : parseInt(String(roleIdRaw), 10);
    if (roleId !== null && (!Number.isFinite(roleId) || roleId <= 0)) {
      throw { status: 400, message: `Aufwandszeile ${idx + 1}: Rolle ist ungültig` };
    }
    const line = {
      role_id:   roleId,
      role_abbr: toText(l.role_abbr),
      role_name: toText(l.role_name),
      hours:     r2(toNumber(l.hours, 'Stunden', idx)),
      rate:      r2(toNumber(l.rate, 'Satz', idx)),
    };
    const empty = line.role_id === null && !line.role_abbr && !line.role_name && line.hours === 0 && line.rate === 0;
    if (!empty) out.push(line);
  });
  return out;
}

/** Betrag einer Zeile — je Zeile gerundet, damit die Summe der PDF-Zeilen stimmt. */
function lineAmount(l) {
  return r2(Number(l.hours || 0) * Number(l.rate || 0));
}

/**
 * Spalten, die ein Element mit diesen Zeilen bekommt. Keine Zeile: das
 * Element ist nach Aufwand, aber noch nicht geschaetzt (0 h).
 */
function effortColumns(lines) {
  const single = lines.length === 1 ? lines[0] : null;
  return {
    EFFORT_LINES: lines.length ? lines : null,
    QUANTITY:     r2(lines.reduce((s, l) => s + Number(l.hours || 0), 0)),
    HOURLY_RATE:  single ? single.rate : (lines.length ? null : 0),
    ROLE_ID:      single ? single.role_id : null,
    ROLE_ABBR:    single ? single.role_abbr : null,
    ROLE_NAME:    single ? single.role_name : null,
    basis:        r2(lines.reduce((s, l) => s + lineAmount(l), 0)),
  };
}

/**
 * Die Zeilen eines gespeicherten Elements. Altbestand (EFFORT_LINES NULL) mit
 * Stunden, Satz oder Rolle ergibt genau eine Zeile.
 */
function nodeEffortLines(node) {
  if (!node) return [];
  if (Array.isArray(node.EFFORT_LINES) && node.EFFORT_LINES.length) {
    return node.EFFORT_LINES.map(l => ({
      role_id:   l.role_id ?? null,
      role_abbr: l.role_abbr ?? null,
      role_name: l.role_name ?? null,
      hours:     Number(l.hours || 0),
      rate:      Number(l.rate || 0),
    }));
  }
  const hasLegacy = Number(node.QUANTITY || 0) !== 0 || Number(node.HOURLY_RATE || 0) !== 0 || node.ROLE_ID != null;
  if (!hasLegacy) return [];
  return [{
    role_id:   node.ROLE_ID ?? null,
    role_abbr: node.ROLE_ABBR ?? null,
    role_name: node.ROLE_NAME ?? null,
    hours:     Number(node.QUANTITY || 0),
    rate:      Number(node.HOURLY_RATE || 0),
  }];
}

module.exports = { normalizeEffortLines, effortColumns, nodeEffortLines, lineAmount, MAX_LINES };
