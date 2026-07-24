import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type Plan, type PlanPatch } from '../api'

function numOrNull(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function fmtPrice(v: number | null): string {
  return v == null ? '' : String(v)
}

export function PlansView() {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [priceM, setPriceM] = useState('')
  const [priceY, setPriceY] = useState('')

  const load = useCallback(async () => {
    try {
      setPlans((await api.plans()).plans)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
      setNotice(`Plan „${name.trim()}" angelegt. Jetzt in der Matrix Capabilities zuordnen.`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function patch(id: number, body: PlanPatch, msg?: string) {
    setError(null)
    try {
      await api.updatePlan(id, body)
      await load()
      if (msg) setNotice(msg)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.')
      await load() // fehlgeschlagene Eingabe verwerfen -> Feld zeigt Serverwert
    }
  }

  async function remove(p: Plan) {
    if (!window.confirm(`Plan „${p.NAME_DE}" wirklich löschen?`)) return
    setError(null)
    try {
      await api.deletePlan(p.ID)
      setNotice(`Plan „${p.NAME_DE}" gelöscht.`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen.')
    }
  }

  async function duplicate(p: Plan) {
    const newKey = window.prompt(`Neuer Schlüssel für die Kopie von „${p.NAME_DE}":`, `${p.KEY}_kopie`)
    if (!newKey) return
    const newName = window.prompt('Name der Kopie:', `${p.NAME_DE} (Kopie)`)
    if (!newName) return
    setError(null)
    try {
      const r = await api.duplicatePlan(p.ID, newKey.trim(), newName.trim())
      setNotice(`„${newName}" angelegt (${r.copied_capabilities} Capabilities übernommen, zunächst inaktiv).`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Duplizieren fehlgeschlagen.')
    }
  }

  if (loadError && !plans)
    return (
      <div className="error">
        {loadError} <button className="link" onClick={() => void load()}>Erneut versuchen</button>
      </div>
    )
  if (!plans) return <div className="muted">Lädt…</div>

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Pläne</h2>
          <p className="muted">Pakete, denen in der Matrix Capabilities zugeordnet werden. Änderungen ohne Deploy.</p>
        </div>
      </div>
      {error && <div className="error">{error} <button className="link" onClick={() => setError(null)}>ausblenden</button></div>}
      {notice && <div className="ok-banner">{notice} <button className="link" onClick={() => setNotice(null)}>ok</button></div>}

      <form className="plan-new" onSubmit={create}>
        <input placeholder="Schlüssel (z.B. pro)" value={key} onChange={(e) => setKey(e.target.value)} required />
        <input placeholder="Name (z.B. Pro)" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="€/Monat" type="number" min={0} step="0.01" value={priceM} onChange={(e) => setPriceM(e.target.value)} />
        <input placeholder="€/Jahr" type="number" min={0} step="0.01" value={priceY} onChange={(e) => setPriceY(e.target.value)} />
        <button className="primary small-btn" disabled={busy}>+ Plan</button>
      </form>

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>Schlüssel</th>
              <th>Name</th>
              <th>Beschreibung</th>
              <th className="num-col">€/Monat</th>
              <th className="num-col">€/Jahr</th>
              <th className="num-col">Reihenf.</th>
              <th className="num-col">Caps</th>
              <th className="num-col">Version</th>
              <th>Aktiv</th>
              <th>Standard</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.ID}>
                <td><code>{p.KEY}</code></td>
                <td>
                  <input
                    defaultValue={p.NAME_DE}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== p.NAME_DE && patch(p.ID, { name_de: e.target.value.trim() })}
                  />
                </td>
                <td>
                  <input
                    className="wide"
                    defaultValue={p.DESCRIPTION_DE ?? ''}
                    placeholder="—"
                    onBlur={(e) => e.target.value !== (p.DESCRIPTION_DE ?? '') && patch(p.ID, { description_de: e.target.value || null })}
                  />
                </td>
                <td>
                  <input className="num" type="number" min={0} step="0.01" defaultValue={fmtPrice(p.PRICE_MONTHLY)} onBlur={(e) => {
                    const v = numOrNull(e.target.value)
                    if (v !== p.PRICE_MONTHLY) patch(p.ID, { price_monthly: v })
                  }} />
                </td>
                <td>
                  <input className="num" type="number" min={0} step="0.01" defaultValue={fmtPrice(p.PRICE_YEARLY)} onBlur={(e) => {
                    const v = numOrNull(e.target.value)
                    if (v !== p.PRICE_YEARLY) patch(p.ID, { price_yearly: v })
                  }} />
                </td>
                <td>
                  <input className="num" type="number" defaultValue={p.POSITION} onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isInteger(v) && v !== p.POSITION) patch(p.ID, { position: v })
                  }} />
                </td>
                <td className="muted num-col">
                  {p.capabilities.length}
                  {p.IS_ACTIVE && p.capabilities.length === 0 && (
                    <span className="tag-open" title="Aktiver Plan ohne Capabilities">leer</span>
                  )}
                </td>
                <td className="muted num-col">{p.VERSION}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={p.IS_ACTIVE}
                    onChange={(e) => patch(p.ID, { is_active: e.target.checked }, e.target.checked ? undefined : `„${p.NAME_DE}" deaktiviert.`)}
                  />
                </td>
                <td>
                  <input
                    type="radio"
                    name="default-plan"
                    checked={!!p.IS_DEFAULT}
                    onChange={() => patch(p.ID, { is_default: true }, `„${p.NAME_DE}" ist jetzt Standard für neue Mandanten.`)}
                    title="Standard-Plan für neue Registrierungen"
                  />
                </td>
                <td className="nowrap">
                  <button className="link" onClick={() => void duplicate(p)}>duplizieren</button>
                  {!p.IS_DEFAULT && (p.tenant_count ?? 0) === 0 && (
                    <button className="link danger" onClick={() => void remove(p)}>löschen</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        Der <strong>Standard-Plan</strong> wird neuen Mandanten bei der Registrierung automatisch zugewiesen.
        Pläne mit zugewiesenen Mandanten lassen sich nicht löschen — erst umziehen.
      </p>
    </div>
  )
}
