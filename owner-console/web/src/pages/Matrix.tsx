import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, ApiError, type MatrixResponse, type MatrixCap } from '../api'

export function MatrixView() {
  const [data, setData] = useState<MatrixResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    try {
      setData(await api.matrix())
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const cellMap = useMemo(() => {
    const m = new Map<string, { enabled: boolean; limit: number | null }>()
    data?.cells.forEach((c) => m.set(`${c.plan_id}:${c.capability_key}`, { enabled: c.enabled, limit: c.numeric_limit }))
    return m
  }, [data])

  const byModule = useMemo(() => {
    const m = new Map<string, MatrixCap[]>()
    data?.capabilities.forEach((c) => {
      const arr = m.get(c.module) ?? []
      arr.push(c)
      m.set(c.module, arr)
    })
    return m
  }, [data])

  if (error) return <div className="error">{error}</div>
  if (!data) return <div className="muted">Lädt…</div>

  async function save(planId: number, capKey: string, enabled: boolean, limit: number | null) {
    const key = `${planId}:${capKey}`
    setSaving(key)
    try {
      await api.setCell(planId, capKey, enabled, limit)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="matrix-wrap">
      <h2>Plan × Capability</h2>
      <p className="muted">
        Häkchen = Capability im Plan enthalten. Bei „metered" zusätzlich ein Limit (leer = unbegrenzt). Capabilities
        kommen read-only aus dem Code-Manifest.
      </p>
      <div className="table-scroll">
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
            {[...byModule.entries()].map(([mod, caps]) => (
              <Fragment key={mod}>
                <tr className="module-row">
                  <td colSpan={data.plans.length + 1}>{mod}</td>
                </tr>
                {caps.map((cap) => (
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
                      return (
                        <td key={p.ID} className="cell">
                          <input
                            type="checkbox"
                            checked={!!c?.enabled}
                            disabled={saving === k}
                            onChange={() => save(p.ID, cap.key, !c?.enabled, c?.limit ?? null)}
                          />
                          {cap.type === 'metered' && c?.enabled && (
                            <input
                              className="limit"
                              type="number"
                              min={0}
                              placeholder="∞"
                              defaultValue={c?.limit ?? ''}
                              disabled={saving === k}
                              onBlur={(e) => {
                                const v = e.target.value.trim()
                                save(p.ID, cap.key, true, v === '' ? null : Number(v))
                              }}
                            />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
