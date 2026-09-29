"use strict";
// ============================================================================
// Projekt- und Angebotsstatus je Buero (UI-Pilot Runde 13, Migration 0176).
//
// Bis 0176 gab es EINE Liste fuer alle Bueros. Jetzt pflegt jedes Buero seine
// eigene: angelegt mit DEFAULT_STATUSES, danach frei umbenennbar, sortierbar,
// erweiterbar — und loeschbar, solange nichts daran haengt.
//
// Zwei Angebotsstatus tragen Logik und deshalb einen CODE statt eines Namens,
// an dem die Oberflaeche sie erkennt:
//   ORDERED  — „Als beauftragt markieren" setzt ihn
//   REJECTED — „Als abgelehnt markieren" setzt ihn; abgelehnte Angebote
//              zaehlen nicht als offen
// Sie lassen sich umbenennen, aber nicht loeschen — sonst verloere das Buero
// still die beiden Knoepfe.
//
// Jeder Weg, der einen Status an ein Projekt oder Angebot haengt, prueft ueber
// assertOwnStatus, dass er diesem Buero gehoert. RLS verbirgt fremde Zeilen
// beim Lesen, der Fremdschluessel aber kennt keine Mandanten.
// ============================================================================

const KINDS = {
  project: {
    table: "PROJECT_STATUS", label: "Projektstatus",
    refTable: "PROJECT", refCol: "PROJECT_STATUS_ID", refLabel: ["Projekt", "Projekten"],
    defaultKey: "default_project_status_id", hasCode: false,
  },
  offer: {
    table: "OFFER_STATUS", label: "Angebotsstatus",
    refTable: "OFFER", refCol: "OFFER_STATUS_ID", refLabel: ["Angebot", "Angeboten"],
    defaultKey: "default_offer_status_id", hasCode: true,
  },
};

/** Standardsatz fuer neue Bueros — hier aendern, wenn ein anderer Satz ausgeliefert werden soll. */
const DEFAULT_STATUSES = {
  project: [
    { ABBR: "Akquise" },
    { ABBR: "Laufend" },
    { ABBR: "Pausiert" },
    { ABBR: "Abgeschlossen" },
  ],
  offer: [
    { ABBR: "In Bearbeitung" },
    { ABBR: "Versendet" },
    { ABBR: "Beauftragt", CODE: "ORDERED" },
    { ABBR: "Abgelehnt",  CODE: "REJECTED" },
    { ABBR: "Abgebrochen" },
  ],
};

const CODE_LABEL = {
  ORDERED:  "wird gesetzt, wenn ein Angebot als beauftragt markiert wird",
  REJECTED: "wird gesetzt, wenn ein Angebot als abgelehnt markiert wird",
};

const bad = (message, status = 400) => ({ status, message });

function kindOf(kind) {
  const k = KINDS[kind];
  if (!k) throw bad("Unbekannte Statusliste.", 404);
  return k;
}

function cleanName(v) {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!s) throw bad("Bitte einen Namen angeben.");
  if (s.length > 60) throw bad("Name: höchstens 60 Zeichen.");
  return s;
}

function cols(k) {
  return k.hasCode ? "ID, ABBR, SORT_ORDER, CODE" : "ID, ABBR, SORT_ORDER";
}

/** Status eines Bueros, sortiert. Fuer Auswahllisten (Projekt, Angebot, Vorbelegungen). */
async function listStatuses(supabase, tenantId, kind) {
  const k = kindOf(kind);
  const { data, error } = await supabase.from(k.table).select(cols(k))
    .eq("TENANT_ID", tenantId)
    .order("SORT_ORDER", { ascending: true })
    .order("ID", { ascending: true });
  if (error) throw bad(error.message, 500);
  return data || [];
}

/**
 * Wo ein Status haengt: Projekte/Angebote, Vorbelegung, „laufende Projekte"
 * (Monatsabschluss, Eigene Zeit, Monatsrunde) und Erinnerungen. Liefert je
 * Status { count, refs: ["12 Projekten", "Vorbelegung", …] }.
 */
