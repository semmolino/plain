import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  api, ApiError,
  type TenantLicense, type Plan, type LicenseState, type TenantEntitlement,
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
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [onlyUnlicensed, setOnlyUnlicensed] = useState(false)
  const [detail, setDetail] = useState<number | null>(null)
  const [entitlement, setEntitlement] = useState<TenantEntitlement | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, p] = await Promise.all([api.tenants(), api.plans()])
      setTenants(t.tenants)
      setUnlicensed(t.unlicensed)
      setPlans(p.plans)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
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
    try {
      setEntitlement(await api.tenantEntitlement(tenantId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Entitlement konnte nicht geladen werden.')
    }
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
                            {!!entitlement.overrides.length && (
                              <div>
                                <h4>Ausnahmen</h4>
                                <ul className="plain-list">
                                  {entitlement.overrides.map((o) => (
                                    <li key={o.CAPABILITY_KEY}>
                                      <code>{o.CAPABILITY_KEY}</code> ·{' '}
                                      {o.MODE === 'grant' ? 'zusätzlich freigeschaltet' : 'entzogen'}
                                      {o.REASON ? ` — ${o.REASON}` : ''}
                                      {o.EXPIRES_AT ? ` (bis ${fmtDate(o.EXPIRES_AT)})` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
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
