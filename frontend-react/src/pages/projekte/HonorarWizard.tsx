import { useState, useEffect, useLayoutEffect, useCallback, useRef, Fragment } from 'react'
import { useConfirm } from '@/hooks/useConfirm'
import { ChevronLeft, ChevronRight, ChevronDown, Check, FileText, Plus, X } from 'lucide-react'
import { StepIndicator } from '@/components/ui/StepIndicator'
import { ActionBar } from '@/components/ui/ActionBar'
import { RowMenu } from '@/components/ui/RowMenu'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Message } from '@/components/ui/Message'
import { HelpHint } from '@/components/ui/HelpHint'
import type { HelpId } from '@/help/helpContent'
import {
  fetchFeeGroups, fetchFeeMasters, fetchFeeZones,
  fetchFeeCalcMaster,
  initFeeCalcMaster, saveFeeCalcBasis, initFeePhases, saveFeePhases,
  deleteFeeCalcMaster, attachFeeToStructure, attachFeeToOfferStructure,
  fetchFeeSurchargesGlobal, fetchFeeCalcSurcharges, saveFeeCalcSurcharges,
  fetchFeeCalcBl, saveFeeCalcBl,
  openHonorarPdf, syncFeeCalcToStructure,
  type FeeCalcMaster, type FeePhaseRow, type FeeCalcSurcharge, type FeeSurchargeGlobal, type FeeCalcBl, type BlAmountType,
} from '@/api/fee'
import { fetchProjectsShort, fetchProjectStructure, fetchParentChildCheck } from '@/api/projekte'
import { fetchOffer, fetchOfferStructure, type OfferStructureNode } from '@/api/angebote'
import { useRegisterDirty, useGuardedAction } from '@/hooks/useDirtyGuard'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useToast } from '@/store/toastStore'

import { Din276Editor } from '@/pages/projekte/Din276Editor'
import { MischhonorarEditor } from '@/pages/projekte/MischhonorarEditor'
import { ObjektlisteZonePicker } from '@/pages/projekte/ObjektlisteZonePicker'
import { ZonenPunkteRechner } from '@/pages/projekte/ZonenPunkteRechner'
import { RecentList } from '@/components/recents/RecentList'
import { trackRecent, type RecentEntry } from '@/api/recents'
import { fmtEur, money } from '@/utils/money'
import { SurchargeAmount } from '@/pages/projekte/struktur/SurchargeAmount'
import {
  KX_OPTIONS, type KX, fmtN, fmtMoney2, fmtPct, toNum, revenueByKx, phaseRevenue,
  computeSurchargeEffects, BL_AMOUNT_TYPE_LABELS, computeBlItemAmount,
} from '@/pages/projekte/kalkCalc'
import { KalkList, PhaseSheet, BlSheet, SurchargeSheet, surchargeScope, blScope } from '@/pages/projekte/KalkMobile'

/** Zeilen in Baumreihenfolge mit Tiefe — fuer eingerueckte Auswahllisten. */
function inTreeOrder<T>(rows: T[], idOf: (r: T) => number, fatherOf: (r: T) => number | null | undefined) {
  const ids  = new Set(rows.map(idOf))
  const kids = new Map<number | null, T[]>()
  for (const r of rows) {
    const f = fatherOf(r)
    const k = f != null && ids.has(f) ? f : null
    kids.set(k, [...(kids.get(k) ?? []), r])
  }
  const out: { row: T; depth: number }[] = []
  const walk = (k: number | null, depth: number) => {
    for (const r of kids.get(k) ?? []) { out.push({ row: r, depth }); walk(idOf(r), depth + 1) }
  }
  walk(null, 0)
  return out
}
const INDENT = '\u00a0\u00a0\u00a0'

function newSurchargeRow(calcMasterId: number, sortOrder: number): FeeCalcSurcharge {
  return {
    FEE_CALC_MASTER_ID: calcMasterId, FEE_SURCHARGE_ID: null,
    ABBR: '', NAME: '', PERCENT: null, BASE_AMOUNT: null, AMOUNT: null,
    SORT_ORDER: sortOrder, LPH_FILTER: null, CALC_MODE: 'parallel', INCLUDE_BL: false, BL_FILTER: null,
  }
}

// ── Step indicator ────────────────────────────────────────────────────────────

// Sprechende Schritte wie bei den Rechnungsassistenten (UI-Pilot Runde 5) —
// vorher „1 2 3 4 5 6" und je Schritt eine Ueberschrift „Schritt 3: …".
// Beim Bearbeiten entfaellt die Wahl des Leistungsbilds.
/** Schluessel beim Guard — damit ein Dialog beim Schliessen nur hiernach fragt. */
export const HONORAR_WIZARD_GUARD = 'honorar-wizard'

