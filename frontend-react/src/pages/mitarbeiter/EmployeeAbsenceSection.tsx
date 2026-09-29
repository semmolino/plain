import { useState } from 'react'
import { ListLoading } from '@/components/ui/Skeleton'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/store/toastStore'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { useConfirm } from '@/hooks/useConfirm'
import { usePermission } from '@/store/permissionsStore'
import { ClarificationThread } from '@/components/mitarbeiter/MyAbsencesPanel'
import { fetchAbsenceTypes, fetchAbsences, fetchVacationBalance, fetchEntitlements, putEntitlement, createAbsence, decideAbsence, clarifyAbsence, cancelAbsence, deleteAbsence, type Absence, type AbsenceStatus } from '@/api/abwesenheit'
import { fmtDateShort } from '@/pages/mitarbeiter/mitarbeiterFormat'

// ── Abwesenheits-Sektion (Mitarbeiterseite) ──────────────────────────────────

export function AbsenceStatusBadge({ status }: { status: AbsenceStatus }) {
  const map: Record<AbsenceStatus, { label: string; bg: string; color: string }> = {
    REQUESTED: { label: 'Beantragt',  bg: 'var(--warning-bg)', color: 'var(--warning-strong)' },
    APPROVED:  { label: 'Genehmigt',  bg: 'var(--success-bg)', color: 'var(--success-strong)' },
    REJECTED:  { label: 'Abgelehnt',  bg: 'var(--danger-bg)', color: 'var(--danger-strong)' },
    CANCELLED: { label: 'Storniert',  bg: 'var(--surface-2)', color: 'var(--text-3)' },
  }
  const s = map[status]
  return <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>{s.label}</span>
}

