import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { ListLoading } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { useConfirm } from '@/hooks/useConfirm'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { usePermission } from '@/store/permissionsStore'
import { useAuthStore } from '@/store/authStore'
import { useToast } from '@/store/toastStore'
import {
  fetchAbsences, fetchVacationBalance, fetchEntitlements, putEntitlement, cancelAbsence, deleteAbsence, type Absence,
} from '@/api/abwesenheit'
import { AbsenceDialog } from './AbsenceDialog'
import { ClarifyAbsenceDialog, RejectAbsenceDialog } from './AbsenceDecision'
import { useAbsenceDecision } from './useAbsenceDecision'
import { AbsenceStatusBadge, AbsenceType, ClarificationThread, VacationTiles } from './absenceUi'
import { fmtAbsenceRange, fmtDays } from './absenceFormat'

/**
 * Reiter „Abwesenheit" auf der Mitarbeiterseite (UI-Pilot Runde 11):
 * Urlaubssaldo, Anspruch des Jahres, Abwesenheiten mit Entscheidung.
 *
 * Vorher: ein Formularkasten mitten auf der Seite (ohne Vorschau der Tage),
 * „Ablehnen" ohne Begründung und ohne Rückfrage, ein Anspruchsfeld, das
 * „27,5" nicht annahm, und eine Tabelle aus Inline-Stilen, die am Handy aus
 * dem Bild lief.
 */

const parseDays = (v: string): number | null => {
  const t = v.trim()
  if (!t) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const daysText = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))

