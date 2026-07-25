import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, downloadConsoleFile, type AuditEntry, type AuditQuery, type AuditResponse } from '../api'

const PAGE = 50

/** Werte lesbar machen: Datum als Datum, Boolean als Ja/Nein, null als „—". */
function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nein'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString('de-DE')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function AuditView() {
  const [data, setData] = useState<AuditResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [query, setQuery] = useState<AuditQuery>({ limit: PAGE, offset: 0 })

  const load = useCallback(async (q: AuditQuery) => {
    try {
      setData(await api.audit(q))
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }, [])

  useEffect(() => {
    void load(query)
  }, [load, query])

  function setFilter(patch: Partial<AuditQuery>) {
    setQuery((q) => ({ ...q, ...patch, offset: 0 }))
    setExpanded(null)
  }

  async function exportCsv() {
    try {
      await downloadConsoleFile(
        api.auditExportUrl({ ...query, limit: undefined, offset: undefined }),
        `audit-${new Date().toISOString().slice(0, 10)}.csv`,
      )
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Export fehlgeschlagen.')
    }
  }

  if (error && !data) return <div className="error">{error}</div>
  if (!data) return <div className="muted">Lädt…</div>

  const page = Math.floor((query.offset ?? 0) / PAGE) + 1
  const pages = Math.max(1, Math.ceil(data.total / PAGE))

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Änderungsprotokoll</h2>
          <p className="muted">
            Jede Änderung an Plänen, Matrix, Zuordnungen und Mandanten-Lizenzen — dazu Anmeldungen an der
            Konsole. Neueste zuerst.
          </p>
        </div>
        <button className="small-btn" onClick={() => void exportCsv()}>CSV exportieren</button>
      </div>

      {error && <div className="error">{error}</div>}
      {data.warning && <div className="warn">{data.warning}</div>}

      <div className="list-toolbar">
        <select value={query.entity ?? ''} onChange={(e) => setFilter({ entity: e.target.value || undefined })}>
          <option value="">Alle Bereiche</option>
          {data.filters.entities.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <select value={query.action ?? ''} onChange={(e) => setFilter({ action: e.target.value || undefined })}>
          <option value="">Alle Aktionen</option>
          {data.filters.actions.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <input
          className="list-search"
          type="search"
          placeholder="Wer (E-Mail) …"
          value={query.actor ?? ''}
          onChange={(e) => setFilter({ actor: e.target.value || undefined })}
        />
        <input
          className="inline-date-input"
          type="date"
          title="Von"
          value={query.from?.slice(0, 10) ?? ''}
          onChange={(e) => setFilter({ from: e.target.value || undefined })}
        />
        <input
          className="inline-date-input"
          type="date"
          title="Bis"
          value={query.to?.slice(0, 10) ?? ''}
          onChange={(e) => setFilter({ to: e.target.value || undefined })}
        />
        {(query.entity || query.action || query.actor || query.from || query.to) && (
          <button className="link" onClick={() => setQuery({ limit: PAGE, offset: 0 })}>
            Zurücksetzen
          </button>
        )}
      </div>

      {data.entries.length === 0 ? (
        <div className="empty-state">
          <strong>Keine Einträge.</strong>
          <p className="muted">
            {query.entity || query.action || query.actor
              ? 'Für diesen Filter wurde nichts protokolliert.'
              : 'Sobald du eine Lizenz-Einstellung änderst, erscheint sie hier.'}
          </p>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Zeitpunkt</th>
                  <th>Wer</th>
                  <th>Aktion</th>
                  <th>Bereich</th>
                  <th>Objekt</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e: AuditEntry) => (
                  <tr key={e.ID} className={e.ACTION === 'login_failed' ? 'row-warn' : ''}>
                    <td className="nowrap">{new Date(e.AT).toLocaleString('de-DE')}</td>
                    <td>{e.ACTOR ?? '—'}</td>
                    <td>{e.ACTION_LABEL}</td>
                    <td>{e.ENTITY_LABEL}</td>
                    <td>{e.OBJECT_LABEL}</td>
                    <td>
                      {e.DIFF.length > 0 && (
                        <button className="link" onClick={() => setExpanded(expanded === e.ID ? null : e.ID)}>
                          {expanded === e.ID ? 'schließen' : `${e.DIFF.length} Änderung(en)`}
                        </button>
                      )}
                      {expanded === e.ID && (
                        <table className="diff">
                          <tbody>
                            {e.DIFF.map((d) => (
                              <tr key={d.field}>
                                <td className="muted">{d.label}</td>
                                <td className="diff-before">{fmtValue(d.before)}</td>
                                <td className="muted">→</td>
                                <td className="diff-after">{fmtValue(d.after)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pager">
            <button
              className="small-btn"
              disabled={(query.offset ?? 0) === 0}
              onClick={() => setQuery((q) => ({ ...q, offset: Math.max(0, (q.offset ?? 0) - PAGE) }))}
            >
              ← Zurück
            </button>
            <span className="muted small">
              Seite {page} von {pages} · {data.total} Einträge
            </span>
            <button
              className="small-btn"
              disabled={(query.offset ?? 0) + PAGE >= data.total}
              onClick={() => setQuery((q) => ({ ...q, offset: (q.offset ?? 0) + PAGE }))}
            >
              Weiter →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
