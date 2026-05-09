import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signup } from '@/api/auth'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'

export function SignupPage() {
  const navigate = useNavigate()
  const [company, setCompany]     = useState('')
  const [shortName, setShortName] = useState('')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [msg, setMsg]             = useState<{ text: string; type: 'error' | 'info' | 'success' } | null>(null)
  const [loading, setLoading]     = useState(false)

  async function handleSignup() {
    if (!company || !shortName || !email || !password) {
      setMsg({ text: 'Bitte alle Felder ausfüllen.', type: 'error' })
      return
    }
    if (password.length < 8) {
      setMsg({ text: 'Passwort muss mindestens 8 Zeichen haben.', type: 'error' })
      return
    }

    setLoading(true)
    setMsg({ text: 'Konto wird erstellt …', type: 'info' })

    try {
      await signup({ email, password, companyName: company, shortName })
      setMsg({ text: 'Konto erstellt. Bitte jetzt anmelden.', type: 'success' })
      setTimeout(() => navigate('/login'), 1500)
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Fehler beim Registrieren.', type: 'error' })
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">PlaIn</div>
        <div className="auth-subtitle">Projektsteuerung</div>
        <h2 className="auth-title">Konto erstellen</h2>

        <FormField
          label="Unternehmensname"
          id="signup-company"
          type="text"
          autoComplete="organization"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <FormField
          label="Kürzel"
          id="signup-short"
          type="text"
          autoComplete="off"
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
        />
        <FormField
          label="E-Mail"
          id="signup-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <FormField
          label="Passwort"
          id="signup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          className="btn-primary"
          onClick={() => void handleSignup()}
          disabled={loading}
        >
          Konto erstellen
        </button>

        {msg && <Message text={msg.text} type={msg.type} />}

        <div className="auth-links">
          <Link to="/login">Zurück zur Anmeldung</Link>
        </div>
      </div>
    </div>
  )
}
