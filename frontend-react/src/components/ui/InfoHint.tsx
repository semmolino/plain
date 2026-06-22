import { useEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'

/**
 * InfoHint — kleines, konsistentes Hilfe-Icon mit Tooltip-Popover.
 *
 * Fundament für das systemweite Tooltip-Konzept: überall, wo ein Feld,
 * Button oder Wizard-Schritt erklärungsbedürftig ist, kommt <InfoHint>
 * zum Einsatz, damit Wording und Optik einheitlich bleiben.
 *
 * Bedienung: Hover (Desktop) ODER Klick/Tap (Touch) öffnet das Popover,
 * Klick außerhalb oder Escape schließt es. Touch-tauglich (44px Trefferfläche
 * über das umgebende Padding hinaus ist nicht nötig — Icon ist self-contained,
 * aber per Klick erreichbar).
 */
export function InfoHint({
  children,
  title,
  label = 'Mehr Informationen',
  align = 'left',
  size = 14,
}: {
  children: React.ReactNode
  title?: string
  label?: string
  align?: 'left' | 'right'
  size?: number
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span
      className="info-hint"
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="info-hint-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Info size={size} strokeWidth={2} />
      </button>
      {open && (
        <span className={`info-hint-pop info-hint-pop-${align}`} role="tooltip">
          {title && <strong className="info-hint-pop-title">{title}</strong>}
          <span className="info-hint-pop-body">{children}</span>
        </span>
      )}
    </span>
  )
}