const CREATE_STEPS = ['Leistungsbild', 'Grundlagen', 'Leistungsphasen', 'Besondere Leistungen', 'Zuschläge', 'Übernehmen']
const EDIT_STEPS   = CREATE_STEPS.slice(1, 5).concat('Übersicht')
const CREATE_HELP: HelpId[] = ['hoai.leistungsbild', 'hoai.grundlagen', 'hoai.lph', 'hoai.bl', 'hoai.zuschlag', 'hoai.uebernehmen']
const EDIT_HELP:   HelpId[] = CREATE_HELP.slice(1)

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
  const [confirm, confirmDialog] = useConfirm()
  const qc = useQueryClient()
  const isEdit      = !!existingId
  const isOfferMode = !!offerId

  const firstStep  = isEdit ? 2 : 1

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
    ABBR: '', NAME: '', PROJECT_ID: '', ZONE_ID: '', ZONE_PERCENT: '',
    K0: '', K1: '', K2: '', K3: '', K4: '',
  })
  const [din276Open, setDin276Open] = useState(false)
  const [mischOpen,  setMischOpen]  = useState(false)
  const [objektlisteOpen, setObjektlisteOpen] = useState(false)
  const [punkteOpen, setPunkteOpen] = useState(false)
  const [din276EstimateId,    setDin276EstimateId]    = useState<number | null>(null)
  const [din276Leistungsbild, setDin276Leistungsbild] = useState<string | null>(null)
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
  // Handy: offene Zeile als Blatt (Runde 8). idx null = neue Zeile.
  const [sheet, setSheet] = useState<
    | { kind: 'lph'; id: number }
    | { kind: 'bl'; idx: number | null }
    | { kind: 'sur'; idx: number | null }
    | null
  >(null)

  // Step 6
  const [fatherId, setFatherId] = useState(initialFatherId != null ? String(initialFatherId) : '')
  const [syncStructure, setSyncStructure] = useState(true)

  const toast   = useToast()
  const narrow  = useIsNarrow()
  const guarded = useGuardedAction()
  // Stand des aktuellen Schritts, wie er zuletzt geladen oder gespeichert
  // wurde (siehe stepSnapshot); `mark` meldet „neu geladen/gespeichert".
  const [baseline, setBaseline] = useState('')
  const [mark, setMark]         = useState(0)

  const { data: groupsData }   = useQuery({ queryKey: ['fee-groups'],     queryFn: fetchFeeGroups })
  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  // Im Angebots-Modus den Angebotsnamen laden — statt der globalen, tenant-
  // übergreifenden OFFER-ID die nutzerseitige Angebotsnummer + den Titel zeigen.
  const { data: offerData } = useQuery({
    queryKey: ['offer', offerId],
    queryFn:  () => fetchOffer(offerId!),
    enabled:  !!offerId,
  })
  const offerLabel = offerData?.data
    ? [offerData.data.ABBR, offerData.data.NAME].filter(Boolean).join(' – ')
    : 'Angebot'

  const groups   = groupsData?.data   ?? []
  const projects = projectsData?.data ?? []

  // Abbruch-Schutz: Eine im Wizard angelegte (noch nicht abgeschlossene)
  // Kalkulation darf beim Schließen des Fensters NICHT bestehen bleiben.
  // committedRef wird auf true gesetzt, sobald die Kalkulation regulär
  // fertiggestellt (oder bereits manuell gelöscht) wurde.
  const committedRef     = useRef(false)
  const calcMasterIdRef  = useRef<number | null>(null)

  const totalPhaseRev = phases.reduce((s, p) => s + (p.PHASE_REVENUE ?? 0), 0)

  // Bemessungsgrundlage des Leistungsbilds — bestimmt UI/PDF-Labels und ob
  // K0..K4 oder nur ein einzelnes Basis-Feld (ha / VE) angezeigt wird.
  // Fallback 'cost_eur' = bisheriges Verhalten.
  const baseType: 'cost_eur' | 'area_ha' | 'verrechnungseinheiten' | 'percent_of_baukosten' | 'flaechenaequivalent_brandschutz' =
    calcMaster?.BASE_TYPE
    ?? (feeMasterId
          ? (masters.find(m => String(m.ID) === String(feeMasterId))?.BASE_TYPE ?? 'cost_eur')
          : 'cost_eur')
  // Das gewählte Leistungsbild. `feeMasterId` (Dropdown in Schritt 1) ist nur
  // im ANLEGE-Modus gefüllt — beim Öffnen einer bestehenden Berechnung bleibt
  // es leer. Maßgeblich ist deshalb zuerst die Berechnung selbst; sonst
  // bekämen die Zonen-Dialoge im Bearbeiten-Modus null und meldeten
  // „Bitte zuerst ein Leistungsbild wählen".
  const activeFeeMasterId = calcMaster?.FEE_MASTER_ID ?? (feeMasterId ? Number(feeMasterId) : null)

  // Zonenaufteilung/Mischhonorar gilt nur für die Technische Ausrüstung
  // (§ 54). Kommt als Merkmal vom Leistungsbild, nicht über eine ID-Abfrage —
  // dieselbe Leistung hat je HOAI-Fassung eine andere ID.
  const supportsZoneSplit =
    calcMaster?.SUPPORTS_ZONE_SPLIT
    ?? (feeMasterId
          ? (masters.find(m => String(m.ID) === String(feeMasterId))?.SUPPORTS_ZONE_SPLIT ?? false)
          : false)
  const isAreaHa  = baseType === 'area_ha'
  const isVerrechnungseinheiten = baseType === 'verrechnungseinheiten'
  // Kalkulationstypen ohne Honorarzone/-tafel (z. B. AHO-Leistungsbilder):
  // K0..K4 bleiben nutzbar wie bei cost_eur, nur ohne Zonen-Interpolation —
  // "Zonenanteil %" wird zum frei vereinbarten Honorarsatz % zweckentfremdet.
  const isPercentOfBaukosten = baseType === 'percent_of_baukosten'
  // AHO Heft 17 (Brandschutz): H = 2.600 € + f × Aq^0,61. K0 = Flächenäquivalent
  // Aq (m², extern aus Kalkulationseinheiten ermittelt), "Zonenanteil %" wird
  // zum Faktor f zweckentfremdet — kein Zonen-, kein K1..K4-Konzept.
  const isFlaechenaequivalent = baseType === 'flaechenaequivalent_brandschutz'
  // Diese drei haben nur EINEN Basiswert (kein K0..K4-Band, keine
  // Baukosten-Zuschläge) — unterscheiden sich nur im Label.
  const isSingleValue = isAreaHa || isVerrechnungseinheiten || isFlaechenaequivalent
  // percent_of_baukosten und flaechenaequivalent_brandschutz haben beide kein
  // Zonen-Konzept (frei vereinbarter Satz statt gesetzlicher Zonentafel).
  const isZoneless = isPercentOfBaukosten || isFlaechenaequivalent
  const baseLabel = isAreaHa ? 'Plangebiet (ha)'
    : isVerrechnungseinheiten ? 'Verrechnungseinheiten (VE)'
    : isFlaechenaequivalent ? 'Flächenäquivalent Aq (m²)'
    : 'Baukosten (€)'
  const kxOptionsForBase = isSingleValue ? (['K0'] as const) : KX_OPTIONS

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

  // Keep the in-progress calc ID in a ref for the unmount cleanup below
  useEffect(() => { calcMasterIdRef.current = calcMaster?.ID ?? null }, [calcMaster])

  // On unmount: if a NEW calc was created in the wizard but never completed
  // (window closed, backdrop click, navigated away …), delete it so it is not
  // silently persisted. Edit mode and completed calcs are left untouched.
  useEffect(() => {
    return () => {
      if (isEdit) return
      if (committedRef.current) return
      const id = calcMasterIdRef.current
      if (id) void deleteFeeCalcMaster(id).catch(() => {})
    }
  }, [isEdit])

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
      ABBR:   row.ABBR ?? '',
      NAME:    row.NAME  ?? '',
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
    setDin276EstimateId(row.DIN276_ESTIMATE_ID ?? null)
    setDin276Leistungsbild(row.DIN276_LEISTUNGSBILD ?? null)
    setMark(m => m + 1)
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

  /**
   * „Zuletzt verwendet"-Eintrag übernehmen: Honorarordnung nachladen und
   * beide Auswahlfelder setzen. Die Gruppe steckt in META (beim Tracking
   * mitgeschrieben) — ohne sie bliebe das Leistungsbild-Feld gesperrt.
   */
  async function selectRecentFeeMaster(entry: RecentEntry) {
    const gid = (entry.META as { fee_group_id?: number | null } | null)?.fee_group_id
    if (gid != null) {
      await loadMasters(String(gid))
      setFeeMasterId(String(entry.ENTITY_ID))
      return
    }
    // Ohne Gruppen-Angabe (Alteintrag): in allen Honorarordnungen suchen.
    for (const g of groups) {
      try {
        const r = await fetchFeeMasters(g.ID)
        if ((r.data ?? []).some(m => String(m.ID) === String(entry.ENTITY_ID))) {
          await loadMasters(String(g.ID))
          setFeeMasterId(String(entry.ENTITY_ID))
          return
        }
      } catch { /* nächste Gruppe versuchen */ }
    }
    setMsg({ text: 'Dieses Leistungsbild ist nicht mehr verfügbar.', type: 'error' })
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
      ABBR:   row.ABBR ?? '',
      NAME:    row.NAME  ?? '',
      PROJECT_ID:   row.PROJECT_ID != null ? String(row.PROJECT_ID) : (initialProjectId ? String(initialProjectId) : ''),
      ZONE_ID:      row.ZONE_ID    != null ? String(row.ZONE_ID) : '',
      ZONE_PERCENT: fmtN(row.ZONE_PERCENT),
      K0: fmtN(row.CONSTRUCTION_COSTS_K0), K1: fmtN(row.CONSTRUCTION_COSTS_K1),
      K2: fmtN(row.CONSTRUCTION_COSTS_K2), K3: fmtN(row.CONSTRUCTION_COSTS_K3),
      K4: fmtN(row.CONSTRUCTION_COSTS_K4),
    })
    const pid = row.PROJECT_ID != null ? String(row.PROJECT_ID) : (initialProjectId ? String(initialProjectId) : '')
    setProjectId(pid)
    setDin276EstimateId(row.DIN276_ESTIMATE_ID ?? null)
    setDin276Leistungsbild(row.DIN276_LEISTUNGSBILD ?? null)
    setMark(m => m + 1)
  }

  // ── Offene Aenderungen und Rueckfrage ────────────────────────────────────────

  // Offen ist, was vom zuletzt geladenen oder gespeicherten Stand abweicht —
  // auch Klicks (Zeile hinzufuegen, Modus umschalten), die kein
  // change-Ereignis ausloesen. Vorher ging ein bearbeiteter Schritt beim
  // Schliessen des Fensters (Escape, X) ohne jede Rueckfrage verloren.
  function stepSnapshot(): string {
    if (step === 2) return JSON.stringify([basis, din276EstimateId, din276Leistungsbild])
    if (step === 3) return JSON.stringify(phases.map(p => [p.ID, p.KX, p.FEE_PERCENT]))
    if (step === 4) return JSON.stringify(blItems)
    if (step === 5) return JSON.stringify(surcharges)
    return ''
  }
  const snapshot = stepSnapshot()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { setBaseline(snapshot) }, [step, mark])
  const stepDirty = snapshot !== baseline

  const calcLabel  = [calcMaster?.ABBR, calcMaster?.NAME].filter(Boolean).join(' ') || 'Neue Kalkulation'
  // Eine neue Kalkulation gilt erst mit „Übernehmen" als angelegt — bis dahin
  // verwirft das Verlassen sie (Unmount-Cleanup oben). Das sagt die Rueckfrage.
  const unfinished = !isEdit && !!calcMaster && !committedRef.current
  useRegisterDirty(HONORAR_WIZARD_GUARD, {
    dirty: isEdit ? stepDirty : unfinished,
    label: calcLabel,
    note:  isEdit ? undefined : `Die Kalkulation „${calcLabel}" ist noch nicht übernommen. Beim Verlassen wird sie verworfen.`,
    save:  isEdit ? persistStep : undefined,
  })

  /** Laeuft mit Sperre der Leiste; Fehler landen in der Meldung ueber ihr. */
  async function run(fn: () => Promise<void>) {
    setLoading(true); setMsg(null)
    try { await fn() }
    catch (e: unknown) { setMsg({ text: (e as Error).message, type: 'error' }) }
    finally { setLoading(false) }
  }

  // ── Speichern je Schritt (ohne Weitergehen) ──────────────────────────────────

  async function saveBasis(): Promise<FeeCalcMaster> {
    const updated = await saveFeeCalcBasis(calcMaster!.ID, {
      ABBR:                  basis.ABBR || null,
      NAME:                  basis.NAME || null,
      PROJECT_ID:            isOfferMode ? null : (basis.PROJECT_ID ? Number(basis.PROJECT_ID) : null),
      OFFER_ID:              isOfferMode ? offerId : null,
      ZONE_ID:               basis.ZONE_ID ? Number(basis.ZONE_ID) : null,
      ZONE_PERCENT:          toNum(basis.ZONE_PERCENT),
      CONSTRUCTION_COSTS_K0: toNum(basis.K0),
      CONSTRUCTION_COSTS_K1: isSingleValue ? null : toNum(basis.K1),
      CONSTRUCTION_COSTS_K2: isSingleValue ? null : toNum(basis.K2),
      CONSTRUCTION_COSTS_K3: isSingleValue ? null : toNum(basis.K3),
      CONSTRUCTION_COSTS_K4: isSingleValue ? null : toNum(basis.K4),
      DIN276_ESTIMATE_ID:    din276EstimateId,
      DIN276_LEISTUNGSBILD:  din276Leistungsbild,
    })
    populateBasis(updated.data)
    return updated.data
  }

  async function savePhases() {
    const saved = await saveFeePhases(calcMaster!.ID, phases.map(p => ({
      ID: p.ID, KX: p.KX || 'K0', FEE_PERCENT: p.FEE_PERCENT,
    })))
    setPhases(syncPhases(calcMaster!, saved.data ?? []))
  }

  async function saveBl(): Promise<FeeCalcBl[]> {
    // For pct_* types, store the computed AMOUNT so backend/PDF can use it directly
    const blToSave = blItems.map((b, i) => ({
      ...b,
      SORT_ORDER: i,
      AMOUNT: computeBlItemAmount(b, phases, calcMaster, totalPhaseRev, surchargeNoBlTotal),
    }))
    const savedBl = await saveFeeCalcBl(calcMaster!.ID, blToSave)
    // DB-IDs uebernehmen (BL_FILTER der Zuschlaege verweist darauf)
    const rows = savedBl.data ?? blToSave
    setBlItems(rows)
    return rows
  }

  async function saveSurcharges() {
    const effects = computeSurchargeEffects(phases, surcharges, blItems, blComputedAmounts)
    const rowsToSave = surcharges.map((r, i) => ({
      ...r,
      SORT_ORDER: i,
      BASE_AMOUNT: effects[i]?.effectiveBase ?? totalPhaseRev,
      LPH_FILTER: r.LPH_FILTER ?? null,
      CALC_MODE: r.CALC_MODE ?? 'parallel',
    }))
    await saveFeeCalcSurcharges(calcMaster!.ID, rowsToSave)
    void qc.invalidateQueries({ queryKey: ['fee-calc-masters'] })
  }

  /** Speichert den aktuellen Schritt; wirft bei Fehler (so braucht es der Guard). */
  async function persistStep() {
    if (!calcMaster) return
    if (step === 2) await saveBasis()
    if (step === 3) await savePhases()
    if (step === 4) await saveBl()
    if (step === 5) await saveSurcharges()
    setMark(m => m + 1)
  }

  // ── Weiter ───────────────────────────────────────────────────────────────────

  async function goNext1() {
    if (!feeMasterId) { setMsg({ text: 'Bitte Leistungsbild wählen', type: 'error' }); return }
    if (!isOfferMode && !projectId) { setMsg({ text: 'Bitte Projekt wählen', type: 'error' }); return }
    await run(async () => {
      // Es kann schon ein Entwurf existieren: „Weiter → Zurück → Weiter" hat
      // bisher JEDES Mal eine neue Kalkulation angelegt und die vorige verwaist
      // zurückgelassen (der Unmount-Cleanup räumt nur die zuletzt erzeugte auf).
      // Gleiches Leistungsbild → vorhandenen Entwurf weiterverwenden;
      // gewechseltes Leistungsbild → alten Entwurf löschen, dann neu anlegen.
      if (calcMaster && !isEdit) {
        if (String(calcMaster.FEE_MASTER_ID ?? '') === String(feeMasterId)) { setStep(2); return }
        try { await deleteFeeCalcMaster(calcMaster.ID) } catch { /* Entwurf bleibt liegen, kein Abbruchgrund */ }
        setCalcMaster(null)
      }
      // PROJECT_ID oder OFFER_ID muss beim Insert gesetzt sein (DB-Check
      // chk_fee_calc_master_source). Eines von beiden ist hier garantiert.
      const opts: { project_id?: number; offer_id?: number } = offerId
        ? { offer_id: offerId }
        : { project_id: Number(projectId) }
      const row = await initFeeCalcMaster(Number(feeMasterId), opts)
      const zonesRes = await fetchFeeZones(feeMasterId)
      setZones(zonesRes.data ?? [])
      populateBasis(row.data)
      // Leistungsbild als „zuletzt verwendet" merken. fee_group_id in META,
      // damit die Auswahl später beide Dropdowns wiederherstellen kann.
      const m = masters.find(x => String(x.ID) === String(feeMasterId))
      void trackRecent('fee_master', Number(feeMasterId),
        m ? `${m.ABBR}${m.NAME ? ' – ' + m.NAME : ''}` : String(feeMasterId),
        { fee_group_id: feeGroupId ? Number(feeGroupId) : null },
      ).catch(() => { /* Tracking ist Komfort, kein Grund den Wizard zu stoppen */ })
      setStep(2)
    })
  }

  async function nextFromStep() {
    if (!calcMaster) return
    await run(async () => {
      if (step === 2) {
        const updated = await saveBasis()
        const phasesRes = await initFeePhases(updated.ID)
        setPhases(syncPhases(updated, phasesRes.data ?? []))
        setStep(3)
      } else if (step === 3) {
        await savePhases()
        const blRes = await fetchFeeCalcBl(calcMaster.ID)
        setBlItems(blRes.data ?? [])
        setStep(4)
      } else if (step === 4) {
        const rows = await saveBl()
        const blSum = rows.reduce((s, b) => s + (Number(b.AMOUNT) || 0), 0)
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
        setStep(5)
      } else if (step === 5) {
        await saveSurcharges()
        setStep(6)
      }
    })
  }

  /** Zurueck oder auf einen erledigten Schritt: vorher den aktuellen speichern.
   *  Vorher blieb er ungespeichert im Speicher, und das naechste „Weiter" lud
   *  die Leistungsphasen neu vom Server — die Eingaben waren weg. */
  function goToStep(target: number) {
    if (target === step) return
    void run(async () => {
      if (stepDirty && calcMaster) await persistStep()
      setStep(target)
    })
  }

  /** Die Übersicht zeigt den Stand auf dem Server — also erst speichern. */
  function openPdf() {
    if (!calcMaster) return
    void run(async () => {
      if (stepDirty) await persistStep()
      openHonorarPdf(calcMaster.ID)
    })
  }

  // ── Übernehmen ───────────────────────────────────────────────────────────────

  async function finish() {
    if (!calcMaster) return
    if (!fatherId) { setMsg({ text: 'Bitte wählen, unter welchem Projektelement die Kalkulation stehen soll.', type: 'error' }); return }
    try {
      const check = await fetchParentChildCheck(Number(fatherId))
      if (check.status === 'blocked') {
        setMsg({ text: check.reason ?? 'Dieses Element kann keine Unterelemente erhalten.', type: 'error' }); return
      }
      if (check.status === 'needs_transfer') {
        const confirmMsg = check.hasTec
          ? 'Das übergeordnete Element enthält bereits Buchungen. Diese werden auf das erste neue Element übertragen. Fortfahren?'
          : 'Das übergeordnete Element enthält bereits Werte. Fortfahren?'
        if (!(await confirm({ title: 'Werte übertragen', message: confirmMsg, confirmLabel: 'Fortfahren', confirmClass: 'btn-primary' }))) return
      }
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message ?? 'Fehler beim Prüfen', type: 'error' }); return
    }
    await run(async () => {
      await attachFeeToStructure(calcMaster.ID, Number(fatherId), true)
      if (calcMaster.PROJECT_ID != null) {
        void qc.invalidateQueries({ queryKey: ['structure', calcMaster.PROJECT_ID] })
      }
      void qc.invalidateQueries({ queryKey: ['fee-calc-masters'] })
      toast.success(`Kalkulation „${calcLabel}" in die Struktur übernommen`)
      resetWizard()
    })
  }

  async function finishOffer() {
    if (!calcMaster) return
    await run(async () => {
      // Ohne Element legt das Backend eines auf oberster Ebene an und merkt
      // es sich als Anker fuer das Beauftragen (ATTACH_TO_OFFER_STRUCTURE_ID).
      await attachFeeToOfferStructure(calcMaster.ID, fatherId ? Number(fatherId) : null)
      committedRef.current = true   // erfolgreich verknüpft → nicht beim Schließen löschen
      const oid = calcMaster.OFFER_ID ?? offerId
      for (const key of [['offer-structure', oid], ['offer', oid], ['offers'], ['fee-calc-masters'], ['fee-calc-masters-offer', oid]]) {
        void qc.invalidateQueries({ queryKey: key })
      }
      toast.success(`Kalkulation „${calcLabel}" ins Angebot übernommen`)
      resetWizard()
    })
  }

  // Beim Bearbeiten: die Elemente, die aus dieser Kalkulation entstanden sind.
  // „Struktur aktualisieren" gibt es nur, wenn es welche gibt — vorher stand
  // die Frage immer da und endete sonst in „Keine verknüpften Projektelemente".
  // Seit Runde 6 auch im Angebot (Migration 0174). Ist das Angebot schon
  // beauftragt, haengt die Kalkulation am Projekt — dann gleicht der Server
  // das Projekt ab, und so heisst es auch hier.
  const syncTarget: 'project' | 'offer' = calcMaster?.PROJECT_ID != null || !isOfferMode ? 'project' : 'offer'
  const linkedCount = !calcMaster ? 0 : syncTarget === 'offer'
    ? offerStructureNodes.filter(n => n.FEE_CALC_MASTER_ID === calcMaster.ID).length
    : structureNodes.filter(n => n.FEE_CALC_MASTER_ID === calcMaster.ID).length
  const willSync = isEdit && linkedCount > 0 && syncStructure
  const elementNoun = syncTarget === 'offer' ? 'Angebotselement' : 'Projektelement'

  async function finishEdit() {
    if (!calcMaster) { onDone?.(); return }
    if (!willSync) {
      void qc.invalidateQueries({ queryKey: ['fee-calc-masters'] })
      toast.success('Kalkulation gespeichert')
      onDone?.()
      return
    }
    await run(async () => {
      const res = await syncFeeCalcToStructure(calcMaster.ID)
      if (res.projectId) void qc.invalidateQueries({ queryKey: ['structure', res.projectId] })
      if (res.offerId) {
        for (const key of [['offer-structure', res.offerId], ['offer', res.offerId], ['offers'], ['fee-calc-masters-offer', res.offerId]]) {
          void qc.invalidateQueries({ queryKey: key })
        }
      }
      void qc.invalidateQueries({ queryKey: ['fee-calc-masters'] })
      toast.success(res.message || 'Struktur aktualisiert')
      onDone?.()
    })
  }

  function resetWizard() {
    committedRef.current = true   // regulär abgeschlossen → Kalkulation behalten
    setStep(firstStep); setCalcMaster(null); setPhases([]); setBlItems([]); setSurcharges([])
    setFeeGroupId(''); setFeeMasterId(''); setMasters([])
    setBasis({ ABBR: '', NAME: '', PROJECT_ID: '', ZONE_ID: '', ZONE_PERCENT: '', K0: '', K1: '', K2: '', K3: '', K4: '' })
    setFatherId(''); setMsg(null)
    onDone?.()
  }

  async function cancelAndDelete() {
    committedRef.current = true   // wir löschen hier selbst → Unmount-Cleanup überspringen
    if (!isEdit && calcMaster) {
      try { await deleteFeeCalcMaster(calcMaster.ID) } catch { /* ignore */ }
    }
    setStep(firstStep); setCalcMaster(null); setPhases([]); setBlItems([]); setSurcharges([])
    setFeeGroupId(''); setFeeMasterId(''); setMasters([])
    setMsg(null)
    onDone?.()
  }

  // Abbrechen fragt wie das Schliessen des Fensters: eine angefangene neue
  // Kalkulation wird verworfen, geaenderte Werte beim Bearbeiten bleiben liegen.
  function handleCancel() {
    guarded(isEdit ? () => onDone?.() : () => { void cancelAndDelete() })
  }

  // ── Surcharge row helpers ────────────────────────────────────────────────────

  function addSurchargeFromGlobal(g: FeeSurchargeGlobal) {
    if (!calcMaster) return
    setSurcharges(prev => [
      ...prev,
      {
        FEE_CALC_MASTER_ID: calcMaster.ID, FEE_SURCHARGE_ID: g.ID,
        ABBR: g.ABBR, NAME: g.NAME ?? '',
        // Vorschlagswert aus dem Katalog übernehmen (z. B. 20 % Umbauzuschlag
        // nach § 6 Abs. 2 Satz 4, −50 % Wiederholungsminderung). Bleibt
        // änderbar; ohne Vorschlagswert wie bisher leer.
        PERCENT: g.DEFAULT_PERCENT ?? null,
        BASE_AMOUNT: totalPhaseRev + blTotal, AMOUNT: null,
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

  const stepLabels = isEdit ? EDIT_STEPS : CREATE_STEPS
  const stepHelp   = isEdit ? EDIT_HELP : CREATE_HELP
  const stepIdx    = step - firstStep
  const total      = totalPhaseRev + blTotal + totalSurchargeAmt

  function primaryAction(): { label: string; run: () => void; icon: typeof Check; disabled?: boolean } {
    if (step === 1) return { label: loading ? 'Legt an …' : 'Weiter', run: () => void goNext1(), icon: ChevronRight, disabled: !feeMasterId }
    if (step < 6)   return { label: loading ? 'Speichert …' : 'Weiter', run: () => void nextFromStep(), icon: ChevronRight }
    if (isEdit)     return { label: willSync ? (syncTarget === 'offer' ? 'Angebot aktualisieren' : 'Struktur aktualisieren') : 'Fertig', run: () => void finishEdit(), icon: Check }
    if (isOfferMode) return { label: loading ? 'Übernimmt …' : 'Ins Angebot übernehmen', run: () => void finishOffer(), icon: Check }
    return { label: loading ? 'Übernimmt …' : 'In die Struktur übernehmen', run: () => void finish(), icon: Check, disabled: !fatherId }
  }
  const primary = primaryAction()
  const PrimaryIcon = primary.icon
  const statusText = step >= 2
    ? [isEdit && stepDirty ? 'Nicht gespeichert' : null, phases.length > 0 ? `Gesamthonorar ${fmtEur(total)}` : null].filter(Boolean).join(' · ')
    : ''

  // Feste Leiste wie bei den Rechnungsassistenten: links Abbrechen, rechts
  // Übersicht, Zurück und die Hauptaktion. Im Dialog steht sie am unteren
  // Rand des Dialogs (globals.css, „ActionBar im Dialog").
  const actionBar = (
    <ActionBar
      status={statusText || undefined}
      dirty={isEdit && stepDirty}
      secondary={narrow && calcMaster && step >= 2 ? (
        <RowMenu label="Weitere Aktionen" triggerClassName="btn-secondary iw-more">
          <button type="button" role="menuitem" className="row-menu-item" onClick={openPdf}>Übersicht (PDF)</button>
          <button type="button" role="menuitem" className="row-menu-item" onClick={handleCancel}>Abbrechen</button>
        </RowMenu>
      ) : (
        <button type="button" className="btn-secondary" onClick={handleCancel} disabled={loading}>Abbrechen</button>
      )}
    >
      {!narrow && calcMaster && step >= 2 && (
        <button type="button" className="btn-secondary" onClick={openPdf} disabled={loading}>
          <FileText size={15} strokeWidth={1.75} aria-hidden="true" /> Übersicht (PDF)
        </button>
      )}
      {step > firstStep && (
        <button type="button" className="btn-secondary" onClick={() => goToStep(step - 1)} disabled={loading}>
          <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" /> Zurück
        </button>
      )}
      <button type="button" className="btn-primary" onClick={primary.run} disabled={loading || primary.disabled}>
        {primary.label} <PrimaryIcon size={15} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </ActionBar>
  )

  return (
    <div className="wizard-wrap hw-root">
      <StepIndicator steps={stepLabels} current={stepIdx} onStepClick={i => goToStep(i + firstStep)} compactOnMobile />
      <h3 className="wizard-step-title iw-step-title">
        {stepLabels[stepIdx]} <HelpHint id={stepHelp[stepIdx]} />
      </h3>

      {/* ── Step 1: Honorarordnung (create only) ─────────────────────────────── */}
      {step === 1 && (
        <div className="wizard-step-content">
          {!isOfferMode && (
            <div className="form-group">
              <label htmlFor="hw-project">Projekt*</label>
              <select id="hw-project" value={projectId} onChange={e => { setProjectId(e.target.value); setBasis(b => ({ ...b, PROJECT_ID: e.target.value })) }}>
                <option value="">Bitte wählen …</option>
                {projects.map(p => <option key={p.ID} value={p.ID}>{p.ABBR} – {p.NAME}</option>)}
              </select>
            </div>
          )}
          {isOfferMode && (
            <div className="form-group">
              <label htmlFor="hw-offer">Angebot</label>
              <input id="hw-offer" readOnly value={offerLabel} className="iw-readonly" />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="hw-group">Honorarordnung</label>
            <select id="hw-group" value={feeGroupId} onChange={e => void loadMasters(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {groups.map(g => <option key={g.ID} value={g.ID}>{g.ABBR}{g.NAME ? ' – ' + g.NAME : ''}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="hw-master">Leistungsbild</label>
            <select id="hw-master" value={feeMasterId} onChange={e => setFeeMasterId(e.target.value)} disabled={!feeGroupId}>
              <option value="">{feeGroupId ? 'Bitte wählen …' : 'Erst Honorarordnung wählen …'}</option>
              {masters.map(m => <option key={m.ID} value={m.ID}>{m.ABBR}{m.NAME ? ' – ' + m.NAME : ''}</option>)}
            </select>
          </div>

          {/* Zuletzt verwendete Leistungsbilder — setzt Honorarordnung und
              Leistungsbild in einem Schritt. fee_group_id kommt aus META. */}
          <RecentList
            type="fee_master"
            title="Zuletzt verwendete Leistungsbilder"
            limit={6}
            onSelect={entry => { void selectRecentFeeMaster(entry) }}
          />
        </div>
      )}

      {/* ── Step 2: Basisdaten ────────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="wizard-step-content">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="hw-abbr">Paragraph</label>
              <input id="hw-abbr" value={basis.ABBR} onChange={e => setBasis(b => ({ ...b, ABBR: e.target.value }))} />
            </div>
            <div className="form-group">
              <label htmlFor="hw-name">Bezeichnung</label>
              <input id="hw-name" value={basis.NAME} onChange={e => setBasis(b => ({ ...b, NAME: e.target.value }))} />
            </div>
          </div>
          {isOfferMode ? (
            <div className="form-group">
              <label htmlFor="hw-basis-offer">Angebot</label>
              <input id="hw-basis-offer" readOnly value={offerLabel} className="iw-readonly" />
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="hw-basis-project">Projekt</label>
              <select id="hw-basis-project" value={basis.PROJECT_ID} onChange={e => { setBasis(b => ({ ...b, PROJECT_ID: e.target.value })); setProjectId(e.target.value) }}>
                <option value="">—</option>
                {projects.map(p => <option key={p.ID} value={p.ID}>{p.ABBR} – {p.NAME}</option>)}
              </select>
            </div>
          )}
          {!isZoneless && (
            <div className="form-group">
              <label htmlFor="hw-zone" style={{ display: 'inline-flex', alignItems: 'center' }}>
                Honorarzone <HelpHint id="hoai.zone" />
              </label>
              <select id="hw-zone" value={basis.ZONE_ID} onChange={e => setBasis(b => ({ ...b, ZONE_ID: e.target.value }))}>
                <option value="">—</option>
                {zones.map(z => <option key={z.ID} value={z.ID}>{z.ABBR}{z.NAME ? ' – ' + z.NAME : ''}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn-small" onClick={() => setPunkteOpen(true)}>
                  Zone über Bewertungsmerkmale ermitteln …
                </button>
                <button type="button" className="btn-small" onClick={() => setObjektlisteOpen(true)}>
                  Zone anhand Objektliste bestimmen …
                </button>
              </div>
            </div>
          )}
          <div className="form-group">
            <label htmlFor="hw-zone-pct">{isPercentOfBaukosten ? 'Honorarsatz %' : isFlaechenaequivalent ? 'Faktor f (Jahr der Beauftragung)' : 'Zonenanteil %'}</label>
            <input
              id="hw-zone-pct"
              type="number" step="0.01"
              {...(isPercentOfBaukosten || isFlaechenaequivalent ? {} : { min: 0, max: 100 })}
              value={basis.ZONE_PERCENT}
              onChange={e => setBasis(b => ({ ...b, ZONE_PERCENT: e.target.value }))}
            />
            {!isPercentOfBaukosten && !isFlaechenaequivalent && (
              <p className="admin-section-hint">
                0–100 % beschreibt die Lage zwischen Mindest- und Höchstsatz der Honorartafel.
                0 % = Mindestsatz, 100 % = Höchstsatz.
              </p>
            )}
            {isPercentOfBaukosten && (
              <p className="admin-section-hint">
                Frei vereinbarter Prozentsatz der Bemessungsgrundlage (kein gesetzliches Zonenband) —
                Grundhonorar = Kx × Honorarsatz.
              </p>
            )}
            {isFlaechenaequivalent && (
              <p className="admin-section-hint">
                Honorar H = 2.600 € + f × Aq<sup>0,61</sup> (AHO Heft 17, Nr. 1.5). Faktor f nach Jahr der
                Beauftragung: 2022=170 · 2023=173 · 2024=177 · 2025=180 · 2026=184 · 2027=188 · 2028=191.
              </p>
            )}
          </div>
          <p className="admin-block-title" style={{ marginTop: 12 }}>{baseLabel}</p>
          {isSingleValue ? (
            <div className="form-group">
              <label htmlFor="hw-k0">{isVerrechnungseinheiten ? 'Verrechnungseinheiten' : isFlaechenaequivalent ? 'Flächenäquivalent Aq' : 'Plangebiet'}</label>
              <input
                id="hw-k0"
                type="number" step="0.01" min={0}
                value={basis.K0}
                onChange={e => setBasis(b => ({ ...b, K0: e.target.value, K1: '', K2: '', K3: '', K4: '' }))}
                placeholder={isVerrechnungseinheiten ? 'Anzahl der Verrechnungseinheiten (VE)' : isFlaechenaequivalent ? 'Flächenäquivalent Aq in m²' : 'Größe des Plangebiets in ha'}
              />
              <p className="admin-section-hint">
                {isVerrechnungseinheiten
                  ? 'Die Verrechnungseinheiten ergeben sich aus der Fläche (ha) multipliziert mit dem Faktor der Punktdichte-Flächenklasse (Anlage 1.4.2 Abs. 3 HOAI, 40–800 VE/ha) und werden hier als Summe eingetragen.'
                  : isFlaechenaequivalent
                  ? 'Aq = Σ (Ai × ni × si) — je Kalkulationseinheit die Bruttogrundfläche Ai multipliziert mit Nutzungsbeiwert ni und Schwierigkeitsbeiwert si (AHO Heft 17, Nr. 1.2), summiert und hier eingetragen.'
                  : 'Bei Flächenplanung wird das Honorar aus der Plangebietsgröße in Hektar interpoliert (HOAI 2021 §17 ff.).'}
              </p>
            </div>
          ) : (
            <>
              <div className="fee-k-grid">
                {(['K0','K1','K2','K3','K4'] as const).map(k => (
                  <div key={k} className="form-group">
                    <label htmlFor={`hw-${k.toLowerCase()}`}>{k}</label>
                    <input id={`hw-${k.toLowerCase()}`} type="number" step="0.01" value={(basis as Record<string, string>)[k]} onChange={e => setBasis(b => ({ ...b, [k]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn-small" onClick={() => setDin276Open(true)}>
                  Baukosten aus DIN 276 ermitteln …
                </button>
                <span className="admin-section-hint" style={{ margin: 0 }}>
                  Berechnet die anrechenbaren Kosten nach HOAI (Leistungsbild wählbar) und übernimmt sie nach K0.
                </span>
              </div>
              {calcMaster && supportsZoneSplit && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn-small" onClick={() => setMischOpen(true)} disabled={zones.length === 0}>
                    Mischhonorar …
                  </button>
                  <span className="admin-section-hint" style={{ margin: 0 }}>
                    Gehören die Anlagen einer Anlagengruppe verschiedenen Honorarzonen an, lassen sich die
                    anrechenbaren Kosten hier aufteilen. K0 wird dann daraus berechnet.
                  </span>
                </div>
              )}
              {calcMaster && supportsZoneSplit && (
                <MischhonorarEditor
                  open={mischOpen}
                  onClose={() => setMischOpen(false)}
                  calcMasterId={calcMaster.ID}
                  zones={zones}
                  onApplied={() => { void (async () => {
                    try { const r = await fetchFeeCalcMaster(calcMaster.ID); populateBasis(r.data) } catch { /* ignore */ }
                  })() }}
                />
              )}
              <Din276Editor
                open={din276Open}
                onClose={() => setDin276Open(false)}
                projectId={!isOfferMode && projectId ? Number(projectId) : undefined}
                offerId={isOfferMode && offerId ? offerId : undefined}
                leistungsbild="gebaeude"
                onApply={(anrechenbar, estimateId, lb) => {
                  setBasis(b => ({ ...b, K0: String(anrechenbar) }))
                  setDin276EstimateId(estimateId)
                  setDin276Leistungsbild(lb)
                }}
              />
            </>
          )}
          <ObjektlisteZonePicker
            open={objektlisteOpen}
            onClose={() => setObjektlisteOpen(false)}
            feeMasterId={activeFeeMasterId}
            zones={zones}
            onApply={(zoneId) => setBasis(b => ({ ...b, ZONE_ID: String(zoneId) }))}
          />
          <ZonenPunkteRechner
            open={punkteOpen}
            onClose={() => setPunkteOpen(false)}
            feeMasterId={activeFeeMasterId}
            zones={zones}
            onApply={(zoneId) => setBasis(b => ({ ...b, ZONE_ID: String(zoneId) }))}
          />
        </div>
      )}

      {/* ── Step 3: Leistungsphasen ────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="wizard-step-content">
          {narrow ? (
            <KalkList
              label="Leistungsphasen"
              items={phases.map(p => ({
                key: p.ID, title: p.PHASE_LABEL,
                sub: `${p.KX || 'K0'} · ${p.FEE_PERCENT != null ? `${fmtPct(p.FEE_PERCENT)} %` : 'kein Anteil'}`,
                value: fmtEur(p.PHASE_REVENUE ?? 0),
              }))}
              onOpen={i => setSheet({ kind: 'lph', id: phases[i].ID })}
              total={[{ label: `Grundhonorar · ${fmtPct(totalPhasePct)} %`, value: fmtEur(totalPhaseRev) }]}
            />
          ) : (
          <div className="table-scroll">
            <table className="master-table">
              <thead>
                <tr>
                  <th scope="col">Phase</th>
                  <th scope="col">Kx</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Basis €</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Basis %</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Basis-Honorar €</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Honorar %</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Honorar €</th>
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
                        <select className="tbl-select" aria-label={`Kx ${p.PHASE_LABEL}`} value={p.KX || 'K0'} onChange={e => updatePhaseKx(p.ID, e.target.value)} disabled={isSingleValue}>
                          {kxOptionsForBase.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-3)', fontSize: 12 }}>
                        {p.REVENUE_BASE != null ? fmtEur(p.REVENUE_BASE) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-3)', fontSize: 12 }}>
                        {fmtN(p.FEE_PERCENT_BASE) || '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-3)', fontSize: 12 }}>
                        {basisHonorar != null ? fmtEur(basisHonorar) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input className="tbl-input" type="number" step="0.01" style={{ width: 80 }} aria-label={`Honorar % ${p.PHASE_LABEL}`}
                          value={fmtN(p.FEE_PERCENT)} onChange={e => updatePhasePct(p.ID, e.target.value)} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input className="tbl-input" readOnly tabIndex={-1} aria-label={`Honorar € ${p.PHASE_LABEL}`} style={{ width: 90, textAlign: 'right' }} value={fmtMoney2(p.PHASE_REVENUE)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="col" colSpan={5}>Grundhonorar</th>
                  <th scope="col" style={{ textAlign: 'right' }}>{fmtPct(totalPhasePct)}</th>
                  <th scope="col" style={{ textAlign: 'right' }}>{fmtMoney2(totalPhaseRev)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
          )}
        </div>
      )}

      {/* ── Step 4: Besondere Leistungen ─────────────────────────────────────── */}
      {step === 4 && (
        <div className="wizard-step-content">
          <p className="hw-lead">
            Zusatzleistungen über die Grundleistungen hinaus (§ 3 Abs. 3 HOAI). Sie stehen einzeln im Gesamthonorar
            und werden eigene Elemente der Struktur.
          </p>
          {narrow && (
            <KalkList
              label="Besondere Leistungen"
              items={blItems.map((b, i) => ({
                key: b.ID ?? `neu-${i}`, title: b.ABBR ? `${b.ABBR} · ${b.NAME}` : (b.NAME || `Besondere Leistung ${i + 1}`),
                sub: blScope(b, phases), value: money(blComputedAmounts[i] ?? 0),
              }))}
              onOpen={i => setSheet({ kind: 'bl', idx: i })}
              total={[{ label: 'Summe Besondere Leistungen', value: money(blTotal) }]}
            />
          )}
          {!narrow && blItems.length > 0 && (
            <div className="table-scroll" style={{ marginBottom: 8 }}>
              <table className="master-table">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 80 }}>Kürzel</th>
                    <th scope="col" style={{ width: '22%' }}>Bezeichnung</th>
                    <th scope="col" style={{ width: 120 }}>LPH-Bezug</th>
                    <th scope="col" style={{ width: 160 }}>Berechnungsart</th>
                    <th scope="col" style={{ width: 70, textAlign: 'right' }}>%</th>
                    <th scope="col" style={{ width: 80 }}>Kx</th>
                    <th scope="col" style={{ width: 110, textAlign: 'right' }}>Betrag €</th>
                    <th scope="col" style={{ width: 30 }}></th>
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
                          <input className="tbl-input" style={{ width: '100%' }} placeholder="Kürzel" aria-label={`Kürzel Besondere Leistung ${idx + 1}`}
                            value={b.ABBR ?? ''}
                            onChange={e => updateBl({ ABBR: e.target.value || null })} />
                        </td>
                        <td>
                          <input className="tbl-input" style={{ width: '100%' }} placeholder="Bezeichnung" aria-label={`Bezeichnung Besondere Leistung ${idx + 1}`}
                            value={b.NAME}
                            onChange={e => updateBl({ NAME: e.target.value })} />
                        </td>
                        <td>
                          <select className="tbl-select" style={{ width: '100%' }} aria-label={`LPH-Bezug Besondere Leistung ${idx + 1}`}
                            value={b.LPH_PHASE_ID != null ? String(b.LPH_PHASE_ID) : ''}
                            onChange={e => updateBl({ LPH_PHASE_ID: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">— keine —</option>
                            {phases.map(p => (
                              <option key={p.ID} value={String(p.ID)}>{p.PHASE_LABEL}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select className="tbl-select" style={{ width: '100%' }} aria-label={`Berechnungsart Besondere Leistung ${idx + 1}`}
                            value={b.AMOUNT_TYPE || 'fixed'}
                            onChange={e => updateBl({ AMOUNT_TYPE: e.target.value as BlAmountType, PERCENT: null, KX_REF: null })}>
                            {(Object.entries(BL_AMOUNT_TYPE_LABELS) as [BlAmountType, string][])
                              .filter(([k]) => k !== 'pct_gesamthonorar')
                              .filter(([k]) => !(isSingleValue && k === 'pct_baukosten'))
                              .map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                          </select>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {!isFixed && (
                            <input className="tbl-input" type="number" step="0.01" style={{ width: 70, textAlign: 'right' }} aria-label={`Prozent Besondere Leistung ${idx + 1}`}
                              value={b.PERCENT != null ? String(b.PERCENT) : ''}
                              onChange={e => updateBl({ PERCENT: toNum(e.target.value) })} />
                          )}
                        </td>
                        <td>
                          {needsKx && (
                            <select className="tbl-select" style={{ width: '100%' }} aria-label={`Kx Besondere Leistung ${idx + 1}`}
                              value={b.KX_REF || ''}
                              onChange={e => updateBl({ KX_REF: e.target.value || null })}>
                              <option value="">— Kx —</option>
                              {kxOptionsForBase.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isFixed ? (
                            <input className="tbl-input" type="number" step="0.01" style={{ width: 110, textAlign: 'right' }} aria-label={`Betrag Besondere Leistung ${idx + 1}`}
                              value={b.AMOUNT !== 0 ? String(b.AMOUNT) : ''}
                              onChange={e => updateBl({ AMOUNT: toNum(e.target.value) ?? 0 })} />
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>
                              {money(computed)}
                            </span>
                          )}
                        </td>
                        <td>
                          <button type="button" className="row-action-btn row-action-btn--danger"
                            aria-label={`Besondere Leistung ${idx + 1} entfernen`} title="Entfernen"
                            onClick={() => setBlItems(prev => prev.filter((_, i) => i !== idx))}>
                            <X size={12} strokeWidth={2.5} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="col" colSpan={6}>Summe Besondere Leistungen</th>
                    <th scope="col" style={{ textAlign: 'right' }}>{money(blTotal)}</th>
                    <th scope="col"></th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <button type="button" className="btn-small hw-add" onClick={() => {
            if (!calcMaster) return
            if (narrow) { setSheet({ kind: 'bl', idx: null }); return }
            setBlItems(prev => [...prev, {
              FEE_CALC_MASTER_ID: calcMaster.ID,
              ABBR: null, NAME: '', LPH_REF: null, LPH_PHASE_ID: null,
              AMOUNT_TYPE: 'fixed', PERCENT: null, KX_REF: null,
              AMOUNT: 0, SORT_ORDER: prev.length,
            }])
          }}><Plus size={14} strokeWidth={2.25} aria-hidden="true" /> Besondere Leistung hinzufügen</button>
          {blItems.length === 0 && (
            <p className="empty-note" style={{ marginTop: 8 }}>Noch keine Besondere Leistung. Ist keine vereinbart, einfach „Weiter".</p>
          )}
        </div>
      )}

      {/* ── Step 5: Zuschläge & Nachlässe ────────────────────────────────────── */}
      {step === 5 && (
        <div className="wizard-step-content">

          <div className="admin-block" style={{ marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Grundhonorar: </span>
              <strong>{money(totalPhaseRev)}</strong>
            </div>
            {blTotal !== 0 && (
              <div>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>+ BL: </span>
                <strong>{money(blTotal)}</strong>
              </div>
            )}
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>+ Zuschläge: </span>
              <strong>{money(totalSurchargeAmt)}</strong>
            </div>
            <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 16 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Gesamt: </span>
              <strong style={{ fontSize: 15 }}>{money(totalPhaseRev + blTotal + totalSurchargeAmt)}</strong>
            </div>
          </div>

          {/* Global suggestions */}
          {globalSurcharges.length > 0 && (
            <div className="hw-suggest" role="group" aria-label="Vorschläge aus dem Leistungsbild">
              <span className="hw-suggest-label">Vorschläge:</span>
              {globalSurcharges.filter(g => !alreadyAdded.has(g.ID)).map(g => {
                const grenze = g.MAX_PERCENT != null ? `, max. ${g.MAX_PERCENT} %` : ''
                const titel = [g.NAME, g.LEGAL_REF ? `${g.LEGAL_REF}${grenze}` : null]
                  .filter(Boolean).join('\n\n')
                return (
                  <button key={g.ID} type="button" className="btn-small hw-add"
                    onClick={() => addSurchargeFromGlobal(g)} title={titel || undefined}>
                    <Plus size={13} strokeWidth={2.25} aria-hidden="true" /> {g.ABBR}
                    {g.DEFAULT_PERCENT != null && (
                      <span style={{ color: 'var(--text-3)' }}> ({g.DEFAULT_PERCENT} %)</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {narrow && (
            <KalkList
              label="Zuschläge und Nachlässe"
              items={surcharges.map((r, i) => ({
                key: r.ID ?? `neu-${i}`, title: r.ABBR || `Zuschlag ${i + 1}`,
                sub: `${r.PERCENT != null ? `${fmtPct(r.PERCENT)} %` : 'ohne Prozent'} · ${surchargeScope(r, phases)}`,
                value: <SurchargeAmount value={surchargeEffects[i]?.amount ?? 0} />,
              }))}
              onOpen={i => setSheet({ kind: 'sur', idx: i })}
              total={[
                { label: 'Summe Zuschläge / Nachlässe', value: <SurchargeAmount value={totalSurchargeAmt} /> },
                { label: 'Gesamthonorar', value: money(totalPhaseRev + blTotal + totalSurchargeAmt) },
              ]}
            />
          )}
          {/* Surcharge table */}
          {!narrow && surcharges.length > 0 && (
            <div className="table-scroll" style={{ marginBottom: 8 }}>
              <table className="master-table">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: '25%' }}>Kurzbezeichnung</th>
                    <th scope="col" style={{ width: '25%' }}>Langbezeichnung</th>
                    <th scope="col" style={{ width: 80 }}>% (neg. = Nachlass)</th>
                    <th scope="col" style={{ width: 100 }}>Berechnungsbasis €</th>
                    <th scope="col" style={{ width: 100 }}>Betrag €</th>
                    <th scope="col" style={{ width: 60 }}>LPH / Modus</th>
                    <th scope="col" style={{ width: 30 }}></th>
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
                      <Fragment key={idx}>
                        <tr>
                          <td>
                            <input className="tbl-input" style={{ width: '100%' }} aria-label={`Kurzbezeichnung Zuschlag ${idx + 1}`} value={r.ABBR ?? ''}
                              onChange={e => updateSurcharge(idx, 'ABBR', e.target.value)} />
                          </td>
                          <td>
                            <input className="tbl-input" style={{ width: '100%' }} aria-label={`Langbezeichnung Zuschlag ${idx + 1}`} value={r.NAME ?? ''}
                              onChange={e => updateSurcharge(idx, 'NAME', e.target.value)} />
                          </td>
                          <td>
                            <input className="tbl-input" type="number" step="0.01" style={{ width: 80 }} aria-label={`Prozent Zuschlag ${idx + 1}`}
                              value={r.PERCENT != null ? String(r.PERCENT) : ''}
                              onChange={e => updateSurcharge(idx, 'PERCENT', toNum(e.target.value))} />
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-3)' }}>
                            {money(effect?.effectiveBase)}
                          </td>
                          {/* Farbig wie in den Strukturen: Zuschlag gruen, Nachlass rot */}
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            <SurchargeAmount value={effect?.amount ?? 0} />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button type="button" className="btn-small hw-details" aria-expanded={isExpanded}
                              title="Leistungsphasen, Besondere Leistungen und Modus"
                              onClick={() => setExpandedSurchargeIdx(isExpanded ? null : idx)}>
                              Details <ChevronDown size={13} strokeWidth={2} aria-hidden="true" className="hw-details-chev" />
                            </button>
                          </td>
                          <td>
                            <button type="button" className="row-action-btn row-action-btn--danger" title="Entfernen"
                              aria-label={`Zuschlag ${idx + 1} entfernen`}
                              onClick={() => removeSurcharge(idx)}>
                              <X size={12} strokeWidth={2.5} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--info-bg)', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                              <div className="hw-mode-row">
                                <strong style={{ fontSize: 12, color: 'var(--text-2)' }}>Berechnungsmodus:</strong>
                                <div className="seg-toggle" role="group" aria-label={`Berechnungsmodus Zuschlag ${idx + 1}`}>
                                  <button type="button" aria-pressed={(r.CALC_MODE ?? 'parallel') === 'parallel'}
                                    onClick={() => updateSurcharge(idx, 'CALC_MODE', 'parallel')}>Parallel</button>
                                  <button type="button" aria-pressed={r.CALC_MODE === 'cumulative'}
                                    onClick={() => updateSurcharge(idx, 'CALC_MODE', 'cumulative')}>Kumulativ</button>
                                </div>
                                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                                  {r.CALC_MODE === 'cumulative' && idx > 0
                                    ? 'Zuschlag auf Honorarbasis + Summe aller vorherigen Zuschläge'
                                    : 'Zuschlag auf Honorarbasis'}
                                </span>
                              </div>
                              {r.CALC_MODE === 'cumulative' && idx > 0 && r.LPH_FILTER && (
                                <p className="admin-section-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                                  Dieser Zuschlag gilt nur für ausgewählte Leistungsphasen, stockt aber auf die
                                  <strong> volle</strong> Summe der vorherigen Zuschläge auf — auch auf deren Anteil
                                  für Leistungsphasen, die hier nicht ausgewählt sind.
                                </p>
                              )}
                              {blItems.length > 0 && (
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <strong style={{ fontSize: 12, color: 'var(--text-2)' }}>Betroffene Besondere Leistungen:</strong>
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
                                          {b.ABBR ? `${b.ABBR} — ${b.NAME || ''}` : (b.NAME || `BL ${b.SORT_ORDER + 1}`)}
                                        </label>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                              <div>
                                <strong style={{ fontSize: 12, color: 'var(--text-2)' }}>Betroffene Leistungsphasen:</strong>
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
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="col" colSpan={4}>Summe Zuschläge / Nachlässe</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      <SurchargeAmount value={totalSurchargeAmt} />
                    </th>
                    <th scope="col" colSpan={2}></th>
                  </tr>
                  <tr>
                    <th scope="col" colSpan={4}>Gesamthonorar</th>
                    <th scope="col" style={{ textAlign: 'right', fontSize: 14 }}>{money(totalPhaseRev + blTotal + totalSurchargeAmt)}</th>
                    <th scope="col" colSpan={2}></th>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <button type="button" className="btn-small hw-add" onClick={() => narrow ? setSheet({ kind: 'sur', idx: null }) : addCustomSurcharge()}>
            <Plus size={14} strokeWidth={2.25} aria-hidden="true" /> Zuschlag / Nachlass hinzufügen
          </button>
        </div>
      )}

      {/* ── Step 6: Zusammenfassung (both create + edit) ─────────────────────── */}
      {step === 6 && (
        <div className="wizard-step-content">
          <p className="hw-lead">
            {calcMaster?.ABBR}{calcMaster?.NAME ? ' – ' + calcMaster.NAME : ''}
            {isEdit
              ? ' · die gespeicherten Werte:'
              : isOfferMode
                ? ' · diese Elemente entstehen im Angebot, je Leistungsphase und Besondere Leistung eines:'
                : ' · diese Elemente entstehen in der Projektstruktur, je Leistungsphase und Besondere Leistung eines:'}
          </p>

          {/* Overview table: LPH + BL rows */}
          <div className="table-scroll" style={{ marginBottom: 12 }}>
            <table className="master-table">
              <thead>
                <tr>
                  <th scope="col">Bezeichnung</th>
                  <th scope="col" style={{ width: 120, color: 'var(--text-3)', fontWeight: 400 }}>Typ</th>
                  <th scope="col" style={{ width: 140, textAlign: 'right' }}>Honorar (netto) €</th>
                </tr>
              </thead>
              <tbody>
                {/* LPH phase rows */}
                {phases.filter(p => (p.PHASE_REVENUE ?? 0) !== 0).map(p => (
                  <tr key={p.ID}>
                    <td style={{ fontSize: 13 }}>{p.PHASE_LABEL}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-3)' }}>Grundleistung</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{money(p.PHASE_REVENUE)}</td>
                  </tr>
                ))}
                {/* Grundhonorar summary */}
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface-3)' }}>
                  <td colSpan={2} style={{ fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>Grundhonorar</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>{money(totalPhaseRev)}</td>
                </tr>
                {/* BL rows */}
                {blTotal !== 0 && blItems.map((b, i) => blComputedAmounts[i] !== 0 && (
                  <tr key={`bl-${i}`}>
                    <td style={{ fontSize: 13 }}>{[b.ABBR, b.NAME].filter(Boolean).join(': ') || `BL ${i + 1}`}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-3)' }}>Besondere Leistung</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{money(blComputedAmounts[i])}</td>
                  </tr>
                ))}
                {/* BL sum */}
                {blTotal !== 0 && (
                  <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-3)' }}>
                    <td colSpan={2} style={{ fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>+ Besondere Leistungen</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>{money(blTotal)}</td>
                  </tr>
                )}
                {/* Individual Zuschlag rows */}
                {surcharges.map((r, idx) => {
                  const eff = surchargeEffects[idx]
                  if (!eff || eff.amount === 0) return null
                  const label = [r.ABBR, r.NAME].filter(Boolean).join(': ') || `Zuschlag ${idx + 1}`
                  return (
                    <tr key={`s-${idx}`}>
                      <td style={{ fontSize: 13 }}>{label}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {(r.PERCENT ?? 0) >= 0 ? 'Zuschlag' : 'Nachlass'} {r.PERCENT ?? 0}&nbsp;%
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{money(eff.amount)}</td>
                    </tr>
                  )
                })}
                {/* Zuschläge sum */}
                {totalSurchargeAmt !== 0 && (
                  <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-3)' }}>
                    <td colSpan={2} style={{ fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>+ Zuschläge / Nachlässe</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, padding: '6px 8px' }}>{money(totalSurchargeAmt)}</td>
                  </tr>
                )}
                {/* Gesamthonorar */}
                <tr style={{ borderTop: '2px solid var(--text-4)' }}>
                  <td colSpan={2} style={{ fontWeight: 700, fontSize: 15, padding: '8px 8px' }}>Gesamthonorar</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 15, padding: '8px 8px' }}>{money(totalPhaseRev + blTotal + totalSurchargeAmt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* Bearbeiten: Struktur bzw. Angebot mitziehen? */}
          {isEdit && linkedCount > 0 && (
            <label className="hw-check">
              <input type="checkbox" checked={syncStructure} onChange={e => setSyncStructure(e.target.checked)} />
              <span>
                {linkedCount === 1 ? `Das verknüpfte ${elementNoun}` : `Die ${linkedCount} verknüpften ${elementNoun}e`} mit den neuen Werten überschreiben
                <span className="form-field-hint">
                  Honorar und Nebenkosten der Elemente aus dieser Kalkulation werden neu gesetzt, Zuschläge anteilig verteilt;
                  eigene Zuschläge der Elemente bleiben. Neue Besondere Leistungen bekommen ein Element dazu.
                  Ohne Haken bleibt {syncTarget === 'offer' ? 'das Angebot, wie es' : 'die Struktur, wie sie'} ist.
                </span>
              </span>
            </label>
          )}
          {isEdit && linkedCount === 0 && (
            <p className="form-field-hint">
              {syncTarget === 'offer'
                ? 'Diese Kalkulation hat im Angebot keine verknüpften Elemente – ältere Übernahmen tragen die Verknüpfung nicht. Dort bei Bedarf von Hand anpassen; „Fertig" behält nur die Kalkulation.'
                : 'Diese Kalkulation ist mit keinem Projektelement verknüpft — „Fertig" behält nur die Kalkulation.'}
            </p>
          )}

          {/* Anlegen im Projekt: unter welchem Element? */}
          {!isEdit && !isOfferMode && (
            <div className="form-group">
              <label htmlFor="hw-father">Unter welchem Projektelement?*</label>
              <select id="hw-father" value={fatherId} onChange={e => setFatherId(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {inTreeOrder(structureNodes, n => n.STRUCTURE_ID, n => n.FATHER_ID).map(({ row: n, depth }) => (
                  <option key={n.STRUCTURE_ID} value={n.STRUCTURE_ID}>
                    {INDENT.repeat(depth)}{n.ABBR}{n.NAME ? ` – ${n.NAME}` : ''}
                  </option>
                ))}
              </select>
              {structureNodes.length === 0 && (
                <p className="form-field-hint">Das Projekt hat noch keine Struktur — erst ein Element anlegen, unter dem die Leistungsphasen stehen.</p>
              )}
            </div>
          )}

          {/* Anlegen im Angebot: unter welchem Element — oder eigenes oben */}
          {!isEdit && isOfferMode && (
            <div className="form-group">
              <label htmlFor="hw-father">Wohin im Angebot?</label>
              <select id="hw-father" value={fatherId} onChange={e => setFatherId(e.target.value)}>
                <option value="">Neues Element „{calcLabel}" auf oberster Ebene</option>
                {inTreeOrder(offerStructureNodes, n => n.ID, n => n.FATHER_ID).map(({ row: n, depth }) => (
                  <option key={n.ID} value={n.ID}>
                    {INDENT.repeat(depth)}unter {n.ABBR ? `${n.ABBR} – ` : ''}{n.NAME ?? `Position ${n.ID}`}
                  </option>
                ))}
              </select>
              <p className="form-field-hint">
                Die Elemente werden pauschal abgerechnet und gehen beim Beauftragen mit ins Projekt.
              </p>
            </div>
          )}
        </div>
      )}

      <Message text={msg?.text ?? null} type={msg?.type} />
      {actionBar}
      {confirmDialog}

      {/* Handy: Zeile als Blatt (Runde 8) */}
      {sheet?.kind === 'lph' && (() => {
        const ph = phases.find(x => x.ID === sheet.id)
        return ph ? (
          <PhaseSheet key={`lph-${ph.ID}`} phase={ph} calcMaster={calcMaster} kxOptions={kxOptionsForBase} singleValue={isSingleValue}
            onApply={(kx, pct) => { updatePhaseKx(ph.ID, kx); updatePhasePct(ph.ID, pct == null ? '' : String(pct)) }}
            onClose={() => setSheet(null)} />
        ) : null
      })()}
      {sheet?.kind === 'bl' && calcMaster && (() => {
        const idx = sheet.idx
        const item: FeeCalcBl = idx != null && blItems[idx] ? blItems[idx] : {
          FEE_CALC_MASTER_ID: calcMaster.ID, ABBR: null, NAME: '', LPH_REF: null, LPH_PHASE_ID: null,
          AMOUNT_TYPE: 'fixed', PERCENT: null, KX_REF: null, AMOUNT: 0, SORT_ORDER: blItems.length,
        }
        return (
          <BlSheet key={`bl-${idx ?? 'neu'}`} item={item} isNew={idx == null} phases={phases} calcMaster={calcMaster}
            kxOptions={kxOptionsForBase} singleValue={isSingleValue} grundhonorar={totalPhaseRev} surchargeNoBlTotal={surchargeNoBlTotal}
            onApply={b => setBlItems(prev => idx == null ? [...prev, b] : prev.map((x, i) => i === idx ? b : x))}
            onRemove={idx != null ? () => setBlItems(prev => prev.filter((_, i) => i !== idx)) : undefined}
            onClose={() => setSheet(null)} />
        )
      })()}
      {sheet?.kind === 'sur' && calcMaster && (() => {
        const idx = sheet.idx
        const row = idx != null && surcharges[idx] ? surcharges[idx] : newSurchargeRow(calcMaster.ID, surcharges.length)
        return (
          <SurchargeSheet key={`sur-${idx ?? 'neu'}`} row={row} index={idx ?? surcharges.length} isNew={idx == null}
            all={surcharges} phases={phases} blItems={blItems} blAmounts={blComputedAmounts}
            onApply={r => setSurcharges(prev => idx == null ? [...prev, r] : prev.map((x, i) => i === idx ? r : x))}
            onRemove={idx != null ? () => removeSurcharge(idx) : undefined}
            onClose={() => setSheet(null)} />
        )
      })()}
    </div>
  )
}
