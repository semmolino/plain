import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { changePassword } from '@/api/auth'
import { AchievementsSection } from '@/components/engagement/AchievementsSection'

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

      {/* User info */}
      <div style={{
        background: '#f9fafb', border: '1px solid #e5e7eb',
        borderRadius: 8, padding: '14px 18px', marginBottom: 24,
      }}>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>Angemeldet als</div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{email}</div>
        {shortName && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Kürzel: {shortName}</div>}
      </div>

      {/* Achievements */}
      <AchievementsSection />

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
