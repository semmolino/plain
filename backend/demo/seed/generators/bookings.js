"use strict";

/**
 * Generator: Zeit & Buchungen (TEC).
 *
 * Mitarbeiter-zentrisch: für jeden Mitarbeiter wird pro Arbeitstag ein
 * Stundenbudget über die an dem Tag aktiven Projekte verteilt und auf
 * Blatt-Strukturelemente gebucht. Die Blattwahl folgt dem Projektfortschritt
 * (frühe Leistungsphasen zuerst), damit spätere Leistungsstände plausibel sind.
 *
 * Gebucht wird über den echten Service `createBuchung` → Kostensatz (aus
 * EMPLOYEE_CP_RATE nach Datum), Rollen-Preset (EMPLOYEE2PROJECT) und der
 * COSTS/REVENUE-Rollup in PROJECT_STRUCTURE entstehen exakt wie in der App.
 */

const buchungen = require("../../../services/buchungen");
const cal = require("../lib/calendar");

// Tätigkeitstexte je grober Projektphase (0=früh … 1=spät).
const ACTIVITY_TEXTS = [
  "Grundlagenermittlung, Bestandsaufnahme",
  "Vorentwurf, Variantenstudie",
  "Entwurfsplanung, Abstimmung Bauherr",
  "Genehmigungsplanung, Bauantrag",
  "Ausführungsplanung, Detailplanung",
  "Ausschreibung, Leistungsverzeichnis",
  "Vergabe, Angebotsprüfung",
  "Objektüberwachung, Baustellentermin",
  "Rechnungsprüfung, Nachtragsmanagement",
  "Dokumentation, Abnahme, Übergabe",
];

function activityFor(progress, rng) {
  const idx = Math.min(ACTIVITY_TEXTS.length - 1, Math.floor(progress * ACTIVITY_TEXTS.length));
  // leichte Streuung um die passende Phase
  const jitter = rng.int(-1, 1);
  const i = Math.max(0, Math.min(ACTIVITY_TEXTS.length - 1, idx + jitter));
  return ACTIVITY_TEXTS[i];
}

function quantize(h, step) {
  return Math.max(step, Math.round(h / step) * step);
}

// Blatt entlang des Fortschritts wählen (Dreiecks-Bias um die aktuelle Phase).
function pickLeafForProgress(leaves, progress, rng) {
  if (leaves.length === 1) return leaves[0];
  const ordered = leaves
    .slice()
    .sort((a, b) => (a.SORT_ORDER ?? 0) - (b.SORT_ORDER ?? 0) || (a.ID > b.ID ? 1 : -1));
  const center = progress * (ordered.length - 1);
  const spread = Math.max(1, ordered.length * 0.25);
  let idx = Math.round(center + (rng.next() + rng.next() - 1) * spread);
  idx = Math.max(0, Math.min(ordered.length - 1, idx));
  return ordered[idx];
}

/**
 * Optional: Kostensatz-Historie aufbauen, falls ein Mitarbeiter keine hat.
 * Ein Satz pro Jahr der Spanne mit leichtem Anstieg — idempotent (nur wenn leer).
 */
async function ensureCostRates({ supabase, md, spanStartISO, apply, log }) {
  const startYear = cal.parseISO(spanStartISO).getUTCFullYear();
  const endYear = cal.parseISO(cal.todayISO()).getUTCFullYear();
  let inserted = 0;

  for (const emp of md.employees) {
    if (emp.cpRates.length > 0) continue; // vorhandene Historie respektieren
    const base = 42 + ((Number(emp.ID) * 7) % 22); // 42–63 €/h, stabil je Mitarbeiter
    const rows = [];
    for (let y = startYear; y <= endYear; y++) {
      const rate = Math.round(base * Math.pow(1.03, y - startYear) * 100) / 100;
      rows.push({ TENANT_ID: md.tenantId, EMPLOYEE_ID: Number(emp.ID), CP_RATE: rate, VALID_FROM: `${y}-01-01` });
    }
    if (apply && rows.length) {
      const { error } = await supabase.from("EMPLOYEE_CP_RATE").insert(rows);
      if (error) log(`  ⚠︎ CP_RATE für MA ${emp.ID}: ${error.message}`);
      else {
        emp.cpRates = rows.map((r) => ({ CP_RATE: r.CP_RATE, VALID_FROM: r.VALID_FROM }));
        inserted += rows.length;
      }
    } else {
      inserted += rows.length;
    }
  }
  if (inserted) log(`  Kostensätze ergänzt: ${inserted} Zeilen (${apply ? "geschrieben" : "geplant"})`);
  return inserted;
}

/**
 * Baut je Mitarbeiter die Liste seiner Projekt-Engagements mit aktivem Fenster.
 */
