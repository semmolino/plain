import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

interface Props {
  title:        ReactNode
  children:     ReactNode
  /** Kurzer Zustand rechts neben dem Titel, z. B. „2 ausgefüllt". */
  hint?:        ReactNode
  defaultOpen?: boolean
  /** Gesteuert: wenn gesetzt, gilt dieser Wert statt des eigenen Zustands. */
  open?:        boolean
  onToggle?:    (open: boolean) => void
  className?:   string
}

/**
 * Auf- und zuklappbarer Abschnitt (UI-Pilot 2026-09).
 *
 * Ersetzt Knoepfe mit „▶"/„▼" im Text (E-Rechnungs-Detailfelder): die
 * Zeichen rendern je nach Schrift verschieden, und ob der Abschnitt offen
 * ist, war fuer Screenreader nicht erkennbar. Hier traegt `aria-expanded`
 * den Zustand, das Icon dreht sich nur mit.
 */
export function Disclosure({ title, children, hint, defaultOpen = false, open, onToggle, className }: Props) {
  const [own, setOwn] = useState(defaultOpen)
  const isOpen = open ?? own
  const bodyId = useId()

  function toggle() {
    const next = !isOpen
    if (open === undefined) setOwn(next)
    onToggle?.(next)
  }

  return (
    <div className={`disclosure${isOpen ? ' disclosure--open' : ''}${className ? ` ${className}` : ''}`}>
      <button type="button" className="disclosure-btn" aria-expanded={isOpen} aria-controls={bodyId} onClick={toggle}>
        <ChevronRight size={15} strokeWidth={2} className="disclosure-chevron" aria-hidden="true" />
        <span className="disclosure-title">{title}</span>
        {hint && <span className="disclosure-hint">{hint}</span>}
      </button>
      {isOpen && <div className="disclosure-body" id={bodyId}>{children}</div>}
    </div>
  )
}
