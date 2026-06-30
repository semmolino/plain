"use strict";

// ── Owner-Konsole: Moderation der Funktions-Vorschläge ────────────────────────
// Dies ist die EINZIGE Stelle, an der echte Identitäten (Organisation, Einreicher)
// sichtbar sind. Alle mutierenden Aktionen werden auditiert (writeChangeLog).
// Siehe docs/SERVICE_AREA_CONCEPT.md §4.

const express = require("express");
const { supabase } = require("../services/db");
const { writeChangeLog } = require("../services/audit");

const router = express.Router();

const LIFECYCLE = ["new", "reviewing", "planned", "in_progress", "shipped", "not_planned"];

// Organisations-/Einreicher-Namen für eine Menge Vorschläge nachladen.
async function enrich(rows) {
  const tenantIds = [...new Set(rows.map((r) => r.TENANT_ID).filter(Boolean))];
  const empIds = [...new Set(rows.map((r) => r.EMPLOYEE_ID).filter(Boolean))];

  const [{ data: comps }, { data: emps }] = await Promise.all([
    tenantIds.length
      ? supabase.from("COMPANY").select("TENANT_ID, COMPANY_NAME_1").in("TENANT_ID", tenantIds)
      : Promise.resolve({ data: [] }),
    empIds.length
      ? supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME, MAIL").in("ID", empIds)
      : Promise.resolve({ data: [] }),
  ]);

  const orgMap = {};
  for (const c of comps || []) if (!orgMap[c.TENANT_ID]) orgMap[c.TENANT_ID] = c.COMPANY_NAME_1; // erste Firma je Tenant
  const empMap = {};
  for (const e of emps || []) {
    const name = [e.FIRST_NAME, e.LAST_NAME].filter(Boolean).join(" ").trim() || e.SHORT_NAME || `#${e.ID}`;
    empMap[e.ID] = { name, mail: e.MAIL || null };
  }
  return { orgMap, empMap };
}

function shape(r, orgMap, empMap) {
  const emp = empMap[r.EMPLOYEE_ID] || {};
  return {
    id: r.ID,
    tenant_id: r.TENANT_ID,
    org_name: orgMap[r.TENANT_ID] || `Tenant ${r.TENANT_ID}`,
    submitter_name: emp.name || `#${r.EMPLOYEE_ID}`,
    submitter_mail: emp.mail || null,
    title: r.TITLE,
    body: r.BODY,
    public_title: r.PUBLIC_TITLE,
    public_body: r.PUBLIC_BODY,
    category: r.CATEGORY,
    priority_hint: r.PRIORITY_HINT,
    moderation_state: r.MODERATION_STATE,
    lifecycle_status: r.LIFECYCLE_STATUS,
    merged_into_id: r.MERGED_INTO_ID,
    vote_count: r.VOTE_COUNT,
    jira_issue_key: r.JIRA_ISSUE_KEY,
    created_at: r.CREATED_AT,
    published_at: r.PUBLISHED_AT,
  };
}

// GET /suggestions?state=pending|published|declined|merged|all
router.get("/suggestions", async (req, res) => {
  const state = req.query.state || "all";
  let q = supabase.from("SUGGESTION").select("*");
  if (state !== "all") q = q.eq("MODERATION_STATE", state);
  const { data, error } = await q.order("CREATED_AT", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const { orgMap, empMap } = await enrich(rows);
  res.json({ suggestions: rows.map((r) => shape(r, orgMap, empMap)) });
});

// GET /suggestions/:id — Detail inkl. aller Kommentare
router.get("/suggestions/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { data: r } = await supabase.from("SUGGESTION").select("*").eq("ID", id).maybeSingle();
  if (!r) return res.status(404).json({ error: "Nicht gefunden" });
  const { orgMap, empMap } = await enrich([r]);

  const { data: comments } = await supabase.from("SUGGESTION_COMMENT")
    .select("*").eq("SUGGESTION_ID", id).order("CREATED_AT", { ascending: true });
  // Einreicher der Kommentare nachladen (für die Moderationsansicht)
  const cEmpIds = [...new Set((comments || []).map((c) => c.EMPLOYEE_ID).filter(Boolean))];
  let cEmpMap = {};
  if (cEmpIds.length) {
    const { data: ce } = await supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME").in("ID", cEmpIds);
    cEmpMap = Object.fromEntries((ce || []).map((e) => [e.ID, [e.FIRST_NAME, e.LAST_NAME].filter(Boolean).join(" ").trim() || e.SHORT_NAME]));
  }

  res.json({
    suggestion: shape(r, orgMap, empMap),
    comments: (comments || []).map((c) => ({
      id: c.ID,
      body: c.BODY,
      author_kind: c.AUTHOR_KIND,
      visibility: c.VISIBILITY,
      moderation_state: c.MODERATION_STATE,
      author_name: c.AUTHOR_KIND === "vendor" ? "plan&simple" : (cEmpMap[c.EMPLOYEE_ID] || `#${c.EMPLOYEE_ID}`),
      created_at: c.CREATED_AT,
    })),
  });
});

