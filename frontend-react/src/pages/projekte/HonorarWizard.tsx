import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Message } from '@/components/ui/Message'
import {
  fetchFeeGroups, fetchFeeMasters, fetchFeeZones,
  fetchFeeCalcMasters, fetchFeeCalcMaster,
  initFeeCalcMaster, saveFeeCalcBasis, initFeePhases, saveFeePhases,
  deleteFeeCalcMaster, attachFeeToStructure,
  fetchFeeSurchargesGlobal, fetchFeeCalcSurcharges, saveFeeCalcSurcharges,
  openHonorarPdf,
  type FeeCalcMaster, type FeePhaseRow, type FeeCalcSurcharge, type FeeSurchargeGlobal,
} from '@/api/fee'
import { fetchProjectsShort, fetchProjectStructure, fetchParentChildCheck } from '@/api/projekte'

const KX_OPTIONS = ['K0', 'K1', 'K2', 'K3', 'K4'] as const
type KX = typeof KX_OPTIONS[number]

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function fmtEur(v: number | null | undefined) {
  if (v == null) return '—'
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

function revenueByKx(row: FeeCalcMaster, kx: KX): number | null {
  const map: Record<KX, number | null> = {
    K0: row.REVENUE_K0, K1: row.REVENUE_K1, K2: row.REVENUE_K2,
    K3: row.REVENUE_K3, K4: row.REVENUE_K4,
  }
  return map[kx]
}

function phaseRevenue(base: number | null, pct: number | null): number | null {
  if (base == null || pct == null) return null
  return (pct * base) / 100
}

function newSurchargeRow(calcMasterId: number, sortOrder: number): FeeCalcSurcharge {
  return {
    FEE_CALC_MASTER_ID: calcMasterId, FEE_SURCHARGE_ID: null,
    NAME_SHORT: '', NAME_LONG: '', PERCENT: null, BASE_AMOUNT: null, AMOUNT: null,
    SORT_ORDER: sortOrder,
  }
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ step, totalSteps }: { step: number; totalSteps: number }) {
  return (
    <div className="wizard-steps">
      {Array.from({ length: totalSteps }, (_, i) => i + 1).map(s => (
        <span key={s} className={`wizard-step${s === step ? ' active' : s < step ? ' done' : ''}`}>{s}</span>
      ))}
    </div>
  )
}

// ── Wizard component ──────────────────────────────────────────────────────────

interface WizardProps {
  /** When provided, wizard starts in edit mode loading the existing calc */
  existingId?: number | null
  onDone?: () => void
}

