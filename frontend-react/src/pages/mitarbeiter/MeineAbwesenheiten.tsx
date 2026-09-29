import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useConfirm } from '@/hooks/useConfirm'
import { useToast } from '@/store/toastStore'
import { usePermission } from '@/store/permissionsStore'
import { useAuthStore } from '@/store/authStore'
import { ListLoading } from '@/components/ui/Skeleton'
import {
  fetchAbsences, fetchVacationBalance, replyAbsence, cancelAbsence, deleteAbsence, type Absence,
} from '@/api/abwesenheit'
import { todayLocal } from './mitarbeiterFormat'
import { AbsenceDialog } from './AbsenceDialog'
import { AbsenceStatusBadge, AbsenceType, ClarificationThread, VacationTiles } from './absenceUi'
import { fmtAbsenceRange, fmtDays, needsReply } from './absenceFormat'

/**
 * „Meine Anträge" (UI-Pilot Runde 11): Resturlaub, Antrag stellen und
 * bearbeiten, auf Rückfragen antworten, zurückziehen und stornieren.
 *
 * Vorher zogen „Zurückziehen" und „Stornieren" ohne Rückfrage durch, der
 * Resturlaub stand grün als „15.5 T", und eine Ablehnungsbegründung hieß
 * „Rückfrage". Offene und vergangene Anträge standen in einer Liste.
 *
 * @param focusAbsenceId Antrag aus einer Benachrichtigung (Deep-Link). Er wird
 *   hervorgehoben und in den sichtbaren Bereich gescrollt; steht eine Rückfrage
 *   offen, klappt das Antwortfeld gleich auf.
 */
