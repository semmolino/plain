"use strict";
const express = require("express");
const { requirePermission } = require("../middleware/permissions");
const { createNotification } = require("../services/notifications");
const { getEmployeeCountryState } = require("../services/costRateCalc");
const { exakterWert } = require("../services/pgrestFilter");
const { WEEKDAY_COLS, findActiveModel } = require("../services/employeeBalance");

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
    q = stateCode ? q.or(`STATE_CODE.is.null,STATE_CODE.eq.${exakterWert(stateCode)}`) : q.is("STATE_CODE", null);
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

// Abwesenheitstage je Kalenderjahr (Runde 10/11 des UI-Pilots).
//
// Ein Tag zaehlt, wenn das an diesem Tag gueltige Arbeitszeitmodell fuer den
// Wochentag Soll-Stunden hat und er kein Feiertag ist. Vorher zaehlte immer
// Mo–Fr: wer Mo–Mi arbeitet, verlor fuer eine Urlaubswoche 5 statt 3 Tage,
// wer samstags arbeitet, verlor fuer den Samstag nichts. Ohne Modell
// (Altbestand, Tage vor der ersten Zuordnung) bleibt es bei Mo–Fr.
//
// Das Ergebnis ist nach Jahr getrennt: ein Urlaub vom 28.12. bis 5.1. zaehlte
// vorher ganz im Startjahr — der Resturlaub des alten Jahres war zu klein, der
// des neuen zu gross. Halber Tag nur bei Eintagesabwesenheit.
//
// `holidays`: Set von 'YYYY-MM-DD' (optional); `assignments`: Zuordnungen
// aufsteigend nach VALID_FROM mit `model` (optional).
function workdaysByYear(from, to, halfDay, holidays, assignments) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return {};
  const pad = (n) => String(n).padStart(2, "0");
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isWorkday = (d, k) => {
    if (holidays && holidays.has(k)) return false;
    const model = assignments && assignments.length ? findActiveModel(assignments, k) : null;
    if (model) return Number(model[WEEKDAY_COLS[d.getDay()]] || 0) > 0;
    const wd = d.getDay();
    return wd !== 0 && wd !== 6;
  };
  if (halfDay && from === to) return isWorkday(a, from) ? { [a.getFullYear()]: 0.5 } : {};
  const out = {};
  for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    if (isWorkday(d, key(d))) out[d.getFullYear()] = (out[d.getFullYear()] || 0) + 1;
  }
  return out;
}

function workdayCount(from, to, halfDay, holidays, assignments) {
  return Object.values(workdaysByYear(from, to, halfDay, holidays, assignments)).reduce((s, n) => s + n, 0);
}

