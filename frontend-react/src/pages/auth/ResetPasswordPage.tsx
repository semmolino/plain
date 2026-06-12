import { useState, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { confirmPasswordReset } from '@/api/auth'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'
import { BrandWordmark } from '@/components/brand/BrandLogo'

export function ResetPasswordPage() {
  const navigate       = useNavigate()
  const [params]       = useSearchParams()
  const token          = params.get('token') ?? ''

  const [pw1, setPw1]         = useState('')
  const [pw2, setPw2]         = useState('')
  const [msg, setMsg]         = useState<{ text: string; type: 'error' | 'info' | 'success' } | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSave() {
    if (!pw1) {
      setMsg({ text: 'Bitte neues Passwort eingeben.', type: 'error' })
      return
    }
    if (pw1.length < 8) {
      setMsg({ text: 'Passwort muss mindestens 8 Zeichen haben.', type: 'error' })
      return
    }
    if (pw1 !== pw2) {
      setMsg({ text: 'Passwörter stimmen nicht überein.', type: 'error' })
      return
    }
    if (!token) {
      setMsg({ text: 'Ungültiger Link – kein Token gefunden.', type: 'error' })
      return
    }

    setLoading(true)
    setMsg({ text: 'Speichere …', type: 'info' })

    try {
      await confirmPasswordReset(token, pw1)
      setMsg({ text: 'Passwort gespeichert. Bitte anmelden.', type: 'success' })
      setTimeout(() => navigate('/login'), 1500)
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Fehler beim Speichern', type: 'error' })
      setLoading(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void handleSave()
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo"><BrandWordmark size={34} /></div>
        <div className="auth-subtitle">Projektsteuerung</div>
        <h2 className="auth-title">Neues Passwort setzen</h2>

        {!token && (
          <Message text="Ungültiger oder abgelaufener Link." type="error" />
        )}

        <FormField
          label="Neues Passwort"
          id="reset-password"
          type="password"
          autoComplete="new-password"
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
        />
        <FormField
          label="Passwort bestätigen"
          id="reset-password2"
          type="password"
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          onKeyDown={onKeyDown}
        />

        <button
          className="btn-primary"
          onClick={() => void handleSave()}
          disabled={loading || !token}
        >
          Passwort speichern
        </button>

        {msg && <Message text={msg.text} type={msg.type} />}
      </div>
    </div>
  )
}
