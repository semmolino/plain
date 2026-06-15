import { useState, type FormEvent } from 'react'
import { api, ApiError, setToken } from '../api'

export function Login({ onSuccess }: { onSuccess: (email: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needTotp, setNeedTotp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.login(email.trim(), password, needTotp ? totp.trim() : undefined)
      setToken(res.token)
      onSuccess(res.email)
    } catch (err) {
      if (err instanceof ApiError && (err.payload as { totp_required?: boolean } | null)?.totp_required) {
        setNeedTotp(true)
        setError('Bitte den 2FA-Code aus deiner Authenticator-App eingeben.')
      } else {
        setError(err instanceof ApiError ? err.message : 'Anmeldung fehlgeschlagen.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="card" onSubmit={submit}>
        <div className="brand big">
          plan<span>&amp;</span>simple
        </div>
        <h1>Owner-Konsole</h1>
        <label>
          E-Mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {needTotp && (
          <label>
            2FA-Code
            <input
              inputMode="numeric"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              placeholder="123456"
              autoFocus
            />
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? '…' : 'Anmelden'}
        </button>
      </form>
    </div>
  )
}