// Zuordnungen je Mitarbeiter (aufsteigend) — eine Abfrage fuer alle.
async function buildAssignmentResolver(supabase, tenantId, empIds) {
  const byEmp = new Map();
  if (!empIds.length) return () => null;
  const { data: assigns, error } = await supabase.from("EMPLOYEE_WORK_MODEL")
    .select("EMPLOYEE_ID, MODEL_ID, VALID_FROM").eq("TENANT_ID", tenantId).in("EMPLOYEE_ID", empIds)
    .order("VALID_FROM", { ascending: true });
  if (error) throw error;
  const modelIds = [...new Set((assigns || []).map(x => x.MODEL_ID))];
  const { data: models, error: mErr } = modelIds.length
    ? await supabase.from("WORKING_TIME_MODEL").select("ID, MON, TUE, WED, THU, FRI, SAT, SUN").eq("TENANT_ID", tenantId).in("ID", modelIds)
    : { data: [] };
  if (mErr) throw mErr;
  const modelMap = new Map((models || []).map(m => [m.ID, m]));
  for (const x of (assigns || []).slice().sort((p, q) => String(p.VALID_FROM).localeCompare(String(q.VALID_FROM)))) {
    if (!byEmp.has(x.EMPLOYEE_ID)) byEmp.set(x.EMPLOYEE_ID, []);
    byEmp.get(x.EMPLOYEE_ID).push({ VALID_FROM: String(x.VALID_FROM).slice(0, 10), model: modelMap.get(x.MODEL_ID) ?? null });
  }
  return (empId) => byEmp.get(empId) || null;
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

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Genommene Urlaubstage je Jahr; bei aktivem Verfall zusaetzlich nach dem
// Stichtag des jeweiligen Jahres getrennt (der Uebertrag muss bis dahin
// genutzt sein). Ein Antrag ueber den Jahreswechsel zaehlt je Jahr anteilig.
function takenVacationByYear(absences, { holidays = null, assignments = null, expires = false, expiryDate = "03-31" } = {}) {
  const takenByYear = {}, takenBeforeByYear = {}, takenAfterByYear = {};
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const a of absences) {
    const byYear = workdaysByYear(a.DATE_FROM, a.DATE_TO, a.HALF_DAY, holidays, assignments);
    for (const [ys, total] of Object.entries(byYear)) {
      const y = Number(ys);
      takenByYear[y] = r2((takenByYear[y] || 0) + total);
      if (!expires) continue;
      const cutoff = `${y}-${expiryDate}`;
      const from = a.DATE_FROM > `${y}-01-01` ? a.DATE_FROM : `${y}-01-01`;
      const to   = a.DATE_TO   < `${y}-12-31` ? a.DATE_TO   : `${y}-12-31`;
      let before;
      if (to <= cutoff)        before = total;                                                  // ganz vor Stichtag
      else if (from > cutoff)  before = 0;                                                      // ganz nach Stichtag
      else                     before = workdayCount(from, cutoff, false, holidays, assignments); // ueber Stichtag -> splitten
      takenBeforeByYear[y] = r2((takenBeforeByYear[y] || 0) + before);
      takenAfterByYear[y]  = r2((takenAfterByYear[y]  || 0) + total - before);
    }
  }
  return { takenByYear, takenBeforeByYear, takenAfterByYear };
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

// Urlaubssaldo eines Mitarbeiters fuer ein Jahr (Route /vacation-balance und
// Vorschau). `pending`: offen beantragte Urlaubstage in diesem Jahr — sie
// mindern den Saldo erst mit der Genehmigung, gehoeren aber in jede Planung.
// `excludeId`: der gerade bearbeitete Antrag zaehlt nicht doppelt.
async function vacationBalanceFor(supabase, tenantId, empId, year, { excludeId = null } = {}) {
  const fail = (e) => { throw { status: 500, message: e.message }; };
  const { data: vacTypes, error: tErr } = await supabase.from("ABSENCE_TYPE")
    .select("ID").eq("TENANT_ID", tenantId).eq("REDUCES_VACATION", true);
  if (tErr) fail(tErr);
  const vacTypeIds = (vacTypes || []).map(t => t.ID);

  const { data: entitlements, error: eErr } = await supabase.from("VACATION_ENTITLEMENT")
    .select("*").eq("TENANT_ID", tenantId).eq("EMPLOYEE_ID", empId);
  if (eErr) fail(eErr);
  const { data: rows, error: aErr } = vacTypeIds.length
    ? await supabase.from("ABSENCE").select("ID, DATE_FROM, DATE_TO, HALF_DAY, STATUS")
        .eq("TENANT_ID", tenantId).eq("EMPLOYEE_ID", empId).in("STATUS", ["APPROVED", "REQUESTED"]).in("ABSENCE_TYPE_ID", vacTypeIds)
    : { data: [] };
  if (aErr) fail(aErr);
  const all = (rows || []).filter(a => a.ID == null || a.ID !== excludeId);
  const absences = all.filter(a => a.STATUS === "APPROVED");
  const requested = all.filter(a => a.STATUS === "REQUESTED");

  // Feiertage im relevanten Zeitraum (fruehester Antrag bis Jahresende) einmalig laden.
  let holidays = null;
  if (all.length) {
    let spanFrom = `${year}-01-01`, spanTo = `${year}-12-31`;
    for (const a of all) {
      if (a.DATE_FROM < spanFrom) spanFrom = a.DATE_FROM;
      if (a.DATE_TO   > spanTo)   spanTo   = a.DATE_TO;
    }
    const cs = await getEmployeeCountryState(supabase, tenantId, empId);
    holidays = await loadHolidaySet(supabase, cs.countryCode, cs.stateCode, spanFrom, spanTo);
  }

  const settings = await getAbsenceSettings(supabase, tenantId);
  const expires    = settings.carryoverExpires;
  const expiryDate = settings.carryoverExpiryDate; // 'MM-DD'

  let assignments = null;
  try { assignments = (await buildAssignmentResolver(supabase, tenantId, [empId]))(empId); }
  catch (e) { fail(e); }

  const { takenByYear, takenBeforeByYear, takenAfterByYear } =
    takenVacationByYear(absences, { holidays, assignments, expires, expiryDate });
  const entByYear = {};
  for (const e of entitlements || []) entByYear[e.YEAR] = e;

  const knownYears = [...new Set([...Object.keys(entByYear), ...Object.keys(takenByYear)].map(Number))];
  const minYear = knownYears.length ? Math.min(Math.min(...knownYears), year) : year;

  const { breakdown, current: cur } = computeVacationBreakdown({
    entByYear, takenByYear, takenBeforeByYear, takenAfterByYear,
    minYear, year, expires, expiryDate, todayStr: localToday(),
  });
  const pending = takenVacationByYear(requested, { holidays, assignments }).takenByYear[year] || 0;

  const [mm, dd] = expiryDate.split("-");
  return {
    year: cur.year, entitled: cur.entitled, carryover: cur.carryover,
    taken: cur.taken, forfeited: cur.forfeited, atRisk: cur.atRisk, remaining: cur.remaining,
    pending,
    carryoverExpires: expires,
    carryoverExpiryDate: expiryDate,
    carryoverExpiryLabel: `${dd}.${mm}.`,
    breakdown,
  };
}

// Eigene offene oder genehmigte Abwesenheiten, die [from,to] berühren
// (Runde 12). Mit Art-Namen für Meldungen und Vorschau.
async function findOverlaps(supabase, tenantId, empId, from, to, excludeId = null) {
  const { data, error } = await supabase.from("ABSENCE")
    .select("ID, ABSENCE_TYPE_ID, DATE_FROM, DATE_TO, HALF_DAY, STATUS")
    .eq("TENANT_ID", tenantId).eq("EMPLOYEE_ID", empId).in("STATUS", ["REQUESTED", "APPROVED"])
    .lte("DATE_FROM", to).gte("DATE_TO", from);
  if (error) throw { status: 500, message: error.message };
  const rows = (data || []).filter(o => o.ID !== excludeId && o.DATE_FROM <= to && o.DATE_TO >= from);
  const typeIds = [...new Set(rows.map(o => o.ABSENCE_TYPE_ID))];
  const { data: types } = typeIds.length
    ? await supabase.from("ABSENCE_TYPE").select("ID, NAME").eq("TENANT_ID", tenantId).in("ID", typeIds)
    : { data: [] };
  const name = Object.fromEntries((types || []).map(t => [t.ID, t.NAME]));
  return rows.map(o => ({ ID: o.ID, DATE_FROM: o.DATE_FROM, DATE_TO: o.DATE_TO, HALF_DAY: o.HALF_DAY, STATUS: o.STATUS, TYPE_NAME: name[o.ABSENCE_TYPE_ID] ?? null }));
}

// Überschneidung ist für den eigenen Antrag eine Sperre: die Tage gingen
// sonst doppelt vom Resturlaub ab, und im Kalender stünde nur einer der
// beiden Einträge. Wer Abwesenheiten verwaltet, darf trotzdem — etwa für
// eine Krankmeldung mitten im Urlaub.
function overlapConflict(overlaps) {
  const list = overlaps.map(o => `${o.TYPE_NAME ?? "Abwesenheit"} ${fmtRangeDe(o)} (${o.STATUS === "APPROVED" ? "genehmigt" : "beantragt"})`).join(", ");
  return { status: 409, message: `Überschneidet sich mit ${list}. Bitte den bestehenden Eintrag ändern oder zurückziehen.`, overlaps };
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
      .select("ABBR, FIRST_NAME, LAST_NAME, MAIL")
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
    const who = emp ? `${emp.FIRST_NAME} ${emp.LAST_NAME} (${emp.ABBR})` : `Mitarbeiter #${absence.EMPLOYEE_ID}`;
    const title = "Neuer Abwesenheitsantrag";
    const body  = `${who}: ${typeName}, ${fmtRangeDe(absence)}`;
    for (const empId of approverIds) {
      if (empId === absence.EMPLOYEE_ID) continue; // sich selbst nicht benachrichtigen
      try {
        await createNotification(supabase, {
          tenantId, userId: String(empId), type: "absence_request",
          title, body, link: "/mitarbeiter?tab=abwesenheiten",
          metadata: { absenceId: absence.ID, employeeId: absence.EMPLOYEE_ID },
        });
      } catch (_) { /* einzelne Fehler schlucken */ }
    }
  } catch (_) { /* niemals werfen */ }
}

