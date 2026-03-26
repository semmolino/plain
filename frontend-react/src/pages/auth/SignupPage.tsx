import { useState } from 'react'
import { Link } from 'react-router-dom'
import { signup } from '@/api/auth'
import { useAuth } from '@/context/AuthContext'
import { Message } from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'

export function SignupPage() {
  const { supabase } = useAuth()
  const [company, setCompany]   = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg]           = useState<{ text: string; type: 'error' | 'info' | 'success' } | null>(null)
  const [loading, setLoading]   = useState(false)

  async function handleSignup() {
    if (!company || !email || !password) {
      setMsg({ text: 'Bitte alle Felder ausfüllen.', type: 'error' })
      return
    }
    if (password.length < 8) {
      setMsg({ text: 'Passwort muss mindestens 8 Zeichen haben.', type: 'error' })
      return
    }
    if (!supabase) return

    setLoading(true)
    setMsg({ text: 'Konto wird erstellt …', type: 'info' })

    try {
      await signup({ email, password, companyName: company })
      setMsg({ text: 'Konto erstellt. Melden Sie sich an …', type: 'success' })

      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setMsg({ text: 'Konto erstellt. Bitte jetzt anmelden.', type: 'success' })
      }
      // On success, AuthProvider's onAuthStateChange handles navigation
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
