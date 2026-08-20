const path = require('path');

// Loads the BT mapping from the provided Excel file.
// Only uses the first sheet ("BT Fields") as requested.
// Returns an array of mapping rows: { table, field, refTable, refField, bt }
//
// Liest über exceljs (async) — `xlsx`/SheetJS ist aus dem Projekt entfernt,
// weil dessen letzte npm-Version bekannte Parser-Schwachstellen trägt.

let _cache = null;

function normalizeBt(bt) {
  const m = String(bt || '').match(/BT-(\d+)/i);
  return m ? `BT-${parseInt(m[1], 10)}` : null;
}

/** Zellwert → einfacher Wert (Formeln liefern ihr Ergebnis, RichText seinen Text). */
function plain(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v.result !== undefined) return plain(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text ?? '').join('');
    if (typeof v.text === 'string') return v.text;
    return null;
  }
  return v;
}

async function loadBtMapping() {
  if (_cache) return _cache;

  // Lazy-require, damit der Server auch ohne installierte Abhängigkeit startet.
  // eslint-disable-next-line global-require
  const ExcelJS = require('exceljs');

  const filePath = path.join(__dirname, 'config', 'Mapping BT.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet('BT Fields') || wb.worksheets[0];

  // Expect columns: TABLE, FIELD, REF_TABLE, REF_FIELD, BT-FIELD
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(plain(cell.value) ?? '').trim();
  });

  const mapping = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const r = {};
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (headers[col]) r[headers[col]] = plain(cell.value);
    });
    const entry = {
      table: r.TABLE,
      field: r.FIELD,
      refTable: r.REF_TABLE,
      refField: r.REF_FIELD,
      bt: normalizeBt(r['BT-FIELD'] || r['BT-FIELD '] || r.BT || r.BT_FIELD),
    };
    if (entry.table && entry.bt) mapping.push(entry);
  });

  _cache = mapping;
  return mapping;
}

module.exports = { loadBtMapping };
