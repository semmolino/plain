import { useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Message } from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'

/**
 * Handles both:
 *  - Password reset  (user clicked reset-link from email → urlFlowType === 'recovery')
 *  - Invite onboarding (invited user sets initial password → urlFlowType === 'invite')
 */
export function ResetPasswordPage() {
  const { supabase, urlFlowType } = useAuth()
  const navigate = useNavigate()

  const [pw1, setPw1]         = useState('')
  const [pw2, setPw2]         = useState('')
  const [msg, setMsg]         = useState<{ text: string; type: 'error' | 'info' | 'success' } | null>(null)
  const [loading, setLoading] = useState(false)

  const isInvite = urlFlowType === 'invite'
  const title    = isInvite ? 'Passwort festlegen' : 'Neues Passwort setzen'

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
    if (!supabase) return

    setLoading(true)
    setMsg({ text: 'Speichere …', type: 'info' })

    const { error } = await supabase.auth.updateUser({ password: pw1 })
    if (error) {
      setMsg({ text: error.message, type: 'error' })
      setLoading(false)
      return
    }

    setMsg({ text: 'Passwort gesetzt. Sie werden angemeldet …', type: 'success' })
    setTimeout(() => navigate('/'), 1500)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void handleSave()
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">PlaIn</div>
        <div className="auth-subtitle">Projektsteuerung</div>
        <h2 className="auth-title">{title}</h2>

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
          disabled={loading}
        >
          Passwort speichern
        </button>

        {msg && <Message text={msg.text} type={msg.type} />}
      </div>
    </div>
  )
}
