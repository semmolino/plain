import { useStickyState } from '@/hooks/useStickyState'

export type Density = 'compact' | 'comfortable'

/**
 * Anzeigedichte fuer Tabellen und Formulare (UI-Pilot 2026-09), pro Nutzer
 * gespeichert. Wirkt nur auf Bausteine, die sie ausdruecklich lesen
 * (`[data-density] .sx-…`, `.bk-…`) — bestehende Listen aendern sich nicht.
 *
 * Auf dem Handy und bei Touch-Bedienung gilt immer die luftige Variante;
 * dort blendet CSS den Umschalter aus, weil 44-px-Ziele nicht verhandelbar
 * sind.
 */
export function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensity] = useStickyState<Density>('ui.density', 'comfortable')
  return [density === 'compact' ? 'compact' : 'comfortable', setDensity]
}
