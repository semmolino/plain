import { useEffect, useState } from 'react'
import { api, ApiError, type TenantLicense, type Plan } from '../api'

export function TenantsView() {
  const [tenants, setTenants] = useState<TenantLicense[] | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)

  async function load() {
    try {
      const [t, p] = await Promise.all([api.tenants(), api.plans()])
      setTenants(t.tenants)
      setPlans(p.plans)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }
  useEffect(() => {
    void load()
  }, [])

  async function setPlan(tenantId: number, planId: number) {
    setSaving(tenantId)
    try {
      await api.setTenantPlan(tenantId, planId)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSaving(null)
    }
  }

  if (!tenants) return <div className="muted">Lädt…</div>

  return (
    <div>
      <h2>Tenants & Lizenz</h2>
      <p className="muted">
        Jedem Tenant einen Lizenztyp zuweisen. Was ein Typ enthält, legst du im Tab „Matrix" fest.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr><th>Tenant</th><th>Lizenztyp</th><th>Status</th></tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.TENANT_ID}>
                <td>#{t.TENANT_ID}</td>
                <td>
                  <select
                    value={t.PLAN_ID}
                    disabled={saving === t.TENANT_ID}
                    onChange={(e) => setPlan(t.TENANT_ID, Number(e.target.value))}
                  >
                    {plans.map((p) => (
                      <option key={p.ID} value={p.ID}>{p.NAME_DE}</option>
                    ))}
                  </select>
                </td>
                <td>{t.STATE}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
