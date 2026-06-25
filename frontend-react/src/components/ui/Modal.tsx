import { type ReactNode } from 'react'
import { useBackdropClose } from '@/hooks/useBackdropClose'

interface Props {
  open:       boolean
  onClose:    () => void
  title:      string
  children:   ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: Props) {
  const backdrop = useBackdropClose(onClose)
  if (!open) return null

  return (
    <div className="modal-backdrop" {...backdrop}>
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
