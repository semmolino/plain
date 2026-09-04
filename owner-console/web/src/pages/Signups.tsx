import { useEffect, useState } from 'react'
import { api, ApiError, type SignupRequest } from '../api'

/**
 * Offene Registrierungen freigeben oder ablehnen.
 *
 * Zweites der beiden Tore aus N3 (Sicherheitsaudit 2026-09-03): der Anmelder
 * hat seine E-Mail-Adresse bestätigt, jetzt entscheidet der Betreiber. Bis
 * dahin ist die Anmeldung gesperrt — in einem abgelehnten Mandanten steht
 * also nie etwas außer dem, was die Registrierung selbst angelegt hat.
 *
 * ABLEHNEN LÖSCHT UNWIDERRUFLICH. Deshalb eine Tippbestätigung statt eines
 * bloßen confirm(): der Firmenname muss abgeschrieben werden. Ein Fehlklick
 * in einer Liste, in der die Zeilen gleich aussehen, wäre sonst ein
 * Datenverlust ohne Weg zurück.
 */
export function SignupsView() {
  const [rows, setRows] = useState<SignupRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const [migrationFehlt, setMigrationFehlt] = useState(false)
  const [laeuft, setLaeuft] = useState<number | null>(null)

  // Ablehnen-Dialog
  const [ablehnen, setAblehnen] = useState<SignupRequest | null>(null)
  const [grund, setGrund] = useState('')
  const [tippBestaetigung, setTippBestaetigung] = useState('')

  async function load() {
    try {
      const r = await api.signups()
      setRows(r.signups)
      setMigrationFehlt(!!r.migration_fehlt)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }
  useEffect(() => { void load() }, [])

  async function freigeben(row: SignupRequest) {
    setLaeuft(row.TENANT_ID)
    setHinweis(null)
    try {
      const r = await api.approveSignup(row.TENANT_ID)
      setHinweis(
        r.mail_versandt
          ? `„${row.FIRMA ?? row.TENANT_ID}" ist freigegeben. ${r.email} wurde benachrichtigt.`
          : `„${row.FIRMA ?? row.TENANT_ID}" ist freigegeben. Achtung: die Benachrichtigung ging NICHT raus (${r.email ?? 'keine Adresse'}) — bitte selbst schreiben.`
      )
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Freigabe fehlgeschlagen.')
    } finally {
      setLaeuft(null)
    }
  }

  async function ablehnenAusfuehren() {
    if (!ablehnen) return
    setLaeuft(ablehnen.TENANT_ID)
    setError(null)
    try {
      const r = await api.rejectSignup(ablehnen.TENANT_ID, grund.trim() || undefined)
      setHinweis(
        `„${ablehnen.FIRMA ?? ablehnen.TENANT_ID}" wurde abgelehnt und gelöscht.` +
        (r.mail_versandt ? ` ${r.email} wurde benachrichtigt.` : ' Es ging KEINE Nachricht raus.')
      )
      setAblehnen(null)
      setGrund('')
      setTippBestaetigung('')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ablehnung fehlgeschlagen.')
    } finally {
      setLaeuft(null)
    }
  }

  if (!rows) return <div className="muted">Lädt…</div>

  const erwarteterText = ablehnen?.FIRMA ?? String(ablehnen?.TENANT_ID ?? '')
  const darfAblehnen = tippBestaetigung.trim() === erwarteterText.trim()

  return (
    <div>
      <h2>Registrierungen</h2>
      <p className="muted">
        Neue Mandanten müssen zuerst ihre E-Mail-Adresse bestätigen und werden dann hier freigegeben.
        Vor der Freigabe ist die Anmeldung gesperrt.
      </p>

      {migrationFehlt && (
        <div className="error">
          Migration 0135 ist noch nicht eingespielt — bis dahin wird jede Registrierung sofort nutzbar.
          <br />
          <code>scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0135_tenant_signup_approval.sql'</code>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {hinweis && <div className="ok">{hinweis}</div>}

      {rows.length === 0 ? (
        <p className="muted">Keine offenen Registrierungen.</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Firma</th>
              <th>E-Mail</th>
              <th>Kürzel</th>
              <th>Stand</th>
              <th>Angelegt</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const wartetAufFreigabe = r.STATE === 'pending_approval'
              return (
                <tr key={r.TENANT_ID}>
                  <td>{r.FIRMA ?? <span className="muted">(ohne Namen)</span>}</td>
                  <td>{r.EMAIL ?? <span className="muted">—</span>}</td>
                  <td>{r.KUERZEL ?? <span className="muted">—</span>}</td>
                  <td>
                    {wartetAufFreigabe ? (
                      <span title={`E-Mail bestätigt am ${new Date(r.EMAIL_BESTAETIGT_AM ?? '').toLocaleString('de-DE')}`}>
                        wartet auf Freigabe
                      </span>
                    ) : (
                      <span className="muted" title="Der Anmelder hat den Bestätigungslink noch nicht geöffnet.">
                        E-Mail offen
                      </span>
                    )}
                  </td>
                  <td>{new Date(r.ANGELEGT_AM).toLocaleDateString('de-DE')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      disabled={!wartetAufFreigabe || laeuft === r.TENANT_ID}
                      title={wartetAufFreigabe ? 'Mandant freigeben' : 'Erst nach bestätigter E-Mail-Adresse möglich'}
                      onClick={() => void freigeben(r)}
                    >
                      Freigeben
                    </button>{' '}
                    <button
                      className="danger"
                      disabled={laeuft === r.TENANT_ID}
                      title="Ablehnen und Daten löschen"
                      onClick={() => { setAblehnen(r); setGrund(''); setTippBestaetigung('') }}
                    >
                      Ablehnen
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {ablehnen && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Ablehnen und löschen</h3>
          <p>
            Mandant, Firma und Erst-Nutzer von <strong>{ablehnen.FIRMA ?? ablehnen.TENANT_ID}</strong>{' '}
            ({ablehnen.EMAIL ?? 'keine Adresse'}) werden <strong>unwiderruflich gelöscht</strong>.
            Die Entscheidung bleibt im Protokoll nachvollziehbar, die Daten nicht.
          </p>

          <label>
            Begründung (optional, geht an den Anmelder)
            <textarea rows={2} value={grund} onChange={(e) => setGrund(e.target.value)} style={{ width: '100%' }} />
          </label>

          <label>
            Zum Bestätigen „{erwarteterText}" eintippen
            <input
              value={tippBestaetigung}
              onChange={(e) => setTippBestaetigung(e.target.value)}
              placeholder={erwarteterText}
              style={{ width: '100%' }}
            />
          </label>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => { setAblehnen(null); setGrund(''); setTippBestaetigung('') }}>
              Abbrechen
            </button>
            <button
              className="danger"
              disabled={!darfAblehnen || laeuft === ablehnen.TENANT_ID}
              onClick={() => void ablehnenAusfuehren()}
            >
              {laeuft === ablehnen.TENANT_ID ? 'Löscht …' : 'Endgültig löschen'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
