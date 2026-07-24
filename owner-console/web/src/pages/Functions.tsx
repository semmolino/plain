import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, type CapabilityFns, type Module, type PermissionInfo } from '../api'

interface Props {
  /** Vorauswahl aus der Inbox: Permission-Key oder Capability-Key. */
  focusRef?: string | null
}

type Filter = 'alle' | 'offen' | 'zugeordnet'

/**
 * Zwei-Spalten-Ansicht statt einer langen Liste:
 * links die Capabilities (gruppiert nach Modul, mit Zähler), rechts die
 * Funktionen der ausgewählten Capability plus ein durchsuchbarer Picker.
 *
 * Der frühere Aufbau rendert 43 Capabilities × ein <select> mit 104 Optionen
 * untereinander — bei jeder Zuordnung wurde die komplette Liste neu geladen.
 */
export function FunctionsView({ focusRef }: Props) {
  const [caps, setCaps] = useState<CapabilityFns[] | null>(null)
  const [modules, setModules] = useState<Module[]>([])
  const [perms, setPerms] = useState<PermissionInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [capSearch, setCapSearch] = useState('')
  const [permSearch, setPermSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('alle')
  const focusApplied = useRef(false)

  const load = useCallback(async () => {
    try {
      const r = await api.capabilityFunctions()
      setCaps(r.capabilities)
      setModules(r.modules)
      setPerms(r.permissions)
      setError(null)
      return r
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
      return null
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Sprung aus der Inbox: die betroffene Capability auswählen bzw. bei einem
  // Permission-Key den Picker direkt darauf vorfiltern.
  useEffect(() => {
    if (!caps || !focusRef || focusApplied.current) return
    focusApplied.current = true
    const asCap = caps.find((c) => c.key === focusRef)
    if (asCap) {
      setSelected(asCap.key)
    } else {
      setPermSearch(focusRef)
      setFilter('alle')
    }
  }, [caps, focusRef])

  const permByKey = useMemo(() => new Map(perms.map((p) => [p.key, p])), [perms])
  const moduleLabel = useMemo(() => new Map(modules.map((m) => [m.key, m.labelDe])), [modules])

  /** Rechte, die an keiner Capability hängen — der eigentliche Handlungsbedarf. */
  const unmappedPerms = useMemo(
    () => perms.filter((p) => !p.capabilityKeys || p.capabilityKeys.length === 0),
    [perms],
  )

  const visibleCaps = useMemo(() => {
    if (!caps) return []
    const q = capSearch.trim().toLowerCase()
    return caps.filter((c) => {
      if (filter === 'offen' && c.permissionKeys.length > 0) return false
      if (filter === 'zugeordnet' && c.permissionKeys.length === 0) return false
      if (!q) return true
      return c.labelDe.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)
    })
  }, [caps, capSearch, filter])

  const current = useMemo(() => caps?.find((c) => c.key === selected) ?? null, [caps, selected])

  const available = useMemo(() => {
    if (!current) return []
    const mapped = new Set(current.permissionKeys)
    const q = permSearch.trim().toLowerCase()
    return perms
      .filter((p) => !mapped.has(p.key))
      .filter((p) => !q || p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q))
      .sort((a, b) => {
        // Nicht zugeordnete Rechte zuerst — sie sind der Grund, hier zu sein.
        const au = (a.capabilityKeys?.length ?? 0) === 0 ? 0 : 1
        const bu = (b.capabilityKeys?.length ?? 0) === 0 ? 0 : 1
        return au - bu || a.label.localeCompare(b.label)
      })
  }, [current, perms, permSearch])

  async function addPicked() {
    if (!current || picked.size === 0) return
    setBusy(true)
    try {
      await api.addCapPermissions(current.key, [...picked])
      setPicked(new Set())
      setPermSearch('')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(capKey: string, permKey: string) {
    setBusy(true)
    try {
      await api.removeCapPermission(capKey, permKey)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  function togglePick(key: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (error && !caps) return <div className="error">{error}</div>
  if (!caps) return <div className="muted">Lädt…</div>

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Funktionen je Capability</h2>
          <p className="muted">
            Welche RBAC-Funktionen zu einer Capability gehören. Links auswählen, rechts zuordnen. Nicht
            zugeordnete Funktionen sind in keinem Plan steuerbar — sie sind für jeden Kunden aktiv.
          </p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {unmappedPerms.length > 0 && (
        <div className="warn">
          <strong>{unmappedPerms.length} Funktion(en) ohne Capability.</strong> Sie lassen sich derzeit nicht
          lizenzieren. Wähle links eine Capability und ordne sie rechts zu — sie stehen im Picker ganz oben.
        </div>
      )}

      <div className="fn-split">
        {/* ── Links: Capabilities ─────────────────────────────────────────── */}
        <aside className="fn-list">
          <div className="fn-list-head">
            <input
              className="list-search"
              type="search"
              placeholder="Capability suchen …"
              value={capSearch}
              onChange={(e) => setCapSearch(e.target.value)}
            />
            <div className="seg">
              {(['alle', 'offen', 'zugeordnet'] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                  {f === 'alle' ? 'Alle' : f === 'offen' ? 'Ohne Funktion' : 'Mit Funktion'}
                </button>
              ))}
            </div>
          </div>
          <div className="fn-list-body">
            {modules.map((m) => {
              const list = visibleCaps.filter((c) => c.module === m.key)
              if (!list.length) return null
              return (
                <div key={m.key} className="fn-module">
                  <div className="fn-module-head">{m.labelDe}</div>
                  {list.map((c) => (
                    <button
                      key={c.key}
                      className={`fn-cap${selected === c.key ? ' active' : ''}`}
                      onClick={() => {
                        setSelected(c.key)
                        setPicked(new Set())
                        setPermSearch('')
                      }}
                    >
                      <span className="fn-cap-label">{c.labelDe}</span>
                      <span className={c.permissionKeys.length ? 'count-badge' : 'count-badge zero'}>
                        {c.permissionKeys.length}
                      </span>
                    </button>
                  ))}
                </div>
              )
            })}
            {visibleCaps.length === 0 && <p className="muted small pad">Kein Treffer.</p>}
          </div>
        </aside>

        {/* ── Rechts: Detail der gewählten Capability ─────────────────────── */}
        <section className="fn-detail">
          {!current ? (
            <div className="empty-state">
              <strong>Capability auswählen</strong>
              <p className="muted">
                Links eine Capability wählen, um ihre Funktionen zu sehen und neue zuzuordnen.
              </p>
            </div>
          ) : (
            <>
              <div className="fn-detail-head">
                <div>
                  <h3>{current.labelDe}</h3>
                  <span className="muted small">
                    <code>{current.key}</code> · {moduleLabel.get(current.module) || current.module}
                    {current.type === 'metered' ? ` · mengenbasiert (${current.unit ?? ''})` : ''}
                  </span>
                </div>
              </div>

              <h4>Zugeordnete Funktionen ({current.permissionKeys.length})</h4>
              {current.permissionKeys.length === 0 ? (
                <p className="muted small">
                  Noch keine — diese Capability wirkt nur über ein Feature-Gate im Code, nicht über Rechte.
                </p>
              ) : (
                <div className="fn-chips">
                  {current.permissionKeys.map((pk) => {
                    const p = permByKey.get(pk)
                    const alsoElsewhere = (p?.capabilityKeys?.length ?? 0) > 1
                    return (
                      <span key={pk} className="chip" title={pk}>
                        {p?.label || pk}
                        {alsoElsewhere && (
                          <em className="chip-warn" title="Hängt zusätzlich an einer anderen Capability">
                            mehrfach
                          </em>
                        )}
                        <button
                          className="chip-x"
                          disabled={busy}
                          onClick={() => void remove(current.key, pk)}
                          title="Zuordnung entfernen"
                        >
                          ×
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}

              <h4>Funktion zuordnen</h4>
              <input
                className="list-search"
                type="search"
                placeholder="Funktion suchen …"
                value={permSearch}
                onChange={(e) => setPermSearch(e.target.value)}
              />
              <div className="fn-picker">
                {available.length === 0 && <p className="muted small pad">Kein Treffer.</p>}
                {available.slice(0, 200).map((p) => {
                  const isUnmapped = (p.capabilityKeys?.length ?? 0) === 0
                  return (
                    <label key={p.key} className={`fn-pick${isUnmapped ? ' unmapped' : ''}`}>
                      <input type="checkbox" checked={picked.has(p.key)} onChange={() => togglePick(p.key)} />
                      <span className="fn-pick-label">{p.label}</span>
                      <code className="muted small">{p.key}</code>
                      {isUnmapped ? (
                        <em className="tag-open">noch offen</em>
                      ) : (
                        <em className="muted small">{p.capabilityKeys?.length} ×</em>
                      )}
                    </label>
                  )
                })}
                {available.length > 200 && (
                  <p className="muted small pad">… {available.length - 200} weitere. Suche eingrenzen.</p>
                )}
              </div>
              <div className="fn-picker-foot">
                <button className="primary small-btn" disabled={busy || picked.size === 0} onClick={() => void addPicked()}>
                  {picked.size === 0 ? 'Zuordnen' : `${picked.size} zuordnen`}
                </button>
                {picked.size > 0 && (
                  <button className="link" onClick={() => setPicked(new Set())}>
                    Auswahl aufheben
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