function buildEngagements(md, timeline) {
  const byEmp = new Map(); // empId -> [{ project, leaves, e2p, start, end }]
  for (const p of md.projects) {
    const tl = timeline.byProject.get(String(p.ID));
    if (!tl || !p.leaves.length) continue;
    for (const a of p.assignments) {
      const k = String(a.EMPLOYEE_ID);
      if (!byEmp.has(k)) byEmp.set(k, []);
      byEmp.get(k).push({ project: p, leaves: p.leaves, e2p: a, start: tl.start, end: tl.end, intensity: tl.intensity ?? 1 });
    }
  }
  return byEmp;
}

async function generate({ supabase, md, timeline, cfg, rng, log, apply }) {
  const bcfg = cfg.bookings;
  const holidays = cal.holidaySetForRange(
    // Spanne = frühestes Timeline-Start bis heute
    [...timeline.byProject.values()].reduce((min, e) => (e.start < min ? e.start : min), cal.todayISO()),
    cal.todayISO(),
    cfg.holidays.stateCode,
  );
  const today = cal.todayISO();
  const spanStart = [...timeline.byProject.values()].reduce((min, e) => (e.start < min ? e.start : min), today);

  if (cfg.bookings.seedCostRates !== false) {
    await ensureCostRates({ supabase, md, spanStartISO: spanStart, apply, log });
  }

  const engagements = buildEngagements(md, timeline);
  const stats = { tecCreated: 0, blocked: 0, daysBooked: 0, errors: 0 };

  for (const emp of md.employees) {
    const engs = engagements.get(String(emp.ID));
    if (!engs || !engs.length) continue;

    // Beschäftigungsfenster des Mitarbeiters
    const empStart = emp.ENTRY_DATE ? (emp.ENTRY_DATE > spanStart ? emp.ENTRY_DATE : spanStart) : spanStart;
    const empEnd = emp.EXIT_DATE ? (emp.EXIT_DATE < today ? emp.EXIT_DATE : today) : today;
    const empRng = rng.derive(`emp:${emp.ID}`);

    for (const day of cal.eachDay(empStart, empEnd)) {
      if (!cal.isWorkingDay(day, holidays)) continue;
      if (!empRng.chance(bcfg.bookingDayRatio)) continue;

      // an diesem Tag aktive Engagements
      const active = engs.filter((e) => day >= e.start && day <= e.end);
      if (!active.length) continue;

      const nProjects = Math.min(active.length, empRng.int(bcfg.projectsPerDay.min, bcfg.projectsPerDay.max));
      const chosen = empRng.shuffle(active).slice(0, nProjects);

      // Tages-Stundenbudget über gewählte Projekte verteilen
      let dayHours = quantize(empRng.around(bcfg.hoursPerDay.min, bcfg.hoursPerDay.max), bcfg.quantizeHours);
      const weights = chosen.map(() => 0.5 + empRng.next());
      const wsum = weights.reduce((a, b) => a + b, 0);

      let bookedToday = false;
      for (let ci = 0; ci < chosen.length; ci++) {
        const eng = chosen[ci];
        let hours = quantize((dayHours * weights[ci]) / wsum, bcfg.quantizeHours);
        if (hours <= 0) continue;
        hours = Math.round(hours * (eng.intensity ?? 1) / bcfg.quantizeHours) * bcfg.quantizeHours;
        if (hours <= 0) continue;

        const progress = eng.end === eng.start ? 1 : cal.diffDays(eng.start, day) / Math.max(1, cal.diffDays(eng.start, eng.end));
        const leaf = pickLeafForProgress(eng.leaves, Math.max(0, Math.min(1, progress)), empRng);
        const spRate = eng.e2p.SP_RATE != null ? Number(eng.e2p.SP_RATE) : Number(eng.e2p.ROLE_ID != null ? 90 : 90);

        const body = {
          EMPLOYEE_ID: Number(emp.ID),
          DATE_VOUCHER: day,
          TIME_START: null,
          TIME_FINISH: null,
          QUANTITY_INT: hours,
          QUANTITY_EXT: hours,
          SP_RATE: spRate,
          POSTING_DESCRIPTION: activityFor(progress, empRng),
          PROJECT_ID: Number(eng.project.ID),
          STRUCTURE_ID: Number(leaf.ID),
        };

        if (!apply) {
          stats.tecCreated++;
          bookedToday = true;
          continue;
        }
        try {
          await buchungen.createBuchung(supabase, { body, tenantId: md.tenantId });
          stats.tecCreated++;
          bookedToday = true;
        } catch (e) {
          if (e?.details?.code === "ARBZG_BLOCK" || e?.status === 409) stats.blocked++;
          else {
            stats.errors++;
            if (stats.errors <= 5) log(`  ⚠︎ Buchung MA${emp.ID} ${day} P${eng.project.ID}: ${e?.message || e}`);
          }
        }
      }
      if (bookedToday) stats.daysBooked++;
    }
  }

  log(
    `  Buchungen: ${stats.tecCreated} erzeugt` +
      (stats.blocked ? `, ${stats.blocked} ArbZG-geblockt` : "") +
      (stats.errors ? `, ${stats.errors} Fehler` : "") +
      ` (an ${stats.daysBooked} Personentagen)`,
  );
  return stats;
}

module.exports = { generate, ensureCostRates };
