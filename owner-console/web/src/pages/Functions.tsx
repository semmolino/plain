import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, type CapabilityFns, type Module, type PermissionInfo } from '../api'

export function FunctionsView() {
  const [caps, setCaps] = useState<CapabilityFns[] | null>(null)
  const [modules, setModules] = useState<Module[]>([])
  const [perms, setPerms] = useState<PermissionInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    try {
      const r = await api.capabilityFunctions()
      setCaps(r.capabilities)
      setModules(r.modules)
      setPerms(r.permissions)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const permLabel = useMemo(() => {
    const m = new Map<string, string>()
    perms.forEach((p) => m.set(p.key, p.label))
    return m
  }, [perms])

  async function add(capKey: string, permKey: string) {
    if (!permKey) return
    setBusy(capKey)
    try {
      await api.addCapPermission(capKey, permKey)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setBusy(null)
    }
  }
  async function remove(capKey: string, permKey: string) {
    setBusy(capKey)
    try {
      await api.removeCapPermission(capKey, permKey)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen.')
    } finally {
      setBusy(null)
    }
  }

  if (error && !caps) return <div className="error">{error}</div>
  if (!caps) return <div className="muted">Lädt…</div>

  return (
    <div>
      <h2>Funktionen je Capability</h2>
      <p className="muted">
        Welche konkreten RBAC-Funktionen zu jeder Capability gehören — editierbar. Wirkt, sobald die
        Engine aktiv ist (Stufe 2b): nicht lizenzierte Capabilities blenden ihre Funktionen aus.
      </p>
      {error && <div className="error">{error}</div>}
      {modules.map((m) => {
        const list = caps.filter((c) => c.module === m.key)
        if (!list.length) return null
        return (
          <div key={m.key} style={{ marginBottom: 18 }}>
            <h3 style={{ marginBottom: 6 }}>
              {m.labelDe} <span className="muted small">{m.key}</span>
            </h3>
            {list.map((c) => {
              const mapped = new Set(c.permissionKeys)
              const available = perms.filter((p) => !mapped.has(p.key))
              return (
                <div key={c.key} className="panel" style={{ marginBottom: 10 }}>
                  <div>
                    <strong>{c.labelDe}</strong>{' '}
                    <span className="muted small">{c.key}{c.type === 'metered' ? ` · metered (${c.unit})` : ''}</span>
                  </div>
                  <div className="fn-chips">
                    {c.permissionKeys.length === 0 && (
                      <span className="muted small">— eigene Funktion (kein separates RBAC-Recht)</span>
                    )}
                    {c.permissionKeys.map((pk) => (
                      <span key={pk} className="chip">
                        {permLabel.get(pk) || pk}
                        <button className="chip-x" disabled={busy === c.key} onClick={() => remove(c.key, pk)} title="Entfernen">×</button>
                      </span>
                    ))}
                  </div>
                  <select className="fn-add" disabled={busy === c.key} value="" onChange={(e) => add(c.key, e.target.value)}>
                    <option value="">+ Funktion hinzufügen…</option>
                    {available.map((p) => (
                      <option key={p.key} value={p.key}>{p.label} ({p.key})</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
