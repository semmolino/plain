import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Message } from '@/components/ui/Message'
import {
  fetchFeeGroups, fetchFeeMasters, fetchFeeZones,
  initFeeCalcMaster, saveFeeCalcBasis, initFeePhases, saveFeePhases,
  deleteFeeCalcMaster, attachFeeToStructure,
  type FeeCalcMaster, type FeePhaseRow,
} from '@/api/fee'
import { fetchProjectsShort, fetchProjectStructure } from '@/api/projekte'

const KX_OPTIONS = ['K0', 'K1', 'K2', 'K3', 'K4'] as const
type KX = typeof KX_OPTIONS[number]

function fmtN(v: number | null | undefined) {
  if (v == null) return ''
  return String(v)
}
function toNum(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
function revenueByKx(row: FeeCalcMaster, kx: KX): number | null {
  const map: Record<KX, number | null> = {
    K0: row.REVENUE_K0, K1: row.REVENUE_K1, K2: row.REVENUE_K2, K3: row.REVENUE_K3, K4: row.REVENUE_K4,
  }
  return map[kx]
}
function phaseRevenue(base: number | null, pct: number | null): number | null {
  if (base == null || pct == null) return null
  return (pct * base) / 100
}

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="wizard-steps">
      {[1,2,3,4].map(s => (
        <span key={s} className={`wizard-step${s === step ? ' active' : s < step ? ' done' : ''}`}>{s}</span>
      ))}
    </div>
  )
}