export function EmployeeAbsenceSection({ employeeId, employeeLabel }: { employeeId: number; employeeLabel?: string }) {
  const toast = useToast()
  const narrow = useIsNarrow()
  const myId = useAuthStore(s => s.employeeId)
  const canManage  = usePermission('absence.manage')
  const canApprove = usePermission('absence.approve')
  const [confirm, confirmDialog] = useConfirm()
  const year = new Date().getFullYear()

  const { data: absRes, isLoading } = useQuery({ queryKey: ['absences', employeeId], queryFn: () => fetchAbsences({ employee_id: employeeId }) })
  const { data: balRes } = useQuery({ queryKey: ['vacation-balance', employeeId, year], queryFn: () => fetchVacationBalance(employeeId, year) })
  const absences = absRes?.data ?? []

  const [recording, setRecording] = useState(false)
  const [entOpen, setEntOpen] = useState(false)
  const [rejecting, setRejecting] = useState<Absence | null>(null)
  const [clarifying, setClarifying] = useState<Absence | null>(null)
  const { decide, refresh } = useAbsenceDecision()

  const cancelMut = useMutation({ mutationFn: (id: number) => cancelAbsence(id), onSuccess: () => { toast.success('Abwesenheit storniert.'); refresh() }, onError: (e: Error) => toast.error(e.message) })
  const deleteMut = useMutation({ mutationFn: (id: number) => deleteAbsence(id), onSuccess: () => { toast.success('Abwesenheit gelöscht.'); refresh() }, onError: (e: Error) => toast.error(e.message) })

  const own = employeeId === myId
  const mayDecide = canApprove && (!own || canManage)

  async function cancel(a: Absence) {
    if (await confirm({ title: 'Abwesenheit stornieren?', message: `${a.TYPE_NAME ?? 'Die Abwesenheit'} ${fmtAbsenceRange(a)} wird storniert; Urlaubssaldo und Zeitkonto rechnen ohne sie.`, confirmLabel: 'Stornieren' })) cancelMut.mutate(a.ID)
  }
  async function remove(a: Absence) {
    if (await confirm({ title: 'Abwesenheit löschen?', message: `Der Eintrag ${a.TYPE_NAME ?? ''} ${fmtAbsenceRange(a)} wird endgültig gelöscht — anders als „Stornieren" bleibt keine Spur.`, confirmLabel: 'Löschen' })) deleteMut.mutate(a.ID)
  }

  const actions = (a: Absence) => (
    <div className="abs-actions">
      {mayDecide && a.STATUS === 'REQUESTED' && (
        <>
          <button type="button" className="btn-primary btn-small" disabled={decide.isPending} onClick={() => decide.mutate({ a, decision: 'APPROVED' })}>Genehmigen</button>
          <button type="button" className="btn-secondary btn-small" disabled={decide.isPending} onClick={() => setRejecting(a)}>Ablehnen</button>
          <button type="button" className="btn-secondary btn-small" onClick={() => setClarifying(a)}>Rückfrage</button>
        </>
      )}
      {canManage && a.STATUS === 'APPROVED' && (
        <button type="button" className="btn-secondary btn-small" disabled={cancelMut.isPending} onClick={() => void cancel(a)}>Stornieren</button>
      )}
      {canManage && (
        <button type="button" className="row-action-btn row-action-btn--danger" title="Löschen" aria-label={`Abwesenheit ${fmtAbsenceRange(a)} löschen`}
          disabled={deleteMut.isPending} onClick={() => void remove(a)}>
          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  )

  let list: ReactNode
  if (isLoading) list = <ListLoading columns={5} />
  else if (!absences.length) list = (
    <div className="empty-block">
      <p className="empty-note">Noch keine Abwesenheiten.</p>
      <p className="empty-block-why">Anträge, die der Mitarbeiter selbst stellt, erscheinen hier und im Postfach unter Abwesenheiten. {canManage ? 'Krankheit oder nachträglich gemeldeten Urlaub tragen Sie mit „Abwesenheit erfassen" direkt ein.' : ''}</p>
    </div>
  )
  else if (narrow) list = (
    <ul className="abs-cards">
      {absences.map(a => (
        <li key={a.ID} className="abs-card">
          <div className="abs-card-top">
            <div className="abs-card-main">
              <span className="abs-card-range">{fmtAbsenceRange(a)}</span>
              <span className="abs-card-sub"><AbsenceType a={a} /> · {fmtDays(a.DAYS)}{a.NOTE ? ` · ${a.NOTE}` : ''}</span>
            </div>
            <AbsenceStatusBadge status={a.STATUS} />
          </div>
          <ClarificationThread a={a} />
          <div className="abs-card-actions">{actions(a)}</div>
        </li>
      ))}
    </ul>
  )
  else list = (
    <div className="table-scroll">
      <table className="master-table abs-table">
        <thead><tr>
          <th scope="col">Zeitraum</th>
          <th scope="col">Art</th>
          <th scope="col" className="num">Tage</th>
          <th scope="col">Status</th>
          <th scope="col">Notiz</th>
          <th scope="col"><span className="sr-only">Aktionen</span></th>
        </tr></thead>
        <tbody>
          {absences.map(a => (
            <tr key={a.ID}>
              <td className="cell-nowrap">{fmtAbsenceRange(a)}</td>
              <td><AbsenceType a={a} /></td>
              <td className="num">{String(a.DAYS).replace('.', ',')}</td>
              <td><AbsenceStatusBadge status={a.STATUS} /></td>
              <td className="abs-note-cell">{a.NOTE || <span className="ma-none">—</span>}<ClarificationThread a={a} /></td>
              <td className="abs-actions-cell">{actions(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div>
      <div className="abs-head">
        <h2 className="abs-h">Urlaub {year}</h2>
        {canManage && (
          <>
            <button type="button" className="btn-secondary btn-small" onClick={() => setEntOpen(true)}>Anspruch {year} ändern</button>
            <button type="button" className="btn-primary btn-small abs-head-action" onClick={() => setRecording(true)}>
              <Plus size={14} strokeWidth={2.25} aria-hidden="true" /> Abwesenheit erfassen
            </button>
          </>
        )}
      </div>
      <VacationTiles bal={balRes?.data} year={year} />
      {list}

      <AbsenceDialog open={recording} onClose={() => setRecording(false)} mode="record" employeeId={employeeId} employeeLabel={employeeLabel} />
      {entOpen && <EntitlementDialog employeeId={employeeId} year={year} onClose={() => setEntOpen(false)} fallback={balRes?.data?.entitled} />}
      {rejecting && (
        <RejectAbsenceDialog absence={rejecting} pending={decide.isPending} onClose={() => setRejecting(null)}
          onReject={note => decide.mutate({ a: rejecting, decision: 'REJECTED', note: note || undefined }, { onSuccess: () => setRejecting(null) })} />
      )}
      {clarifying && <ClarifyAbsenceDialog absence={clarifying} onClose={() => setClarifying(null)} onDone={() => { setClarifying(null); refresh() }} />}
      {confirmDialog}
    </div>
  )
}

function EntitlementDialog({ employeeId, year, onClose, fallback }: { employeeId: number; year: number; onClose: () => void; fallback?: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['entitlements', employeeId, year], queryFn: () => fetchEntitlements(employeeId, year) })
  const ent = (data?.data ?? []).find(e => e.YEAR === year)
  const [days, setDays] = useState<string | null>(null)
  const [carry, setCarry] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const d = days ?? daysText(ent ? ent.DAYS_ENTITLED : fallback)
  const c = carry ?? daysText(ent?.CARRYOVER_OVERRIDE)
  const dn = parseDays(d), cn = parseDays(c)
  const badDays = dn == null || Number.isNaN(dn) || dn < 0 || dn > 366
  const badCarry = Number.isNaN(cn as number)

  const mut = useMutation({
    mutationFn: () => putEntitlement({ employee_id: employeeId, year, days_entitled: dn as number, carryover_override: cn }),
    onSuccess: () => {
      toast.success(`Urlaubsanspruch ${year} gespeichert.`)
      void qc.invalidateQueries({ queryKey: ['entitlements'] })
      void qc.invalidateQueries({ queryKey: ['entitlements-all'] })
      void qc.invalidateQueries({ queryKey: ['vacation-balance'] })
      void qc.invalidateQueries({ queryKey: ['my-vacation-balance'] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  function save() {
    setTried(true)
    if (badDays || badCarry) return
    mut.mutate()
  }
  return (
    <Modal open onClose={onClose} title={`Urlaubsanspruch ${year}`}>
      <div className="abs-dialog">
        {isLoading ? <ListLoading columns={2} /> : (
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="ent-days">Anspruch (Tage) *</label>
              <input id="ent-days" type="text" inputMode="decimal" value={d} onChange={e => setDays(e.target.value)} aria-invalid={tried && badDays ? true : undefined} />
            </div>
            <div className="form-group">
              <label htmlFor="ent-carry">Übertrag aus {year - 1}</label>
              <input id="ent-carry" type="text" inputMode="decimal" value={c} onChange={e => setCarry(e.target.value)} placeholder="automatisch" aria-invalid={tried && badCarry ? true : undefined} />
            </div>
          </div>
        )}
        <p className="abs-field-hint">Übertrag leer lassen = automatisch aus dem Resturlaub des Vorjahres. Alle Mitarbeiter auf einmal: Abwesenheiten → Urlaubsansprüche.</p>
        {tried && (badDays || badCarry) && <p className="abs-error" role="alert">Bitte einen Anspruch zwischen 0 und 366 Tagen angeben{badCarry ? ' und den Übertrag als Zahl' : ''}.</p>}
      </div>
      <DialogFooter>
        <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <button type="button" className="btn-primary" disabled={mut.isPending || isLoading} onClick={save}>{mut.isPending ? 'Speichert …' : 'Speichern'}</button>
      </DialogFooter>
    </Modal>
  )
}
