import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, ApiError, type CatalogModule, type CatalogCapability } from '../api'

/**
 * Katalog-Verwaltung: Module + Capabilities anlegen, umbenennen (Label),
 * umgruppieren (Modul wechseln), sortieren und löschen. Der Key ist fest.
 * Quelle ist die DB; das Code-Manifest bleibt Seed + Vertrag für Code-Gates.
 */
export function CatalogView() {
  const [modules, setModules] = useState<CatalogModule[]>([])
  const [caps, setCaps] = useState<CatalogCapability[]>([])
  const [fromDb, setFromDb] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showNewCap, setShowNewCap] = useState(false)
  const [showNewMod, setShowNewMod] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.catalog()
      setModules(r.modules)
      setCaps(r.capabilities)
      setFromDb(r.fromDb)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const capsByModule = useMemo(() => {
    const m = new Map<string, CatalogCapability[]>()
    caps.forEach((c) => {
      const arr = m.get(c.module) ?? []
      arr.push(c)
      m.set(c.module, arr)
    })
    return m
  }, [caps])

  async function run(fn: () => Promise<void>, ok?: string) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      if (ok) setNotice(ok)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteCap(c: CatalogCapability) {
    setError(null)
    try {
      await api.deleteCapability(c.key)
      setNotice(`„${c.labelDe}" gelöscht.`)
      await load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const p = e.payload as { code_gated?: boolean; requires_force?: boolean; locations?: string[]; plan_count?: number; override_count?: number; permission_count?: number } | null
        if (p?.code_gated) {
          setError(`„${c.key}" wird im Code verwendet und kann nicht gelöscht werden (${p.locations?.slice(0, 3).join(', ')}${(p.locations?.length ?? 0) > 3 ? ' …' : ''}).`)
          return
        }
        if (p?.requires_force) {
          const parts = [
            p.plan_count ? `${p.plan_count} Plan-Zuordnung(en)` : '',
            p.override_count ? `${p.override_count} Ausnahme(n)` : '',
            p.permission_count ? `${p.permission_count} Funktions-Zuordnung(en)` : '',
          ].filter(Boolean).join(', ')
          if (window.confirm(`„${c.labelDe}" ist noch in Verwendung (${parts}). Löschen entfernt sie überall. Fortfahren?`)) {
            await run(async () => {
              const r = await api.deleteCapability(c.key, true)
              if (r.note) setNotice(r.note)
            }, `„${c.labelDe}" gelöscht.`)
          }
          return
        }
      }
      setError(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen.')
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Katalog</h2>
          <p className="muted">
            Module und Capabilities verwalten — anlegen, umbenennen, umgruppieren, sortieren, löschen. Der
            technische Schlüssel bleibt fest (Code-Gates hängen daran).
          </p>
        </div>
        <div className="sec-inline">
          <button className="small-btn" onClick={() => setShowNewMod((v) => !v)}>+ Modul</button>
          <button className="primary small-btn" onClick={() => setShowNewCap((v) => !v)}>+ Capability</button>
        </div>
      </div>

      {!fromDb && (
        <div className="warn">
          Der Katalog wird noch aus dem Code-Manifest angezeigt (DB-Tabellen leer/nicht eingespielt). Änderungen
          werden erst wirksam, sobald Migration 0070/0070b eingespielt ist.
        </div>
      )}
      {error && <div className="error">{error} <button className="link" onClick={() => setError(null)}>ausblenden</button></div>}
      {notice && <div className="ok-banner">{notice} <button className="link" onClick={() => setNotice(null)}>ok</button></div>}

      {showNewMod && (
        <NewModuleForm
          busy={busy}
          onCancel={() => setShowNewMod(false)}
          onCreate={(key, label) => run(async () => { await api.createModule({ key, label_de: label }); setShowNewMod(false) }, `Modul „${label}" angelegt.`)}
        />
      )}
      {showNewCap && (
        <NewCapabilityForm
          modules={modules}
          busy={busy}
          onCancel={() => setShowNewCap(false)}
          onCreate={(body) => run(async () => { await api.createCapability(body); setShowNewCap(false) }, `Capability „${body.label_de}" angelegt.`)}
        />
      )}

      {/* ── Module ─────────────────────────────────────────────────────────── */}
      <h3 style={{ marginTop: 18 }}>Module ({modules.length})</h3>
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr><th>Schlüssel</th><th>Bezeichnung</th><th className="num-col">Reihenf.</th><th className="num-col">Caps</th><th>Herkunft</th><th /></tr>
          </thead>
          <tbody>
            {modules.map((m) => {
              const count = capsByModule.get(m.key)?.length ?? 0
              return (
                <tr key={m.key}>
                  <td><code>{m.key}</code></td>
                  <td>
                    <input
                      defaultValue={m.labelDe}
                      disabled={busy}
                      onBlur={(e) => e.target.value.trim() && e.target.value !== m.labelDe && run(() => api.updateModule(m.key, { label_de: e.target.value.trim() }).then(() => {}))}
                    />
                  </td>
                  <td>
                    <input className="num" type="number" defaultValue={m.position} disabled={busy}
                      onBlur={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v !== m.position) void run(() => api.updateModule(m.key, { position: v }).then(() => {})) }} />
                  </td>
                  <td className="muted num-col">{count}</td>
                  <td>{m.inManifest ? <span className="muted small">Code</span> : <span className="status-tag st-waiting">Konsole</span>}</td>
                  <td>
                    {count === 0 && (
                      <button className="link danger" disabled={busy}
                        onClick={() => window.confirm(`Modul „${m.labelDe}" löschen?`) && void run(() => api.deleteModule(m.key).then(() => {}), `Modul gelöscht.`)}>
                        löschen
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Capabilities je Modul ──────────────────────────────────────────── */}
      <h3 style={{ marginTop: 22 }}>Capabilities ({caps.length})</h3>
      {modules.map((m) => {
        const list = capsByModule.get(m.key) ?? []
        return (
          <div key={m.key} className="cat-module">
            <div className="cat-module-head">{m.labelDe} <span className="muted small">{m.key} · {list.length}</span></div>
            {list.length === 0 ? (
              <p className="muted small pad">Keine Capabilities in diesem Modul.</p>
            ) : (
              <div className="table-scroll">
                <table className="grid">
                  <thead>
                    <tr><th>Bezeichnung</th><th>Schlüssel</th><th>Typ</th><th>Modul (umgruppieren)</th><th className="num-col">Reihenf.</th><th>Herkunft</th><th /></tr>
                  </thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.key}>
                        <td>
                          <input defaultValue={c.labelDe} disabled={busy}
                            onBlur={(e) => e.target.value.trim() && e.target.value !== c.labelDe && void run(() => api.updateCapability(c.key, { label_de: e.target.value.trim() }).then(() => {}))} />
                        </td>
                        <td><code>{c.key}</code></td>
                        <td>
                          {c.type === 'metered' ? (
                            <span className="muted small">Menge{c.unit ? ` · ${c.unit}` : ''}</span>
                          ) : (
                            <span className="muted small">An/Aus</span>
                          )}
                        </td>
                        <td>
                          <select value={c.module} disabled={busy}
                            onChange={(e) => e.target.value !== c.module && void run(() => api.updateCapability(c.key, { module: e.target.value }).then(() => {}), 'Umgruppiert.')}>
                            {modules.map((mm) => <option key={mm.key} value={mm.key}>{mm.labelDe}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="num" type="number" defaultValue={c.position} disabled={busy}
                            onBlur={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v !== c.position) void run(() => api.updateCapability(c.key, { position: v }).then(() => {})) }} />
                        </td>
                        <td>{c.inManifest ? <span className="muted small">Code</span> : <span className="status-tag st-waiting">Konsole</span>}</td>
                        <td><button className="link danger" disabled={busy} onClick={() => void deleteCap(c)}>löschen</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
      <p className="muted small" style={{ marginTop: 10 }}>
        <strong>Herkunft „Code"</strong>: auch im Manifest definiert. Löschen ist möglich, aber beim nächsten
        Seed käme die Capability zurück — zum dauerhaften Entfernen zusätzlich im Manifest löschen.
        <strong> „Konsole"</strong>: hier angelegt; optional ins Manifest übernehmen, um sie deploy-fest zu machen.
      </p>
    </div>
  )
}

function NewModuleForm({ busy, onCancel, onCreate }: { busy: boolean; onCancel: () => void; onCreate: (key: string, label: string) => void }) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  function submit(e: FormEvent) { e.preventDefault(); if (key.trim() && label.trim()) onCreate(key.trim(), label.trim()) }
  return (
    <form className="plan-new" onSubmit={submit}>
      <input placeholder="Schlüssel (z. B. reporting)" value={key} onChange={(e) => setKey(e.target.value)} required />
      <input placeholder="Bezeichnung (z. B. Reporting)" value={label} onChange={(e) => setLabel(e.target.value)} required />
      <button className="primary small-btn" disabled={busy}>Modul anlegen</button>
      <button type="button" className="link" onClick={onCancel}>Abbrechen</button>
    </form>
  )
}

function NewCapabilityForm({
  modules,
  busy,
  onCancel,
  onCreate,
}: {
  modules: CatalogModule[]
  busy: boolean
  onCancel: () => void
  onCreate: (body: { key: string; module: string; label_de: string; type: 'boolean' | 'metered'; unit?: string | null }) => void
}) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [module, setModule] = useState(modules[0]?.key ?? '')
  const [type, setType] = useState<'boolean' | 'metered'>('boolean')
  const [unit, setUnit] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!key.trim() || !label.trim() || !module) return
    if (type === 'metered' && !unit.trim()) return
    onCreate({ key: key.trim(), module, label_de: label.trim(), type, unit: type === 'metered' ? unit.trim() : null })
  }
  return (
    <form className="plan-new" onSubmit={submit} style={{ alignItems: 'center' }}>
      <input placeholder="Schlüssel (z. B. reports.forecast)" value={key} onChange={(e) => setKey(e.target.value)} required />
      <input placeholder="Bezeichnung" value={label} onChange={(e) => setLabel(e.target.value)} required />
      <select value={module} onChange={(e) => setModule(e.target.value)}>
        {modules.map((m) => <option key={m.key} value={m.key}>{m.labelDe}</option>)}
      </select>
      <select value={type} onChange={(e) => setType(e.target.value as 'boolean' | 'metered')}>
        <option value="boolean">An/Aus</option>
        <option value="metered">Mengenbasiert</option>
      </select>
      {type === 'metered' && (
        <input placeholder="Einheit (z. B. Projekte)" value={unit} onChange={(e) => setUnit(e.target.value)} required />
      )}
      <button className="primary small-btn" disabled={busy}>Capability anlegen</button>
      <button type="button" className="link" onClick={onCancel}>Abbrechen</button>
    </form>
  )
}
