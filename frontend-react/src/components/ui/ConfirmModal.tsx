import { createPortal } from 'react-dom'
import { useBackdropClose } from '@/hooks/useBackdropClose'

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
  if (!open) return null
  return createPortal(
    <div className="modal-backdrop modal-backdrop--confirm" {...backdrop}>
      <div className="modal-card">
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onCancel} aria-label="Schließen">✕</button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}>{message}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel}>Abbrechen</button>
            <button type="button" className={confirmClass} onClick={() => { onConfirm(); onCancel() }}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
