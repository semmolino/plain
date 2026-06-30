"use strict";

// ── Owner-Konsole: Inbox für Feedback & Unterstützung (SERVICE_REQUEST) ───────
// Privat (Org ↔ plan&simple). Identitäten hier sichtbar, alle Aktionen auditiert.
// Siehe docs/SERVICE_AREA_CONCEPT.md §7/§8.

const express = require("express");
const { supabase } = require("../services/db");
const { writeChangeLog } = require("../services/audit");

const router = express.Router();

const STATUSES = ["new", "in_progress", "waiting", "resolved", "closed"];

async function orgNames(tenantIds) {
  if (!tenantIds.length) return {};
  const { data } = await supabase.from("COMPANY").select("TENANT_ID, COMPANY_NAME_1").in("TENANT_ID", tenantIds);
  const map = {};
  for (const c of data || []) if (!map[c.TENANT_ID]) map[c.TENANT_ID] = c.COMPANY_NAME_1;
  return map;
}
async function empNames(ids) {
  if (!ids.length) return {};
  const { data } = await supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME, MAIL").in("ID", ids);
  const map = {};
  for (const e of data || [])
    map[e.ID] = { name: [e.FIRST_NAME, e.LAST_NAME].filter(Boolean).join(" ").trim() || e.SHORT_NAME || `#${e.ID}`, mail: e.MAIL || null };
  return map;
}

// GET /requests?kind=&status=
router.get("/requests", async (req, res) => {
  let q = supabase.from("SERVICE_REQUEST").select("*");
  if (req.query.kind) q = q.eq("KIND", req.query.kind);
  if (req.query.status && req.query.status !== "all") q = q.eq("STATUS", req.query.status);
  const { data, error } = await q.order("CREATED_AT", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const [orgMap, empMap] = await Promise.all([
    orgNames([...new Set(rows.map((r) => r.TENANT_ID))]),
    empNames([...new Set(rows.map((r) => r.EMPLOYEE_ID))]),
  ]);
  res.json({
    requests: rows.map((r) => ({
      id: r.ID, tenant_id: r.TENANT_ID, org_name: orgMap[r.TENANT_ID] || `Tenant ${r.TENANT_ID}`,
      submitter_name: empMap[r.EMPLOYEE_ID]?.name || `#${r.EMPLOYEE_ID}`,
      contact_name: r.CONTACT_NAME, contact_email: r.CONTACT_EMAIL || empMap[r.EMPLOYEE_ID]?.mail || null,
      kind: r.KIND, category: r.CATEGORY, subject: r.SUBJECT, body: r.BODY,
      status: r.STATUS, urgency: r.URGENCY, wants_reply: r.WANTS_REPLY, created_at: r.CREATED_AT,
    })),
  });
});

// GET /requests/:id — Detail + Nachrichten
router.get("/requests/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { data: r } = await supabase.from("SERVICE_REQUEST").select("*").eq("ID", id).maybeSingle();
  if (!r) return res.status(404).json({ error: "Nicht gefunden" });
  const [orgMap, empMap] = await Promise.all([orgNames([r.TENANT_ID]), empNames([r.EMPLOYEE_ID])]);
  const { data: msgs } = await supabase.from("SERVICE_REQUEST_MESSAGE")
    .select("*").eq("REQUEST_ID", id).order("CREATED_AT", { ascending: true });
  res.json({
    request: {
      id: r.ID, org_name: orgMap[r.TENANT_ID] || `Tenant ${r.TENANT_ID}`,
      submitter_name: empMap[r.EMPLOYEE_ID]?.name || `#${r.EMPLOYEE_ID}`,
      contact_name: r.CONTACT_NAME, contact_email: r.CONTACT_EMAIL || empMap[r.EMPLOYEE_ID]?.mail || null,
      kind: r.KIND, category: r.CATEGORY, subject: r.SUBJECT, body: r.BODY,
      status: r.STATUS, urgency: r.URGENCY, wants_reply: r.WANTS_REPLY, created_at: r.CREATED_AT,
    },
    messages: (msgs || []).map((m) => ({
      id: m.ID, body: m.BODY, author_kind: m.AUTHOR_KIND, created_at: m.CREATED_AT,
    })),
  });
});

// POST /requests/:id/reply { body } — Antwort an den Anwender (setzt Status 'waiting')
router.post("/requests/:id/reply", async (req, res) => {
  const id = Number(req.params.id);
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "Antworttext erforderlich" });
  const { error: e1 } = await supabase.from("SERVICE_REQUEST_MESSAGE").insert([{
    REQUEST_ID: id, AUTHOR_KIND: "vendor", EMPLOYEE_ID: null, BODY: body,
  }]);
  if (e1) return res.status(400).json({ error: e1.message });
  await supabase.from("SERVICE_REQUEST").update({ STATUS: "waiting", UPDATED_AT: new Date().toISOString() }).eq("ID", id);
  await writeChangeLog({ actor: req.adminEmail, entity: "SERVICE_REQUEST", entityRef: id, action: "reply" });
  res.json({ ok: true });
});

// POST /requests/:id/status { status }
router.post("/requests/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Ungültiger Status" });
  const { error } = await supabase.from("SERVICE_REQUEST").update({ STATUS: status, UPDATED_AT: new Date().toISOString() }).eq("ID", id);
  if (error) return res.status(400).json({ error: error.message });
  await writeChangeLog({ actor: req.adminEmail, entity: "SERVICE_REQUEST", entityRef: id, action: "status", after: { status } });
  res.json({ ok: true });
});

module.exports = router;
