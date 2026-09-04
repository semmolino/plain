import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { confirmSignup } from '@/api/auth'
import { Message } from '@/components/ui/Message'
import { BrandWordmark } from '@/components/brand/BrandLogo'

/**
 * Landeseite des Bestätigungslinks aus der Registrierungsmail.
 *
 * Erstes der beiden Tore aus N3 (Sicherheitsaudit 2026-09-03): hier belegt der
 * Anmelder, dass die E-Mail-Adresse ihm gehört. Danach folgt die Freigabe
 * durch den Betreiber — bis dahin ist die Anmeldung gesperrt, und genau das
 * muss diese Seite verständlich sagen, sonst probiert der Nutzer den Login
 * und hält die Sperre für einen Fehler.
 *
 * Die Bestätigung läuft ohne Klick: wer den Link öffnet, hat die Absicht schon
 * ausgedrückt. Ein zusätzlicher Knopf wäre eine Hürde ohne Gewinn.
 */
export function ConfirmSignupPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [status, setStatus] = useState<'laeuft' | 'ok' | 'fehler'>(token ? 'laeuft' : 'fehler')
  const [text, setText] = useState<string>(
    token ? '' : 'Dieser Link ist unvollständig. Bitte öffnen Sie ihn direkt aus der E-Mail.'
  )
  const [freigegeben, setFreigegeben] = useState(false)

  // React ruft Effekte im Entwicklungsmodus (StrictMode) zweimal auf. Der
  // Endpunkt ist idempotent, aber ein zweiter Aufruf zählt gegen das
  // Rate-Limit — deshalb der Riegel.
  const schonGelaufen = useRef(false)

  useEffect(() => {
    if (!token || schonGelaufen.current) return
    schonGelaufen.current = true

    confirmSignup(token)
      .then((r) => {
        setStatus('ok')
        setText(r.message)
        setFreigegeben(r.state === 'active')
      })
      .catch((e: unknown) => {
        setStatus('fehler')
        setText(e instanceof Error ? e.message : 'Der Link konnte nicht bestätigt werden.')
      })
  }, [token])

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo"><BrandWordmark size={34} /></div>
        <div className="auth-subtitle" />
        <h2 className="auth-title">E-Mail-Adresse bestätigen</h2>

        {status === 'laeuft' && (
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Einen Moment, wir prüfen Ihren Link …
          </p>
        )}

        {status !== 'laeuft' && (
          <Message text={text} type={status === 'ok' ? 'success' : 'error'} />
        )}

        {status === 'ok' && !freigegeben && (
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '14px 0 0', lineHeight: 1.5 }}>
            Sie müssen nichts weiter tun. Sobald Ihr Konto freigegeben ist, erhalten Sie
            eine E-Mail — dann können Sie sich anmelden.
          </p>
        )}

        {status === 'ok' && freigegeben && (
          <Link className="btn-primary" to="/login" style={{ display: 'inline-block', marginTop: 14, textDecoration: 'none' }}>
            Zur Anmeldung
          </Link>
        )}

        {status === 'fehler' && (
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '14px 0 0', lineHeight: 1.5 }}>
            Der Link ist 24 Stunden gültig. Ist er abgelaufen, können Sie sich einfach{' '}
            <Link to="/signup">erneut registrieren</Link>.
          </p>
        )}
      </div>
    </div>
  )
}
