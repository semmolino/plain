"use strict";

// Leistungsphasen-Blöcke — konfigurierbar je Leistungsbild (FEE_MASTERS).
// Ein Block gruppiert FEE_PHASE-Einträge (Phasen-Katalog) desselben
// Leistungsbilds. Zuordnung liegt auf FEE_PHASE.BLOCK_ID.
//
// Alle Endpunkte sind soft-fail: fehlt die Migration 0097 (Tabelle LPH_BLOCK
// bzw. Spalte FEE_PHASE.BLOCK_ID), liefert GET { available:false } statt 500.

function missingSchema(err) {
  const m = String(err?.message || err || "");
  return /LPH_BLOCK/i.test(m) || /BLOCK_ID/i.test(m) || /does not exist/i.test(m);
}

// Führende Zahl aus dem Kürzel ("LPH 5" → 5) für Sortierung/Default-Zuordnung.
function lphNumber(nameShort) {
  const m = String(nameShort || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// GET /stammdaten/lph-blocks?fee_master_id=123
async function getBlocks(req, res, supabase) {
  const tenantId = req.tenantId;
  const feeMasterId = parseInt(req.query.fee_master_id, 10);
  if (!Number.isFinite(feeMasterId)) {
    return res.status(400).json({ error: "fee_master_id ist erforderlich" });
  }
  try {
    const [{ data: blocks, error: bErr }, { data: phases, error: pErr }] = await Promise.all([
      supabase.from("LPH_BLOCK")
        .select("ID, NAME_SHORT, SORT_ORDER")
        .eq("TENANT_ID", tenantId)
        .eq("FEE_MASTER_ID", feeMasterId)
        .order("SORT_ORDER", { ascending: true })
        .order("ID", { ascending: true }),
      supabase.from("FEE_PHASE")
        .select("ID, NAME_SHORT, NAME_LONG, BLOCK_ID")
        .eq("FEE_MASTER_ID", feeMasterId),
    ]);
    if (bErr) throw bErr;
    if (pErr) throw pErr;

    const sortedPhases = (phases || []).slice().sort((a, b) => {
      const ka = lphNumber(a.NAME_SHORT) ?? Number.MAX_SAFE_INTEGER;
      const kb = lphNumber(b.NAME_SHORT) ?? Number.MAX_SAFE_INTEGER;
      return ka - kb || (Number(a.ID) - Number(b.ID));
    });

    res.json({ data: { available: true, feeMasterId, blocks: blocks || [], phases: sortedPhases } });
  } catch (e) {
    if (missingSchema(e)) {
      return res.json({ data: { available: false, feeMasterId, blocks: [], phases: [] } });
    }
    res.status(500).json({ error: e?.message || String(e) });
  }
}

// POST /stammdaten/lph-blocks/save
// Body: {
//   fee_master_id,
//   blocks:  [{ key: string, id?: number|null, name_short: string, sort_order: number }],
//   assignments: { [feePhaseId]: blockKey | null }
// }
// Blöcke die nicht mehr in `blocks` vorkommen werden gelöscht
// (FEE_PHASE.BLOCK_ID wird per ON DELETE SET NULL geleert).
async function saveBlocks(req, res, supabase) {
  const tenantId = req.tenantId;
  const feeMasterId = parseInt(req.body?.fee_master_id, 10);
  if (!Number.isFinite(feeMasterId)) {
    return res.status(400).json({ error: "fee_master_id ist erforderlich" });
  }
  const incoming     = Array.isArray(req.body?.blocks) ? req.body.blocks : [];
  const assignments  = req.body?.assignments && typeof req.body.assignments === "object"
    ? req.body.assignments : {};

  try {
    // Bestehende Blöcke des Leistungsbilds laden.
    const { data: existing, error: exErr } = await supabase
      .from("LPH_BLOCK")
      .select("ID")
      .eq("TENANT_ID", tenantId)
      .eq("FEE_MASTER_ID", feeMasterId);
    if (exErr) throw exErr;
    const existingIds = new Set((existing || []).map((r) => r.ID));

    // key → block-ID auflösen (bestehende updaten, neue anlegen).
    const keyToId = new Map();
    const keptIds = new Set();
    for (let i = 0; i < incoming.length; i++) {
      const b = incoming[i] || {};
      const name = String(b.name_short || "").trim();
      if (!name) continue;
      const sort = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : i;
      const id   = Number.isFinite(Number(b.id)) ? Number(b.id) : null;
      if (id && existingIds.has(id)) {
        const { error } = await supabase.from("LPH_BLOCK")
          .update({ NAME_SHORT: name, SORT_ORDER: sort })
          .eq("ID", id).eq("TENANT_ID", tenantId);
        if (error) throw error;
        keyToId.set(String(b.key ?? id), id);
        keptIds.add(id);
      } else {
        const { data: ins, error } = await supabase.from("LPH_BLOCK")
          .insert({ TENANT_ID: tenantId, FEE_MASTER_ID: feeMasterId, NAME_SHORT: name, SORT_ORDER: sort })
          .select("ID").single();
        if (error) throw error;
        keyToId.set(String(b.key ?? ins.ID), ins.ID);
        keptIds.add(ins.ID);
      }
    }

    // Nicht mehr vorhandene Blöcke löschen.
    const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
    if (toDelete.length) {
      const { error } = await supabase.from("LPH_BLOCK")
        .delete().in("ID", toDelete).eq("TENANT_ID", tenantId);
      if (error) throw error;
    }

    // Phasen → Block zuordnen. Nur Phasen des Leistungsbilds anfassen.
    const { data: phases, error: phErr } = await supabase
      .from("FEE_PHASE").select("ID").eq("FEE_MASTER_ID", feeMasterId);
    if (phErr) throw phErr;
    const validPhaseIds = new Set((phases || []).map((p) => p.ID));

    // Gruppiere Phasen nach Ziel-Block, um Batch-Updates zu machen.
    const byBlock = new Map(); // blockId|null → [phaseId]
    for (const [phaseIdRaw, keyRaw] of Object.entries(assignments)) {
      const phaseId = parseInt(phaseIdRaw, 10);
      if (!validPhaseIds.has(phaseId)) continue;
      const blockId = keyRaw == null ? null : (keyToId.get(String(keyRaw)) ?? null);
      if (!byBlock.has(blockId)) byBlock.set(blockId, []);
      byBlock.get(blockId).push(phaseId);
    }
    for (const [blockId, phaseIds] of byBlock.entries()) {
      if (!phaseIds.length) continue;
      const { error } = await supabase.from("FEE_PHASE")
        .update({ BLOCK_ID: blockId }).in("ID", phaseIds);
      if (error) throw error;
    }

    return getBlocks(
      { tenantId, query: { fee_master_id: String(feeMasterId) } },
      res, supabase,
    );
  } catch (e) {
    if (missingSchema(e)) {
      return res.status(400).json({ error: "Leistungsphasen-Blöcke sind noch nicht verfügbar — Migration 0097 ausstehend." });
    }
    res.status(500).json({ error: e?.message || String(e) });
  }
}

// POST /stammdaten/lph-blocks/seed-default  Body: { fee_master_id }
// Legt die HOAI-Standardblöcke an (Planung 1–4 / Ausführung 5–7 / Überwachung 8–9)
// und ordnet die Phasen nach LPH-Nummer zu. Überschreibt bestehende Blöcke des
// Leistungsbilds.
async function seedDefault(req, res, supabase) {
  const tenantId = req.tenantId;
  const feeMasterId = parseInt(req.body?.fee_master_id, 10);
  if (!Number.isFinite(feeMasterId)) {
    return res.status(400).json({ error: "fee_master_id ist erforderlich" });
  }
  const DEFAULTS = [
    { name: "Planung (LPH 1–4)",       min: 1, max: 4, sort: 0 },
    { name: "Ausführung (LPH 5–7)",    min: 5, max: 7, sort: 1 },
    { name: "Überwachung (LPH 8–9)",   min: 8, max: 9, sort: 2 },
  ];
  try {
    const { data: phases, error: phErr } = await supabase
      .from("FEE_PHASE").select("ID, NAME_SHORT, BLOCK_ID").eq("FEE_MASTER_ID", feeMasterId);
    if (phErr) throw phErr;
    if (!phases || phases.length === 0) {
      return res.status(400).json({ error: "Dieses Leistungsbild hat keine Phasen." });
    }

    const blocks = DEFAULTS.map((d, i) => ({
      key: `def${i}`, id: null, name_short: d.name, sort_order: d.sort,
    }));
    const assignments = {};
    for (const p of phases) {
      const n = lphNumber(p.NAME_SHORT);
      const di = DEFAULTS.findIndex((d) => n != null && n >= d.min && n <= d.max);
      assignments[p.ID] = di >= 0 ? `def${di}` : null;
    }

    req.body = { fee_master_id: feeMasterId, blocks, assignments };
    return saveBlocks(req, res, supabase);
  } catch (e) {
    if (missingSchema(e)) {
      return res.status(400).json({ error: "Leistungsphasen-Blöcke sind noch nicht verfügbar — Migration 0097 ausstehend." });
    }
    res.status(500).json({ error: e?.message || String(e) });
  }
}

module.exports = { getBlocks, saveBlocks, seedDefault };
