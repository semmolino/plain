import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { FormField }    from '@/components/ui/FormField'
import { HelpHint }     from '@/components/ui/HelpHint'
import { ValidationModal } from '@/components/ui/ValidationModal'
import { AnlagenSection } from '@/components/rechnungen/AnlagenSection'
import {
  searchContracts,
  initInvoice, patchInvoice,
  getFinalInvoicePhases, saveFinalInvoicePhases,
  getFinalInvoiceDeductions, saveFinalInvoiceDeductions,
  bookFinalInvoice, bookFinalInvoiceForce, deleteInvoice,
  openInvoicePdf, downloadInvoiceEinvoice,
  fetchOpenSeForProject,
  VAT_CATEGORY_LABELS,
  type InvoiceType, type FinalPhase, type FinalDeduction, type FinalTotals,
  type OpenSeEntry, type VatCategory, type ValidationResult,
} from '@/api/rechnungen'
import { ApiRequestError } from '@/api/client'
import { fetchActiveEmployees, searchProjectsApi } from '@/api/projekte'
import { useAuthStore } from '@/store/authStore'
import { API_BASE }     from '@/api/client'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? v.slice(0, 10) : '—'
function todayIso() { return new Date().toISOString().slice(0, 10) }

const STEPS = ['Init', 'Details', 'Positionen', 'Abzüge', 'Buchen']

function StepIndicator({ step, onStepClick }: { step: number; onStepClick: (i: number) => void }) {
  return (
    <div className="wizard-steps">
      {STEPS.map((s, i) => (
        <div
          key={s}
          className={`wizard-step${i === step ? ' active' : i < step ? ' done' : ''}`}
          onClick={i < step ? () => onStepClick(i) : undefined}
          style={i < step ? { cursor: 'pointer' } : undefined}
        >{s}</div>
      ))}
    </div>
  )
}

interface DraftResume { id: number; projectId: number | null; contractId: number | null; projectLabel: string; contractLabel: string; d1Pct: number; d2Pct: number; d1Reason: string | null; d2Reason: string | null; cashDiscPct: number; cashDiscDays: number }

