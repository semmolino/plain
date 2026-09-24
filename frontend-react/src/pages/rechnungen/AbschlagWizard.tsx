import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Check, FileText, ChevronDown } from 'lucide-react'
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
import { BuchungsauswahlTable } from '@/components/rechnungen/BuchungsauswahlTable'
import {
  searchContracts,
  initPartialPayment, patchPartialPayment, getPartialPayment, getPpBillingProposal,
  putPpPerformance, getPpTec, postPpTec, bookPartialPayment, bookPartialPaymentForce, deletePartialPayment,
  openPpPdf, downloadPpEinvoice,
  VAT_CATEGORY_LABELS,
  type BillingProposal, type TecEntry, type VatCategory,
  type ValidationResult,
} from '@/api/rechnungen'
import { ApiRequestError } from '@/api/client'
import { fetchActiveEmployees, searchProjectsApi } from '@/api/projekte'
import { useAuthStore } from '@/store/authStore'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import { useDueDatePreset, useDefaultString } from '@/hooks/useTenantDefaults'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { fetchPaymentMeans } from '@/api/stammdaten'
import { fmtEur, money } from '@/utils/money'
import { localIsoDate } from '@/utils/zeit'

// Lokales Datum — das UTC-Datum ist zwischen 0 und 2 Uhr noch gestern.
function todayIso() { return localIsoDate() }

// Vorher: 'Init', 'Details', 'Beträge', 'Buchen' — „Init" ist Programmierer-
// sprache, und „Buchen" verschwieg, dass man dort vor allem prueft.
const STEPS = ['Projekt & Vertrag', 'Rechnungsdaten', 'Beträge', 'Prüfen & buchen']
const STEP_HELP = ['invoice.abschlag.projekt_vertrag', 'invoice.abschlag.rechnungsdaten', 'invoice.abschlag.betraege', 'invoice.abschlag.pruefen'] as const

