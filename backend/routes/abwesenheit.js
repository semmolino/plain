"use strict";
const express = require("express");
const { requirePermission } = require("../middleware/permissions");
const { createNotification } = require("../services/notifications");
const { getEmployeeCountryState } = require("../services/costRateCalc");

// ── Feiertage ─────────────────────────────────────────────────────────────────
// Laedt die Feiertage (Land/Bundesland) im Bereich [from,to] als Set von
// 'YYYY-MM-DD'. Feiertage werden nicht als Urlaubs-/Abwesenheitstage gezaehlt.
// Soft-Fail: fehlt die Tabelle oder ein Eintrag, verhaelt es sich wie zuvor
// (Tag zaehlt als Werktag).
async function loadHolidaySet(supabase, countryCode, stateCode, from, to) {
  try {
    let q = supabase.from("PUBLIC_HOLIDAY").select("HOLIDAY_DATE")
      .eq("COUNTRY_CODE", countryCode || "DE")
      .gte("HOLIDAY_DATE", from).lte("HOLIDAY_DATE", to);
    q = stateCode ? q.or(`STATE_CODE.is.null,STATE_CODE.eq.${stateCode}`) : q.is("STATE_CODE", null);
    const { data } = await q;
    return new Set((data || []).map(r => String(r.HOLIDAY_DATE).slice(0, 10)));
  } catch (_) { return new Set(); }
}

// Baut einen Resolver empId -> Feiertags-Set. Land/Bundesland kommt je
// Mitarbeiter aus dem Arbeitszeitmodell; Feiertage werden pro Land/Bundesland-
// Kombination nur einmal geladen (typischerweise genau eine Query).
async function buildHolidayResolver(supabase, tenantId, empIds, from, to) {
  const csByEmp  = new Map();
  const combos   = new Map(); // "COUNTRY|STATE" -> { countryCode, stateCode }
  for (const id of empIds) {
    const cs = await getEmployeeCountryState(supabase, tenantId, id);
    csByEmp.set(id, cs);
    combos.set(`${cs.countryCode}|${cs.stateCode ?? ""}`, cs);
  }
  const setByCombo = new Map();
  for (const [key, cs] of combos) {
    setByCombo.set(key, await loadHolidaySet(supabase, cs.countryCode, cs.stateCode, from, to));
  }
  return (empId) => {
    const cs = csByEmp.get(empId);
    return (cs && setByCombo.get(`${cs.countryCode}|${cs.stateCode ?? ""}`)) || null;
  };
}

// Werktage (Mo–Fr) im Zeitraum ohne Wochenenden und Feiertage; halber Tag nur
// bei Eintagesabwesenheit. `holidays` ist ein optionales Set von 'YYYY-MM-DD';
// fehlt es, werden nur Wochenenden ausgenommen.
function workdayCount(from, to, halfDay, holidays) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return 0;
  const pad = (n) => String(n).padStart(2, "0");
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isFree = (d) => {
    const wd = d.getDay();
    return wd === 0 || wd === 6 || (holidays && holidays.has(key(d)));
  };
  if (halfDay && from === to) return isFree(a) ? 0 : 0.5;
  let days = 0;
  for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    if (!isFree(d)) days++;
  }
  return days;
}

// ── Abwesenheits-Settings (TENANT_SETTINGS, key/value) ───────────────────────
// Verfall des Resturlaub-Uebertrags: pro Mandant abschaltbar, Default AUS
// (aendert bestehende Salden nicht ungefragt). Stichtag als 'MM-DD'.
const ABSENCE_SETTING_DEFAULTS = {
  absence_carryover_expires:     "false",
  absence_carryover_expiry_date: "03-31",
};

async function getAbsenceSettings(supabase, tenantId) {
  const { data } = await supabase.from("TENANT_SETTINGS")
    .select("KEY, VALUE").eq("TENANT_ID", tenantId).in("KEY", Object.keys(ABSENCE_SETTING_DEFAULTS));
  const map = Object.fromEntries((data || []).map(r => [r.KEY, r.VALUE]));
  const merged = { ...ABSENCE_SETTING_DEFAULTS, ...map };
  let expiryDate = String(merged.absence_carryover_expiry_date || "03-31");
  if (!/^\d{2}-\d{2}$/.test(expiryDate)) expiryDate = "03-31";
  return {
    carryoverExpires:     String(merged.absence_carryover_expires) === "true",
    carryoverExpiryDate:  expiryDate, // 'MM-DD'
  };
}

