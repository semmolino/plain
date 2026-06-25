import { type ReactNode, useRef } from 'react'

interface Props {
  open:       boolean
  onClose:    () => void
  title:      string
  children:   ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: Props) {
  // Nur schließen, wenn der Klick WIRKLICH auf dem Backdrop beginnt UND endet.
  // Verhindert das versehentliche Schließen, wenn man innerhalb des Modals
  // (z. B. beim Markieren von Text in einem Feld) die Maus drückt und außerhalb
  // loslässt — dann feuert ein click-Event auf dem Backdrop, obwohl der Nutzer
  // nicht schließen wollte.
  const downOnBackdrop = useRef(false)

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={e => {
        const intentional = e.target === e.currentTarget && downOnBackdrop.current
        downOnBackdrop.current = false
        if (intentional) onClose()
      }}
    >
      <div className={`modal-card${className ? ` ${className}` : ''}`}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