interface DraftResume { id: number; projectId: number | null; contractId: number | null; projectLabel: string; contractLabel: string; d1Pct: number; d2Pct: number; d1Reason: string | null; d2Reason: string | null; cashDiscPct: number; cashDiscDays: number }

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Abschlagsrechnung (UI-Pilot 2026-09).
 *
 * Vorher: vier gleich breite Knoepfe unter jedem Schritt (Abbrechen, das den
 * Entwurf loeschte, stand gleichrangig neben „Jetzt buchen"), die Leiste
 * scrollte mit weg, „Jetzt buchen" wirkte ohne Rueckfrage und ohne Recht,
 * und zwei Fehler kosteten Daten: Neuladen loeschte den Entwurf, und ein
 * fortgesetzter Entwurf ueberschrieb Rechnungsdaten und E-Rechnungsfelder
 * (Leitweg-ID, Bestellnummer) mit leeren Werten, weil sie nie geladen wurden.
 *
 * Jetzt:
 *  - Schritte mit sprechenden Namen, auf dem Handy „Schritt 2 von 4";
 *  - eine feste Aktionsleiste: links Abbrechen, rechts Zurueck ·
 *    Entwurf speichern · Weiter bzw. Jetzt buchen (als einzige gefuellt);
 *  - Fortsetzen laedt den ganzen Entwurf vom Server (`resumeId`, auch nach
 *    Neuladen ueber `?draftId=` in der URL);
 *  - Buchen nur mit `invoices.book` und nach Bestaetigung; PDF/XML nur mit
 *    den jeweiligen Rechten;
 *  - Abbrechen fragt bei einem neuen Entwurf, ob er bleiben soll.
 */
export function AbschlagWizard({ resumeId, initialDraft, initialProjectId, initialProjectLabel, onPrefillConsumed, onDraftCreated, onExit }: {
  resumeId?: number
  /** Veraltet: Entwurf aus der Liste — es zaehlt nur die ID, geladen wird vom Server. */
  initialDraft?: DraftResume
  initialProjectId?: number
  initialProjectLabel?: string
  onPrefillConsumed?: () => void
  /** Neuer Entwurf angelegt — die Seite schreibt die ID in die URL. */
  onDraftCreated?: (id: number) => void
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

  // Step 0 fields
  const [projectId,    setProjectId]    = useState<number | null>(null)
  const [projectLabel, setProjectLabel] = useState('')
  const [companyId,    setCompanyId]    = useState<number | null>(null)
  const [contractId,   setContractId]   = useState<number | null>(null)
  const [contractLabel, setContractLabel] = useState('')
  const [contractsForProject, setContractsForProject] = useState<Array<{ ID: number; ABBR: string; NAME: string }>>([])
  const [employeeId,   setEmployeeId]   = useState(() => String(useAuthStore.getState().employeeId ?? ''))
  const [changeEmployee, setChangeEmployee] = useState(false)

  // Step 1 fields
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

  // Step 2
  const [proposal,  setProposal]  = useState<BillingProposal | null>(null)
  const [perfInput, setPerfInput] = useState('')
  const [tecList,   setTecList]   = useState<TecEntry[]>([])
  const [selected,  setSelected]  = useState<Set<number>>(new Set())
  const [hasBt2,    setHasBt2]    = useState(false)

  // Step 3: discounts
  const [showDiscounts,  setShowDiscounts]  = useState(false)
  const [d1Pct,          setD1Pct]          = useState('')
  const [d1Reason,       setD1Reason]       = useState('')
  const [d2Pct,          setD2Pct]          = useState('')
  const [d2Reason,       setD2Reason]       = useState('')
  const [showSkonto,     setShowSkonto]     = useState(false)
  const [cashDiscPct,    setCashDiscPct]    = useState('')
  const [cashDiscDays,   setCashDiscDays]   = useState('')

  // Sicherheitseinbehalt (Phase 1)
  const [seEnabled,      setSeEnabled]      = useState(false)
  const [sePct,          setSePct]          = useState('')
  const [seBasis,        setSeBasis]        = useState<'BRUTTO' | 'NETTO'>('BRUTTO')

  const draftIdRef = useRef<number | null>(null)
  useEffect(() => { draftIdRef.current = draftId }, [draftId])

  // Fortsetzen: den ganzen Entwurf vom Server holen. Vorher kamen nur
  // Projekt, Vertrag, Nachlaesse und Skonto aus der Liste mit — Schritt 1
  // schickte dann das heutige Datum und leere E-Rechnungsfelder zurueck und
  // ueberschrieb, was gespeichert war.
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
    Promise.all([getPartialPayment(resumeTarget), getPpBillingProposal(resumeTarget).catch(() => null)])
      .then(([res, prop]) => {
        if (cancelled) return
        const { pp, project, contract } = res.data
        const label = (x?: { ABBR: string | null; NAME: string | null } | null) =>
          x ? [x.ABBR, x.NAME].filter(Boolean).join(' – ') : ''
        if (pp.STATUS_ID !== 1) {
          setMsg({ text: 'Diese Abschlagsrechnung ist bereits gebucht und lässt sich nicht mehr bearbeiten.', type: 'error' })
          setLoadingResume(false)
          return
        }
        setDraftId(pp.ID)
        setProjectId(pp.PROJECT_ID); setProjectLabel(label(project) || initialDraft?.projectLabel || '')
        setContractId(pp.CONTRACT_ID); setContractLabel(label(contract) || initialDraft?.contractLabel || '')
        if (pp.ADVANCE_INVOICE_DATE) setDetDate(pp.ADVANCE_INVOICE_DATE.slice(0, 10))
        if (pp.DUE_DATE) setDueDate(pp.DUE_DATE.slice(0, 10))
        setBpStart(pp.BILLING_PERIOD_START?.slice(0, 10) ?? '')
        setBpFinish(pp.BILLING_PERIOD_FINISH?.slice(0, 10) ?? '')
        setComment(pp.COMMENT ?? '')
        setBuyerRef(pp.BUYER_REFERENCE ?? '')
        setOrderRef(pp.BUYER_ORDER_REFERENCE ?? '')
        setAccountingRef(pp.BUYER_ACCOUNTING_REFERENCE ?? '')
        setRemittance(pp.REMITTANCE_INFORMATION ?? '')
        if (pp.VAT_CATEGORY) setVatCategory(pp.VAT_CATEGORY)
        setVatExemptCode(pp.VAT_EXEMPTION_REASON_CODE ?? '')
        setVatExemptText(pp.VAT_EXEMPTION_REASON_TEXT ?? '')
        if ((pp.DISCOUNT_1_PERCENT ?? 0) > 0) { setShowDiscounts(true); setD1Pct(String(pp.DISCOUNT_1_PERCENT)) }
        if ((pp.DISCOUNT_2_PERCENT ?? 0) > 0) setD2Pct(String(pp.DISCOUNT_2_PERCENT))
        setD1Reason(pp.DISCOUNT_1_REASON ?? ''); setD2Reason(pp.DISCOUNT_2_REASON ?? '')
        if ((pp.CASH_DISCOUNT_PERCENT ?? 0) > 0) { setShowSkonto(true); setCashDiscPct(String(pp.CASH_DISCOUNT_PERCENT)) }
        if ((pp.CASH_DISCOUNT_DAYS ?? 0) > 0) setCashDiscDays(String(pp.CASH_DISCOUNT_DAYS))
        if (pp.SE_PERCENT != null) { setSeEnabled(true); setSePct(String(pp.SE_PERCENT)); setSeBasis(pp.SE_BASIS === 'NETTO' ? 'NETTO' : 'BRUTTO') }
        if (prop) setProposal(prop.data)
        setStep(1)
        setLoadingResume(false)
      })
      .catch((e: Error) => { if (!cancelled) { setMsg({ text: e.message, type: 'error' }); setLoadingResume(false) } })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cache COMPANY_ID from project search results for lookup on select
  const projectResultsRef = useRef<Map<number, number | null>>(new Map())
  // Cache contract skonto defaults for pre-population
  const contractSkontoRef = useRef<Map<number, { pct: number | null; days: number | null }>>(new Map())
  // Cache contract SE defaults for pre-population
  const contractSeRef = useRef<Map<number, { enabled: boolean; pct: number | null; basis: 'BRUTTO' | 'NETTO' }>>(new Map())

  // Beim Schliessen/Neuladen nur nachfragen, nichts loeschen. Frueher ging
  // hier sofort ein DELETE raus — noch vor der Antwort auf die Rueckfrage,
  // und auch bei einem fortgesetzten Entwurf.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!draftIdRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

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
        contractSeRef.current.set(c.ID, {
          enabled: !!c.SE_ENABLED,
          pct:     c.SE_PERCENT ?? null,
          basis:   (c.SE_BASIS === 'NETTO' ? 'NETTO' : 'BRUTTO') as 'BRUTTO' | 'NETTO',
        })
      })
      // Beim Fortsetzen steht der Vertrag schon fest — nicht ueberschreiben.
      if (draftIdRef.current) return
      if (list.length === 1) {
        setContractId(list[0].ID)
        setContractLabel(`${list[0].ABBR} – ${list[0].NAME}`)
        // Pre-fill SE from contract when auto-selected
        const se = contractSeRef.current.get(list[0].ID)
        if (se?.enabled) {
          setSeEnabled(true)
          if (se.pct != null) setSePct(String(se.pct))
          setSeBasis(se.basis)
        }
      } else {
        setContractId(null); setContractLabel('')
      }
    }).catch(() => {})
  }, [projectId])

  const { data: empData } = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const employees = empData?.data ?? []
  const employee  = employees.find(e => String(e.ID) === employeeId)

  // ── Berechnung Schritt 4 (eine Stelle statt dreier Kopien) ─────────────────
  function totals() {
    const base = proposal?.total_amount_net ?? 0
    const vatPct = Number(proposal?.vat_percent ?? 0)
    const d1 = showDiscounts ? (Number(d1Pct) || 0) : 0
    const d2 = showDiscounts ? (Number(d2Pct) || 0) : 0
    const d1Amt = r2(base * d1 / 100)
    const d2Amt = r2((base - d1Amt) * d2 / 100)
    const totalDisc = r2(d1Amt + d2Amt)
    const cdPct  = showSkonto ? (Number(cashDiscPct) || 0) : 0
    const cdDays = showSkonto ? (Number(cashDiscDays) || 0) : 0
    const cdAmt  = r2((base - totalDisc) * cdPct / 100)
    const netAfter   = r2(base - totalDisc - cdAmt)
    const taxAfter   = r2(netAfter * vatPct / 100)
    const grossAfter = r2(netAfter + taxAfter)
    const sePctNum   = seEnabled ? (Number(sePct) || 0) : 0
    const seBasisAmt = seEnabled ? (seBasis === 'BRUTTO' ? grossAfter : netAfter) : 0
    const seAmt      = r2(seBasisAmt * sePctNum / 100)
    const payable    = r2(grossAfter - seAmt)
    return { base, vatPct, d1, d2, d1Amt, d2Amt, totalDisc, cdPct, cdDays, cdAmt, netAfter, taxAfter, grossAfter, sePctNum, seBasisAmt, seAmt, payable }
  }

  function step3Body() {
    const t = totals()
    return {
      discount_1_percent:    showDiscounts ? t.d1 : 0,
      discount_1_reason:     showDiscounts ? (d1Reason.trim() || null) : null,
      discount_2_percent:    showDiscounts ? t.d2 : 0,
      discount_2_reason:     showDiscounts ? (d2Reason.trim() || null) : null,
      total_discounts:       showDiscounts ? t.totalDisc : 0,
      cash_discount_percent: showSkonto ? t.cdPct : 0,
      cash_discount_days:    showSkonto ? t.cdDays : 0,
      cash_discount_amount:  showSkonto ? t.cdAmt : 0,
      se_percent:            seEnabled ? t.sePctNum : null,
      se_basis:              seEnabled ? seBasis : null,
      se_basis_amt:          seEnabled ? t.seBasisAmt : null,
      se_amount:             seEnabled ? t.seAmt : null,
    }
  }

  function step1Body() {
    return {
      advance_invoice_date:  detDate  || undefined,
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

  // ── mutations ────────────────────────────────────────────────────────────────

  const initMut = useMutation({
    mutationFn: initPartialPayment,
    onSuccess: async (res) => { setDraftId(res.id); onDraftCreated?.(res.id); setMsg(null); setStep(1) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof patchPartialPayment>[1] }) =>
      patchPartialPayment(id, body),
    onSuccess: async () => {
      if (!draftId) return
      setMsg(null)
      const [prop, tec] = await Promise.all([getPpBillingProposal(draftId), getPpTec(draftId)])
      setProposal(prop.data)
      setPerfInput(prev => prev !== '' ? prev : String(prop.data.performance_amount ?? ''))
      setTecList(tec.data)
      setHasBt2(tec.hasBt2 ?? tec.data.length > 0)
      // Ein fortgesetzter Entwurf behaelt seine Auswahl; ohne Zuordnung ist
      // wie bisher alles vorgewaehlt.
      const assigned = tec.data.filter(t => t.ASSIGNED)
      setSelected(prev => prev.size > 0 ? prev : new Set((assigned.length ? assigned : tec.data).map(t => t.ID)))
      setStep(2)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const perfMut = useMutation({
    mutationFn: ({ id, amount }: { id: number; amount: number }) => putPpPerformance(id, amount),
    onSuccess: (res) => setProposal(res.data),
    onError:   (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const tecMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof postPpTec>[1] }) =>
      postPpTec(id, body),
    onSuccess: (res) => setProposal(res.data),
    onError:   (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const bookMut = useMutation({
    mutationFn: async (id: number) => {
      await patchPartialPayment(id, step3Body())
      return bookPartialPayment(id)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      setBookOpen(false)
      toast.success('Abschlagsrechnung gebucht')
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
      if (!draftId) throw new Error('Keine Abschlags-ID')
      return bookPartialPaymentForce(draftId)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      setValidationOpen(false)
      toast.success('Abschlagsrechnung trotz Hinweisen gebucht')
      draftIdRef.current = null
      onExit?.()
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: deletePartialPayment,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partial-payments'] })
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
    leave()
  }

  function goToStep(i: number) {
    setMsg(null)
    setStep(i)
  }

  function clearDraftState() {
    setDraftId(null)
    setProposal(null); setPerfInput(''); setTecList([]); setSelected(new Set()); setHasBt2(false)
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
    })
  }

  function submitStep1() {
    if (!draftId) return
    setMsg(null)
    patchMut.mutate({ id: draftId, body: step1Body() })
  }

  async function saveStep2() {
    if (!draftId) return
    await perfMut.mutateAsync({ id: draftId, amount: Number(perfInput) })
    if (hasBt2) {
      const orig = new Set(tecList.filter(t => t.ASSIGNED).map(t => t.ID))
      const ids_assign   = tecList.filter(t =>  selected.has(t.ID) && !orig.has(t.ID)).map(t => t.ID)
      const ids_unassign = tecList.filter(t => !selected.has(t.ID) &&  orig.has(t.ID)).map(t => t.ID)
      await tecMut.mutateAsync({ id: draftId, body: { ids_assign, ids_unassign } })
      setTecList(prev => prev.map(t => ({ ...t, ASSIGNED: selected.has(t.ID) })))
    }
  }

  async function handleWeiterStep2() {
    setMsg(null)
    try { await saveStep2(); setStep(3) } catch { /* onError handlers set msg */ }
  }

  const [savingDraft, setSavingDraft] = useState(false)
  async function saveDraft() {
    if (!draftId) return
    setSavingDraft(true); setMsg(null)
    try {
      if (step === 1) await patchPartialPayment(draftId, step1Body())
      if (step === 2) await saveStep2()
      if (step === 3) await patchPartialPayment(draftId, step3Body())
      setSavedExplicitly(true)
      void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      toast.success('Entwurf gespeichert')
    } catch (e) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally {
      setSavingDraft(false)
    }
  }

  async function previewPdf() {
    if (!draftId) return
    await patchPartialPayment(draftId, step3Body())
    openPpPdf(draftId)
  }

  const singleContract = contractsForProject.length === 1
  const busy = initMut.isPending || patchMut.isPending || perfMut.isPending || tecMut.isPending || bookMut.isPending || savingDraft
  const einvoiceFilled = [buyerRef, orderRef, accountingRef, remittance].filter(v => v.trim()).length + (vatCategory !== 'S' ? 1 : 0)

  // ── Aktionsleiste ───────────────────────────────────────────────────────────

  function primaryAction() {
    if (step === 0) return { label: initMut.isPending ? 'Legt Entwurf an …' : 'Weiter', run: submitStep0, icon: ChevronRight }
    if (step === 1) return { label: patchMut.isPending ? 'Speichert …' : 'Weiter', run: submitStep1, icon: ChevronRight }
    if (step === 2) return { label: perfMut.isPending || tecMut.isPending ? 'Speichert …' : 'Weiter', run: () => void handleWeiterStep2(), icon: ChevronRight }
    if (canBook)    return { label: 'Jetzt buchen', run: () => setBookOpen(true), icon: Check }
    return { label: savingDraft ? 'Speichert …' : 'Entwurf speichern', run: () => void saveDraft(), icon: Check }
  }
  const primary = primaryAction()
  const PrimaryIcon = primary.icon
  const showDraftSave = step >= 1 && !(step === 3 && !canBook)

  const actionBar = (
    <ActionBar
      status={step >= 1 && draftId ? (savedExplicitly ? 'Entwurf gespeichert' : 'Entwurf – noch nicht gebucht') : undefined}
      secondary={narrow ? (
        step >= 1 ? (
          <RowMenu label="Weitere Aktionen" triggerClassName="btn-secondary iw-more">
            {showDraftSave && <button type="button" role="menuitem" className="row-menu-item" onClick={() => void saveDraft()}>Entwurf speichern</button>}
            {step === 3 && canPdf && <button type="button" role="menuitem" className="row-menu-item" onClick={() => void previewPdf()}>PDF-Vorschau</button>}
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
    <div className="wizard-wrap iw-root">
      <StepIndicator steps={STEPS} current={step} onStepClick={i => void goToStep(i)} compactOnMobile />

      {/* Schritt 1: Projekt & Vertrag */}
      {step === 0 && (
        <div className="wizard-step-content iw-form">
          {stepTitle}
          <Autocomplete
            label="Projekt*" htmlId="pp-project"
            value={projectLabel}
            onChange={setProjectLabel}
            onSelect={(id, label) => {
              const pid = Number(id)
              if (draftId && pid !== projectId) {
                deletePartialPayment(draftId).catch(() => {})
                clearDraftState()
              }
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
              <label htmlFor="pp-contract-ro">Vertrag</label>
              <input id="pp-contract-ro" readOnly value={contractLabel} className="iw-readonly" />
              <p className="form-field-hint">Das Projekt hat nur diesen Vertrag.</p>
            </div>
          ) : (
            <Autocomplete
              label="Vertrag*" htmlId="pp-contract"
              value={contractLabel}
              onChange={setContractLabel}
              onSelect={(id, label) => {
                if (draftId && Number(id) !== contractId) {
                  deletePartialPayment(draftId).catch(() => {})
                  clearDraftState()
                }
                const cid = Number(id)
                setContractId(cid); setContractLabel(label)
                // Pre-fill SE from contract
                const se = contractSeRef.current.get(cid)
                if (se?.enabled) {
                  setSeEnabled(true)
                  if (se.pct != null) setSePct(String(se.pct))
                  setSeBasis(se.basis)
                }
              }}
              search={async q => {
                if (!projectId) return []
                const res = await searchContracts(projectId, q)
                res.data.forEach(c => {
                  contractSkontoRef.current.set(c.ID, { pct: c.CASH_DISCOUNT_PERCENT ?? null, days: c.CASH_DISCOUNT_DAYS ?? null })
                  contractSeRef.current.set(c.ID, {
                    enabled: !!c.SE_ENABLED,
                    pct:     c.SE_PERCENT ?? null,
                    basis:   (c.SE_BASIS === 'NETTO' ? 'NETTO' : 'BRUTTO') as 'BRUTTO' | 'NETTO',
                  })
                })
                return res.data.map(c => ({ id: c.ID, label: `${c.ABBR} – ${c.NAME}` }))
              }}
              placeholder={projectId ? 'Vertrag suchen …' : 'Erst Projekt wählen'}
            />
          )}
          {changeEmployee ? (
            <div className="form-group">
              <label htmlFor="pp-emp">Erstellt von*</label>
              <select id="pp-emp" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
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
            <FormField label="Rechnungsdatum" id="ppd"  type="date" value={detDate}  onChange={e => setDetDate(e.target.value)} />
            <FormField
              label="Fällig am" id="ppdd" type="date"
              value={dueDate} onChange={e => setDueDate(e.target.value)}
              hint={paymentTermDays !== null ? `Zahlungsziel: ${paymentTermDays} Tage ab Rechnungsdatum` : undefined}
            />
          </div>
          <div className="form-row">
            <FormField label="Leistungszeitraum von" id="ppbs" type="date" value={bpStart}  onChange={e => setBpStart(e.target.value)} />
            <FormField label="bis"                   id="ppbf" type="date" value={bpFinish} onChange={e => setBpFinish(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="pp-comment">Kommentar (erscheint auf der Rechnung)</label>
            <textarea id="pp-comment" className="iw-textarea" rows={2} value={comment} onChange={e => setComment(e.target.value)} />
          </div>

          {/* E-Rechnungs-Felder (BT-10/13/19/83) */}
          <Disclosure
            title="E-Rechnungs-Detailfelder"
            help={<HelpHint id="einvoice.detailfelder" />}
            hint={einvoiceFilled ? `${einvoiceFilled} ausgefüllt` : 'optional'}
            defaultOpen={einvoiceFilled > 0}
          >
            <div className="iw-einvoice">
              <FormField label="Käuferreferenz / Leitweg-ID" id="pp-buyer-ref"
                value={buyerRef} onChange={e => setBuyerRef(e.target.value)}
                hint="Nur bei öffentlichen Auftraggebern Pflicht." />
              <FormField label="Bestellnummer des Käufers" id="pp-order-ref"
                value={orderRef} onChange={e => setOrderRef(e.target.value)} />
              <FormField label="Kostenstelle" id="pp-acc-ref"
                value={accountingRef} onChange={e => setAccountingRef(e.target.value)} />
              <div className="form-group">
                <label htmlFor="pp-paymeans">Zahlungsart</label>
                <select id="pp-paymeans" value={paymentMeansId} onChange={e => setPmGewaehlt(e.target.value)}>
                  <option value="">— keine Angabe —</option>
                  {paymentMeansList.map(pm => <option key={pm.ID} value={pm.ID}>{pm.NAME}</option>)}
                </select>
              </div>
              <FormField label="Verwendungszweck" id="pp-remit"
                value={remittance} onChange={e => setRemittance(e.target.value)} />

              <div className="form-group">
                <label htmlFor="pp-vatcat">Umsatzsteuer-Kategorie</label>
                <select id="pp-vatcat" value={vatCategory} onChange={e => setVatCategory(e.target.value as VatCategory)}>
                  {(Object.keys(VAT_CATEGORY_LABELS) as VatCategory[]).map(k => (
                    <option key={k} value={k}>{VAT_CATEGORY_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              {vatCategory !== 'S' && (
                <>
                  <FormField label="Begründung Code (optional)" id="pp-exempt-code"
                    value={vatExemptCode} onChange={e => setVatExemptCode(e.target.value)} />
                  <div className="form-group">
                    <label htmlFor="pp-exempt-text">Begründungstext</label>
                    <textarea id="pp-exempt-text" className="iw-textarea" rows={2} value={vatExemptText} onChange={e => setVatExemptText(e.target.value)}
                      placeholder="Leer lassen für Standardtext" />
                  </div>
                </>
              )}
            </div>
          </Disclosure>

          <AnlagenSection base="partial-payments" docId={draftId} />

          <Message text={msg?.text ?? null} type={msg?.type} />
        </div>
      )}

      {/* Schritt 3: Beträge */}
      {step === 2 && (() => {
        const perfAmt        = perfInput !== '' ? Number(perfInput) : (proposal?.performance_amount ?? 0)
        const selectedTecSum = tecList.filter(t => selected.has(t.ID)).reduce((s, t) => s + (t.HOURLY_RATE_TOTAL ?? 0), 0)
        const liveNet        = perfAmt + selectedTecSum
        const vatFactor      = 1 + (proposal?.vat_percent ?? 0) / 100
        const liveGross      = liveNet * vatFactor
        const suggested      = proposal?.performance_suggested ?? null
        return (
          <div className="wizard-step-content iw-form">
            {stepTitle}
            {proposal && (
              <div className="billing-proposal-box">
                <div className="bp-row">
                  <span>Vorschlag aus dem Leistungsstand</span>
                  <strong>{money(suggested)}</strong>
                </div>
                <div className="bp-row"><span>Leistungsbetrag (netto)</span><strong>{money(perfAmt)}</strong></div>
                {hasBt2 && <div className="bp-row"><span>Buchungen nach Aufwand (ausgewählt)</span><strong>{money(selectedTecSum)}</strong></div>}
                {/* Vorher „Netto gesamt" — die Nebenkosten rechnet der Server
                    aber erst im naechsten Schritt dazu. */}
                <div className="bp-row total"><span>Netto ohne Nebenkosten (vorläufig)</span><strong>{money(liveNet)}</strong></div>
                <div className="bp-row"><span>Brutto ohne Nebenkosten (vorläufig)</span><strong>{money(liveGross)}</strong></div>
              </div>
            )}
            <div className="iw-perf">
              <div className="form-group">
                <label htmlFor="pppf">Leistungsbetrag (netto)</label>
                <AmountInput id="pppf" value={perfInput} onChange={setPerfInput} />
              </div>
              {suggested != null && Number(perfInput) !== suggested && (
                <button type="button" className="btn-secondary" onClick={() => setPerfInput(String(suggested))}>
                  Vorschlag übernehmen ({fmtEur(suggested)})
                </button>
              )}
            </div>
            {hasBt2 && (
              <BuchungsauswahlTable tecList={tecList} selected={selected} setSelected={setSelected} />
            )}
            <Message text={msg?.text ?? null} type={msg?.type} />
          </div>
        )
      })()}

      {/* Schritt 4: Prüfen & buchen */}
      {step === 3 && (() => {
        const t = totals()
        return (
          <div className="wizard-step-content iw-form">
            {stepTitle}

            {/* Discount section */}
            <div className="iw-discounts">
              <p className="iw-section-title">Nachlässe, Skonto und Sicherheitseinbehalt</p>
              <label className="iw-check">
                <input type="checkbox" checked={showDiscounts} onChange={e => setShowDiscounts(e.target.checked)} />
                Nachlässe angeben
              </label>
              {showDiscounts && (
                <div className="iw-sub">
                  <div className="iw-line">
                    <label htmlFor="pp-d1" className="iw-line-label">Nachlass I (%)</label>
                    <input id="pp-d1" type="text" inputMode="decimal" className="iw-small" value={d1Pct}
                      onChange={e => { const v = e.target.value.replace(',', '.'); setD1Pct(v); if (!v) { setD2Pct(''); setD2Reason('') } }}
                      placeholder="z. B. 3" />
                    <input type="text" aria-label="Bezeichnung Nachlass I" className="iw-grow" value={d1Reason} onChange={e => setD1Reason(e.target.value)}
                      placeholder="Bezeichnung (optional)" />
                    {d1Pct && <span className="iw-amount">= {fmtEur(t.d1Amt)}</span>}
                  </div>
                  {d1Pct && (
                    <div className="iw-line">
                      <label htmlFor="pp-d2" className="iw-line-label">Nachlass II (%)</label>
                      <input id="pp-d2" type="text" inputMode="decimal" className="iw-small" value={d2Pct}
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
                    <label htmlFor="pp-cd" className="iw-line-label">Skonto (%)</label>
                    <input id="pp-cd" type="text" inputMode="decimal" className="iw-small" value={cashDiscPct}
                      onChange={e => setCashDiscPct(e.target.value.replace(',', '.'))} placeholder="z. B. 2" />
                    <label htmlFor="pp-cdd" className="iw-line-label">innerhalb (Tage)</label>
                    <input id="pp-cdd" type="text" inputMode="numeric" className="iw-small" value={cashDiscDays}
                      onChange={e => setCashDiscDays(e.target.value)} placeholder="z. B. 14" />
                    {t.cdAmt > 0 && <span className="iw-amount">= {fmtEur(t.cdAmt)}</span>}
                  </div>
                </div>
              )}
              <div className="iw-check-row">
                <label className="iw-check">
                  <input type="checkbox" checked={seEnabled} onChange={e => setSeEnabled(e.target.checked)} />
                  Sicherheitseinbehalt einbehalten
                </label>
                <HelpHint id="invoice.sicherheitseinbehalt" />
              </div>
              {seEnabled && (
                <div className="iw-sub">
                  <div className="iw-line">
                    <label htmlFor="pp-se" className="iw-line-label">Prozent (%)</label>
                    <input id="pp-se" type="text" inputMode="decimal" className="iw-small" value={sePct}
                      onChange={e => setSePct(e.target.value.replace(',', '.'))} placeholder="z. B. 5" />
                    <span className="iw-line-label">vom</span>
                    <label className="iw-radio"><input type="radio" checked={seBasis === 'BRUTTO'} onChange={() => setSeBasis('BRUTTO')} /> Brutto</label>
                    <label className="iw-radio"><input type="radio" checked={seBasis === 'NETTO'} onChange={() => setSeBasis('NETTO')} /> Netto</label>
                    {t.seAmt > 0 && <span className="iw-amount">= {fmtEur(t.seAmt)}</span>}
                  </div>
                </div>
              )}
            </div>

            {proposal && (
              <div className="billing-proposal-box">
                <div className="bp-row"><span>Leistungsbetrag netto</span><strong>{money(proposal.performance_amount)}</strong></div>
                <div className="bp-row"><span>Buchungen netto</span><strong>{money(proposal.bookings_sum)}</strong></div>
                <div className="bp-row"><span>Nebenkosten netto</span><strong>{money(proposal.amount_extras_net)}</strong></div>
                <div className="bp-row"><span>Zwischensumme netto</span><strong>{money(t.base)}</strong></div>
                {t.totalDisc > 0 && <div className="bp-row iw-minus"><span>./. Nachlässe</span><strong>− {fmtEur(t.totalDisc)}</strong></div>}
                {t.cdAmt > 0 && <div className="bp-row iw-minus"><span>./. Skonto</span><strong>− {fmtEur(t.cdAmt)}</strong></div>}
                <div className="bp-row total"><span>Netto gesamt{t.totalDisc > 0 || t.cdAmt > 0 ? ' (nach Abzügen)' : ''}</span><strong>{money(t.netAfter)}</strong></div>
                {t.vatPct > 0 && <div className="bp-row"><span>zzgl. {t.vatPct}&thinsp;% MwSt.</span><strong>{money(t.taxAfter)}</strong></div>}
                <div className="bp-row total"><span>Brutto gesamt</span><strong>{money(t.grossAfter)}</strong></div>
                {seEnabled && t.seAmt > 0 && (
                  <>
                    <div className="bp-row iw-minus"><span>./. Sicherheitseinbehalt {t.sePctNum}&thinsp;% vom {seBasis === 'BRUTTO' ? 'Brutto' : 'Netto'}</span><strong>− {fmtEur(t.seAmt)}</strong></div>
                    <div className="bp-row total"><span>Sofort fällig</span><strong>{money(t.payable)}</strong></div>
                  </>
                )}
              </div>
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
                    <button type="button" role="menuitem" className="row-menu-item" onClick={() => void downloadPpEinvoice(draftId, null, 'ubl')}>XRechnung (UBL)</button>
                    <button type="button" role="menuitem" className="row-menu-item" onClick={() => void downloadPpEinvoice(draftId, null, 'cii')}>ZUGFeRD (CII)</button>
                  </RowMenu>
                )}
              </div>
            )}
            <p className="iw-note">
              {canBook
                ? 'Nach dem Buchen ist die Abschlagsrechnung unveränderlich. Bis dahin bleibt sie ein Entwurf in der Rechnungsliste.'
                : 'Buchen darf in deinem Büro nur, wer das Recht dazu hat. Speichere den Entwurf – er bleibt in der Rechnungsliste.'}
            </p>
            <Message text={msg?.text ?? null} type={msg?.type} />
          </div>
        )
      })()}

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
          <button type="button" className="btn-primary" onClick={() => { setLeaveOpen(false); leave() }}>Entwurf behalten</button>
        </DialogFooter>
      </Modal>

      {/* Bestaetigung vor dem Buchen */}
      <Modal open={bookOpen} onClose={() => setBookOpen(false)} title="Abschlagsrechnung buchen?">
        <p className="guard-text">
          Brutto <strong>{fmtEur(totals().grossAfter)}</strong>{seEnabled && totals().seAmt > 0 ? <>, sofort fällig <strong>{fmtEur(totals().payable)}</strong></> : null}.
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
