import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Message } from '@/components/ui/Message'
import { HelpHint } from '@/components/ui/HelpHint'
import {
  fetchFeeGroups, fetchFeeMasters, fetchFeeZones,
  fetchFeeCalcMasters, fetchFeeCalcMaster,
  initFeeCalcMaster, saveFeeCalcBasis, initFeePhases, saveFeePhases,
  deleteFeeCalcMaster, attachFeeToStructure, attachFeeToOfferStructure,
  fetchFeeSurchargesGlobal, fetchFeeCalcSurcharges, saveFeeCalcSurcharges,
  fetchFeeCalcBl, saveFeeCalcBl,
  openHonorarPdf, syncFeeCalcToStructure,
  type FeeCalcMaster, type FeePhaseRow, type FeeCalcSurcharge, type FeeSurchargeGlobal, type FeeCalcBl, type BlAmountType,
} from '@/api/fee'
import { fetchProjectsShort, fetchProjectStructure, fetchParentChildCheck } from '@/api/projekte'
import { fetchOfferStructure, type OfferStructureNode } from '@/api/angebote'

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

/** Compute effective base and amount for each surcharge row, honouring LPH filter + calc mode + BL filter */
function computeSurchargeEffects(
  phases: FeePhaseRow[],
  surcharges: FeeCalcSurcharge[],
  blItems: FeeCalcBl[] = [],
  blComputedAmounts: number[] = [],
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
    let blContrib = 0
    if (r.BL_FILTER) {
      try {
        const selectedBlIds = JSON.parse(r.BL_FILTER) as number[]
        blContrib = blItems.reduce((s, b, i) => {
          return (b.ID != null && selectedBlIds.includes(b.ID)) ? s + (blComputedAmounts[i] ?? 0) : s
        }, 0)
      } catch { /* ignore parse error */ }
    }
    const base = phaseBase + blContrib
    const effectiveBase = r.CALC_MODE === 'cumulative' ? base + runningTotal : base
    const amount = ((r.PERCENT ?? 0) / 100) * effectiveBase
    results.push({ effectiveBase, amount })
    runningTotal += amount
  }
  return results
}

const BL_AMOUNT_TYPE_LABELS: Record<BlAmountType, string> = {
  fixed:            'Pauschalbetrag €',
  pct_lph:          '% auf LPH-Honorar',
  pct_basis:        '% auf Basis-Honorar (Kx)',
  pct_grundhonorar: '% auf Grundhonorar (Summe LPH)',
  pct_gesamthonorar:'% auf Gesamthonorar inkl. Zuschläge',
  pct_baukosten:    '% auf Baukosten (Kx)',
}

function constructionCostByKx(row: FeeCalcMaster, kx: KX): number | null {
  const map: Record<KX, number | null> = {
    K0: row.CONSTRUCTION_COSTS_K0, K1: row.CONSTRUCTION_COSTS_K1,
    K2: row.CONSTRUCTION_COSTS_K2, K3: row.CONSTRUCTION_COSTS_K3,
    K4: row.CONSTRUCTION_COSTS_K4,
  }
  return map[kx]
}

function computeBlItemAmount(
  bl: FeeCalcBl,
  phases: FeePhaseRow[],
  calcMaster: FeeCalcMaster | null,
  grundhonorar: number,
  surchargeTotal: number,
): number {
  const pct = (Number(bl.PERCENT ?? 0) || 0) / 100
  switch (bl.AMOUNT_TYPE) {
    case 'pct_lph': {
      const phase = phases.find(p => p.ID === bl.LPH_PHASE_ID)
      return pct * (phase?.PHASE_REVENUE ?? 0)
    }
    case 'pct_basis': {
      if (!calcMaster || !bl.KX_REF) return 0
      return pct * (revenueByKx(calcMaster, bl.KX_REF as KX) ?? 0)
    }
    case 'pct_grundhonorar':
      return pct * grundhonorar
    case 'pct_gesamthonorar':
      return pct * (grundhonorar + surchargeTotal)
    case 'pct_baukosten': {
      if (!calcMaster || !bl.KX_REF) return 0
      return pct * (constructionCostByKx(calcMaster, bl.KX_REF as KX) ?? 0)
    }
    default:
      return Number(bl.AMOUNT) || 0
  }
}

