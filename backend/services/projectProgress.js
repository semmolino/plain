'use strict';

// Columns that must be ACCUMULATED (previous + incoming delta).
// All other tracked columns are SET (replace the previous value or carry forward if not provided).
const ACCUMULATE_COLS = ['PARTIAL_PAYMENTS', 'INVOICED', 'PAYED'];

// All columns we carry forward from a previous snapshot row.
const SNAPSHOT_COLS = [
  'REVENUE', 'EXTRAS', 'EXTRAS_PERCENT',
  'REVENUE_COMPLETION_PERCENT', 'EXTRAS_COMPLETION_PERCENT',
  'REVENUE_COMPLETION', 'EXTRAS_COMPLETION',
  'PARTIAL_PAYMENTS', 'INVOICED', 'PAYED',
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
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

  for (const row of rows) {
    const { data: prev } = await supabase
      .from('PROJECT_PROGRESS')
      .select(SNAPSHOT_COLS.join(', '))
      .eq('STRUCTURE_ID', row.STRUCTURE_ID)
      .order('created_at', { ascending: false })
      .order('ID',         { ascending: false })
      .limit(1)
      .maybeSingle();

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
