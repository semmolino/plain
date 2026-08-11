"use strict";

// DIN-276-Kostenermittlung — CRUD + Ableitung der anrechenbaren Kosten.
// Rechenlogik liegt in services/din276.js (rein, testbar). Hier nur DB + HTTP.
// Mandantentrennung: jede Query filtert per TENANT_ID.

const svc = require("../services/din276");

// Default-KG-Katalog (1. Ebene) beim Anlegen einer Kostenermittlung.
const DEFAULT_KG = [
  ["100", "Grundstück"],
  ["200", "Herrichten und Erschließen"],
  ["300", "Bauwerk – Baukonstruktionen"],
  ["400", "Bauwerk – Technische Anlagen"],
  ["500", "Außenanlagen"],
  ["600", "Ausstattung und Kunstwerke"],
  ["700", "Baunebenkosten"],
];

function missingSchema(err) {
  const m = String(err?.message || err || "");
  return /DIN276/i.test(m) || /does not exist/i.test(m);
}

async function listEstimates(req, res, supabase) {
  const tenantId = req.tenantId;
  const projectId = req.query.project_id ? parseInt(req.query.project_id, 10) : null;
  const offerId   = req.query.offer_id   ? parseInt(req.query.offer_id, 10)   : null;
  try {
    let q = supabase.from("DIN276_COST_ESTIMATE")
      .select("ID, NAME_SHORT, NAME_LONG, STAGE, STATUS, MITVERARBEITETE_BAUSUBSTANZ, PROJECT_ID, OFFER_ID, created_at")
      .eq("TENANT_ID", tenantId)
      .order("created_at", { ascending: false });
    if (projectId) q = q.eq("PROJECT_ID", projectId);
    if (offerId)   q = q.eq("OFFER_ID", offerId);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ data: data || [], available: true });
  } catch (e) {
    if (missingSchema(e)) return res.json({ data: [], available: false });
    res.status(500).json({ error: e?.message || String(e) });
  }
}