export function SchlussrechnungWizard({ initialDraft, initialProjectId, initialProjectLabel, onPrefillConsumed }: {
  initialDraft?: DraftResume
  initialProjectId?: number
  initialProjectLabel?: string
  onPrefillConsumed?: () => void
} = {}) {
  const qc = useQueryClient()
  const [step,         setStep]         = useState(0)
  const [draftId,      setDraftId]      = useState<number | null>(null)
  const [msg,          setMsg]          = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const isResumeRef = useRef(false)

  // Step 0
  const [projectId,           setProjectId]           = useState<number | null>(null)
  const [projectLabel,        setProjectLabel]        = useState('')
  const [contractId,          setContractId]          = useState<number | null>(null)
  const [contractLabel,       setContractLabel]       = useState('')
  const [contractsForProject, setContractsForProject] = useState<Array<{ ID: number; NAME_SHORT: string; NAME_LONG: string }>>([])
  const [employeeId,          setEmployeeId]          = useState(() => String(useAuthStore.getState().employeeId ?? ''))

  // Step 1
  const [detDate,  setDetDate]  = useState(todayIso())
  const [dueDate,  setDueDate]  = useState('')
  const [bpStart,  setBpStart]  = useState('')
  const [bpFinish, setBpFinish] = useState('')
  const [comment,  setComment]  = useState('')
  // E-Rechnungs-Felder
  const [showEinvoice,  setShowEinvoice]  = useState(false)
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
  const [seReleaseSel,  setSeReleaseSel]  = useState<Set<number>>(new Set())  // PP IDs to release

  const contractSkontoRef = useRef<Map<number, { pct: number | null; days: number | null }>>(new Map())
  const draftIdRef = useRef<number | null>(null)
  useEffect(() => { draftIdRef.current = draftId }, [draftId])

  // Resume existing draft passed from the invoice list
  useEffect(() => {
    if (!initialDraft) {
      if (initialProjectId && initialProjectLabel) {
        setProjectId(initialProjectId)
        setProjectLabel(initialProjectLabel)
        onPrefillConsumed?.()
      }
      return
    }
    isResumeRef.current = true
    setDraftId(initialDraft.id)
    setProjectId(initialDraft.projectId)
    setProjectLabel(initialDraft.projectLabel)
    setContractId(initialDraft.contractId)
    setContractLabel(initialDraft.contractLabel)
    if (initialDraft.d1Pct > 0) { setShowDiscounts(true); setD1Pct(String(initialDraft.d1Pct)) }
    if (initialDraft.d2Pct > 0) setD2Pct(String(initialDraft.d2Pct))
    if (initialDraft.d1Reason) setD1Reason(initialDraft.d1Reason)
    if (initialDraft.d2Reason) setD2Reason(initialDraft.d2Reason)
    if (initialDraft.cashDiscPct > 0) { setShowSkonto(true); setCashDiscPct(String(initialDraft.cashDiscPct)) }
    if (initialDraft.cashDiscDays > 0) setCashDiscDays(String(initialDraft.cashDiscDays))
    setStep(1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Warn on browser close and delete draft via keepalive
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      const id = draftIdRef.current
      if (!id) return
      e.preventDefault()
      e.returnValue = ''
      const token = useAuthStore.getState().token
      fetch(`${API_BASE}/invoices/${id}`, {
        method: 'DELETE', keepalive: true,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Load open Sicherheitseinbehalte (Phase 2)
  // Pre-select ALL by default since Schlussrechnung finalizes the project
  useEffect(() => {
    if (!projectId) { setOpenSeList([]); setSeReleaseSel(new Set()); return }
    fetchOpenSeForProject(projectId).then(r => {
      const list = r.data ?? []
      setOpenSeList(list)
      setSeReleaseSel(new Set(list.map(e => e.ID)))
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
      if (list.length === 1) {
        setContractId(list[0].ID)
        setContractLabel(`${list[0].NAME_SHORT} – ${list[0].NAME_LONG}`)
      } else {
        setContractId(null); setContractLabel('')
      }
    }).catch(() => {})
  }, [projectId])

  const { data: empData } = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const employees = empData?.data ?? []

  // ── path helper ───────────────────────────────────────────────────────────────
  // ID → phase map for path resolution
  const phaseMap = useMemo(() => new Map(phases.map(p => [p.ID, p])), [phases])
  // IDs that are someone's FATHER_ID — i.e. non-leaf (aggregation) nodes
  const parentIds = useMemo(() => new Set(phases.filter(p => p.FATHER_ID != null).map(p => Number(p.FATHER_ID))), [phases])

  function phaseSortPath(p: FinalPhase): string {
    const ancestors: string[] = []
    let cur: FinalPhase | undefined = p.FATHER_ID != null ? phaseMap.get(p.FATHER_ID) : undefined
    while (cur) {
      ancestors.unshift(cur.NAME_SHORT)
      cur = cur.FATHER_ID != null ? phaseMap.get(cur.FATHER_ID) : undefined
    }
    const leaf = `${p.NAME_SHORT}${p.NAME_LONG ? ' – ' + p.NAME_LONG : ''}`
    return ancestors.length ? `${ancestors.join(' > ')} > ${leaf}` : leaf
  }

  function phasePathLabel(p: FinalPhase): React.ReactNode {
    const ancestors: string[] = []
    let cur: FinalPhase | undefined = p.FATHER_ID != null ? phaseMap.get(p.FATHER_ID) : undefined
    while (cur) {
      ancestors.unshift(cur.NAME_SHORT)
      cur = cur.FATHER_ID != null ? phaseMap.get(cur.FATHER_ID) : undefined
    }
    return (
      <>
        {ancestors.length > 0 && (
          <span className="tree-name-long">{ancestors.join(' > ')} &gt; </span>
        )}
        <strong>{p.NAME_SHORT}</strong>
        {p.NAME_LONG && <span className="tree-name-long"> – {p.NAME_LONG}</span>}
      </>
    )
  }

  // ── mutations ────────────────────────────────────────────────────────────────

  const initMut = useMutation({
    mutationFn: initInvoice,
    onSuccess: (res) => { setDraftId(res.id); setMsg(null); setStep(1) },
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
      setStep(2)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const phasesMut = useMutation({
    mutationFn: ({ id, ids }: { id: number; ids: number[] }) =>
      saveFinalInvoicePhases(id, ids),
    onSuccess: async (res) => {
      setPhaseTotals({
        phaseTotal:      res.phaseTotal,
        deductionsTotal: res.deductionsTotal,
        totalNet:        res.totalNet,
        vatPercent:      res.vatPercent,
        taxAmountNet:    res.taxAmountNet,
        totalGross:      res.totalGross,
      })
      if (!draftId) return
      setMsg(null)
      const ded = await getFinalInvoiceDeductions(draftId)
      setDeductions(ded.data)
      setDeductAmounts(Object.fromEntries(
        ded.data.map(d => [d.ID, String(d.DEDUCTION_AMOUNT_NET ?? d.AMOUNT_NET ?? '')])
      ))
      setDedSelected(new Set(ded.data.filter(d => d.SELECTED).map(d => d.ID)))
      setDedWarn(null)
      setStep(3)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const dedMut = useMutation({
    mutationFn: ({ id, items }: { id: number; items: { partial_payment_id: number; deduction_amount_net: number }[] }) =>
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
      setMsg(null)
      setStep(4)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const bookMut = useMutation({
    mutationFn: async (id: number) => {
      const base = dedTotals?.totalNet ?? 0
      const d1 = showDiscounts ? (Number(d1Pct) || 0) : 0
      const d2 = showDiscounts ? (Number(d2Pct) || 0) : 0
      const d1Amt = Math.round(base * d1 / 100 * 100) / 100
      const d2Amt = Math.round((base - d1Amt) * d2 / 100 * 100) / 100
      const totalDiscounts = Math.round((d1Amt + d2Amt) * 100) / 100
      const cdPct  = showSkonto ? (Number(cashDiscPct) || 0) : 0
      const cdDays = showSkonto ? (Number(cashDiscDays) || 0) : 0
      const cdAmt  = Math.round((base - totalDiscounts) * cdPct / 100 * 100) / 100
      await patchInvoice(id, {
        discount_1_percent:   showDiscounts ? d1 : 0,
        discount_1_reason:    showDiscounts ? (d1Reason.trim() || null) : null,
        discount_2_percent:   showDiscounts ? d2 : 0,
        discount_2_reason:    showDiscounts ? (d2Reason.trim() || null) : null,
        total_discounts:      showDiscounts ? totalDiscounts : 0,
        cash_discount_percent: showSkonto ? cdPct : 0,
        cash_discount_days:    showSkonto ? cdDays : 0,
        cash_discount_amount:  showSkonto ? cdAmt : 0,
      })
      return bookFinalInvoice(id, { release_partial_payment_ids: Array.from(seReleaseSel) })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      setMsg({ text: 'Schlussrechnung gebucht ✅', type: 'success' })
      resetAll()
    },
    onError: (e: Error) => {
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
      if (!draftId) throw new Error('Keine Rechnungs-ID')
      return bookFinalInvoiceForce(draftId, { release_partial_payment_ids: Array.from(seReleaseSel) })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      setValidationOpen(false)
      setMsg({ text: 'Schlussrechnung notgebucht ⚠️', type: 'success' })
      resetAll()
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteInvoice,
    onSuccess: () => resetAll(),
    onError:   (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  // ── helpers ──────────────────────────────────────────────────────────────────

  function resetAll() {
    setStep(0); setDraftId(null); setProjectId(null); setProjectLabel('')
    setContractId(null); setContractLabel(''); setContractsForProject([])
    setEmployeeId('')
    setDetDate(todayIso()); setDueDate(''); setBpStart(''); setBpFinish(''); setComment('')
    setPhases([]); setPhaseChecked(new Set()); setPhaseTotals(null)
    setDeductions([]); setDeductAmounts({}); setDedSelected(new Set()); setDedTotals(null); setDedWarn(null)
    setShowDiscounts(false); setD1Pct(''); setD2Pct(''); setShowSkonto(false); setCashDiscPct(''); setCashDiscDays('')
    setOpenSeList([]); setSeReleaseSel(new Set())
    setMsg(null)
  }

  function clearDraftState() {
    setDraftId(null)
    setPhases([]); setPhaseChecked(new Set()); setPhaseTotals(null)
    setDeductions([]); setDeductAmounts({}); setDedSelected(new Set()); setDedTotals(null); setDedWarn(null)
  }

  function handleCancel() {
    if (isResumeRef.current) {
      setConfirmState({ title: 'Wizard abbrechen', message: 'Bearbeitung abbrechen?', onConfirm: resetAll })
    } else {
      setConfirmState({
        title: 'Entwurf löschen',
        message: 'Entwurf wirklich löschen und Wizard abbrechen?',
        onConfirm: () => { if (draftId) deleteMut.mutate(draftId); else resetAll() },
      })
    }
  }

  function goToStep(i: number) {
    setMsg(null)
    setStep(i)
  }

  function submitStep0() {
    setMsg(null)
    if (!projectId || !contractId || !employeeId) {
      setMsg({ text: 'Bitte alle Felder ausfüllen', type: 'error' }); return
    }
    if (draftId) { setStep(1); return }
    initMut.mutate({
      company_id: 0, employee_id: Number(employeeId),
      project_id: projectId, contract_id: contractId,
      invoice_type: 'schlussrechnung',
    })
  }

  function submitStep1() {
    if (!draftId) return
    setMsg(null)
    patchMut.mutate({ id: draftId, body: {
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
      vat_category:                vatCategory,
      vat_exemption_reason_code:   vatExemptCode.trim() || null,
      vat_exemption_reason_text:   vatExemptText.trim() || null,
    }})
  }

  function submitPhases() {
    if (!draftId) return
    setMsg(null)
    phasesMut.mutate({ id: draftId, ids: Array.from(phaseChecked) })
  }

  function submitDeductions() {
    if (!draftId) return
    setMsg(null)
    const items = Array.from(dedSelected).map(id => ({
      partial_payment_id:   id,
      deduction_amount_net: Number(deductAmounts[id] ?? 0),
    }))
    dedMut.mutate({ id: draftId, items })
  }

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
          `Hinweis: ${d.PARTIAL_PAYMENT_NUMBER ?? `Abschlag #${id}`} enthält Positionen, die in Schritt 2 (Positionen) nicht ausgewählt sind.`
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
        setDedWarn('Hinweis: Einige Abschlagsrechnungen enthalten Positionen, die in Schritt 2 (Positionen) nicht ausgewählt sind.')
      }
    }
  }

  const invType: InvoiceType = 'schlussrechnung'
  const singleContract = contractsForProject.length === 1

  const hiddenCount = phases.filter(p => {
    if (parentIds.has(p.ID)) return false            // don't count aggregation nodes
    if (p.CLOSED) return true
    const totalEarned = p.TOTAL_EARNED ?? 0
    const billedFinal = p.BILLED_FINAL ?? 0
    return totalEarned > 0 && billedFinal >= totalEarned
  }).length

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="wizard-wrap">
      <StepIndicator step={step} onStepClick={i => void goToStep(i)} />

      {/* Step 0 */}
      {step === 0 && (
        <div className="wizard-step-content">
          <p className="wizard-step-title">Projekt & Vertrag wählen</p>
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
              setProjectId(pid); setProjectLabel(label)
              setContractId(null); setContractLabel('')
            }}
            search={async q => {
              const res = await searchProjectsApi(q)
              return res.data.map(p => ({ id: p.ID, label: `${p.NAME_SHORT} – ${p.NAME_LONG}` }))
            }}
            placeholder="Projekt suchen …"
          />
          {singleContract ? (
            <div className="form-group">
              <label>Vertrag</label>
              <input readOnly value={contractLabel} style={{ background: 'rgba(17,24,39,0.04)' }} />
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
                return res.data.map(c => ({ id: c.ID, label: `${c.NAME_SHORT} – ${c.NAME_LONG}` }))
              }}
              placeholder={projectId ? 'Vertrag suchen …' : 'Erst Projekt wählen'}
            />
          )}
          <div className="form-group">
            <label>Mitarbeiter*</label>
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {employees.map(e => <option key={e.ID} value={e.ID}>{e.SHORT_NAME}: {e.FIRST_NAME} {e.LAST_NAME}</option>)}
            </select>
          </div>
          <Message text={msg?.text ?? null} type={msg?.type} />
          <div className="wizard-nav">
            <button className="btn-primary" onClick={submitStep0} disabled={initMut.isPending}>
              {initMut.isPending ? 'Erstelle …' : 'Weiter →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 1 */}
      {step === 1 && (
        <div className="wizard-step-content">
          <p className="wizard-step-title">Rechnungsdetails</p>
          <div className="form-row">
            <FormField label="Rechnungsdatum"   id="srd"  type="date" value={detDate}  onChange={e => setDetDate(e.target.value)} />
            <FormField label="Fälligkeitsdatum" id="srdd" type="date" value={dueDate}  onChange={e => setDueDate(e.target.value)} />
          </div>
          <div className="form-row">
            <FormField label="Leistungszeitraum von" id="srbs" type="date" value={bpStart}  onChange={e => setBpStart(e.target.value)} />
            <FormField label="bis"                   id="srbf" type="date" value={bpFinish} onChange={e => setBpFinish(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Kommentar</label>
            <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(17,24,39,0.10)', borderRadius: 12, fontSize: 15 }} />
          </div>

          {/* E-Rechnungs-Felder (BT-10/13/19/83) */}
          <div style={{ marginTop: 12, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <button type="button" onClick={() => setShowEinvoice(s => !s)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: '#374151', padding: 0 }}>
              {showEinvoice ? '▼' : '▶'} E-Rechnungs-Detailfelder
            </button>
            {showEinvoice && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <FormField label="Käuferreferenz / Leitweg-ID" id="sr-buyer-ref"
                  value={buyerRef} onChange={e => setBuyerRef(e.target.value)} />
                <FormField label="Bestellnummer des Käufers" id="sr-order-ref"
                  value={orderRef} onChange={e => setOrderRef(e.target.value)} />
                <FormField label="Kostenstelle" id="sr-acc-ref"
                  value={accountingRef} onChange={e => setAccountingRef(e.target.value)} />
                <FormField label="Verwendungszweck" id="sr-remit"
                  value={remittance} onChange={e => setRemittance(e.target.value)} />

                <div className="form-group">
                  <label>Umsatzsteuer-Kategorie</label>
                  <select value={vatCategory} onChange={e => setVatCategory(e.target.value as VatCategory)}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', width: '100%' }}>
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
                      <label>Begründungstext</label>
                      <textarea rows={2} value={vatExemptText} onChange={e => setVatExemptText(e.target.value)}
                        placeholder="Leer lassen für Standardtext"
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }} />
                    </div>
                  </>
                )}

                <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
                  Optional. Leitweg-ID nur bei öffentlichen Auftraggebern.
                </p>
              </div>
            )}
          </div>

          <AnlagenSection base="invoices" docId={draftId} />

          <Message text={msg?.text ?? null} type={msg?.type} />
          <div className="wizard-nav">
            <button onClick={handleCancel}>Abbrechen</button>
            <button onClick={() => void goToStep(0)}>← Zurück</button>
            <button className="btn-primary" onClick={submitStep1} disabled={patchMut.isPending}>
              {patchMut.isPending ? 'Speichert …' : 'Weiter →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Phases */}
      {step === 2 && (
        <div className="wizard-step-content">
          <p className="wizard-step-title">Abrechnungspositionen wählen</p>
          <div className="list-section table-scroll">
            <table className="master-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allPhasesChecked}
                      onChange={toggleAllPhases}
                      title="Alle auswählen / abwählen"
                    />
                  </th>
                  <th>Position</th>
                  <th className="num">Leistungsstand €</th>
                  <th className="num">Bereits abgerechnet €</th>
                  <th className="num">Dieser Rechnung €</th>
                </tr>
              </thead>
              <tbody>
                {selectablePhases.map(p => {
                  // Dieser Rechnung = TOTAL_EARNED minus only what's been invoiced via final invoices
                  // Abschlagsrechnungen are handled in Step 3 (Abzüge) and do NOT reduce this amount
                  const thisInvoice = Math.max(0, (p.TOTAL_EARNED ?? 0) - (p.BILLED_FINAL ?? 0))
                  const checked = phaseChecked.has(p.ID)
                  return (
                    <tr key={p.ID}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setPhaseChecked(prev => {
                              const next = new Set(prev)
                              if (next.has(p.ID)) next.delete(p.ID); else next.add(p.ID)
                              return next
                            })
                          }}
                        />
                      </td>
                      <td>{phasePathLabel(p)}</td>
                      <td className="num">{fmtEur(p.TOTAL_EARNED)}</td>
                      <td className="num">{fmtEur(p.ALREADY_BILLED)}</td>
                      <td className="num">{checked ? fmtEur(thisInvoice) : '—'}</td>
                    </tr>
                  )
                })}
                {!selectablePhases.length && (
                  <tr><td colSpan={5} className="empty-note">Keine ausstehenden Positionen</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {hiddenCount > 0 && (
            <p style={{ fontSize: 12, color: 'rgba(17,24,39,0.45)', marginTop: 6 }}>
              {hiddenCount} vollständig abgerechnete oder geschlossene {hiddenCount === 1 ? 'Position' : 'Positionen'} werden nicht angezeigt.
            </p>
          )}
          <Message text={msg?.text ?? null} type={msg?.type} />
          <div className="wizard-nav">
            <button onClick={handleCancel}>Abbrechen</button>
            <button onClick={() => void goToStep(1)}>← Zurück</button>
            <button className="btn-primary" onClick={submitPhases} disabled={phasesMut.isPending}>
              {phasesMut.isPending ? 'Speichert …' : 'Weiter →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Deductions */}
      {step === 3 && (
        <div className="wizard-step-content">
          <p className="wizard-step-title">Abschlagsrechnungen abziehen</p>
          {phaseTotals && (
            <div className="billing-proposal-box" style={{ marginBottom: 14 }}>
              <div className="bp-row"><span>Positionssumme Netto</span><strong>{fmtEur(phaseTotals.phaseTotal)}</strong></div>
            </div>
          )}
          {deductions.length === 0 && (
            <p className="empty-note">Keine offenen Abschlagsrechnungen für dieses Projekt.</p>
          )}
          {deductions.length > 0 && (
            <div className="list-section table-scroll">
              <table className="master-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={allDedChecked}
                        onChange={toggleAllDed}
                        title="Alle auswählen / abwählen"
                      />
                    </th>
                    <th>Nummer</th>
                    <th>Datum</th>
                    <th className="num">Betrag Netto €</th>
                    <th className="num">Abzug Netto €</th>
                  </tr>
                </thead>
                <tbody>
                  {deductions.map(d => (
                    <tr key={d.ID}>
                      <td>
                        <input type="checkbox" checked={dedSelected.has(d.ID)} onChange={() => toggleDed(d)} />
                      </td>
                      <td>{d.PARTIAL_PAYMENT_NUMBER ?? '—'}</td>
                      <td>{fmtDate(d.PARTIAL_PAYMENT_DATE)}</td>
                      <td className="num">{fmtEur(d.AMOUNT_NET)}</td>
                      <td>
                        <input
                          type="number" step="0.01"
                          value={dedSelected.has(d.ID) ? (deductAmounts[d.ID] ?? '') : ''}
                          disabled={!dedSelected.has(d.ID)}
                          onChange={e => setDeductAmounts(prev => ({ ...prev, [d.ID]: e.target.value }))}
                          style={{ width: 110, padding: '4px 6px', border: '1px solid rgba(17,24,39,0.12)', borderRadius: 6, fontSize: 13 }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {dedWarn && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, fontSize: 13, color: '#92400e' }}>
              ⚠ {dedWarn}
            </div>
          )}
          <Message text={msg?.text ?? null} type={msg?.type} />
          <div className="wizard-nav">
            <button onClick={handleCancel}>Abbrechen</button>
            <button onClick={() => void goToStep(2)}>← Zurück</button>
            <button className="btn-primary" onClick={submitDeductions} disabled={dedMut.isPending}>
              {dedMut.isPending ? 'Speichert …' : 'Weiter →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Book */}
      {step === 4 && (() => {
        const base = dedTotals?.totalNet ?? 0
        const d1 = showDiscounts ? (Number(d1Pct) || 0) : 0
        const d2 = showDiscounts ? (Number(d2Pct) || 0) : 0
        const d1Amt = Math.round(base * d1 / 100 * 100) / 100
        const d2Amt = Math.round((base - d1Amt) * d2 / 100 * 100) / 100
        const totalDisc = Math.round((d1Amt + d2Amt) * 100) / 100
        const cdPct  = showSkonto ? (Number(cashDiscPct) || 0) : 0
        const cdDays = showSkonto ? (Number(cashDiscDays) || 0) : 0
        const cdAmt  = Math.round((base - totalDisc) * cdPct / 100 * 100) / 100
        const netAfter = Math.round((base - totalDisc - cdAmt) * 100) / 100
        async function saveDiscountsAndPreview() {
          if (!draftId) return
          await patchInvoice(draftId, {
            discount_1_percent:   showDiscounts ? d1 : 0,
            discount_1_reason:    showDiscounts ? (d1Reason.trim() || null) : null,
            discount_2_percent:   showDiscounts ? d2 : 0,
            discount_2_reason:    showDiscounts ? (d2Reason.trim() || null) : null,
            total_discounts:      showDiscounts ? totalDisc : 0,
            cash_discount_percent: showSkonto ? cdPct : 0,
            cash_discount_days:    showSkonto ? cdDays : 0,
            cash_discount_amount:  showSkonto ? cdAmt : 0,
          })
          openInvoicePdf(draftId, { releasePpIds: Array.from(seReleaseSel) })
        }
        return (
        <div className="wizard-step-content">
          <p className="wizard-step-title">Schlussrechnung buchen</p>

          {/* Nachlässe und Skonto */}
          <div style={{ background: 'rgba(17,24,39,0.03)', border: '1px solid rgba(17,24,39,0.08)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
            <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Nachlässe und Skonto</p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={showDiscounts} onChange={e => setShowDiscounts(e.target.checked)} />
              Nachlässe angeben
            </label>
            {showDiscounts && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8, paddingLeft: 24 }}>
                <div className="form-group" style={{ flex: '1 1 120px', minWidth: 120, marginBottom: 0 }}>
                  <label style={{ fontSize: 12 }}>Nachlass I (%)</label>
                  <input type="number" step="0.01" min="0" max="100" value={d1Pct}
                    onChange={e => setD1Pct(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', border: '1px solid rgba(17,24,39,0.12)', borderRadius: 8, fontSize: 14 }} />
                </div>
                <div className="form-group" style={{ flex: '2 1 200px', minWidth: 160, marginBottom: 0 }}>
                  <label style={{ fontSize: 12 }}>Bezeichnung Nachlass I (optional)</label>
                  <input type="text" value={d1Reason} onChange={e => setD1Reason(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', border: '1px solid rgba(17,24,39,0.12)', borderRadius: 8, fontSize: 14 }}
                    placeholder="z. B. Planungsrabatt" />
                </div>
                <div className="form-group" style={{ flex: '1 1 120px', minWidth: 120, marginBottom: 0 }}>
                  <label style={{ fontSize: 12 }}>Nachlass II (% auf N I)</label>
                  <input type="number" step="0.01" min="0" max="100" value={d2Pct}
                    onChange={e => setD2Pct(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', border: '1px solid rgba(17,24,39,0.12)', borderRadius: 8, fontSize: 14 }} />
                </div>
                <div className="form-group" style={{ flex: '2 1 200px', minWidth: 160, marginBottom: 0 }}>
                  <label style={{ fontSize: 12 }}>Bezeichnung Nachlass II (optional)</label>
                  <input type="text" value={d2Reason} onChange={e => setD2Reason(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', border: '1px solid rgba(17,24,39,0.12)', borderRadius: 8, fontSize: 14 }}
                    placeholder="z. B. Treuerabatt" />
                </div>
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={showSkonto} onChange={e => {
                const checked = e.target.checked
                setShowSkonto(checked)
                if (checked && contractId) {
                  const cached = contractSkontoRef.current.get(contractId)
                  if (cached) {
                    setCashDiscPct(String(cached.pct ?? ''))
                    setCashDiscDays(String(cached.days ?? ''))
                  }
                }
              }} />
              Skonto angeben
            </label>
            {showSkonto && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8, paddingLeft: 24 }}>
                <div className="form-group" style={{ flex: '1 1 120px', minWidth: 120, marginBottom: 0 }}>
                  <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center' }}>
                    Skonto (%) <HelpHint id="invoice.skonto" />
                  </label>
                  <input type="number" step="0.01" min="0" max="100" value={cashDiscPct}
                    onChange={e => setCashDiscPct(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', border: '1px solid rgba(17,24,39,0.12)', borderRadius: 8, fontSize: 14 }} />
                </div>
                <div className="form-group" style={{ flex: '1 1 120px', minWidth: 120, marginBottom: 0 }}>
                  <label style={{ fontSize: 12 }}>Skonto-Tage</label>
                  <input type="number" step="1" min="0" value={cashDiscDays}
                    onChange={e => setCashDiscDays(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', border: '1px solid rgba(17,24,39,0.12)', borderRadius: 8, fontSize: 14 }} />
                </div>
              </div>
            )}
            {(showDiscounts || showSkonto) && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(17,24,39,0.08)', fontSize: 13 }}>
                {showDiscounts && d1 > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(17,24,39,0.6)' }}>
                    <span>Nachlass I ({d1} %)</span><span>– {fmtEur(d1Amt)}</span>
                  </div>
                )}
                {showDiscounts && d2 > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(17,24,39,0.6)' }}>
                    <span>Nachlass II ({d2} %)</span><span>– {fmtEur(d2Amt)}</span>
                  </div>
                )}
                {showSkonto && cdPct > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(17,24,39,0.6)' }}>
                    <span>Skonto ({cdPct} %)</span><span>– {fmtEur(cdAmt)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(17,24,39,0.08)' }}>
                  <span>Netto nach Abzügen</span><span>{fmtEur(netAfter)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Invoice summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 14, marginBottom: 18, padding: '12px 16px', background: 'rgba(17,24,39,0.03)', borderRadius: 10 }}>
            <div><span style={{ color: 'rgba(17,24,39,0.5)' }}>Typ: </span><strong>Teilschluss-/Schlussrechnung</strong></div>
            <div><span style={{ color: 'rgba(17,24,39,0.5)' }}>Projekt: </span><strong>{projectLabel || '—'}</strong></div>
            <div><span style={{ color: 'rgba(17,24,39,0.5)' }}>Vertrag: </span><strong>{contractLabel || '—'}</strong></div>
            <div><span style={{ color: 'rgba(17,24,39,0.5)' }}>Rechnungsdatum: </span><strong>{fmtDate(detDate)}</strong></div>
            {dueDate && <div><span style={{ color: 'rgba(17,24,39,0.5)' }}>Fällig: </span><strong>{fmtDate(dueDate)}</strong></div>}
            {(bpStart || bpFinish) && (
              <div style={{ gridColumn: '1/-1' }}>
                <span style={{ color: 'rgba(17,24,39,0.5)' }}>Leistungszeitraum: </span>
                <strong>{fmtDate(bpStart)} – {fmtDate(bpFinish)}</strong>
              </div>
            )}
          </div>

          {/* Selected positions */}
          {phaseChecked.size > 0 && (
            <>
              <p style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Ausgewählte Positionen</p>
              <div className="list-section table-scroll" style={{ marginBottom: 18 }}>
                <table className="master-table">
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th className="num">Leistungsstand €</th>
                      <th className="num">Bereits abgerechnet €</th>
                      <th className="num">Dieser Rechnung €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phases.filter(p => phaseChecked.has(p.ID)).map(p => {
                      const thisInvoice = Math.max(0, (p.TOTAL_EARNED ?? 0) - (p.BILLED_FINAL ?? 0))
                      return (
                        <tr key={p.ID}>
                          <td>{phasePathLabel(p)}</td>
                          <td className="num">{fmtEur(p.TOTAL_EARNED)}</td>
                          <td className="num">{fmtEur(p.ALREADY_BILLED)}</td>
                          <td className="num">{fmtEur(thisInvoice)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Selected deductions */}
          {dedSelected.size > 0 && (
            <>
              <p style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Abzüge (Abschlagsrechnungen)</p>
              <div className="list-section table-scroll" style={{ marginBottom: 18 }}>
                <table className="master-table">
                  <thead>
                    <tr>
                      <th>Nummer</th>
                      <th>Datum</th>
                      <th className="num">Abzug Netto €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deductions.filter(d => dedSelected.has(d.ID)).map(d => (
                      <tr key={d.ID}>
                        <td>{d.PARTIAL_PAYMENT_NUMBER ?? '—'}</td>
                        <td>{fmtDate(d.PARTIAL_PAYMENT_DATE)}</td>
                        <td className="num">{fmtEur(Number(deductAmounts[d.ID] ?? d.DEDUCTION_AMOUNT_NET ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Sicherheitseinbehalt-Auflösung (Phase 2) ───────────────── */}
          {openSeList.length > 0 && (
            <div style={{ background: 'rgba(17,24,39,0.03)', border: '1px solid rgba(17,24,39,0.08)', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
              <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, display: 'inline-flex', alignItems: 'center' }}>
                Sicherheitseinbehalt-Auflösung <HelpHint id="invoice.sicherheitseinbehalt" />
              </p>
              <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                Diese Abschlagsrechnungen haben Sicherheitseinbehalte, die mit dieser Rechnung aufgelöst werden können.
                Standardmäßig sind alle ausgewählt (komplette Auflösung).
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {openSeList.map(e => (
                  <label key={e.ID} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
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
                    <span style={{ minWidth: 140 }}>
                      Nr. <strong>{e.PARTIAL_PAYMENT_NUMBER || `#${e.ID}`}</strong>
                      {e.PARTIAL_PAYMENT_DATE ? <span style={{ color: '#6b7280' }}> · {fmtDate(e.PARTIAL_PAYMENT_DATE)}</span> : null}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#15803d' }}>+ {fmtEur(e.SE_AMOUNT)}</span>
                  </label>
                ))}
                {(() => {
                  const selSum = openSeList.filter(e => seReleaseSel.has(e.ID)).reduce((s, e) => s + (e.SE_AMOUNT || 0), 0)
                  return (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(17,24,39,0.08)', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Σ Auflösung in dieser Rechnung</span>
                      <strong style={{ color: '#15803d' }}>+ {fmtEur(selSum)}</strong>
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

          {/* Totals */}
          {dedTotals && (() => {
            const netAfterDiscAndSkonto = Math.round((base - totalDisc - cdAmt) * 100) / 100
            const hasDeductions = totalDisc > 0 || cdAmt > 0
            const vatPct        = Number(dedTotals.vatPercent ?? 0)
            const taxAmount     = Math.round(netAfterDiscAndSkonto * vatPct / 100 * 100) / 100
            const gross         = Math.round((netAfterDiscAndSkonto + taxAmount) * 100) / 100
            const seReleaseSum  = openSeList.filter(e => seReleaseSel.has(e.ID)).reduce((s, e) => s + (e.SE_AMOUNT || 0), 0)
            const payable       = Math.round((gross + seReleaseSum) * 100) / 100
            return (
              <div className="billing-proposal-box" style={{ marginBottom: 14 }}>
                <div className="bp-row"><span>Positionen Netto</span><strong>{fmtEur(dedTotals.phaseTotal)}</strong></div>
                <div className="bp-row"><span>Abzüge Netto</span><strong>– {fmtEur(dedTotals.deductionsTotal)}</strong></div>
                <div className="bp-row"><span>Netto Zwischensumme</span><strong>{fmtEur(base)}</strong></div>
                {totalDisc > 0 && (
                  <div className="bp-row" style={{ color: '#b91c1c' }}>
                    <span>./. Nachlässe</span><strong>− {fmtEur(totalDisc)}</strong>
                  </div>
                )}
                {cdAmt > 0 && (
                  <div className="bp-row" style={{ color: '#b91c1c' }}>
                    <span>./. Skonto</span><strong>− {fmtEur(cdAmt)}</strong>
                  </div>
                )}
                <div className="bp-row total"><span>Netto gesamt{hasDeductions ? ' (nach Abzügen)' : ''}</span><strong>{fmtEur(netAfterDiscAndSkonto)}</strong></div>
                {vatPct > 0 && (
                  <div className="bp-row"><span>zzgl. {vatPct}&thinsp;% MwSt</span><strong>{fmtEur(taxAmount)}</strong></div>
                )}
                <div className="bp-row total"><span>Brutto gesamt</span><strong>{fmtEur(gross)}</strong></div>
                {seReleaseSum > 0 && (
                  <div className="bp-row" style={{ color: '#15803d' }}>
                    <span>+ Auflösung Sicherheitseinbehalt</span><strong>+ {fmtEur(seReleaseSum)}</strong>
                  </div>
                )}
                {seReleaseSum > 0 && (
                  <div className="bp-row total"><span>Zahlungsbetrag</span><strong>{fmtEur(payable)}</strong></div>
                )}
              </div>
            )
          })()}

          {draftId && (
            <div style={{ display: 'flex', gap: 8, margin: '12px 0 4px', flexWrap: 'wrap' }}>
              <button className="btn-small" onClick={() => void saveDiscountsAndPreview()}>PDF ansehen</button>
              <button className="btn-small" onClick={() => void downloadInvoiceEinvoice(draftId, invType, null, 'ubl')}>XRechnung herunterladen</button>
              <button className="btn-small" onClick={() => void downloadInvoiceEinvoice(draftId, invType, null, 'cii')}>ZUGFeRD herunterladen</button>
            </div>
          )}
          <p style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', marginTop: 8 }}>
            Nach dem Buchen sind alle gewählten Strukturpositionen als abgeschlossen markiert. Vorher kann die Rechnung als Entwurf zwischengespeichert werden.
          </p>
          <Message text={msg?.text ?? null} type={msg?.type} />
          <div className="wizard-nav">
            <button onClick={handleCancel}>Abbrechen</button>
            <button onClick={() => void goToStep(3)}>← Zurück</button>
            <button
              onClick={async () => {
                if (!draftId) return
                await patchInvoice(draftId, {
                  discount_1_percent:   showDiscounts ? d1 : 0,
                  discount_1_reason:    showDiscounts ? (d1Reason.trim() || null) : null,
                  discount_2_percent:   showDiscounts ? d2 : 0,
                  discount_2_reason:    showDiscounts ? (d2Reason.trim() || null) : null,
                  total_discounts:      showDiscounts ? totalDisc : 0,
                  cash_discount_percent: showSkonto ? cdPct : 0,
                  cash_discount_days:    showSkonto ? cdDays : 0,
                  cash_discount_amount:  showSkonto ? cdAmt : 0,
                })
                setMsg({ text: 'Als Entwurf gespeichert ✅', type: 'success' })
              }}
            >Speichern (Entwurf)</button>
            <button className="btn-primary" onClick={() => { if (draftId) bookMut.mutate(draftId) }} disabled={bookMut.isPending}>
              {bookMut.isPending ? 'Bucht …' : 'Jetzt buchen ✓'}
            </button>
          </div>
        </div>
        )
      })()}

      <ConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel="Bestätigen"
        onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />

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