// PATCH /suggestions/:id — kuratierten Text / Status / Kategorie bearbeiten
router.patch("/suggestions/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { data: before } = await supabase.from("SUGGESTION").select("*").eq("ID", id).maybeSingle();
  if (!before) return res.status(404).json({ error: "Nicht gefunden" });

  const FIELDS = { public_title: "PUBLIC_TITLE", public_body: "PUBLIC_BODY", lifecycle_status: "LIFECYCLE_STATUS", category: "CATEGORY" };
  const patch = {};
  for (const [k, col] of Object.entries(FIELDS)) if (k in (req.body || {})) patch[col] = req.body[k];
  if ("LIFECYCLE_STATUS" in patch && !LIFECYCLE.includes(patch.LIFECYCLE_STATUS))
    return res.status(400).json({ error: "Ungültiger lifecycle_status" });
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Keine Felder" });
  patch.UPDATED_AT = new Date().toISOString();

  const { data, error } = await supabase.from("SUGGESTION").update(patch).eq("ID", id).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "SUGGESTION", entityRef: id, action: "update", before, after: data });
  res.json({ ok: true });
});

// POST /suggestions/:id/publish — freigeben (PUBLIC_* aus Original vorbelegen, falls leer)
router.post("/suggestions/:id/publish", async (req, res) => {
  const id = Number(req.params.id);
  const { data: r } = await supabase.from("SUGGESTION").select("*").eq("ID", id).maybeSingle();
  if (!r) return res.status(404).json({ error: "Nicht gefunden" });
  const patch = {
    MODERATION_STATE: "published",
    PUBLISHED_AT: r.PUBLISHED_AT || new Date().toISOString(),
    PUBLIC_TITLE: r.PUBLIC_TITLE || r.TITLE,
    PUBLIC_BODY: r.PUBLIC_BODY || r.BODY,
    LIFECYCLE_STATUS: r.LIFECYCLE_STATUS === "new" ? "reviewing" : r.LIFECYCLE_STATUS,
    UPDATED_AT: new Date().toISOString(),
  };
  const { error } = await supabase.from("SUGGESTION").update(patch).eq("ID", id);
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "SUGGESTION", entityRef: id, action: "publish", after: patch });
  res.json({ ok: true });
});

// POST /suggestions/:id/decline — zurückweisen (nicht veröffentlichen)
router.post("/suggestions/:id/decline", async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await supabase.from("SUGGESTION")
    .update({ MODERATION_STATE: "declined", UPDATED_AT: new Date().toISOString() }).eq("ID", id);
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "SUGGESTION", entityRef: id, action: "decline" });
  res.json({ ok: true });
});

// POST /suggestions/:id/lifecycle — nur den öffentlichen Status setzen
router.post("/suggestions/:id/lifecycle", async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.lifecycle_status;
  if (!LIFECYCLE.includes(status)) return res.status(400).json({ error: "Ungültiger lifecycle_status" });
  const { error } = await supabase.from("SUGGESTION")
    .update({ LIFECYCLE_STATUS: status, UPDATED_AT: new Date().toISOString() }).eq("ID", id);
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "SUGGESTION", entityRef: id, action: "lifecycle", after: { lifecycle_status: status } });
  res.json({ ok: true });
});