// Haengt einen Eintrag an den Rueckfrage-Verlauf (CLARIFICATION_LOG) an.
// Best-effort: faellt weich aus, wenn die Spalte (Migration 0101) fehlt.
async function appendClarification(supabase, tenantId, id, entry) {
  try {
    const { data, error } = await supabase.from("ABSENCE")
      .select("CLARIFICATION_LOG").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
    if (error) return false;
    const log = Array.isArray(data?.CLARIFICATION_LOG) ? data.CLARIFICATION_LOG : [];
    log.push(entry);
    const { error: upErr } = await supabase.from("ABSENCE")
      .update({ CLARIFICATION_LOG: log }).eq("ID", id).eq("TENANT_ID", tenantId);
    return !upErr;
  } catch (_) { return false; }
}

// In-App-Benachrichtigung an alle Genehmiger: Antragsteller hat auf eine
// Rueckfrage geantwortet. Nutzt denselben Typ wie ein neuer Antrag.
async function notifyAbsenceReply(supabase, tenantId, absence) {
  try {
    const approverIds = await employeeIdsWithPermission(supabase, tenantId, "absence.approve");
    if (!approverIds.length) return;
    const emp = await loadEmp(supabase, tenantId, absence.EMPLOYEE_ID);
    const who = emp ? `${emp.FIRST_NAME} ${emp.LAST_NAME} (${emp.ABBR})` : `Mitarbeiter #${absence.EMPLOYEE_ID}`;
    for (const empId of approverIds) {
      if (empId === absence.EMPLOYEE_ID) continue;
      try {
        await createNotification(supabase, {
          tenantId, userId: String(empId), type: "absence_request",
          title: "Antwort auf Rückfrage", body: `${who} hat auf eine Rückfrage geantwortet.`,
          link: `/mitarbeiter?tab=abwesenheiten&sub=inbox&absence=${absence.ID}`,
          metadata: { absenceId: absence.ID, employeeId: absence.EMPLOYEE_ID },
        });
      } catch (_) { /* einzelne Fehler schlucken */ }
    }
  } catch (_) { /* niemals werfen */ }
}

