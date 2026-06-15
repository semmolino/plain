import { useEffect, useState } from 'react'
import { api, ApiError, type AuditEntry } from '../api'

export function AuditView() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .audit()
      .then((r) => setEntries(r.entries))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.'))
  }, [])

  if (error) return <div className="error">{error}</div>
  if (!entries) return <div className="muted">Lädt…</div>

  return (
    <div>
      <h2>Audit-Log ({entries.length})</h2>
      <p className="muted">Alle Änderungen an Plänen, Matrix und Overrides — neueste zuerst (max. 100).</p>
      {entries.length === 0 ? (
        <p className="muted">Noch keine Änderungen protokolliert.</p>
      ) : (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr><th>Zeitpunkt</th><th>Wer</th><th>Aktion</th><th>Objekt</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.ID}>
                  <td>{new Date(e.AT).toLocaleString('de-DE')}</td>
                  <td>{e.ACTOR ?? '—'}</td>
                  <td>{e.ACTION}</td>
                  <td><code>{e.ENTITY}{e.ENTITY_REF ? ` · ${e.ENTITY_REF}` : ''}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
