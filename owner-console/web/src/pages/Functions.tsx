import { useEffect, useState } from 'react'
import { api, ApiError, type CapabilityWithFunctions, type Module } from '../api'

export function FunctionsView() {
  const [caps, setCaps] = useState<CapabilityWithFunctions[] | null>(null)
  const [modules, setModules] = useState<Module[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .capabilityFunctions()
      .then((r) => {
        setCaps(r.capabilities)
        setModules(r.modules)
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.'))
  }, [])

  if (error) return <div className="error">{error}</div>
  if (!caps) return <div className="muted">Lädt…</div>

  return (
    <div>
      <h2>Funktionen je Capability</h2>
      <p className="muted">
        Welche konkreten Aktionen/Ansichten hinter jedem Flag stecken (read-only — kommt aus dem Code).
        „— eigene Funktion" = Feature ohne separates RBAC-Recht. Bearbeitbar wird das in Stufe 2.
      </p>
      {modules.map((m) => {
        const list = caps.filter((c) => c.module === m.key)
        if (!list.length) return null
        return (
          <div key={m.key} style={{ marginBottom: 18 }}>
            <h3 style={{ marginBottom: 6 }}>
              {m.labelDe} <span className="muted small">{m.key}</span>
            </h3>
            <div className="table-scroll">
              <table className="grid">
                <thead>
                  <tr><th>Capability</th><th>Typ</th><th>Enthaltene Funktionen</th></tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.key}>
                      <td><strong>{c.labelDe}</strong><div className="muted small">{c.key}</div></td>
                      <td>{c.type === 'metered' ? `metered (${c.unit})` : 'boolean'}</td>
                      <td>{c.functions.length ? c.functions.map((f) => f.label).join('; ') : '— eigene Funktion'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