export function HonorarWizard() {
  const [step, setStep]     = useState(1)
  const [msg,  setMsg]      = useState<{ text: string; type: 'success'|'error'|'info' } | null>(null)
  const [loading, setLoading] = useState(false)

  // Step 1 state
  const [feeGroupId,  setFeeGroupId]  = useState('')
  const [feeMasterId, setFeeMasterId] = useState('')
  const [masters, setMasters]         = useState<Awaited<ReturnType<typeof fetchFeeMasters>>['data']>([])

  // Step 2 state (basis)
  const [calcMaster, setCalcMaster] = useState<FeeCalcMaster | null>(null)
  const [zones, setZones]           = useState<Awaited<ReturnType<typeof fetchFeeZones>>['data']>([])
  const [basis, setBasis]           = useState({
    NAME_SHORT: '', NAME_LONG: '', PROJECT_ID: '', ZONE_ID: '', ZONE_PERCENT: '',
    K0: '', K1: '', K2: '', K3: '', K4: '',
  })
  const [projectId, setProjectId]   = useState('')
  const [structureNodes, setStructureNodes] = useState<Awaited<ReturnType<typeof fetchProjectStructure>>['data']>([])

  // Step 3 state (phases)
  const [phases, setPhases]         = useState<FeePhaseRow[]>([])

  // Step 4 (overview + attach)
  const [fatherId, setFatherId]     = useState('')

  const { data: groupsData }   = useQuery({ queryKey: ['fee-groups'],   queryFn: fetchFeeGroups })
  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })

  const groups   = groupsData?.data   ?? []
  const projects = projectsData?.data ?? []

  // Derived structure nodes for selected project
  useEffect(() => {
    if (!projectId) { setStructureNodes([]); return }
    fetchProjectStructure(Number(projectId))
      .then(r => setStructureNodes(r.data ?? []))
      .catch(() => setStructureNodes([]))
  }, [projectId])

  async function loadMasters(gid: string) {
    setFeeGroupId(gid)
    setFeeMasterId('')
    setMasters([])
    if (!gid) return
    try {
      const r = await fetchFeeMasters(gid)
      setMasters(r.data ?? [])
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    }
  }

  function populateBasis(row: FeeCalcMaster) {
    setCalcMaster(row)
    setBasis({
      NAME_SHORT: row.NAME_SHORT ?? '',
      NAME_LONG:  row.NAME_LONG  ?? '',
      PROJECT_ID: row.PROJECT_ID != null ? String(row.PROJECT_ID) : '',
      ZONE_ID:    row.ZONE_ID    != null ? String(row.ZONE_ID) : '',
      ZONE_PERCENT: fmtN(row.ZONE_PERCENT),
      K0: fmtN(row.CONSTRUCTION_COSTS_K0),
      K1: fmtN(row.CONSTRUCTION_COSTS_K1),
      K2: fmtN(row.CONSTRUCTION_COSTS_K2),
      K3: fmtN(row.CONSTRUCTION_COSTS_K3),
      K4: fmtN(row.CONSTRUCTION_COSTS_K4),
    })
    setProjectId(row.PROJECT_ID != null ? String(row.PROJECT_ID) : '')
  }

  function syncPhases(master: FeeCalcMaster, rows: FeePhaseRow[]): FeePhaseRow[] {
    return rows.map(row => {
      const base = revenueByKx(master, (row.KX as KX) || 'K0')
      return { ...row, REVENUE_BASE: base, PHASE_REVENUE: phaseRevenue(base, row.FEE_PERCENT) }
    })
  }

  async function goNext1() {
    if (!feeMasterId) { setMsg({ text: 'Bitte Leistungsbild wählen', type: 'error' }); return }
    setLoading(true); setMsg({ text: 'Anlegen der Honorarberechnung …', type: 'info' })
    try {
      const row = await initFeeCalcMaster(Number(feeMasterId))
      const zonesRes = await fetchFeeZones(feeMasterId)
      setZones(zonesRes.data ?? [])
      populateBasis(row.data)
      setMsg(null); setStep(2)
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  async function saveBasisAndGo() {
    if (!calcMaster) return
    setLoading(true); setMsg({ text: 'Speichere Basisdaten …', type: 'info' })
    try {
      const updated = await saveFeeCalcBasis(calcMaster.ID, {
        NAME_SHORT:            basis.NAME_SHORT || null,
        NAME_LONG:             basis.NAME_LONG  || null,
        PROJECT_ID:            basis.PROJECT_ID ? Number(basis.PROJECT_ID) : null,
        ZONE_ID:               basis.ZONE_ID    ? Number(basis.ZONE_ID) : null,
        ZONE_PERCENT:          toNum(basis.ZONE_PERCENT),
        CONSTRUCTION_COSTS_K0: toNum(basis.K0),
        CONSTRUCTION_COSTS_K1: toNum(basis.K1),
        CONSTRUCTION_COSTS_K2: toNum(basis.K2),
        CONSTRUCTION_COSTS_K3: toNum(basis.K3),
        CONSTRUCTION_COSTS_K4: toNum(basis.K4),
      })
      populateBasis(updated.data)

      setMsg({ text: 'Lade Leistungsphasen …', type: 'info' })
      const phasesRes = await initFeePhases(calcMaster.ID)
      const rawPhases = phasesRes.data ?? []
      setPhases(syncPhases(updated.data, rawPhases))
      setMsg(null); setStep(3)
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  function updatePhaseKx(phaseId: number, kx: string) {
    if (!calcMaster) return
    setPhases(prev => {
      const updated = prev.map(p => {
        if (p.ID !== phaseId) return p
        const base = revenueByKx(calcMaster, kx as KX)
        return { ...p, KX: kx, REVENUE_BASE: base, PHASE_REVENUE: phaseRevenue(base, p.FEE_PERCENT) }
      })
      return updated
    })
  }

  function updatePhasePct(phaseId: number, pctStr: string) {
    if (!calcMaster) return
    const pct = toNum(pctStr)
    setPhases(prev => prev.map(p => {
      if (p.ID !== phaseId) return p
      const base = revenueByKx(calcMaster, (p.KX as KX) || 'K0')
      return { ...p, FEE_PERCENT: pct, REVENUE_BASE: base, PHASE_REVENUE: phaseRevenue(base, pct) }
    }))
  }

  async function savePhasesAndGo() {
    if (!calcMaster) return
    setLoading(true); setMsg({ text: 'Speichere Leistungsphasen …', type: 'info' })
    try {
      const saved = await saveFeePhases(calcMaster.ID, phases.map(p => ({
        ID: p.ID, KX: p.KX || 'K0', FEE_PERCENT: p.FEE_PERCENT,
      })))
      setPhases(syncPhases(calcMaster, saved.data ?? []))
      setMsg(null); setStep(4)
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  async function finish() {
    if (!calcMaster) return
    if (!fatherId) { setMsg({ text: 'Bitte übergeordnetes Strukturelement wählen', type: 'error' }); return }
    setLoading(true); setMsg({ text: 'Erzeuge Projektstruktur …', type: 'info' })
    try {
      const res = await attachFeeToStructure(calcMaster.ID, Number(fatherId))
      setMsg({ text: res.message || 'HOAI-Struktur wurde angelegt ✅', type: 'success' })
      // Reset wizard
      setStep(1); setCalcMaster(null); setPhases([]); setFeeGroupId(''); setFeeMasterId('')
      setMasters([]); setBasis({ NAME_SHORT: '', NAME_LONG: '', PROJECT_ID: '', ZONE_ID: '', ZONE_PERCENT: '', K0: '', K1: '', K2: '', K3: '', K4: '' })
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  async function cancelAndDelete() {
    if (calcMaster) {
      try { await deleteFeeCalcMaster(calcMaster.ID) } catch { /* ignore */ }
    }
    setStep(1); setCalcMaster(null); setPhases([]); setFeeGroupId(''); setFeeMasterId(''); setMasters([])
    setMsg(null)
  }

  const totalPhasePct = phases.reduce((s, p) => s + (p.FEE_PERCENT ?? 0), 0)
  const totalPhaseRev = phases.reduce((s, p) => s + (p.PHASE_REVENUE ?? 0), 0)

  return (
    <div className="wizard-wrap">
      <StepIndicator step={step} />

      {/* ── Step 1: Honorarordnung ── */}
      {step === 1 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 1: Honorarordnung &amp; Leistungsbild</h3>
          <div className="form-group">
            <label>Honorarordnung</label>
            <select value={feeGroupId} onChange={e => void loadMasters(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {groups.map(g => <option key={g.ID} value={g.ID}>{g.NAME_SHORT}{g.NAME_LONG ? ' – ' + g.NAME_LONG : ''}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Leistungsbild</label>
            <select value={feeMasterId} onChange={e => setFeeMasterId(e.target.value)} disabled={!feeGroupId}>
              <option value="">{feeGroupId ? 'Bitte wählen …' : 'Erst Honorarordnung wählen …'}</option>
              {masters.map(m => <option key={m.ID} value={m.ID}>{m.NAME_SHORT}{m.NAME_LONG ? ' – ' + m.NAME_LONG : ''}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* ── Step 2: Basis ── */}
      {step === 2 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 2: Basisdaten</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Paragraph</label>
              <input value={basis.NAME_SHORT} onChange={e => setBasis(b => ({ ...b, NAME_SHORT: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Bezeichnung</label>
              <input value={basis.NAME_LONG} onChange={e => setBasis(b => ({ ...b, NAME_LONG: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label>Projekt</label>
            <select value={basis.PROJECT_ID} onChange={e => { setBasis(b => ({ ...b, PROJECT_ID: e.target.value })); setProjectId(e.target.value) }}>
              <option value="">—</option>
              {projects.map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Honorarzone</label>
            <select value={basis.ZONE_ID} onChange={e => setBasis(b => ({ ...b, ZONE_ID: e.target.value }))}>
              <option value="">—</option>
              {zones.map(z => <option key={z.ID} value={z.ID}>{z.NAME_SHORT}{z.NAME_LONG ? ' – ' + z.NAME_LONG : ''}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Zonenanteil %</label>
            <input type="number" step="0.01" value={basis.ZONE_PERCENT} onChange={e => setBasis(b => ({ ...b, ZONE_PERCENT: e.target.value }))} />
          </div>
          <p className="admin-block-title" style={{ marginTop: 12 }}>Baukosten (€)</p>
          <div className="fee-k-grid">
            {(['K0','K1','K2','K3','K4'] as const).map(k => (
              <div key={k} className="form-group">
                <label>{k}</label>
                <input type="number" step="0.01" value={(basis as Record<string, string>)[k]} onChange={e => setBasis(b => ({ ...b, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 3: Leistungsphasen ── */}
      {step === 3 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 3: Leistungsphasen</h3>
          <div className="table-scroll">
            <table className="master-table">
              <thead>
                <tr><th>Phase</th><th>Basis%</th><th>Kx</th><th>Basis €</th><th>Honorar %</th><th>Honorar €</th></tr>
              </thead>
              <tbody>
                {phases.map(p => (
                  <tr key={p.ID}>
                    <td>{p.PHASE_LABEL}</td>
                    <td>{fmtN(p.FEE_PERCENT_BASE)}</td>
                    <td>
                      <select value={p.KX || 'K0'} onChange={e => updatePhaseKx(p.ID, e.target.value)} style={{ fontSize: 11 }}>
                        {KX_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </td>
                    <td><input readOnly style={{ width: 80 }} value={fmtN(p.REVENUE_BASE)} /></td>
                    <td><input type="number" step="0.01" style={{ width: 80 }} value={fmtN(p.FEE_PERCENT)} onChange={e => updatePhasePct(p.ID, e.target.value)} /></td>
                    <td><input readOnly style={{ width: 80 }} value={fmtN(p.PHASE_REVENUE)} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={4}>Summe</th>
                  <th>{fmtN(totalPhasePct)}</th>
                  <th>{fmtN(totalPhaseRev)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Step 4: Übersicht + Zuordnen ── */}
      {step === 4 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 4: Übersicht &amp; Zuordnen</h3>
          <div className="admin-block">
            <p><strong>Leistungsbild:</strong> {calcMaster?.NAME_SHORT} {calcMaster?.NAME_LONG && '– ' + calcMaster.NAME_LONG}</p>
            <p><strong>Gesamthonorar:</strong> {fmtN(totalPhaseRev)} €</p>
            <p><strong>Gesamtprozent:</strong> {fmtN(totalPhasePct)} %</p>
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Übergeordnetes Strukturelement*</label>
            <select value={fatherId} onChange={e => setFatherId(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {structureNodes.map(s => (
                <option key={s.STRUCTURE_ID} value={s.STRUCTURE_ID}>
                  {s.NAME_SHORT} – {s.NAME_LONG}
                </option>
              ))}
            </select>
            {!basis.PROJECT_ID && <p className="empty-note">Erst Projekt in Schritt 2 wählen, um Strukturelemente zu laden.</p>}
          </div>
        </div>
      )}

      <Message text={msg?.text ?? null} type={msg?.type} />

      <div className="wizard-nav">
        {step > 1 && <button type="button" onClick={cancelAndDelete} disabled={loading}>Abbrechen &amp; Löschen</button>}
        {step === 1 && <button className="btn-primary" type="button" onClick={goNext1} disabled={loading || !feeMasterId}>Weiter →</button>}
        {step === 2 && <button className="btn-primary" type="button" onClick={saveBasisAndGo} disabled={loading}>Speichern &amp; Weiter →</button>}
        {step === 3 && <button className="btn-primary" type="button" onClick={savePhasesAndGo} disabled={loading}>Speichern &amp; Weiter →</button>}
        {step === 4 && <button className="btn-primary" type="button" onClick={finish} disabled={loading || !fatherId}>Projektstruktur anlegen</button>}
      </div>
    </div>
  )
}
