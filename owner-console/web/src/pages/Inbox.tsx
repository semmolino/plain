import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'

export function InboxView() {
  const [data, setData] = useState<{ unmapped: string[]; count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .inbox()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.'))
  }, [])

  if (error) return <div className="error">{error}</div>
  if (!data) return <div className="muted">Lädt…</div>

  return (
    <div className="inbox-wrap">
      <h2>Inbox — nicht paketierte Capabilities ({data.count})</h2>
      <p className="muted">
        Capabilities aus dem Manifest, die noch keinem Plan zugeordnet sind. Hier siehst du „neue Funktionen", über
        deren Einordnung du entscheiden solltest.
      </p>
      {data.count === 0 ? (
        <p className="ok">Alles zugeordnet — keine offenen Capabilities.</p>
      ) : (
        <ul className="inbox">
          {data.unmapped.map((k) => (
            <li key={k}>
              <code>{k}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
