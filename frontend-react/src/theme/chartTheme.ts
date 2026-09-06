import { useMemo } from 'react'
import { useThemeName, useIsDarkTheme } from '@/hooks/useThemeName'

// Bewusst KEIN Import von 'chart.js' in dieser Datei: sie wird von der
// App-Shell erreichbar sein muessen, und ein Import wuerde chart.js (~190 kB)
// ins Haupt-Bundle ziehen — auch fuer Seiten ohne Diagramm.
// Die Chart.js-Defaults setzt useChartDefaults.ts, das nur die Diagramm-
// Seiten importieren.

/**
 * Chart.js zeichnet auf ein <canvas>. Dort ist `var(--token)` KEINE gueltige
 * Farbe — die Tokens muessen zur Laufzeit zu echten Werten aufgeloest werden.
 *
 * Vorher setzten die Diagramme ueberhaupt keine Farben fuer Achsen, Gitter und
 * Legende. Chart.js nimmt dann sein Default-Grau (#666), das auf dem dunklen
 * Untergrund praktisch unsichtbar ist.
 */

/** Liest ein CSS-Custom-Property vom <html> als konkreten Farbwert. */
export function readToken(name: string, fallback = '#000'): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * Kategoriale Serienfarben — Okabe-Ito („Color Universal Design", empfohlen
 * von Nature Methods). Bewusst NICHT aus den Status-Tokens abgeleitet: eine
 * Datenreihe „Kosten" ist keine Fehlermeldung.
 *
 * Vorher stand hier Tailwind-Vollton, getrennt nach hell und dunkel. Der Satz
 * war bei Rot-Gruen-Schwaeche unbrauchbar: „Deckungsbeitrag" (#3b82f6) und
 * „Stunden" (#8b5cf6) lagen bei Deuteranopie bei dE=1.1 — also identisch, und
 * beide stehen im Reporting im selben Diagramm. Betrifft rund 8 % der
 * maennlichen Nutzer. Jetzt: Protanopie dE=23.2, Deuteranopie dE=16.2.
 *
 * EIN Satz fuer beide Themes, kein zweiter fuer dunkel: Okabe-Ito ist ueber
 * Helligkeit getrennt und liegt deshalb auf #ffffff wie auf #1c1c21 ueber 3:1.
 * Ein aufgehellter Zweitsatz hat die Trennung wieder zerstoert (dE 6.0).
 *
 * Genau sechs Eintraege — so viele Reihen benennt useSeriesColors. Wer eine
 * siebte braucht, erweitert den Satz NICHT frei Hand: die Pruefung in
 * scripts/check-design-system.mjs rechnet den Farbabstand nach.
 * Herleitung und Messwerte: docs/FARBKONZEPT_2026-09.md §5.
 */
const SERIES = [
  '#0072b2',  // 0 Blau        — Deckungsbeitrag / Honorar
  '#009e73',  // 1 Gruen       — fakturiert / Leistung
  '#e69f00',  // 2 Orange      — Backlog
  '#cc79a7',  // 3 Purpur      — Stunden
  '#56b4e9',  // 4 Himmelblau  — bezahlt
  '#d55e00',  // 5 Zinnober    — Kosten
]

export interface ChartTheme {
  series:     string[]
  text:       string
  textMuted:  string
  grid:       string
  surface:    string
  tooltipBg:  string
  tooltipFg:  string
  /** Serienfarbe mit Deckkraft — fuer Flaechen unter Linien / Balken. */
  alpha:      (hex: string, a: number) => string
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.substr(i, 2), 16))
  return `rgba(${r},${g},${b},${a})`
}

/** Aufgeloeste Chart-Farben zum aktuellen Theme. Rechnet bei Theme-Wechsel neu. */
export function useChartTheme(): ChartTheme {
  const themeName = useThemeName()
  const isDark    = useIsDarkTheme()

  return useMemo(() => ({
    series:    SERIES,
    text:      readToken('--text-2', '#374151'),
    textMuted: readToken('--text-3', '#6b7280'),
    grid:      readToken('--border-3', 'rgba(0,0,0,0.06)'),
    surface:   readToken('--surface', '#ffffff'),
    tooltipBg: isDark ? 'rgba(40,40,48,0.96)' : 'rgba(17,24,39,0.92)',
    tooltipFg: '#f9fafb',
    alpha:     hexToRgba,
    // themeName steuert die Neuberechnung: die Tokens am <html> aendern sich
    // erst NACH dem Attributwechsel, den useThemeName beobachtet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [themeName, isDark])
}

/**
 * Benannte Serienfarben fuer die Reporting-Diagramme. Gleiche Kennzahl =
 * gleiche Farbe ueber alle Tabs UND ueber alle Themes hinweg — eine
 * Bedeutungsfarbe darf sich nicht mit der Themewahl des Kollegen aendern.
 */
export function useSeriesColors() {
  const t = useChartTheme()
  return useMemo(() => ({
    db:         t.series[0],  // Blau
    fakturiert: t.series[1],  // Gruen
    backlog:    t.series[2],  // Orange
    stunden:    t.series[3],  // Purpur
    bezahlt:    t.series[4],  // Himmelblau
    // Zinnober, NICHT --danger: geplante Kosten sind kein Fehler. Der Abstand
    // zur Fehlerfarbe (#bd2121) betraegt dE=30 — die beiden sind nicht zu
    // verwechseln, und Rot bleibt fuer echten Handlungsbedarf frei.
    kosten:     t.series[5],
  }), [t])
}