// In-App-Benachrichtigung an den Antragsteller: Entscheidung oder Rueckfrage.
// outcome: 'APPROVED' | 'REJECTED' | 'CLARIFICATION'.
//
// Der Link zeigt auf "Meine Anträge" im Abwesenheits-Modul — dort steht der
// Antrag mit Verlauf und, bei einer Rückfrage, dem Antwortfeld. Bis 08/2026
// ging er auf /profil; die Seite kennt Abwesenheiten gar nicht, eine Rückfrage
// lief damit ins Leere.
function absenceDeepLink(absence) {
  return `/mitarbeiter?tab=abwesenheiten&sub=my&absence=${absence.ID}`;
}

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
    // Steht am Ende, damit es auch in der gekuerzten Push-Vorschau ankommt,
    // dass die Benachrichtigung eine Handlung erwartet.
    if (outcome === "CLARIFICATION") body += " — zum Antworten öffnen.";
    await createNotification(supabase, {
      tenantId, userId: String(absence.EMPLOYEE_ID), type: "absence_decision",
      title, body, link: absenceDeepLink(absence),
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
      empIds.length  ? supabase.from("EMPLOYEE").select("ID, ABBR, FIRST_NAME, LAST_NAME").in("ID", empIds).eq("TENANT_ID", req.tenantId) : Promise.resolve({ data: [] }),
    ]);
    const typeMap = Object.fromEntries((typesRes.data || []).map(t => [t.ID, t]));
    const empMap  = Object.fromEntries((empsRes.data  || []).map(e => [e.ID, e]));

    // Feiertage fuer die Tage-Zaehlung (min–max-Zeitraum, je Mitarbeiter-Bundesland).
    let holidaysFor = () => null;
    let assignmentsFor = () => null;
    if (rows.length) {
      const minFrom = rows.reduce((m, r) => (r.DATE_FROM < m ? r.DATE_FROM : m), rows[0].DATE_FROM);
      const maxTo   = rows.reduce((m, r) => (r.DATE_TO   > m ? r.DATE_TO   : m), rows[0].DATE_TO);
      holidaysFor = await buildHolidayResolver(supabase, req.tenantId, empIds, minFrom, maxTo);
      try { assignmentsFor = await buildAssignmentResolver(supabase, req.tenantId, empIds); }
      catch (e) { return res.status(500).json({ error: e.message }); }
    }

    const enriched = rows.map(r => ({
      ...r,
      DAYS:                workdayCount(r.DATE_FROM, r.DATE_TO, r.HALF_DAY, holidaysFor(r.EMPLOYEE_ID), assignmentsFor(r.EMPLOYEE_ID)),
      TYPE_NAME:           typeMap[r.ABSENCE_TYPE_ID]?.NAME  ?? null,
      TYPE_COLOR:          typeMap[r.ABSENCE_TYPE_ID]?.COLOR ?? null,
      REDUCES_VACATION:    typeMap[r.ABSENCE_TYPE_ID]?.REDUCES_VACATION ?? false,
      EMPLOYEE_SHORT_NAME: empMap[r.EMPLOYEE_ID]?.ABBR ?? null,
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

    if (!req.hasPermission("absence.manage")) {
      try {
        const ov = await findOverlaps(supabase, req.tenantId, empId, b.date_from, b.date_to);
        if (ov.length) { const c = overlapConflict(ov); return res.status(409).json({ error: c.message, overlaps: c.overlaps }); }
      } catch (e) { return res.status(e?.status || 500).json({ error: e?.message || String(e) }); }
    }

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

    if (!canManage && (upd.DATE_FROM !== undefined || upd.DATE_TO !== undefined)) {
      try {
        const ov = await findOverlaps(supabase, req.tenantId, row.EMPLOYEE_ID, df, dt, id);
        if (ov.length) { const c = overlapConflict(ov); return res.status(409).json({ error: c.message, overlaps: c.overlaps }); }
      } catch (e) { return res.status(e?.status || 500).json({ error: e?.message || String(e) }); }
    }

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
    // Vorher liess sich jeder Antrag entscheiden — auch ein zurueckgezogener
    // oder schon abgelehnter —, der eigene ohne Weiteres, und ein fehlender
    // meldete Erfolg (Runde 10).
    const { data: cur, error: curErr } = await supabase.from("ABSENCE")
      .select("ID, EMPLOYEE_ID, STATUS").eq("ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
    if (curErr) return res.status(500).json({ error: curErr.message });
    if (!cur) return res.status(404).json({ error: "Antrag nicht gefunden" });
    if (cur.STATUS !== "REQUESTED") return res.status(409).json({ error: "Dieser Antrag ist nicht mehr offen." });
    // Den eigenen Antrag entscheidet jemand anderes — ausser, wer Abwesenheiten
    // verwaltet (im kleinen Büro gibt es sonst niemanden).
    const own = Number(cur.EMPLOYEE_ID) === Number(req.employeeId);
    if (own && !(typeof req.hasPermission === "function" && req.hasPermission("absence.manage"))) {
      return res.status(403).json({ error: "Den eigenen Antrag entscheidet jemand anderes." });
    }
    const { data: row, error } = await supabase.from("ABSENCE").update({
      STATUS:        decision,
      DECIDED_BY:    req.employeeId,
      DECIDED_AT:    new Date().toISOString(),
      DECISION_NOTE: req.body?.note || null,
    }).eq("ID", id).eq("TENANT_ID", req.tenantId).eq("STATUS", "REQUESTED").select("*").maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!row) return res.status(409).json({ error: "Dieser Antrag ist nicht mehr offen." });
    notifyAbsenceDecision(supabase, req.tenantId, row, decision).catch(() => {});
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
    await appendClarification(supabase, req.tenantId, id, {
      role: "approver", by: req.employeeId, at: new Date().toISOString(), text: note,
    });
    notifyAbsenceDecision(supabase, req.tenantId, row, "CLARIFICATION").catch(() => {});
    res.json({ success: true });
  });

  // POST /:id/reply — Antwort des Antragstellers auf eine Rueckfrage.
  // Antrag bleibt offen; die Genehmiger werden benachrichtigt.
  router.post("/:id/reply", async (req, res) => {
    const id = Number(req.params.id);
    const note = String(req.body?.note || "").trim();
    if (!note) return res.status(400).json({ error: "Bitte eine Antwort eingeben" });
    const { data: row } = await supabase.from("ABSENCE").select("*").eq("ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
    if (!row) return res.status(404).json({ error: "Nicht gefunden" });
    const isOwner = row.EMPLOYEE_ID === req.employeeId;
    if (!isOwner && !req.hasPermission("absence.manage")) return res.status(403).json({ error: "Keine Berechtigung" });
    if (row.STATUS !== "REQUESTED") return res.status(400).json({ error: "Antworten sind nur bei offenen Anträgen möglich" });
    const ok = await appendClarification(supabase, req.tenantId, id, {
      role: "requester", by: req.employeeId, at: new Date().toISOString(), text: note,
    });
    if (!ok) return res.status(400).json({ error: "Antworten benötigt Migration 0101 (CLARIFICATION_LOG)" });
    notifyAbsenceReply(supabase, req.tenantId, row).catch(() => {});
    res.json({ success: true });
  });

  // POST /:id/cancel — stornieren (Owner oder Verwalter)
  // Runde 11: Selbst storniert man nur, was noch nicht begonnen hat. Vorher
  // liess sich ein genommener Urlaub hinterher stornieren — die Tage kamen
  // auf den Resturlaub zurueck, und das Zeitkonto rechnete die Soll-Zeit
  // wieder als Minusstunden. Verwalter (absence.manage) duerfen weiterhin
  // alles, etwa wenn jemand aus dem Urlaub zurueckgeholt wird.
  router.post("/:id/cancel", async (req, res) => {
    const id = Number(req.params.id);
    const { data: row, error: rowErr } = await supabase.from("ABSENCE").select("EMPLOYEE_ID, STATUS, DATE_FROM").eq("ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
    if (rowErr) return res.status(500).json({ error: rowErr.message });
    if (!row) return res.status(404).json({ error: "Nicht gefunden" });
    const manage = req.hasPermission("absence.manage");
    if (row.EMPLOYEE_ID !== req.employeeId && !manage)
      return res.status(403).json({ error: "Keine Berechtigung" });
    if (!["APPROVED", "REQUESTED"].includes(row.STATUS))
      return res.status(409).json({ error: "Diese Abwesenheit ist schon abgelehnt oder storniert." });
    if (!manage && row.STATUS === "APPROVED" && String(row.DATE_FROM).slice(0, 10) <= localToday())
      return res.status(409).json({ error: "Eine begonnene Abwesenheit storniert, wer Abwesenheiten verwaltet." });
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

  // GET /entitlements/all?year= — alle Anspruchszeilen eines Jahres (Bulk-Editor)
  router.get("/entitlements/all", requirePermission("absence.manage"), async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const { data, error } = await supabase.from("VACATION_ENTITLEMENT")
      .select("*").eq("TENANT_ID", req.tenantId).eq("YEAR", year);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  // PUT /entitlements/bulk — Anspruch fuer mehrere Mitarbeiter/ein Jahr setzen.
  // Body: { year, items: [{ employee_id, days_entitled, carryover_override? }] }.
  // Update erhaelt bestehende NOTE (nur Tage/Uebertrag werden gesetzt).
  router.put("/entitlements/bulk", requirePermission("absence.manage"), async (req, res) => {
    const b = req.body || {};
    const year = Number(b.year);
    const items = Array.isArray(b.items) ? b.items : [];
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !items.length) {
      return res.status(400).json({ error: "year und items erforderlich" });
    }

    // Runde 10: vorher wurde ein leeres Feld zu 0 Tagen, eine Eingabe wie
    // „abc" scheiterte still (die Antwort meldete trotzdem Erfolg), und eine
    // Mitarbeiter-ID aus einem fremden Buero ging durch.
    const num = (v) => (v == null || v === "" ? null : Number(String(v).replace(",", ".")));
    const rows = [];
    for (const it of items) {
      const empId = Number(it.employee_id);
      const days = num(it.days_entitled);
      const carry = num(it.carryover_override);
      if (!empId || days == null || !Number.isFinite(days) || days < 0 || days > 366
          || (carry != null && (!Number.isFinite(carry) || Math.abs(carry) > 366))) {
        return res.status(400).json({ error: "Bitte je Mitarbeiter einen Anspruch zwischen 0 und 366 Tagen angeben." });
      }
      rows.push({ empId, days, carry });
    }

    const { data: emps, error: empErr } = await supabase.from("EMPLOYEE").select("ID")
      .eq("TENANT_ID", req.tenantId).in("ID", rows.map(r => r.empId));
    if (empErr) return res.status(500).json({ error: empErr.message });
    const known = new Set((emps || []).map(e => e.ID));
    if (rows.some(r => !known.has(r.empId))) return res.status(404).json({ error: "Mitarbeiter nicht gefunden" });

    const { data: existing, error: exErr } = await supabase.from("VACATION_ENTITLEMENT")
      .select("ID, EMPLOYEE_ID").eq("TENANT_ID", req.tenantId).eq("YEAR", year);
    if (exErr) return res.status(500).json({ error: exErr.message });
    const idByEmp = new Map((existing || []).map(e => [e.EMPLOYEE_ID, e.ID]));

    let count = 0;
    const failed = [];
    for (const { empId, days, carry } of rows) {
      const existingId = idByEmp.get(empId);
      const q = existingId
        ? await supabase.from("VACATION_ENTITLEMENT")
            .update({ DAYS_ENTITLED: days, CARRYOVER_OVERRIDE: carry }).eq("ID", existingId).eq("TENANT_ID", req.tenantId)
        : await supabase.from("VACATION_ENTITLEMENT")
            .insert([{ TENANT_ID: req.tenantId, EMPLOYEE_ID: empId, YEAR: year, DAYS_ENTITLED: days, CARRYOVER_OVERRIDE: carry }]);
      if (q.error) failed.push(empId); else count++;
    }
    if (failed.length) {
      return res.status(500).json({ error: `${failed.length} von ${rows.length} Ansprüchen nicht gespeichert.`, userFacing: true, count, failed });
    }
    res.json({ success: true, count });
  });

  // GET /vacation-balance?employee_id=&year= — Anspruch + Auto-Uebertrag - genommen
  router.get("/vacation-balance", async (req, res) => {
    const empId = req.query.employee_id ? Number(req.query.employee_id) : req.employeeId;
    const year  = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    if (empId !== req.employeeId && !req.hasPermission("absence.view"))
      return res.status(403).json({ error: "Fehlende Berechtigung: absence.view" });
    try { res.json({ data: await vacationBalanceFor(supabase, req.tenantId, empId, year) }); }
    catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }); }
  });

  // GET /preview — was ein Antrag kostet, bevor er gestellt wird (Runde 11).
  // Vorher sah man die Tage erst in der Liste — und dass ein Urlaub sich mit
  // einem schon genehmigten ueberschneidet (und doppelt vom Resturlaub
  // abgeht), gar nicht. Gezaehlt wird wie beim Speichern: Arbeitszeitmodell,
  // Feiertage, je Kalenderjahr.
  router.get("/preview", async (req, res) => {
    const q = req.query || {};
    const empId = q.employee_id ? Number(q.employee_id) : req.employeeId;
    const own = empId === req.employeeId;
    if (!own && !req.hasPermission("absence.view") && !req.hasPermission("absence.manage"))
      return res.status(403).json({ error: "Fehlende Berechtigung: absence.view" });
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const from = String(q.date_from || ""), to = String(q.date_to || q.date_from || "");
    if (!iso.test(from) || !iso.test(to)) return res.status(400).json({ error: "Von- und Bis-Datum im Format JJJJ-MM-TT angeben" });
    if (to < from) return res.status(400).json({ error: "Bis-Datum liegt vor Von-Datum" });
    if ((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000 > 366)
      return res.status(400).json({ error: "Eine Abwesenheit darf höchstens ein Jahr dauern" });
    const half = String(q.half_day) === "true" && from === to;
    const excludeId = q.exclude_id ? Number(q.exclude_id) : null;

    try {
      const { data: emp, error: empErr } = await supabase.from("EMPLOYEE")
        .select("ID").eq("ID", empId).eq("TENANT_ID", req.tenantId).maybeSingle();
      if (empErr) throw empErr;
      if (!emp) return res.status(404).json({ error: "Mitarbeiter nicht gefunden" });

      let type = null;
      if (q.absence_type_id) {
        const { data, error } = await supabase.from("ABSENCE_TYPE")
          .select("ID, REDUCES_VACATION, REQUIRES_APPROVAL").eq("ID", Number(q.absence_type_id)).eq("TENANT_ID", req.tenantId).maybeSingle();
        if (error) throw error;
        type = data;
      }

      const holidaysFor    = await buildHolidayResolver(supabase, req.tenantId, [empId], from, to);
      const assignmentsFor = await buildAssignmentResolver(supabase, req.tenantId, [empId]);
      const byYear = workdaysByYear(from, to, half, holidaysFor(empId), assignmentsFor(empId));
      const days = Object.values(byYear).reduce((s, n) => s + n, 0);

      // Ueberschneidungen mit eigenen offenen oder genehmigten Abwesenheiten
      const overlaps = await findOverlaps(supabase, req.tenantId, empId, from, to, excludeId);

      // Resturlaub nur fuer Arten, die ihn mindern — und fremde nur mit absence.view
      let balance = null;
      if (type && type.REDUCES_VACATION && (own || req.hasPermission("absence.view"))) {
        balance = [];
        for (const y of Object.keys(byYear).map(Number).sort()) {
          const b = await vacationBalanceFor(supabase, req.tenantId, empId, y, { excludeId });
          const r2 = (n) => Math.round(n * 100) / 100;
          balance.push({ year: y, remaining: b.remaining, pending: b.pending, days: byYear[y], after: r2(b.remaining - b.pending - byYear[y]) });
        }
      }

      res.json({ data: {
        days,
        by_year: Object.entries(byYear).map(([y, d]) => ({ year: Number(y), days: d })),
        reduces_vacation: !!type?.REDUCES_VACATION,
        requires_approval: type ? type.REQUIRES_APPROVAL !== false : null,
        balance,
        overlaps,
        // Speichern lehnt der Server dann ab (Runde 12) — außer für die Verwaltung.
        overlap_blocks: overlaps.length > 0 && !req.hasPermission("absence.manage"),
      } });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
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
module.exports.workdaysByYear = workdaysByYear;
module.exports.takenVacationByYear = takenVacationByYear;
module.exports.computeVacationBreakdown = computeVacationBreakdown;
