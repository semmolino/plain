import { useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { loginEmployee, requestPasswordReset } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'

export function LoginPage() {
  const navigate  = useNavigate()
  const setAuth   = useAuthStore(s => s.setAuth)
  const qc        = useQueryClient()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg]           = useState<{ text: string; type: 'error' | 'info' | 'success' } | null>(null)
  const [loading, setLoading]   = useState(false)

  const [showReset,   setShowReset]   = useState(false)
  const [resetEmail,  setResetEmail]  = useState('')
  const [resetMsg,    setResetMsg]    = useState<{ text: string; type: 'error' | 'info' | 'success' } | null>(null)
  const [resetLoading, setResetLoading] = useState(false)

  async function handleLogin() {
    if (!email) {
      setMsg({ text: 'Bitte E-Mail eingeben.', type: 'error' })
      return
    }

    setLoading(true)
    setMsg({ text: 'Anmelden …', type: 'info' })

    try {
      const res = await loginEmployee(email, password)
      qc.clear()
      setAuth({
        token:       res.token,
        employeeId:  res.employee_id,
        tenantId:    res.tenant_id,
        shortName:   res.short_name,
        email:       res.email,
        companyName: res.company_name,
      })
      navigate('/')
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.', type: 'error' })
      setLoading(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void handleLogin()
  }

  async function handleResetRequest() {
    if (!resetEmail) {
      setResetMsg({ text: 'Bitte E-Mail eingeben.', type: 'error' })
      return
    }
    setResetLoading(true)
    setResetMsg({ text: 'Sende …', type: 'info' })
    try {
      await requestPasswordReset(resetEmail)
      setResetMsg({ text: 'Link wurde an Ihre E-Mail-Adresse gesendet.', type: 'success' })
    } catch (err) {
      setResetMsg({ text: err instanceof Error ? err.message : 'Fehler', type: 'error' })
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo">PlaIn</div>
        <div className="auth-subtitle">Projektsteuerung</div>

        {!showReset ? (
          <>
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
              <button
                className="auth-link-btn"
                type="button"
                onClick={() => { setShowReset(true); setResetMsg(null) }}
              >
                Passwort vergessen?
              </button>
              <Link to="/signup">Konto erstellen</Link>
            </div>
          </>
        ) : (
          <>
            <h2 className="auth-title">Passwort zurücksetzen</h2>

            <FormField
              label="E-Mail"
              id="reset-email"
              type="email"
              autoComplete="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
            />

            <button
              className="btn-primary"
              onClick={() => void handleResetRequest()}
              disabled={resetLoading}
            >
              {resetLoading ? 'Bitte warten …' : 'Link anfordern'}
            </button>

            {resetMsg && <Message text={resetMsg.text} type={resetMsg.type} />}

            <div className="auth-links">
              <button
                className="auth-link-btn"
                type="button"
                onClick={() => setShowReset(false)}
              >
                ← Zurück zur Anmeldung
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
