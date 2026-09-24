"use strict";

/**
 * „Eigene Zeit buchen" (Recht projects.bookings.own, Migration 0169).
 *
 * Wer nur dieses Recht hat, braucht zum Buchen zwei Listen: welche Projekte
 * gerade laufen, und welche Leistungen darin buchbar sind. Beides gab es nur
 * ueber die Projekt-Endpunkte hinter `projects.view` — und die zeigen
 * Honorare, Budgets und Strukturwerte aller Projekte. Hier stehen nur Nummer,
 * Name und Kuerzel.
 *
 * „Laufend" = die Status aus Einstellungen → Monatsabschluss
 * (TENANT_SETTINGS monatsabschluss_statuses). Nicht gesetzt: alle Projekte.
 */

const { assertProjectInTenant } = require("./tenantGuard");

async function runningStatusIds(supabase, tenantId) {
  const { data } = await supabase
    .from("TENANT_SETTINGS")
    .select("VALUE")
    .eq("TENANT_ID", tenantId)
    .eq("KEY", "monatsabschluss_statuses")
    .maybeSingle();
  try {
    const arr = JSON.parse(data?.VALUE || "[]");
    return Array.isArray(arr) ? arr.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function listOwnProjects(supabase, { tenantId }) {
  const statusIds = await runningStatusIds(supabase, tenantId);
  let q = supabase
    .from("PROJECT")
    .select("ID, ABBR, NAME, PROJECT_STATUS_ID")
    .eq("TENANT_ID", tenantId)
    .order("ABBR", { ascending: true });
  if (statusIds.length) q = q.in("PROJECT_STATUS_ID", statusIds);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(p => ({ ID: p.ID, ABBR: p.ABBR, NAME: p.NAME }));
}

/** 403, wenn auf das Projekt mit „Eigene Zeit" nicht gebucht werden darf. */
async function assertBookable(supabase, { tenantId, projectId }) {
  const pid = await assertProjectInTenant(supabase, projectId, tenantId);
  const statusIds = await runningStatusIds(supabase, tenantId);
  if (!statusIds.length) return pid;
  const { data } = await supabase
    .from("PROJECT").select("PROJECT_STATUS_ID").eq("ID", pid).eq("TENANT_ID", tenantId).maybeSingle();
  if (!data || !statusIds.includes(Number(data.PROJECT_STATUS_ID))) {
    throw { status: 403, message: "Auf dieses Projekt kann gerade nicht gebucht werden (Projekt läuft nicht)." };
  }
  return pid;
}

/** Leistungen eines laufenden Projekts — ohne Betraege. */
async function listOwnLeaves(supabase, { tenantId, projectId }) {
  const pid = await assertBookable(supabase, { tenantId, projectId });
  const { data, error } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, FATHER_ID, ABBR, NAME, BILLING_TYPE_ID, SORT_ORDER")
    .eq("PROJECT_ID", pid)
    .eq("TENANT_ID", tenantId)
    .order("SORT_ORDER", { ascending: true })
    .order("ID", { ascending: true });
  if (error) throw error;
  return (data || []).map(s => ({
    STRUCTURE_ID: s.ID, FATHER_ID: s.FATHER_ID ?? null, ABBR: s.ABBR, NAME: s.NAME, BILLING_TYPE_ID: s.BILLING_TYPE_ID,
  }));
}

/** Das Element muss zum Projekt gehoeren und ein Blatt sein. */
async function assertLeafOfProject(supabase, { tenantId, projectId, structureId }) {
  const { data: node } = await supabase
    .from("PROJECT_STRUCTURE").select("ID, PROJECT_ID").eq("ID", Number(structureId)).eq("TENANT_ID", tenantId).maybeSingle();
  if (!node || Number(node.PROJECT_ID) !== Number(projectId)) {
    throw { status: 400, message: "Die Leistung gehört nicht zu diesem Projekt." };
  }
}

module.exports = { runningStatusIds, listOwnProjects, listOwnLeaves, assertBookable, assertLeafOfProject };
