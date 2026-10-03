"use strict";

/**
 * LPH-Controlling — Kennzahlen je Leistungsphase über mehrere Projekte
 * (Reporting → Leistungsphasen, Reiter „Leistungsphasen" im Gesamtprojekt).
 *
 * Liefert ROHSUMMEN (Honorar, Leistung, Stunden, Kosten) je Projekt,
 * Leistungsbild, Honorarzone und Leistungsphase. Gefiltert und verdichtet
 * wird im Browser (`pages/daten/lphMatrixCalc.ts`): Filter sind Chips über
 * geladenen Daten, und Quoten entstehen erst aus den Summen der gewählten
 * Auswahl — nie als Mittel über Zellen.
 *
 * Warum je Leistungsbild: „LPH 3" ist beim Gebäude die Entwurfsplanung
 * (15 %), beim Bebauungsplan der Plan zur Beschlussfassung (10 %). Bis 10/2026
 * stand beides in einer Spalte, und die Geotechnik (Teilleistungen „TL a–c")
 * fiel ganz heraus, weil ihr Kürzel keine Zahl trägt.
 *
 * Woher Leistungsbild und Phase kommen — über die Kalkulation, nicht über das
 * Kürzel des Strukturknotens (das darf das Büro umbenennen):
 *   PROJECT_STRUCTURE.FEE_CALC_PHASE_ID
 *     → FEE_CALCULATION_PHASE  (FEE_MASTER_ID = die KALKULATION, FEE_PHASE_ID)
 *     → FEE_CALCULATION_MASTER (FEE_MASTER_ID = Leistungsbild, ZONE_ID)
 *     → FEE_MASTERS / FEE_PHASE / FEE_ZONES (globale Kataloge, ohne Mandant)
 * Leistungsbilder gleichen Namens (HOAI 2013 und 2021) gelten als eines —
 * Phasen und Gewichtung sind dieselben.
 */

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const chunk = (arr, size = 200) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** `.in()` in Häppchen — lange ID-Listen sprengen sonst die URL. */
async function selectIn(supabase, table, cols, col, ids, tenantId) {
  const rows = [];
  for (const part of chunk([...new Set(ids)])) {
    let q = supabase.from(table).select(cols).in(col, part);
    if (tenantId != null) q = q.eq("TENANT_ID", tenantId);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

/**
 * Spaltenschlüssel einer Phase: „LPH 3" aus jedem Kürzel mit Zahl, sonst das
 * Kürzel selbst („TL a"). So landen „LPH 3" und „LPH3" in einer Spalte.
 */
function phaseKey(abbr) {
  const s = String(abbr ?? "").trim();
  const m = s.match(/\d+/);
  if (m && /^(lph|lp|phase)?\s*\d+$/i.test(s)) return `LPH ${parseInt(m[0], 10)}`;
  return s || "?";
}

/** Sortierung: LPH nach Nummer, danach Teilleistungen nach Katalogreihenfolge. */
function phaseSort(key, sortOrder) {
  const m = /^LPH (\d+)$/.exec(key);
  if (m) return parseInt(m[1], 10);
  return 1000 + (Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0);
}

/**
 * Rohsummen je (Projekt, Leistungsbild, Zone, Phase).
 *
 * @returns {Promise<{ leistungsbilder: Array, facts: Array, projectIds: Set }>}
 *   leistungsbilder: [{ key, label, phases: [{ key, name, hoaiPercent, sort }] }]
 *   facts:           [{ PROJECT_ID, LB, ZONE, PHASE, HONORAR_NET, EARNED_VALUE_NET, HOURS_TOTAL, COST_TOTAL }]
 *   projectIds:      Projekte, die mindestens eine Phase mit Werten haben
 */
async function loadPhaseFacts(supabase, { tenantId, projectIds }) {
  const empty = { leistungsbilder: [], facts: [], projectIds: new Set() };
  if (!projectIds.length) return empty;

  const [nodes, viewRows] = await Promise.all([
    selectIn(supabase, "PROJECT_STRUCTURE", "ID, PROJECT_ID, FATHER_ID, ABBR, FEE_CALC_PHASE_ID",
      "PROJECT_ID", projectIds, tenantId),
    selectIn(supabase, "VW_REPORT_PROJECT_DETAIL_STRUCTURE",
      "STRUCTURE_ID, PROJECT_ID, IS_LEAF, HOURS_TOTAL, COST_TOTAL, EARNED_VALUE_NET, HONORAR_NET",
      "PROJECT_ID", projectIds, tenantId),
  ]);

  // Knoten je Projekt; Phasen-Vorfahr über FATHER_ID (mit Zyklenschutz).
  const byIdPerProject = new Map();
  for (const n of nodes) {
    if (!byIdPerProject.has(n.PROJECT_ID)) byIdPerProject.set(n.PROJECT_ID, new Map());
    byIdPerProject.get(n.PROJECT_ID).set(n.ID, n);
  }
  const phaseAncestor = (projectId, startId) => {
    const byId = byIdPerProject.get(projectId);
    let cur = byId?.get(startId);
    const seen = new Set();
    while (cur && !seen.has(cur.ID)) {
      if (cur.FEE_CALC_PHASE_ID != null) return cur;
      seen.add(cur.ID);
      cur = cur.FATHER_ID != null ? byId.get(cur.FATHER_ID) : null;
    }
    return null;
  };

  // Kalkulationsphase → Kalkulation → Leistungsbild/Zone, Katalogphase.
  const calcPhaseIds = nodes.map((n) => n.FEE_CALC_PHASE_ID).filter((v) => v != null);
  if (!calcPhaseIds.length) return empty;
  const calcPhases = await selectIn(supabase, "FEE_CALCULATION_PHASE",
    "ID, FEE_MASTER_ID, FEE_PHASE_ID", "ID", calcPhaseIds, tenantId);
  const calcs = await selectIn(supabase, "FEE_CALCULATION_MASTER",
    "ID, FEE_MASTER_ID, ZONE_ID", "ID", calcPhases.map((c) => c.FEE_MASTER_ID).filter((v) => v != null), tenantId);
  const [masters, catalogPhases, zones] = await Promise.all([
    selectIn(supabase, "FEE_MASTERS", "ID, NAME", "ID", calcs.map((c) => c.FEE_MASTER_ID).filter((v) => v != null)),
    selectIn(supabase, "FEE_PHASE", "ID, ABBR, NAME, FEE_PERCENT, SORT_ORDER", "ID",
      calcPhases.map((c) => c.FEE_PHASE_ID).filter((v) => v != null)),
    selectIn(supabase, "FEE_ZONES", "ID, ABBR", "ID", calcs.map((c) => c.ZONE_ID).filter((v) => v != null)),
  ]);
  const calcPhaseById = new Map(calcPhases.map((r) => [String(r.ID), r]));
  const calcById      = new Map(calcs.map((r) => [String(r.ID), r]));
  const masterById    = new Map(masters.map((r) => [String(r.ID), r]));
  const catPhaseById  = new Map(catalogPhases.map((r) => [String(r.ID), r]));
  const zoneById      = new Map(zones.map((r) => [String(r.ID), r]));

  // Einordnung eines Phasenknotens, je Knoten einmal.
  const lbPhases = new Map(); // lbKey → Map(phaseKey → descriptor)
  const classify = new Map(); // nodeId → { LB, ZONE, PHASE }
  const classifyNode = (node) => {
    if (classify.has(node.ID)) return classify.get(node.ID);
    const cp     = calcPhaseById.get(String(node.FEE_CALC_PHASE_ID));
    const calc   = cp ? calcById.get(String(cp.FEE_MASTER_ID)) : null;
    const master = calc ? masterById.get(String(calc.FEE_MASTER_ID)) : null;
    const cat    = cp ? catPhaseById.get(String(cp.FEE_PHASE_ID)) : null;
    const zone   = calc ? zoneById.get(String(calc.ZONE_ID)) : null;
    // Ohne Kalkulation im Katalog (verwaiste Verknüpfung) bleibt das Kürzel
    // des Knotens — wie bisher —, aber ohne Leistungsbild.
    const LB     = master?.NAME ? String(master.NAME).trim() : "";
    const PHASE  = phaseKey(cat?.ABBR ?? node.ABBR);
    const ZONE   = zone?.ABBR ? String(zone.ABBR).trim() : "";
    if (!lbPhases.has(LB)) lbPhases.set(LB, new Map());
    const phases = lbPhases.get(LB);
    if (!phases.has(PHASE)) {
      phases.set(PHASE, {
        key: PHASE,
        name: cat?.NAME ?? null,
        hoaiPercent: cat?.FEE_PERCENT != null ? Number(cat.FEE_PERCENT) : null,
        sort: phaseSort(PHASE, cat?.SORT_ORDER),
      });
    }
    const out = { LB, ZONE, PHASE };
    classify.set(node.ID, out);
    return out;
  };

  const facts = new Map();
  for (const r of viewRows) {
    if (!r.IS_LEAF) continue;
    const anc = phaseAncestor(r.PROJECT_ID, r.STRUCTURE_ID);
    if (!anc) continue; // nur phasenzugeordnete Blätter zählen
    const c = classifyNode(anc);
    const key = `${r.PROJECT_ID}|${c.LB}|${c.ZONE}|${c.PHASE}`;
    if (!facts.has(key)) {
      facts.set(key, {
        PROJECT_ID: r.PROJECT_ID, LB: c.LB, ZONE: c.ZONE, PHASE: c.PHASE,
        HONORAR_NET: 0, EARNED_VALUE_NET: 0, HOURS_TOTAL: 0, COST_TOTAL: 0,
      });
    }
    const f = facts.get(key);
    f.HONORAR_NET      += Number(r.HONORAR_NET      || 0);
    f.EARNED_VALUE_NET += Number(r.EARNED_VALUE_NET || 0);
    f.HOURS_TOTAL      += Number(r.HOURS_TOTAL      || 0);
    f.COST_TOTAL       += Number(r.COST_TOTAL       || 0);
  }

  const factList = [...facts.values()]
    .map((f) => ({
      ...f,
      HONORAR_NET: round2(f.HONORAR_NET), EARNED_VALUE_NET: round2(f.EARNED_VALUE_NET),
      HOURS_TOTAL: round2(f.HOURS_TOTAL), COST_TOTAL: round2(f.COST_TOTAL),
    }))
    // Eine Phase ohne jeden Wert ist keine Aussage — wie im Projekt-Report.
    .filter((f) => f.HONORAR_NET !== 0 || f.COST_TOTAL !== 0 || f.HOURS_TOTAL !== 0 || f.EARNED_VALUE_NET !== 0);

  const used = new Set(factList.map((f) => `${f.LB}|${f.PHASE}`));
  const leistungsbilder = [...lbPhases.entries()]
    .map(([key, phases]) => ({
      key,
      label: key || "ohne Leistungsbild",
      phases: [...phases.values()]
        .filter((p) => used.has(`${key}|${p.key}`))
        .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key)),
    }))
    .filter((lb) => lb.phases.length > 0)
    .sort((a, b) => (a.key === "") - (b.key === "") || a.label.localeCompare(b.label, "de"));

  return {
    leistungsbilder,
    facts: factList,
    projectIds: new Set(factList.map((f) => f.PROJECT_ID)),
  };
}

module.exports = { loadPhaseFacts, phaseKey, phaseSort };