// Rückfrage-Modal (Genehmiger) — Antrag bleibt offen, Antragsteller wird benachrichtigt.
export function ClarifyModal({ absenceId, onClose, onDone }: { absenceId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const mut = useMutation({
    mutationFn: () => clarifyAbsence(absenceId, note.trim()),
    onSuccess: () => { toast.success('Rückfrage gesendet'); onDone() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Modal open onClose={onClose} title="Rückfrage zum Antrag">
      <div className="master-form">
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 8px' }}>
          Der Antrag bleibt offen. Der Antragsteller wird benachrichtigt und kann seinen Antrag anpassen.
        </p>
        <div className="form-group">
          <label>Rückfrage / Notiz</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            placeholder="Was soll geklärt werden?" style={{ width: '100%', resize: 'vertical' }} />
        </div>
        <DialogFooter>
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" disabled={!note.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? 'Sendet …' : 'Rückfrage senden'}
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}

export function EmployeeAbsenceSection({ employeeId }: { employeeId: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const canManage  = usePermission('absence.manage')
  const canApprove = usePermission('absence.approve')
  const [confirm, confirmDialog] = useConfirm()
  const year = new Date().getFullYear()

  const { data: typesRes }            = useQuery({ queryKey: ['absence-types'],                queryFn: fetchAbsenceTypes })
  const { data: absRes, isLoading }   = useQuery({ queryKey: ['absences', employeeId],         queryFn: () => fetchAbsences({ employee_id: employeeId }) })
  const { data: balRes }              = useQuery({ queryKey: ['vacation-balance', employeeId, year], queryFn: () => fetchVacationBalance(employeeId, year) })
  const { data: entRes }              = useQuery({ queryKey: ['entitlements', employeeId, year],     queryFn: () => fetchEntitlements(employeeId, year), enabled: canManage })

  const types     = (typesRes?.data ?? []).filter(t => t.ACTIVE)
  const absences  = absRes?.data ?? []
  const bal       = balRes?.data
  const entThisYear = (entRes?.data ?? []).find(e => e.YEAR === year)

  const [editEnt, setEditEnt] = useState(false)
  const [entDays,  setEntDays]  = useState('')
  const [entCarry, setEntCarry] = useState('')
  function openEntEditor() {
    setEntDays(entThisYear ? String(entThisYear.DAYS_ENTITLED) : (bal ? String(bal.entitled) : '0'))
    setEntCarry(entThisYear?.CARRYOVER_OVERRIDE != null ? String(entThisYear.CARRYOVER_OVERRIDE) : '')
    setEditEnt(true)
  }
  const entMut = useMutation({
    mutationFn: () => {
      // Vorher wurde „abc" oder ein leeres Feld still zu 0 Tagen.
      const days = Number(entDays.trim().replace(',', '.'))
      if (!entDays.trim() || !Number.isFinite(days) || days < 0 || days > 366) {
        return Promise.reject(new Error('Bitte einen Anspruch zwischen 0 und 366 Tagen angeben.'))
      }
      return putEntitlement({
      employee_id: employeeId, year,
      days_entitled: days,
      carryover_override: entCarry.trim() === '' ? null : Number(entCarry.replace(',', '.')),
      })
    },
    onSuccess: () => {
      toast.success('Urlaubsanspruch gespeichert'); setEditEnt(false)
      void qc.invalidateQueries({ queryKey: ['entitlements', employeeId] })
      void qc.invalidateQueries({ queryKey: ['vacation-balance', employeeId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [showForm, setShowForm] = useState(false)
  const [fType, setFType] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo,   setFTo]   = useState('')
  const [fHalf, setFHalf] = useState(false)
  const [fNote, setFNote] = useState('')
  const [clarifyId, setClarifyId] = useState<number | null>(null)

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['absences', employeeId] })
    void qc.invalidateQueries({ queryKey: ['vacation-balance', employeeId] })
  }

  const createMut = useMutation({
    mutationFn: () => createAbsence({
      employee_id: employeeId, absence_type_id: Number(fType),
      date_from: fFrom, date_to: fTo || fFrom, half_day: fHalf && (!fTo || fTo === fFrom), note: fNote,
    }),
    onSuccess: () => { toast.success('Abwesenheit erfasst'); setShowForm(false); setFType(''); setFFrom(''); setFTo(''); setFHalf(false); setFNote(''); invalidate() },
    onError: (e: Error) => toast.error(e.message),
  })
  const decideMut = useMutation({
    mutationFn: (v: { id: number; decision: 'APPROVED' | 'REJECTED' }) => decideAbsence(v.id, v.decision),
    onSuccess: () => { toast.success('Entscheidung gespeichert'); invalidate() },
    onError: (e: Error) => toast.error(e.message),
  })
  const cancelMut = useMutation({ mutationFn: (id: number) => cancelAbsence(id), onSuccess: () => { toast.success('Storniert'); invalidate() }, onError: (e: Error) => toast.error(e.message) })
  const deleteMut = useMutation({ mutationFn: (id: number) => deleteAbsence(id), onSuccess: () => { toast.success('Gelöscht'); invalidate() }, onError: (e: Error) => toast.error(e.message) })

  const singleDay = !!fFrom && (!fTo || fTo === fFrom)
  const stat = (label: string, value: string, color?: string) => (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 16, color: color ?? 'inherit' }}>{value}</div>
    </div>
  )

  return (
    <div>
      {/* Urlaubssaldo */}
      <div style={{ display: 'flex', gap: 18, background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 16px', marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {stat('Anspruch', bal ? `${bal.entitled} T` : '…')}
        {stat('Übertrag', bal ? `${bal.carryover} T` : '…')}
        {stat('Genommen', bal ? `${bal.taken} T` : '…')}
        {bal && !!bal.forfeited && bal.forfeited > 0 && stat('Verfallen', `${bal.forfeited} T`, 'var(--danger)')}
        {stat('Resturlaub', bal ? `${bal.remaining} T` : '…', bal && bal.remaining < 0 ? 'var(--danger)' : 'var(--success)')}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)', textAlign: 'right' }}>
          Urlaub {year} ({bal?.carryoverExpires ? `Übertrag verfällt ${bal.carryoverExpiryLabel ?? '31.03.'}` : 'Übertrag automatisch'})
          {bal && !!bal.atRisk && bal.atRisk > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', color: 'var(--warning)', marginTop: 2 }}>
              <AlertTriangle size={12} strokeWidth={2} /> {bal.atRisk} T Übertrag verfallen am {bal.carryoverExpiryLabel ?? '31.03.'}
            </span>
          )}
        </span>
      </div>

      {canManage && !editEnt && (
        <button type="button" className="btn-small" style={{ marginBottom: 14 }} onClick={openEntEditor}>
          Urlaubsanspruch {year} bearbeiten
        </button>
      )}
      {canManage && editEnt && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 14 }}>
          <div className="form-row">
            <div className="form-group">
              <label>Anspruch {year} (Tage)</label>
              <input type="number" step="0.5" min="0" value={entDays} onChange={e => setEntDays(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Übertrag manuell (optional)</label>
              <input type="number" step="0.5" value={entCarry} onChange={e => setEntCarry(e.target.value)} placeholder="automatisch" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-small btn-save" disabled={entMut.isPending} onClick={() => entMut.mutate()}>
              {entMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" className="btn-small" onClick={() => setEditEnt(false)}>Abbrechen</button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
            Übertrag leer lassen = automatisch aus dem Resturlaub des Vorjahres.
          </p>
        </div>
      )}

      {canManage && (
        <div style={{ marginBottom: 12 }}>
          {!showForm
            ? <button type="button" className="btn-small btn-save" onClick={() => setShowForm(true)}>+ Abwesenheit erfassen</button>
            : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Art</label>
                    <select value={fType} onChange={e => setFType(e.target.value)}>
                      <option value="">Bitte wählen …</option>
                      {types.map(t => <option key={t.ID} value={t.ID}>{t.NAME}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Von</label>
                    <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Bis</label>
                    <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} />
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: singleDay ? 'var(--text-2)' : 'var(--text-4)', margin: '4px 0 8px' }}>
                  <input type="checkbox" checked={fHalf} disabled={!singleDay} onChange={e => setFHalf(e.target.checked)} />
                  Halber Tag (nur bei eintägiger Abwesenheit)
                </label>
                <div className="form-group">
                  <label>Notiz</label>
                  <input type="text" value={fNote} onChange={e => setFNote(e.target.value)} placeholder="optional" />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn-small btn-save" disabled={!fType || !fFrom || createMut.isPending}
                    onClick={() => createMut.mutate()}>{createMut.isPending ? 'Speichert …' : 'Speichern'}</button>
                  <button type="button" className="btn-small" onClick={() => setShowForm(false)}>Abbrechen</button>
                </div>
              </div>
            )}
        </div>
      )}

      {isLoading && <ListLoading columns={6} />}
      {!isLoading && absences.length === 0 && <p className="empty-note">Noch keine Abwesenheiten erfasst.</p>}

      {absences.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)', fontSize: 12 }}>
              <th scope="col" style={{ textAlign: 'left', padding: '3px 8px 4px 0' }}>Zeitraum</th>
              <th scope="col" style={{ textAlign: 'left', padding: '3px 8px 4px 0' }}>Art</th>
              <th scope="col" style={{ textAlign: 'right', padding: '3px 8px 4px 0' }}>Tage</th>
              <th scope="col" style={{ textAlign: 'left', padding: '3px 8px 4px 0' }}>Status</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {absences.map((a: Absence) => (
              <tr key={a.ID} style={{ borderBottom: '1px solid var(--border-3)' }}>
                <td style={{ padding: '5px 8px 5px 0', whiteSpace: 'nowrap' }}>
                  {fmtDateShort(a.DATE_FROM)}{a.DATE_TO !== a.DATE_FROM ? `–${fmtDateShort(a.DATE_TO)}` : ''}
                  {a.HALF_DAY && <span style={{ color: 'var(--text-3)' }}> (½)</span>}
                </td>
                <td style={{ padding: '5px 8px 5px 0' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: a.TYPE_COLOR || 'var(--text-4)', marginRight: 6 }} />
                  {a.TYPE_NAME || '—'}
                </td>
                <td style={{ padding: '5px 8px 5px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.DAYS}</td>
                <td style={{ padding: '5px 8px 5px 0' }}>
                  <AbsenceStatusBadge status={a.STATUS} />
                  <ClarificationThread a={a} />
                </td>
                <td style={{ padding: '5px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {canApprove && a.STATUS === 'REQUESTED' && (
                    <>
                      <button type="button" className="btn-small btn-save" style={{ padding: '1px 8px', fontSize: 11, marginRight: 4 }}
                        disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: a.ID, decision: 'APPROVED' })}>Genehmigen</button>
                      <button type="button" className="btn-small" style={{ padding: '1px 8px', fontSize: 11, marginRight: 4 }}
                        disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: a.ID, decision: 'REJECTED' })}>Ablehnen</button>
                      <button type="button" className="btn-small" style={{ padding: '1px 8px', fontSize: 11, marginRight: 4 }}
                        onClick={() => setClarifyId(a.ID)}>Rückfrage</button>
                    </>
                  )}
                  {canManage && a.STATUS === 'APPROVED' && (
                    <button type="button" className="btn-small" style={{ padding: '1px 8px', fontSize: 11, marginRight: 4 }}
                      disabled={cancelMut.isPending}
                      onClick={async () => {
                        if (await confirm({ title: 'Abwesenheit stornieren?', message: `Die genehmigte Abwesenheit ${fmtDateShort(a.DATE_FROM)}–${fmtDateShort(a.DATE_TO)} wird storniert; Urlaubssaldo und Zeitkonto rechnen ohne sie.`, confirmLabel: 'Stornieren' })) cancelMut.mutate(a.ID)
                      }}>Stornieren</button>
                  )}
                  {canManage && (
                    <button type="button" className="row-action-btn row-action-btn--danger" title="Löschen" aria-label="Abwesenheit löschen"
                      disabled={deleteMut.isPending}
                      onClick={async () => {
                        if (await confirm({ title: 'Abwesenheit löschen?', message: `Der Eintrag ${fmtDateShort(a.DATE_FROM)}–${fmtDateShort(a.DATE_TO)} wird endgültig gelöscht — anders als „Stornieren" bleibt keine Spur.`, confirmLabel: 'Löschen' })) deleteMut.mutate(a.ID)
                      }}>
                      <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {clarifyId != null && (
        <ClarifyModal absenceId={clarifyId} onClose={() => setClarifyId(null)}
          onDone={() => { setClarifyId(null); invalidate() }} />
      )}
      {confirmDialog}
    </div>
  )
}