// POST /suggestions/:id/merge { into_id } — als Duplikat zusammenführen (+ Stimmen übertragen)
router.post("/suggestions/:id/merge", async (req, res) => {
  const id = Number(req.params.id);
  const intoId = Number(req.body?.into_id);
  if (!intoId || intoId === id) return res.status(400).json({ error: "Gültige into_id erforderlich" });
  const { data: target } = await supabase.from("SUGGESTION").select("ID").eq("ID", intoId).maybeSingle();
  if (!target) return res.status(400).json({ error: "Ziel-Vorschlag nicht gefunden" });

  // Stimmen des Duplikats auf den Ziel-Vorschlag übertragen (Unique-Konflikte ignorieren)
  const { data: votes } = await supabase.from("SUGGESTION_VOTE").select("TENANT_ID, EMPLOYEE_ID").eq("SUGGESTION_ID", id);
  for (const v of votes || []) {
    await supabase.from("SUGGESTION_VOTE")
      .upsert([{ SUGGESTION_ID: intoId, TENANT_ID: v.TENANT_ID, EMPLOYEE_ID: v.EMPLOYEE_ID }], { onConflict: "SUGGESTION_ID,TENANT_ID" });
  }
  // Ziel-Stimmenzahl neu berechnen
  const { data: cnt } = await supabase.from("SUGGESTION_VOTE").select("ID").eq("SUGGESTION_ID", intoId);
  await supabase.from("SUGGESTION").update({ VOTE_COUNT: (cnt || []).length }).eq("ID", intoId);

  await supabase.from("SUGGESTION")
    .update({ MODERATION_STATE: "merged", MERGED_INTO_ID: intoId, UPDATED_AT: new Date().toISOString() }).eq("ID", id);
  await writeChangeLog({ actor: req.adminEmail, entity: "SUGGESTION", entityRef: id, action: "merge", after: { into_id: intoId } });
  res.json({ ok: true });
});

// POST /suggestions/:id/respond { body, visibility } — offizielle plan&simple-Antwort
router.post("/suggestions/:id/respond", async (req, res) => {
  const id = Number(req.params.id);
  const body = String(req.body?.body || "").trim();
  const visibility = req.body?.visibility === "vendor_only" ? "vendor_only" : "public";
  if (!body) return res.status(400).json({ error: "Antworttext erforderlich" });
  const { error } = await supabase.from("SUGGESTION_COMMENT").insert([{
    SUGGESTION_ID: id, TENANT_ID: null, EMPLOYEE_ID: null,
    BODY: body, AUTHOR_KIND: "vendor", VISIBILITY: visibility, MODERATION_STATE: "published",
  }]);
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "SUGGESTION_COMMENT", entityRef: id, action: "respond", after: { visibility } });
  res.json({ ok: true });
});

// GET /suggestion-comments?state=pending — Anwender-Kommentare zur Moderation
router.get("/suggestion-comments", async (req, res) => {
  const state = req.query.state || "pending";
  const { data, error } = await supabase.from("SUGGESTION_COMMENT")
    .select("*").eq("AUTHOR_KIND", "user").eq("MODERATION_STATE", state).order("CREATED_AT", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    comments: (data || []).map((c) => ({
      id: c.ID, suggestion_id: c.SUGGESTION_ID, body: c.BODY, created_at: c.CREATED_AT,
    })),
  });
});

// POST /suggestion-comments/:id/publish | /decline
router.post("/suggestion-comments/:id/:action", async (req, res) => {
  const id = Number(req.params.id);
  const action = req.params.action;
  if (!["publish", "decline"].includes(action)) return res.status(400).json({ error: "Ungültige Aktion" });
  const newState = action === "publish" ? "published" : "declined";
  const { error } = await supabase.from("SUGGESTION_COMMENT").update({ MODERATION_STATE: newState }).eq("ID", id);
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "SUGGESTION_COMMENT", entityRef: id, action });
  res.json({ ok: true });
});

module.exports = router;
