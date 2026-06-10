"use strict";

/**
 * Recents Service — "Zuletzt verwendet" pro Mitarbeiter.
 *
 * Speichert Entity-Zugriffe in RECENT_VIEW. Frontend trackt einen Klick auf
 * eine Detailseite, wir upserten Last-Seen + erhoehen View-Count.
 *
 * KEINE Permission-Pruefung beim Speichern — der User hat den Datensatz
 * gerade gesehen, also war er auch berechtigt. Beim LISTEN reichen wir die
 * gespeicherten LABELs zurueck; falls Datensaetze inzwischen geloescht sind,
 * uebernimmt das jeweilige Modul beim Klick die 404-Behandlung.
 */

const ALLOWED_TYPES = new Set([
  "project",
  "invoice",
  "partial_payment",
  "offer",
  "mahnung",
  "address",
  "project_structure",          // Strukturelement -- META.project_id pflicht
  "report_filter",              // Reports-Filter   -- META = Filter-State
  "mitarbeiter_report_filter",  // Mitarbeiter-Reports-Filter
]);

// Eintraege, die laenger nicht mehr aufgerufen wurden, gelten nicht mehr
// als "zuletzt verwendet". 30 Tage ist ein pragmatischer Default; per
// ?stale_days=NN kann das Frontend pro Aufruf abweichen.
const DEFAULT_STALE_DAYS = 30;

function staleCutoffIso(staleDays) {
  const d = Math.max(parseInt(staleDays, 10) || DEFAULT_STALE_DAYS, 1);
  return new Date(Date.now() - d * 86400000).toISOString();
}

function assertType(entityType) {
  if (!ALLOWED_TYPES.has(entityType)) {
    throw { status: 400, message: `Unbekannter ENTITY_TYPE: ${entityType}` };
  }
}

/** Trackt einen Zugriff. Upsert: vorhanden -> LAST_SEEN=NOW(), VIEW_COUNT+=1,
 *  LABEL + META aktualisieren. */
async function trackRecent(supabase, { tenantId, employeeId, entityType, entityId, label, meta }) {
  assertType(entityType);
  if (!entityId) throw { status: 400, message: "entity_id fehlt" };

  const metaSafe = meta && typeof meta === "object" ? meta : null;

  // 1) Vorhandenen Eintrag suchen
  const { data: existing, error: er1 } = await supabase
    .from("RECENT_VIEW")
    .select("ID, VIEW_COUNT")
    .eq("TENANT_ID",   tenantId)
    .eq("EMPLOYEE_ID", employeeId)
    .eq("ENTITY_TYPE", entityType)
    .eq("ENTITY_ID",   entityId)
    .maybeSingle();
  if (er1) throw { status: 500, message: er1.message };

  if (existing) {
    const { error } = await supabase
      .from("RECENT_VIEW")
      .update({
        LAST_SEEN:  new Date().toISOString(),
        VIEW_COUNT: (existing.VIEW_COUNT || 0) + 1,
        LABEL:      label || null,
        META:       metaSafe,
      })
      .eq("ID", existing.ID);
    if (error) throw { status: 500, message: error.message };
    return { id: existing.ID, isNew: false };
  }

  const { data, error } = await supabase
    .from("RECENT_VIEW")
    .insert({
      TENANT_ID:   tenantId,
      EMPLOYEE_ID: employeeId,
      ENTITY_TYPE: entityType,
      ENTITY_ID:   entityId,
      LABEL:       label || null,
      META:        metaSafe,
      LAST_SEEN:   new Date().toISOString(),
      VIEW_COUNT:  1,
    })
    .select("ID")
    .single();
  if (error) throw { status: 500, message: error.message };
  return { id: data.ID, isNew: true };
}

/** Liefert die letzten n Eintraege pro Entity-Typ, optional mit Stale-Out
 *  und optionalem META-Filter (z.B. project_id fuer project_structure). */
async function listRecents(supabase, { tenantId, employeeId, entityType, limit, staleDays, projectId }) {
  assertType(entityType);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 50);

  let q = supabase
    .from("RECENT_VIEW")
    .select("ID, ENTITY_TYPE, ENTITY_ID, LABEL, META, LAST_SEEN, VIEW_COUNT")
    .eq("TENANT_ID",   tenantId)
    .eq("EMPLOYEE_ID", employeeId)
    .eq("ENTITY_TYPE", entityType)
    .gt("LAST_SEEN",   staleCutoffIso(staleDays))
    .order("LAST_SEEN", { ascending: false })
    .limit(lim);

  if (projectId != null) {
    q = q.eq("META->>project_id", String(parseInt(projectId, 10)));
  }

  const { data, error } = await q;
  if (error) {
    if (/relation .* does not exist|column .* does not exist/i.test(error.message)) return [];
    throw { status: 500, message: error.message };
  }
  return data || [];
}

/** Dashboard-Mix: ueber alle Typen sortiert nach LAST_SEEN, mit Stale-Out.
 *  Filter-Typen (report_filter etc.) werden hier ausgeblendet -- die machen
 *  als kontextfreie Karte keinen Sinn. */
async function listDashboardRecents(supabase, { tenantId, employeeId, limit, staleDays }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 50);

  const datasetTypes = [
    "project", "invoice", "partial_payment", "offer", "mahnung", "address",
  ];

  const { data, error } = await supabase
    .from("RECENT_VIEW")
    .select("ID, ENTITY_TYPE, ENTITY_ID, LABEL, META, LAST_SEEN, VIEW_COUNT")
    .eq("TENANT_ID",   tenantId)
    .eq("EMPLOYEE_ID", employeeId)
    .in("ENTITY_TYPE", datasetTypes)
    .gt("LAST_SEEN",   staleCutoffIso(staleDays))
    .order("LAST_SEEN", { ascending: false })
    .limit(lim);
  if (error) {
    if (/relation .* does not exist|column .* does not exist/i.test(error.message)) return [];
    throw { status: 500, message: error.message };
  }
  return data || [];
}

module.exports = { trackRecent, listRecents, listDashboardRecents, ALLOWED_TYPES, DEFAULT_STALE_DAYS };
