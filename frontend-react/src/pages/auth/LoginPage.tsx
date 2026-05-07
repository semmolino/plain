import { useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loginEmployee } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'

export function LoginPage() {
  const navigate  = useNavigate()
  const setAuth   = useAuthStore(s => s.setAuth)
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg]           = useState<{ text: string; type: 'error' | 'info' } | null>(null)
  const [loading, setLoading]   = useState(false)

  async function handleLogin() {
    if (!email || !password) {
      setMsg({ text: 'Bitte E-Mail und Passwort eingeben.', type: 'error' })
      return
    }

    setLoading(true)
    setMsg({ text: 'Anmelden …', type: 'info' })

    try {
      const res = await loginEmployee(email, password)
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
          <Link to="/signup">Konto erstellen</Link>
        </div>
      </div>
    </div>
  )
}