async function saveAbsenceSettings(supabase, tenantId, patch) {
  const now = new Date().toISOString();
  const upserts = [];
  if (patch.carryoverExpires !== undefined)
    upserts.push({ TENANT_ID: tenantId, KEY: "absence_carryover_expires", VALUE: patch.carryoverExpires ? "true" : "false", UPDATED_AT: now });
  if (patch.carryoverExpiryDate !== undefined) {
    const d = String(patch.carryoverExpiryDate || "");
    if (!/^\d{2}-\d{2}$/.test(d)) throw { status: 400, message: "Stichtag muss das Format MM-TT haben (z. B. 03-31)" };
    upserts.push({ TENANT_ID: tenantId, KEY: "absence_carryover_expiry_date", VALUE: d, UPDATED_AT: now });
  }
  if (!upserts.length) return;
  const { error } = await supabase.from("TENANT_SETTINGS").upsert(upserts, { onConflict: "TENANT_ID,KEY" });
  if (error) throw { status: 500, message: error.message };
}

// Reine Urlaubssaldo-Berechnung ueber die Jahre (Auto-Uebertrag; optionaler
// Verfall zum Stichtag). Getrennt fuer Unit-Tests, kein DB-Zugriff.
//   entByYear[y]         -> { DAYS_ENTITLED, CARRYOVER_OVERRIDE? }
//   takenByYear[y]       -> genommene Urlaubstage im Jahr y (gesamt)
//   takenBeforeByYear[y] -> davon bis einschl. Stichtag (nur bei Verfall genutzt)
//   takenAfterByYear[y]  -> davon nach dem Stichtag
// Verfall-Logik: Uebertrag wird zuerst verbraucht; nach dem Stichtag verfaellt
// nicht genutzter Uebertrag. Vor dem Stichtag (laufendes Jahr) wird nichts
// abgezogen, sondern als `atRisk` ausgewiesen.
function computeVacationBreakdown(opts) {
  const {
    entByYear = {}, takenByYear = {}, takenBeforeByYear = {}, takenAfterByYear = {},
    minYear, year, expires = false, expiryDate = "03-31", todayStr,
  } = opts;
  const round2 = (n) => Math.round(n * 100) / 100;
  const today = todayStr || new Date().toISOString().slice(0, 10);

  let carryover = 0;
  const breakdown = [];
  for (let y = minYear; y <= year; y++) {
    const ent = entByYear[y];
    const override = ent && ent.CARRYOVER_OVERRIDE != null ? Number(ent.CARRYOVER_OVERRIDE) : null;
    const startCarry = override != null ? override : carryover;
    const entitled = ent ? Number(ent.DAYS_ENTITLED) : 0;
    const taken = takenByYear[y] || 0;

    let forfeited = 0, atRisk = 0, remaining;
    if (!expires) {
      remaining = round2(startCarry + entitled - taken);
    } else {
      const cutoff = `${y}-${expiryDate}`;            // 'YYYY-MM-DD'
      const cutoffPassed = today > cutoff;            // Stichtag inklusiv nutzbar
      const takenBefore = takenBeforeByYear[y] || 0;
      const carryUsed   = Math.min(startCarry, takenBefore);
      const unusedCarry = Math.max(0, startCarry - carryUsed);
      if (cutoffPassed) {
        forfeited = round2(unusedCarry);
        remaining = round2(entitled - Math.max(0, takenBefore - startCarry) - (takenAfterByYear[y] || 0));
      } else {
        atRisk = round2(unusedCarry);
        remaining = round2(startCarry + entitled - taken);
      }
    }
    breakdown.push({ year: y, carryover: round2(startCarry), entitled, taken, forfeited, atRisk, remaining });
    carryover = remaining;
  }
  const current = breakdown[breakdown.length - 1] ||
    { year, carryover: 0, entitled: 0, taken: 0, forfeited: 0, atRisk: 0, remaining: 0 };
  return { breakdown, current };
}

// ── E-Mail-Benachrichtigungen (fire-and-forget, nie blockierend) ──────────────

