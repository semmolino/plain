import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2, AlertTriangle } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { changePassword } from '@/api/auth'
import { uploadAsset } from '@/api/stammdaten'
import { fetchMyAvatar, putMyAvatar, deleteMyAvatar } from '@/api/mitarbeiter'
import { AchievementsSection } from '@/components/engagement/AchievementsSection'
import { MasterySection }      from '@/components/engagement/MasterySection'
import { usePermission }       from '@/store/permissionsStore'
import { useToast }            from '@/store/toastStore'
import {
  fetchAbsenceTypes, fetchAbsences, fetchVacationBalance,
  createAbsence, cancelAbsence, deleteAbsence,
  type Absence, type AbsenceStatus,
} from '@/api/abwesenheit'

export function ProfilePage() {
  const navigate   = useNavigate()
  const email      = useAuthStore(s => s.email)
  const shortName  = useAuthStore(s => s.shortName)

  const [currentPw,  setCurrentPw]  = useState('')
  const [newPw,      setNewPw]      = useState('')
  const [confirmPw,  setConfirmPw]  = useState('')
  const [saving,     setSaving]     = useState(false)
  const [success,    setSuccess]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (newPw !== confirmPw) {
      setError('Neue Passwörter stimmen nicht überein.')
      return
    }
    if (newPw.length < 8) {
      setError('Passwort muss mindestens 8 Zeichen haben.')
      return
    }

    setSaving(true)
    try {
      await changePassword(currentPw, newPw)
      setSuccess(true)
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Passwort konnte nicht geändert werden.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'transparent', border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: 6, padding: '4px 12px', fontSize: 12,
            cursor: 'pointer', color: 'rgba(17,24,39,0.6)',
          }}
        >
          ← Zurück
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Profil</h1>
      </div>

      {/* User info + Profilfoto */}
      <div style={{
        background: '#f9fafb', border: '1px solid #e5e7eb',
        borderRadius: 8, padding: '14px 18px', marginBottom: 24,
        display: 'flex', alignItems: 'center', gap: 18,
      }}>
        <ProfileAvatar shortName={shortName} email={email} />
        <div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>Angemeldet als</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{email}</div>
          {shortName && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Kürzel: {shortName}</div>}
        </div>
      </div>

      {/* Modul-Reife */}
      <MasterySection />

      {/* Achievements */}
      <AchievementsSection />

      {/* Meine Abwesenheiten (Self-Service) */}
      <MyAbsencesSection />

      {/* Password change form */}
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb',
        borderRadius: 8, padding: '18px 20px',
      }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Passwort ändern</div>

        {success && (
          <div style={{
            background: '#f0fdf4', border: '1px solid #86efac',
            borderRadius: 6, padding: '10px 14px', fontSize: 13,
            color: '#166534', marginBottom: 14,
          }}>
            Passwort erfolgreich geändert.
          </div>
        )}
        {error && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fca5a5',
            borderRadius: 6, padding: '10px 14px', fontSize: 13,
            color: '#991b1b', marginBottom: 14,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
              Aktuelles Passwort
            </label>
            <input
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
              Neues Passwort
            </label>
            <input
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              required
              minLength={8}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
              Neues Passwort bestätigen
            </label>
            <input
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              required
              style={inputStyle}
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            style={{
              marginTop: 4, padding: '8px 16px', fontSize: 13, fontWeight: 600,
              background: saving ? '#93c5fd' : '#2563eb', color: '#fff',
              border: 'none', borderRadius: 6, cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Speichern …' : 'Passwort ändern'}
          </button>
        </form>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '7px 10px', fontSize: 13,
  border: '1px solid #d1d5db', borderRadius: 6,
  outline: 'none',
}

export function initialsFrom(shortName: string | null, email: string | null): string {
  const src = (shortName || email || '').trim()
  if (!src) return '?'
  // Kürzel (z. B. "MM") direkt nutzen, sonst aus E-Mail die ersten 2 Zeichen.
  const cleaned = src.replace(/@.*$/, '')
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return cleaned.slice(0, 2).toUpperCase()
}

// ── Meine Abwesenheiten (Self-Service) ────────────────────────────────────────

function fmtDe(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const ABSENCE_STATUS: Record<AbsenceStatus, { label: string; bg: string; color: string }> = {
  REQUESTED: { label: 'Beantragt', bg: '#fef3c7', color: '#92400e' },
  APPROVED:  { label: 'Genehmigt', bg: '#dcfce7', color: '#166534' },
  REJECTED:  { label: 'Abgelehnt', bg: '#fee2e2', color: '#b91c1c' },
  CANCELLED: { label: 'Storniert', bg: '#f3f4f6', color: '#6b7280' },
}

function MyAbsencesSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const employeeId = useAuthStore(s => s.employeeId)
  const canRequest = usePermission('absence.request')
  const year = new Date().getFullYear()

  const { data: typesRes } = useQuery({ queryKey: ['absence-types'], queryFn: fetchAbsenceTypes, enabled: canRequest })
  const { data: balRes }   = useQuery({ queryKey: ['my-vacation-balance', year], queryFn: () => fetchVacationBalance(employeeId!, year), enabled: canRequest && employeeId != null })
  const { data: absRes, isLoading } = useQuery({ queryKey: ['my-absences'], queryFn: () => fetchAbsences({ employee_id: employeeId! }), enabled: canRequest && employeeId != null })

  const types     = (typesRes?.data ?? []).filter(t => t.ACTIVE)
  const bal       = balRes?.data
  const absences  = absRes?.data ?? []

  const [showForm, setShowForm] = useState(false)
  const [fType, setFType] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo,   setFTo]   = useState('')
  const [fHalf, setFHalf] = useState(false)
  const [fNote, setFNote] = useState('')
  const [msg,   setMsg]   = useState<string | null>(null)

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['my-absences'] })
    void qc.invalidateQueries({ queryKey: ['my-vacation-balance'] })
    void qc.invalidateQueries({ queryKey: ['absences-inbox'] })
  }
  const createMut = useMutation({
    mutationFn: () => createAbsence({ absence_type_id: Number(fType), date_from: fFrom, date_to: fTo || fFrom, half_day: fHalf && (!fTo || fTo === fFrom), note: fNote }),
    onSuccess: () => { toast.success('Antrag eingereicht'); setShowForm(false); setFType(''); setFFrom(''); setFTo(''); setFHalf(false); setFNote(''); setMsg(null); invalidate() },
    onError: (e: Error) => setMsg(e.message),
  })
  const withdrawMut = useMutation({ mutationFn: (id: number) => deleteAbsence(id), onSuccess: () => { toast.success('Antrag zurückgezogen'); invalidate() }, onError: (e: Error) => toast.error(e.message) })
  const cancelMut   = useMutation({ mutationFn: (id: number) => cancelAbsence(id), onSuccess: () => { toast.success('Storniert'); invalidate() }, onError: (e: Error) => toast.error(e.message) })

  if (!canRequest || employeeId == null) return null

  const singleDay = !!fFrom && (!fTo || fTo === fFrom)

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '18px 20px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          Meine Abwesenheiten
          {bal && <span style={{ fontWeight: 400, fontSize: 12, color: '#6b7280', marginLeft: 10 }}>Resturlaub {year}: <strong style={{ color: bal.remaining < 0 ? '#dc2626' : '#059669' }}>{bal.remaining} T</strong> (von {Math.round((bal.entitled + bal.carryover) * 10) / 10} T)</span>}
        </div>
        {!showForm && <button type="button" className="btn-small btn-save" onClick={() => { setMsg(null); setShowForm(true) }}>+ Antrag stellen</button>}
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
            <button type="button" className="btn-small btn-save" disabled={!fType || !fFrom || createMut.isPending} onClick={() => createMut.mutate()}>
              {createMut.isPending ? 'Sendet …' : 'Antrag einreichen'}
            </button>
            <button type="button" className="btn-small" onClick={() => setShowForm(false)}>Abbrechen</button>
          </div>
        </div>
      )}

      {isLoading && <p style={{ fontSize: 12, color: '#6b7280' }}>Laden …</p>}
      {!isLoading && absences.length === 0 && <p style={{ fontSize: 12, color: '#6b7280' }}>Noch keine Abwesenheiten.</p>}

      {absences.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {absences.map((a: Absence) => {
              const s = ABSENCE_STATUS[a.STATUS]
              return (
                <tr key={a.ID} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 8px 6px 0', whiteSpace: 'nowrap' }}>
                    {fmtDe(a.DATE_FROM)}{a.DATE_TO !== a.DATE_FROM ? `–${fmtDe(a.DATE_TO)}` : ''}{a.HALF_DAY ? ' (½)' : ''}
                  </td>
                  <td style={{ padding: '6px 8px 6px 0' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: a.TYPE_COLOR || '#9ca3af', marginRight: 6 }} />
                    {a.TYPE_NAME}
                  </td>
                  <td style={{ padding: '6px 8px 6px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#6b7280' }}>{a.DAYS} T</td>
                  <td style={{ padding: '6px 8px 6px 0' }}>
                    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>{s.label}</span>
                  </td>
                  <td style={{ padding: '6px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {a.STATUS === 'REQUESTED' && (
                      <button type="button" className="btn-small" style={{ padding: '1px 8px', fontSize: 11 }} disabled={withdrawMut.isPending} onClick={() => withdrawMut.mutate(a.ID)}>Zurückziehen</button>
                    )}
                    {a.STATUS === 'APPROVED' && (
                      <button type="button" className="btn-small" style={{ padding: '1px 8px', fontSize: 11 }} disabled={cancelMut.isPending} onClick={() => cancelMut.mutate(a.ID)}>Stornieren</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ProfileAvatar({ shortName, email }: { shortName: string | null; email: string | null }) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data } = useQuery({ queryKey: ['my-avatar'], queryFn: fetchMyAvatar, staleTime: 60_000 })
  const dataUri = data?.data?.data_uri ?? null

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['my-avatar'] })
    void qc.invalidateQueries({ queryKey: ['setup-progress'] })
  }

  const removeMut = useMutation({
    mutationFn: deleteMyAvatar,
    onSuccess: invalidate,
    onError: (e: Error) => setErr(e.message),
  })

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setErr(null); setBusy(true)
    try {
      const res = await uploadAsset(file, 'AVATAR')
      await putMyAvatar(res.data.ID)
      invalidate()
    } catch (uploadErr) {
      setErr(uploadErr instanceof Error ? uploadErr.message : 'Upload fehlgeschlagen')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: 72, height: 72, borderRadius: '50%', overflow: 'hidden',
          background: dataUri ? '#fff' : 'var(--accent-bg, #eff6ff)',
          color: 'var(--accent, #2563eb)',
          border: '1px solid var(--border, #e5e7eb)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, fontWeight: 700, flexShrink: 0,
        }}
      >
        {dataUri
          ? <img src={dataUri} alt="Profilfoto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span>{initialsFrom(shortName, email)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
          onChange={e => void handleFile(e)}
        />
        <button
          type="button" className="btn-small"
          onClick={() => inputRef.current?.click()} disabled={busy || removeMut.isPending}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <Camera size={13} strokeWidth={2} />
          {busy ? 'Lädt …' : dataUri ? 'Ändern' : 'Foto'}
        </button>
        {dataUri && (
          <button
            type="button" className="btn-small btn-danger"
            onClick={() => { setErr(null); removeMut.mutate() }} disabled={busy || removeMut.isPending}
            aria-label="Profilfoto entfernen"
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        )}
      </div>
      {err && <div style={{ fontSize: 11, color: '#b91c1c', maxWidth: 140, textAlign: 'center' }}>{err}</div>}
    </div>
  )
}
