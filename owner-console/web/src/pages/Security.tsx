import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api'

interface Props {
  onClose: () => void
  /** Nach „überall abmelden" bzw. 2FA-Aktivierung: Konsole abmelden. */
  onSessionInvalidated: () => void
}

type Sec = { totp_enabled: boolean; require_totp: boolean; last_login_at: string | null }

export function SecurityView({ onClose, onSessionInvalidated }: Props) {
  const [sec, setSec] = useState<Sec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Einrichtungsfluss
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null)
  const [code, setCode] = useState('')
  const [disableCode, setDisableCode] = useState('')

  const load = useCallback(async () => {
    try {
      const me = await api.me()
      setSec({
        totp_enabled: !!me.totp_enabled,
        require_totp: !!me.require_totp,
        last_login_at: me.last_login_at ?? null,
      })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function startSetup() {
    setBusy(true)
    setError(null)
    try {
      setSetup(await api.totpSetup())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Einrichtung fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await api.totpConfirm(code.trim())
      // Aktivierung beendet alle Sitzungen -> neu anmelden.
      setNotice('2FA aktiviert. Du wirst zur Neuanmeldung abgemeldet.')
      setTimeout(onSessionInvalidated, 1200)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bestätigung fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    try {
      await api.totpDisable(disableCode.trim())
      setDisableCode('')
      setNotice('2FA deaktiviert.')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function logoutAll() {
    if (!window.confirm('Alle Sitzungen dieses Kontos beenden? Du musst dich danach neu anmelden.')) return
    setBusy(true)
    try {
      await api.logoutAll()
      onSessionInvalidated()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Abmelden fehlgeschlagen.')
      setBusy(false)
    }
  }

  return (
    <div className="sec-wrap">
      <div className="page-head">
        <div>
          <h2>Konto &amp; Sicherheit</h2>
          <p className="muted">
            Diese Konsole steuert alle Mandanten — zusätzlicher Schutz ist dringend empfohlen.
          </p>
        </div>
        <button className="small-btn" onClick={onClose}>Zurück</button>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="ok-banner">{notice}</div>}
      {!sec ? (
        <div className="muted">Lädt…</div>
      ) : (
        <>
          <section className="panel" style={{ marginBottom: 16 }}>
            <h3>Zwei-Faktor-Authentifizierung (2FA)</h3>
            {sec.totp_enabled ? (
              <>
                <p className="ok">✓ 2FA ist für dein Konto aktiv.</p>
                {sec.require_totp ? (
                  <p className="muted small">2FA ist systemweit verpflichtend und kann nicht deaktiviert werden.</p>
                ) : (
                  <div className="sec-inline">
                    <input
                      className="list-search"
                      inputMode="numeric"
                      placeholder="2FA-Code zum Deaktivieren"
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value)}
                    />
                    <button className="small-btn danger" disabled={busy || !disableCode} onClick={() => void disable()}>
                      2FA deaktivieren
                    </button>
                  </div>
                )}
              </>
            ) : !setup ? (
              <>
                <div className="warn" style={{ marginBottom: 12 }}>
                  2FA ist <strong>nicht aktiv</strong>. Ohne 2FA genügt ein erratenes Passwort für vollen
                  Zugriff auf alle Mandanten.
                </div>
                <button className="primary small-btn" disabled={busy} onClick={() => void startSetup()}>
                  2FA jetzt einrichten
                </button>
              </>
            ) : (
              <div className="sec-setup">
                <ol>
                  <li>
                    In deiner Authenticator-App (Google Authenticator, 1Password, …) einen neuen Eintrag anlegen
                    und dieses Secret manuell eingeben:
                    <div className="sec-secret">
                      <code>{setup.secret}</code>
                      <button
                        className="link"
                        onClick={() => void navigator.clipboard?.writeText(setup.secret).then(() => setNotice('Secret kopiert.'))}
                      >
                        kopieren
                      </button>
                    </div>
                    <div className="muted small" style={{ wordBreak: 'break-all' }}>
                      Alternativ die otpauth-URL: <code>{setup.otpauth}</code>
                    </div>
                  </li>
                  <li>
                    Den angezeigten 6-stelligen Code hier eingeben, um 2FA zu aktivieren:
                    <div className="sec-inline" style={{ marginTop: 8 }}>
                      <input
                        className="list-search"
                        inputMode="numeric"
                        placeholder="123456"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        autoFocus
                      />
                      <button className="primary small-btn" disabled={busy || code.trim().length < 6} onClick={() => void confirm()}>
                        Aktivieren
                      </button>
                      <button className="link" onClick={() => { setSetup(null); setCode('') }}>Abbrechen</button>
                    </div>
                  </li>
                </ol>
              </div>
            )}
          </section>

          <section className="panel">
            <h3>Sitzungen</h3>
            <p className="muted small">
              Letzte Anmeldung: {sec.last_login_at ? new Date(sec.last_login_at).toLocaleString('de-DE') : '—'}
            </p>
            <p className="muted small">
              „Überall abmelden" macht alle ausgegebenen Tokens sofort ungültig — nützlich bei Verdacht auf einen
              kompromittierten Zugang.
            </p>
            <button className="small-btn danger" disabled={busy} onClick={() => void logoutAll()}>
              Auf allen Geräten abmelden
            </button>
          </section>
        </>
      )}
    </div>
  )
}
