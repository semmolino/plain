'use strict';

// Columns that must be ACCUMULATED (previous + incoming delta).
// All other tracked columns are SET (replace the previous value or carry forward if not provided).
const ACCUMULATE_COLS = ['ADVANCE_INVOICED', 'INVOICED', 'PAYED'];

// All columns we carry forward from a previous snapshot row.
const SNAPSHOT_COLS = [
  'REVENUE', 'EXTRAS', 'EXTRAS_PERCENT',
  'REVENUE_COMPLETION_PERCENT', 'EXTRAS_COMPLETION_PERCENT',
  'REVENUE_COMPLETION', 'EXTRAS_COMPLETION',
  'ADVANCE_INVOICED', 'INVOICED', 'PAYED',
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Wieviele Knoten-Kennungen in einen `in`-Filter passen, ohne dass die URL zu
// lang wird. PostgREST spricht hier ueber GET-Parameter.
const IN_CHUNK = 200;

/**
 * Den jeweils letzten Schnappschuss aller genannten Knoten in einem Zug holen.
 *
 * BEFUND 09/2026: Diese Funktion hat den Vorstand mit EINER Abfrage JE ZEILE
 * geholt. Bei 4.050 Knoten sind das 4.050 sequentielle Rundreisen, und zwar an
 * jeder Stelle, die Schnappschuesse schreibt — auch beim Ruecksetzen eines
 * Imports. Genau diese Bauart hat den Projektimport in den Gateway-Abbruch
 * geschickt.
 *
 * Sortiert wird wie zuvor nach `created_at` und dann `ID` absteigend; die
 * Auswahl "neueste je Knoten" passiert jetzt in JS. Das Ergebnis ist
 * identisch, solange die Sortierung dieselbe bleibt — deshalb steht sie hier
 * und nicht verteilt.
 */
async function ladeVorstand(supabase, rows) {
  // Entdoppeln ueber den String, gefiltert wird mit dem ORIGINALWERT: eine in
  // Text verwandelte Kennung trifft in einem strikten Vergleich ihre Zeile
  // nicht mehr. PostgREST buegelt das aus, ein Test nicht.
  const eindeutig = new Map();
  for (const r of rows) {
    if (r.STRUCTURE_ID != null) eindeutig.set(String(r.STRUCTURE_ID), r.STRUCTURE_ID);
  }
  const ids = [...eindeutig.values()];
  const letzte = new Map();

  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const stapel = ids.slice(i, i + IN_CHUNK);
    const { data } = await supabase
      .from('PROJECT_PROGRESS')
      .select(['STRUCTURE_ID', ...SNAPSHOT_COLS].join(', '))
      .in('STRUCTURE_ID', stapel)
      .order('created_at', { ascending: false })
      .order('ID',         { ascending: false });

    // Erster Treffer je Knoten gewinnt — die Liste kommt bereits absteigend.
    for (const zeile of data || []) {
      const key = String(zeile.STRUCTURE_ID);
      if (!letzte.has(key)) letzte.set(key, zeile);
    }
  }

  return letzte;
}

/**
 * Insert PROJECT_PROGRESS rows with full carry-forward of the previous snapshot.
 *
 * For each row:
 *   - Fetches the latest existing PROJECT_PROGRESS row for that STRUCTURE_ID.
 *   - Carries forward every SNAPSHOT_COL that the incoming row doesn't explicitly set.
 *   - For ACCUMULATE_COLS: adds incoming delta to the previous value.
 *   - For all other cols: incoming value wins; if not provided, previous value is kept.
 *
 * @param {object} supabase  – Supabase client
 * @param {Array}  rows      – Array of { TENANT_ID, STRUCTURE_ID, [col]: value, ... }
 */
async function insertProgressSnapshot(supabase, rows) {
  if (!rows || rows.length === 0) return;

  const merged = [];
  const vorstand = await ladeVorstand(supabase, rows);

  for (const row of rows) {
    const prev = vorstand.get(String(row.STRUCTURE_ID)) || null;

    const out = { TENANT_ID: row.TENANT_ID, STRUCTURE_ID: row.STRUCTURE_ID };

    for (const col of SNAPSHOT_COLS) {
      const incoming = row[col];
      const previous = prev?.[col];

      if (incoming != null) {
        if (ACCUMULATE_COLS.includes(col) && previous != null) {
          out[col] = round2(Number(previous) + Number(incoming));
        } else {
          out[col] = incoming;
        }
      } else if (previous != null) {
        out[col] = previous;
      }
      // else: leave undefined (column not set in row, stays NULL in DB)
    }

    merged.push(out);
  }

  return supabase.from('PROJECT_PROGRESS').insert(merged);
}

module.exports = { insertProgressSnapshot };
