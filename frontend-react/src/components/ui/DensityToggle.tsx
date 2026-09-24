import { Rows2, Rows4 } from 'lucide-react'
import type { Density } from '@/hooks/useDensity'

/** Umschalter Kompakt/Luftig. Zustand kommt aus `useDensity()` der Seite. */
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
