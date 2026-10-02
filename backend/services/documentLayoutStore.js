"use strict";

/**
 * Aufbau je Projekt und je Beleg (Vorlagen-Plan Stufe 3, Migration 0185).
 *
 * Drei Ebenen, jede speichert nur ihre Abweichung (services/documentLayout.js):
 *   Firmenvorlage   DOCUMENT_TEMPLATE.THEME_JSON.bodyByCategory
 *   Projekt         PROJECT.DOCUMENT_LAYOUT_JSON  { "<kategorie>": … }
 *   Beleg           INVOICE / ADVANCE_INVOICE .DOCUMENT_LAYOUT_JSON
 *
 * Ein gebuchter Beleg aendert sich nicht mehr: seine eigene Ebene ist ab dem
 * Buchen gesperrt (409), und der Projekt-Aufbau steht eingefroren in
 * DOCUMENT_LAYOUT_SNAPSHOT_JSON — ein spaeter geaenderter Projekt-Aufbau
 * erreicht ihn nicht. Gleiches gilt fuer die Gestaltung
 * (DOCUMENT_THEME_SNAPSHOT_JSON, services_pdf_render.buildDocumentHtml).
 *
 * Alle Zeilen werden mit `select("*")` gelesen: der Web-Container startet vor
 * dem postdeploy-Hook, die neuen Spalten fehlen in diesem Fenster noch.
 */

const { CATEGORIES, sanitizeLayoutOverride, invoiceCategory } = require("./documentLayout");

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Leere Abweichung ist keine: null statt {}. */
function cleanOverride(raw, category) {
  if (!isObj(raw)) return null;
  const o = sanitizeLayoutOverride(raw, category);
  return Object.keys(o).length ? o : null;
}

/** Projekt-Aufbau: nur bekannte Kategorien, jede bereinigt. */
function sanitizeProjectLayout(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [cat, v] of Object.entries(raw)) {
    if (!CATEGORIES[cat]) continue;
    const o = cleanOverride(v, cat);
    if (o) out[cat] = o;
  }
  return out;
}

function categoryOfDoc(table, doc) {
  return invoiceCategory(doc.INVOICE_TYPE, table);
}

async function loadProjectLayout(supabase, tenantId, projectId) {
  if (!projectId) return {};
  const { data, error } = await supabase
    .from("PROJECT").select("*").eq("ID", projectId).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw error;
  return sanitizeProjectLayout(data && data.DOCUMENT_LAYOUT_JSON);
}

/**
 * Projekt- und Beleg-Ebene eines Belegs. Gebucht: der Projekt-Aufbau vom
 * Buchen (auch „keiner" ist ein Stand), sonst der heutige.
 */
async function loadDocumentLayouts({ supabase, tenantId, table, doc }) {
  const category = categoryOfDoc(table, doc);
  const documentLayout = cleanOverride(doc.DOCUMENT_LAYOUT_JSON, category);
  const snap = doc.DOCUMENT_LAYOUT_SNAPSHOT_JSON;
  const booked = String(doc.STATUS_ID) === "2";
  const projectLayout = booked && isObj(snap)
    ? sanitizeProjectLayout(snap.project)
    : await loadProjectLayout(supabase, tenantId, doc.PROJECT_ID);
  return { category, projectLayout, documentLayout };
}

async function loadDoc(supabase, tenantId, table, id) {
  const { data, error } = await supabase
    .from(table).select("*").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw { status: 404, message: "Beleg nicht gefunden." };
  return data;
}

/**
 * Speichert die Beleg-Ebene (`document`) und/oder die Projekt-Ebene der
 * Kategorie (`project`). Ein fehlender Schluessel laesst die Ebene, wie sie
 * ist; `null` entfernt sie.
 */
async function saveLayouts({ supabase, tenantId, table, id, body, canEditProject }) {
  const doc = await loadDoc(supabase, tenantId, table, id);
  if (String(doc.STATUS_ID) !== "1") {
    throw { status: 409, message: "Ein gebuchter Beleg behält seinen Aufbau." };
  }
  const category = categoryOfDoc(table, doc);
  const b = isObj(body) ? body : {};

  if (Object.prototype.hasOwnProperty.call(b, "project")) {
    if (!canEditProject) {
      throw { status: 403, message: "Den Aufbau für das ganze Projekt ändert nur, wer Projekte bearbeiten darf." };
    }
    if (!doc.PROJECT_ID) throw { status: 400, message: "Der Beleg gehört zu keinem Projekt." };
    const current = await loadProjectLayout(supabase, tenantId, doc.PROJECT_ID);
    const next = { ...current };
    const own = cleanOverride(b.project, category);
    if (own) next[category] = own;
    else delete next[category];
    const { error } = await supabase
      .from("PROJECT")
      .update({ DOCUMENT_LAYOUT_JSON: Object.keys(next).length ? next : null })
      .eq("ID", doc.PROJECT_ID)
      .eq("TENANT_ID", tenantId);
    if (error) throw error;
  }

  if (Object.prototype.hasOwnProperty.call(b, "templateId")) {
    // Vorlagen-Variante (D3): null = Standard, sonst eine aktive des Mandanten
    let templateId = null;
    if (b.templateId !== null && b.templateId !== "") {
      const { assertUsableVariant } = require("./documentTemplates");
      templateId = await assertUsableVariant(supabase, { tenantId, id: Number(b.templateId) });
    }
    const { error } = await supabase.from(table).update({ DOCUMENT_TEMPLATE_ID: templateId }).eq("ID", id).eq("TENANT_ID", tenantId);
    if (error) throw error;
  }

  if (Object.prototype.hasOwnProperty.call(b, "document")) {
    const { error } = await supabase
      .from(table)
      .update({ DOCUMENT_LAYOUT_JSON: cleanOverride(b.document, category) })
      .eq("ID", id)
      .eq("TENANT_ID", tenantId);
    if (error) throw error;
  }
  return { ok: true };
}

/**
 * Friert beim Buchen den Projekt-Aufbau ein, mit dem das PDF entstand — auch
 * „keiner" ist ein Stand: ein spaeter angelegter Projekt-Aufbau soll einen
 * gebuchten Beleg nicht nachtraeglich veraendern. Best-effort NACH dem
 * Status-Update (wie freezeCiiSnapshot): fehlt die Spalte noch, weil der
 * Web-Container vor dem postdeploy-Hook laeuft, bleibt die Buchung gueltig.
 */
async function freezeLayoutSnapshot(supabase, { table, id, tenantId, projectLayout }) {
  const { error } = await supabase
    .from(table)
    .update({ DOCUMENT_LAYOUT_SNAPSHOT_JSON: { project: sanitizeProjectLayout(projectLayout) } })
    .eq("ID", id)
    .eq("TENANT_ID", tenantId);
  if (error) console.warn("[LAYOUT_SNAPSHOT]", { table, id, error: error.message });
}

module.exports = {
  sanitizeProjectLayout, cleanOverride, categoryOfDoc, loadDoc, loadDocumentLayouts, loadProjectLayout, saveLayouts,
  freezeLayoutSnapshot,
};
