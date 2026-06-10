"use strict";

/**
 * Modul-Reife pro User. Berechnet basierend auf einfachen DB-Counts, wie
 * sicher ein User mit jedem Modul umgeht. Vier Stufen:
 *
 *   noch_nicht_erkundet  -> 0 Aktionen
 *   anfaenger            -> 1-9
 *   vertraut             -> 10-49
 *   profi                -> 50-199
 *   experte              -> 200+
 *
 * Zusaetzlich liefert mastery einen Tipp -- das Modul mit der niedrigsten
 * Reife, mit Tipp-Text fuer den naechsten konkreten Schritt.
 */

const LEVELS = [
  { id: "noch_nicht_erkundet", label: "Noch nicht erkundet", min: 0   },
  { id: "anfaenger",           label: "Anfänger",            min: 1   },
  { id: "vertraut",            label: "Vertraut",            min: 10  },
  { id: "profi",               label: "Profi",               min: 50  },
  { id: "experte",             label: "Experte",             min: 200 },
];

function levelFor(count) {
  let best = LEVELS[0];
  for (const lvl of LEVELS) {
    if (count >= lvl.min) best = lvl;
  }
  return best;
}

function progressInLevel(count) {
  // Wo befindet sich der User in der aktuellen Stufe? 0..1
  const sorted = [...LEVELS].sort((a, b) => a.min - b.min);
  let curMin = 0, nextMin = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    if (count >= sorted[i].min) {
      curMin = sorted[i].min;
      nextMin = sorted[i + 1]?.min ?? Infinity;
    }
  }
  if (nextMin === Infinity) return 1;
  if (nextMin === curMin)   return 1;
  return Math.min(1, Math.max(0, (count - curMin) / (nextMin - curMin)));
}

async function count(supabase, table, filter) {
  try {
    let q = supabase.from(table).select("ID", { count: "exact", head: true });
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
    const { count, error } = await q;
    if (error) return 0;
    return count || 0;
  } catch (_) { return 0; }
}

// Modul-Konfiguration: pro Modul ein Count + Tipp-Text fuer naechste Stufe.
const MODULES = [
  {
    id: "buchungen",
    label: "Buchungen",
    tipNext: {
      noch_nicht_erkundet: "Trag deine ersten Stunden ein -- der schnellste Weg, Projekt-Honorare sichtbar zu machen.",
      anfaenger:           "Probiere die Stempeluhr: Buchungen mit Von-/Bis-Zeit lassen die Aufwandsverteilung pro Tag erkennen.",
      vertraut:            "Filter die Liste nach Projekt oder Mitarbeiter -- so erkennst du Aufwands-Hotspots.",
      profi:               "Exportiere monatlich die Buchungsliste als PDF fuer dein Archiv.",
      experte:             null,
    },
    counter: async (supabase, { tenantId, employeeId }) =>
      count(supabase, "TEC", { TENANT_ID: tenantId, EMPLOYEE_ID: employeeId }),
  },
  {
    id: "angebote",
    label: "Angebote",
    tipNext: {
      noch_nicht_erkundet: "Lege dein erstes Angebot an -- Vorlage, Strukturelemente, Preise -- alles in einer Maske.",
      anfaenger:           "Konvertiere ein Angebot in ein Projekt; die Struktur wird automatisch uebernommen.",
      vertraut:            "Verwende HOAI-Honorartabellen fuer die Berechnung -- das spart Tippen und ist pruefbar.",
      profi:               "Hinterlege Standard-Textbausteine im Admin, dann sind Kopf-/Fusstexte vorab gefuellt.",
      experte:             null,
    },
    counter: async (supabase, { tenantId, employeeId }) =>
      count(supabase, "OFFER", { TENANT_ID: tenantId, EMPLOYEE_ID: employeeId }),
  },
  {
    id: "rechnungen",
    label: "Rechnungen",
    tipNext: {
      noch_nicht_erkundet: "Erstelle deine erste Rechnung -- Abschlag, Honorarrechnung oder Schlussrechnung.",
      anfaenger:           "Probiere die Abschlagsrechnung -- Teilbetraege werden automatisch in der Schlussrechnung abgezogen.",
      vertraut:            "Versende eine Rechnung direkt per Mail aus PlaIn (XRechnung-Anhang inklusive).",
      profi:               "Hinterlege Vorlauf- und Schlusstext pro Rechnungstyp im Admin.",
      experte:             null,
    },
    counter: async (supabase, { tenantId, employeeId }) =>
      count(supabase, "INVOICE", { TENANT_ID: tenantId, EMPLOYEE_ID: employeeId }),
  },
  {
    id: "projekte",
    label: "Projekte",
    tipNext: {
      noch_nicht_erkundet: "Lege ein Projekt an -- am einfachsten ueber 'Angebot konvertieren'.",
      anfaenger:           "Setze in einem Projekt einen Leistungsstand-Snapshot -- so dokumentierst du Fortschritt nachvollziehbar.",
      vertraut:            "Nutze Budget-Warnungen, um vor Ueberschreitungen rechtzeitig erinnert zu werden.",
      profi:               "Schau dir den Einzelprojekt-Report mit EVM-Kennzahlen an: CPI, Burn-Rate, Hochrechnung.",
      experte:             null,
    },
    counter: async (supabase, { tenantId, employeeId }) =>
      count(supabase, "PROJECT", { TENANT_ID: tenantId, PROJECT_MANAGER_ID: employeeId }),
  },
];

async function computeMastery(supabase, { tenantId, employeeId }) {
  const results = [];
  for (const m of MODULES) {
    const c = await m.counter(supabase, { tenantId, employeeId });
    const lvl = levelFor(c);
    results.push({
      module:    m.id,
      label:     m.label,
      count:     c,
      level:     lvl.id,
      level_label: lvl.label,
      progress_in_level: progressInLevel(c),
      tip:       m.tipNext[lvl.id] ?? null,
    });
  }

  // "Tipp des Tages": Modul mit niedrigster Reife, das einen Tipp hat
  const sortedByCount = [...results].sort((a, b) => a.count - b.count);
  const tipOfDay = sortedByCount.find(r => r.tip) ?? null;

  return {
    modules: results,
    tip_of_day: tipOfDay ? {
      module: tipOfDay.module,
      label:  tipOfDay.label,
      text:   tipOfDay.tip,
    } : null,
  };
}

module.exports = { computeMastery };
