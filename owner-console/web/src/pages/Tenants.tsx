import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type TenantLicense, type Plan, type Override, type Capability } from '../api'

export function TenantsView() {
  const [tenants, setTenants] = useState<TenantLicense[] | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [caps, setCaps] = useState<Capability[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [overrides, setOverrides] = useState<Override[]>([])
  const [error, setError] = useState<string | null>(null)

  const [capKey, setCapKey] = useState('')
  const [mode, setMode] = useState<'grant' | 'revoke'>('grant')
  const [reason, setReason] = useState('')

  useEffect(() => {
    Promise.all([api.tenants(), api.plans(), api.capabilities()])
      .then(([t, p, c]) => {
        setTenants(t.tenants)
        setPlans(p.plans)
        setCaps(c.capabilities)
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.'))
  }, [])

  async function loadOverrides(id: number) {
    try {
      setOverrides((await api.tenantOverrides(id)).overrides)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }

  function select(id: number) {
    setSelected(id)
    setOverrides([])
    void loadOverrides(id)
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (selected == null || !capKey) return
    try {
      await api.addOverride(selected, { capability_key: capKey, mode, reason: reason.trim() || undefined })
      setReason('')
      await loadOverrides(selected)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.')
    }
  }

  async function remove(cap: string) {
    if (selected == null) return
    try {
      await api.deleteOverride(selected, cap)
      await loadOverrides(selected)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen.')
    }
  }

  const planName = (id: number) => plans.find((p) => p.ID === id)?.NAME_DE ?? `#${id}`

  if (!tenants) return <div className="muted">Lädt…</div>

  return (
    <div>
      <h2>Tenants & Sonderrechte</h2>
      <p className="muted">Per-Tenant-Overrides (Add-Ons / Sonderdeals): einzelne Capabilities zusätzlich freigeben (grant) oder sperren (revoke).</p>
      {error && <div className="error">{error}</div>}

      <div className="two-col">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr><th>Tenant</th><th>Plan</th><th>Status</th></tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr
                  key={t.TENANT_ID}
                  className={selected === t.TENANT_ID ? 'sel' : 'clickable'}
                  onClick={() => select(t.TENANT_ID)}
                >
                  <td>#{t.TENANT_ID}</td>
                  <td>{planName(t.PLAN_ID)}</td>
                  <td>{t.STATE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected != null && (
          <div className="panel">
            <h3>Tenant #{selected} — Overrides</h3>
            {overrides.length === 0 ? (
              <p className="muted">Keine Overrides.</p>
            ) : (
              <ul className="inbox">
                {overrides.map((o) => (
                  <li key={o.ID}>
                    <span className={o.MODE === 'grant' ? 'ok' : 'danger-text'}>{o.MODE}</span>{' '}
                    <code>{o.CAPABILITY_KEY}</code>
                    {o.NUMERIC_LIMIT != null ? ` (Limit ${o.NUMERIC_LIMIT})` : ''}
                    {o.REASON ? ` — ${o.REASON}` : ''}
                    <button className="link danger-text" onClick={() => remove(o.CAPABILITY_KEY)}>entfernen</button>
                  </li>
                ))}
              </ul>
            )}

            <form className="override-form" onSubmit={add}>
              <select value={capKey} onChange={(e) => setCapKey(e.target.value)} required>
                <option value="">Capability wählen…</option>
                {caps.map((c) => (
                  <option key={c.key} value={c.key}>{c.labelDe} ({c.key})</option>
                ))}
              </select>
              <select value={mode} onChange={(e) => setMode(e.target.value as 'grant' | 'revoke')}>
                <option value="grant">grant (freigeben)</option>
                <option value="revoke">revoke (sperren)</option>
              </select>
              <input placeholder="Grund (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="primary small-btn">Hinzufügen</button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
