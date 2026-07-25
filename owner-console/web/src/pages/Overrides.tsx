import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, type OverrideRow } from '../api'

function fmtDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('de-DE') : '—'
}

type Filter = 'alle' | 'grandfather' | 'grant' | 'revoke'

/**
 * Tenantübergreifende Übersicht aller Ausnahmen (Overrides) — beantwortet
 * „wer weicht wie vom Plan ab?" an einer Stelle. Insbesondere der
 * Bestandsschutz (grants, die beim Entfernen aus einem Plan entstanden sind).
 */
export function OverridesView() {
  const [rows, setRows] = useState<OverrideRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('alle')
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      setRows((await api.allOverrides()).overrides)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'grandfather' && !r.is_grandfather) return false
      if (filter === 'grant' && r.mode !== 'grant') return false
      if (filter === 'revoke' && r.mode !== 'revoke') return false
      if (!q) return true
      return (
        (r.tenant_name ?? '').toLowerCase().includes(q) ||
        r.capability_label.toLowerCase().includes(q) ||
        r.capability_key.toLowerCase().includes(q) ||
        (r.reason ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, search, filter])

  async function remove(r: OverrideRow) {
    if (!window.confirm(`Ausnahme „${r.capability_label}" für ${r.tenant_name || `#${r.tenant_id}`} aufheben?`)) return
    setBusy(r.id)
    try {
      await api.deleteOverride(r.tenant_id, r.capability_key)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen.')
    } finally {
      setBusy(null)
    }
  }

  if (error && !rows) return <div className="error">{error}</div>
  if (!rows) return <div className="muted">Lädt…</div>

  const grandfatherCount = rows.filter((r) => r.is_grandfather).length

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Ausnahmen &amp; Bestandsschutz</h2>
          <p className="muted">
            Jede Abweichung vom Plan an einem Ort: zusätzlich freigeschaltete oder entzogene Capabilities je
            Mandant. „Bestandsschutz" entsteht automatisch, wenn du eine genutzte Funktion aus einem Plan
            entfernst und die Bestandskunden schützt.
          </p>
        </div>
        <button className="small-btn" onClick={() => void load()}>Neu laden</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="list-toolbar">
        <input
          className="list-search"
          type="search"
          placeholder="Mandant, Capability oder Grund suchen …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="seg">
          {(['alle', 'grandfather', 'grant', 'revoke'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'alle' ? 'Alle' : f === 'grandfather' ? `Bestandsschutz (${grandfatherCount})` : f === 'grant' ? 'Freischaltungen' : 'Entzüge'}
            </button>
          ))}
        </div>
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          {filtered.length} von {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <strong>Keine Ausnahmen.</strong>
          <p className="muted">
            Alle Mandanten haben genau das, was ihr Plan enthält. Ausnahmen entstehen über den Add-on-Editor
            (Tab „Tenants") oder den Bestandsschutz beim Entfernen einer Capability aus einem Plan.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <strong>Kein Treffer.</strong>
          <p className="muted">Filter oder Suche zurücksetzen.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Mandant</th>
                <th>Capability</th>
                <th>Art</th>
                <th>Grund</th>
                <th>Angelegt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={r.expired ? 'row-warn' : ''}>
                  <td>
                    <strong>{r.tenant_name || `Mandant #${r.tenant_id}`}</strong>
                    <div className="muted small">#{r.tenant_id}</div>
                  </td>
                  <td>
                    {r.capability_label}
                    {r.numeric_limit != null ? <span className="muted small"> · max {r.numeric_limit}</span> : null}
                    <div className="muted small"><code>{r.capability_key}</code></div>
                  </td>
                  <td>
                    {r.is_grandfather ? (
                      <span className="status-tag st-waiting">Bestandsschutz</span>
                    ) : r.mode === 'grant' ? (
                      <span className="status-tag st-resolved">Freigeschaltet</span>
                    ) : (
                      <span className="status-tag st-in_progress">Entzogen</span>
                    )}
                  </td>
                  <td>
                    {r.reason || '—'}
                    {r.expires_at && (
                      <div className={`muted small${r.expired ? ' danger-text' : ''}`}>
                        {r.expired ? 'abgelaufen' : 'läuft ab'} {fmtDate(r.expires_at)}
                      </div>
                    )}
                  </td>
                  <td className="nowrap">
                    {fmtDate(r.created_at)}
                    {r.created_by && <div className="muted small">{r.created_by}</div>}
                  </td>
                  <td>
                    <button className="link danger" disabled={busy === r.id} onClick={() => void remove(r)}>
                      aufheben
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
