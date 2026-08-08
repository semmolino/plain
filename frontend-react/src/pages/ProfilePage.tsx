import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 , ChevronLeft } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { changePassword } from '@/api/auth'
import { uploadAsset } from '@/api/stammdaten'
import { fetchMyAvatar, putMyAvatar, deleteMyAvatar } from '@/api/mitarbeiter'
import { AchievementsSection } from '@/components/engagement/AchievementsSection'
import { MasterySection }      from '@/components/engagement/MasterySection'

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
            background: 'transparent', border: '1px solid var(--border)',
            borderRadius: 6, padding: '4px 12px', fontSize: 12,
            cursor: 'pointer', color: 'var(--text-3)',
          }}
        ><ChevronLeft size={14} strokeWidth={2} />Zurück</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Profil</h1>
      </div>

      {/* User info + Profilfoto */}
      <div style={{
        background: 'var(--surface-3)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '14px 18px', marginBottom: 24,
        display: 'flex', alignItems: 'center', gap: 18,
      }}>
        <ProfileAvatar shortName={shortName} email={email} />
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 4 }}>Angemeldet als</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{email}</div>
          {shortName && <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>Kürzel: {shortName}</div>}
        </div>
      </div>

      {/* Modul-Reife */}
      <MasterySection />

      {/* Achievements */}
      <AchievementsSection />

      {/* Password change form */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '18px 20px',
      }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Passwort ändern</div>

        {success && (
          <div style={{
            background: 'var(--success-bg)', border: '1px solid var(--success)',
            borderRadius: 6, padding: '10px 14px', fontSize: 13,
            color: 'var(--success-strong)', marginBottom: 14,
          }}>
            Passwort erfolgreich geändert.
          </div>
        )}
        {error && (
          <div style={{
            background: 'var(--danger-bg)', border: '1px solid var(--danger)',
            borderRadius: 6, padding: '10px 14px', fontSize: 13,
            color: 'var(--danger-strong)', marginBottom: 14,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
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
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
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
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
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
  border: '1px solid var(--border)', borderRadius: 6,
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
          color: 'var(--accent)',
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
      {err && <div style={{ fontSize: 11, color: 'var(--danger-strong)', maxWidth: 140, textAlign: 'center' }}>{err}</div>}
    </div>
  )
}