async function getEstimate(req, res, supabase) {
  const tenantId = req.tenantId;
  const id = parseInt(req.params.id, 10);
  try {
    const { data: est, error } = await supabase.from("DIN276_COST_ESTIMATE")
      .select("*").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
    if (error) throw error;
    if (!est) return res.status(404).json({ error: "Kostenermittlung nicht gefunden" });
    const { data: groups, error: gErr } = await supabase.from("DIN276_COST_GROUP")
      .select("*").eq("ESTIMATE_ID", id).eq("TENANT_ID", tenantId)
      .order("SORT_ORDER", { ascending: true }).order("KG_CODE", { ascending: true });
    if (gErr) throw gErr;
    res.json({ data: { ...est, groups: groups || [] } });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

async function createEstimate(req, res, supabase) {
  const tenantId = req.tenantId;
  const projectId = req.body?.project_id ? parseInt(req.body.project_id, 10) : null;
  const offerId   = req.body?.offer_id   ? parseInt(req.body.offer_id, 10)   : null;
  if (!projectId && !offerId) return res.status(400).json({ error: "project_id oder offer_id erforderlich" });
  try {
    const { data: est, error } = await supabase.from("DIN276_COST_ESTIMATE").insert({
      TENANT_ID: tenantId, PROJECT_ID: projectId, OFFER_ID: offerId,
      NAME_SHORT: req.body?.name_short || null, NAME_LONG: req.body?.name_long || null,
      STAGE: req.body?.stage || "berechnung",
    }).select("*").single();
    if (error) throw error;
    const rows = DEFAULT_KG.map(([kg, label], i) => ({
      TENANT_ID: tenantId, ESTIMATE_ID: est.ID, KG_CODE: kg, LABEL: label,
      AMOUNT: 0, IS_PLANNED_SELF: false, SORT_ORDER: i,
    }));
    await supabase.from("DIN276_COST_GROUP").insert(rows);
    const { data: groups } = await supabase.from("DIN276_COST_GROUP")
      .select("*").eq("ESTIMATE_ID", est.ID).eq("TENANT_ID", tenantId)
      .order("SORT_ORDER", { ascending: true });
    res.json({ data: { ...est, groups: groups || [] } });
  } catch (e) {
    if (missingSchema(e)) return res.status(400).json({ error: "DIN-276-Modul noch nicht verfügbar — Migration 0098 ausstehend." });
    res.status(500).json({ error: e?.message || String(e) });
  }
}

async function updateEstimate(req, res, supabase) {
  const tenantId = req.tenantId;
  const id = parseInt(req.params.id, 10);
  const patch = {};
  if ("name_short" in (req.body || {})) patch.NAME_SHORT = req.body.name_short || null;
  if ("name_long"  in (req.body || {})) patch.NAME_LONG  = req.body.name_long  || null;
  if ("stage"      in (req.body || {})) patch.STAGE      = req.body.stage;
  if ("status"     in (req.body || {})) patch.STATUS     = req.body.status;
  if ("mitverarbeitete_bausubstanz" in (req.body || {}))
    patch.MITVERARBEITETE_BAUSUBSTANZ = Number(req.body.mitverarbeitete_bausubstanz) || 0;
  try {
    const { data, error } = await supabase.from("DIN276_COST_ESTIMATE")
      .update(patch).eq("ID", id).eq("TENANT_ID", tenantId).select("*").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Kostenermittlung nicht gefunden" });
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

async function saveGroups(req, res, supabase) {
  const tenantId = req.tenantId;
  const id = parseInt(req.params.id, 10);
  const incoming = Array.isArray(req.body?.groups) ? req.body.groups : [];
  try {
    const { data: est } = await supabase.from("DIN276_COST_ESTIMATE")
      .select("ID").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
    if (!est) return res.status(404).json({ error: "Kostenermittlung nicht gefunden" });

    const { data: existing } = await supabase.from("DIN276_COST_GROUP")
      .select("ID").eq("ESTIMATE_ID", id).eq("TENANT_ID", tenantId);
    const existingIds = new Set((existing || []).map((r) => r.ID));
    const keptIds = new Set();

    for (let i = 0; i < incoming.length; i++) {
      const g = incoming[i] || {};
      const kg = String(g.kg_code || "").trim();
      if (!kg) continue;
      const rowData = {
        KG_CODE: kg, LABEL: g.label || null, AMOUNT: Number(g.amount) || 0,
        IS_PLANNED_SELF: Boolean(g.is_planned_self),
        SORT_ORDER: Number.isFinite(Number(g.sort_order)) ? Number(g.sort_order) : i,
      };
      const gid = Number.isFinite(Number(g.id)) ? Number(g.id) : null;
      if (gid && existingIds.has(gid)) {
        await supabase.from("DIN276_COST_GROUP").update(rowData).eq("ID", gid).eq("TENANT_ID", tenantId);
        keptIds.add(gid);
      } else {
        const { data: ins } = await supabase.from("DIN276_COST_GROUP")
          .insert({ TENANT_ID: tenantId, ESTIMATE_ID: id, ...rowData }).select("ID").single();
        if (ins) keptIds.add(ins.ID);
      }
    }
    const toDelete = [...existingIds].filter((x) => !keptIds.has(x));
    if (toDelete.length) {
      await supabase.from("DIN276_COST_GROUP").delete().in("ID", toDelete).eq("TENANT_ID", tenantId);
    }
    return getEstimate({ tenantId, params: { id: String(id) } }, res, supabase);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

// GET /din276/estimates/:id/anrechenbar?leistungsbild=gebaeude
async function computeAnrechenbar(req, res, supabase) {
  const tenantId = req.tenantId;
  const id = parseInt(req.params.id, 10);
  const { key, opts } = svc.parseLeistungsbild(req.query.leistungsbild || "gebaeude");
  try {
    const { data: est } = await supabase.from("DIN276_COST_ESTIMATE")
      .select("ID, MITVERARBEITETE_BAUSUBSTANZ").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
    if (!est) return res.status(404).json({ error: "Kostenermittlung nicht gefunden" });
    const { data: groups } = await supabase.from("DIN276_COST_GROUP")
      .select("KG_CODE, AMOUNT, IS_PLANNED_SELF").eq("ESTIMATE_ID", id).eq("TENANT_ID", tenantId);
    const estimate = {
      mitverarbeiteteBausubstanz: est.MITVERARBEITETE_BAUSUBSTANZ,
      groups: (groups || []).map((g) => ({ kg: g.KG_CODE, amount: g.AMOUNT, isPlannedSelf: g.IS_PLANNED_SELF })),
    };
    const result = svc.anrechenbareKosten(key, estimate, opts);
    res.json({ data: result });
  } catch (e) {
    res.status(400).json({ error: e?.message || String(e) });
  }
}

async function deleteEstimate(req, res, supabase) {
  const tenantId = req.tenantId;
  const id = parseInt(req.params.id, 10);
  try {
    const { error } = await supabase.from("DIN276_COST_ESTIMATE")
      .delete().eq("ID", id).eq("TENANT_ID", tenantId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

module.exports = {
  listEstimates, getEstimate, createEstimate, updateEstimate,
  saveGroups, computeAnrechenbar, deleteEstimate,
};
