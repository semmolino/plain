"use strict";

// Testdateien bauen (XLSX/CSV), wie sie ein Nutzer hochladen wuerde.
const ExcelJS = require("exceljs");

/** Array-of-Arrays → XLSX-Buffer. Weitere Blaetter optional: { Name: aoa }. */
async function xlsxBuffer(aoa, { sheetName = "Daten", extraSheets = null } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  (aoa || []).forEach((row) => ws.addRow(row));
  for (const [name, rows] of Object.entries(extraSheets || {})) {
    const extra = wb.addWorksheet(name);
    (rows || []).forEach((row) => extra.addRow(row));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Array-of-Arrays → CSV-Buffer mit waehlbarem Trennzeichen und Codierung. */
function csvBuffer(aoa, { delimiter = ";", encoding = "utf8", bom = false } = {}) {
  const text = (aoa || [])
    .map((row) => row.map((c) => {
      const v = String(c ?? "");
      return /["\n\r]/.test(v) || v.includes(delimiter) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(delimiter))
    .join("\r\n");
  const body = Buffer.from(text, encoding);
  return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

module.exports = { xlsxBuffer, csvBuffer };
