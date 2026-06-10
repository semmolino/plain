"use strict";

/**
 * Buchungs-Streak Berechnung
 *
 * Definition: aufeinanderfolgende ARBEITSTAGE (Mo-Fr) mit mindestens
 * 1 TEC-Eintrag fuer den Mitarbeiter. Wochenenden brechen die Streak nicht.
 *
 * Aktuelle Streak endet entweder am heutigen Tag (falls heute schon eine
 * Buchung existiert) oder am letzten Arbeitstag davor mit Buchung. Wenn der
 * letzte Arbeitstag KEINE Buchung hatte, ist current_streak = 0.
 *
 * Wir suchen bis 180 Tage zurueck -- ein halbes Jahr durchgaengig zu buchen
 * gilt als "lang genug fuer die Anzeige".
 *
 * TODO: Working-Time-Modell + Abwesenheiten (Urlaub, Krankheit) integrieren,
 * damit jemand der freitags nie arbeitet keinen kuenstlichen Streak-Bruch
 * bekommt. Phase 2 MVP: Mo-Fr hartkodiert.
 */

const LOOKBACK_DAYS = 180;

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

function isWeekend(d) {
  const w = d.getUTCDay();
  return w === 0 || w === 6; // 0=Sun, 6=Sat
}

/**
 * Liest alle TEC-Datums-Marker des Mitarbeiters in den letzten N Tagen
 * und liefert ein Set mit "YYYY-MM-DD"-Strings.
 */
async function fetchBookedDays(supabase, { tenantId, employeeId, lookbackDays }) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("TEC")
    .select("DATE_VOUCHER")
    .eq("TENANT_ID",   tenantId)
    .eq("EMPLOYEE_ID", employeeId)
    .gte("DATE_VOUCHER", since.toISOString().slice(0, 10));
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return new Set();
    throw { status: 500, message: error.message };
  }
  const set = new Set();
  for (const r of data || []) {
    if (r.DATE_VOUCHER) set.add(String(r.DATE_VOUCHER).slice(0, 10));
  }
  return set;
}

/** Berechnet current_streak, longest_streak und today_booked. */
async function calculateStreak(supabase, { tenantId, employeeId }) {
  const booked = await fetchBookedDays(supabase, { tenantId, employeeId, lookbackDays: LOOKBACK_DAYS });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = dayKey(today);
  const todayBooked = booked.has(todayStr);

  // ── current_streak: rueckwaerts bis zum letzten Arbeitstag ohne Buchung ──
  let current = 0;
  let cursor  = new Date(today);
  // Falls heute keine Buchung: starten wir bei gestern (heute ist noch nicht
  // "abgelaufen", soll nicht als Bruch zaehlen)
  if (!todayBooked) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    if (isWeekend(cursor)) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      continue;
    }
    const k = dayKey(cursor);
    if (booked.has(k)) {
      current++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else {
      break;
    }
  }

  // ── longest_streak: in den letzten LOOKBACK_DAYS Arbeitstagen ──
  // Wir laufen vom aeltesten zum neuesten Arbeitstag und zaehlen Sequenzen.
  let longest = 0;
  let run = 0;
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - LOOKBACK_DAYS);
  const walker = new Date(start);
  while (walker <= today) {
    if (!isWeekend(walker)) {
      const k = dayKey(walker);
      if (booked.has(k)) {
        run++;
        if (run > longest) longest = run;
      } else if (k !== todayStr) {
        // Heute zaehlt nicht als Bruch, falls noch nicht gebucht
        run = 0;
      }
    }
    walker.setUTCDate(walker.getUTCDate() + 1);
  }

  return {
    current_streak: current,
    longest_streak: longest,
    today_booked:   todayBooked,
  };
}

module.exports = { calculateStreak };