export function HonorarWizard({ existingId, onDone }: WizardProps) {
  const qc = useQueryClient()
  const isEdit = !!existingId

  // In create mode: steps 1-5. In edit mode: steps 2-4 (no fee-master select, no structure attach)
  const firstStep = isEdit ? 2 : 1
  const lastStep  = isEdit ? 4 : 5
  const totalSteps = isEdit ? 3 : 5  // dots in StepIndicator
  // Map internal step → display dot number
  function dotFor(s: number) { return isEdit ? s - 1 : s }

  const [step, setStep]       = useState(firstStep)
  const [msg, setMsg]         = useState<{ text: string; type: 'success'|'error'|'info' } | null>(null)
  const [loading, setLoading] = useState(false)

  // Step 1 state (create only)
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
  const [projectId, setProjectId]           = useState('')
  const [structureNodes, setStructureNodes] = useState<Awaited<ReturnType<typeof fetchProjectStructure>>['data']>([])

  // Step 3 state (phases)
  const [phases, setPhases]   = useState<FeePhaseRow[]>([])

  // Step 4 state (surcharges)
  const [surcharges, setSurcharges]                 = useState<FeeCalcSurcharge[]>([])
  const [globalSurcharges, setGlobalSurcharges]     = useState<FeeSurchargeGlobal[]>([])

  // Step 5 (attach to structure)
  const [fatherId, setFatherId] = useState('')

  const { data: groupsData }   = useQuery({ queryKey: ['fee-groups'],     queryFn: fetchFeeGroups })
  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })

  const groups   = groupsData?.data   ?? []
  const projects = projectsData?.data ?? []

  const totalPhaseRev = phases.reduce((s, p) => s + (p.PHASE_REVENUE ?? 0), 0)
  const totalSurchargeAmt = surcharges.reduce((s, r) => s + (((r.PERCENT ?? 0) / 100) * totalPhaseRev), 0)

  // Load structure nodes when project changes
  useEffect(() => {
    if (!projectId) { setStructureNodes([]); return }
    fetchProjectStructure(Number(projectId))
      .then(r => setStructureNodes(r.data ?? []))
      .catch(() => setStructureNodes([]))
  }, [projectId])

  // In edit mode: load existing calc on mount
  useEffect(() => {
    if (!existingId) return
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetchFeeCalcMaster(existingId)
        await loadCalcIntoState(res.data)
      } catch (e: unknown) {
        setMsg({ text: (e as Error).message, type: 'error' })
      } finally {
        setLoading(false)
      }
    })()
  }, [existingId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadCalcIntoState = useCallback(async (row: FeeCalcMaster) => {
    setCalcMaster(row)
    setBasis({
      NAME_SHORT:   row.NAME_SHORT ?? '',
      NAME_LONG:    row.NAME_LONG  ?? '',
      PROJECT_ID:   row.PROJECT_ID != null ? String(row.PROJECT_ID) : '',
      ZONE_ID:      row.ZONE_ID    != null ? String(row.ZONE_ID) : '',
      ZONE_PERCENT: fmtN(row.ZONE_PERCENT),
      K0: fmtN(row.CONSTRUCTION_COSTS_K0),
      K1: fmtN(row.CONSTRUCTION_COSTS_K1),
      K2: fmtN(row.CONSTRUCTION_COSTS_K2),
      K3: fmtN(row.CONSTRUCTION_COSTS_K3),
      K4: fmtN(row.CONSTRUCTION_COSTS_K4),
    })
    setProjectId(row.PROJECT_ID != null ? String(row.PROJECT_ID) : '')
    if (row.FEE_MASTER_ID) {
      const zonesRes = await fetchFeeZones(row.FEE_MASTER_ID)
      setZones(zonesRes.data ?? [])
    }
  }, [])

  function syncPhases(master: FeeCalcMaster, rows: FeePhaseRow[]): FeePhaseRow[] {
    return rows.map(row => {
      const base = revenueByKx(master, (row.KX as KX) || 'K0')
      return { ...row, REVENUE_BASE: base, PHASE_REVENUE: phaseRevenue(base, row.FEE_PERCENT) }
    })
  }

  async function loadMasters(gid: string) {
    setFeeGroupId(gid); setFeeMasterId(''); setMasters([])
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
      NAME_SHORT:   row.NAME_SHORT ?? '',
      NAME_LONG:    row.NAME_LONG  ?? '',
      PROJECT_ID:   row.PROJECT_ID != null ? String(row.PROJECT_ID) : '',
      ZONE_ID:      row.ZONE_ID    != null ? String(row.ZONE_ID) : '',
      ZONE_PERCENT: fmtN(row.ZONE_PERCENT),
      K0: fmtN(row.CONSTRUCTION_COSTS_K0), K1: fmtN(row.CONSTRUCTION_COSTS_K1),
      K2: fmtN(row.CONSTRUCTION_COSTS_K2), K3: fmtN(row.CONSTRUCTION_COSTS_K3),
      K4: fmtN(row.CONSTRUCTION_COSTS_K4),
    })
    setProjectId(row.PROJECT_ID != null ? String(row.PROJECT_ID) : '')
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

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
      setPhases(syncPhases(updated.data, phasesRes.data ?? []))
      setMsg(null); setStep(3)
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  async function savePhasesAndGo() {
    if (!calcMaster) return
    setLoading(true); setMsg({ text: 'Speichere Leistungsphasen …', type: 'info' })
    try {
      const saved = await saveFeePhases(calcMaster.ID, phases.map(p => ({
        ID: p.ID, KX: p.KX || 'K0', FEE_PERCENT: p.FEE_PERCENT,
      })))
      const synced = syncPhases(calcMaster, saved.data ?? [])
      setPhases(synced)
      // Load surcharges for step 4
      setMsg({ text: 'Lade Zuschläge …', type: 'info' })
      const [surRes, globalRes] = await Promise.all([
        fetchFeeCalcSurcharges(calcMaster.ID),
        calcMaster.FEE_MASTER_ID ? fetchFeeSurchargesGlobal(calcMaster.FEE_MASTER_ID) : Promise.resolve({ data: [] as FeeSurchargeGlobal[] }),
      ])
      setGlobalSurcharges(globalRes.data ?? [])
      // Pre-populate BASE_AMOUNT on existing surcharge rows
      const grundhonorar = synced.reduce((s, p) => s + (p.PHASE_REVENUE ?? 0), 0)
      setSurcharges((surRes.data ?? []).map(r => ({ ...r, BASE_AMOUNT: r.BASE_AMOUNT ?? grundhonorar })))
      setMsg(null); setStep(4)
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  async function saveSurchargesAndGo() {
    if (!calcMaster) return
    setLoading(true); setMsg({ text: 'Speichere Zuschläge …', type: 'info' })
    try {
      await saveFeeCalcSurcharges(calcMaster.ID, surcharges.map((r, i) => ({ ...r, SORT_ORDER: i, BASE_AMOUNT: totalPhaseRev })))
      setMsg(null)
      if (isEdit) {
        void qc.invalidateQueries({ queryKey: ['fee-calc-masters'] })
        onDone?.()
      } else {
        setStep(5)
      }
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  async function finish() {
    if (!calcMaster) return
    if (!fatherId) { setMsg({ text: 'Bitte übergeordnetes Strukturelement wählen', type: 'error' }); return }
    try {
      const check = await fetchParentChildCheck(Number(fatherId))
      if (check.status === 'blocked') {
        setMsg({ text: check.reason ?? 'Dieses Element kann keine Unterelemente erhalten.', type: 'error' }); return
      }
      if (check.status === 'needs_transfer') {
        const confirmMsg = check.hasTec
          ? 'Das übergeordnete Element enthält bereits Buchungen. Diese werden auf das erste neue Element übertragen. Fortfahren?'
          : 'Das übergeordnete Element enthält bereits Werte. Fortfahren?'
        if (!confirm(confirmMsg)) return
      }
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message ?? 'Fehler beim Prüfen des übergeordneten Elements', type: 'error' }); return
    }
    setLoading(true); setMsg({ text: 'Erzeuge Projektstruktur …', type: 'info' })
    try {
      const res = await attachFeeToStructure(calcMaster.ID, Number(fatherId), true)
      setMsg({ text: res.message || 'HOAI-Struktur wurde angelegt ✅', type: 'success' })
      if (calcMaster.PROJECT_ID != null) {
        void qc.invalidateQueries({ queryKey: ['structure', calcMaster.PROJECT_ID] })
      }
      void qc.invalidateQueries({ queryKey: ['fee-calc-masters'] })
      resetWizard()
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  function resetWizard() {
    setStep(firstStep); setCalcMaster(null); setPhases([]); setSurcharges([])
    setFeeGroupId(''); setFeeMasterId(''); setMasters([])
    setBasis({ NAME_SHORT: '', NAME_LONG: '', PROJECT_ID: '', ZONE_ID: '', ZONE_PERCENT: '', K0: '', K1: '', K2: '', K3: '', K4: '' })
    setFatherId(''); setMsg(null)
    onDone?.()
  }

  async function cancelAndDelete() {
    if (!isEdit && calcMaster) {
      try { await deleteFeeCalcMaster(calcMaster.ID) } catch { /* ignore */ }
    }
    setStep(firstStep); setCalcMaster(null); setPhases([]); setSurcharges([])
    setFeeGroupId(''); setFeeMasterId(''); setMasters([])
    setMsg(null)
    onDone?.()
  }

  // ── Surcharge row helpers ────────────────────────────────────────────────────

  function addSurchargeFromGlobal(g: FeeSurchargeGlobal) {
    if (!calcMaster) return
    setSurcharges(prev => [
      ...prev,
      {
        FEE_CALC_MASTER_ID: calcMaster.ID, FEE_SURCHARGE_ID: g.ID,
        NAME_SHORT: g.NAME_SHORT, NAME_LONG: g.NAME_LONG ?? '',
        PERCENT: null, BASE_AMOUNT: totalPhaseRev, AMOUNT: null,
        SORT_ORDER: prev.length,
      },
    ])
  }

  function addCustomSurcharge() {
    if (!calcMaster) return
    setSurcharges(prev => [...prev, newSurchargeRow(calcMaster.ID, prev.length)])
  }

  function updateSurcharge(idx: number, field: keyof FeeCalcSurcharge, value: string | number | null) {
    setSurcharges(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  function removeSurcharge(idx: number) {
    setSurcharges(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Phase row helpers ────────────────────────────────────────────────────────

  function updatePhaseKx(phaseId: number, kx: string) {
    if (!calcMaster) return
    setPhases(prev => prev.map(p => {
      if (p.ID !== phaseId) return p
      const base = revenueByKx(calcMaster, kx as KX)
      return { ...p, KX: kx, REVENUE_BASE: base, PHASE_REVENUE: phaseRevenue(base, p.FEE_PERCENT) }
    }))
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

  const totalPhasePct = phases.reduce((s, p) => s + (p.FEE_PERCENT ?? 0), 0)
  const alreadyAdded  = new Set(surcharges.map(r => r.FEE_SURCHARGE_ID).filter((id): id is number => id != null))

  return (
    <div className="wizard-wrap">
      <StepIndicator step={dotFor(step)} totalSteps={totalSteps} />

      {/* ── Step 1: Honorarordnung (create only) ─────────────────────────────── */}
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

      {/* ── Step 2: Basisdaten ────────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">{isEdit ? 'Schritt 1' : 'Schritt 2'}: Basisdaten</h3>
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

      {/* ── Step 3: Leistungsphasen ────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">{isEdit ? 'Schritt 2' : 'Schritt 3'}: Leistungsphasen</h3>
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
                      <select className="tbl-select" value={p.KX || 'K0'} onChange={e => updatePhaseKx(p.ID, e.target.value)}>
                        {KX_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </td>
                    <td><input className="tbl-input" readOnly style={{ width: 90 }} value={fmtN(p.REVENUE_BASE)} /></td>
                    <td><input className="tbl-input" type="number" step="0.01" style={{ width: 80 }} value={fmtN(p.FEE_PERCENT)} onChange={e => updatePhasePct(p.ID, e.target.value)} /></td>
                    <td><input className="tbl-input" readOnly style={{ width: 90 }} value={fmtN(p.PHASE_REVENUE)} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={4}>Grundhonorar</th>
                  <th>{fmtN(totalPhasePct)}</th>
                  <th>{fmtN(totalPhaseRev)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Step 4: Zuschläge & Nachlässe ────────────────────────────────────── */}
      {step === 4 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">{isEdit ? 'Schritt 3' : 'Schritt 4'}: Zuschläge &amp; Nachlässe</h3>

          <div className="admin-block" style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: '#374151' }}>Grundhonorar (Summe LPH): </span>
            <strong style={{ fontSize: 14 }}>{fmtEur(totalPhaseRev)}</strong>
          </div>

          {/* Global suggestions */}
          {globalSurcharges.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#6b7280', marginRight: 8 }}>Vorschläge:</span>
              {globalSurcharges.filter(g => !alreadyAdded.has(g.ID)).map(g => (
                <button key={g.ID} type="button" className="btn-small" style={{ marginRight: 6, marginBottom: 4 }}
                  onClick={() => addSurchargeFromGlobal(g)}>
                  + {g.NAME_SHORT}
                </button>
              ))}
            </div>
          )}

          {/* Surcharge table */}
          {surcharges.length > 0 && (
            <div className="table-scroll" style={{ marginBottom: 8 }}>
              <table className="master-table">
                <thead>
                  <tr>
                    <th style={{ width: '30%' }}>Kurzbezeichnung</th>
                    <th style={{ width: '30%' }}>Langbezeichnung</th>
                    <th style={{ width: 80 }}>% (neg. = Nachlass)</th>
                    <th style={{ width: 110 }}>Betrag €</th>
                    <th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {surcharges.map((r, idx) => {
                    const amt = ((r.PERCENT ?? 0) / 100) * totalPhaseRev
                    return (
                      <tr key={idx}>
                        <td>
                          <input className="tbl-input" style={{ width: '100%' }} value={r.NAME_SHORT ?? ''}
                            onChange={e => updateSurcharge(idx, 'NAME_SHORT', e.target.value)} />
                        </td>
                        <td>
                          <input className="tbl-input" style={{ width: '100%' }} value={r.NAME_LONG ?? ''}
                            onChange={e => updateSurcharge(idx, 'NAME_LONG', e.target.value)} />
                        </td>
                        <td>
                          <input className="tbl-input" type="number" step="0.01" style={{ width: 80 }}
                            value={r.PERCENT != null ? String(r.PERCENT) : ''}
                            onChange={e => updateSurcharge(idx, 'PERCENT', toNum(e.target.value))} />
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: amt >= 0 ? '#166534' : '#991b1b' }}>
                          {fmtEur(amt)}
                        </td>
                        <td>
                          <button type="button" className="btn-small" title="Entfernen"
                            onClick={() => removeSurcharge(idx)}>×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={3}>Summe Zuschläge / Nachlässe</th>
                    <th style={{ textAlign: 'right', color: totalSurchargeAmt >= 0 ? '#166534' : '#991b1b' }}>
                      {fmtEur(totalSurchargeAmt)}
                    </th>
                    <th></th>
                  </tr>
                  <tr>
                    <th colSpan={3}>Gesamthonorar</th>
                    <th style={{ textAlign: 'right', fontSize: 14 }}>{fmtEur(totalPhaseRev + totalSurchargeAmt)}</th>
                    <th></th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <button type="button" className="btn-small" onClick={addCustomSurcharge}>+ Zuschlag / Nachlass hinzufügen</button>
        </div>
      )}

      {/* ── Step 5: Übersicht + Zuordnen (create only) ────────────────────────── */}
      {step === 5 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 5: Übersicht &amp; Zuordnen</h3>
          <div className="admin-block">
            <p><strong>Leistungsbild:</strong> {calcMaster?.NAME_SHORT} {calcMaster?.NAME_LONG && '– ' + calcMaster.NAME_LONG}</p>
            <p><strong>Grundhonorar:</strong> {fmtEur(totalPhaseRev)}</p>
            {surcharges.length > 0 && <p><strong>Zuschläge / Nachlässe:</strong> {fmtEur(totalSurchargeAmt)}</p>}
            <p><strong>Gesamthonorar:</strong> {fmtEur(totalPhaseRev + totalSurchargeAmt)}</p>
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
        {step > firstStep && (
          <button type="button" onClick={cancelAndDelete} disabled={loading}>
            {isEdit ? 'Abbrechen' : 'Abbrechen & Löschen'}
          </button>
        )}
        {step === 1 && (
          <button className="btn-primary" type="button" onClick={goNext1} disabled={loading || !feeMasterId}>Weiter →</button>
        )}
        {step === 2 && (
          <button className="btn-primary" type="button" onClick={saveBasisAndGo} disabled={loading}>Speichern &amp; Weiter →</button>
        )}
        {step === 3 && (
          <button className="btn-primary" type="button" onClick={savePhasesAndGo} disabled={loading}>Speichern &amp; Weiter →</button>
        )}
        {step === 4 && (
          <button className="btn-primary" type="button" onClick={saveSurchargesAndGo} disabled={loading}>
            {isEdit ? 'Speichern & Fertig' : 'Weiter →'}
          </button>
        )}
        {step === 5 && (
          <button className="btn-primary" type="button" onClick={finish} disabled={loading || !fatherId}>Projektstruktur anlegen</button>
        )}
      </div>
    </div>
  )
}

// ── HonorarTab: list + wizard ─────────────────────────────────────────────────

type WizardMode = null | { mode: 'create' } | { mode: 'edit'; id: number }

function fmtEurShort(v: number | null | undefined) {
  if (v == null) return '—'
  return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

export function HonorarTab() {
  const [wizardMode, setWizardMode] = useState<WizardMode>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['fee-calc-masters'],
    queryFn:  () => fetchFeeCalcMasters(),
  })
  const rows = data?.data ?? []

  function handleDone() {
    setWizardMode(null)
    void refetch()
  }

  if (wizardMode !== null) {
    return (
      <div>
        <button type="button" className="btn-small" style={{ marginBottom: 12 }} onClick={handleDone}>
          ← Zurück zur Übersicht
        </button>
        <HonorarWizard
          existingId={wizardMode.mode === 'edit' ? wizardMode.id : null}
          onDone={handleDone}
        />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn-primary" type="button" onClick={() => setWizardMode({ mode: 'create' })}>
          + Neue Honorarberechnung
        </button>
      </div>

      {isLoading && <p className="empty-note">Lade …</p>}
      {!isLoading && rows.length === 0 && (
        <p className="empty-note">Noch keine Honorarberechnungen vorhanden.</p>
      )}

      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="master-table">
            <thead>
              <tr>
                <th>§</th>
                <th>Bezeichnung</th>
                <th>Projekt</th>
                <th style={{ textAlign: 'right' }}>Grundhonorar</th>
                <th style={{ textAlign: 'right' }}>Zuschläge</th>
                <th style={{ textAlign: 'right' }}>Gesamthonorar</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ID}>
                  <td>{r.NAME_SHORT || '—'}</td>
                  <td>{r.NAME_LONG || '—'}</td>
                  <td>{r.projectLabel || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmtEurShort(r.grundhonorar)}</td>
                  <td style={{ textAlign: 'right', color: (r.zuschlaegeSum ?? 0) !== 0 ? (r.zuschlaegeSum ?? 0) >= 0 ? '#166534' : '#991b1b' : undefined }}>
                    {(r.zuschlaegeSum ?? 0) !== 0 ? fmtEurShort(r.zuschlaegeSum) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtEurShort(r.gesamthonorar)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className="btn-small"
                        onClick={() => setWizardMode({ mode: 'edit', id: r.ID })}>
                        Bearbeiten
                      </button>
                      <button type="button" className="btn-small"
                        onClick={() => openHonorarPdf(r.ID)}>
                        PDF
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
