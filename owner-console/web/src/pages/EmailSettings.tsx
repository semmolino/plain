import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type PlatformEmailPayload } from '../api'

interface Props {
  adminEmail?: string
}

const EMPTY_FORM = {
  smtp_host: '',
  smtp_port: 465,
  smtp_secure: true,
  smtp_user: '',
  smtp_from: '',
  from_name: '',
}

export function EmailSettingsView({ adminEmail }: Props) {
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [passInput, setPassInput] = useState('')
  const [passSet, setPassSet] = useState(false)
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [testTo, setTestTo] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [testNotice, setTestNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.platformEmail()
      setForm({
        smtp_host: data.smtp_host,
        smtp_port: data.smtp_port || 465,
        smtp_secure: data.smtp_secure,
        smtp_user: data.smtp_user,
        smtp_from: data.smtp_from,
        from_name: data.from_name,
      })
      setPassSet(data.pass_set)
      setEncryptionAvailable(data.encryption_available)
      setPassInput('')
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!testTo && adminEmail) setTestTo(adminEmail)
  }, [adminEmail, testTo])

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const payload: PlatformEmailPayload = {
        smtp_host: form.smtp_host.trim(),
        smtp_port: form.smtp_port,
        smtp_secure: form.smtp_secure,
        smtp_user: form.smtp_user.trim(),
        smtp_from: form.smtp_from.trim(),
        from_name: form.from_name.trim(),
      }
      if (passInput) payload.smtp_pass = passInput
      await api.savePlatformEmail(payload)
      setNotice('Einstellungen gespeichert ✅ — wirkt sich mit bis zu 5 Minuten Verzögerung aus (Cache im Backend).')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    setTestBusy(true)
    setTestError(null)
    setTestNotice(null)
    try {
      await api.testPlatformEmail(testTo.trim())
      setTestNotice('Testnachricht versendet — bitte Posteingang prüfen.')
    } catch (e) {
      setTestError(e instanceof ApiError ? e.message : 'Testversand fehlgeschlagen.')
    } finally {
      setTestBusy(false)
    }
  }

  if (loading) return <div className="muted">Lädt…</div>

  const passPlaceholder = passSet ? '•••••••• (gespeichert, leer lassen = unverändert)' : 'SMTP-Passwort'

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>E-Mail (SMTP)</h2>
          <p className="muted">
            Zentrale SMTP-Konfiguration für den Mailversand der gesamten Plattform (z. B. Eusend). Verschlüsselt in
            der Datenbank gespeichert; ENV-Variablen (SMTP_*) dienen als Fallback, falls hier nichts hinterlegt ist.
          </p>
        </div>
      </div>

      {!encryptionAvailable && (
        <div className="warn">
          PLATFORM_ENC_KEY ist nicht (korrekt) gesetzt — das Passwort kann nicht sicher gespeichert werden. Bitte in
          Railway die Variable setzen: <code>openssl rand -base64 32</code>
        </div>
      )}
      {error && <div className="error">{error} <button className="link" onClick={() => setError(null)}>ausblenden</button></div>}
      {notice && <div className="ok-banner">{notice} <button className="link" onClick={() => setNotice(null)}>ok</button></div>}

      <section className="panel" style={{ marginBottom: 16 }}>
        <h3>SMTP-Zugangsdaten</h3>
        <div className="sec-inline" style={{ marginBottom: 10 }}>
          <label style={{ flex: 2, minWidth: 220 }}>
            Host
            <input
              className="list-search"
              style={{ maxWidth: 'none', width: '100%' }}
              placeholder="z. B. smtp.eusend.dev"
              value={form.smtp_host}
              onChange={(e) => setForm((f) => ({ ...f, smtp_host: e.target.value }))}
            />
          </label>
          <label style={{ width: 100 }}>
            Port
            <input
              className="list-search"
              style={{ maxWidth: 'none', width: '100%' }}
              type="number"
              min={1}
              max={65535}
              value={form.smtp_port}
              onChange={(e) => setForm((f) => ({ ...f, smtp_port: parseInt(e.target.value, 10) || 465 }))}
            />
          </label>
          <label className="check-inline" style={{ alignSelf: 'flex-end' }}>
            <input
              type="checkbox"
              checked={form.smtp_secure}
              onChange={(e) => setForm((f) => ({ ...f, smtp_secure: e.target.checked }))}
            />
            SSL/TLS (Port 465)
          </label>
        </div>
        <p className="muted small" style={{ marginTop: -4, marginBottom: 10 }}>
          Port 465 mit direktem TLS → Häkchen an. Port 587 mit STARTTLS → Häkchen aus.
        </p>

        <div className="sec-inline">
          <label style={{ flex: 1, minWidth: 200 }}>
            Benutzername
            <input
              className="list-search"
              style={{ maxWidth: 'none', width: '100%' }}
              autoComplete="off"
              value={form.smtp_user}
              onChange={(e) => setForm((f) => ({ ...f, smtp_user: e.target.value }))}
            />
          </label>
          <label style={{ flex: 1, minWidth: 200 }}>
            Passwort
            <input
              className="list-search"
              style={{ maxWidth: 'none', width: '100%' }}
              type="password"
              autoComplete="new-password"
              placeholder={passPlaceholder}
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h3>Absender</h3>
        <div className="sec-inline">
          <label style={{ flex: 1, minWidth: 220 }}>
            Absender-E-Mail
            <input
              className="list-search"
              style={{ maxWidth: 'none', width: '100%' }}
              type="email"
              placeholder="z. B. noreply@deine-domain.de"
              value={form.smtp_from}
              onChange={(e) => setForm((f) => ({ ...f, smtp_from: e.target.value }))}
            />
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>
            Absender-Name
            <input
              className="list-search"
              style={{ maxWidth: 'none', width: '100%' }}
              placeholder="z. B. plan&simple"
              value={form.from_name}
              onChange={(e) => setForm((f) => ({ ...f, from_name: e.target.value }))}
            />
          </label>
        </div>
      </section>

      <button className="primary small-btn" disabled={busy} onClick={() => void save()}>
        {busy ? 'Speichert …' : 'Speichern'}
      </button>

      <section className="panel" style={{ marginTop: 24 }}>
        <h3>Testnachricht senden</h3>
        <p className="muted small">Sendet eine Testmail mit den gespeicherten Einstellungen. Bitte vorher speichern.</p>
        {testError && <div className="error">{testError}</div>}
        {testNotice && <div className="ok-banner">{testNotice}</div>}
        <div className="sec-inline">
          <input
            className="list-search"
            style={{ maxWidth: 320 }}
            type="email"
            placeholder="empfaenger@example.com"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
          />
          <button className="small-btn" disabled={testBusy || !testTo.trim()} onClick={() => void sendTest()}>
            {testBusy ? 'Sendet …' : 'Test senden'}
          </button>
        </div>
      </section>
    </div>
  )
}
