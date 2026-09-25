import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Check, FileText, ChevronDown, AlertTriangle } from 'lucide-react'
import { StepIndicator } from '@/components/ui/StepIndicator'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
import { Modal }        from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { ActionBar }    from '@/components/ui/ActionBar'
import { RowMenu }      from '@/components/ui/RowMenu'
import { Disclosure }   from '@/components/ui/Disclosure'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { FormField }    from '@/components/ui/FormField'
import { AmountInput }  from '@/components/ui/AmountInput'
import { HelpHint }     from '@/components/ui/HelpHint'
import { ValidationModal } from '@/components/ui/ValidationModal'
import { AnlagenSection } from '@/components/rechnungen/AnlagenSection'
import {
  searchContracts,
  initInvoice, patchInvoice, getInvoice,
  getFinalInvoicePhases, saveFinalInvoicePhases,
  getFinalInvoiceDeductions, saveFinalInvoiceDeductions,
  bookFinalInvoice, bookFinalInvoiceForce, deleteInvoice,
  openInvoicePdf, downloadInvoiceEinvoice,
  fetchOpenSeForProject,
  VAT_CATEGORY_LABELS,
  type FinalPhase, type FinalDeduction, type FinalTotals,
  type OpenSeEntry, type VatCategory, type ValidationResult,
} from '@/api/rechnungen'
import { ApiRequestError } from '@/api/client'
import { fetchActiveEmployees, searchProjectsApi } from '@/api/projekte'
import { useAuthStore } from '@/store/authStore'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import { useDueDatePreset, useDefaultString } from '@/hooks/useTenantDefaults'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useRegisterDirty, useGuardedAction } from '@/hooks/useDirtyGuard'
import { fetchPaymentMeans } from '@/api/stammdaten'
import { fmtEur, money, NO_VALUE } from '@/utils/money'
import { localIsoDate } from '@/utils/zeit'
import { draftFormFromRow, abbrNameLabel } from './draftForm'
import { computeTotals, discountBody, r2 } from './invoiceTotals'
import { InvoiceSummary, type SummaryAmounts } from './InvoiceSummary'

const deDay = (v: string | null | undefined) => v ? v.slice(0, 10).split('-').reverse().join('.') : NO_VALUE
// Lokales Datum — das UTC-Datum ist zwischen 0 und 2 Uhr noch gestern.
function todayIso() { return localIsoDate() }

// Vorher: 'Init', 'Details', 'Positionen', 'Abzüge', 'Buchen'.
const STEPS = ['Projekt & Vertrag', 'Rechnungsdaten', 'Positionen', 'Abschläge abziehen', 'Prüfen & buchen']
const STEP_HELP = ['invoice.wizard.projekt_vertrag', 'invoice.wizard.rechnungsdaten', 'invoice.schluss.positionen', 'invoice.schluss.abzuege', 'invoice.schluss.pruefen'] as const

interface DraftResume { id: number; projectId: number | null; contractId: number | null; projectLabel: string; contractLabel: string; d1Pct: number; d2Pct: number; d1Reason: string | null; d2Reason: string | null; cashDiscPct: number; cashDiscDays: number }

/**
 * Teilschluss-/Schlussrechnung (UI-Pilot Runde 2) — im Muster des
 * Abschlag-Assistenten (`InvoiceWizard.tsx`), mit den zwei zusaetzlichen
 * Schritten Positionen und Abschlaege.
 *
 * Vorher: „Jetzt buchen ✓" ohne Recht und ohne Rueckfrage, PDF und XML fuer
 * jeden, das XML ohne die gerade eingetragenen Nachlaesse, „Speichern
 * (Entwurf)" ohne Fehlermeldung, Abbrechen loeschte einen neuen Entwurf nach
 * einer Rueckfrage, die nach „Wizard abbrechen" klang, und nach dem Buchen
 * stand ein leerer Assistent da. Die Summen standen dreimal im Code. Und die
 * Auswahl der aufzuloesenden Sicherheitseinbehalte ging nie an den Server,
 * bevor gebucht wurde — ein fortgesetzter Entwurf hatte wieder alle
 * vorgewaehlt (jetzt `SE_RELEASE_ADVANCE_IDS`, Migration 0171).
 */
