import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { useToast } from '@/store/toastStore'
import { clarifyAbsence, type Absence } from '@/api/abwesenheit'
import { employeeName, fmtAbsenceRange, fmtDays } from './absenceFormat'

/**
 * Genehmigen, ablehnen, nachfragen — für das Postfach und die
 * Mitarbeiterseite (UI-Pilot Runde 11).
 *
 * Vorher lehnte „Ablehnen" sofort und ohne Begründung ab; der Antragsteller
 * erfuhr nur, dass, nicht warum. Die Begründung war am Server längst
 * vorgesehen (`note`), die Oberfläche schickte sie nie.
 */

function Summary({ a }: { a: Absence }) {
  return (
    <p className="abs-decision-summary">
      <strong>{employeeName(a)}</strong> · {a.TYPE_NAME ?? 'Abwesenheit'} · {fmtAbsenceRange(a)} · {fmtDays(a.DAYS)}
    </p>
  )
}

export function RejectAbsenceDialog({ absence, onClose, onReject, pending }: {
  absence: Absence; onClose: () => void; onReject: (note: string) => void; pending: boolean
}) {
  const [note, setNote] = useState('')
  return (
    <Modal open onClose={onClose} title="Antrag ablehnen?">
      <div className="abs-dialog">
        <Summary a={absence} />
        <div className="form-group">
          <label htmlFor="abs-reject-note">Begründung (optional)</label>
          <textarea id="abs-reject-note" rows={3} value={note} onChange={e => setNote(e.target.value)}
            placeholder="z. B. ein anderer Zeitraum, der besser passt" />
        </div>
        <p className="abs-field-hint">Der Antragsteller bekommt die Ablehnung samt Begründung als Benachrichtigung. Soll nur etwas geklärt werden, ist „Rückfrage" der bessere Weg — der Antrag bleibt dabei offen.</p>
      </div>
      <DialogFooter>
        <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <button type="button" className="btn-danger" disabled={pending} onClick={() => onReject(note.trim())}>
          {pending ? 'Lehnt ab …' : 'Ablehnen'}
        </button>
      </DialogFooter>
    </Modal>
  )
}

// Rückfrage — der Antrag bleibt offen, der Antragsteller wird benachrichtigt.
export function ClarifyAbsenceDialog({ absence, onClose, onDone }: { absence: Absence; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const mut = useMutation({
    mutationFn: () => clarifyAbsence(absence.ID, note.trim()),
    onSuccess: () => { toast.success('Rückfrage gesendet.'); onDone() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Modal open onClose={onClose} title="Rückfrage zum Antrag">
      <div className="abs-dialog">
        <Summary a={absence} />
        <div className="form-group">
          <label htmlFor="abs-clarify-note">Rückfrage *</label>
          <textarea id="abs-clarify-note" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Was soll geklärt werden?" />
        </div>
        <p className="abs-field-hint">Der Antrag bleibt offen. Der Antragsteller wird benachrichtigt und kann antworten oder seinen Antrag anpassen.</p>
      </div>
      <DialogFooter>
        <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <button type="button" className="btn-primary" disabled={!note.trim() || mut.isPending} onClick={() => mut.mutate()}>
          {mut.isPending ? 'Sendet …' : 'Rückfrage senden'}
        </button>
      </DialogFooter>
    </Modal>
  )
}