async function usageOf(supabase, tenantId, kind, ids) {
  const k = kindOf(kind);
  const out = new Map(ids.map(id => [Number(id), { count: 0, refs: [] }]));
  if (!ids.length) return out;

  const { data: rows, error } = await supabase.from(k.refTable).select(k.refCol)
    .eq("TENANT_ID", tenantId).in(k.refCol, ids);
  if (error) throw bad(error.message, 500);
  for (const r of rows || []) {
    const u = out.get(Number(r[k.refCol]));
    if (u) u.count++;
  }
  for (const u of out.values()) {
    if (u.count) u.refs.push(`${u.count} ${u.count === 1 ? k.refLabel[0] : k.refLabel[1]}`);
  }

  const keys = [k.defaultKey, ...(kind === "project" ? ["monatsabschluss_statuses"] : [])];
  const { data: settings, error: sErr } = await supabase.from("TENANT_SETTINGS").select("KEY, VALUE")
    .eq("TENANT_ID", tenantId).in("KEY", keys);
  if (sErr) throw bad(sErr.message, 500);
  for (const s of settings || []) {
    if (s.KEY === k.defaultKey) {
      const u = out.get(Number(s.VALUE));
      if (u) u.refs.push("Vorbelegung");
    } else if (s.KEY === "monatsabschluss_statuses") {
      let list = [];
      try { list = JSON.parse(s.VALUE || "[]"); } catch { list = []; }
      for (const id of Array.isArray(list) ? list : []) {
        const u = out.get(Number(id));
        if (u && !u.refs.includes("„laufende Projekte“ im Monatsabschluss")) u.refs.push("„laufende Projekte“ im Monatsabschluss");
      }
    }
  }

  if (kind === "project") {
    const { data: cfg, error: cErr } = await supabase.from("NOTIFICATION_SCHEDULE_CONFIG").select("PROJECT_STATUS_IDS")
      .eq("TENANT_ID", tenantId);
    if (cErr) throw bad(cErr.message, 500);
    for (const c of cfg || []) {
      for (const id of c.PROJECT_STATUS_IDS || []) {
        const u = out.get(Number(id));
        if (u && !u.refs.includes("Erinnerungen")) u.refs.push("Erinnerungen");
      }
    }
  }
  return out;
}

/** Liste fuer Einstellungen → Stammdaten: mit Verwendung und Erklaerung der Systemstatus. */
async function listForSettings(supabase, tenantId, kind) {
  const rows = await listStatuses(supabase, tenantId, kind);
  const usage = await usageOf(supabase, tenantId, kind, rows.map(r => r.ID));
  return rows.map(r => ({
    ...r,
    USAGE: usage.get(Number(r.ID)) ?? { count: 0, refs: [] },
    ...(r.CODE ? { CODE_HINT: CODE_LABEL[r.CODE] } : {}),
  }));
}

async function findOwn(supabase, tenantId, k, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const { data, error } = await supabase.from(k.table).select(cols(k))
    .eq("ID", n).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw bad(error.message, 500);
  return data || null;
}

/**
 * Prueft, dass ein Status diesem Buero gehoert, und liefert seine ID.
 * `null`/leer bleibt `null` (Pflicht prueft der Aufrufer).
 */
async function assertOwnStatus(supabase, tenantId, kind, id) {
  if (id === undefined || id === null || String(id).trim() === "") return null;
  const k = kindOf(kind);
  const row = await findOwn(supabase, tenantId, k, id);
  if (!row) throw bad(`${k.label} nicht gefunden.`);
  return Number(row.ID);
}

/** ID des Angebotsstatus mit diesem Code (ORDERED/REJECTED) — oder null. */
async function statusIdByCode(supabase, tenantId, code) {
  const { data, error } = await supabase.from("OFFER_STATUS").select("ID")
    .eq("TENANT_ID", tenantId).eq("CODE", code).maybeSingle();
  if (error) throw bad(error.message, 500);
  return data?.ID ?? null;
}

async function assertNameFree(supabase, tenantId, k, name, exceptId) {
  const rows = await listStatuses(supabase, tenantId, k === KINDS.project ? "project" : "offer");
  const lower = name.toLocaleLowerCase("de");
  if (rows.some(r => r.ID !== exceptId && String(r.ABBR || "").trim().toLocaleLowerCase("de") === lower)) {
    throw bad(`${k.label} „${name}“ gibt es schon.`, 409);
  }
  return rows;
}

async function createStatus(supabase, tenantId, kind, body) {
  const k = kindOf(kind);
  const name = cleanName(body?.abbr);
  const rows = await assertNameFree(supabase, tenantId, k, name);
  const sort = rows.reduce((m, r) => Math.max(m, Number(r.SORT_ORDER) || 0), 0) + 10;
  // Einen Code vergibt nur der Standardsatz bzw. die Migration — nie die Anfrage.
  const { data, error } = await supabase.from(k.table)
    .insert([{ TENANT_ID: tenantId, ABBR: name, SORT_ORDER: sort }])
    .select(cols(k)).single();
  if (error) throw bad(error.message, 500);
  return data;
}