export function SchlussrechnungWizard({ resumeId, initialDraft, initialProjectId, initialProjectLabel, onPrefillConsumed, onDraftCreated, onExit }: {
  /** Entwurf fortsetzen — geladen wird vom Server, auch nach Neuladen. */
  resumeId?: number
  /** Veraltet: Entwurf aus der Liste — es zaehlt nur die ID. */
  initialDraft?: DraftResume
  /** Neuer Entwurf angelegt — die Seite schreibt die ID in die URL. */
  onDraftCreated?: (id: number) => void
  initialProjectId?: number
  initialProjectLabel?: string
  onPrefillConsumed?: () => void
  /** Zurueck zur Rechnungsliste (nach Buchen oder Abbrechen). */
  onExit?: () => void
} = {}) {
  const qc     = useQueryClient()
  const toast  = useToast()
  const narrow = useIsNarrow()
  const canBook   = usePermission('invoices.book')
  const canPdf    = usePermission('invoices.download_pdf')
  const canXml    = usePermission('invoices.download_xml')
  const canDelete = usePermission('invoices.delete')
  const resumeTarget = resumeId ?? initialDraft?.id ?? null

  const [step,         setStep]         = useState(0)
  const [draftId,      setDraftId]      = useState<number | null>(null)
  const [msg,          setMsg]          = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [origin]                        = useState<'new' | 'resumed'>(resumeTarget ? 'resumed' : 'new')
  const [savedExplicitly, setSavedExplicitly] = useState(false)
  const [leaveOpen,    setLeaveOpen]    = useState(false)
  const [bookOpen,     setBookOpen]     = useState(false)
  const [loadingResume, setLoadingResume] = useState(!!resumeTarget)
  // Eingaben im aktuellen Schritt seit dem letzten Speichern (Rueckfrage beim Verlassen)
  const [touched,      setTouched]      = useState(false)
  const guarded = useGuardedAction()

  // Step 0
  const [projectId,           setProjectId]           = useState<number | null>(null)
  const [projectLabel,        setProjectLabel]        = useState('')
  const [companyId,           setCompanyId]           = useState<number | null>(null)
  const [contractId,          setContractId]          = useState<number | null>(null)
  const [contractLabel,       setContractLabel]       = useState('')
  const [contractsForProject, setContractsForProject] = useState<Array<{ ID: number; ABBR: string; NAME: string }>>([])
  const [employeeId,          setEmployeeId]          = useState(() => String(useAuthStore.getState().employeeId ?? ''))
  const [changeEmployee,      setChangeEmployee]      = useState(false)

  // Step 1
  const [detDate,  setDetDate]  = useState(todayIso())
  // Fälligkeit folgt der Vorbelegung „Zahlungsziel" (Einstellungen → Vorbelegungen).
  const [dueDate, setDueDate, , paymentTermDays] = useDueDatePreset(detDate)
  const [bpStart,  setBpStart]  = useState('')
  const [bpFinish, setBpFinish] = useState('')
  const [comment,  setComment]  = useState('')
  // Zahlungsart (BT-81). Der Entwurf traegt die Vorbelegung schon aus dem
  // Backend; hier wird sie nur angezeigt, damit die Auswahl nicht leer
  // aussieht und ein Absenden sie nicht ueberschreibt.
  const pmDefault = useDefaultString('default_payment_means_id')
  const [pmGewaehlt, setPmGewaehlt] = useState<string | null>(null)
  const paymentMeansId = pmGewaehlt ?? pmDefault
  const { data: pmData } = useQuery({ queryKey: ['payment-means'], queryFn: fetchPaymentMeans })
  const paymentMeansList = pmData?.data ?? []
  const [buyerRef,      setBuyerRef]      = useState('')
  const [orderRef,      setOrderRef]      = useState('')
  const [accountingRef, setAccountingRef] = useState('')
  const [remittance,    setRemittance]    = useState('')
  const [vatCategory,   setVatCategory]   = useState<VatCategory>('S')
  const [vatExemptCode, setVatExemptCode] = useState('')
  const [vatExemptText, setVatExemptText] = useState('')

  // Step 2: phases
  const [phases,       setPhases]       = useState<FinalPhase[]>([])
  const [phaseChecked, setPhaseChecked] = useState<Set<number>>(new Set())
  const [phaseTotals,  setPhaseTotals]  = useState<FinalTotals | null>(null)

  // Step 3: deductions
  const [deductions,    setDeductions]    = useState<FinalDeduction[]>([])
  const [deductAmounts, setDeductAmounts] = useState<Record<number, string>>({})
  const [dedSelected,   setDedSelected]   = useState<Set<number>>(new Set())
  const [dedTotals,     setDedTotals]     = useState<FinalTotals | null>(null)
  const [dedWarn,       setDedWarn]       = useState<string | null>(null)

  // Step 4: discounts
  const [showDiscounts, setShowDiscounts] = useState(false)
  const [d1Pct,         setD1Pct]         = useState('')
  const [d1Reason,      setD1Reason]      = useState('')
  const [d2Pct,         setD2Pct]         = useState('')
  const [d2Reason,      setD2Reason]      = useState('')
  const [showSkonto,    setShowSkonto]    = useState(false)
  const [cashDiscPct,   setCashDiscPct]   = useState('')
  const [cashDiscDays,  setCashDiscDays]  = useState('')

  // SE-Auflösung (Phase 2)
  const [openSeList,    setOpenSeList]    = useState<OpenSeEntry[]>([])
  const [seReleaseSel,  setSeReleaseSel]  = useState<Set<number>>(new Set())  // ADVANCE_INVOICE IDs to release
  // Im Entwurf gespeicherte Auswahl (null = nie gewaehlt → alle vorwaehlen)
  const savedSeReleaseRef = useRef<number[] | null>(null)

  const projectResultsRef = useRef<Map<number, number | null>>(new Map())
  const contractSkontoRef = useRef<Map<number, { pct: number | null; days: number | null }>>(new Map())
  const draftIdRef = useRef<number | null>(null)
  useEffect(() => { draftIdRef.current = draftId }, [draftId])

  // Fortsetzen: den ganzen Entwurf vom Server holen (siehe draftForm.ts).
  // Vorher kamen nur Projekt, Vertrag, Nachlaesse und Skonto aus der Liste,
  // und der erste Klick auf „Weiter" ueberschrieb Datum und E-Rechnungsfelder.
  useEffect(() => {
    if (!resumeTarget) {
      if (initialProjectId && initialProjectLabel) {
        setProjectId(initialProjectId)
        setProjectLabel(initialProjectLabel)
        onPrefillConsumed?.()
      }
      return
    }
    let cancelled = false
    getInvoice(resumeTarget)
      .then(res => {
        if (cancelled) return
        const { inv, project, contract } = res.data
        if (inv.STATUS_ID !== 1) {
          setMsg({ text: 'Diese Rechnung ist bereits gebucht und lässt sich nicht mehr bearbeiten.', type: 'error' })
          setLoadingResume(false)
          return
        }
        const row = inv as unknown as Record<string, unknown>
        const f = draftFormFromRow(row, 'INVOICE_DATE')
        const savedSe = row.SE_RELEASE_ADVANCE_IDS
        savedSeReleaseRef.current = Array.isArray(savedSe) ? savedSe.map(Number) : null
        setDraftId(inv.ID)
        setProjectId(inv.PROJECT_ID); setProjectLabel(abbrNameLabel(project) || initialDraft?.projectLabel || '')
        setContractId(inv.CONTRACT_ID); setContractLabel(abbrNameLabel(contract) || initialDraft?.contractLabel || '')
        if (f.date) setDetDate(f.date)
        if (f.dueDate) setDueDate(f.dueDate)
        setBpStart(f.bpStart); setBpFinish(f.bpFinish); setComment(f.comment)
        setBuyerRef(f.buyerRef); setOrderRef(f.orderRef); setAccountingRef(f.accountingRef); setRemittance(f.remittance)
        if (f.paymentMeansId) setPmGewaehlt(f.paymentMeansId)
        setVatCategory(f.vatCategory); setVatExemptCode(f.vatExemptCode); setVatExemptText(f.vatExemptText)
        if (f.d1Pct) { setShowDiscounts(true); setD1Pct(f.d1Pct) }
        if (f.d2Pct) setD2Pct(f.d2Pct)
        setD1Reason(f.d1Reason); setD2Reason(f.d2Reason)
        if (f.cashDiscPct) { setShowSkonto(true); setCashDiscPct(f.cashDiscPct) }
        if (f.cashDiscDays) setCashDiscDays(f.cashDiscDays)
        setStep(1)
        setLoadingResume(false)
      })
      .catch((e: Error) => { if (!cancelled) { setMsg({ text: e.message, type: 'error' }); setLoadingResume(false) } })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Beim Schliessen/Neuladen nur nachfragen, nichts loeschen — ein Entwurf
  // bleibt in der Rechnungsliste stehen, bis er gebucht oder dort geloescht
  // wird.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!draftIdRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Offene Sicherheitseinbehalte des Projekts. Ohne gespeicherte Auswahl sind
  // alle vorgewaehlt (die Schlussrechnung schliesst das Projekt ab); ein
  // fortgesetzter Entwurf behaelt, was gespeichert war.
  useEffect(() => {
    if (!projectId) { setOpenSeList([]); setSeReleaseSel(new Set()); return }
    fetchOpenSeForProject(projectId).then(r => {
      const list = r.data ?? []
      const saved = savedSeReleaseRef.current
      setOpenSeList(list)
      setSeReleaseSel(new Set((saved ? list.filter(e => saved.includes(e.ID)) : list).map(e => e.ID)))
    }).catch(() => { setOpenSeList([]); setSeReleaseSel(new Set()) })
  }, [projectId])

  // Auto-fetch contracts when project changes; pre-select if only 1
  useEffect(() => {
    if (!projectId) {
      setContractId(null); setContractLabel(''); setContractsForProject([]); return
    }
    searchContracts(projectId, '').then(res => {
      const list = res.data ?? []
      setContractsForProject(list)
      list.forEach(c => {
        contractSkontoRef.current.set(c.ID, { pct: c.CASH_DISCOUNT_PERCENT ?? null, days: c.CASH_DISCOUNT_DAYS ?? null })
      })
      // Beim Fortsetzen steht der Vertrag schon fest — nicht ueberschreiben.
      if (draftIdRef.current) return
      if (list.length === 1) {
        setContractId(list[0].ID)
        setContractLabel(`${list[0].ABBR} – ${list[0].NAME}`)
      } else {
        setContractId(null); setContractLabel('')
      }
    }).catch(() => {})
  }, [projectId])

  const { data: empData } = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const employees = empData?.data ?? []
  const employee  = employees.find(e => String(e.ID) === employeeId)

  // ── path helper ───────────────────────────────────────────────────────────────
  // ID → phase map for path resolution
  const phaseMap = useMemo(() => new Map(phases.map(p => [p.ID, p])), [phases])
  // IDs that are someone's FATHER_ID — i.e. non-leaf (aggregation) nodes
  const parentIds = useMemo(() => new Set(phases.filter(p => p.FATHER_ID != null).map(p => Number(p.FATHER_ID))), [phases])

  function ancestorsOf(p: FinalPhase): string[] {
    const ancestors: string[] = []
    let cur: FinalPhase | undefined = p.FATHER_ID != null ? phaseMap.get(p.FATHER_ID) : undefined
    while (cur) {
      ancestors.unshift(cur.ABBR)
      cur = cur.FATHER_ID != null ? phaseMap.get(cur.FATHER_ID) : undefined
    }
    return ancestors
  }

  function phaseSortPath(p: FinalPhase): string {
    const ancestors = ancestorsOf(p)
    const leaf = `${p.ABBR}${p.NAME ? ' – ' + p.NAME : ''}`
    return ancestors.length ? `${ancestors.join(' > ')} > ${leaf}` : leaf
  }

  function phasePathLabel(p: FinalPhase): React.ReactNode {
    const ancestors = ancestorsOf(p)
    return (
      <>
        {ancestors.length > 0 && (
          <span className="tree-name-long">{ancestors.join(' > ')} &gt; </span>
        )}
        <strong>{p.ABBR}</strong>
        {p.NAME && <span className="tree-name-long"> – {p.NAME}</span>}
      </>
    )
  }

  // ── Berechnung (eine Stelle fuer Anzeige, Speichern, PDF, XML und Buchen) ──
  const totalsInput = {
    base: dedTotals?.totalNet ?? 0, vatPct: Number(dedTotals?.vatPercent ?? 0),
    discounts: showDiscounts, d1Pct, d2Pct,
    skonto: showSkonto, cashDiscPct, cashDiscDays,
    se: false, sePct: '', seBasis: 'BRUTTO' as const,
  }
  const totals       = computeTotals(totalsInput)
  const seReleaseSum = r2(openSeList.filter(e => seReleaseSel.has(e.ID)).reduce((s, e) => s + (e.SE_AMOUNT || 0), 0))
  const payable      = r2(totals.grossAfter + seReleaseSum)

  // Nachlaesse und Skonto — der Sicherheitseinbehalt einer Schlussrechnung ist
  // eine Aufloesung, kein Einbehalt; die se_*-Felder bleiben unberuehrt.
  function step4Body() {
    const disc: Partial<ReturnType<typeof discountBody>> = discountBody(totals, { ...totalsInput, d1Reason, d2Reason })
    delete disc.se_percent; delete disc.se_basis; delete disc.se_basis_amt; delete disc.se_amount
    return { ...disc, se_release_advance_ids: Array.from(seReleaseSel) }
  }

  function step1Body() {
    return {
      invoice_date:          detDate  || undefined,
      due_date:              dueDate  || undefined,
      billing_period_start:  bpStart  || undefined,
      billing_period_finish: bpFinish || undefined,
      comment:               comment  || undefined,
      // E-Rechnungs-Felder
      buyer_reference:             buyerRef.trim()      || null,
      buyer_order_reference:       orderRef.trim()      || null,
      buyer_accounting_reference:  accountingRef.trim() || null,
      remittance_information:      remittance.trim()    || null,
      ...(paymentMeansId ? { payment_means_id: Number(paymentMeansId) } : {}),
      vat_category:                vatCategory,
      vat_exemption_reason_code:   vatExemptCode.trim() || null,
      vat_exemption_reason_text:   vatExemptText.trim() || null,
    }
  }

  function deductionItems() {
    return Array.from(dedSelected).map(id => ({
      advance_invoice_id:   id,
      deduction_amount_net: Number(deductAmounts[id] ?? 0),
    }))
  }

  // ── mutations ────────────────────────────────────────────────────────────────

  const initMut = useMutation({
    mutationFn: initInvoice,
    onSuccess: (res) => { setDraftId(res.id); onDraftCreated?.(res.id); setMsg(null); setStep(1) },
    onError:   (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof patchInvoice>[1] }) =>
      patchInvoice(id, body),
    onSuccess: async () => {
      if (!draftId) return
      setMsg(null)
      const res = await getFinalInvoicePhases(draftId)
      setPhases(res.data)
      setPhaseChecked(prev => prev.size > 0 ? prev : new Set(res.data.filter(p => p.SELECTED && !p.CLOSED).map(p => p.ID)))
      setTouched(false)
      setStep(2)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const phasesMut = useMutation({
    mutationFn: ({ id, ids }: { id: number; ids: number[] }) =>
      saveFinalInvoicePhases(id, ids),
    onSuccess: (res) => {
      setPhaseTotals({
        phaseTotal:      res.phaseTotal,
        deductionsTotal: res.deductionsTotal,
        totalNet:        res.totalNet,
        vatPercent:      res.vatPercent,
        taxAmountNet:    res.taxAmountNet,
        totalGross:      res.totalGross,
      })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const dedMut = useMutation({
    mutationFn: ({ id, items }: { id: number; items: { advance_invoice_id: number; deduction_amount_net: number }[] }) =>
      saveFinalInvoiceDeductions(id, items),
    onSuccess: (res) => {
      setDedTotals({
        phaseTotal:      res.phaseTotal,
        deductionsTotal: res.deductionsTotal,
        totalNet:        res.totalNet,
        vatPercent:      res.vatPercent,
        taxAmountNet:    res.taxAmountNet,
        totalGross:      res.totalGross,
      })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const bookMut = useMutation({
    mutationFn: async (id: number) => {
      await patchInvoice(id, step4Body())
      return bookFinalInvoice(id, { release_partial_payment_ids: Array.from(seReleaseSel) })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      setBookOpen(false)
      toast.success('Schlussrechnung gebucht')
      draftIdRef.current = null
      onExit?.()
    },
    onError: (e: Error) => {
      setBookOpen(false)
      if (e instanceof ApiRequestError && e.status === 422) {
        const details = e.details as { validation?: ValidationResult } | undefined
        if (details?.validation) {
          setValidationResult(details.validation)
          setValidationOpen(true)
          return
        }
      }
      setMsg({ text: e.message, type: 'error' })
    },
  })

  // ── E-Rechnung Vorpruefung (Branch 6) ──────────────────────────────────────
  const [validationOpen, setValidationOpen]     = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)

  const forceMut = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error('Kein Entwurf')
      return bookFinalInvoiceForce(draftId, { release_partial_payment_ids: Array.from(seReleaseSel) })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      setValidationOpen(false)
      toast.success('Schlussrechnung trotz Hinweisen gebucht')
      draftIdRef.current = null
      onExit?.()
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteInvoice,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      draftIdRef.current = null
      toast.success('Entwurf gelöscht')
      onExit?.()
    },
    onError:   (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  // ── helpers ──────────────────────────────────────────────────────────────────

  function leave() {
    if (draftId) {
      draftIdRef.current = null
      toast.info('Der Entwurf bleibt in der Rechnungsliste.')
    }
    onExit?.()
  }

  // Abbrechen: ein neuer, nie gespeicherter Entwurf fragt, ob er bleiben
  // soll — sonst geht es ohne Rueckfrage zur Liste, der Entwurf bleibt.
  function handleCancel() {
    if (draftId && origin === 'new' && !savedExplicitly) { setLeaveOpen(true); return }
    guarded(leave)
  }

  // „Entwurf behalten" nimmt die Eingaben des aktuellen Schritts mit.
  async function keepAndLeave() {
    try {
      if (touched) await persistStep()
      setLeaveOpen(false)
      leave()
    } catch (e) {
      setLeaveOpen(false)
      setMsg({ text: (e as Error).message, type: 'error' })
    }
  }

  useRegisterDirty('invoice-wizard-schluss', {
    dirty: !!draftId && step >= 1 && touched,
    label: 'Schlussrechnung (Entwurf)',
    save:  persistStep,
  })

  function goToStep(i: number) {
    setMsg(null)
    setStep(i)
  }

  function clearDraftState() {
    setDraftId(null)
    savedSeReleaseRef.current = null
    setPhases([]); setPhaseChecked(new Set()); setPhaseTotals(null)
    setDeductions([]); setDeductAmounts({}); setDedSelected(new Set()); setDedTotals(null); setDedWarn(null)
  }

  function submitStep0() {
    setMsg(null)
    if (!projectId)  { setMsg({ text: 'Wähle ein Projekt.', type: 'error' }); return }
    if (!contractId) { setMsg({ text: 'Wähle einen Vertrag.', type: 'error' }); return }
    if (!employeeId) { setMsg({ text: 'Wähle, wer die Rechnung erstellt.', type: 'error' }); return }
    if (draftId) { setStep(1); return }
    initMut.mutate({
      company_id: companyId ?? 0, employee_id: Number(employeeId),
      project_id: projectId, contract_id: contractId,
      invoice_type: 'schlussrechnung',
    })
  }

  function submitStep1() {
    if (!draftId) return
    setMsg(null)
    patchMut.mutate({ id: draftId, body: step1Body() })
  }

  async function loadDeductions(id: number) {
    const ded = await getFinalInvoiceDeductions(id)
    setDeductions(ded.data)
    setDeductAmounts(Object.fromEntries(
      ded.data.map(d => [d.ID, String(d.DEDUCTION_AMOUNT_NET ?? d.AMOUNT_NET ?? '')])
    ))
    setDedSelected(new Set(ded.data.filter(d => d.SELECTED).map(d => d.ID)))
    setDedWarn(null)
  }

  async function submitPhases() {
    if (!draftId) return
    setMsg(null)
    try {
      await phasesMut.mutateAsync({ id: draftId, ids: Array.from(phaseChecked) })
      await loadDeductions(draftId)
      setTouched(false)
      setStep(3)
    } catch { /* onError setzt die Meldung */ }
  }

  async function submitDeductions() {
    if (!draftId) return
    setMsg(null)
    try {
      await dedMut.mutateAsync({ id: draftId, items: deductionItems() })
      setTouched(false)
      setStep(4)
    } catch { /* onError setzt die Meldung */ }
  }

  // Speichert den aktuellen Schritt; wirft bei Fehler (so braucht es der Guard).
  async function persistStep() {
    if (!draftId) return
    if (step === 1) await patchInvoice(draftId, step1Body())
    if (step === 2) await phasesMut.mutateAsync({ id: draftId, ids: Array.from(phaseChecked) })
    if (step === 3) await dedMut.mutateAsync({ id: draftId, items: deductionItems() })
    if (step === 4) await patchInvoice(draftId, step4Body())
    setTouched(false)
    setSavedExplicitly(true)
    void qc.invalidateQueries({ queryKey: ['invoices'] })
  }

  const [savingDraft, setSavingDraft] = useState(false)
  async function saveDraft() {
    if (!draftId) return
    setSavingDraft(true); setMsg(null)
    try {
      await persistStep()
      toast.success('Entwurf gespeichert')
    } catch (e) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally {
      setSavingDraft(false)
    }
  }

  // PDF und E-Rechnung zeigen den Stand auf dem Server — also erst Nachlaesse
  // und SE-Auswahl speichern. Beim XML fehlte das bis Runde 2.
  async function withSavedDiscounts(run: (id: number) => unknown) {
    if (!draftId) return
    setMsg(null)
    try {
      await patchInvoice(draftId, step4Body())
      await run(draftId)
    } catch (e) {
      setMsg({ text: (e as Error).message, type: 'error' })
    }
  }
  const previewPdf  = () => withSavedDiscounts(id => openInvoicePdf(id, { releasePpIds: Array.from(seReleaseSel) }))
  const downloadXml = (format: 'ubl' | 'cii') => withSavedDiscounts(id => downloadInvoiceEinvoice(id, 'schlussrechnung', null, format))

  function toggleDed(d: FinalDeduction) {
    const id = d.ID
    const isAdding = !dedSelected.has(id)
    setDedSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    if (isAdding) {
      const uncovered = (d.STRUCTURE_IDS ?? []).filter(sid => !phaseChecked.has(sid))
      if (uncovered.length > 0) {
        setDedWarn(
          `${d.ADVANCE_INVOICE_NUMBER ?? `Abschlag #${id}`} enthält Positionen, die im Schritt „Positionen" nicht ausgewählt sind.`
        )
      }
    } else {
      setDedWarn(null)
    }
  }

  // ── derived values ────────────────────────────────────────────────────────────

  // Only leaf nodes, not closed, not fully billed by prior final invoices — sorted by full path
  const selectablePhases = useMemo(() => phases
    .filter(p => {
      if (parentIds.has(p.ID)) return false          // aggregation node
      if (p.CLOSED) return false
      const totalEarned = p.TOTAL_EARNED ?? 0
      const billedFinal = p.BILLED_FINAL ?? 0
      if (totalEarned > 0 && billedFinal >= totalEarned) return false
      return true
    })
    .sort((a, b) => phaseSortPath(a).localeCompare(phaseSortPath(b), 'de', { numeric: true }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [phases, parentIds])

  const allPhasesChecked =
    selectablePhases.length > 0 && selectablePhases.every(p => phaseChecked.has(p.ID))

  function toggleAllPhases() {
    if (allPhasesChecked) {
      setPhaseChecked(new Set())
    } else {
      setPhaseChecked(new Set(selectablePhases.map(p => p.ID)))
    }
  }

  const allDedChecked =
    deductions.length > 0 && deductions.every(d => dedSelected.has(d.ID))

  function toggleAllDed() {
    if (allDedChecked) {
      setDedSelected(new Set())
      setDedWarn(null)
    } else {
      setDedSelected(new Set(deductions.map(d => d.ID)))
      const allUncovered = deductions.flatMap(d =>
        (d.STRUCTURE_IDS ?? []).filter(sid => !phaseChecked.has(sid))
      )
      if (allUncovered.length > 0) {
        setDedWarn('Einige Abschlagsrechnungen enthalten Positionen, die im Schritt „Positionen" nicht ausgewählt sind.')
      }
    }
  }

  const singleContract = contractsForProject.length === 1

  const hiddenCount = phases.filter(p => {
    if (parentIds.has(p.ID)) return false            // don't count aggregation nodes
    if (p.CLOSED) return true
    const totalEarned = p.TOTAL_EARNED ?? 0
    const billedFinal = p.BILLED_FINAL ?? 0
    return totalEarned > 0 && billedFinal >= totalEarned
  }).length

  // Dieser Rechnung = Leistungswert minus das, was Schlussrechnungen schon
  // abgerechnet haben; Abschlaege zieht erst der naechste Schritt ab.
  const thisInvoiceOf = (p: FinalPhase) => Math.max(0, (p.TOTAL_EARNED ?? 0) - (p.BILLED_FINAL ?? 0))

  const busy = initMut.isPending || patchMut.isPending || phasesMut.isPending || dedMut.isPending || bookMut.isPending || savingDraft
  const einvoiceFilled = [buyerRef, orderRef, accountingRef, remittance].filter(v => v.trim()).length + (vatCategory !== 'S' ? 1 : 0)

  // ── Zusammenfassung ─────────────────────────────────────────────────────────
  const vatForSummary = Number(dedTotals?.vatPercent ?? phaseTotals?.vatPercent ?? 0)
  const provisional = (net: number): SummaryAmounts => ({
    net, vatPct: vatForSummary, tax: r2(net * vatForSummary / 100), gross: r2(net * (1 + vatForSummary / 100)),
    seAmt: 0, payable: 0, provisional: true,
  })
  const phaseSum = r2(phases.filter(p => phaseChecked.has(p.ID)).reduce((s, p) => s + thisInvoiceOf(p), 0))
  const dedSum   = r2(Array.from(dedSelected).reduce((s, id) => s + (Number(deductAmounts[id]) || 0), 0))
  const summaryAmounts: SummaryAmounts | null =
    step === 4 && dedTotals ? {
      net: totals.netAfter, vatPct: totals.vatPct, tax: totals.taxAfter, gross: totals.grossAfter,
      seAmt: 0, seRelease: seReleaseSum, payable, provisional: false,
    }
    : step === 3 && phaseTotals ? provisional(r2(phaseTotals.phaseTotal - dedSum))
    : step === 2 && phases.length ? provisional(phaseSum)
    : null
  const provisionalHint = step === 2
    ? 'Abschläge, Nachlässe und Skonto kommen in den nächsten Schritten dazu.'
    : 'Nachlässe, Skonto und SE-Auflösung kommen im nächsten Schritt dazu.'
  const statusText = draftId ? (savedExplicitly ? 'Entwurf gespeichert' : 'Entwurf – noch nicht gebucht') : 'Noch kein Entwurf angelegt'

  // ── Aktionsleiste ───────────────────────────────────────────────────────────

  function primaryAction() {
    if (step === 0) return { label: initMut.isPending ? 'Legt Entwurf an …' : 'Weiter', run: submitStep0, icon: ChevronRight }
    if (step === 1) return { label: patchMut.isPending ? 'Speichert …' : 'Weiter', run: submitStep1, icon: ChevronRight }
    if (step === 2) return { label: phasesMut.isPending ? 'Speichert …' : 'Weiter', run: () => void submitPhases(), icon: ChevronRight }
    if (step === 3) return { label: dedMut.isPending ? 'Speichert …' : 'Weiter', run: () => void submitDeductions(), icon: ChevronRight }
    if (canBook)    return { label: 'Jetzt buchen', run: () => setBookOpen(true), icon: Check }
    return { label: savingDraft ? 'Speichert …' : 'Entwurf speichern', run: () => void saveDraft(), icon: Check }
  }
  const primary = primaryAction()
  const PrimaryIcon = primary.icon
  const showDraftSave = step >= 1 && !(step === 4 && !canBook)

  const actionBar = (
    <ActionBar
      status={step >= 1 && draftId ? statusText : undefined}
      secondary={narrow ? (
        step >= 1 ? (
          <RowMenu label="Weitere Aktionen" triggerClassName="btn-secondary iw-more">
            {showDraftSave && <button type="button" role="menuitem" className="row-menu-item" onClick={() => void saveDraft()}>Entwurf speichern</button>}
            {step === 4 && canPdf && <button type="button" role="menuitem" className="row-menu-item" onClick={() => void previewPdf()}>PDF-Vorschau</button>}
            <button type="button" role="menuitem" className="row-menu-item" onClick={handleCancel}>Abbrechen</button>
          </RowMenu>
        ) : <button type="button" className="btn-secondary" onClick={handleCancel}>Abbrechen</button>
      ) : (
        <button type="button" className="btn-secondary" onClick={handleCancel} disabled={busy}>Abbrechen</button>
      )}
    >
      {step >= 1 && (
        <button type="button" className="btn-secondary" onClick={() => goToStep(step - 1)} disabled={busy}>
          <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" /> Zurück
        </button>
      )}
      {!narrow && showDraftSave && (
        <button type="button" className="btn-secondary" onClick={() => void saveDraft()} disabled={busy}>
          {savingDraft ? 'Speichert …' : 'Entwurf speichern'}
        </button>
      )}
      <button type="button" className="btn-primary" onClick={primary.run} disabled={busy || loadingResume}>
        {primary.label} <PrimaryIcon size={15} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </ActionBar>
  )

  // ── render ───────────────────────────────────────────────────────────────────

  if (loadingResume) {
    return <div className="iw-root"><p className="empty-note">Lade Entwurf …</p></div>
  }

  const stepTitle = (
    <p className="wizard-step-title iw-step-title">
      {STEPS[step]} <HelpHint id={STEP_HELP[step]} />
    </p>
  )

  return (
    <div className="wizard-wrap iw-root" data-kind="schluss">
      <StepIndicator steps={STEPS} current={step} onStepClick={i => void goToStep(i)} compactOnMobile />

      <div className="iw-layout">
      <div className="iw-main" onChangeCapture={() => { if (draftIdRef.current && step >= 1 && !touched) setTouched(true) }}>
      {/* Schritt 1: Projekt & Vertrag */}
      {step === 0 && (
        <div className="wizard-step-content iw-form">
          {stepTitle}
          <Autocomplete
            label="Projekt*" htmlId="sw-project"
            value={projectLabel}
            onChange={setProjectLabel}
            onSelect={(id, label) => {
              const pid = Number(id)
              if (draftId && pid !== projectId) {
                deleteInvoice(draftId).catch(() => {})
                clearDraftState()
              }
              savedSeReleaseRef.current = null
              setProjectId(pid); setProjectLabel(label)
              setCompanyId(projectResultsRef.current.get(pid) ?? null)
              setContractId(null); setContractLabel('')
            }}
            search={async q => {
              const res = await searchProjectsApi(q)
              res.data.forEach(p => projectResultsRef.current.set(p.ID, p.COMPANY_ID ?? null))
              return res.data.map(p => ({ id: p.ID, label: `${p.ABBR} – ${p.NAME}` }))
            }}
            placeholder="Projekt suchen …"
          />
          {singleContract ? (
            <div className="form-group">
              <label htmlFor="sw-contract-ro">Vertrag</label>
              <input id="sw-contract-ro" readOnly value={contractLabel} className="iw-readonly" />
              <p className="form-field-hint">Das Projekt hat nur diesen Vertrag.</p>
            </div>
          ) : (
            <Autocomplete
              label="Vertrag*" htmlId="sw-contract"
              value={contractLabel}
              onChange={setContractLabel}
              onSelect={(id, label) => {
                if (draftId && Number(id) !== contractId) {
                  deleteInvoice(draftId).catch(() => {})
                  clearDraftState()
                }
                setContractId(Number(id)); setContractLabel(label)
              }}
              search={async q => {
                if (!projectId) return []
                const res = await searchContracts(projectId, q)
                res.data.forEach(c => {
                  contractSkontoRef.current.set(c.ID, { pct: c.CASH_DISCOUNT_PERCENT ?? null, days: c.CASH_DISCOUNT_DAYS ?? null })
                })
                return res.data.map(c => ({ id: c.ID, label: `${c.ABBR} – ${c.NAME}` }))
              }}
              placeholder={projectId ? 'Vertrag suchen …' : 'Erst Projekt wählen'}
            />
          )}
          {changeEmployee ? (
            <div className="form-group">
              <label htmlFor="sw-emp">Erstellt von*</label>
              <select id="sw-emp" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {employees.map(e => <option key={e.ID} value={e.ID}>{e.ABBR}: {e.FIRST_NAME} {e.LAST_NAME}</option>)}
              </select>
            </div>
          ) : (
            <p className="iw-byline">
              Erstellt von: <strong>{employee ? `${employee.FIRST_NAME} ${employee.LAST_NAME}` : '—'}</strong>
              {' '}<button type="button" className="link-btn" onClick={() => setChangeEmployee(true)}>ändern</button>
            </p>
          )}
          <Message text={msg?.text ?? null} type={msg?.type} />
        </div>
      )}

      {/* Schritt 2: Rechnungsdaten */}
      {step === 1 && (
        <div className="wizard-step-content iw-form">
          {stepTitle}
          <div className="form-row">
            <FormField label="Rechnungsdatum" id="srd"  type="date" value={detDate}  onChange={e => setDetDate(e.target.value)} />
            <FormField
              label="Fällig am" id="srdd" type="date"
              value={dueDate} onChange={e => setDueDate(e.target.value)}
              hint={paymentTermDays !== null ? `Zahlungsziel: ${paymentTermDays} Tage ab Rechnungsdatum` : undefined}
            />
          </div>
          <div className="form-row">
            <FormField label="Leistungszeitraum von" id="srbs" type="date" value={bpStart}  onChange={e => setBpStart(e.target.value)} />
            <FormField label="bis"                   id="srbf" type="date" value={bpFinish} onChange={e => setBpFinish(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="sr-comment">Kommentar (erscheint auf der Rechnung)</label>
            <textarea id="sr-comment" className="iw-textarea" rows={2} value={comment} onChange={e => setComment(e.target.value)} />
          </div>

          {/* E-Rechnungs-Felder (BT-10/13/19/83) */}
          <Disclosure
            title="E-Rechnungs-Detailfelder"
            help={<HelpHint id="einvoice.detailfelder" />}
            hint={einvoiceFilled ? `${einvoiceFilled} ausgefüllt` : 'optional'}
            defaultOpen={einvoiceFilled > 0}
          >
            <div className="iw-einvoice">
              <FormField label="Käuferreferenz / Leitweg-ID" id="sr-buyer-ref"
                value={buyerRef} onChange={e => setBuyerRef(e.target.value)}
                hint="Nur bei öffentlichen Auftraggebern Pflicht." />
              <FormField label="Bestellnummer des Käufers" id="sr-order-ref"
                value={orderRef} onChange={e => setOrderRef(e.target.value)} />
              <FormField label="Kostenstelle" id="sr-acc-ref"
                value={accountingRef} onChange={e => setAccountingRef(e.target.value)} />
              <div className="form-group">
                <label htmlFor="sr-paymeans">Zahlungsart</label>
                <select id="sr-paymeans" value={paymentMeansId} onChange={e => setPmGewaehlt(e.target.value)}>
                  <option value="">— keine Angabe —</option>
                  {paymentMeansList.map(pm => <option key={pm.ID} value={pm.ID}>{pm.NAME}</option>)}
                </select>
              </div>
              <FormField label="Verwendungszweck" id="sr-remit"
                value={remittance} onChange={e => setRemittance(e.target.value)} />

              <div className="form-group">
                <label htmlFor="sr-vatcat">Umsatzsteuer-Kategorie</label>
                <select id="sr-vatcat" value={vatCategory} onChange={e => setVatCategory(e.target.value as VatCategory)}>
                  {(Object.keys(VAT_CATEGORY_LABELS) as VatCategory[]).map(k => (
                    <option key={k} value={k}>{VAT_CATEGORY_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              {vatCategory !== 'S' && (
                <>
                  <FormField label="Begründung Code (optional)" id="sr-exempt-code"
                    value={vatExemptCode} onChange={e => setVatExemptCode(e.target.value)} />
                  <div className="form-group">
                    <label htmlFor="sr-exempt-text">Begründungstext</label>
                    <textarea id="sr-exempt-text" className="iw-textarea" rows={2} value={vatExemptText} onChange={e => setVatExemptText(e.target.value)}
                      placeholder="Leer lassen für Standardtext" />
                  </div>
                </>
              )}
            </div>
          </Disclosure>

          <AnlagenSection base="invoices" docId={draftId} />

          <Message text={msg?.text ?? null} type={msg?.type} />
        </div>
      )}

      {/* Schritt 3: Positionen */}
      {step === 2 && (
        <div className="wizard-step-content">
          {stepTitle}
          <div className="list-section table-scroll">
            <table className="master-table sw-table">
              <thead>
                <tr>
                  <th scope="col" className="sw-check-col">
                    <input type="checkbox" checked={allPhasesChecked} onChange={toggleAllPhases}
                      aria-label="Alle Positionen auswählen" title="Alle auswählen / abwählen" />
                  </th>
                  <th scope="col">Position</th>
                  <th scope="col" className="num sw-hide-narrow">Leistungsstand €</th>
                  <th scope="col" className="num sw-hide-narrow">Bereits abgerechnet €</th>
                  <th scope="col" className="num">Diese Rechnung €</th>
                </tr>
              </thead>
              <tbody>
                {selectablePhases.map(p => {
                  const checked = phaseChecked.has(p.ID)
                  return (
                    <tr key={p.ID}>
                      <td className="sw-check-col">
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-label={`${p.ABBR}${p.NAME ? ` ${p.NAME}` : ''} abrechnen`}
                          onChange={() => {
                            setPhaseChecked(prev => {
                              const next = new Set(prev)
                              if (next.has(p.ID)) next.delete(p.ID); else next.add(p.ID)
                              return next
                            })
                          }}
                        />
                      </td>
                      <td>
                        {phasePathLabel(p)}
                        {/* Am Handy fehlt die Spalte — der Wert steht unter dem Namen. */}
                        <span className="sw-sub">Leistungsstand {fmtEur(p.TOTAL_EARNED)}</span>
                      </td>
                      <td className="num sw-hide-narrow">{money(p.TOTAL_EARNED)}</td>
                      <td className="num sw-hide-narrow">{money(p.ALREADY_BILLED)}</td>
                      <td className="num">{checked ? money(thisInvoiceOf(p)) : NO_VALUE}</td>
                    </tr>
                  )
                })}
                {!selectablePhases.length && (
                  <tr><td colSpan={5} className="empty-note">Keine offenen Positionen – alles ist bereits schlussgerechnet oder geschlossen.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {hiddenCount > 0 && (
            <p className="iw-note sw-after-table">
              {hiddenCount} vollständig abgerechnete oder geschlossene {hiddenCount === 1 ? 'Position wird' : 'Positionen werden'} nicht angezeigt.
            </p>
          )}
          <Message text={msg?.text ?? null} type={msg?.type} />
        </div>
      )}

      {/* Schritt 4: Abschläge abziehen */}
      {step === 3 && (
        <div className="wizard-step-content">
          {stepTitle}
          {phaseTotals && (
            <div className="billing-proposal-box">
              <div className="bp-row"><span>Positionssumme netto</span><strong>{money(phaseTotals.phaseTotal)}</strong></div>
              {dedSelected.size > 0 && <div className="bp-row iw-minus"><span>./. Abschläge (ausgewählt)</span><strong>− {fmtEur(dedSum)}</strong></div>}
            </div>
          )}
          {deductions.length === 0 && (
            <p className="empty-note">Für dieses Projekt gibt es keine gebuchten Abschlagsrechnungen, die noch abzuziehen sind.</p>
          )}
          {deductions.length > 0 && (
            <div className="list-section table-scroll">
              <table className="master-table sw-table">
                <thead>
                  <tr>
                    <th scope="col" className="sw-check-col">
                      <input type="checkbox" checked={allDedChecked} onChange={toggleAllDed}
                        aria-label="Alle Abschlagsrechnungen abziehen" title="Alle auswählen / abwählen" />
                    </th>
                    <th scope="col">Nummer</th>
                    <th scope="col" className="sw-hide-narrow">Datum</th>
                    <th scope="col" className="num">Betrag netto €</th>
                    <th scope="col" className="num">Abzug netto €</th>
                  </tr>
                </thead>
                <tbody>
                  {deductions.map(d => {
                    const label = d.ADVANCE_INVOICE_NUMBER ?? `#${d.ID}`
                    return (
                      <tr key={d.ID}>
                        <td className="sw-check-col">
                          <input type="checkbox" checked={dedSelected.has(d.ID)} onChange={() => toggleDed(d)}
                            aria-label={`Abschlagsrechnung ${label} abziehen`} />
                        </td>
                        <td>{d.ADVANCE_INVOICE_NUMBER ?? NO_VALUE}</td>
                        <td className="sw-hide-narrow">{deDay(d.ADVANCE_INVOICE_DATE)}</td>
                        <td className="num">{money(d.AMOUNT_NET)}</td>
                        <td className="num">
                          <AmountInput
                            className="sw-amount"
                            aria-label={`Abzug netto ${label}`}
                            value={dedSelected.has(d.ID) ? (deductAmounts[d.ID] ?? '') : ''}
                            disabled={!dedSelected.has(d.ID)}
                            onChange={v => setDeductAmounts(prev => ({ ...prev, [d.ID]: v }))}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {dedWarn && (
            <p className="sw-warn" role="status">
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" /> {dedWarn}
            </p>
          )}
          <Message text={msg?.text ?? null} type={msg?.type} />
        </div>
      )}

      {/* Schritt 5: Prüfen & buchen */}
      {step === 4 && (() => {
        const t = totals
        return (
          <div className="wizard-step-content iw-form">
            {stepTitle}

            {/* Nachlässe und Skonto */}
            <div className="iw-discounts">
              <p className="iw-section-title">Nachlässe und Skonto</p>
              <label className="iw-check">
                <input type="checkbox" checked={showDiscounts} onChange={e => setShowDiscounts(e.target.checked)} />
                Nachlässe angeben
              </label>
              {showDiscounts && (
                <div className="iw-sub">
                  <div className="iw-line">
                    <label htmlFor="sr-d1" className="iw-line-label">Nachlass I (%)</label>
                    <input id="sr-d1" type="text" inputMode="decimal" className="iw-small" value={d1Pct}
                      onChange={e => { const v = e.target.value.replace(',', '.'); setD1Pct(v); if (!v) { setD2Pct(''); setD2Reason('') } }}
                      placeholder="z. B. 3" />
                    <input type="text" aria-label="Bezeichnung Nachlass I" className="iw-grow" value={d1Reason} onChange={e => setD1Reason(e.target.value)}
                      placeholder="Bezeichnung (optional)" />
                    {d1Pct && <span className="iw-amount">= {fmtEur(t.d1Amt)}</span>}
                  </div>
                  {d1Pct && (
                    <div className="iw-line">
                      <label htmlFor="sr-d2" className="iw-line-label">Nachlass II (%)</label>
                      <input id="sr-d2" type="text" inputMode="decimal" className="iw-small" value={d2Pct}
                        onChange={e => setD2Pct(e.target.value.replace(',', '.'))} placeholder="optional" />
                      <input type="text" aria-label="Bezeichnung Nachlass II" className="iw-grow" value={d2Reason} onChange={e => setD2Reason(e.target.value)}
                        placeholder="Bezeichnung (optional)" />
                      {d2Pct && <span className="iw-amount">= {fmtEur(t.d2Amt)}</span>}
                    </div>
                  )}
                </div>
              )}
              <div className="iw-check-row">
                <label className="iw-check">
                  <input type="checkbox" checked={showSkonto} onChange={e => {
                    setShowSkonto(e.target.checked)
                    if (e.target.checked && contractId) {
                      const s = contractSkontoRef.current.get(contractId)
                      if (s?.pct != null) setCashDiscPct(String(s.pct))
                      if (s?.days != null) setCashDiscDays(String(s.days))
                    }
                  }} />
                  Skonto angeben
                </label>
                <HelpHint id="invoice.skonto" />
              </div>
              {showSkonto && (
                <div className="iw-sub">
                  <div className="iw-line">
                    <label htmlFor="sr-cd" className="iw-line-label">Skonto (%)</label>
                    <input id="sr-cd" type="text" inputMode="decimal" className="iw-small" value={cashDiscPct}
                      onChange={e => setCashDiscPct(e.target.value.replace(',', '.'))} placeholder="z. B. 2" />
                    <label htmlFor="sr-cdd" className="iw-line-label">innerhalb (Tage)</label>
                    <input id="sr-cdd" type="text" inputMode="numeric" className="iw-small" value={cashDiscDays}
                      onChange={e => setCashDiscDays(e.target.value)} placeholder="z. B. 14" />
                    {t.cdAmt > 0 && <span className="iw-amount">= {fmtEur(t.cdAmt)}</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Sicherheitseinbehalt-Auflösung (Phase 2) */}
            {openSeList.length > 0 && (
              <fieldset className="iw-discounts sw-se">
                <legend className="iw-section-title iw-check-row">
                  Sicherheitseinbehalte auflösen <HelpHint id="invoice.sicherheitseinbehalt" />
                </legend>
                <p className="iw-note">
                  Diese Abschlagsrechnungen haben einbehaltene Beträge. Ausgewählte kommen mit dieser Rechnung
                  zur Zahlung; ohne eigene Auswahl sind alle vorgewählt.
                </p>
                {openSeList.map(e => (
                  <label key={e.ID} className="iw-check sw-se-row">
                    <input
                      type="checkbox"
                      checked={seReleaseSel.has(e.ID)}
                      onChange={ev => {
                        setSeReleaseSel(prev => {
                          const next = new Set(prev)
                          if (ev.target.checked) next.add(e.ID); else next.delete(e.ID)
                          return next
                        })
                      }}
                    />
                    <span>
                      Nr. <strong>{e.ADVANCE_INVOICE_NUMBER || `#${e.ID}`}</strong>
                      {e.ADVANCE_INVOICE_DATE ? <span className="sw-muted"> · {deDay(e.ADVANCE_INVOICE_DATE)}</span> : null}
                    </span>
                    <span className="sw-se-amt">+ {fmtEur(e.SE_AMOUNT)}</span>
                  </label>
                ))}
                <div className="sw-se-sum">
                  <span>Auflösung in dieser Rechnung</span>
                  <strong>+ {fmtEur(seReleaseSum)}</strong>
                </div>
              </fieldset>
            )}

            {/* Summen */}
            {dedTotals && (
              <div className="billing-proposal-box">
                <div className="bp-row"><span>Positionen netto</span><strong>{money(dedTotals.phaseTotal)}</strong></div>
                <div className="bp-row iw-minus"><span>./. Abschläge netto</span><strong>− {fmtEur(dedTotals.deductionsTotal)}</strong></div>
                <div className="bp-row"><span>Zwischensumme netto</span><strong>{money(t.base)}</strong></div>
                {t.totalDisc > 0 && <div className="bp-row iw-minus"><span>./. Nachlässe</span><strong>− {fmtEur(t.totalDisc)}</strong></div>}
                {t.cdAmt > 0 && <div className="bp-row iw-minus"><span>./. Skonto</span><strong>− {fmtEur(t.cdAmt)}</strong></div>}
                <div className="bp-row total"><span>Netto gesamt{t.totalDisc > 0 || t.cdAmt > 0 ? ' (nach Abzügen)' : ''}</span><strong>{money(t.netAfter)}</strong></div>
                {t.vatPct > 0 && <div className="bp-row"><span>zzgl. {t.vatPct}&thinsp;% MwSt.</span><strong>{money(t.taxAfter)}</strong></div>}
                <div className="bp-row total"><span>Brutto gesamt</span><strong>{money(t.grossAfter)}</strong></div>
                {seReleaseSum > 0 && (
                  <>
                    <div className="bp-row"><span>+ Auflösung Sicherheitseinbehalt</span><strong>+ {fmtEur(seReleaseSum)}</strong></div>
                    <div className="bp-row total"><span>Zahlungsbetrag</span><strong>{money(payable)}</strong></div>
                  </>
                )}
              </div>
            )}

            {/* Ausgewählte Positionen und Abzüge — zum Gegenlesen, eingeklappt */}
            {(phaseChecked.size > 0 || dedSelected.size > 0) && (
              <Disclosure
                title="Positionen und Abzüge"
                hint={`${phaseChecked.size} ${phaseChecked.size === 1 ? 'Position' : 'Positionen'} · ${dedSelected.size} ${dedSelected.size === 1 ? 'Abzug' : 'Abzüge'}`}
              >
                {phaseChecked.size > 0 && (
                  <div className="list-section table-scroll">
                    <table className="master-table sw-table">
                      <thead>
                        <tr>
                          <th scope="col">Position</th>
                          <th scope="col" className="num">Diese Rechnung €</th>
                        </tr>
                      </thead>
                      <tbody>
                        {phases.filter(p => phaseChecked.has(p.ID)).map(p => (
                          <tr key={p.ID}>
                            <td>{phasePathLabel(p)}</td>
                            <td className="num">{money(thisInvoiceOf(p))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {dedSelected.size > 0 && (
                  <div className="list-section table-scroll">
                    <table className="master-table sw-table">
                      <thead>
                        <tr>
                          <th scope="col">Abschlagsrechnung</th>
                          <th scope="col" className="sw-hide-narrow">Datum</th>
                          <th scope="col" className="num">Abzug netto €</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deductions.filter(d => dedSelected.has(d.ID)).map(d => (
                          <tr key={d.ID}>
                            <td>{d.ADVANCE_INVOICE_NUMBER ?? NO_VALUE}</td>
                            <td className="sw-hide-narrow">{deDay(d.ADVANCE_INVOICE_DATE)}</td>
                            <td className="num">{money(Number(deductAmounts[d.ID] ?? d.DEDUCTION_AMOUNT_NET ?? 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Disclosure>
            )}

            {draftId && (canPdf || canXml) && (
              <div className="iw-docs">
                {canPdf && (
                  <button type="button" className="btn-secondary" onClick={() => void previewPdf()}>
                    <FileText size={14} strokeWidth={2} aria-hidden="true" /> PDF-Vorschau
                  </button>
                )}
                {canXml && (
                  <RowMenu label="E-Rechnung herunterladen" triggerClassName="btn-secondary"
                    triggerContent={<>E-Rechnung <ChevronDown size={14} strokeWidth={2} aria-hidden="true" /></>}>
                    <button type="button" role="menuitem" className="row-menu-item" onClick={() => void downloadXml('ubl')}>XRechnung (UBL)</button>
                    <button type="button" role="menuitem" className="row-menu-item" onClick={() => void downloadXml('cii')}>ZUGFeRD (CII)</button>
                  </RowMenu>
                )}
              </div>
            )}
            <p className="iw-note">
              {canBook
                ? 'Nach dem Buchen ist die Schlussrechnung unveränderlich, und die gewählten Positionen gelten als abgeschlossen. Bis dahin bleibt sie ein Entwurf in der Rechnungsliste.'
                : 'Buchen darf in deinem Büro nur, wer das Recht dazu hat. Speichere den Entwurf – er bleibt in der Rechnungsliste.'}
            </p>
            <Message text={msg?.text ?? null} type={msg?.type} />
          </div>
        )
      })()}
      </div>

      <InvoiceSummary
        project={projectLabel} contract={contractLabel}
        date={step >= 1 || draftId ? detDate : ''} dueDate={step >= 1 || draftId ? dueDate : ''}
        bpStart={bpStart} bpFinish={bpFinish}
        amounts={summaryAmounts} status={statusText} provisionalHint={provisionalHint}
      />
      </div>

      {actionBar}

      {/* Rueckfrage beim Verlassen eines neuen Entwurfs */}
      <Modal open={leaveOpen} onClose={() => setLeaveOpen(false)} title="Assistent verlassen?">
        <p className="guard-text">
          Der Entwurf ist angelegt, aber noch nicht gebucht. Du kannst ihn behalten und später in der
          Rechnungsliste fortsetzen – oder löschen.
        </p>
        <DialogFooter secondary={canDelete ? (
          <button type="button" className="btn-secondary iw-danger-text" disabled={deleteMut.isPending}
            onClick={() => { if (draftId) deleteMut.mutate(draftId) }}>
            Entwurf löschen
          </button>
        ) : undefined}>
          <button type="button" className="btn-secondary" onClick={() => setLeaveOpen(false)}>Weiter bearbeiten</button>
          <button type="button" className="btn-primary" onClick={() => void keepAndLeave()}>Entwurf behalten</button>
        </DialogFooter>
      </Modal>

      {/* Bestaetigung vor dem Buchen */}
      <Modal open={bookOpen} onClose={() => setBookOpen(false)} title="Schlussrechnung buchen?">
        <p className="guard-text">
          Brutto <strong>{fmtEur(totals.grossAfter)}</strong>
          {seReleaseSum > 0 ? <>, mit Auflösung der Sicherheitseinbehalte zahlbar <strong>{fmtEur(payable)}</strong></> : null}.
          {' '}{phaseChecked.size} {phaseChecked.size === 1 ? 'Position gilt' : 'Positionen gelten'} danach als abgeschlossen.
          Nach dem Buchen erhält die Rechnung ihre Nummer und ist unveränderlich – Korrekturen nur per Storno.
        </p>
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={() => setBookOpen(false)} disabled={bookMut.isPending}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={bookMut.isPending} onClick={() => { if (draftId) bookMut.mutate(draftId) }}>
            {bookMut.isPending ? 'Bucht …' : 'Jetzt buchen'}
          </button>
        </DialogFooter>
      </Modal>

      <ValidationModal
        open={validationOpen}
        onClose={() => setValidationOpen(false)}
        result={validationResult}
        onForce={() => forceMut.mutate()}
        onAcknowledge={() => forceMut.mutate()}
      />
    </div>
  )
}