function newSurchargeRow(calcMasterId: number, sortOrder: number): FeeCalcSurcharge {
  return {
    FEE_CALC_MASTER_ID: calcMasterId, FEE_SURCHARGE_ID: null,
    NAME_SHORT: '', NAME_LONG: '', PERCENT: null, BASE_AMOUNT: null, AMOUNT: null,
    SORT_ORDER: sortOrder, LPH_FILTER: null, CALC_MODE: 'parallel', INCLUDE_BL: false, BL_FILTER: null,
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
  /** When set, calc is linked to an offer instead of a project */
  offerId?: number | null
  /** Pre-select this structure node as the parent in the final step */
  initialFatherId?: number | null
  onDone?: () => void
}

export function HonorarWizard({ existingId, initialProjectId, offerId, initialFatherId, onDone }: WizardProps) {
  const qc = useQueryClient()
  const isEdit      = !!existingId
  const isOfferMode = !!offerId

  const firstStep  = isEdit ? 2 : 1
  const totalSteps = isEdit ? 5 : 6
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
  const [projectId, setProjectId]             = useState(initialProjectId ? String(initialProjectId) : '')
  const [structureNodes, setStructureNodes]   = useState<Awaited<ReturnType<typeof fetchProjectStructure>>['data']>([])
  const [offerStructureNodes, setOfferStructureNodes] = useState<OfferStructureNode[]>([])

  // Step 3 state (phases)
  const [phases, setPhases]   = useState<FeePhaseRow[]>([])

  // Step 4 state (Besondere Leistungen)
  const [blItems, setBlItems] = useState<FeeCalcBl[]>([])

  // Step 5 state (surcharges)
  const [surcharges, setSurcharges]             = useState<FeeCalcSurcharge[]>([])
  const [globalSurcharges, setGlobalSurcharges] = useState<FeeSurchargeGlobal[]>([])
  const [expandedSurchargeIdx, setExpandedSurchargeIdx] = useState<number | null>(null)

  // Step 6
  const [fatherId, setFatherId] = useState(initialFatherId != null ? String(initialFatherId) : '')

  const { data: groupsData }   = useQuery({ queryKey: ['fee-groups'],     queryFn: fetchFeeGroups })
  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })

  const groups   = groupsData?.data   ?? []
  const projects = projectsData?.data ?? []

  const totalPhaseRev = phases.reduce((s, p) => s + (p.PHASE_REVENUE ?? 0), 0)

  // Bemessungsgrundlage des Leistungsbilds — bestimmt UI/PDF-Labels und
  // ob K0..K4 oder nur ein Fläche-Feld (ha) angezeigt wird. Fallback
  // 'cost_eur' = bisheriges Verhalten.
  const baseType: 'cost_eur' | 'area_ha' =
    calcMaster?.BASE_TYPE
    ?? (feeMasterId
          ? (masters.find(m => String(m.ID) === String(feeMasterId))?.BASE_TYPE ?? 'cost_eur')
          : 'cost_eur')
  const isAreaHa  = baseType === 'area_ha'
  const baseLabel = isAreaHa ? 'Plangebiet (ha)'        : 'Baukosten (€)'
  const kxOptionsForBase = isAreaHa ? (['K0'] as const) : KX_OPTIONS

  // Compute surcharges without BL first (for pct_gesamthonorar BL base)
  const surchargeEffectsNoBl = computeSurchargeEffects(phases, surcharges, [], [])
  const surchargeNoBlTotal = surchargeEffectsNoBl.reduce((s, e) => s + e.amount, 0)

  // Compute each BL item's effective amount (may depend on surcharges above)
  const blComputedAmounts = blItems.map(b => computeBlItemAmount(b, phases, calcMaster, totalPhaseRev, surchargeNoBlTotal))
  const blTotal = blComputedAmounts.reduce((s, a) => s + a, 0)

  // Compute final surcharge effects with per-BL-item filter applied
  const surchargeEffects = computeSurchargeEffects(phases, surcharges, blItems, blComputedAmounts)
  const totalSurchargeAmt = surchargeEffects.reduce((s, e) => s + e.amount, 0)

  // Load project structure nodes when project changes
  useEffect(() => {
    if (!projectId) { setStructureNodes([]); return }
    fetchProjectStructure(Number(projectId))
      .then(r => setStructureNodes(r.data ?? []))
      .catch(() => setStructureNodes([]))
  }, [projectId])

  // Load offer structure nodes when in offer mode
  useEffect(() => {
    if (!offerId) { setOfferStructureNodes([]); return }
    fetchOfferStructure(offerId)
      .then(r => setOfferStructureNodes(r.data ?? []))
      .catch(() => setOfferStructureNodes([]))
  }, [offerId])

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
    if (!isOfferMode && !projectId) { setMsg({ text: 'Bitte Projekt wählen', type: 'error' }); return }
    setLoading(true); setMsg({ text: 'Anlegen der Honorarberechnung …', type: 'info' })
    try {
      // PROJECT_ID oder OFFER_ID muss beim Insert gesetzt sein (DB-Check
      // chk_fee_calc_master_source). Eines von beiden ist hier garantiert.
      const opts: { project_id?: number; offer_id?: number } = offerId
        ? { offer_id: offerId }
        : { project_id: Number(projectId) }
      const row = await initFeeCalcMaster(Number(feeMasterId), opts)
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
        PROJECT_ID:            isOfferMode ? null : (basis.PROJECT_ID ? Number(basis.PROJECT_ID) : null),
        OFFER_ID:              isOfferMode ? offerId : null,
        ZONE_ID:               basis.ZONE_ID    ? Number(basis.ZONE_ID) : null,
        ZONE_PERCENT:          toNum(basis.ZONE_PERCENT),
        CONSTRUCTION_COSTS_K0: toNum(basis.K0),
        CONSTRUCTION_COSTS_K1: isAreaHa ? null : toNum(basis.K1),
        CONSTRUCTION_COSTS_K2: isAreaHa ? null : toNum(basis.K2),
        CONSTRUCTION_COSTS_K3: isAreaHa ? null : toNum(basis.K3),
        CONSTRUCTION_COSTS_K4: isAreaHa ? null : toNum(basis.K4),
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
      // For pct_* types, store the computed AMOUNT so backend/PDF can use it directly
      const blToSave = blItems.map((b, i) => ({
        ...b,
        SORT_ORDER: i,
        AMOUNT: computeBlItemAmount(b, phases, calcMaster, totalPhaseRev, surchargeNoBlTotal),
      }))
      const savedBl = await saveFeeCalcBl(calcMaster.ID, blToSave)
      // Update state with DB-assigned IDs (needed for BL_FILTER in surcharges)
      setBlItems(savedBl.data ?? blToSave)
      setMsg({ text: 'Lade Zuschläge …', type: 'info' })
      const blSum = (savedBl.data ?? blToSave).reduce((s, b) => s + (Number(b.AMOUNT) || 0), 0)
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
      const effects = computeSurchargeEffects(phases, surcharges, blItems, blComputedAmounts)
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
      setStep(6)
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally { setLoading(false) }
  }

  async function doSyncToStructure() {
    if (!calcMaster) { onDone?.(); return }
    setLoading(true)
    try {
      const res = await syncFeeCalcToStructure(calcMaster.ID)
      setMsg({ text: res.message, type: 'success' })
      if (res.projectId) void qc.invalidateQueries({ queryKey: ['structure', res.projectId] })
    } catch {
      setMsg({ text: 'Fehler beim Aktualisieren der Projektstruktur.', type: 'error' })
    } finally {
      setLoading(false)
      setTimeout(() => onDone?.(), 1500)
    }
  }

  async function finish() {
    if (!calcMaster) return
    if (!fatherId) { setMsg({ text: 'Bitte übergeordnetes Projektelement wählen', type: 'error' }); return }
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

  async function finishOffer() {
    if (!calcMaster) return
    if (!fatherId) { setMsg({ text: 'Bitte übergeordnetes Strukturelement wählen', type: 'error' }); return }
    setLoading(true); setMsg({ text: 'Erzeuge Angebotsstruktur …', type: 'info' })
    try {
      // Save ATTACH_TO_OFFER_STRUCTURE_ID for when offer is converted to project
      await saveFeeCalcBasis(calcMaster.ID, {
        ATTACH_TO_OFFER_STRUCTURE_ID: Number(fatherId),
      })
      // Immediately create OFFER_STRUCTURE entries under the selected parent
      const res = await attachFeeToOfferStructure(calcMaster.ID, Number(fatherId))
      if (calcMaster.OFFER_ID != null) {
        void qc.invalidateQueries({ queryKey: ['offer-structure', calcMaster.OFFER_ID] })
      }
      void qc.invalidateQueries({ queryKey: ['fee-calc-masters'] })
      setMsg({ text: res.message || 'Angebotsstruktur wurde angelegt ✅', type: 'success' })
      setTimeout(() => resetWizard(), 1200)
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
    setFatherId(''); setMsg(null)
    onDone?.()
  }

  async function cancelAndDelete() {
    if (!isEdit && calcMaster) {
      try { await deleteFeeCalcMaster(calcMaster.ID) } catch { /* ignore */ }
    }
    setStep(firstStep); setCalcMaster(null); setPhases([]); setBlItems([]); setSurcharges([])
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
        PERCENT: null, BASE_AMOUNT: totalPhaseRev + blTotal, AMOUNT: null,
        SORT_ORDER: prev.length, LPH_FILTER: null, CALC_MODE: 'parallel', INCLUDE_BL: false, BL_FILTER: null,
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

  function toggleSurchargeBl(surchargeIdx: number, blId: number) {
    setSurcharges(prev => prev.map((r, i) => {
      if (i !== surchargeIdx) return r
      const current: number[] = r.BL_FILTER ? (JSON.parse(r.BL_FILTER) as number[]) : []
      const next = current.includes(blId) ? current.filter(id => id !== blId) : [...current, blId]
      return { ...r, BL_FILTER: next.length > 0 ? JSON.stringify(next) : null }
    }))
  }

  function setSurchargeAllBl(surchargeIdx: number, all: boolean) {
    setSurcharges(prev => prev.map((r, i) => {
      if (i !== surchargeIdx) return r
      const allIds = blItems.map(b => b.ID).filter((id): id is number => id != null)
      return { ...r, BL_FILTER: all && allIds.length > 0 ? JSON.stringify(allIds) : null }
    }))
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
          {!isOfferMode && (
            <div className="form-group">
              <label>Projekt*</label>
              <select value={projectId} onChange={e => { setProjectId(e.target.value); setBasis(b => ({ ...b, PROJECT_ID: e.target.value })) }}>
                <option value="">Bitte wählen …</option>
                {projects.map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>)}
              </select>
            </div>
          )}
          {isOfferMode && (
            <div className="form-group">
              <label>Angebot</label>
              <input readOnly value={`Angebot #${offerId ?? '?'} (festgelegt)`} style={{ background: '#f9fafb', color: '#6b7280' }} />
            </div>
          )}
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
          {isOfferMode ? (
            <div className="form-group">
              <label>Angebot</label>
              <input readOnly value={`Angebot #${offerId ?? '?'} (festgelegt)`} style={{ background: '#f9fafb', color: '#6b7280' }} />
            </div>
          ) : (
            <div className="form-group">
              <label>Projekt</label>
              <select value={basis.PROJECT_ID} onChange={e => { setBasis(b => ({ ...b, PROJECT_ID: e.target.value })); setProjectId(e.target.value) }}>
                <option value="">—</option>
                {projects.map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label style={{ display: 'inline-flex', alignItems: 'center' }}>
              Honorarzone <HelpHint id="hoai.zone" />
            </label>
            <select value={basis.ZONE_ID} onChange={e => setBasis(b => ({ ...b, ZONE_ID: e.target.value }))}>
              <option value="">—</option>
              {zones.map(z => <option key={z.ID} value={z.ID}>{z.NAME_SHORT}{z.NAME_LONG ? ' – ' + z.NAME_LONG : ''}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Zonenanteil %</label>
            <input type="number" step="0.01" value={basis.ZONE_PERCENT} onChange={e => setBasis(b => ({ ...b, ZONE_PERCENT: e.target.value }))} />
          </div>
          <p className="admin-block-title" style={{ marginTop: 12 }}>{baseLabel}</p>
          {isAreaHa ? (
            <div className="form-group">
              <label>Plangebiet</label>
              <input
                type="number" step="0.01" min={0}
                value={basis.K0}
                onChange={e => setBasis(b => ({ ...b, K0: e.target.value, K1: '', K2: '', K3: '', K4: '' }))}
                placeholder="Größe des Plangebiets in ha"
              />
              <p className="admin-section-hint">
                Bei Flächenplanung wird das Honorar aus der Plangebietsgröße in
                Hektar interpoliert (HOAI 2021 §17 ff.).
              </p>
            </div>
          ) : (
            <div className="fee-k-grid">
              {(['K0','K1','K2','K3','K4'] as const).map(k => (
                <div key={k} className="form-group">
                  <label>{k}</label>
                  <input type="number" step="0.01" value={(basis as Record<string, string>)[k]} onChange={e => setBasis(b => ({ ...b, [k]: e.target.value }))} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Leistungsphasen ────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {isEdit ? 'Schritt 2' : 'Schritt 3'}: Leistungsphasen <HelpHint id="hoai.lph" />
          </h3>
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
                        <select className="tbl-select" value={p.KX || 'K0'} onChange={e => updatePhaseKx(p.ID, e.target.value)} disabled={isAreaHa}>
                          {kxOptionsForBase.map(k => <option key={k} value={k}>{k}</option>)}
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
            Werden separat im Gesamthonorar ausgewiesen und als eigene Elemente in der Projektstruktur angelegt.
          </p>
          {blItems.length > 0 && (
            <div className="table-scroll" style={{ marginBottom: 8 }}>
              <table className="master-table">
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>Kürzel</th>
                    <th style={{ width: '22%' }}>Bezeichnung</th>
                    <th style={{ width: 120 }}>LPH-Bezug</th>
                    <th style={{ width: 160 }}>Berechnungsart</th>
                    <th style={{ width: 70, textAlign: 'right' }}>%</th>
                    <th style={{ width: 80 }}>Kx</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Betrag €</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {blItems.map((b, idx) => {
                    const computed = blComputedAmounts[idx] ?? 0
                    const isFixed = !b.AMOUNT_TYPE || b.AMOUNT_TYPE === 'fixed'
                    const needsKx = b.AMOUNT_TYPE === 'pct_basis' || b.AMOUNT_TYPE === 'pct_baukosten'
                    const updateBl = (patch: Partial<FeeCalcBl>) =>
                      setBlItems(prev => prev.map((x, i) => i === idx ? { ...x, ...patch } : x))
                    return (
                      <tr key={idx}>
                        <td>
                          <input className="tbl-input" style={{ width: '100%' }} placeholder="Kürzel"
                            value={b.NAME_SHORT ?? ''}
                            onChange={e => updateBl({ NAME_SHORT: e.target.value || null })} />
                        </td>
                        <td>
                          <input className="tbl-input" style={{ width: '100%' }} placeholder="Bezeichnung"
                            value={b.NAME}
                            onChange={e => updateBl({ NAME: e.target.value })} />
                        </td>
                        <td>
                          <select className="tbl-select" style={{ width: '100%' }}
                            value={b.LPH_PHASE_ID != null ? String(b.LPH_PHASE_ID) : ''}
                            onChange={e => updateBl({ LPH_PHASE_ID: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">— keine —</option>
                            {phases.map(p => (
                              <option key={p.ID} value={String(p.ID)}>{p.PHASE_LABEL}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select className="tbl-select" style={{ width: '100%' }}
                            value={b.AMOUNT_TYPE || 'fixed'}
                            onChange={e => updateBl({ AMOUNT_TYPE: e.target.value as BlAmountType, PERCENT: null, KX_REF: null })}>
                            {(Object.entries(BL_AMOUNT_TYPE_LABELS) as [BlAmountType, string][])
                              .filter(([k]) => k !== 'pct_gesamthonorar')
                              .filter(([k]) => !(isAreaHa && k === 'pct_baukosten'))
                              .map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                          </select>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {!isFixed && (
                            <input className="tbl-input" type="number" step="0.01" style={{ width: 70, textAlign: 'right' }}
                              value={b.PERCENT != null ? String(b.PERCENT) : ''}
                              onChange={e => updateBl({ PERCENT: toNum(e.target.value) })} />
                          )}
                        </td>
                        <td>
                          {needsKx && (
                            <select className="tbl-select" style={{ width: '100%' }}
                              value={b.KX_REF || ''}
                              onChange={e => updateBl({ KX_REF: e.target.value || null })}>
                              <option value="">— Kx —</option>
                              {kxOptionsForBase.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isFixed ? (
                            <input className="tbl-input" type="number" step="0.01" style={{ width: 110, textAlign: 'right' }}
                              value={b.AMOUNT !== 0 ? String(b.AMOUNT) : ''}
                              onChange={e => updateBl({ AMOUNT: toNum(e.target.value) ?? 0 })} />
                          ) : (
                            <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>
                              {fmtEur(computed)}
                            </span>
                          )}
                        </td>
                        <td>
                          <button type="button" className="btn-small"
                            onClick={() => setBlItems(prev => prev.filter((_, i) => i !== idx))}>×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={6}>Summe Besondere Leistungen</th>
                    <th style={{ textAlign: 'right' }}>{fmtEur(blTotal)}</th>
                    <th></th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <button type="button" className="btn-small" onClick={() => {
            if (!calcMaster) return
            setBlItems(prev => [...prev, {
              FEE_CALC_MASTER_ID: calcMaster.ID,
              NAME_SHORT: null, NAME: '', LPH_REF: null, LPH_PHASE_ID: null,
              AMOUNT_TYPE: 'fixed', PERCENT: null, KX_REF: null,
              AMOUNT: 0, SORT_ORDER: prev.length,
            }])
          }}>+ Besondere Leistung hinzufügen</button>
          {blItems.length === 0 && (
            <p className="empty-note" style={{ marginTop: 8 }}>Keine Besonderen Leistungen — Schritt überspringen ist möglich.</p>
          )}
        </div>
      )}

      {/* ── Step 5: Zuschläge & Nachlässe ────────────────────────────────────── */}
      {step === 5 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {isEdit ? 'Schritt 4' : 'Schritt 5'}: Zuschläge &amp; Nachlässe <HelpHint id="hoai.zuschlag" />
          </h3>

          <div className="admin-block" style={{ marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Grundhonorar: </span>
              <strong>{fmtEur(totalPhaseRev)}</strong>
            </div>
            {blTotal !== 0 && (
              <div>
                <span style={{ fontSize: 12, color: '#6b7280' }}>+ BL: </span>
                <strong>{fmtEur(blTotal)}</strong>
              </div>
            )}
            <div>
              <span style={{ fontSize: 12, color: '#6b7280' }}>+ Zuschläge: </span>
              <strong>{fmtEur(totalSurchargeAmt)}</strong>
            </div>
            <div style={{ borderLeft: '2px solid #e5e7eb', paddingLeft: 16 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Gesamt: </span>
              <strong style={{ fontSize: 15 }}>{fmtEur(totalPhaseRev + blTotal + totalSurchargeAmt)}</strong>
            </div>
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
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <strong style={{ fontSize: 12, color: '#374151' }}>Betroffene Besondere Leistungen:</strong>
                                    <button type="button" className="btn-small" onClick={() => setSurchargeAllBl(idx, true)}>Alle</button>
                                    <button type="button" className="btn-small" onClick={() => setSurchargeAllBl(idx, false)}>Keine</button>
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                                    {blItems.map(b => {
                                      const selectedBlIds: number[] = r.BL_FILTER ? (JSON.parse(r.BL_FILTER) as number[]) : []
                                      const checked = b.ID != null && selectedBlIds.includes(b.ID)
                                      return (
                                        <label key={b.ID ?? b.SORT_ORDER} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                                          <input type="checkbox" checked={checked}
                                            onChange={() => { if (b.ID != null) toggleSurchargeBl(idx, b.ID) }} />
                                          {b.NAME_SHORT ? `${b.NAME_SHORT} — ${b.NAME || ''}` : (b.NAME || `BL ${b.SORT_ORDER + 1}`)}
                                        </label>
                                      )
                                    })}
                                  </div>
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
        </div>
      )}

      {/* ── Step 6: Zusammenfassung (both create + edit) ─────────────────────── */}
      {step === 6 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">
            {isEdit ? 'Schritt 5' : 'Schritt 6'}: Zusammenfassung
            {!isEdit && ' & Zuordnen'}
          </h3>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
            {calcMaster?.NAME_SHORT}{calcMaster?.NAME_LONG ? ' – ' + calcMaster.NAME_LONG : ''}
            {isEdit
              ? ' · Übersicht über die aktualisierten Werte:'
              : ' · Folgende Elemente werden in der Projektstruktur angelegt:'}
          </p>

          {/* Overview table: LPH + BL rows */}
          <div className="table-scroll" style={{ marginBottom: 12 }}>
            <table className="master-table">
              <thead>
                <tr>
                  <th>Bezeichnung</th>
                  <th style={{ width: 120, color: '#6b7280', fontWeight: 400 }}>Typ</th>
                  <th style={{ width: 140, textAlign: 'right' }}>Honorar (netto) €</th>
                </tr>
              </thead>
              <tbody>
                {/* LPH phase rows */}
                {phases.filter(p => (p.PHASE_REVENUE ?? 0) !== 0).map(p => (
                  <tr key={p.ID}>
                    <td style={{ fontSize: 13 }}>{p.PHASE_LABEL}</td>
                    <td style={{ fontSize: 11, color: '#6b7280' }}>Grundleistung</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtEur(p.PHASE_REVENUE)}</td>
                  </tr>
                ))}
                {/* Grundhonorar summary */}
                <tr style={{ borderTop: '2px solid #d1d5db', background: '#f9fafb' }}>
                  <td colSpan={2} style={{ fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>Grundhonorar</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>{fmtEur(totalPhaseRev)}</td>
                </tr>
                {/* BL rows */}
                {blTotal !== 0 && blItems.map((b, i) => blComputedAmounts[i] !== 0 && (
                  <tr key={`bl-${i}`}>
                    <td style={{ fontSize: 13 }}>{[b.NAME_SHORT, b.NAME].filter(Boolean).join(': ') || `BL ${i + 1}`}</td>
                    <td style={{ fontSize: 11, color: '#6b7280' }}>Besondere Leistung</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtEur(blComputedAmounts[i])}</td>
                  </tr>
                ))}
                {/* BL sum */}
                {blTotal !== 0 && (
                  <tr style={{ borderTop: '1px solid #d1d5db', background: '#f9fafb' }}>
                    <td colSpan={2} style={{ fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>+ Besondere Leistungen</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>{fmtEur(blTotal)}</td>
                  </tr>
                )}
                {/* Individual Zuschlag rows */}
                {surcharges.map((r, idx) => {
                  const eff = surchargeEffects[idx]
                  if (!eff || eff.amount === 0) return null
                  const label = [r.NAME_SHORT, r.NAME_LONG].filter(Boolean).join(': ') || `Zuschlag ${idx + 1}`
                  return (
                    <tr key={`s-${idx}`}>
                      <td style={{ fontSize: 13 }}>{label}</td>
                      <td style={{ fontSize: 11, color: '#6b7280' }}>
                        {(r.PERCENT ?? 0) >= 0 ? 'Zuschlag' : 'Nachlass'} {r.PERCENT ?? 0}&nbsp;%
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtEur(eff.amount)}</td>
                    </tr>
                  )
                })}
                {/* Zuschläge sum */}
                {totalSurchargeAmt !== 0 && (
                  <tr style={{ borderTop: '1px solid #d1d5db', background: '#f9fafb' }}>
                    <td colSpan={2} style={{ fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>+ Zuschläge / Nachlässe</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>{fmtEur(totalSurchargeAmt)}</td>
                  </tr>
                )}
                {/* Gesamthonorar */}
                <tr style={{ borderTop: '2px solid #374151' }}>
                  <td colSpan={2} style={{ fontWeight: 700, fontSize: 15, padding: '8px 8px' }}>Gesamthonorar</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 15, padding: '8px 8px' }}>{fmtEur(totalPhaseRev + blTotal + totalSurchargeAmt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* Edit mode: sync choice */}
          {isEdit && (
            <div className="admin-block" style={{ background: '#fef9c3', border: '1px solid #fbbf24', padding: 14 }}>
              <p style={{ marginBottom: 10, fontWeight: 500, fontSize: 13 }}>
                Sollen die verknüpften Projektelemente mit den aktualisierten Honorarwerten überschrieben werden?
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-primary" onClick={() => void doSyncToStructure()} disabled={loading}>
                  Ja, Projektstruktur aktualisieren
                </button>
                <button type="button" onClick={() => onDone?.()}>Nein, nur speichern</button>
              </div>
            </div>
          )}

          {/* Create mode (project): structure selector */}
          {!isEdit && !isOfferMode && (
            <div className="form-group">
              <label>Übergeordnetes Projektelement*</label>
              <select value={fatherId} onChange={e => setFatherId(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {structureNodes.map(s => (
                  <option key={s.STRUCTURE_ID} value={s.STRUCTURE_ID}>
                    {s.NAME_SHORT} – {s.NAME_LONG}
                  </option>
                ))}
              </select>
              {!basis.PROJECT_ID && <p className="empty-note">Erst Projekt in Schritt 2 wählen, um Projektelemente zu laden.</p>}
            </div>
          )}

          {/* Create mode (offer): offer structure selector (optional) */}
          {!isEdit && isOfferMode && (
            <div className="form-group">
              <label>Angebotsposition zuordnen (optional)</label>
              <select value={fatherId} onChange={e => setFatherId(e.target.value)}>
                <option value="">— Keine Zuordnung —</option>
                {offerStructureNodes.map(s => (
                  <option key={s.ID} value={s.ID}>
                    {s.NAME_SHORT ? `${s.NAME_SHORT} – ` : ''}{s.NAME_LONG ?? `Position ${s.ID}`}
                  </option>
                ))}
              </select>
              <p className="empty-note" style={{ marginTop: 4 }}>
                Wird beim Annehmen des Angebots als Unterposition in der Projektstruktur angelegt.
              </p>
            </div>
          )}
        </div>
      )}

      <Message text={msg?.text ?? null} type={msg?.type} />

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
          <button className="btn-primary" type="button" onClick={saveSurchargesAndGo} disabled={loading}>Speichern &amp; Weiter →</button>
        )}
        {step === 6 && !isEdit && !isOfferMode && (
          <button className="btn-primary" type="button" onClick={finish} disabled={loading || !fatherId}>Projektstruktur anlegen</button>
        )}
        {step === 6 && !isEdit && isOfferMode && (
          <button className="btn-primary" type="button" onClick={() => void finishOffer()} disabled={loading}>Fertig ✓</button>
        )}
      </div>
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
  const [showOfferCalcs, setShowOfferCalcs] = useState(false)

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

  // By default hide offer-only calcs (PROJECT_ID null, OFFER_ID set); user can toggle
  const visibleRows = showOfferCalcs
    ? allRows
    : allRows.filter(r => r.PROJECT_ID != null || r.OFFER_ID == null)

  const allParas    = Array.from(new Set(visibleRows.map(r => r.NAME_SHORT).filter((s): s is string => !!s))).sort()
  const allProjekte = Array.from(new Set(visibleRows.map(r => r.projectLabel ?? r.offerLabel).filter((s): s is string => !!s))).sort()

  // Client-side search + filter
  const q = search.trim().toLowerCase()
  const filtered = visibleRows.filter(r => {
    const label = r.projectLabel ?? r.offerLabel ?? ''
    if (paraFilter.size > 0 && !(r.NAME_SHORT && paraFilter.has(r.NAME_SHORT))) return false
    if (projektFilter.size > 0 && !projektFilter.has(label)) return false
    if (!q) return true
    return (
      (r.NAME_SHORT ?? '').toLowerCase().includes(q) ||
      (r.NAME_LONG  ?? '').toLowerCase().includes(q) ||
      label.toLowerCase().includes(q)
    )
  })

  const sorted = [...filtered].sort((a, b) => {
    let va: string | number = 0
    let vb: string | number = 0
    if (sort.col === 'nameShort')    { va = a.NAME_SHORT ?? ''; vb = b.NAME_SHORT ?? '' }
    if (sort.col === 'nameLong')     { va = a.NAME_LONG  ?? ''; vb = b.NAME_LONG  ?? '' }
    if (sort.col === 'project')      { va = (a.projectLabel ?? a.offerLabel) ?? ''; vb = (b.projectLabel ?? b.offerLabel) ?? '' }
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showOfferCalcs} onChange={e => setShowOfferCalcs(e.target.checked)} />
          Angebots-Kalkulationen
        </label>
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
                  <td>
                    {r.projectLabel
                      ? r.projectLabel
                      : r.offerLabel
                        ? <span style={{ color: '#7c3aed' }}>{r.offerLabel}</span>
                        : '—'}
                  </td>
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
                      {r.OFFER_ID != null && r.PROJECT_ID == null && (
                        <button type="button" className="btn-small" title="Zum Angebot"
                          onClick={() => navigate('/angebote', { state: { offerId: r.OFFER_ID } })}>
                          → Angebot
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
