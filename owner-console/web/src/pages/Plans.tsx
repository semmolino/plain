import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type Plan, type PlanPatch } from '../api'

function numOrNull(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function PlansView() {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [priceM, setPriceM] = useState('')
  const [priceY, setPriceY] = useState('')

  async function load() {
    try {
      setPlans((await api.plans()).plans)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }
  useEffect(() => {
    void load()
  }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.createPlan({
        key: key.trim(),
        name_de: name.trim(),
        price_monthly: numOrNull(priceM),
        price_yearly: numOrNull(priceY),
      })
      setKey('')
      setName('')
      setPriceM('')
      setPriceY('')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function patch(id: number, body: PlanPatch) {
    try {
      await api.updatePlan(id, body)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.')
    }
  }

  if (!plans) return <div className="muted">Lädt…</div>

  return (
    <div>
      <h2>Pläne</h2>
      <p className="muted">Pakete, denen in der Matrix Capabilities zugeordnet werden. Änderungen ohne Deploy.</p>
      {error && <div className="error">{error}</div>}

      <form className="plan-new" onSubmit={create}>
        <input placeholder="key (z.B. pro)" value={key} onChange={(e) => setKey(e.target.value)} required />
        <input placeholder="Name (z.B. Pro)" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="€/Monat" type="number" min={0} value={priceM} onChange={(e) => setPriceM(e.target.value)} />
        <input placeholder="€/Jahr" type="number" min={0} value={priceY} onChange={(e) => setPriceY(e.target.value)} />
        <button className="primary small-btn" disabled={busy}>+ Plan</button>
      </form>

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>Key</th>
              <th>Name</th>
              <th>€/Monat</th>
              <th>€/Jahr</th>
              <th>Capabilities</th>
              <th>Aktiv</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.ID}>
                <td><code>{p.KEY}</code></td>
                <td>
                  <input defaultValue={p.NAME_DE} onBlur={(e) => e.target.value !== p.NAME_DE && patch(p.ID, { name_de: e.target.value })} />
                </td>
                <td>
                  <input className="num" type="number" min={0} defaultValue={p.PRICE_MONTHLY ?? ''} onBlur={(e) => patch(p.ID, { price_monthly: numOrNull(e.target.value) })} />
                </td>
                <td>
                  <input className="num" type="number" min={0} defaultValue={p.PRICE_YEARLY ?? ''} onBlur={(e) => patch(p.ID, { price_yearly: numOrNull(e.target.value) })} />
                </td>
                <td className="muted">{p.capabilities.length}</td>
                <td><input type="checkbox" checked={p.IS_ACTIVE} onChange={(e) => patch(p.ID, { is_active: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
