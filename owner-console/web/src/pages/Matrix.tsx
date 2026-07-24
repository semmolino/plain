import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, type MatrixResponse, type MatrixCap } from '../api'

interface Props {
  /** Vorauswahl aus der Inbox (Capability-Key). */
  focusRef?: string | null
}

export function MatrixView({ focusRef }: Props) {
  const [data, setData] = useState<MatrixResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [onlyType, setOnlyType] = useState<'alle' | 'boolean' | 'metered'>('alle')

  const load = useCallback(async () => {
    try {
      setData(await api.matrix())
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (focusRef) setSearch(focusRef)
  }, [focusRef])

  const cellMap = useMemo(() => {
    const m = new Map<string, { enabled: boolean; limit: number | null }>()
    data?.cells.forEach((c) => m.set(`${c.plan_id}:${c.capability_key}`, { enabled: c.enabled, limit: c.numeric_limit }))
    return m
  }, [data])

  const moduleLabel = useMemo(
    () => new Map((data?.modules ?? []).map((m) => [m.key, m.labelDe])),
    [data],
  )

  const byModule = useMemo(() => {
    const q = search.trim().toLowerCase()
    const m = new Map<string, { label: string; caps: MatrixCap[] }>()
    data?.capabilities.forEach((c) => {
      if (onlyType !== 'alle' && c.type !== onlyType) return
      if (q && !c.labelDe.toLowerCase().includes(q) && !c.key.toLowerCase().includes(q)) return
      const entry = m.get(c.module) ?? { label: moduleLabel.get(c.module) ?? c.module, caps: [] }
      entry.caps.push(c)
      m.set(c.module, entry)
    })
    return m
  }, [data, search, onlyType, moduleLabel])

  async function save(planId: number, capKey: string, enabled: boolean, limit: number | null) {
    const key = `${planId}:${capKey}`
    setSaving((prev) => new Set(prev).add(key))
    setActionError(null)
    // Optimistisch: nur diese Zelle anfassen, nicht die ganze Matrix neu laden.
    setData((prev) => {
      if (!prev) return prev
      const cells = prev.cells.map((c) =>
        c.plan_id === planId && c.capability_key === capKey ? { ...c, enabled, numeric_limit: limit } : c,
      )
      return { ...prev, cells }
    })
    try {
      await api.setCell(planId, capKey, enabled, limit)
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.')
      await load() // Serverzustand wiederherstellen
    } finally {
      setSaving((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  if (loadError && !data)
    return (
      <div className="error">
        {loadError} <button className="link" onClick={() => void load()}>Erneut versuchen</button>
      </div>
    )
  if (!data) return <div className="muted">Lädt…</div>

  const shown = [...byModule.values()].reduce((n, e) => n + e.caps.length, 0)

  return (
    <div className="matrix-wrap">
      <div className="page-head">
        <div>
          <h2>Plan × Capability</h2>
          <p className="muted">
            Häkchen = Capability im Plan enthalten. Bei „mengenbasiert" zusätzlich ein Limit (leer = unbegrenzt).
            Capabilities kommen read-only aus dem Code-Manifest.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="error">
          {actionError} <button className="link" onClick={() => setActionError(null)}>ausblenden</button>
        </div>
      )}

      <div className="list-toolbar">
        <input
          className="list-search"
          type="search"
          placeholder="Capability suchen …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="seg">
          {(['alle', 'boolean', 'metered'] as const).map((t) => (
            <button key={t} className={onlyType === t ? 'active' : ''} onClick={() => setOnlyType(t)}>
              {t === 'alle' ? 'Alle' : t === 'boolean' ? 'An/Aus' : 'Mengenbasiert'}
            </button>
          ))}
        </div>
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          {shown} von {data.capabilities.length} Capabilities · {data.plans.length} Pläne
        </span>
      </div>

      <div className="table-scroll matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th className="cap-col">Capability</th>
              {data.plans.map((p) => (
                <th key={p.ID}>
                  {p.NAME_DE}
                  <div className="muted small">{p.KEY}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown === 0 ? (
              <tr>
                <td colSpan={data.plans.length + 1} className="muted pad">
                  Kein Treffer.
                </td>
              </tr>
            ) : (
              [...byModule.entries()].map(([mod, entry]) => (
                <Fragment key={mod}>
                  <tr className="module-row">
                    <td colSpan={data.plans.length + 1}>{entry.label}</td>
                  </tr>
                  {entry.caps.map((cap) => (
                    <tr key={cap.key}>
                      <td className="cap-col">
                        <div>{cap.labelDe}</div>
                        <div className="muted small">
                          {cap.key}
                          {cap.type === 'metered' ? ` · ${cap.unit ?? ''}` : ''}
                        </div>
                      </td>
                      {data.plans.map((p) => {
                        const k = `${p.ID}:${cap.key}`
                        const c = cellMap.get(k)
                        const busy = saving.has(k)
                        return (
                          <td key={p.ID} className="cell">
                            <input
                              type="checkbox"
                              checked={!!c?.enabled}
                              disabled={busy}
                              onChange={() => save(p.ID, cap.key, !c?.enabled, c?.limit ?? null)}
                            />
                            {cap.type === 'metered' && c?.enabled && (
                              <LimitInput
                                value={c?.limit ?? null}
                                disabled={busy}
                                onCommit={(v) => save(p.ID, cap.key, true, v)}
                              />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Kontrolliertes Limit-Feld: speichert nur bei echter Änderung. */
function LimitInput({
  value,
  disabled,
  onCommit,
}: {
  value: number | null
  disabled: boolean
  onCommit: (v: number | null) => void
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => {
    setText(value == null ? '' : String(value))
  }, [value])

  function commit() {
    const t = text.trim()
    const next = t === '' ? null : Number(t)
    if (next != null && (!Number.isInteger(next) || next < 0)) {
      setText(value == null ? '' : String(value)) // ungültig -> zurücksetzen
      return
    }
    if (next !== value) onCommit(next)
  }

  return (
    <input
      className="limit"
      type="number"
      min={0}
      step={1}
      placeholder="∞"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      title="Limit (leer = unbegrenzt)"
    />
  )
}

