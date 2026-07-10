"use strict";

/**
 * Movement-Reset: löscht ausschließlich die GENERIERTEN Bewegungsdaten eines
 * Mandanten und setzt die aggregierten Spalten auf PROJECT/PROJECT_STRUCTURE
 * auf ihren Ausgangswert (0) zurück. Die Stammdaten (Projekte, Strukturen,
 * Verträge, Zuordnungen, Kostensätze, Honorare) bleiben unberührt.
 *
 * So wird der Generator wiederholbar: reset → seed erzeugt exakt denselben Stand.
 *
 * SICHERHEIT: läuft nur mit apply=true. Der Aufrufer (index.js) verlangt dafür
 * explizit --reset --force. Niemals gegen echte Mandanten verwenden.
 */

// Kind→Eltern-Reihenfolge (FK-sicher). Alle tenant-gescopt über TENANT_ID.
const MOVEMENT_TABLES = [
  "PAYMENT_STRUCTURE",
  "PAYMENT",
  "INVOICE_DEDUCTION",
  "INVOICE_STRUCTURE",
  "PARTIAL_PAYMENT_STRUCTURE",
  "SE_RELEASE",
  "MAHNUNG_HISTORY",
  "MAHNUNG",
  "INVOICE",
  "PARTIAL_PAYMENT",
  "PROJECT_PROGRESS",
  "ARBZG_AUDIT",
  "EMPLOYEE_MONTH_CLOSE",
  "TEC",
  // Abwesenheit (Migration 0086) — Namen defensiv; fehlende Tabellen werden übersprungen.
  "ABSENCE",
];

function isMissingTable(msg) {
  const m = String(msg || "").toLowerCase();
  return m.includes("does not exist") || m.includes("could not find the table") || m.includes("schema cache");
}

async function countRows(supabase, table, tenantId) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("TENANT_ID", tenantId);
  if (error) return null;
  return count ?? 0;
}

/**
 * @param {object} opts { supabase, tenantId, apply, log }
 * @returns {Promise<{deleted: object, skipped: string[]}>}
 */
async function resetMovements({ supabase, tenantId, apply, log = () => {} }) {
  const deleted = {};
  const skipped = [];

  for (const table of MOVEMENT_TABLES) {
    const before = await countRows(supabase, table, tenantId);
    if (before === null) {
      skipped.push(table);
      continue;
    }
    if (!apply) {
      deleted[table] = before; // Dry-Run: zeigt, was gelöscht würde
      continue;
    }
    const { error } = await supabase.from(table).delete().eq("TENANT_ID", tenantId);
    if (error) {
      if (isMissingTable(error.message)) {
        skipped.push(table);
        continue;
      }
      throw new Error(`Reset ${table} fehlgeschlagen: ${error.message}`);
    }
    deleted[table] = before;
    log(`  ${table.padEnd(28)} −${before}`);
  }

  if (apply) {
    // Aggregat-Spalten zurücksetzen. REVENUE/EXTRAS bei BT=1 (Pauschal) sind
    // Stammdaten (Fixhonorar) und bleiben; bei BT=2 (Stunden) leiten sie sich
    // aus Buchungen ab → auf 0.
    const zeroAll = {
      COSTS: 0,
      INVOICED: 0,
      PARTIAL_PAYMENTS: 0,
      PAYED: 0,
      REVENUE_COMPLETION: 0,
      EXTRAS_COMPLETION: 0,
      REVENUE_COMPLETION_PERCENT: 0,
      EXTRAS_COMPLETION_PERCENT: 0,
      CLOSED_BY_INVOICE_ID: null,
    };
    await supabase.from("PROJECT_STRUCTURE").update(zeroAll).eq("TENANT_ID", tenantId);
    await supabase
      .from("PROJECT_STRUCTURE")
      .update({ REVENUE: 0, EXTRAS: 0 })
      .eq("TENANT_ID", tenantId)
      .eq("BILLING_TYPE_ID", 2);
    await supabase
      .from("PROJECT")
      .update({ INVOICED: 0, PARTIAL_PAYMENTS: 0, PAYED: 0 })
      .eq("TENANT_ID", tenantId);
    log("  PROJECT_STRUCTURE/PROJECT: Aggregat-Spalten auf 0 zurückgesetzt");
  }

  return { deleted, skipped };
}

module.exports = { resetMovements, MOVEMENT_TABLES };