function fmtRangeDe(a) {
  const f = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("de-DE");
  return a.DATE_FROM === a.DATE_TO
    ? f(a.DATE_FROM) + (a.HALF_DAY ? " (halber Tag)" : "")
    : `${f(a.DATE_FROM)} – ${f(a.DATE_TO)}`;
}

async function loadEmp(supabase, tenantId, empId) {
  try {
    const { data } = await supabase.from("EMPLOYEE")
      .select("SHORT_NAME, FIRST_NAME, LAST_NAME, MAIL")
      .eq("ID", empId).eq("TENANT_ID", tenantId).maybeSingle();
    return data || null;
  } catch (_) { return null; }
}

async function loadTypeName(supabase, tenantId, typeId) {
  try {
    const { data } = await supabase.from("ABSENCE_TYPE")
      .select("NAME").eq("ID", typeId).eq("TENANT_ID", tenantId).maybeSingle();
    return data?.NAME || "Abwesenheit";
  } catch (_) { return "Abwesenheit"; }
}

// empIds aller aktiven Mitarbeiter eines Tenants, deren Rolle permKey traegt.
async function employeeIdsWithPermission(supabase, tenantId, permKey) {
  try {
    const { data: perm } = await supabase.from("PERMISSION").select("ID").eq("KEY", permKey).maybeSingle();
    if (!perm) return [];
    const { data: rps } = await supabase.from("ROLE_PERMISSION").select("ROLE_ID").eq("PERMISSION_ID", perm.ID);
    const roleIds = [...new Set((rps || []).map(r => r.ROLE_ID).filter(Boolean))];
    if (!roleIds.length) return [];
    const { data: roles } = await supabase.from("USER_ROLE").select("ID").eq("TENANT_ID", tenantId).in("ID", roleIds);
    const tenantRoleIds = (roles || []).map(r => r.ID);
    if (!tenantRoleIds.length) return [];
    const { data: ers } = await supabase.from("EMPLOYEE_ROLE").select("EMPLOYEE_ID").in("ROLE_ID", tenantRoleIds);
    const empIds = [...new Set((ers || []).map(e => e.EMPLOYEE_ID).filter(Boolean))];
    if (!empIds.length) return [];
    const { data: emps } = await supabase.from("EMPLOYEE").select("ID").in("ID", empIds).eq("TENANT_ID", tenantId).neq("ACTIVE", 2);
    return (emps || []).map(e => e.ID);
  } catch (_) { return []; }
}

// In-App-Benachrichtigung an alle Genehmiger (absence.approve): neuer Antrag.
// Fire-and-forget, nie blockierend. Nutzt den zentralen Notification-Service.
async function notifyAbsenceRequest(supabase, tenantId, absence) {
  try {
    const approverIds = await employeeIdsWithPermission(supabase, tenantId, "absence.approve");
    if (!approverIds.length) return;
    const emp = await loadEmp(supabase, tenantId, absence.EMPLOYEE_ID);
    const typeName = await loadTypeName(supabase, tenantId, absence.ABSENCE_TYPE_ID);
    const who = emp ? `${emp.FIRST_NAME} ${emp.LAST_NAME} (${emp.SHORT_NAME})` : `Mitarbeiter #${absence.EMPLOYEE_ID}`;
    const title = "Neuer Abwesenheitsantrag";
    const body  = `${who}: ${typeName}, ${fmtRangeDe(absence)}`;
    for (const empId of approverIds) {
      if (empId === absence.EMPLOYEE_ID) continue; // sich selbst nicht benachrichtigen
      try {
        await createNotification(supabase, {
          tenantId, userId: String(empId), type: "absence_request",
          title, body, link: "/mitarbeiter",
          metadata: { absenceId: absence.ID, employeeId: absence.EMPLOYEE_ID },
        });
      } catch (_) { /* einzelne Fehler schlucken */ }
    }
  } catch (_) { /* niemals werfen */ }
}