async function updateStatus(supabase, tenantId, kind, id, body) {
  const k = kindOf(kind);
  const row = await findOwn(supabase, tenantId, k, id);
  if (!row) throw bad(`${k.label} nicht gefunden.`, 404);
  const name = cleanName(body?.abbr);
  if (name !== row.ABBR) await assertNameFree(supabase, tenantId, k, name, row.ID);
  const { data, error } = await supabase.from(k.table).update({ ABBR: name })
    .eq("ID", row.ID).eq("TENANT_ID", tenantId).select(cols(k)).maybeSingle();
  if (error) throw bad(error.message, 500);
  if (!data) throw bad(`${k.label} nicht gefunden.`, 404);
  return data;
}

async function deleteStatus(supabase, tenantId, kind, id) {
  const k = kindOf(kind);
  const row = await findOwn(supabase, tenantId, k, id);
  if (!row) throw bad(`${k.label} nicht gefunden.`, 404);
  if (row.CODE) {
    throw bad(`„${row.ABBR}“ ${CODE_LABEL[row.CODE]} und lässt sich deshalb nicht löschen — umbenennen geht.`, 409);
  }
  const usage = (await usageOf(supabase, tenantId, kind, [row.ID])).get(Number(row.ID));
  if (usage.refs.length) {
    throw bad(`${k.label} „${row.ABBR}“ wird noch verwendet: ${usage.refs.join(", ")}.`, 409);
  }
  const all = await listStatuses(supabase, tenantId, kind);
  if (all.length <= 1) throw bad(`Der letzte ${k.label} lässt sich nicht löschen.`, 409);
  const { error } = await supabase.from(k.table).delete().eq("ID", row.ID).eq("TENANT_ID", tenantId);
  if (error) throw bad(error.message, 500);
  return { ok: true };
}

/** Neue Reihenfolge: `ids` muss genau die Status des Bueros enthalten. */
async function reorderStatuses(supabase, tenantId, kind, ids) {
  const k = kindOf(kind);
  const rows = await listStatuses(supabase, tenantId, kind);
  const want = (Array.isArray(ids) ? ids : []).map(Number);
  const have = rows.map(r => Number(r.ID));
  if (want.length !== have.length || new Set(want).size !== want.length || !want.every(id => have.includes(id))) {
    throw bad("Die Reihenfolge passt nicht zur Liste — bitte neu laden.", 409);
  }
  for (let i = 0; i < want.length; i++) {
    const { error } = await supabase.from(k.table).update({ SORT_ORDER: (i + 1) * 10 })
      .eq("ID", want[i]).eq("TENANT_ID", tenantId);
    if (error) throw bad(error.message, 500);
  }
  return listStatuses(supabase, tenantId, kind);
}

/** Standardsatz fuer ein neues Buero (Registrierung, Demo). Laeuft mit sys-Claim. */
async function seedDefaultStatuses(supabase, tenantId) {
  for (const kind of Object.keys(KINDS)) {
    const k = KINDS[kind];
    const { data: existing, error: eErr } = await supabase.from(k.table).select("ID").eq("TENANT_ID", tenantId).limit(1);
    if (eErr) throw bad(eErr.message, 500);
    if (existing && existing.length) continue;
    const rows = DEFAULT_STATUSES[kind].map((s, i) => ({
      TENANT_ID: tenantId, ABBR: s.ABBR, SORT_ORDER: (i + 1) * 10, ...(k.hasCode && s.CODE ? { CODE: s.CODE } : {}),
    }));
    const { error } = await supabase.from(k.table).insert(rows);
    if (error) throw bad(`${k.label}: Standardsatz nicht angelegt (${error.message})`, 500);
  }
}

/** Nur eigene Status-IDs aus einer Liste behalten (Monatsabschluss, Erinnerungen). */
async function ownProjectStatusIds(supabase, tenantId, ids) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!list.length) return [];
  const own = new Set((await listStatuses(supabase, tenantId, "project")).map(r => Number(r.ID)));
  const foreign = list.filter(id => !own.has(id));
  if (foreign.length) throw bad("Projektstatus nicht gefunden.");
  return [...new Set(list)];
}

module.exports = {
  KINDS, DEFAULT_STATUSES,
  listStatuses, listForSettings, usageOf,
  assertOwnStatus, statusIdByCode, ownProjectStatusIds,
  createStatus, updateStatus, deleteStatus, reorderStatuses,
  seedDefaultStatuses,
};
