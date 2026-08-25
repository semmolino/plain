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
 * Kategoriale Serienfarben. Bewusst NICHT aus den Status-Tokens abgeleitet:
 * eine Datenreihe „Kosten" ist keine Fehlermeldung. Im dunklen Theme heller
 * und gesaettigter, damit sie auf #131316 klar stehen.
 */
// Fallbacks nur fuer den Fall, dass die Tokens fehlen (SSR/Test ohne CSS).
const SERIES_FALLBACK = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#ec4899', '#84cc16']

/** Serienfarben aus --chart-1..8. Die Dark-Variante steckt im Theme-Block. */
function readSeries(): string[] {
  return SERIES_FALLBACK.map((fb, i) => readToken(`--chart-${i + 1}`, fb))
}

export interface ChartTheme {
  series:     string[]
  text:       string
  textMuted:  string
  grid:       string
  surface:    string
  tooltipBg:  string
  tooltipFg:  string
  /** Neutrale Flaeche — Soll-Balken, „noch offen"-Anteile. Keine Datenreihe. */
  neutral:    string
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
    series:    readSeries(),
    text:      readToken('--text-2', '#374151'),
    textMuted: readToken('--text-3', '#6b7280'),
    grid:      readToken('--border-3', 'rgba(0,0,0,0.06)'),
    surface:   readToken('--surface', '#ffffff'),
    tooltipBg: readToken('--chart-tooltip-bg', isDark ? 'rgba(40,40,48,0.96)' : 'rgba(17,24,39,0.92)'),
    tooltipFg: readToken('--chart-tooltip-fg', '#f9fafb'),
    neutral:   readToken('--text-4', 'rgba(17,24,39,0.47)'),
    alpha:     hexToRgba,
    // themeName steuert die Neuberechnung: die Tokens am <html> aendern sich
    // erst NACH dem Attributwechsel, den useThemeName beobachtet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [themeName, isDark])
}

/**
 * Benannte Serienfarben fuer die Reporting-Diagramme. Gleiche Kennzahl =
 * gleiche Farbe ueber alle Tabs hinweg, und im Dark-Theme automatisch heller.
 */
export function useSeriesColors() {
  const t = useChartTheme()
  return useMemo(() => ({
    db:         t.series[0],  // blau
    fakturiert: t.series[1],  // gruen
    backlog:    t.series[2],  // amber
    stunden:    t.series[3],  // violett
    bezahlt:    t.series[4],  // cyan
    kosten:     t.series[5],  // rot
  }), [t])
}