// In-App-Benachrichtigung an den Antragsteller: Entscheidung oder Rueckfrage.
// outcome: 'APPROVED' | 'REJECTED' | 'CLARIFICATION'.
async function notifyAbsenceDecision(supabase, tenantId, absence, outcome) {
  try {
    const typeName = await loadTypeName(supabase, tenantId, absence.ABSENCE_TYPE_ID);
    const MAP = {
      APPROVED:      "Abwesenheitsantrag genehmigt",
      REJECTED:      "Abwesenheitsantrag abgelehnt",
      CLARIFICATION: "Rückfrage zu deinem Antrag",
    };
    const title = MAP[outcome] || MAP.APPROVED;
    let body = `${typeName}, ${fmtRangeDe(absence)}`;
    if (absence.DECISION_NOTE) body += ` — ${absence.DECISION_NOTE}`;
    await createNotification(supabase, {
      tenantId, userId: String(absence.EMPLOYEE_ID), type: "absence_decision",
      title, body, link: "/profil",
      metadata: { absenceId: absence.ID, outcome },
    });
  } catch (_) { /* niemals werfen */ }
}

// ── Routen: Urlaub / Abwesenheit (Phase 1) ────────────────────────────────────
// Tenant-Isolation: jede Query filtert auf req.tenantId.
// Rechte: absence.view (fremde sehen) · absence.request (eigene beantragen) ·
//         absence.approve (genehmigen/ablehnen) · absence.manage (Arten/Anspruch
//         pflegen, fuer andere erfassen).
module.exports = (supabase) => {
  const router = express.Router();

  // ── ABSENCE_TYPE (Katalog) ──────────────────────────────────────────────────
  router.get("/types", async (req, res) => {
    const { data, error } = await supabase
      .from("ABSENCE_TYPE")
      .select("*")
      .eq("TENANT_ID", req.tenantId)
      .order("SORT_ORDER", { ascending: true })
      .order("NAME", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  router.post("/types", requirePermission("absence.manage"), async (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "Name erforderlich" });
    const { data, error } = await supabase.from("ABSENCE_TYPE").insert([{
      TENANT_ID:         req.tenantId,
      NAME:              b.name,
      COLOR:             b.color || null,
      COUNTS_AS_WORKED:  b.counts_as_worked  !== false,
      REDUCES_VACATION:  !!b.reduces_vacation,
      REQUIRES_APPROVAL: b.requires_approval !== false,
      IS_PAID:           b.is_paid !== false,
      ACTIVE:            b.active != null ? Number(b.active) : 1,
      SORT_ORDER:        b.sort_order != null ? Number(b.sort_order) : 0,
    }]).select("*").single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  router.patch("/types/:id", requirePermission("absence.manage"), async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const upd = {};
    if (b.name             !== undefined) upd.NAME              = b.name;
    if (b.color            !== undefined) upd.COLOR             = b.color || null;
    if (b.counts_as_worked !== undefined) upd.COUNTS_AS_WORKED  = !!b.counts_as_worked;
    if (b.reduces_vacation !== undefined) upd.REDUCES_VACATION  = !!b.reduces_vacation;
    if (b.requires_approval!== undefined) upd.REQUIRES_APPROVAL = !!b.requires_approval;
    if (b.is_paid          !== undefined) upd.IS_PAID           = !!b.is_paid;
    if (b.active           !== undefined) upd.ACTIVE            = Number(b.active);
    if (b.sort_order       !== undefined) upd.SORT_ORDER        = Number(b.sort_order);
    if (!Object.keys(upd).length) return res.status(400).json({ error: "Keine Felder" });
    const { error } = await supabase.from("ABSENCE_TYPE").update(upd).eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  router.delete("/types/:id", requirePermission("absence.manage"), async (req, res) => {
    const id = Number(req.params.id);
    // Wird die Art noch verwendet -> nur deaktivieren statt loeschen.
    const { data: used } = await supabase.from("ABSENCE").select("ID").eq("ABSENCE_TYPE_ID", id).eq("TENANT_ID", req.tenantId).limit(1);
    if (used && used.length) {
      const { error } = await supabase.from("ABSENCE_TYPE").update({ ACTIVE: 0 }).eq("ID", id).eq("TENANT_ID", req.tenantId);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true, deactivated: true });
    }
    const { error } = await supabase.from("ABSENCE_TYPE").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ── ABSENCE ─────────────────────────────────────────────────────────────────
  // GET /?employee_id=&from=&to=&status=  (Zeitraum = Ueberlappung)
  router.get("/", async (req, res) => {
    const empId = req.query.employee_id ? Number(req.query.employee_id) : null;
    const wantsForeign = !empId || empId !== req.employeeId;
    if (wantsForeign && !req.hasPermission("absence.view"))
      return res.status(403).json({ error: "Fehlende Berechtigung: absence.view" });

    let q = supabase.from("ABSENCE").select("*").eq("TENANT_ID", req.tenantId);
    if (empId)             q = q.eq("EMPLOYEE_ID", empId);
    if (req.query.status)  q = q.eq("STATUS", req.query.status);
    if (req.query.from)    q = q.gte("DATE_TO", req.query.from);
    if (req.query.to)      q = q.lte("DATE_FROM", req.query.to);
    q = q.order("DATE_FROM", { ascending: false });
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const rows = data || [];
    const typeIds = [...new Set(rows.map(r => r.ABSENCE_TYPE_ID))];
    const empIds  = [...new Set(rows.map(r => r.EMPLOYEE_ID))];
    const [typesRes, empsRes] = await Promise.all([
      typeIds.length ? supabase.from("ABSENCE_TYPE").select("ID, NAME, COLOR, COUNTS_AS_WORKED, REDUCES_VACATION").in("ID", typeIds) : Promise.resolve({ data: [] }),
      empIds.length  ? supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME").in("ID", empIds).eq("TENANT_ID", req.tenantId) : Promise.resolve({ data: [] }),
    ]);
    const typeMap = Object.fromEntries((typesRes.data || []).map(t => [t.ID, t]));
    const empMap  = Object.fromEntries((empsRes.data  || []).map(e => [e.ID, e]));

    // Feiertage fuer die Tage-Zaehlung (min–max-Zeitraum, je Mitarbeiter-Bundesland).
    let holidaysFor = () => null;
    if (rows.length) {
      const minFrom = rows.reduce((m, r) => (r.DATE_FROM < m ? r.DATE_FROM : m), rows[0].DATE_FROM);
      const maxTo   = rows.reduce((m, r) => (r.DATE_TO   > m ? r.DATE_TO   : m), rows[0].DATE_TO);
      holidaysFor = await buildHolidayResolver(supabase, req.tenantId, empIds, minFrom, maxTo);
    }

    const enriched = rows.map(r => ({
      ...r,
      DAYS:                workdayCount(r.DATE_FROM, r.DATE_TO, r.HALF_DAY, holidaysFor(r.EMPLOYEE_ID)),
      TYPE_NAME:           typeMap[r.ABSENCE_TYPE_ID]?.NAME  ?? null,
      TYPE_COLOR:          typeMap[r.ABSENCE_TYPE_ID]?.COLOR ?? null,
      REDUCES_VACATION:    typeMap[r.ABSENCE_TYPE_ID]?.REDUCES_VACATION ?? false,
      EMPLOYEE_SHORT_NAME: empMap[r.EMPLOYEE_ID]?.SHORT_NAME ?? null,
      EMPLOYEE_FIRST_NAME: empMap[r.EMPLOYEE_ID]?.FIRST_NAME ?? null,
      EMPLOYEE_LAST_NAME:  empMap[r.EMPLOYEE_ID]?.LAST_NAME  ?? null,
    }));
    res.json({ data: enriched });
  });

  // POST / — Abwesenheit anlegen (eigener Antrag oder Erfassung fuer andere)
  router.post("/", async (req, res) => {
    const b = req.body || {};
    const empId = b.employee_id ? Number(b.employee_id) : req.employeeId;
    const forOther = empId !== req.employeeId;
    if (forOther) {
      if (!req.hasPermission("absence.manage"))  return res.status(403).json({ error: "Fehlende Berechtigung: absence.manage" });
    } else if (!req.hasPermission("absence.request")) {
      return res.status(403).json({ error: "Fehlende Berechtigung: absence.request" });
    }
    if (!b.absence_type_id || !b.date_from || !b.date_to)
      return res.status(400).json({ error: "Art, Von- und Bis-Datum erforderlich" });
    if (b.date_to < b.date_from) return res.status(400).json({ error: "Bis-Datum liegt vor Von-Datum" });
    const half = !!b.half_day && b.date_from === b.date_to;

    const { data: type } = await supabase.from("ABSENCE_TYPE")
      .select("REQUIRES_APPROVAL").eq("ID", Number(b.absence_type_id)).eq("TENANT_ID", req.tenantId).maybeSingle();
    const requiresApproval = type ? type.REQUIRES_APPROVAL !== false : true;
    // Erfassung fuer andere (durch Verwalter) -> direkt genehmigt;
    // eigener Antrag -> REQUESTED, ausser die Art braucht keine Freigabe.
    const status  = forOther ? "APPROVED" : (requiresApproval ? "REQUESTED" : "APPROVED");
    const decided = status === "APPROVED";

    const { data, error } = await supabase.from("ABSENCE").insert([{
      TENANT_ID:       req.tenantId,
      EMPLOYEE_ID:     empId,
      ABSENCE_TYPE_ID: Number(b.absence_type_id),
      DATE_FROM:       b.date_from,
      DATE_TO:         b.date_to,
      HALF_DAY:        half,
      STATUS:          status,
      NOTE:            b.note || null,
      REQUESTED_BY:    req.employeeId,
      DECIDED_BY:      decided ? req.employeeId : null,
      DECIDED_AT:      decided ? new Date().toISOString() : null,
    }]).select("*").single();
    if (error) return res.status(500).json({ error: error.message });
    // Nur bei echtem Antrag (REQUESTED) die Genehmiger benachrichtigen.
    if (data && data.STATUS === "REQUESTED") notifyAbsenceRequest(supabase, req.tenantId, data).catch(() => {});
    res.json({ data });
  });

  // PATCH /:id — Felder aendern (eigener offener Antrag oder Verwalter)
  router.patch("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { data: row } = await supabase.from("ABSENCE").select("*").eq("ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
    if (!row) return res.status(404).json({ error: "Nicht gefunden" });
    const isOwner   = row.EMPLOYEE_ID === req.employeeId;
    const canManage = req.hasPermission("absence.manage");
    if (!canManage && !(isOwner && row.STATUS === "REQUESTED"))
      return res.status(403).json({ error: "Nur offene eigene Antraege sind editierbar" });

    const b = req.body || {};
    const upd = {};
    if (b.absence_type_id !== undefined) upd.ABSENCE_TYPE_ID = Number(b.absence_type_id);
    if (b.date_from       !== undefined) upd.DATE_FROM       = b.date_from;
    if (b.date_to         !== undefined) upd.DATE_TO         = b.date_to;
    if (b.half_day        !== undefined) upd.HALF_DAY        = !!b.half_day;
    if (b.note            !== undefined) upd.NOTE            = b.note || null;
    if (!Object.keys(upd).length) return res.status(400).json({ error: "Keine Felder" });

    const df = upd.DATE_FROM ?? row.DATE_FROM;
    const dt = upd.DATE_TO   ?? row.DATE_TO;
    if (dt < df) return res.status(400).json({ error: "Bis-Datum liegt vor Von-Datum" });
    if ((upd.HALF_DAY ?? row.HALF_DAY) && df !== dt) upd.HALF_DAY = false;

    const { error } = await supabase.from("ABSENCE").update(upd).eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // POST /:id/decision — genehmigen / ablehnen
  router.post("/:id/decision", requirePermission("absence.approve"), async (req, res) => {
    const id = Number(req.params.id);
    const decision = String(req.body?.decision || "").toUpperCase();
    if (!["APPROVED", "REJECTED"].includes(decision))
      return res.status(400).json({ error: "decision muss APPROVED oder REJECTED sein" });
    const { data: row, error } = await supabase.from("ABSENCE").update({
      STATUS:        decision,
      DECIDED_BY:    req.employeeId,
      DECIDED_AT:    new Date().toISOString(),
      DECISION_NOTE: req.body?.note || null,
    }).eq("ID", id).eq("TENANT_ID", req.tenantId).select("*").maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (row) notifyAbsenceDecision(supabase, req.tenantId, row, decision).catch(() => {});
    res.json({ success: true });
  });

  // POST /:id/clarify — Rueckfrage stellen (Antrag bleibt offen/REQUESTED).
  // Genehmiger schickt eine Notiz; der Antragsteller wird benachrichtigt und
  // kann seinen Antrag anpassen. STATUS und DECIDED_* bleiben unveraendert.
  router.post("/:id/clarify", requirePermission("absence.approve"), async (req, res) => {
    const id = Number(req.params.id);
    const note = String(req.body?.note || "").trim();
    if (!note) return res.status(400).json({ error: "Bitte eine Rückfrage/Notiz angeben" });
    const { data: row, error } = await supabase.from("ABSENCE")
      .update({ DECISION_NOTE: note })
      .eq("ID", id).eq("TENANT_ID", req.tenantId).eq("STATUS", "REQUESTED")
      .select("*").maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!row) return res.status(404).json({ error: "Offener Antrag nicht gefunden" });
    notifyAbsenceDecision(supabase, req.tenantId, row, "CLARIFICATION").catch(() => {});
    res.json({ success: true });
  });

  // POST /:id/cancel — stornieren (Owner oder Verwalter)
  router.post("/:id/cancel", async (req, res) => {
    const id = Number(req.params.id);
    const { data: row } = await supabase.from("ABSENCE").select("EMPLOYEE_ID").eq("ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
    if (!row) return res.status(404).json({ error: "Nicht gefunden" });
    if (row.EMPLOYEE_ID !== req.employeeId && !req.hasPermission("absence.manage"))
      return res.status(403).json({ error: "Keine Berechtigung" });
    const { error } = await supabase.from("ABSENCE").update({ STATUS: "CANCELLED" }).eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // DELETE /:id — loeschen (eigener offener Antrag oder Verwalter)
  router.delete("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { data: row } = await supabase.from("ABSENCE").select("EMPLOYEE_ID, STATUS").eq("ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
    if (!row) return res.status(404).json({ error: "Nicht gefunden" });
    const isOwner = row.EMPLOYEE_ID === req.employeeId;
    if (!req.hasPermission("absence.manage") && !(isOwner && row.STATUS === "REQUESTED"))
      return res.status(403).json({ error: "Keine Berechtigung" });
    const { error } = await supabase.from("ABSENCE").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ── Urlaubsanspruch + Saldo ───────────────────────────────────────────────
  router.get("/entitlements", async (req, res) => {
    const empId = req.query.employee_id ? Number(req.query.employee_id) : req.employeeId;
    if (empId !== req.employeeId && !req.hasPermission("absence.view"))
      return res.status(403).json({ error: "Fehlende Berechtigung: absence.view" });
    let q = supabase.from("VACATION_ENTITLEMENT").select("*").eq("TENANT_ID", req.tenantId).eq("EMPLOYEE_ID", empId);
    if (req.query.year) q = q.eq("YEAR", Number(req.query.year));
    q = q.order("YEAR", { ascending: false });
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  router.put("/entitlements", requirePermission("absence.manage"), async (req, res) => {
    const b = req.body || {};
    const empId = Number(b.employee_id), year = Number(b.year);
    if (!empId || !year) return res.status(400).json({ error: "employee_id und year erforderlich" });
    const payload = {
      TENANT_ID:          req.tenantId,
      EMPLOYEE_ID:        empId,
      YEAR:               year,
      DAYS_ENTITLED:      b.days_entitled != null ? Number(b.days_entitled) : 0,
      CARRYOVER_OVERRIDE: b.carryover_override != null && b.carryover_override !== "" ? Number(b.carryover_override) : null,
      NOTE:               b.note || null,
    };
    const { data: existing } = await supabase.from("VACATION_ENTITLEMENT")
      .select("ID").eq("TENANT_ID", req.tenantId).eq("EMPLOYEE_ID", empId).eq("YEAR", year).maybeSingle();
    const result = existing
      ? await supabase.from("VACATION_ENTITLEMENT").update(payload).eq("ID", existing.ID).select("*").single()
      : await supabase.from("VACATION_ENTITLEMENT").insert([payload]).select("*").single();
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json({ data: result.data });
  });

  // GET /vacation-balance?employee_id=&year= — Anspruch + Auto-Uebertrag - genommen
  router.get("/vacation-balance", async (req, res) => {
    const empId = req.query.employee_id ? Number(req.query.employee_id) : req.employeeId;
    const year  = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    if (empId !== req.employeeId && !req.hasPermission("absence.view"))
      return res.status(403).json({ error: "Fehlende Berechtigung: absence.view" });

    const { data: vacTypes } = await supabase.from("ABSENCE_TYPE")
      .select("ID").eq("TENANT_ID", req.tenantId).eq("REDUCES_VACATION", true);
    const vacTypeIds = (vacTypes || []).map(t => t.ID);

    const { data: entitlements } = await supabase.from("VACATION_ENTITLEMENT")
      .select("*").eq("TENANT_ID", req.tenantId).eq("EMPLOYEE_ID", empId);
    const { data: absences } = vacTypeIds.length
      ? await supabase.from("ABSENCE").select("DATE_FROM, DATE_TO, HALF_DAY")
          .eq("TENANT_ID", req.tenantId).eq("EMPLOYEE_ID", empId).eq("STATUS", "APPROVED").in("ABSENCE_TYPE_ID", vacTypeIds)
      : { data: [] };

    // Feiertage im relevanten Zeitraum (fruehester Antrag bis Jahresende) einmalig laden.
    let holidays = null;
    if ((absences || []).length) {
      let spanFrom = `${year}-01-01`, spanTo = `${year}-12-31`;
      for (const a of absences) {
        if (a.DATE_FROM < spanFrom) spanFrom = a.DATE_FROM;
        if (a.DATE_TO   > spanTo)   spanTo   = a.DATE_TO;
      }
      const cs = await getEmployeeCountryState(supabase, req.tenantId, empId);
      holidays = await loadHolidaySet(supabase, cs.countryCode, cs.stateCode, spanFrom, spanTo);
    }

    const settings = await getAbsenceSettings(supabase, req.tenantId);
    const expires    = settings.carryoverExpires;
    const expiryDate = settings.carryoverExpiryDate; // 'MM-DD'

    // Genommene Urlaubstage je Jahr; bei aktivem Verfall zusaetzlich nach
    // Stichtag getrennt (der Uebertrag muss bis zum Stichtag genutzt sein).
    const takenByYear = {}, takenBeforeByYear = {}, takenAfterByYear = {};
    for (const a of absences || []) {
      const y = Number(String(a.DATE_FROM).slice(0, 4));
      const total = workdayCount(a.DATE_FROM, a.DATE_TO, a.HALF_DAY, holidays);
      takenByYear[y] = (takenByYear[y] || 0) + total;
      if (expires) {
        const cutoff = `${y}-${expiryDate}`;
        let before;
        if (a.DATE_TO <= cutoff)        before = total;                                        // ganz vor Stichtag
        else if (a.DATE_FROM > cutoff)  before = 0;                                            // ganz nach Stichtag
        else                            before = workdayCount(a.DATE_FROM, cutoff, false, holidays); // ueber Stichtag -> splitten
        takenBeforeByYear[y] = (takenBeforeByYear[y] || 0) + before;
        takenAfterByYear[y]  = (takenAfterByYear[y]  || 0) + Math.round((total - before) * 100) / 100;
      }
    }
    const entByYear = {};
    for (const e of entitlements || []) entByYear[e.YEAR] = e;

    const knownYears = [...new Set([...Object.keys(entByYear), ...Object.keys(takenByYear)].map(Number))];
    const minYear = knownYears.length ? Math.min(Math.min(...knownYears), year) : year;

    const { breakdown, current: cur } = computeVacationBreakdown({
      entByYear, takenByYear, takenBeforeByYear, takenAfterByYear,
      minYear, year, expires, expiryDate,
    });

    const [mm, dd] = expiryDate.split("-");
    res.json({ data: {
      year: cur.year, entitled: cur.entitled, carryover: cur.carryover,
      taken: cur.taken, forfeited: cur.forfeited, atRisk: cur.atRisk, remaining: cur.remaining,
      carryoverExpires: expires,
      carryoverExpiryDate: expiryDate,
      carryoverExpiryLabel: `${dd}.${mm}.`,
      breakdown,
    } });
  });

  // ── Settings (Verfallsfrist) ────────────────────────────────────────────────
  router.get("/settings", async (req, res) => {
    try { res.json({ data: await getAbsenceSettings(supabase, req.tenantId) }); }
    catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }); }
  });

  router.put("/settings", requirePermission("absence.manage"), async (req, res) => {
    try {
      await saveAbsenceSettings(supabase, req.tenantId, req.body || {});
      res.json({ data: await getAbsenceSettings(supabase, req.tenantId) });
    } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }); }
  });

  return router;
};

// Fuer Unit-Tests exportiert (reine Funktionen, kein DB-Zugriff).
module.exports.workdayCount = workdayCount;
module.exports.computeVacationBreakdown = computeVacationBreakdown;
