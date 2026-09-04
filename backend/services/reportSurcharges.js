"use strict";

/**
 * Zuschläge, die die blattbasierten Reporting-Views nicht sehen.
 *
 * Budget und Leistungsstand werden im Reporting über die Blattknoten der
 * PROJECT_STRUCTURE aggregiert (Migration 0028: sonst zählt jedes Elternteil
 * die Summe seiner Kinder doppelt). Zuschläge hängen aber auch an
 * Nicht-Blattknoten und am Projekt selbst — die fehlen dadurch im
 * Auftragswert und müssen nachträglich addiert werden.
 *
 * Lag bis 0137 als Closure in routes/reports.js. Der Report „Teilfertige
 * Leistungen" braucht dieselbe Korrektur; eine zweite Kopie wäre eine zweite
 * Stelle, an der ein künftiger Zuschlagstyp vergessen wird.
 *
 * @returns {Promise<Map<string, number>>} Map<projectId (String), Zuschlagssumme>
 */
async function loadParentSurchargesByProject(supabase, tenantId, projectIds) {
  const out = new Map();
  if (!projectIds || projectIds.length === 0) return out;

  // 1) Zuschläge der Nicht-Blattknoten
  const { data: structRows } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("PROJECT_ID, ID, FATHER_ID, SURCHARGES_TOTAL")
    .eq("TENANT_ID", tenantId)
    .in("PROJECT_ID", projectIds);

  const fatherIds = new Set(
    (structRows || []).filter(r => r.FATHER_ID != null).map(r => String(r.FATHER_ID))
  );
  for (const r of structRows || []) {
    if (!fatherIds.has(String(r.ID))) continue;   // Blattknoten überspringen
    const inc = Number(r.SURCHARGES_TOTAL || 0);
    if (!inc) continue;
    const pid = String(r.PROJECT_ID);
    out.set(pid, (out.get(pid) || 0) + inc);
  }

  // 2) Zuschläge auf Projektebene
  try {
    const { data: projRows } = await supabase
      .from("PROJECT")
      .select("ID, SURCHARGES_TOTAL")
      .eq("TENANT_ID", tenantId)
      .in("ID", projectIds);
    for (const p of projRows || []) {
      const sur = Number(p.SURCHARGES_TOTAL || 0);
      if (!sur) continue;
      const pid = String(p.ID);
      out.set(pid, (out.get(pid) || 0) + sur);
    }
  } catch (_) {
    /* Spalte fehlt, wenn die Migration nicht gelaufen ist — weich fehlschlagen */
  }

  return out;
}

module.exports = { loadParentSurchargesByProject };
