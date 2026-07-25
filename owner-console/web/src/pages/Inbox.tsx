import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, type InboxItem, type InboxResponse, type InboxSeverity } from '../api'

const SEVERITY_LABEL: Record<InboxSeverity, string> = {
  kritisch: 'Kritisch',
  hoch: 'Hoch',
  mittel: 'Mittel',
  niedrig: 'Niedrig',
}

const SEVERITY_ORDER: InboxSeverity[] = ['kritisch', 'hoch', 'mittel', 'niedrig']

const TAB_LABEL: Record<string, string> = {
  functions: 'Funktionen',
  matrix: 'Matrix',
  tenants: 'Tenants',
  inbox: 'Inbox',
}

interface Props {
  /** Sprung in den zuständigen Tab, vorgefiltert auf den betroffenen Eintrag. */
  onNavigate?: (tab: string, ref: string) => void
}

export function InboxView({ onNavigate }: Props) {
  const [data, setData] = useState<InboxResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [severity, setSeverity] = useState<InboxSeverity | 'alle'>('alle')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      setData(await api.inbox())
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.items.filter((it) => {
      if (severity !== 'alle' && it.severity !== severity) return false
      if (!q) return true
      return (
        it.title.toLowerCase().includes(q) ||
        it.ref.toLowerCase().includes(q) ||
        it.detail.toLowerCase().includes(q)
      )
    })
  }, [data, severity, search])

  // Gruppierung nach Aufgabenart — jede Gruppe ist eine eigene Entscheidung.
  const groups = useMemo(() => {
    const m = new Map<string, InboxItem[]>()
    filtered.forEach((it) => {
      const arr = m.get(it.kind) ?? []
      arr.push(it)
      m.set(it.kind, arr)
    })
    return [...m.entries()]
  }, [filtered])

  if (error && !data) return <div className="error">{error}</div>
  if (!data) return <div className="muted">Lädt…</div>

  return (
    <div className="inbox-wrap">
      <div className="page-head">
        <div>
          <h2>Inbox — offene Lizenz-Aufgaben</h2>
          <p className="muted">
            Alles, was zwischen Code, Manifest und Datenbank auseinanderläuft: neue Funktionen ohne
            Lizenz-Zuordnung, Capabilities in keinem Plan, Mandanten ohne Lizenz. Zuletzt geprüft:{' '}
            {new Date(data.checkedAt).toLocaleString('de-DE')}.
          </p>
        </div>
        <button className="small-btn" onClick={() => void load()} disabled={busy}>
          {busy ? 'Prüft…' : 'Neu prüfen'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {data.warnings.map((w) => (
        <div key={w} className="warn">
          {w}
        </div>
      ))}

      <div className="sev-bar">
        <button className={severity === 'alle' ? 'sev-pill active' : 'sev-pill'} onClick={() => setSeverity('alle')}>
          Alle <b>{data.total}</b>
        </button>
        {SEVERITY_ORDER.map((s) => {
          const n = data.bySeverity[s] ?? 0
          if (!n) return null
          return (
            <button
              key={s}
              className={`sev-pill sev-${s}${severity === s ? ' active' : ''}`}
              onClick={() => setSeverity(severity === s ? 'alle' : s)}
            >
              {SEVERITY_LABEL[s]} <b>{n}</b>
            </button>
          )
        })}
        <input
          className="list-search"
          type="search"
          placeholder="Suchen …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {data.total === 0 ? (
        <div className="empty-state ok">
          <strong>Alles zugeordnet.</strong>
          <p className="muted">
            Keine offenen Lizenz-Aufgaben. Sobald eine neue Funktion ohne Capability dazukommt oder ein
            Mandant ohne Lizenz angelegt wird, erscheint sie hier.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <strong>Kein Treffer.</strong>
          <p className="muted">Filter oder Suche zurücksetzen, um alle {data.total} Aufgaben zu sehen.</p>
        </div>
      ) : (
        groups.map(([kind, items]) => (
          <section key={kind} className="inbox-group">
            <h3>
              {data.kindLabels[kind] || kind} <span className="count-badge">{items.length}</span>
            </h3>
            <ul className="inbox">
              {items.map((it) => (
                <li key={it.id} className={`inbox-item sev-border-${it.severity}`}>
                  <div className="inbox-item-head">
                    <span className={`sev-dot sev-${it.severity}`} title={SEVERITY_LABEL[it.severity]} />
                    <strong>{it.title}</strong>
                    <code className="muted small">{it.ref}</code>
                  </div>
                  <p className="inbox-detail">{it.detail}</p>
                  <div className="inbox-actions">
                    <span className="muted small">→ {it.action}</span>
                    {onNavigate && (
                      <button className="link" onClick={() => onNavigate(it.targetTab, it.ref)}>
                        In „{TAB_LABEL[it.targetTab] || it.targetTab}" öffnen
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
