import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBackdropClose } from '@/hooks/useBackdropClose'
import { useDialog } from '@/hooks/useDialog'
import { DialogFooter } from './DialogFooter'

interface Props {
  open:          boolean
  title:         string
  message:       string
  confirmLabel?: string
  confirmClass?: string
  onConfirm:     () => void
  onCancel:      () => void
}

export function ConfirmModal({
  open, title, message,
  confirmLabel = 'Bestätigen',
  confirmClass = 'btn-danger',
  onConfirm, onCancel,
}: Props) {
  const backdrop = useBackdropClose(onCancel)
  const dialog   = useDialog(open, onCancel)
  if (!open) return null
  return createPortal(
    <div className="modal-backdrop modal-backdrop--confirm" {...backdrop}>
      {/* aria-describedby verknuepft die Rueckfrage mit dem Dialog — sonst
          liest ein Screenreader nur den Titel vor, nicht das, was passiert. */}
      <div className="modal-card" {...dialog.dialogProps} aria-describedby={`${dialog.titleId}-msg`}>
        <div className="modal-header">
          <span className="modal-title" id={dialog.titleId}>{title}</span>
          <button className="modal-close" onClick={onCancel} aria-label="Schließen" data-dialog-dismiss>
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>
        <div className="modal-body">
          <p
            id={`${dialog.titleId}-msg`}
            style={{ marginBottom: 20, fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}
          >
            {message}
          </p>
          <DialogFooter>
            {/* Abbrechen zuerst im DOM: der Dialog fokussiert beim Oeffnen das
                erste Element — bei einer Loeschabfrage soll das die sichere
                Option sein, nicht der destruktive Button. */}
            <button type="button" className="btn-secondary" onClick={onCancel}>Abbrechen</button>
            <button type="button" className={confirmClass} onClick={() => { onConfirm(); onCancel() }}>
              {confirmLabel}
            </button>
          </DialogFooter>
        </div>
      </div>
    </div>,
    document.body,
  )
}
