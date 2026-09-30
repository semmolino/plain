import { Pencil, FileText, Trash2, Folder, FileSignature } from 'lucide-react'
import { openHonorarPdf, type FeeCalcMaster } from '@/api/fee'

/**
 * Zeilenaktionen einer Kalkulation — dieselben in der Kalkulationsliste
 * (Projekte) und im Angebots-Reiter. Vorher stand dort je eine eigene Reihe:
 * hier Textknoepfe „Bearbeiten | Übersicht | → Struktur", dort Symbole ohne
 * Namen fuer Screenreader.
 */
export function KalkulationActions({ calc, canEdit, canDelete, deleting, onEdit, onDelete, onOpenProject, onOpenOffer }: {
  calc:           FeeCalcMaster
  canEdit:        boolean
  canDelete:      boolean
  deleting?:      boolean
  onEdit:         () => void
  onDelete:       () => void
  onOpenProject?: () => void
  onOpenOffer?:   () => void
}) {
  const name = calc.NAME || calc.ABBR || 'Kalkulation'
  return (
    <div className="doc-actions hw-actions">
      {canEdit && (
        <button type="button" className="row-action-btn" onClick={onEdit} title="Bearbeiten" aria-label={`${name} bearbeiten`}>
          <Pencil size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      <button type="button" className="row-action-btn" onClick={() => openHonorarPdf(calc.ID)}
        title="Übersicht (PDF)" aria-label={`Übersicht ${name} als PDF`}>
        <FileText size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {onOpenProject && (
        <button type="button" className="row-action-btn" onClick={onOpenProject} title="Zur Projektstruktur" aria-label={`Projektstruktur zu ${name}`}>
          <Folder size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      {onOpenOffer && (
        <button type="button" className="row-action-btn" onClick={onOpenOffer} title="Zum Angebot" aria-label={`Angebot zu ${name}`}>
          <FileSignature size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      {canDelete && (
        <button type="button" className="row-action-btn row-action-btn--danger" onClick={onDelete} disabled={deleting}
          title="Löschen" aria-label={`${name} löschen`}>
          <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
