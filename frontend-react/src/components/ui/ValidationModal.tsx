import { Modal } from './Modal'
import { AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react'
import type { ValidationResult } from '@/api/rechnungen'

interface Props {
  open:           boolean
  onClose:        () => void
  title?:         string
  result:         ValidationResult | null
  onForce?:       () => void          // optional: Notbuchung trotz Fehler
  onAcknowledge?: () => void          // bei nur Warnings: Buchung fortsetzen
  loading?:       boolean
}

export function ValidationModal({
  open, onClose, title = 'E-Rechnung Vorpruefung',
  result, onForce, onAcknowledge, loading,
}: Props) {
  if (!open) return null

  const hasErrors   = !!result && result.errors.length > 0
  const hasWarnings = !!result && result.warnings.length > 0
  const isClean     = !!result && !hasErrors && !hasWarnings

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {loading && <div className="page-loading">Pruefung lauft …</div>}

      {!loading && isClean && (
        <div className="validation-summary clean">
          <CheckCircle2 size={20} strokeWidth={2} />
          <span>Keine Probleme gefunden. Buchung kann erfolgen.</span>
        </div>
      )}

      {!loading && hasErrors && (
        <div className="validation-section">
          <h4 className="validation-heading error">
            <AlertCircle size={16} strokeWidth={2} /> Fehler ({result!.errors.length})
          </h4>
          <ul className="validation-list">
            {result!.errors.map((e, i) => (
              <li key={`e${i}`} className="validation-item error">
                <span className="validation-code">{e.code}{e.btField ? ` · ${e.btField}` : ''}</span>
                <span className="validation-msg">{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && hasWarnings && (
        <div className="validation-section">
          <h4 className="validation-heading warning">
            <AlertTriangle size={16} strokeWidth={2} /> Hinweise ({result!.warnings.length})
          </h4>
          <ul className="validation-list">
            {result!.warnings.map((w, i) => (
              <li key={`w${i}`} className="validation-item warning">
                <span className="validation-code">{w.code}{w.btField ? ` · ${w.btField}` : ''}</span>
                <span className="validation-msg">{w.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && (
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Schliessen</button>
          {!hasErrors && hasWarnings && onAcknowledge && (
            <button className="btn-primary" onClick={onAcknowledge}>
              Trotzdem buchen
            </button>
          )}
          {hasErrors && onForce && (
            <button className="btn-danger" onClick={onForce} title="Buchung trotz Fehlern erzwingen — nur in Ausnahmen!">
              Notbuchung (force)
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}
