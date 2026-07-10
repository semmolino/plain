import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useToast } from '@/store/toastStore'
import { usePermission } from '@/store/permissionsStore'
import { useAuthStore } from '@/store/authStore'
import {
  fetchAbsenceTypes, fetchAbsences, fetchVacationBalance,
  createAbsence, updateAbsence, replyAbsence, cancelAbsence, deleteAbsence,
  type Absence, type AbsenceStatus, type ClarificationEntry,
} from '@/api/abwesenheit'

const STATUS: Record<AbsenceStatus, { label: string; bg: string; color: string }> = {
  REQUESTED: { label: 'Beantragt', bg: '#fef3c7', color: '#92400e' },
  APPROVED:  { label: 'Genehmigt', bg: '#dcfce7', color: '#166534' },
  REJECTED:  { label: 'Abgelehnt', bg: '#fee2e2', color: '#b91c1c' },
  CANCELLED: { label: 'Storniert', bg: '#f3f4f6', color: '#6b7280' },
}

const fmtDe = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

// Konversationsverlauf (Rückfragen/Antworten). Fällt auf DECISION_NOTE zurück,
// wenn (noch) kein Log vorhanden ist (Alt-Daten / vor Migration 0101).
export function ClarificationThread({ a }: { a: Absence }) {
  const log: ClarificationEntry[] = Array.isArray(a.CLARIFICATION_LOG) ? a.CLARIFICATION_LOG : []
  if (log.length === 0 && a.DECISION_NOTE) {
    return <div style={{ fontSize: 12, color: '#b45309', marginTop: 4 }}>Rückfrage: {a.DECISION_NOTE}</div>
  }
  if (log.length === 0) return null
  return (
    <div style={{ marginTop: 6, borderLeft: '2px solid #e5e7eb', paddingLeft: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {log.map((e, i) => (
        <div key={i} style={{ fontSize: 12 }}>
          <span style={{ fontWeight: 600, color: e.role === 'approver' ? '#b45309' : '#374151' }}>
            {e.role === 'approver' ? 'Rückfrage' : 'Antwort'}:
          </span>{' '}
          <span style={{ color: '#4b5563', whiteSpace: 'pre-line' }}>{e.text}</span>
        </div>
      ))}
    </div>
  )
}

// Prüft, ob die letzte Rückfrage noch unbeantwortet ist (Antwort-Button anzeigen).
function needsReply(a: Absence): boolean {
  const log: ClarificationEntry[] = Array.isArray(a.CLARIFICATION_LOG) ? a.CLARIFICATION_LOG : []
  if (log.length > 0) return log[log.length - 1].role === 'approver'
  return !!a.DECISION_NOTE // Alt-Daten: es gibt eine Rückfrage, aber noch keinen Log
}

/**
 * Self-Service-Panel „Meine Abwesenheiten": Resturlaub, Antrag stellen/bearbeiten,
 * auf Rückfragen antworten, offene Anträge zurückziehen, genehmigte stornieren.
 */
export function MyAbsencesPanel() {
  const qc = useQueryClient()
  const toast = useToast()
  const employeeId = useAuthStore(s => s.employeeId)
  const canRequest = usePermission('absence.request')
  const year = new Date().getFullYear()

  const { data: typesRes } = useQuery({ queryKey: ['absence-types'], queryFn: fetchAbsenceTypes, enabled: canRequest })
  const { data: balRes }   = useQuery({ queryKey: ['my-vacation-balance', year], queryFn: () => fetchVacationBalance(employeeId!, year), enabled: canRequest && employeeId != null })
  const { data: absRes, isLoading } = useQuery({ queryKey: ['my-absences'], queryFn: () => fetchAbsences({ employee_id: employeeId! }), enabled: canRequest && employeeId != null })

  const types    = (typesRes?.data ?? []).filter(t => t.ACTIVE)
  const bal      = balRes?.data
  const absences = absRes?.data ?? []

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [fType, setFType] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo,   setFTo]   = useState('')
  const [fHalf, setFHalf] = useState(false)
  const [fNote, setFNote] = useState('')
  const [msg,   setMsg]   = useState<string | null>(null)
  const [replyId, setReplyId] = useState<number | null>(null)
  const [replyText, setReplyText] = useState('')

  const resetForm = () => { setShowForm(false); setEditId(null); setFType(''); setFFrom(''); setFTo(''); setFHalf(false); setFNote(''); setMsg(null) }
  const openNew  = () => { resetForm(); setShowForm(true) }
  const openEdit = (a: Absence) => {
    setEditId(a.ID); setFType(String(a.ABSENCE_TYPE_ID)); setFFrom(a.DATE_FROM)
    setFTo(a.DATE_TO !== a.DATE_FROM ? a.DATE_TO : ''); setFHalf(a.HALF_DAY); setFNote(a.NOTE ?? '')
    setMsg(null); setShowForm(true)
  }

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['my-absences'] })
    void qc.invalidateQueries({ queryKey: ['my-vacation-balance'] })
    void qc.invalidateQueries({ queryKey: ['absences-inbox'] })
    void qc.invalidateQueries({ queryKey: ['absences'] })
  }
  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { absence_type_id: Number(fType), date_from: fFrom, date_to: fTo || fFrom, half_day: fHalf && (!fTo || fTo === fFrom), note: fNote }
      if (editId != null) await updateAbsence(editId, payload)
      else                await createAbsence(payload)
    },
    onSuccess: () => { toast.success(editId != null ? 'Antrag aktualisiert' : 'Antrag eingereicht'); resetForm(); invalidate() },
    onError: (e: Error) => setMsg(e.message),
  })
  const replyMut = useMutation({
    mutationFn: (id: number) => replyAbsence(id, replyText.trim()),
    onSuccess: () => { toast.success('Antwort gesendet'); setReplyId(null); setReplyText(''); invalidate() },
    onError: (e: Error) => toast.error(e.message),
  })
  const withdrawMut = useMutation({ mutationFn: (id: number) => deleteAbsence(id), onSuccess: () => { toast.success('Antrag zurückgezogen'); invalidate() }, onError: (e: Error) => toast.error(e.message) })
  const cancelMut   = useMutation({ mutationFn: (id: number) => cancelAbsence(id), onSuccess: () => { toast.success('Storniert'); invalidate() }, onError: (e: Error) => toast.error(e.message) })

  if (!canRequest || employeeId == null) {
    return <p className="empty-note">Für eigene Abwesenheitsanträge fehlt die Berechtigung.</p>
  }

  const singleDay = !!fFrom && (!fTo || fTo === fFrom)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          {bal && <>Resturlaub {year}: <strong style={{ color: bal.remaining < 0 ? '#dc2626' : '#059669' }}>{bal.remaining} T</strong> (von {Math.round((bal.entitled + bal.carryover) * 10) / 10} T)</>}
        </div>
        {!showForm && <button type="button" className="btn-small btn-save" onClick={openNew}>+ Antrag stellen</button>}
      </div>

      {bal && !!bal.atRisk && bal.atRisk > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px', marginBottom: 12 }}>
          <AlertTriangle size={14} strokeWidth={2} />
          {bal.atRisk} Tage Resturlaub-Übertrag verfallen am {bal.carryoverExpiryLabel ?? '31.03.'} — rechtzeitig einplanen.
        </div>
      )}

      {showForm && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, marginBottom: 12 }}>
          <div className="form-row">
            <div className="form-group">
              <label>Art</label>
              <select value={fType} onChange={e => setFType(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {types.map(t => <option key={t.ID} value={t.ID}>{t.NAME}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Von</label><input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} /></div>
            <div className="form-group"><label>Bis</label><input type="date" value={fTo} onChange={e => setFTo(e.target.value)} /></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: singleDay ? '#374151' : '#9ca3af', margin: '4px 0 8px' }}>
            <input type="checkbox" checked={fHalf} disabled={!singleDay} onChange={e => setFHalf(e.target.checked)} />
            Halber Tag (nur bei eintägiger Abwesenheit)
          </label>
          <div className="form-group"><label>Notiz</label><input type="text" value={fNote} onChange={e => setFNote(e.target.value)} placeholder="optional" /></div>
          {msg && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-small btn-save" disabled={!fType || !fFrom || saveMut.isPending} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? 'Speichert …' : (editId != null ? 'Änderungen speichern' : 'Antrag einreichen')}
            </button>
            <button type="button" className="btn-small" onClick={resetForm}>Abbrechen</button>
          </div>
        </div>
      )}

      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && absences.length === 0 && <p className="empty-note">Noch keine Abwesenheiten. Mit „+ Antrag stellen" den ersten Antrag einreichen.</p>}

      {absences.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {absences.map((a: Absence) => {
            const s = STATUS[a.STATUS]
            return (
              <div key={a.ID} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtDe(a.DATE_FROM)}{a.DATE_TO !== a.DATE_FROM ? `–${fmtDe(a.DATE_TO)}` : ''}{a.HALF_DAY ? ' (½)' : ''}
                  </span>
                  <span style={{ color: '#6b7280' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: a.TYPE_COLOR || '#9ca3af', marginRight: 6 }} />
                    {a.TYPE_NAME} · {a.DAYS} T
                  </span>
                  <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>{s.label}</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
                    {a.STATUS === 'REQUESTED' && needsReply(a) && (
                      <button type="button" className="btn-small btn-save" style={{ padding: '1px 8px', fontSize: 11 }}
                        onClick={() => { setReplyId(replyId === a.ID ? null : a.ID); setReplyText('') }}>Antworten</button>
                    )}
                    {a.STATUS === 'REQUESTED' && (
                      <>
                        <button type="button" className="btn-small" style={{ padding: '1px 8px', fontSize: 11 }} onClick={() => openEdit(a)}>Bearbeiten</button>
                        <button type="button" className="btn-small" style={{ padding: '1px 8px', fontSize: 11 }} disabled={withdrawMut.isPending} onClick={() => withdrawMut.mutate(a.ID)}>Zurückziehen</button>
                      </>
                    )}
                    {a.STATUS === 'APPROVED' && (
                      <button type="button" className="btn-small" style={{ padding: '1px 8px', fontSize: 11 }} disabled={cancelMut.isPending} onClick={() => cancelMut.mutate(a.ID)}>Stornieren</button>
                    )}
                  </span>
                </div>

                <ClarificationThread a={a} />

                {replyId === a.ID && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={2}
                      placeholder="Deine Antwort an den Genehmiger …" style={{ width: '100%', resize: 'vertical' }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn-small btn-save" style={{ fontSize: 11 }}
                        disabled={!replyText.trim() || replyMut.isPending} onClick={() => replyMut.mutate(a.ID)}>
                        {replyMut.isPending ? 'Sendet …' : 'Antwort senden'}
                      </button>
                      <button type="button" className="btn-small" style={{ fontSize: 11 }} onClick={() => { setReplyId(null); setReplyText('') }}>Abbrechen</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