export function MeineAbwesenheiten({ focusAbsenceId = null }: { focusAbsenceId?: number | null }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const employeeId = useAuthStore(s => s.employeeId)
  const canRequest = usePermission('absence.request')
  const year = new Date().getFullYear()
  const today = todayLocal()

  const { data: balRes } = useQuery({ queryKey: ['my-vacation-balance', year], queryFn: () => fetchVacationBalance(employeeId!, year), enabled: canRequest && employeeId != null })
  const { data: absRes, isLoading } = useQuery({ queryKey: ['my-absences'], queryFn: () => fetchAbsences({ employee_id: employeeId! }), enabled: canRequest && employeeId != null })
  const absences = useMemo(() => absRes?.data ?? [], [absRes])

  const [dialog, setDialog] = useState<{ absence: Absence | null } | null>(null)
  const [replyId, setReplyId] = useState<number | null>(null)
  const [replyText, setReplyText] = useState('')

  // Deep-Link: einmal je verlinktem Antrag hinscrollen und ggf. das Antwortfeld
  // oeffnen. Der Ref verhindert, dass ein spaeteres Schliessen des Feldes durch
  // ein Neu-Rendern wieder ueberschrieben wird.
  const focusRef = useRef<HTMLLIElement | null>(null)
  const handledFocusRef = useRef<number | null>(null)
  useEffect(() => {
    if (focusAbsenceId == null || handledFocusRef.current === focusAbsenceId) return
    const target = absences.find(a => a.ID === focusAbsenceId)
    if (!target) return
    handledFocusRef.current = focusAbsenceId
    if (target.STATUS === 'REQUESTED' && needsReply(target)) setReplyId(focusAbsenceId)
    focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusAbsenceId, absences])

  const invalidate = () => {
    for (const k of ['my-absences', 'my-vacation-balance', 'absences-inbox', 'absences', 'absences-calendar']) void qc.invalidateQueries({ queryKey: [k] })
  }
  const replyMut = useMutation({
    mutationFn: (id: number) => replyAbsence(id, replyText.trim()),
    onSuccess: () => { toast.success('Antwort gesendet.'); setReplyId(null); setReplyText(''); invalidate() },
    onError: (e: Error) => toast.error(e.message),
  })
  const withdrawMut = useMutation({ mutationFn: (id: number) => deleteAbsence(id), onSuccess: () => { toast.success('Antrag zurückgezogen.'); invalidate() }, onError: (e: Error) => toast.error(e.message) })
  const cancelMut   = useMutation({ mutationFn: (id: number) => cancelAbsence(id), onSuccess: () => { toast.success('Abwesenheit storniert.'); invalidate() }, onError: (e: Error) => toast.error(e.message) })

  if (!canRequest || employeeId == null) {
    return <p className="empty-note">Für eigene Abwesenheitsanträge fehlt das Recht „Abwesenheit beantragen".</p>
  }

  // Offen und geplant zuerst (aufsteigend — das Nächste oben), dann der Rest.
  const current = absences.filter(a => (a.STATUS === 'REQUESTED' || a.STATUS === 'APPROVED') && a.DATE_TO >= today)
    .sort((a, b) => a.DATE_FROM.localeCompare(b.DATE_FROM))
  const past = absences.filter(a => !current.includes(a))

  async function withdraw(a: Absence) {
    if (await confirm({ title: 'Antrag zurückziehen?', message: `Der Antrag ${a.TYPE_NAME ?? ''} ${fmtAbsenceRange(a)} wird gelöscht; die Genehmiger sehen ihn nicht mehr.`, confirmLabel: 'Zurückziehen' })) withdrawMut.mutate(a.ID)
  }
  async function cancel(a: Absence) {
    if (await confirm({ title: 'Abwesenheit stornieren?', message: `${a.TYPE_NAME ?? 'Die Abwesenheit'} ${fmtAbsenceRange(a)} ist genehmigt. Storniert zählt sie nicht mehr${a.REDUCES_VACATION ? ` — ${fmtDays(a.DAYS)} gehen zurück auf den Resturlaub` : ''}.`, confirmLabel: 'Stornieren' })) cancelMut.mutate(a.ID)
  }

  const card = (a: Absence) => {
    const focused = a.ID === focusAbsenceId
    // Begonnene Abwesenheiten storniert nur, wer Abwesenheiten verwaltet
    // (Server: /:id/cancel) — sonst liesse sich genommener Urlaub nachträglich zurückholen.
    const canCancel = a.STATUS === 'APPROVED' && a.DATE_FROM > today
    return (
      <li key={a.ID} ref={focused ? focusRef : undefined} className={`abs-card${focused ? ' abs-card--focus' : ''}`}>
        <div className="abs-card-top">
          <div className="abs-card-main">
            <span className="abs-card-range">{fmtAbsenceRange(a)}</span>
            <span className="abs-card-sub"><AbsenceType a={a} /> · {fmtDays(a.DAYS)}{a.NOTE ? ` · ${a.NOTE}` : ''}</span>
          </div>
          <AbsenceStatusBadge status={a.STATUS} />
        </div>
        <ClarificationThread a={a} />
        {(a.STATUS === 'REQUESTED' || canCancel) && (
          <div className="abs-card-actions">
            {a.STATUS === 'REQUESTED' && needsReply(a) && (
              <button type="button" className="btn-primary btn-small" aria-expanded={replyId === a.ID}
                onClick={() => { setReplyId(replyId === a.ID ? null : a.ID); setReplyText('') }}>Antworten</button>
            )}
            {a.STATUS === 'REQUESTED' && (
              <>
                <button type="button" className="btn-secondary btn-small" onClick={() => setDialog({ absence: a })}>Bearbeiten</button>
                <button type="button" className="btn-secondary btn-small" disabled={withdrawMut.isPending} onClick={() => void withdraw(a)}>Zurückziehen</button>
              </>
            )}
            {canCancel && (
              <button type="button" className="btn-secondary btn-small" disabled={cancelMut.isPending} onClick={() => void cancel(a)}>Stornieren</button>
            )}
          </div>
        )}
        {replyId === a.ID && (
          <div className="abs-reply">
            <label htmlFor={`abs-reply-${a.ID}`}>Antwort an die Genehmiger</label>
            <textarea id={`abs-reply-${a.ID}`} rows={2} value={replyText} onChange={e => setReplyText(e.target.value)} />
            <div className="abs-reply-actions">
              <button type="button" className="btn-secondary btn-small" onClick={() => { setReplyId(null); setReplyText('') }}>Abbrechen</button>
              <button type="button" className="btn-primary btn-small" disabled={!replyText.trim() || replyMut.isPending} onClick={() => replyMut.mutate(a.ID)}>
                {replyMut.isPending ? 'Sendet …' : 'Antwort senden'}
              </button>
            </div>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="abs-mine">
      <div className="abs-head">
        <h2 className="abs-h">Urlaub {year}</h2>
        <button type="button" className="btn-primary btn-small abs-head-action" onClick={() => setDialog({ absence: null })}>
          <Plus size={14} strokeWidth={2.25} aria-hidden="true" /> Abwesenheit beantragen
        </button>
      </div>
      <VacationTiles bal={balRes?.data} year={year} />

      {isLoading && <ListLoading columns={3} />}
      {!isLoading && absences.length === 0 && (
        <div className="empty-block">
          <p className="empty-note">Noch keine Abwesenheiten.</p>
          <p className="empty-block-why">Urlaub, Fortbildung oder andere Abwesenheiten hier beantragen — der Dialog zeigt vorher, wie viele Arbeitstage es sind und was vom Resturlaub bleibt. Genehmigte Tage rechnet das Zeitkonto als Soll-Zeit an.</p>
        </div>
      )}
      {current.length > 0 && (
        <section aria-labelledby="abs-cur-h">
          <h3 id="abs-cur-h" className="abs-h3">Offen und geplant</h3>
          <ul className="abs-cards">{current.map(card)}</ul>
        </section>
      )}
      {past.length > 0 && (
        <section aria-labelledby="abs-past-h">
          <h3 id="abs-past-h" className="abs-h3">Vergangen und entschieden</h3>
          <ul className="abs-cards">{past.map(card)}</ul>
        </section>
      )}

      <AbsenceDialog open={dialog != null} onClose={() => setDialog(null)} mode="request" absence={dialog?.absence ?? null} />
      {confirmDialog}
    </div>
  )
}
