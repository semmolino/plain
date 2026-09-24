import { Rows2, Rows4 } from 'lucide-react'
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

export function DensityToggle({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  return (
    <div className="density-toggle" role="group" aria-label="Anzeigedichte">
      <button type="button" className="density-btn" aria-pressed={value === 'compact'}
        title="Kompakt – mehr Zeilen auf einen Blick" onClick={() => onChange('compact')}>
        <Rows4 size={14} strokeWidth={2} aria-hidden="true" />
        <span>Kompakt</span>
      </button>
      <button type="button" className="density-btn" aria-pressed={value === 'comfortable'}
        title="Luftig – größere Zeilen und Felder" onClick={() => onChange('comfortable')}>
        <Rows2 size={14} strokeWidth={2} aria-hidden="true" />
        <span>Luftig</span>
      </button>
    </div>
  )
}
