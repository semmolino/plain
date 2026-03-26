import { useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Message } from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'

export function LoginPage() {
  const { supabase } = useAuth()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg]           = useState<{ text: string; type: 'error' | 'info' } | null>(null)
  const [loading, setLoading]   = useState(false)

  async function handleLogin() {
    if (!email || !password) {
      setMsg({ text: 'Bitte E-Mail und Passwort eingeben.', type: 'error' })
      return
    }
    if (!supabase) return

    setLoading(true)
    setMsg({ text: 'Anmelden …', type: 'info' })

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setMsg({ text: error.message, type: 'error' })
      setLoading(false)
    }
    // On success, AuthProvider's onAuthStateChange triggers navigation
  }

  async function handleForgotPassword() {
    if (!email) {
      setMsg({ text: 'Bitte zuerst E-Mail eingeben.', type: 'error' })
      return
    }
    if (!supabase) return

    const redirectTo = window.location.origin + '/'
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    setMsg({
      text: error ? error.message : 'Reset-Link wurde an Ihre E-Mail gesendet.',
      type: error ? 'error' : 'info',
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void handleLogin()
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">PlaIn</div>
        <div className="auth-subtitle">Projektsteuerung</div>
        <h2 className="auth-title">Anmelden</h2>

        <FormField
          label="E-Mail"
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <FormField
          label="Passwort"
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={onKeyDown}
        />

        <button
          className="btn-primary"
          onClick={() => void handleLogin()}
          disabled={loading}
        >
          Anmelden
        </button>

        {msg && <Message text={msg.text} type={msg.type} />}

        <div className="auth-links">
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); void handleForgotPassword() }}
          >
            Passwort vergessen?
          </a>
          <span className="auth-sep">·</span>
          <Link to="/signup">Konto erstellen</Link>
        </div>
      </div>
    </div>
  )
}
