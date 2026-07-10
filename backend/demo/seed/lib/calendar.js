"use strict";

/**
 * Datums-/Kalenderhelfer. Alle Daten werden als ISO-Strings 'YYYY-MM-DD'
 * geführt und intern in UTC gerechnet, um Zeitzonen-Verschiebungen zu vermeiden.
 * Gesetzliche Feiertage (DE) werden lokal berechnet — deterministisch und ohne
 * DB-Abhängigkeit, passend für Arbeitstag-Erkennung der Buchungen.
 */

function parseISO(s) {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(dt) {
  return dt.toISOString().slice(0, 10);
}

function addDays(s, n) {
  const dt = parseISO(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISO(dt);
}

function diffDays(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

function isWeekend(s) {
  const dow = parseISO(s).getUTCDay(); // 0=So, 6=Sa
  return dow === 0 || dow === 6;
}

function* eachDay(startISO, endISO) {
  let cur = startISO;
  while (cur <= endISO) {
    yield cur;
    cur = addDays(cur, 1);
  }
}

// Ostersonntag (Gauß/Meeus-Algorithmus) → Basis für bewegliche Feiertage.
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toISO(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Gesetzliche Feiertage eines Jahres für Deutschland (bundesweit + je Bundesland
 * die gängigen). stateCode z. B. "BW", "BY", "NW", "BE". Rückgabe: Set von ISO-Daten.
 */
function germanHolidays(year, stateCode = "BW") {
  const easter = easterSunday(year);
  const days = new Set();
  const add = (iso) => days.add(iso);

  // Bundesweit
  add(`${year}-01-01`); // Neujahr
  add(addDays(easter, -2)); // Karfreitag
  add(addDays(easter, 1)); // Ostermontag
  add(`${year}-05-01`); // Tag der Arbeit
  add(addDays(easter, 39)); // Christi Himmelfahrt
  add(addDays(easter, 50)); // Pfingstmontag
  add(`${year}-10-03`); // Tag der Deutschen Einheit
  add(`${year}-12-25`); // 1. Weihnachtstag
  add(`${year}-12-26`); // 2. Weihnachtstag

  const st = String(stateCode || "").toUpperCase();
  // Heilige Drei Könige
  if (["BW", "BY", "ST"].includes(st)) add(`${year}-01-06`);
  // Fronleichnam
  if (["BW", "BY", "HE", "NW", "RP", "SL"].includes(st)) add(addDays(easter, 60));
  // Mariä Himmelfahrt (BY teils, SL)
  if (["SL"].includes(st)) add(`${year}-08-15`);
  // Reformationstag
  if (["BB", "MV", "SN", "ST", "TH", "HB", "HH", "NI", "SH"].includes(st)) add(`${year}-10-31`);
  // Allerheiligen
  if (["BW", "BY", "NW", "RP", "SL"].includes(st)) add(`${year}-11-01`);

  return days;
}

// Feiertags-Set über eine Jahresspanne (gecacht pro Aufruf).
function holidaySetForRange(startISO, endISO, stateCode) {
  const y0 = parseISO(startISO).getUTCFullYear();
  const y1 = parseISO(endISO).getUTCFullYear();
  const all = new Set();
  for (let y = y0; y <= y1; y++) {
    for (const d of germanHolidays(y, stateCode)) all.add(d);
  }
  return all;
}

function isWorkingDay(iso, holidaySet) {
  if (isWeekend(iso)) return false;
  if (holidaySet && holidaySet.has(iso)) return false;
  return true;
}

// Datum auf "heute" (ISO) begrenzen — Bewegungsdaten sollen nicht in der Zukunft liegen.
function todayISO() {
  return toISO(new Date());
}

module.exports = {
  parseISO,
  toISO,
  addDays,
  diffDays,
  isWeekend,
  eachDay,
  easterSunday,
  germanHolidays,
  holidaySetForRange,
  isWorkingDay,
  todayISO,
};
