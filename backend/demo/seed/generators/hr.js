"use strict";

/**
 * Generator: HR-Bewegungen (Abwesenheit/Urlaub) — Migration 0086.
 *
 * Pro Mitarbeiter und Jahr (innerhalb des Beschäftigungsfensters, nie in der
 * Zukunft):
 *   - Urlaubsanspruch (VACATION_ENTITLEMENT) — idempotenter Upsert.
 *   - Urlaubsblöcke (Abwesenheitsart "Urlaub"): 2–4 Blöcke, zusammen ~Anspruch.
 *   - Krankheitstage (Art "Krankheit"): 1–2 kurze Blöcke.
 * Alle Abwesenheiten STATUS='APPROVED' (kuratierter Demo-Stand). Direkte Inserts
 * in ABSENCE/VACATION_ENTITLEMENT — kein Service, da keine Aggregat-Invarianten
 * (Abwesenheit fließt erst beim Lesen ins Zeitkonto ein, via COUNTS_AS_WORKED).
 *
 * Fehlt die Tabelle (Migration 0086 nicht eingespielt), wird sauber übersprungen.
 */

const cal = require("../lib/calendar");

function isMissingTable(msg) {
  const m = String(msg || "").toLowerCase();
  return m.includes("does not exist") || m.includes("could not find the table") || m.includes("schema cache");
}

// Arbeitstage im Fenster als Array sammeln.
function workingDaysIn(startISO, endISO, holidays) {
  const out = [];
  for (const d of cal.eachDay(startISO, endISO)) if (cal.isWorkingDay(d, holidays)) out.push(d);
  return out;
}

// Block über N Arbeitstage: from = zufälliger Arbeitstag, to = N-ter Arbeitstag danach.
function pickBlock(wd, lengthWD, rng, usedFrom) {
  if (wd.length === 0) return null;
  const len = Math.max(1, Math.min(lengthWD, wd.length));
  for (let attempt = 0; attempt < 8; attempt++) {
    const startIdx = rng.int(0, wd.length - len);
    const from = wd[startIdx];
    if (usedFrom.has(from)) continue;
    const to = wd[Math.min(startIdx + len - 1, wd.length - 1)];
    usedFrom.add(from);
    return { from, to, days: len };
  }
  return null;
}

