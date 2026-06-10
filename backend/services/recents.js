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

/** Trackt einen Zugriff. Upsert: vorhanden -> LAST_SEEN=NOW(), VIEW_COUNT+=1, LABEL aktualisieren. */
async function trackRecent(supabase, { tenantId, employeeId, entityType, entityId, label }) {
  assertType(entityType);
  if (!entityId) throw { status: 400, message: "entity_id fehlt" };

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
      LAST_SEEN:   new Date().toISOString(),
      VIEW_COUNT:  1,
    })
    .select("ID")
    .single();
  if (error) throw { status: 500, message: error.message };
  return { id: data.ID, isNew: true };
}

/** Liefert die letzten n Eintraege pro Entity-Typ, optional mit Stale-Out. */
async function listRecents(supabase, { tenantId, employeeId, entityType, limit, staleDays }) {
  assertType(entityType);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 50);

  const { data, error } = await supabase
    .from("RECENT_VIEW")
    .select("ID, ENTITY_TYPE, ENTITY_ID, LABEL, LAST_SEEN, VIEW_COUNT")
    .eq("TENANT_ID",   tenantId)
    .eq("EMPLOYEE_ID", employeeId)
    .eq("ENTITY_TYPE", entityType)
    .gt("LAST_SEEN",   staleCutoffIso(staleDays))
    .order("LAST_SEEN", { ascending: false })
    .limit(lim);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    throw { status: 500, message: error.message };
  }
  return data || [];
}

/** Dashboard-Mix: ueber alle Typen sortiert nach LAST_SEEN, mit Stale-Out. */
async function listDashboardRecents(supabase, { tenantId, employeeId, limit, staleDays }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 50);

  const { data, error } = await supabase
    .from("RECENT_VIEW")
    .select("ID, ENTITY_TYPE, ENTITY_ID, LABEL, LAST_SEEN, VIEW_COUNT")
    .eq("TENANT_ID",   tenantId)
    .eq("EMPLOYEE_ID", employeeId)
    .gt("LAST_SEEN",   staleCutoffIso(staleDays))
    .order("LAST_SEEN", { ascending: false })
    .limit(lim);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    throw { status: 500, message: error.message };
  }
  return data || [];
}

module.exports = { trackRecent, listRecents, listDashboardRecents, ALLOWED_TYPES, DEFAULT_STALE_DAYS };
