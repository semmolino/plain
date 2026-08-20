"use strict";

/**
 * spreadsheet — Lesen hochgeladener Tabellen (XLSX/CSV) für den Datenimport.
 *
 * Kapselt exceljs, damit der Rest des Codes nichts über die Bibliothek weiß.
 * Löst `xlsx` (SheetJS 0.18.5) ab: dessen letzte npm-Version trägt
 * CVE-2023-30533 (Prototype Pollution im Parser) und CVE-2024-22363 (ReDoS),
 * die Fixes liegen nur auf cdn.sheetjs.com — für einen Endpunkt, der fremde
 * Dateien parst, kein Zustand.
 *
 * CSV läuft bewusst über einen eigenen kleinen Parser: deutsche Exporte kommen
 * regelmäßig als Semikolon-getrennte Windows-1252-Datei, was sonst zu
 * Zeichensalat („Straße" → „StraÃŸe") führt.
 */

const ExcelJS = require("exceljs");

// Name des Datenblatts in den plan&simple-Vorlagen.
const DATA_SHEET = "Daten";

// ── Erkennung ────────────────────────────────────────────────────────────────
/** XLSX/XLSM sind ZIP-Container und beginnen mit "PK". */
function isZip(buf) {
  return buf && buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;
}
/** Altes Binärformat .xls (OLE2 Compound File) — von exceljs nicht lesbar. */
function isLegacyXls(buf) {
  return buf && buf.length > 7 &&
    buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
}

// ── Zellwerte ────────────────────────────────────────────────────────────────
/** Datum als YYYY-MM-DD (UTC — exceljs liest Excel-Daten als UTC-Mitternacht). */
function isoDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * exceljs-Zellwert → einfacher Wert.
 * Zahlen bleiben Zahlen (sonst würde aus 1.234 beim Stringify eine
 * Tausendergruppe), Datumswerte werden zu ISO-Text, Formeln liefern ihr
 * Ergebnis, Fehlerzellen und Leeres werden zu "".
 */
function cellValue(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isoDate(v);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    if (v.error) return "";                                        // #REF!, #DIV/0! …
    if (v.formula !== undefined || v.sharedFormula !== undefined) return cellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text ?? "").join("");
    if (typeof v.text === "string") return v.text;                 // Hyperlink
    return "";
  }
  return String(v);
}

// ── Kopfzeile ────────────────────────────────────────────────────────────────
/**
 * Überschriften säubern: leere Spalten entfallen, Dubletten bekommen ein
 * Suffix, damit die Spaltenzuordnung im Assistenten eindeutig bleibt.
 * Gibt die Namen samt Spaltenindex zurück.
 */
function normalizeHeaders(rawHeaders) {
  const out = [];
  const seen = new Map();
  rawHeaders.forEach((raw, idx) => {
    const name = String(cellValue(raw) ?? "").trim();
    if (!name) return;
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    out.push({ name: n === 0 ? name : `${name}_${n + 1}`, index: idx });
  });
  return out;
}

/** Zeilenwerte + Kopfspalten → Objekt; leere Zeilen liefern null. */
function toRecord(values, headers) {
  const rec = {};
  let any = false;
  for (const h of headers) {
    const v = cellValue(values[h.index]);
    rec[h.name] = v;
    if (v !== "" && v !== null && v !== undefined) any = true;
  }
  return any ? rec : null;
}

// ── CSV ──────────────────────────────────────────────────────────────────────
/**
 * Bytes → Text. UTF-8 mit BOM gewinnt; sonst UTF-8 versuchen und bei
 * Ersatzzeichen auf Latin-1/Windows-1252 zurückfallen (Umlaute liegen dort
 * auf denselben Codepunkten).
 */
function decodeText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString("utf8");
  }
  const utf8 = buf.toString("utf8");
  return utf8.includes("�") ? buf.toString("latin1") : utf8;
}

/** Trennzeichen aus der Kopfzeile raten (Semikolon ist in DE der Normalfall). */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") || "";
  const counts = [";", ",", "\t", "|"].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ";";
}

/** CSV → Array von Zeilen (Array von Zellen). Beachtet Anführungszeichen. */
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }            // "" = literales "
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readCsvBuffer(buffer) {
  const text = decodeText(buffer);
  const delimiter = detectDelimiter(text);
  const raw = parseCsv(text, delimiter).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!raw.length) return { headers: [], rows: [], sheetName: "CSV", sheetNames: ["CSV"] };

  const headers = normalizeHeaders(raw[0].map((c) => c.trim()));
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const rec = toRecord(raw[i], headers);
    if (rec) rows.push(rec);
  }
  return { headers: headers.map((h) => h.name), rows, sheetName: "CSV", sheetNames: ["CSV"] };
}

// ── XLSX ─────────────────────────────────────────────────────────────────────
async function readXlsxBuffer(buffer, wantedSheet) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (e) {
    throw { status: 400, message: "Die Datei konnte nicht gelesen werden — ist es eine gültige Excel-Datei?" };
  }

  const sheetNames = wb.worksheets.map((w) => w.name);
  if (!sheetNames.length) throw { status: 400, message: "Die Datei enthält keine Tabelle" };
  // Reihenfolge: ausdrücklich gewähltes Blatt → „Daten“ (so heißt es in unseren
  // Vorlagen, die vorne die Anleitung tragen) → erstes Blatt der Datei.
  const ws = (wantedSheet && wb.getWorksheet(wantedSheet)) || wb.getWorksheet(DATA_SHEET) || wb.worksheets[0];

  // Zeile 1 = Überschriften. includeEmpty, damit Spaltenindizes stimmen.
  const headerVals = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headerVals[col] = cell.value; });
  const headers = normalizeHeaders(headerVals);

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => { values[col] = cell.value; });
    const rec = toRecord(values, headers);
    if (rec) rows.push(rec);
  });

  return { headers: headers.map((h) => h.name), rows, sheetName: ws.name, sheetNames };
}

// ── Öffentlich ───────────────────────────────────────────────────────────────
/**
 * Buffer (XLSX/CSV) → { headers, rows, sheetName, sheetNames }.
 * `rows` sind Objekte, geschlüsselt über die Überschriften der ersten Zeile.
 */
async function readTable(buffer, { sheetName } = {}) {
  if (!buffer || !buffer.length) throw { status: 400, message: "Die Datei ist leer" };
  if (isLegacyXls(buffer)) {
    throw {
      status: 400,
      message: "Alte Excel-Dateien (.xls) werden nicht unterstützt — bitte in Excel über „Speichern unter“ als .xlsx sichern und erneut hochladen.",
    };
  }
  if (isZip(buffer)) return readXlsxBuffer(buffer, sheetName);
  return readCsvBuffer(buffer);
}

module.exports = {
  readTable, DATA_SHEET,
  // für Tests
  cellValue, normalizeHeaders, decodeText, detectDelimiter, parseCsv,
};