async function generate({ supabase, md, cfg, rng, log, apply }) {
  const stats = { absences: 0, entitlements: 0, skipped: 0, errors: 0, planned: 0 };
  const today = cal.todayISO();

  // Abwesenheitsarten-Katalog laden
  const { data: types, error: typeErr } = await supabase
    .from("ABSENCE_TYPE")
    .select("ID, NAME, REDUCES_VACATION")
    .eq("TENANT_ID", md.tenantId);
  if (typeErr) {
    if (isMissingTable(typeErr.message)) {
      log("  HR: ABSENCE_TYPE fehlt (Migration 0086 nicht eingespielt) — übersprungen.");
      return { skipped: true };
    }
    log(`  ⚠︎ HR: ABSENCE_TYPE nicht ladbar: ${typeErr.message}`);
    return { skipped: true };
  }
  const byName = new Map((types || []).map((t) => [String(t.NAME).toLowerCase(), t]));
  const urlaubType = byName.get("urlaub") || (types || []).find((t) => t.REDUCES_VACATION) || (types || [])[0];
  const krankType = byName.get("krankheit") || (types || [])[1] || urlaubType;
  if (!urlaubType) {
    log("  HR: keine Abwesenheitsarten vorhanden — übersprungen.");
    return { skipped: true };
  }

  const spanStartYear = cal.parseISO(cal.addDays(today, -Math.round(5 * 365))).getUTCFullYear();
  const thisYear = cal.parseISO(today).getUTCFullYear();

  for (const emp of md.employees) {
    const empRng = rng.derive(`hr:${emp.ID}`);
    const empStart = emp.ENTRY_DATE ? emp.ENTRY_DATE.slice(0, 10) : `${spanStartYear}-01-01`;
    const empEnd = emp.EXIT_DATE ? (emp.EXIT_DATE < today ? emp.EXIT_DATE.slice(0, 10) : today) : today;
    const startYear = Math.max(spanStartYear, cal.parseISO(empStart).getUTCFullYear());

    const vacDays = empRng.int(cfg.hr.vacationDaysPerYear.min, cfg.hr.vacationDaysPerYear.max);
    const sickDays = empRng.int(cfg.hr.sickDaysPerYear.min, cfg.hr.sickDaysPerYear.max);

    for (let y = startYear; y <= thisYear; y++) {
      // Jahresfenster mit Beschäftigung + "nicht in Zukunft" schneiden
      const winStart = `${y}-01-01` < empStart ? empStart : `${y}-01-01`;
      let winEnd = `${y}-12-31` > empEnd ? empEnd : `${y}-12-31`;
      if (winStart > winEnd) continue;
      const holidays = cal.holidaySetForRange(winStart, winEnd, cfg.holidays.stateCode);
      const wd = workingDaysIn(winStart, winEnd, holidays);
      if (wd.length < 3) continue;

      // anteilig, falls Teiljahr (Ein-/Austritt)
      const fraction = Math.min(1, wd.length / 220);
      const yVac = Math.round(vacDays * fraction);
      const ySick = Math.round(sickDays * fraction);

      // Urlaubsanspruch (idempotent)
      stats.planned++;
      if (apply) {
        const { error: entErr } = await supabase
          .from("VACATION_ENTITLEMENT")
          .upsert([{ TENANT_ID: md.tenantId, EMPLOYEE_ID: Number(emp.ID), YEAR: y, DAYS_ENTITLED: vacDays }], {
            onConflict: "TENANT_ID,EMPLOYEE_ID,YEAR",
          });
        if (entErr && !isMissingTable(entErr.message)) {
          stats.errors++;
          if (stats.errors <= 6) log(`  ⚠︎ Anspruch MA${emp.ID} ${y}: ${entErr.message}`);
        } else if (!entErr) stats.entitlements++;
      }

      // Urlaubsblöcke: grob in 2–4 Blöcke aufteilen
      const usedFrom = new Set();
      const blocks = [];
      let remaining = yVac;
      const nBlocks = empRng.int(2, 4);
      for (let bi = 0; bi < nBlocks && remaining > 0; bi++) {
        const len = bi === nBlocks - 1 ? remaining : Math.max(1, Math.min(remaining, empRng.int(3, 10)));
        blocks.push(len);
        remaining -= len;
      }
      for (const len of blocks) {
        const blk = pickBlock(wd, len, empRng, usedFrom);
        if (!blk) continue;
        stats.planned++;
        if (apply) {
          const ok = await insertAbsence({ supabase, tenantId: md.tenantId, emp, typeId: urlaubType.ID, blk, stats, log });
          if (ok) stats.absences++;
        }
      }

      // Krankheit: 1–2 kurze Blöcke
      let sickRemaining = ySick;
      const nSick = sickRemaining > 0 ? empRng.int(1, 2) : 0;
      for (let si = 0; si < nSick && sickRemaining > 0; si++) {
        const len = si === nSick - 1 ? sickRemaining : Math.max(1, Math.min(sickRemaining, empRng.int(1, 3)));
        sickRemaining -= len;
        const blk = pickBlock(wd, len, empRng, usedFrom);
        if (!blk) continue;
        stats.planned++;
        if (apply) {
          const ok = await insertAbsence({ supabase, tenantId: md.tenantId, emp, typeId: krankType.ID, blk, stats, log });
          if (ok) stats.absences++;
        }
      }
    }
  }

  if (!apply) {
    log(`  HR-Bewegungen (geplant): ~${stats.planned} Einträge (Anspruch + Abwesenheiten) über ${md.employees.length} Mitarbeiter`);
  } else {
    log(
      `  HR-Bewegungen: ${stats.absences} Abwesenheiten, ${stats.entitlements} Urlaubsansprüche` +
        (stats.errors ? `, ${stats.errors} Fehler` : ""),
    );
  }
  return stats;
}

async function insertAbsence({ supabase, tenantId, emp, typeId, blk, stats, log }) {
  const requestedAt = `${cal.addDays(blk.from, -14)}T09:00:00Z`;
  const decidedAt = `${cal.addDays(blk.from, -10)}T09:00:00Z`;
  const { error } = await supabase.from("ABSENCE").insert([
    {
      TENANT_ID: tenantId,
      EMPLOYEE_ID: Number(emp.ID),
      ABSENCE_TYPE_ID: Number(typeId),
      DATE_FROM: blk.from,
      DATE_TO: blk.to,
      HALF_DAY: false,
      STATUS: "APPROVED",
      REQUESTED_BY: Number(emp.ID),
      REQUESTED_AT: requestedAt,
      DECIDED_AT: decidedAt,
    },
  ]);
  if (error) {
    stats.errors++;
    if (stats.errors <= 6) log(`  ⚠︎ Abwesenheit MA${emp.ID} ${blk.from}: ${error.message}`);
    return false;
  }
  return true;
}

module.exports = { generate };
