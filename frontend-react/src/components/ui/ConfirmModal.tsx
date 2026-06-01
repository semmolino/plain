import { Modal } from './Modal'

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
  confirmLabel = 'Löschen',
  confirmClass = 'btn-danger',
  onConfirm, onCancel,
}: Props) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p style={{ marginBottom: 20, fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}>{message}</p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel}>Abbrechen</button>
        <button type="button" className={confirmClass} onClick={() => { onConfirm(); onCancel() }}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
