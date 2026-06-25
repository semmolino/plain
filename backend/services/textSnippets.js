"use strict";

// ---------------------------------------------------------------------------
// Persönliche Buchungstexte (BOOKING_TEXT_SNIPPET) — pro Mitarbeiter.
// Wiederverwendbare Beschreibungstexte für Stunden-Buchungen.
// ---------------------------------------------------------------------------

async function listSnippets(supabase, { tenantId, employeeId }) {
  if (!employeeId) return [];
  const { data, error } = await supabase
    .from("BOOKING_TEXT_SNIPPET")
    .select("ID, LABEL, TEXT, SORT_ORDER")
    .eq("TENANT_ID", tenantId)
    .eq("EMPLOYEE_ID", employeeId)
    .order("SORT_ORDER", { ascending: true })
    .order("ID", { ascending: true });
  if (error) throw { status: 500, message: error.message };
  return data || [];
}

async function createSnippet(supabase, { tenantId, employeeId, body }) {
  const text = (body.text || "").trim();
  if (!text) throw { status: 400, message: "Text ist erforderlich." };
  const row = {
    TENANT_ID:   tenantId,
    EMPLOYEE_ID: employeeId,
    LABEL:       (body.label || "").trim() || null,
    TEXT:        text,
    SORT_ORDER:  Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
  };
  const { data, error } = await supabase.from("BOOKING_TEXT_SNIPPET").insert([row]).select("ID, LABEL, TEXT, SORT_ORDER").single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

async function updateSnippet(supabase, { tenantId, employeeId, id, body }) {
  const { data: existing } = await supabase
    .from("BOOKING_TEXT_SNIPPET").select("ID")
    .eq("ID", id).eq("TENANT_ID", tenantId).eq("EMPLOYEE_ID", employeeId).maybeSingle();
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
    .eq("ID", id).eq("TENANT_ID", tenantId).eq("EMPLOYEE_ID", employeeId)
    .select("ID, LABEL, TEXT, SORT_ORDER").single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

async function deleteSnippet(supabase, { tenantId, employeeId, id }) {
  const { error } = await supabase
    .from("BOOKING_TEXT_SNIPPET").delete()
    .eq("ID", id).eq("TENANT_ID", tenantId).eq("EMPLOYEE_ID", employeeId);
  if (error) throw { status: 500, message: error.message };
}

module.exports = { listSnippets, createSnippet, updateSnippet, deleteSnippet };
