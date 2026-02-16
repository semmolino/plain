const path = require('path');

// Loads the BT mapping from the provided Excel file.
// Only uses the first sheet ("BT Fields") as requested.
// Returns an array of mapping rows: { table, field, refTable, refField, bt }

let _cache = null;

function normalizeBt(bt) {
  const m = String(bt || '').match(/BT-(\d+)/i);
  return m ? `BT-${parseInt(m[1], 10)}` : null;
}

function loadBtMapping() {
  if (_cache) return _cache;

  // Lazy-require to avoid crashing the server if dependency is not installed yet.
  // (But package.json includes it and npm install will fetch it.)
  // eslint-disable-next-line global-require
  const xlsx = require('xlsx');

  const filePath = path.join(__dirname, 'config', 'Mapping BT.xlsx');
  const wb = xlsx.readFile(filePath);

  const sheetName = wb.SheetNames.includes('BT Fields') ? 'BT Fields' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const rows = xlsx.utils.sheet_to_json(ws, { defval: null });

  // Expect columns: TABLE, FIELD, REF_TABLE, REF_FIELD, BT-FIELD
  const mapping = rows
    .map((r) => ({
      table: r.TABLE,
      field: r.FIELD,
      refTable: r.REF_TABLE,
      refField: r.REF_FIELD,
      bt: normalizeBt(r['BT-FIELD'] || r['BT-FIELD '] || r.BT || r['BT_FIELD']),
    }))
    .filter((r) => r.table && r.bt);

  _cache = mapping;
  return mapping;
}

module.exports = { loadBtMapping };
