import { type ReactNode } from 'react'

interface Props {
  open:     boolean
  onClose:  () => void
  title:    string
  children: ReactNode
}

export function Modal({ open, onClose, title, children }: Props) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
