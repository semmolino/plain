import { useState, type ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'

interface Props {
  /** Die Filter-Chips der Seite. */
  children: ReactNode
  /** Anzahl aktiver Filter — steuert Badge und Zuruecksetzen-Knopf. */
  activeCount?: number
  /** Setzt alle Filter der Seite zurueck. */
  onReset?: () => void
}

/**
 * Filter-Chips, die auf schmalen Geraeten hinter einem Knopf liegen.
 *
 * Gemessen auf 390x844 belegte die Bedienleiste der Rechnungsliste 142 von
 * 360px bis zur ersten Datenzeile — Suche, Filter und Aktionen brauchten
 * drei Zeilen, seit die Touch-Ziele auf 44px stehen. Eingeklappt bleibt
 * eine Zeile, der Rest oeffnet sich auf Wunsch.
 *
 * Ab 641px verhaelt sich die Komponente wie vorher: alle Chips sichtbar,
 * kein Knopf. Der Knopf traegt die Anzahl aktiver Filter, damit man auch
 * im eingeklappten Zustand sieht, dass die Liste gefiltert ist.
 */
export function FilterBar({ children, activeCount = 0, onReset }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={`filter-bar-toggle${activeCount > 0 ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="filter-bar-chips"
      >
        <SlidersHorizontal size={14} strokeWidth={2} />
        Filter
        {activeCount > 0 && <span className="filter-bar-count">{activeCount}</span>}
      </button>

      <div
        id="filter-bar-chips"
        className={`filter-bar-chips${open ? ' open' : ''}`}
      >
        {children}
        {activeCount > 0 && onReset && (
          <button type="button" className="filter-bar-reset" onClick={onReset}>
            <X size={13} strokeWidth={2.5} />
            Zurücksetzen
          </button>
        )}
      </div>
    </>
  )
}
