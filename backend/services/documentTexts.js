"use strict";

/**
 * Textbausteine fuer Belege (DOCUMENT_TEXT_SNIPPET, Migration 0184).
 *
 * Benannte Alternativen zum Standard-Kopf-/Fusstext (TEXT_TEMPLATE) und
 * Vorlagen fuer eigene Textbloecke — gepflegt unter Einstellungen →
 * Dokumentvorlagen → Texte, gewaehlt im Rechnungsassistenten. Bueroweit;
 * Pflege mit settings.text_templates.edit, Lesen fuer alle Angemeldeten
 * (wer einen Beleg ausfuellt, muss waehlen koennen).
 */

const { CATEGORIES } = require("./documentLayout");

const POSITIONS = ["intro", "closing", "free"];
const COLS = "ID, CATEGORY, POSITION, LABEL, TEXT, SORT_ORDER";

function fail(status, message) { return { status, message }; }

function clean(body, { partial = false } = {}) {
  const b = body || {};
  const out = {};
  if (!partial || b.label !== undefined) {
    const label = String(b.label ?? "").trim();
    if (!label) throw fail(400, "Bitte einen Namen angeben.");
    out.LABEL = label.slice(0, 120);
  }
  if (!partial || b.text !== undefined) {
    const text = String(b.text ?? "");
    if (!text.trim()) throw fail(400, "Bitte einen Text angeben.");
    out.TEXT = text.slice(0, 4000);
  }
  if (!partial || b.category !== undefined) {
    const c = b.category == null || b.category === "" ? null : String(b.category);
    if (c !== null && !CATEGORIES[c]) throw fail(400, "Unbekannte Belegart.");
    out.CATEGORY = c;
  }
  if (!partial || b.position !== undefined) {
    const p = b.position == null ? "free" : String(b.position);
    if (!POSITIONS.includes(p)) throw fail(400, "Unbekannte Position.");
    out.POSITION = p;
  }
  if (b.sort_order !== undefined) {
    const n = Number(b.sort_order);
    out.SORT_ORDER = Number.isFinite(n) ? Math.max(-9999, Math.min(9999, Math.round(n))) : 0;
  }
  return out;
}

const view = (r) => ({
  id: r.ID, category: r.CATEGORY ?? null, position: r.POSITION, label: r.LABEL, text: r.TEXT, sortOrder: r.SORT_ORDER ?? 0,
});

/** Bausteine des Mandanten; mit `category` nur die dieser Belegart und die fuer alle. */
async function listTexts(supabase, { tenantId, category = null }) {
  const { data, error } = await supabase.from("DOCUMENT_TEXT_SNIPPET").select(COLS).eq("TENANT_ID", tenantId);
  if (error) throw new Error(error.message);
  return (data || [])
    .filter((r) => !category || r.CATEGORY == null || r.CATEGORY === category)
    .sort((a, b) => (a.SORT_ORDER ?? 0) - (b.SORT_ORDER ?? 0) || String(a.LABEL).localeCompare(String(b.LABEL), "de"))
    .map(view);
}

async function createText(supabase, { tenantId, body }) {
  const row = { ...clean(body), TENANT_ID: tenantId };
  const { data, error } = await supabase.from("DOCUMENT_TEXT_SNIPPET").insert(row).select(COLS).single();
  if (error) throw new Error(error.message);
  return view(data);
}

async function updateText(supabase, { tenantId, id, body }) {
  const patch = { ...clean(body, { partial: true }), updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("DOCUMENT_TEXT_SNIPPET")
    .update(patch).eq("ID", id).eq("TENANT_ID", tenantId).select(COLS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail(404, "Textbaustein nicht gefunden.");
  return view(data);
}

async function deleteText(supabase, { tenantId, id }) {
  const { data, error } = await supabase.from("DOCUMENT_TEXT_SNIPPET")
    .delete().eq("ID", id).eq("TENANT_ID", tenantId).select("ID");
  if (error) throw new Error(error.message);
  if (!data || !data.length) throw fail(404, "Textbaustein nicht gefunden.");
  return { ok: true };
}

module.exports = { listTexts, createText, updateText, deleteText, POSITIONS };
