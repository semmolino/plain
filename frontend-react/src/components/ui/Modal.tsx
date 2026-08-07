import { type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useBackdropClose } from '@/hooks/useBackdropClose'
import { useDialog } from '@/hooks/useDialog'

interface Props {
  open:       boolean
  onClose:    () => void
  title:      string
  children:   ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: Props) {
  const backdrop = useBackdropClose(onClose)
  // Escape, Fokus-Falle, Fokus-Rueckgabe, role="dialog"/aria-modal/aria-labelledby.
  const dialog   = useDialog(open, onClose)
  if (!open) return null

  return (
    <div className="modal-backdrop" {...backdrop}>
      <div className={`modal-card${className ? ` ${className}` : ''}`} {...dialog.dialogProps}>
        <div className="modal-header">
          <span className="modal-title" id={dialog.titleId}>{title}</span>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Schließen"
            data-dialog-dismiss
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
