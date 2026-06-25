"use strict";

// ---------------------------------------------------------------------------
// Buchungstextvorlagen (BOOKING_TEXT_SNIPPET)
//   SCOPE = 'employee'  persönlich (EMPLOYEE_ID gesetzt) — jeder pflegt seine eigenen
//   SCOPE = 'global'    admin-weit  (EMPLOYEE_ID = NULL)  — Verwaltung gated
// Beim Buchen sieht ein Mitarbeiter: globale ∪ eigene.
// ---------------------------------------------------------------------------

const COLS = "ID, LABEL, TEXT, SORT_ORDER, SCOPE";

function cleanRow(body) {
  const text = (body.text || "").trim();
  if (!text) throw { status: 400, message: "Text ist erforderlich." };
  return {
    LABEL:      (body.label || "").trim() || null,
    TEXT:       text,
    SORT_ORDER: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
  };
}

// ── Auswahl beim Buchen: globale + eigene persönliche ────────────────────────
async function listSnippets(supabase, { tenantId, employeeId }) {
  let query = supabase.from("BOOKING_TEXT_SNIPPET").select(COLS).eq("TENANT_ID", tenantId);
  if (employeeId) {
    query = query.or(`SCOPE.eq.global,and(SCOPE.eq.employee,EMPLOYEE_ID.eq.${Number(employeeId)})`);
  } else {
    query = query.eq("SCOPE", "global");
  }
  const { data, error } = await query
    .order("SCOPE", { ascending: true })
    .order("SORT_ORDER", { ascending: true })
    .order("ID", { ascending: true });
  if (error) throw { status: 500, message: error.message };
  return data || [];
}

// ── Persönliche Textbausteine (kein Recht nötig) ─────────────────────────────
async function createSnippet(supabase, { tenantId, employeeId, body }) {
  if (!employeeId) throw { status: 400, message: "Kein Mitarbeiter im Kontext." };
  const row = { ...cleanRow(body), TENANT_ID: tenantId, EMPLOYEE_ID: employeeId, SCOPE: "employee" };
  const { data, error } = await supabase.from("BOOKING_TEXT_SNIPPET").insert([row]).select(COLS).single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

async function updateSnippet(supabase, { tenantId, employeeId, id, body }) {
  const { data: existing } = await supabase
    .from("BOOKING_TEXT_SNIPPET").select("ID")
    .eq("ID", id).eq("TENANT_ID", tenantId).eq("EMPLOYEE_ID", employeeId).eq("SCOPE", "employee").maybeSingle();
  if (!existing) throw { status: 404, message: "Textbaustein nicht gefunden." };
  const update = {};
  if (body.label !== undefined) update.LABEL = (body.label || "").trim() || null;
  if (body.text  !== undefined) {
    const t = (body.text || "").trim();
    if (!t) throw { status: 400, message: "Text ist erforderlich." };
    update.TEXT = t;
  }
  if (body.sort_order !== undefined) update.SORT_ORDER = Number(body.sort_order) || 0;
  if (!Object.keys(update).length) return existing;
  const { data, error } = await supabase
    .from("BOOKING_TEXT_SNIPPET").update(update)
    .eq("ID", id).eq("TENANT_ID", tenantId).eq("EMPLOYEE_ID", employeeId).eq("SCOPE", "employee")
    .select(COLS).single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

async function deleteSnippet(supabase, { tenantId, employeeId, id }) {
  const { error } = await supabase
    .from("BOOKING_TEXT_SNIPPET").delete()
    .eq("ID", id).eq("TENANT_ID", tenantId).eq("EMPLOYEE_ID", employeeId).eq("SCOPE", "employee");
  if (error) throw { status: 500, message: error.message };
}

// ── Globale Buchungstextvorlagen (gated: settings.booking_text_templates.edit) ─
async function listGlobal(supabase, { tenantId }) {
  const { data, error } = await supabase
    .from("BOOKING_TEXT_SNIPPET").select(COLS)
    .eq("TENANT_ID", tenantId).eq("SCOPE", "global")
    .order("SORT_ORDER", { ascending: true }).order("ID", { ascending: true });
  if (error) throw { status: 500, message: error.message };
  return data || [];
}

async function createGlobal(supabase, { tenantId, body }) {
  const row = { ...cleanRow(body), TENANT_ID: tenantId, EMPLOYEE_ID: null, SCOPE: "global" };
  const { data, error } = await supabase.from("BOOKING_TEXT_SNIPPET").insert([row]).select(COLS).single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

async function updateGlobal(supabase, { tenantId, id, body }) {
  const { data: existing } = await supabase
    .from("BOOKING_TEXT_SNIPPET").select("ID")
    .eq("ID", id).eq("TENANT_ID", tenantId).eq("SCOPE", "global").maybeSingle();
  if (!existing) throw { status: 404, message: "Textvorlage nicht gefunden." };
  const update = {};
  if (body.label !== undefined) update.LABEL = (body.label || "").trim() || null;
  if (body.text  !== undefined) {
    const t = (body.text || "").trim();
    if (!t) throw { status: 400, message: "Text ist erforderlich." };
    update.TEXT = t;
  }
  if (body.sort_order !== undefined) update.SORT_ORDER = Number(body.sort_order) || 0;
  const { data, error } = await supabase
    .from("BOOKING_TEXT_SNIPPET").update(update)
    .eq("ID", id).eq("TENANT_ID", tenantId).eq("SCOPE", "global").select(COLS).single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

async function deleteGlobal(supabase, { tenantId, id }) {
  const { error } = await supabase
    .from("BOOKING_TEXT_SNIPPET").delete()
    .eq("ID", id).eq("TENANT_ID", tenantId).eq("SCOPE", "global");
  if (error) throw { status: 500, message: error.message };
}

module.exports = {
  listSnippets, createSnippet, updateSnippet, deleteSnippet,
  listGlobal, createGlobal, updateGlobal, deleteGlobal,
};
