"use strict";

// ---------------------------------------------------------------------------
// Buchungsarten-Katalog (BOOKING_TYPE)
// Pendant zur HOAI-ROLLE: tenant-weit (SCOPE='global') oder projektbezogen
// (SCOPE='project') vordefinierte Pauschalen / Stückleistungen mit Standardpreis.
// ---------------------------------------------------------------------------

const VALID_KINDS = new Set(["UNIT", "LUMP_COST", "LUMP_REVENUE"]);

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildRow(body) {
  const kind = String(body.kind || "").trim();
  if (!VALID_KINDS.has(kind)) {
    throw { status: 400, message: "Ungültige Buchungsart (kind)." };
  }
  const nameShort = (body.name_short || "").trim();
  if (!nameShort) throw { status: 400, message: "Kürzel ist erforderlich." };

  const scope = body.scope === "project" ? "project" : "global";
  const projectId = scope === "project" ? toNum(body.project_id) : null;
  if (scope === "project" && !projectId) {
    throw { status: 400, message: "Projekt ist für projektbezogene Buchungsarten erforderlich." };
  }

  return {
    KIND:            kind,
    NAME_SHORT:      nameShort,
    NAME_LONG:       (body.name_long || "").trim() || null,
    UNIT_LABEL:      kind === "UNIT" ? ((body.unit_label || "").trim() || null) : null,
    UNIT_CODE:       kind === "UNIT" ? ((body.unit_code || "").trim() || null) : null,
    DEFAULT_SP_RATE: toNum(body.default_sp_rate),
    DEFAULT_CP_RATE: toNum(body.default_cp_rate),
    SCOPE:           scope,
    PROJECT_ID:      projectId,
    ACTIVE:          body.active === 0 || body.active === false ? 0 : 1,
    SORT_ORDER:      toNum(body.sort_order) ?? 0,
  };
}

// Liste für die Verwaltung (Stammdaten). Optional auf ein Projekt eingegrenzt.
async function listBookingTypes(supabase, { tenantId, projectId = null, activeOnly = false }) {
  let query = supabase
    .from("BOOKING_TYPE")
    .select("*")
    .eq("TENANT_ID", tenantId)
    .order("SORT_ORDER", { ascending: true })
    .order("NAME_SHORT", { ascending: true });

  if (activeOnly) query = query.eq("ACTIVE", 1);
  if (projectId != null) query = query.eq("PROJECT_ID", projectId);

  const { data, error } = await query;
  if (error) throw { status: 500, message: error.message };
  return data || [];
}

// Auswahlliste beim Buchen: globale + (falls Projekt) dessen projektbezogene,
// nur aktive. Projektbezogene Einträge stehen vorn.
async function listSelectableForBooking(supabase, { tenantId, projectId = null }) {
  const { data, error } = await supabase
    .from("BOOKING_TYPE")
    .select("ID, KIND, NAME_SHORT, NAME_LONG, UNIT_LABEL, UNIT_CODE, DEFAULT_SP_RATE, DEFAULT_CP_RATE, SCOPE, PROJECT_ID")
    .eq("TENANT_ID", tenantId)
    .eq("ACTIVE", 1)
    .order("SORT_ORDER", { ascending: true })
    .order("NAME_SHORT", { ascending: true });
  if (error) throw { status: 500, message: error.message };

  const rows = (data || []).filter(
    (r) => r.SCOPE === "global" || (projectId != null && Number(r.PROJECT_ID) === Number(projectId))
  );
  // Projektbezogene zuerst.
  rows.sort((a, b) => (a.SCOPE === "project" ? 0 : 1) - (b.SCOPE === "project" ? 0 : 1));
  return rows;
}

async function createBookingType(supabase, { tenantId, body }) {
  const row = { ...buildRow(body), TENANT_ID: tenantId };
  const { data, error } = await supabase.from("BOOKING_TYPE").insert([row]).select("*").single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

async function patchBookingType(supabase, { tenantId, id, body }) {
  const { data: existing, error: exErr } = await supabase
    .from("BOOKING_TYPE").select("ID").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
  if (exErr) throw { status: 500, message: exErr.message };
  if (!existing) throw { status: 404, message: "Buchungsart nicht gefunden." };

  const row = buildRow(body);
  const { data, error } = await supabase
    .from("BOOKING_TYPE").update(row).eq("ID", id).eq("TENANT_ID", tenantId).select("*").single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

async function deleteBookingType(supabase, { tenantId, id }) {
  // Bereits gebuchte TEC-Zeilen verweisen per BOOKING_TYPE_ID, behalten aber
  // ihre Werte (Snapshot in QUANTITY/RATE). Löschen des Katalog-Eintrags ist
  // daher unkritisch — die Buchung bleibt unverändert bestehen.
  const { error } = await supabase.from("BOOKING_TYPE").delete().eq("ID", id).eq("TENANT_ID", tenantId);
  if (error) throw { status: 500, message: error.message };
}

module.exports = {
  VALID_KINDS,
  listBookingTypes,
  listSelectableForBooking,
  createBookingType,
  patchBookingType,
  deleteBookingType,
};
