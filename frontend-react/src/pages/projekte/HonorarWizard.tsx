import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Message } from '@/components/ui/Message'
import {
  fetchFeeGroups, fetchFeeMasters, fetchFeeZones,
  fetchFeeCalcMasters, fetchFeeCalcMaster,
  initFeeCalcMaster, saveFeeCalcBasis, initFeePhases, saveFeePhases,
  deleteFeeCalcMaster, attachFeeToStructure,
  fetchFeeSurchargesGlobal, fetchFeeCalcSurcharges, saveFeeCalcSurcharges,
  fetchFeeCalcBl, saveFeeCalcBl,
  openHonorarPdf, syncFeeCalcToStructure,
  type FeeCalcMaster, type FeePhaseRow, type FeeCalcSurcharge, type FeeSurchargeGlobal, type FeeCalcBl,
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

/** Compute effective base and amount for each surcharge row, honouring LPH filter + calc mode + BL inclusion */
function computeSurchargeEffects(
  phases: FeePhaseRow[],
  surcharges: FeeCalcSurcharge[],
  blTotal = 0,
): { effectiveBase: number; amount: number }[] {
  const results: { effectiveBase: number; amount: number }[] = []
  let runningTotal = 0
  for (const r of surcharges) {
    const selectedIds: number[] = r.LPH_FILTER
      ? (JSON.parse(r.LPH_FILTER) as number[])
      : phases.map(p => p.ID)
    const phaseBase = phases
      .filter(p => selectedIds.includes(p.ID))
      .reduce((s, p) => s + (p.PHASE_REVENUE ?? 0), 0)
    const blContrib = r.INCLUDE_BL ? blTotal : 0
    const base = phaseBase + blContrib
    const effectiveBase = r.CALC_MODE === 'cumulative' ? base + runningTotal : base
    const amount = ((r.PERCENT ?? 0) / 100) * effectiveBase
    results.push({ effectiveBase, amount })
    runningTotal += amount
  }
  return results
}

function newSurchargeRow(calcMasterId: number, sortOrder: number): FeeCalcSurcharge {
  return {
    FEE_CALC_MASTER_ID: calcMasterId, FEE_SURCHARGE_ID: null,
    NAME_SHORT: '', NAME_LONG: '', PERCENT: null, BASE_AMOUNT: null, AMOUNT: null,
    SORT_ORDER: sortOrder, LPH_FILTER: null, CALC_MODE: 'parallel', INCLUDE_BL: false,
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
  existingId?: number | null
  /** Pre-select this project in step 2 when creating new */
  initialProjectId?: number | null
  onDone?: () => void
}

export function HonorarWizard({ existingId, initialProjectId, onDone }: WizardProps) {
  const qc = useQueryClient()
  const isEdit = !!existingId

  const firstStep  = isEdit ? 2 : 1
  const totalSteps = isEdit ? 4 : 6
  function dotFor(s: number) { return isEdit ? s - 1 : s }

  const [step, setStep]       = useState(firstStep)
  const [msg, setMsg]         = useState<{ text: string; type: 'success'|'error'|'info' } | null>(null)
  const [loading, setLoading] = useState(false)
  const [showSyncDialog, setShowSyncDialog] = useState(false)

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
  const [projectId, setProjectId]           = useState(initialProjectId ? String(initialProjectId) : '')
  const [structureNodes, setStructureNodes] = useState<Awaited<ReturnType<typeof fetchProjectStructure>>['data']>([])

  // Step 3 state (phases)
  const [phases, setPhases]   = useState<FeePhaseRow[]>([])

  // Step 4 state (Besondere Leistungen)
  const [blItems, setBlItems] = useState<FeeCalcBl[]>([])

  // Step 5 state (surcharges)
  const [surcharges, setSurcharges]             = useState<FeeCalcSurcharge[]>([])
  const [globalSurcharges, setGlobalSurcharges] = useState<FeeSurchargeGlobal[]>([])
  const [expandedSurchargeIdx, setExpandedSurchargeIdx] = useState<number | null>(null)

  // Step 6
  const [fatherId, setFatherId] = useState('')

  const { data: groupsData }   = useQuery({ queryKey: ['fee-groups'],     queryFn: fetchFeeGroups })
  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })

  const groups   = groupsData?.data   ?? []
  const projects = projectsData?.data ?? []

  const totalPhaseRev = phases.reduce((s, p) => s + (p.PHASE_REVENUE ?? 0), 0)
  const blTotal = blItems.reduce((s, b) => s + (Number(b.AMOUNT) || 0), 0)

  // Compute surcharge effects (LPH filter + cumulative mode + optional BL inclusion)
  const surchargeEffects = computeSurchargeEffects(phases, surcharges, blTotal)
  const totalSurchargeAmt = surchargeEffects.reduce((s, e) => s + e.amount, 0)

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
      PROJECT_ID:   row.PROJECT_ID != null ? String(row.PROJECT_ID) : (initialProjectId ? String(initialProjectId) : ''),
      ZONE_ID:      row.ZONE_ID    != null ? String(row.ZONE_ID) : '',
      ZONE_PERCENT: fmtN(row.ZONE_PERCENT),
      K0: fmtN(row.CONSTRUCTION_COSTS_K0), K1: fmtN(row.CONSTRUCTION_COSTS_K1),
      K2: fmtN(row.CONSTRUCTION_COSTS_K2), K3: fmtN(row.CONSTRUCTION_COSTS_K3),
      K4: fmtN(row.CONSTRUCTION_COSTS_K4),
    })
    const pid = row.PROJECT_ID != null ? String(row.PROJECT_ID) : (initialProjectId ? String(initialProjectId) : '')
    setProjectId(pid)
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
      setMsg({ text: 'Lade Besondere Leistungen …', type: 'info' })
      const blRes = await fetchFeeCalcBl(calcMaster.ID)
      setBlItems(blRes.data ?? [])
      setMsg(null); setStep(4)
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  async function saveBLAndGo() {
    if (!calcMaster) return
    setLoading(true); setMsg({ text: 'Speichere Besondere Leistungen …', type: 'info' })
    try {
      await saveFeeCalcBl(calcMaster.ID, blItems.map((b, i) => ({ ...b, SORT_ORDER: i })))
      setMsg({ text: 'Lade Zuschläge …', type: 'info' })
      const blSum = blItems.reduce((s, b) => s + (Number(b.AMOUNT) || 0), 0)
      const [surRes, globalRes] = await Promise.all([
        fetchFeeCalcSurcharges(calcMaster.ID),
        calcMaster.FEE_MASTER_ID ? fetchFeeSurchargesGlobal(calcMaster.FEE_MASTER_ID) : Promise.resolve({ data: [] as FeeSurchargeGlobal[] }),
      ])
      setGlobalSurcharges(globalRes.data ?? [])
      setSurcharges((surRes.data ?? []).map(r => ({
        ...r,
        BASE_AMOUNT: r.BASE_AMOUNT ?? totalPhaseRev + blSum,
        LPH_FILTER: r.LPH_FILTER ?? null,
        CALC_MODE: r.CALC_MODE ?? 'parallel',
        INCLUDE_BL: r.INCLUDE_BL ?? false,
      })))
      setMsg(null); setStep(5)
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  async function saveSurchargesAndGo() {
    if (!calcMaster) return
    setLoading(true); setMsg({ text: 'Speichere Zuschläge …', type: 'info' })
    try {
      const effects = computeSurchargeEffects(phases, surcharges)
      const rowsToSave = surcharges.map((r, i) => ({
        ...r,
        SORT_ORDER: i,
        BASE_AMOUNT: effects[i]?.effectiveBase ?? totalPhaseRev,
        LPH_FILTER: r.LPH_FILTER ?? null,
        CALC_MODE: r.CALC_MODE ?? 'parallel',
      }))
      await saveFeeCalcSurcharges(calcMaster.ID, rowsToSave)
      void qc.invalidateQueries({ queryKey: ['fee-calc-masters'] })
      setMsg(null)
      if (isEdit) {
        setShowSyncDialog(true)
      } else {
        setStep(6)
      }
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  async function doSyncToStructure() {
    if (!calcMaster) { setShowSyncDialog(false); onDone?.(); return }
    setLoading(true)
    try {
      const res = await syncFeeCalcToStructure(calcMaster.ID)
      setMsg({ text: res.message, type: 'success' })
      if (res.projectId) void qc.invalidateQueries({ queryKey: ['structure', res.projectId] })
    } catch {
      setMsg({ text: 'Fehler beim Aktualisieren der Projektstruktur.', type: 'error' })
    } finally {
      setLoading(false)
      setShowSyncDialog(false)
      setTimeout(() => onDone?.(), 1500)
    }
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
      setMsg({ text: (e as Error).message ?? 'Fehler beim Prüfen', type: 'error' }); return
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

  function goBack() {
    setStep(s => Math.max(firstStep, s - 1))
  }

  function resetWizard() {
    setStep(firstStep); setCalcMaster(null); setPhases([]); setBlItems([]); setSurcharges([])
    setFeeGroupId(''); setFeeMasterId(''); setMasters([])
    setBasis({ NAME_SHORT: '', NAME_LONG: '', PROJECT_ID: '', ZONE_ID: '', ZONE_PERCENT: '', K0: '', K1: '', K2: '', K3: '', K4: '' })
    setFatherId(''); setMsg(null); setShowSyncDialog(false)
    onDone?.()
  }

  async function cancelAndDelete() {
    if (!isEdit && calcMaster) {
      try { await deleteFeeCalcMaster(calcMaster.ID) } catch { /* ignore */ }
    }
    setStep(firstStep); setCalcMaster(null); setPhases([]); setBlItems([]); setSurcharges([])
    setFeeGroupId(''); setFeeMasterId(''); setMasters([])
    setMsg(null); setShowSyncDialog(false)
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
        PERCENT: null, BASE_AMOUNT: totalPhaseRev + blTotal, AMOUNT: null,
        SORT_ORDER: prev.length, LPH_FILTER: null, CALC_MODE: 'parallel', INCLUDE_BL: false,
      },
    ])
  }

  function addCustomSurcharge() {
    if (!calcMaster) return
    setSurcharges(prev => [...prev, newSurchargeRow(calcMaster.ID, prev.length)])
  }

  function updateSurcharge(idx: number, field: keyof FeeCalcSurcharge, value: string | number | boolean | null) {
    setSurcharges(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  function removeSurcharge(idx: number) {
    setSurcharges(prev => prev.filter((_, i) => i !== idx))
    if (expandedSurchargeIdx === idx) setExpandedSurchargeIdx(null)
    else if (expandedSurchargeIdx != null && expandedSurchargeIdx > idx) setExpandedSurchargeIdx(expandedSurchargeIdx - 1)
  }

  function toggleSurchargeLph(surchargeIdx: number, phaseId: number) {
    setSurcharges(prev => prev.map((r, i) => {
      if (i !== surchargeIdx) return r
      const current: number[] = r.LPH_FILTER ? (JSON.parse(r.LPH_FILTER) as number[]) : phases.map(p => p.ID)
      const next = current.includes(phaseId)
        ? current.filter(id => id !== phaseId)
        : [...current, phaseId]
      const isAll = next.length === phases.length
      return { ...r, LPH_FILTER: isAll ? null : JSON.stringify(next) }
    }))
  }

  function setSurchargeAllLph(surchargeIdx: number, all: boolean) {
    setSurcharges(prev => prev.map((r, i) =>
      i !== surchargeIdx ? r : { ...r, LPH_FILTER: all ? null : JSON.stringify([]) }
    ))
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
      {calcMaster && step >= 2 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button type="button" className="btn-small" onClick={() => openHonorarPdf(calcMaster.ID)}>
            Übersicht (PDF)
          </button>
        </div>
      )}
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
                <tr>
                  <th>Phase</th>
                  <th>Kx</th>
                  <th style={{ textAlign: 'right' }}>Basis €</th>
                  <th style={{ textAlign: 'right' }}>Basis %</th>
                  <th style={{ textAlign: 'right' }}>Basis-Honorar €</th>
                  <th style={{ textAlign: 'right' }}>Honorar %</th>
                  <th style={{ textAlign: 'right' }}>Honorar €</th>
                </tr>
              </thead>
              <tbody>
                {phases.map(p => {
                  const baseEur = p.REVENUE_BASE ?? 0
                  const basePct = p.FEE_PERCENT_BASE ?? 0
                  const basisHonorar = basePct && baseEur ? (basePct * baseEur) / 100 : null
                  return (
                    <tr key={p.ID}>
                      <td>{p.PHASE_LABEL}</td>
                      <td>
                        <select className="tbl-select" value={p.KX || 'K0'} onChange={e => updatePhaseKx(p.ID, e.target.value)}>
                          {KX_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: 'right', color: '#6b7280', fontSize: 12 }}>
                        {p.REVENUE_BASE != null ? fmtEur(p.REVENUE_BASE) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: '#6b7280', fontSize: 12 }}>
                        {fmtN(p.FEE_PERCENT_BASE) || '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: '#6b7280', fontSize: 12 }}>
                        {basisHonorar != null ? fmtEur(basisHonorar) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input className="tbl-input" type="number" step="0.01" style={{ width: 80 }}
                          value={fmtN(p.FEE_PERCENT)} onChange={e => updatePhasePct(p.ID, e.target.value)} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input className="tbl-input" readOnly style={{ width: 90 }} value={fmtN(p.PHASE_REVENUE)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={5}>Grundhonorar</th>
                  <th style={{ textAlign: 'right' }}>{fmtN(totalPhasePct)}</th>
                  <th style={{ textAlign: 'right' }}>{fmtN(totalPhaseRev)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Step 4: Besondere Leistungen ─────────────────────────────────────── */}
      {step === 4 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">{isEdit ? 'Schritt 3' : 'Schritt 4'}: Besondere Leistungen</h3>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
            Optionale Zusatzleistungen über die HOAI-Grundleistungen hinaus (§ 3 Abs. 3).
            Werden separat im Gesamthonorar ausgewiesen.
          </p>
          {blItems.length > 0 && (
            <div className="table-scroll" style={{ marginBottom: 8 }}>
              <table className="master-table">
                <thead>
                  <tr>
                    <th style={{ width: '50%' }}>Bezeichnung</th>
                    <th style={{ width: '20%' }}>LP-Bezug</th>
                    <th style={{ textAlign: 'right', width: '20%' }}>Betrag €</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {blItems.map((b, idx) => (
                    <tr key={idx}>
                      <td>
                        <input className="tbl-input" style={{ width: '100%' }} value={b.NAME}
                          onChange={e => setBlItems(prev => prev.map((x, i) => i === idx ? { ...x, NAME: e.target.value } : x))} />
                      </td>
                      <td>
                        <input className="tbl-input" style={{ width: '100%' }} placeholder="z.B. LP 1" value={b.LPH_REF ?? ''}
                          onChange={e => setBlItems(prev => prev.map((x, i) => i === idx ? { ...x, LPH_REF: e.target.value || null } : x))} />
                      </td>
                      <td>
                        <input className="tbl-input" type="number" step="0.01" style={{ width: 120, textAlign: 'right' }}
                          value={b.AMOUNT !== 0 ? String(b.AMOUNT) : ''}
                          onChange={e => setBlItems(prev => prev.map((x, i) => i === idx ? { ...x, AMOUNT: toNum(e.target.value) ?? 0 } : x))} />
                      </td>
                      <td>
                        <button type="button" className="btn-small" onClick={() => setBlItems(prev => prev.filter((_, i) => i !== idx))}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2}>Summe Besondere Leistungen</th>
                    <th style={{ textAlign: 'right' }}>{fmtEur(blTotal)}</th>
                    <th></th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <button type="button" className="btn-small" onClick={() => {
            if (!calcMaster) return
            setBlItems(prev => [...prev, { FEE_CALC_MASTER_ID: calcMaster.ID, NAME: '', LPH_REF: null, AMOUNT: 0, SORT_ORDER: prev.length }])
          }}>+ Besondere Leistung hinzufügen</button>
          {blItems.length === 0 && (
            <p className="empty-note" style={{ marginTop: 8 }}>Keine Besonderen Leistungen — Schritt überspringen ist möglich.</p>
          )}
        </div>
      )}

      {/* ── Step 5: Zuschläge & Nachlässe ────────────────────────────────────── */}
      {step === 5 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">{isEdit ? 'Schritt 4' : 'Schritt 5'}: Zuschläge &amp; Nachlässe</h3>

          <div className="admin-block" style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: '#374151' }}>Grundhonorar (Summe LPH): </span>
            <strong style={{ fontSize: 14 }}>{fmtEur(totalPhaseRev)}</strong>
            {blTotal > 0 && (
              <span style={{ marginLeft: 16, fontSize: 13, color: '#374151' }}>
                + Besondere Leistungen: <strong>{fmtEur(blTotal)}</strong>
              </span>
            )}
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
                    <th style={{ width: '25%' }}>Kurzbezeichnung</th>
                    <th style={{ width: '25%' }}>Langbezeichnung</th>
                    <th style={{ width: 80 }}>% (neg. = Nachlass)</th>
                    <th style={{ width: 100 }}>Berechnungsbasis €</th>
                    <th style={{ width: 100 }}>Betrag €</th>
                    <th style={{ width: 60 }}>LPH / Modus</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {surcharges.map((r, idx) => {
                    const effect = surchargeEffects[idx]
                    const selectedIds: number[] = r.LPH_FILTER
                      ? (JSON.parse(r.LPH_FILTER) as number[])
                      : phases.map(p => p.ID)
                    const isExpanded = expandedSurchargeIdx === idx
                    return (
                      <>
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
                          <td style={{ textAlign: 'right', fontSize: 12, color: '#6b7280' }}>
                            {fmtEur(effect?.effectiveBase)}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: (effect?.amount ?? 0) >= 0 ? '#166534' : '#991b1b' }}>
                            {fmtEur(effect?.amount)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button type="button" className="btn-small" title="LPH-Filter und Modus bearbeiten"
                              style={{ fontSize: 11, padding: '2px 6px', background: isExpanded ? '#dbeafe' : undefined }}
                              onClick={() => setExpandedSurchargeIdx(isExpanded ? null : idx)}>
                              {isExpanded ? 'Schließe Details' : 'Öffne Details'}
                            </button>
                          </td>
                          <td>
                            <button type="button" className="btn-small" title="Entfernen"
                              onClick={() => removeSurcharge(idx)}>×</button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${idx}-detail`}>
                            <td colSpan={7} style={{ background: '#f8faff', padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>
                              <div style={{ marginBottom: 8 }}>
                                <strong style={{ fontSize: 12, color: '#374151', marginRight: 8 }}>Berechnungsmodus:</strong>
                                <button type="button" className="btn-small"
                                  style={{ marginRight: 4, background: (r.CALC_MODE ?? 'parallel') === 'parallel' ? 'var(--accent)' : undefined, color: (r.CALC_MODE ?? 'parallel') === 'parallel' ? '#fff' : undefined }}
                                  onClick={() => updateSurcharge(idx, 'CALC_MODE', 'parallel')}>
                                  Parallel
                                </button>
                                <button type="button" className="btn-small"
                                  style={{ background: r.CALC_MODE === 'cumulative' ? 'var(--accent)' : undefined, color: r.CALC_MODE === 'cumulative' ? '#fff' : undefined }}
                                  onClick={() => updateSurcharge(idx, 'CALC_MODE', 'cumulative')}>
                                  Kumulativ
                                </button>
                                <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>
                                  {r.CALC_MODE === 'cumulative' && idx > 0
                                    ? 'Zuschlag auf Honorarbasis + Summe vorheriger Zuschläge'
                                    : 'Zuschlag auf Honorarbasis'}
                                </span>
                              </div>
                              {blItems.length > 0 && (
                                <div style={{ marginBottom: 8 }}>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                                    <input type="checkbox" checked={r.INCLUDE_BL ?? false}
                                      onChange={e => updateSurcharge(idx, 'INCLUDE_BL', e.target.checked)} />
                                    <span>Auch auf Besondere Leistungen anwenden</span>
                                    <span style={{ color: '#6b7280', fontSize: 11 }}>
                                      (+{fmtEur(blTotal)} im Berechnungsbasis)
                                    </span>
                                  </label>
                                </div>
                              )}
                              <div>
                                <strong style={{ fontSize: 12, color: '#374151' }}>Betroffene Leistungsphasen:</strong>
                                <button type="button" className="btn-small" style={{ marginLeft: 8, marginRight: 4 }}
                                  onClick={() => setSurchargeAllLph(idx, true)}>Alle</button>
                                <button type="button" className="btn-small"
                                  onClick={() => setSurchargeAllLph(idx, false)}>Keine</button>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 6 }}>
                                  {phases.map(p => (
                                    <label key={p.ID} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                                      <input type="checkbox" checked={selectedIds.includes(p.ID)}
                                        onChange={() => toggleSurchargeLph(idx, p.ID)} />
                                      {p.PHASE_LABEL}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={4}>Summe Zuschläge / Nachlässe</th>
                    <th style={{ textAlign: 'right', color: totalSurchargeAmt >= 0 ? '#166534' : '#991b1b' }}>
                      {fmtEur(totalSurchargeAmt)}
                    </th>
                    <th colSpan={2}></th>
                  </tr>
                  <tr>
                    <th colSpan={4}>Gesamthonorar</th>
                    <th style={{ textAlign: 'right', fontSize: 14 }}>{fmtEur(totalPhaseRev + blTotal + totalSurchargeAmt)}</th>
                    <th colSpan={2}></th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <button type="button" className="btn-small" onClick={addCustomSurcharge}>+ Zuschlag / Nachlass hinzufügen</button>

          {/* Sync-to-structure confirmation */}
          {showSyncDialog && (
            <div className="admin-block" style={{ marginTop: 16, background: '#fef9c3', border: '1px solid #fbbf24', padding: 14 }}>
              <p style={{ marginBottom: 10, fontWeight: 500, fontSize: 13 }}>
                Sollen die verknüpften Projektelemente mit den aktualisierten Honorarwerten überschrieben werden?
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-primary" onClick={() => void doSyncToStructure()} disabled={loading}>
                  Ja, Projektstruktur aktualisieren
                </button>
                <button type="button" onClick={() => { setShowSyncDialog(false); onDone?.() }}>Nein</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 6: Übersicht + Zuordnen (create only) ────────────────────────── */}
      {step === 6 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 6: Übersicht &amp; Zuordnen</h3>
          <div className="admin-block">
            <p><strong>Leistungsbild:</strong> {calcMaster?.NAME_SHORT} {calcMaster?.NAME_LONG && '– ' + calcMaster.NAME_LONG}</p>
            <p><strong>Grundhonorar:</strong> {fmtEur(totalPhaseRev)}</p>
            {blItems.length > 0 && <p><strong>Besondere Leistungen:</strong> {fmtEur(blTotal)}</p>}
            {surcharges.length > 0 && <p><strong>Zuschläge / Nachlässe:</strong> {fmtEur(totalSurchargeAmt)}</p>}
            <p><strong>Gesamthonorar:</strong> {fmtEur(totalPhaseRev + blTotal + totalSurchargeAmt)}</p>
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

      {!showSyncDialog && (
        <div className="wizard-nav">
          {step > firstStep && (
            <button type="button" className="btn-small" onClick={goBack} disabled={loading}>
              ← Zurück
            </button>
          )}
          {step >= firstStep && (
            <button type="button" onClick={cancelAndDelete} disabled={loading}>
              {isEdit ? 'Abbrechen' : step === 1 ? 'Abbrechen' : 'Abbrechen & Löschen'}
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
            <button className="btn-primary" type="button" onClick={saveBLAndGo} disabled={loading}>Speichern &amp; Weiter →</button>
          )}
          {step === 5 && (
            <button className="btn-primary" type="button" onClick={saveSurchargesAndGo} disabled={loading}>
              {isEdit ? 'Speichern & Fertig' : 'Weiter →'}
            </button>
          )}
          {step === 6 && (
            <button className="btn-primary" type="button" onClick={finish} disabled={loading || !fatherId}>Projektstruktur anlegen</button>
          )}
        </div>
      )}
    </div>
  )
}

// ── HonorarTab: list + wizard ─────────────────────────────────────────────────

type WizardMode = null | { mode: 'create' } | { mode: 'edit'; id: number }

type SortCol = 'nameShort' | 'nameLong' | 'project' | 'grundhonorar' | 'gesamthonorar'

function fmtEurShort(v: number | null | undefined) {
  if (v == null) return '—'
  return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function FilterChip({ label, options, selected, onChange }: {
  label: string
  options: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function toggle(v: string) {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v); else next.add(v)
    onChange(next)
  }

  const hasFilter = selected.size > 0
  return (
    <div className="filter-chip-wrap" ref={ref}>
      <button
        type="button"
        className={`filter-chip-btn${hasFilter ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        {label}{hasFilter ? ` (${selected.size})` : ''} ▾
      </button>
      {open && (
        <div className="filter-chip-dropdown">
          {options.map(v => (
            <label key={v} className="filter-chip-option">
              <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} />
              {v}
            </label>
          ))}
          {options.length === 0 && (
            <span style={{ padding: '6px 10px', fontSize: 12, color: '#9ca3af', display: 'block' }}>Keine Optionen</span>
          )}
          {hasFilter && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
              <button type="button" className="filter-chip-option" style={{ color: '#dc2626', width: '100%', textAlign: 'left' }}
                onClick={() => { onChange(new Set()); setOpen(false) }}>
                Zurücksetzen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface HonorarTabProps {
  initialProjectId?: number
}

export function HonorarTab({ initialProjectId }: HonorarTabProps) {
  const navigate = useNavigate()
  const [wizardMode, setWizardMode]     = useState<WizardMode>(null)
  const [search, setSearch]             = useState('')
  const [sort, setSort]                 = useState<{ col: SortCol; dir: 'asc' | 'desc' }>({ col: 'grundhonorar', dir: 'desc' })
  const [paraFilter, setParaFilter]     = useState<Set<string>>(new Set())
  const [projektFilter, setProjektFilter] = useState<Set<string>>(new Set())
  const [didInitFilter, setDidInitFilter] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['fee-calc-masters'],
    queryFn:  () => fetchFeeCalcMasters(),
  })
  const allRows = data?.data ?? []

  // Pre-select project filter when initialProjectId is provided
  useEffect(() => {
    if (didInitFilter || !initialProjectId || allRows.length === 0) return
    const label = allRows.find(r => r.PROJECT_ID === initialProjectId)?.projectLabel
    if (label) {
      setProjektFilter(new Set([label]))
      setDidInitFilter(true)
    }
  }, [allRows, initialProjectId, didInitFilter])

  const allParas    = Array.from(new Set(allRows.map(r => r.NAME_SHORT).filter((s): s is string => !!s))).sort()
  const allProjekte = Array.from(new Set(allRows.map(r => r.projectLabel).filter((s): s is string => !!s))).sort()

  // Client-side search + filter
  const q = search.trim().toLowerCase()
  const filtered = allRows.filter(r => {
    if (paraFilter.size > 0 && !(r.NAME_SHORT && paraFilter.has(r.NAME_SHORT))) return false
    if (projektFilter.size > 0 && !(r.projectLabel && projektFilter.has(r.projectLabel))) return false
    if (!q) return true
    return (
      (r.NAME_SHORT ?? '').toLowerCase().includes(q) ||
      (r.NAME_LONG  ?? '').toLowerCase().includes(q) ||
      (r.projectLabel ?? '').toLowerCase().includes(q)
    )
  })

  const sorted = [...filtered].sort((a, b) => {
    let va: string | number = 0
    let vb: string | number = 0
    if (sort.col === 'nameShort')    { va = a.NAME_SHORT ?? ''; vb = b.NAME_SHORT ?? '' }
    if (sort.col === 'nameLong')     { va = a.NAME_LONG  ?? ''; vb = b.NAME_LONG  ?? '' }
    if (sort.col === 'project')      { va = a.projectLabel ?? ''; vb = b.projectLabel ?? '' }
    if (sort.col === 'grundhonorar') { va = a.grundhonorar  ?? 0; vb = b.grundhonorar  ?? 0 }
    if (sort.col === 'gesamthonorar'){ va = a.gesamthonorar ?? 0; vb = b.gesamthonorar ?? 0 }
    if (typeof va === 'string') return sort.dir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va)
    return sort.dir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
  })

  function toggleSort(col: SortCol) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })
  }

  function SortTh({ col, children, right }: { col: SortCol; children: React.ReactNode; right?: boolean }) {
    const active = sort.col === col
    return (
      <th style={{ cursor: 'pointer', textAlign: right ? 'right' : undefined, userSelect: 'none' }}
        onClick={() => toggleSort(col)}>
        {children} {active ? (sort.dir === 'asc' ? '↑' : '↓') : <span style={{ opacity: 0.3 }}>↕</span>}
      </th>
    )
  }

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
          initialProjectId={initialProjectId}
          onDone={handleDone}
        />
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="list-toolbar">
        <input
          type="search"
          className="list-search"
          placeholder="Suchen …"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: '0 1 220px', minWidth: 120 }}
        />
        <FilterChip label="§" options={allParas} selected={paraFilter} onChange={setParaFilter} />
        <FilterChip label="Projekt" options={allProjekte} selected={projektFilter} onChange={setProjektFilter} />
        <button className="btn-primary" type="button" style={{ marginLeft: 'auto' }} onClick={() => setWizardMode({ mode: 'create' })}>
          + Neue Honorarberechnung
        </button>
      </div>

      {isLoading && <p className="empty-note">Lade …</p>}
      {!isLoading && sorted.length === 0 && (
        <p className="empty-note">
          {q ? 'Keine Treffer.' : 'Noch keine Honorarberechnungen vorhanden.'}
        </p>
      )}

      {sorted.length > 0 && (
        <div className="table-scroll">
          <table className="master-table">
            <thead>
              <tr>
                <SortTh col="nameShort">§</SortTh>
                <SortTh col="nameLong">Bezeichnung</SortTh>
                <SortTh col="project">Projekt</SortTh>
                <SortTh col="grundhonorar" right>Grundhonorar</SortTh>
                <th style={{ textAlign: 'right' }}>Zuschläge</th>
                <SortTh col="gesamthonorar" right>Gesamthonorar</SortTh>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.ID}>
                  <td>{r.NAME_SHORT || '—'}</td>
                  <td>{r.NAME_LONG || '—'}</td>
                  <td>{r.projectLabel || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmtEurShort(r.grundhonorar)}</td>
                  <td style={{ textAlign: 'right', color: (r.zuschlaegeSum ?? 0) !== 0 ? ((r.zuschlaegeSum ?? 0) >= 0 ? '#166534' : '#991b1b') : undefined }}>
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
                        Übersicht
                      </button>
                      {r.PROJECT_ID != null && (
                        <button type="button" className="btn-small" title="Zur Projektstruktur"
                          onClick={() => navigate('/projekte', { state: { tab: 'struktur', projectId: r.PROJECT_ID } })}>
                          → Struktur
                        </button>
                      )}
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
