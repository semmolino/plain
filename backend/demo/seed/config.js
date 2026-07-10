"use strict";

/**
 * Zentrale Stellschrauben für den Demo-Bewegungsdaten-Generator.
 *
 * Alles hier ist bewusst deklarativ gehalten, damit sich das "Narrativ" des
 * Demo-Büros (wie viel gebucht wird, wie oft abgerechnet wird, wie zügig
 * gezahlt wird) an einer Stelle justieren lässt — ohne die Generator-Logik
 * anzufassen.
 *
 * WICHTIG: Der Generator ist deterministisch. Gleicher `seed` + gleiche
 * Stammdaten + gleiche Timeline ⇒ exakt dieselben Bewegungsdaten.
 */

module.exports = {
  // Reproduzierbarkeit: fixer Seed für den Zufallsgenerator.
  seed: 20260101,

  // Welche Bewegungsdaten-Bereiche laufen sollen (per CLI --only / --skip
  // überschreibbar). Reihenfolge = Abhängigkeitsreihenfolge.
  domains: {
    bookings: true, // Zeit & Buchungen (TEC) — Grundlage für alles Weitere
    progress: true, // Leistung & Fortschritt (PROJECT_PROGRESS)
    invoicing: true, // Abschlags-/Schlussrechnungen + Zahlungen
    hr: true, // Abwesenheiten/Urlaub
  },

  // Feiertagskalender (für Arbeitstag-Erkennung der Buchungen).
  holidays: {
    countryCode: "DE",
    stateCode: "BW", // Baden-Württemberg (inkl. Hl. Drei Könige, Fronleichnam, Allerheiligen)
  },

  // ── Zeit & Buchungen ────────────────────────────────────────────────────
  bookings: {
    // Sollarbeitstag in Stunden (wird über die zugewiesenen Projekte verteilt).
    hoursPerDay: { min: 6, max: 8.5 },
    // Auf wie viele Projekte sich ein Mitarbeiter an einem Tag typischerweise verteilt.
    projectsPerDay: { min: 1, max: 3 },
    // Anteil der Arbeitstage, an denen überhaupt gebucht wird (Rest: Orga, Abwesenheit …).
    bookingDayRatio: 0.82,
    // Buchungen auf Stunden-Blöcke runden (0.25 = Viertelstunde).
    quantizeHours: 0.25,
    // Für Pauschal-Projekte (BILLING_TYPE_ID=1) die aufgewendeten Stunden so
    // kalibrieren, dass die Kosten unter dem Fixhonorar bleiben (Zielmarge).
    pauschalTargetCostRatio: { min: 0.55, max: 0.8 },
    // Wahrscheinlichkeit, dass ein Projekt zusätzliche Sonstige Buchungen
    // (Pauschalen/Stückleistungen) bekommt, falls BOOKING_TYPE vorhanden.
    specialBookingChance: 0.25,
  },

  // ── Leistung & Fortschritt ──────────────────────────────────────────────
  progress: {
    // Für Pauschal-Projekte: an wie vielen Stichtagen (etwa monatlich) ein
    // Leistungsstand-Snapshot geschrieben wird, der den Fertigstellungsgrad hebt.
    snapshotEveryDays: 30,
  },

  // ── Rechnungen & Zahlungen ──────────────────────────────────────────────
  invoicing: {
    // Abschlagsrechnungen etwa alle N Tage über die Projektlaufzeit.
    partialEveryDays: 75,
    // Pauschal-Abschläge nie über diesen %-Anteil des Fixhonorars hinaus stellen —
    // der Rest bleibt der Schlussrechnung vorbehalten.
    partialCapPct: 90,
    // Schlussrechnung, sobald das Projekt laut Timeline abgeschlossen ist.
    finalWhenClosed: true,
    // Zahlungsverhalten der Kunden.
    payment: {
      payRatio: 0.9, // Anteil gestellter Rechnungen, die (bis heute) bezahlt sind
      delayDays: { min: 7, max: 45 }, // Zahlungsziel-Streuung ab Rechnungsdatum
    },
    // Skip Playwright-PDF-Rendering beim Buchen (schnell + kein Chromium nötig).
    // Für echte Beispiel-PDFs später einzelne Belege in der App neu rendern.
    skipDocuments: true,
  },

  // ── HR-Bewegungen ───────────────────────────────────────────────────────
  hr: {
    vacationDaysPerYear: { min: 25, max: 30 },
    sickDaysPerYear: { min: 2, max: 8 },
  },
};
