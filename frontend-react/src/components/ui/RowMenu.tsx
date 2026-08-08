import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Beschriftung des Ausloesers fuer Screenreader. */
  label?: string
  /** Zusaetzliche Klassen am Ausloeser (z. B. row-action-btn statt btn-small). */
  triggerClassName?: string
}

/**
 * ⋯-Menue fuer Aktionen in einer Tabellenzeile.
 *
 * Es gab zwei lokale Implementierungen mit unterschiedlichen Signaturen:
 * eine selbstverwaltete mit Portal (Rechnungsliste) und eine von aussen
 * gesteuerte ohne Portal (Mahnungen). Diese hier ist die gemeinsame Basis.
 *
 * Das Menue wird per Portal an <body> gehaengt. Ohne das schneidet der
 * horizontal scrollende Tabellencontainer (`.list-section { overflow-x:
 * auto }`) das aufgeklappte Menue ab.
 *
 * Gegenueber beiden Vorlagen ergaenzt: Escape schliesst, der Fokus kehrt
 * danach auf den Ausloeser zurueck, und der Zustand steht ueber
 * aria-expanded/aria-haspopup auch fuer Screenreader bereit.
 */
export function RowMenu({ children, label = 'Weitere Aktionen', triggerClassName = 'btn-small' }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState<{ top: number; right: number } | null>(null)
  const triggerRef  = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const trigger = triggerRef.current
    if (trigger) {
      const r = trigger.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }

    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    // Beim Scrollen schliessen: die Position ist einmalig berechnet und
    // wandert sonst vom Ausloeser weg.
    const close = () => setOpen(false)

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        onClick={() => setOpen(o => !o)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <MoreHorizontal size={15} strokeWidth={1.75} />
      </button>

      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          className="row-menu-dropdown row-menu-dropdown-portal"
          role="menu"
          aria-label={label}
          style={{ top: pos.top, right: pos.right }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}
