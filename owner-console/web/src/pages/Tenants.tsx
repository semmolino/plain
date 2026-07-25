import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  api, ApiError,
  type TenantLicense, type Plan, type LicenseState, type TenantEntitlement,
  type Capability, type Module,
} from '../api'

const STATE_LABEL: Record<LicenseState, string> = {
  trial: 'Testphase',
  active: 'Aktiv',
  past_due: 'Zahlung überfällig',
  grace: 'Kulanzfrist',
  expired: 'Abgelaufen',
}
const STATES = Object.keys(STATE_LABEL) as LicenseState[]

function fmtDate(v: string | null): string {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('de-DE')
}

interface Props {
  /** Vorauswahl aus der Inbox (Tenant-ID als String). */
  focusRef?: string | null
}

export function TenantsView({ focusRef }: Props) {
  const [tenants, setTenants] = useState<TenantLicense[] | null>(null)
  const [unlicensed, setUnlicensed] = useState(0)
  const [plans, setPlans] = useState<Plan[]>([])
  const [caps, setCaps] = useState<Capability[]>([])
  const [modules, setModules] = useState<Module[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [onlyUnlicensed, setOnlyUnlicensed] = useState(false)
  const [detail, setDetail] = useState<number | null>(null)
  const [entitlement, setEntitlement] = useState<TenantEntitlement | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, p, c] = await Promise.all([api.tenants(), api.plans(), api.capabilities()])
      setTenants(t.tenants)
      setUnlicensed(t.unlicensed)
      setPlans(p.plans)
      setCaps(c.capabilities)
      setModules(c.modules)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }, [])

  const refreshEntitlement = useCallback(async (tenantId: number) => {
    try {
      setEntitlement(await api.tenantEntitlement(tenantId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Entitlement konnte nicht geladen werden.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (focusRef) setSearch(focusRef)
  }, [focusRef])

  const filtered = useMemo(() => {
    if (!tenants) return []
    const q = search.trim().toLowerCase()
    return tenants.filter((t) => {
      if (onlyUnlicensed && t.HAS_LICENSE) return false
      if (!q) return true
      return (
        String(t.TENANT_ID) === q ||
        (t.NAME ?? '').toLowerCase().includes(q) ||
        (t.SLUG ?? '').toLowerCase().includes(q)
      )
    })
  }, [tenants, search, onlyUnlicensed])

  async function patch(tenantId: number, body: Parameters<typeof api.patchTenantLicense>[1], msg: string) {
    setSaving(tenantId)
    setNotice(null)
    try {
      await api.patchTenantLicense(tenantId, body)
      await load()
      setNotice(`${msg} — wirkt beim Mandanten innerhalb einer Minute (Cache).`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSaving(null)
    }
  }

  async function openDetail(tenantId: number) {
    if (detail === tenantId) {
      setDetail(null)
      setEntitlement(null)
      return
    }
    setDetail(tenantId)
    setEntitlement(null)
    await refreshEntitlement(tenantId)
  }

  if (!tenants) return <div className="muted">Lädt…</div>

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Tenants &amp; Lizenz</h2>
          <p className="muted">
            Alle registrierten Mandanten. Was ein Lizenztyp enthält, legst du im Tab „Matrix" fest.
          </p>
        </div>
        <button className="small-btn" onClick={() => void load()}>Neu laden</button>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="ok-banner">{notice}</div>}
      {unlicensed > 0 && (
        <div className="warn">
          <strong>{unlicensed} Mandant(en) ohne Lizenz.</strong> Ohne Lizenzzeile greift die Prüfung nicht —
          diese Mandanten nutzen faktisch alle Funktionen. Zuweisen über die Spalte „Lizenztyp".
        </div>
      )}

      <div className="list-toolbar">
        <input
          className="list-search"
          type="search"
          placeholder="Mandant, ID oder URL suchen …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="check-inline">
          <input type="checkbox" checked={onlyUnlicensed} onChange={(e) => setOnlyUnlicensed(e.target.checked)} />
          Nur ohne Lizenz
        </label>
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          {filtered.length} von {tenants.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <strong>Kein Treffer.</strong>
          <p className="muted">Suche oder Filter zurücksetzen.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Mandant</th>
                <th>Mitarbeiter</th>
                <th>Lizenztyp</th>
                <th>Zustand</th>
                <th>Gültig bis</th>
                <th>Ausnahmen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <Fragment key={t.TENANT_ID}>
                  <tr className={t.HAS_LICENSE ? '' : 'row-warn'}>
                    <td>
                      <div>
                        <strong>{t.NAME || `Mandant #${t.TENANT_ID}`}</strong>
                      </div>
                      <span className="muted small">
                        #{t.TENANT_ID}
                        {t.SLUG ? ` · ${t.SLUG}` : ''}
                      </span>
                    </td>
                    <td>{t.EMPLOYEE_COUNT}</td>
                    <td>
                      <select
                        value={t.PLAN_ID ?? ''}
                        disabled={saving === t.TENANT_ID}
                        onChange={(e) =>
                          patch(t.TENANT_ID, { plan_id: Number(e.target.value) }, 'Lizenztyp gesetzt')
                        }
                      >
                        {!t.HAS_LICENSE && <option value="">— keine Lizenz —</option>}
                        {plans.map((p) => (
                          <option key={p.ID} value={p.ID}>
                            {p.NAME_DE}
                            {p.IS_ACTIVE ? '' : ' (inaktiv)'}
                          </option>
                        ))}
                      </select>
                      {t.PLAN_OUTDATED && (
                        <div
                          className="muted small"
                          title="Der Plan wurde nach der Zuweisung geändert. Der Mandant ist auf die alte Version gepinnt."
                        >
                          Version {t.PLAN_VERSION} statt {t.PLAN_VERSION_CURRENT}{' '}
                          <button
                            className="link"
                            disabled={saving === t.TENANT_ID}
                            onClick={() => patch(t.TENANT_ID, { repin_version: true }, 'Auf aktuelle Planversion gehoben')}
                          >
                            übernehmen
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      {t.HAS_LICENSE ? (
                        <select
                          value={t.STATE ?? 'active'}
                          disabled={saving === t.TENANT_ID}
                          onChange={(e) =>
                            patch(t.TENANT_ID, { state: e.target.value as LicenseState }, 'Zustand geändert')
                          }
                        >
                          {STATES.map((s) => (
                            <option key={s} value={s}>
                              {STATE_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="tag-open">ohne Lizenz</span>
                      )}
                    </td>
                    <td>
                      <input
                        className="inline-date-input"
                        type="date"
                        defaultValue={t.VALID_UNTIL ? t.VALID_UNTIL.slice(0, 10) : ''}
                        disabled={saving === t.TENANT_ID || !t.HAS_LICENSE}
                        onBlur={(e) => {
                          const v = e.target.value || null
                          const cur = t.VALID_UNTIL ? t.VALID_UNTIL.slice(0, 10) : null
                          if (v !== cur) patch(t.TENANT_ID, { valid_until: v }, 'Laufzeit geändert')
                        }}
                      />
                      {t.TRIAL_UNTIL && <div className="muted small">Test bis {fmtDate(t.TRIAL_UNTIL)}</div>}
                    </td>
                    <td>{t.OVERRIDE_COUNT > 0 ? <span className="count-badge">{t.OVERRIDE_COUNT}</span> : '—'}</td>
                    <td>
                      <button className="link" onClick={() => void openDetail(t.TENANT_ID)}>
                        {detail === t.TENANT_ID ? 'schließen' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {detail === t.TENANT_ID && (
                    <tr className="detail-row">
                      <td colSpan={7}>
                        {!entitlement ? (
                          <span className="muted">Lädt…</span>
                        ) : entitlement.unrestricted ? (
                          <div className="warn" style={{ margin: 0 }}>
                            <strong>Unbeschränkt.</strong> {entitlement.reason}
                          </div>
                        ) : (
                          <div className="ent-detail">
                            <div>
                              <h4>Freigeschaltet ({entitlement.capabilities.length})</h4>
                              <div className="fn-chips">
                                {entitlement.capabilities.map((c) => (
                                  <span key={c} className="chip chip-sm">
                                    {c}
                                    {entitlement.limits[c] != null ? ` · max ${entitlement.limits[c]}` : ''}
                                  </span>
                                ))}
                              </div>
                            </div>
                            {!!entitlement.missing?.length && (
                              <div>
                                <h4>Nicht enthalten ({entitlement.missing.length})</h4>
                                <div className="fn-chips">
                                  {entitlement.missing.map((c) => (
                                    <span key={c} className="chip chip-sm chip-off">
                                      {c}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <OverrideEditor
                              tenantId={t.TENANT_ID}
                              tenantName={t.NAME}
                              overrides={entitlement.overrides}
                              caps={caps}
                              modules={modules}
                              onChanged={async () => {
                                await refreshEntitlement(t.TENANT_ID)
                                await load()
                              }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * Per-Tenant-Ausnahmen (Add-Ons / Sonderdeals) anzeigen und pflegen.
 * grant = Capability zusätzlich freischalten, revoke = aus dem Plan entziehen.
 * Optional mit Limit (bei mengenbasierten Capabilities), Begründung und Ablaufdatum.
 */
function OverrideEditor({
  tenantId,
  tenantName,
  overrides,
  caps,
  modules,
  onChanged,
}: {
  tenantId: number
  tenantName: string | null
  overrides: TenantEntitlement['overrides']
  caps: Capability[]
  modules: Module[]
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [capKey, setCapKey] = useState('')
  const [mode, setMode] = useState<'grant' | 'revoke'>('grant')
  const [limit, setLimit] = useState('')
  const [reason, setReason] = useState('')
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const capLabel = useMemo(() => new Map(caps.map((c) => [c.key, c.labelDe])), [caps])
  const selectedCap = caps.find((c) => c.key === capKey)

  async function save() {
    if (!capKey) return
    setBusy(true)
    setErr(null)
    try {
      await api.addOverride(tenantId, {
        capability_key: capKey,
        mode,
        numeric_limit: mode === 'grant' && selectedCap?.type === 'metered' && limit.trim() !== '' ? Number(limit) : null,
        reason: reason.trim() || undefined,
        expires_at: expires || null,
      })
      setCapKey('')
      setLimit('')
      setReason('')
      setExpires('')
      setOpen(false)
      await onChanged()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(cap: string) {
    if (!window.confirm(`Ausnahme für „${capLabel.get(cap) || cap}" aufheben?`)) return
    setBusy(true)
    setErr(null)
    try {
      await api.deleteOverride(tenantId, cap)
      await onChanged()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="override-block">
      <h4>
        Ausnahmen ({overrides.length}){' '}
        <button className="link" onClick={() => setOpen((o) => !o)}>
          {open ? 'Formular schließen' : '+ Ausnahme'}
        </button>
      </h4>
      <p className="muted small" style={{ marginTop: -4 }}>
        Add-Ons und Sonderabsprachen für {tenantName || `Mandant #${tenantId}`} — wirken zusätzlich zum Plan.
      </p>

      {err && <div className="error">{err}</div>}

      {overrides.length > 0 && (
        <ul className="plain-list">
          {overrides.map((o) => (
            <li key={o.CAPABILITY_KEY}>
              <code>{capLabel.get(o.CAPABILITY_KEY) || o.CAPABILITY_KEY}</code> ·{' '}
              {o.MODE === 'grant' ? 'zusätzlich freigeschaltet' : 'entzogen'}
              {o.NUMERIC_LIMIT != null ? ` · max ${o.NUMERIC_LIMIT}` : ''}
              {o.REASON ? ` — ${o.REASON}` : ''}
              {o.EXPIRES_AT ? ` (bis ${fmtDate(o.EXPIRES_AT)})` : ''}{' '}
              <button className="link danger" disabled={busy} onClick={() => void remove(o.CAPABILITY_KEY)}>
                aufheben
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="override-form">
          <div className="sec-inline">
            <select value={mode} onChange={(e) => setMode(e.target.value as 'grant' | 'revoke')}>
              <option value="grant">Freischalten (grant)</option>
              <option value="revoke">Entziehen (revoke)</option>
            </select>
            <select value={capKey} onChange={(e) => setCapKey(e.target.value)}>
              <option value="">Capability wählen …</option>
              {modules.map((m) => {
                const list = caps.filter((c) => c.module === m.key)
                if (!list.length) return null
                return (
                  <optgroup key={m.key} label={m.labelDe}>
                    {list.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.labelDe}
                        {c.type === 'metered' ? ` (${c.unit ?? 'Limit'})` : ''}
                      </option>
                    ))}
                  </optgroup>
                )
              })}
            </select>
            {mode === 'grant' && selectedCap?.type === 'metered' && (
              <input
                className="list-search"
                type="number"
                min={0}
                placeholder={selectedCap.unit ?? 'Limit'}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                style={{ maxWidth: 120 }}
              />
            )}
          </div>
          <div className="sec-inline">
            <input
              className="list-search"
              placeholder="Begründung (z.B. Sonderdeal, Testverlängerung)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <label className="muted small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              läuft ab
              <input className="inline-date-input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </label>
            <button className="primary small-btn" disabled={busy || !capKey} onClick={() => void save()}>
              Speichern
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
