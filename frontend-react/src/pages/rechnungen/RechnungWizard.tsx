import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { FormField }    from '@/components/ui/FormField'
import {
  searchContracts,
  initInvoice, patchInvoice, getInvoiceBillingProposal,
  putInvoicePerformance, getInvoiceTec, postInvoiceTec, bookInvoice, deleteInvoice,
  openInvoicePdf, downloadInvoiceEinvoice,
  type InvoiceType, type BillingProposal, type TecEntry,
} from '@/api/rechnungen'
import { fetchActiveEmployees, searchProjectsApi } from '@/api/projekte'
import { useAuthStore } from '@/store/authStore'
import { API_BASE }     from '@/api/client'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? v.slice(0, 10) : '—'
function todayIso() { return new Date().toISOString().slice(0, 10) }

const STEPS = ['Init', 'Details', 'Beträge', 'Buchen']

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

export function RechnungWizard({ initialDraft }: { initialDraft?: DraftResume } = {}) {
  const qc = useQueryClient()
  const [step,         setStep]         = useState(0)
  const [draftId,      setDraftId]      = useState<number | null>(null)
  const [msg,          setMsg]          = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const isResumeRef = useRef(false)

  // Step 0 fields
  const [projectId,    setProjectId]    = useState<number | null>(null)
  const [projectLabel, setProjectLabel] = useState('')
  const [companyId,    setCompanyId]    = useState<number | null>(null)
  const [contractId,   setContractId]   = useState<number | null>(null)
  const [contractLabel, setContractLabel] = useState('')
  const [contractsForProject, setContractsForProject] = useState<Array<{ ID: number; NAME_SHORT: string; NAME_LONG: string }>>([])
  const [employeeId,   setEmployeeId]   = useState(() => String(useAuthStore.getState().employeeId ?? ''))
  const invType: InvoiceType = 'rechnung'

  // Step 1 fields
  const [detDate,  setDetDate]  = useState(todayIso())
  const [dueDate,  setDueDate]  = useState('')
  const [bpStart,  setBpStart]  = useState('')
  const [bpFinish, setBpFinish] = useState('')
  const [comment,  setComment]  = useState('')

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

  // Resume existing draft passed from the invoice list
  useEffect(() => {
    if (!initialDraft) return
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
    getInvoiceBillingProposal(initialDraft.id)
      .then(r => { setProposal(r.data); setStep(3) })
      .catch(() => setStep(3))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cache COMPANY_ID from project search results for lookup on select
  const projectResultsRef = useRef<Map<number, number | null>>(new Map())
  const contractSkontoRef = useRef<Map<number, { pct: number | null; days: number | null }>>(new Map())
  const contractSeRef     = useRef<Map<number, { enabled: boolean; pct: number | null; basis: 'BRUTTO' | 'NETTO' }>>(new Map())

  // Show browser "leave?" dialog and delete draft when user closes/reloads
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
      if (list.length === 1) {
        setContractId(list[0].ID)
        setContractLabel(`${list[0].NAME_SHORT} – ${list[0].NAME_LONG}`)
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

  // ── mutations ────────────────────────────────────────────────────────────────

  const initMut = useMutation({
    mutationFn: initInvoice,
    onSuccess: async (res) => { setDraftId(res.id); setMsg(null); setStep(1) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof patchInvoice>[1] }) =>
      patchInvoice(id, body),
    onSuccess: async () => {
      if (!draftId) return
      setMsg(null)
      const [prop, tec] = await Promise.all([
        getInvoiceBillingProposal(draftId),
        getInvoiceTec(draftId),
      ])
      setProposal(prop.data)
      setPerfInput(prev => prev !== '' ? prev : String(prop.data.performance_amount ?? ''))
      setTecList(tec.data)
      setHasBt2(tec.hasBt2 ?? tec.data.length > 0)
      setSelected(prev => prev.size > 0 ? prev : new Set(tec.data.map(t => t.ID)))
      setStep(2)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const perfMut = useMutation({
    mutationFn: ({ id, amount }: { id: number; amount: number }) => putInvoicePerformance(id, amount),
    onSuccess: (res) => setProposal(res.data),
    onError:   (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const tecMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof postInvoiceTec>[1] }) =>
      postInvoiceTec(id, body),
    onSuccess: (res) => setProposal(res.data),
    onError:   (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const bookMut = useMutation({
    mutationFn: async (id: number) => {
      const d1 = Number(d1Pct) || 0
      const d2 = Number(d2Pct) || 0
      const base = proposal?.total_amount_net ?? 0
      const d1Amt = Math.round(base * d1 / 100 * 100) / 100
      const d2Amt = Math.round((base - d1Amt) * d2 / 100 * 100) / 100
      const totalDiscounts = Math.round((d1Amt + d2Amt) * 100) / 100
      const cdPct  = Number(cashDiscPct) || 0
      const cdDays = Number(cashDiscDays) || 0
      const cdAmt  = Math.round((base - totalDiscounts) * cdPct / 100 * 100) / 100
      const netAfter = Math.round((base - totalDiscounts - cdAmt) * 100) / 100
      const vatPct = Number(proposal?.vat_percent ?? 0)
      const taxAfter = Math.round(netAfter * vatPct / 100 * 100) / 100
      const grossAfter = Math.round((netAfter + taxAfter) * 100) / 100
      const sePctNum = seEnabled ? (Number(sePct) || 0) : 0
      const seBasisAmt = seEnabled ? (seBasis === 'BRUTTO' ? grossAfter : netAfter) : 0
      const seAmt = Math.round(seBasisAmt * sePctNum / 100 * 100) / 100
      await patchInvoice(id, {
        discount_1_percent:   showDiscounts ? d1 : 0,
        discount_1_reason:    showDiscounts ? (d1Reason.trim() || null) : null,
        discount_2_percent:   showDiscounts ? d2 : 0,
        discount_2_reason:    showDiscounts ? (d2Reason.trim() || null) : null,
        total_discounts:      showDiscounts ? totalDiscounts : 0,
        cash_discount_percent: showSkonto ? cdPct : 0,
        cash_discount_days:    showSkonto ? cdDays : 0,
        cash_discount_amount:  showSkonto ? cdAmt : 0,
        se_percent:           seEnabled ? sePctNum : null,
        se_basis:             seEnabled ? seBasis : null,
        se_basis_amt:         seEnabled ? seBasisAmt : null,
        se_amount:            seEnabled ? seAmt : null,
      })
      return bookInvoice(id)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      setMsg({ text: 'Rechnung gebucht ✅', type: 'success' })
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
    setCompanyId(null); setContractId(null); setContractLabel(''); setContractsForProject([])
    setEmployeeId('')
    setDetDate(todayIso()); setDueDate(''); setBpStart(''); setBpFinish(''); setComment('')
    setProposal(null); setPerfInput(''); setTecList([]); setSelected(new Set()); setHasBt2(false)
    setShowDiscounts(false); setD1Pct(''); setD2Pct(''); setShowSkonto(false); setCashDiscPct(''); setCashDiscDays(''); setSeEnabled(false); setSePct(''); setSeBasis('BRUTTO')
    setMsg(null)
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

  function clearDraftState() {
    setDraftId(null)
    setProposal(null); setPerfInput(''); setTecList([]); setSelected(new Set()); setHasBt2(false)
  }

  function submitStep0() {
    setMsg(null)
    if (!projectId || !contractId || !employeeId) {
      setMsg({ text: 'Bitte alle Felder ausfüllen', type: 'error' }); return
    }
    if (draftId) { setStep(1); return }
    initMut.mutate({
      company_id: companyId ?? 0, employee_id: Number(employeeId),
      project_id: projectId, contract_id: contractId, invoice_type: invType,
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
    }})
  }

  function toggleTec(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAllTec() {
    setSelected(selected.size === tecList.length ? new Set() : new Set(tecList.map(t => t.ID)))
  }

  async function handleWeiterStep2() {
    setMsg(null)
    if (!draftId) return
    try {
      await perfMut.mutateAsync({ id: draftId, amount: Number(perfInput) })
      if (hasBt2) {
        const orig = new Set(tecList.filter(t => t.ASSIGNED).map(t => t.ID))
        const ids_assign   = tecList.filter(t =>  selected.has(t.ID) && !orig.has(t.ID)).map(t => t.ID)
        const ids_unassign = tecList.filter(t => !selected.has(t.ID) &&  orig.has(t.ID)).map(t => t.ID)
        await tecMut.mutateAsync({ id: draftId, body: { ids_assign, ids_unassign } })
      }
      setStep(3)
    } catch { /* onError handlers set msg */ }
  }

  const singleContract = contractsForProject.length === 1

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="wizard-wrap">
      <StepIndicator step={step} onStepClick={i => void goToStep(i)} />

      {/* Step 0: Init */}
      {step === 0 && (
        <div className="wizard-step-content">
          <p className="wizard-step-title">Projekt & Vertrag wählen</p>
          <Autocomplete
            label="Projekt*" htmlId="rw-project"
            value={projectLabel}
            onChange={setProjectLabel}
            onSelect={(id, label) => {
              const pid = Number(id)
              if (draftId && pid !== projectId) {
                deleteInvoice(draftId).catch(() => {})
                clearDraftState()
              }
              setProjectId(pid); setProjectLabel(label)
              setCompanyId(projectResultsRef.current.get(pid) ?? null)
              setContractId(null); setContractLabel('')
            }}
            search={async q => {
              const res = await searchProjectsApi(q)
              res.data.forEach(p => projectResultsRef.current.set(p.ID, p.COMPANY_ID ?? null))
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
              label="Vertrag*" htmlId="rw-contract"
              value={contractLabel}
              onChange={setContractLabel}
              onSelect={(id, label) => {
                if (draftId && Number(id) !== contractId) {
                  deleteInvoice(draftId).catch(() => {})
                  clearDraftState()
                }
                const cid = Number(id)
                setContractId(cid); setContractLabel(label)
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

      {/* Step 1: Details */}
      {step === 1 && (
        <div className="wizard-step-content">
          <p className="wizard-step-title">Rechnungsdetails</p>
          <div className="form-row">
            <FormField label="Rechnungsdatum"    id="rid"  type="date" value={detDate}  onChange={e => setDetDate(e.target.value)} />
            <FormField label="Fälligkeitsdatum"  id="ridd" type="date" value={dueDate}  onChange={e => setDueDate(e.target.value)} />
          </div>
          <div className="form-row">
            <FormField label="Leistungszeitraum von" id="ribs" type="date" value={bpStart}  onChange={e => setBpStart(e.target.value)} />
            <FormField label="bis"                   id="ribf" type="date" value={bpFinish} onChange={e => setBpFinish(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Kommentar</label>
            <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(17,24,39,0.10)', borderRadius: 12, fontSize: 15 }} />
          </div>
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

      {/* Step 2: Amounts */}
      {step === 2 && (() => {
        const perfAmt        = perfInput !== '' ? Number(perfInput) : (proposal?.performance_amount ?? 0)
        const selectedTecSum = tecList.filter(t => selected.has(t.ID)).reduce((s, t) => s + (t.SP_TOT ?? 0), 0)
        const liveNet        = perfAmt + selectedTecSum
        const vatFactor      = 1 + (proposal?.vat_percent ?? 0) / 100
        const liveGross      = liveNet * vatFactor
        const allSelected    = tecList.length > 0 && selected.size === tecList.length
        return (
          <div className="wizard-step-content">
            <p className="wizard-step-title">Beträge & Leistungsnachweise</p>
            {proposal && (
              <div className="billing-proposal-box">
                <div className="bp-row"><span>Empfohlener Leistungsbetrag</span><strong>{fmtEur(proposal.performance_suggested)}</strong></div>
                <div className="bp-row"><span>Leistungsbetrag (Netto)</span><strong>{fmtEur(perfAmt)}</strong></div>
                {hasBt2 && <div className="bp-row"><span>Buchungen (ausgewählt)</span><strong>{fmtEur(selectedTecSum)}</strong></div>}
                <div className="bp-row total"><span>Netto gesamt</span><strong>{fmtEur(liveNet)}</strong></div>
                <div className="bp-row total"><span>Brutto gesamt</span><strong>{fmtEur(liveGross)}</strong></div>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <FormField label="Leistungsbetrag (Netto)" id="ripf" type="number"
                value={perfInput} onChange={e => setPerfInput(e.target.value)} step="0.01" />
            </div>
            {hasBt2 && (
              <>
                <p style={{ margin: '14px 0 6px', fontWeight: 700, fontSize: 14 }}>Buchungen zuweisen</p>
                {tecList.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'rgba(17,24,39,0.45)', margin: '4px 0 8px' }}>
                    Keine offenen Buchungen für dieses Projekt vorhanden.
                  </p>
                ) : (
                  <div className="list-section table-scroll">
                    <table className="master-table">
                      <thead>
                        <tr>
                          <th><input type="checkbox" checked={allSelected} onChange={toggleAllTec} /></th>
                          <th>Datum</th><th>Mitarbeiter</th><th>Beschreibung</th><th className="num">Betrag €</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tecList.map(t => (
                          <tr key={t.ID}>
                            <td><input type="checkbox" checked={selected.has(t.ID)} onChange={() => toggleTec(t.ID)} /></td>
                            <td>{fmtDate(t.DATE_VOUCHER)}</td>
                            <td>{t.EMPLOYEE_SHORT_NAME ?? '—'}</td>
                            <td>{t.POSTING_DESCRIPTION}</td>
                            <td className="num">{fmtEur(t.SP_TOT)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <Message text={msg?.text ?? null} type={msg?.type} />
            <div className="wizard-nav">
              <button onClick={handleCancel}>Abbrechen</button>
              <button onClick={() => setStep(1)}>← Zurück</button>
              <button className="btn-primary" onClick={handleWeiterStep2} disabled={perfMut.isPending || tecMut.isPending}>
                {perfMut.isPending || tecMut.isPending ? 'Speichert …' : 'Weiter →'}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Step 3: Book */}
      {step === 3 && (() => {
        const base = proposal?.total_amount_net ?? 0
        const vatPct = Number(proposal?.vat_percent ?? 0)
        const d1 = showDiscounts ? (Number(d1Pct) || 0) : 0
        const d2 = showDiscounts ? (Number(d2Pct) || 0) : 0
        const d1Amt = Math.round(base * d1 / 100 * 100) / 100
        const d2Amt = Math.round((base - d1Amt) * d2 / 100 * 100) / 100
        const totalDisc = Math.round((d1Amt + d2Amt) * 100) / 100
        const cdPct  = showSkonto ? (Number(cashDiscPct) || 0) : 0
        const cdDays = showSkonto ? (Number(cashDiscDays) || 0) : 0
        const cdAmt  = Math.round((base - totalDisc) * cdPct / 100 * 100) / 100
        const netAfter = Math.round((base - totalDisc - cdAmt) * 100) / 100
        const taxAfter = Math.round(netAfter * vatPct / 100 * 100) / 100
        const grossAfter = Math.round((netAfter + taxAfter) * 100) / 100
        const sePctNum = seEnabled ? (Number(sePct) || 0) : 0
        const seBasisAmt = seEnabled ? (seBasis === 'BRUTTO' ? grossAfter : netAfter) : 0
        const seAmt = Math.round(seBasisAmt * sePctNum / 100 * 100) / 100
        const payable = Math.round((grossAfter - seAmt) * 100) / 100
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
            se_percent:           seEnabled ? sePctNum : null,
            se_basis:             seEnabled ? seBasis : null,
            se_basis_amt:         seEnabled ? seBasisAmt : null,
            se_amount:            seEnabled ? seAmt : null,
          })
          openInvoicePdf(draftId)
        }
        return (
          <div className="wizard-step-content">
            <p className="wizard-step-title">Rechnung buchen</p>

            <div style={{ background: 'rgba(17,24,39,0.03)', border: '1px solid rgba(17,24,39,0.08)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Nachlässe und Skonto</p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 6 }}>
                <input type="checkbox" checked={showDiscounts} onChange={e => setShowDiscounts(e.target.checked)} />
                Nachlässe angeben
              </label>
              {showDiscounts && (
                <div style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 13, minWidth: 80 }}>Nachlass I (%)</label>
                    <input type="number" step="0.01" min="0" max="100" value={d1Pct}
                      onChange={e => { setD1Pct(e.target.value); if (!e.target.value) { setD2Pct(''); setD2Reason('') } }}
                      style={{ width: 90, padding: '4px 8px', border: '1px solid rgba(17,24,39,0.15)', borderRadius: 6, fontSize: 13 }}
                      placeholder="z. B. 3" />
                    <input type="text" value={d1Reason} onChange={e => setD1Reason(e.target.value)}
                      style={{ flex: 1, minWidth: 120, padding: '4px 8px', border: '1px solid rgba(17,24,39,0.15)', borderRadius: 6, fontSize: 13 }}
                      placeholder="Bezeichnung (optional)" />
                    {d1Pct && <span style={{ fontSize: 12, color: 'rgba(17,24,39,0.5)' }}>= {fmtEur(d1Amt)}</span>}
                  </div>
                  {d1Pct && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 13, minWidth: 80 }}>Nachlass II (%)</label>
                      <input type="number" step="0.01" min="0" max="100" value={d2Pct}
                        onChange={e => setD2Pct(e.target.value)}
                        style={{ width: 90, padding: '4px 8px', border: '1px solid rgba(17,24,39,0.15)', borderRadius: 6, fontSize: 13 }}
                        placeholder="optional" />
                      <input type="text" value={d2Reason} onChange={e => setD2Reason(e.target.value)}
                        style={{ flex: 1, minWidth: 120, padding: '4px 8px', border: '1px solid rgba(17,24,39,0.15)', borderRadius: 6, fontSize: 13 }}
                        placeholder="Bezeichnung (optional)" />
                      {d2Pct && <span style={{ fontSize: 12, color: 'rgba(17,24,39,0.5)' }}>= {fmtEur(d2Amt)}</span>}
                    </div>
                  )}
                  {totalDisc > 0 && <div style={{ fontSize: 12, color: '#374151' }}>Gesamt-Nachlass: <strong>{fmtEur(totalDisc)}</strong></div>}
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 6 }}>
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
              {showSkonto && (
                <div style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 13, minWidth: 80 }}>Skonto (%)</label>
                    <input type="number" step="0.01" min="0" max="100" value={cashDiscPct}
                      onChange={e => setCashDiscPct(e.target.value)}
                      style={{ width: 90, padding: '4px 8px', border: '1px solid rgba(17,24,39,0.15)', borderRadius: 6, fontSize: 13 }}
                      placeholder="z. B. 2" />
                    <label style={{ fontSize: 13, minWidth: 80 }}>Zahlungsziel (Tage)</label>
                    <input type="number" step="1" min="0" value={cashDiscDays}
                      onChange={e => setCashDiscDays(e.target.value)}
                      style={{ width: 70, padding: '4px 8px', border: '1px solid rgba(17,24,39,0.15)', borderRadius: 6, fontSize: 13 }}
                      placeholder="z. B. 14" />
                  </div>
                  {cdAmt > 0 && <div style={{ fontSize: 12, color: '#374151' }}>Skonto-Abzug: <strong>{fmtEur(cdAmt)}</strong></div>}
                </div>
              )}
              {(totalDisc > 0 || cdAmt > 0) && (
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(17,24,39,0.08)', fontSize: 13 }}>
                  Rechnungssumme netto nach Abzügen: <strong>{fmtEur(netAfter)}</strong>
                </div>
              )}

              {/* Sicherheitseinbehalt */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(17,24,39,0.08)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 6 }}>
                  <input type="checkbox" checked={seEnabled} onChange={e => setSeEnabled(e.target.checked)} />
                  Sicherheitseinbehalt einbehalten
                </label>
                {seEnabled && (
                  <div style={{ paddingLeft: 22, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      Prozent (%):
                      <input type="number" step="0.01" min="0" max="100" value={sePct}
                        onChange={e => setSePct(e.target.value)}
                        style={{ width: 80, padding: '4px 8px', border: '1px solid rgba(17,24,39,0.15)', borderRadius: 6, fontSize: 13 }}
                        placeholder="z. B. 5" />
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span>Basis:</span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="radio" checked={seBasis === 'BRUTTO'} onChange={() => setSeBasis('BRUTTO')} />
                        Brutto
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="radio" checked={seBasis === 'NETTO'} onChange={() => setSeBasis('NETTO')} />
                        Netto
                      </label>
                    </div>
                    {seAmt > 0 && <span style={{ fontSize: 12, color: '#374151' }}>= <strong>{fmtEur(seAmt)}</strong></span>}
                  </div>
                )}
              </div>
            </div>

            {proposal && (() => {
              const hasDeductions = totalDisc > 0 || cdAmt > 0
              return (
                <div className="billing-proposal-box">
                  <div className="bp-row"><span>Leistungsbetrag Netto</span><strong>{fmtEur(proposal.performance_amount)}</strong></div>
                  <div className="bp-row"><span>Buchungen Netto</span><strong>{fmtEur(proposal.bookings_sum)}</strong></div>
                  <div className="bp-row"><span>Nebenkosten Netto</span><strong>{fmtEur(proposal.amount_extras_net)}</strong></div>
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
                  <div className="bp-row total"><span>Netto gesamt{hasDeductions ? ' (nach Abzügen)' : ''}</span><strong>{fmtEur(netAfter)}</strong></div>
                  {vatPct > 0 && (
                    <div className="bp-row"><span>zzgl. {vatPct}&thinsp;% MwSt.</span><strong>{fmtEur(taxAfter)}</strong></div>
                  )}
                  <div className="bp-row total"><span>Brutto gesamt</span><strong>{fmtEur(grossAfter)}</strong></div>
                  {seEnabled && seAmt > 0 && (
                    <div className="bp-row" style={{ color: '#b91c1c' }}>
                      <span>./. Sicherheitseinbehalt {sePctNum}&thinsp;% vom {seBasis === 'BRUTTO' ? 'Brutto' : 'Netto'}</span>
                      <strong>− {fmtEur(seAmt)}</strong>
                    </div>
                  )}
                  {seEnabled && seAmt > 0 && (
                    <div className="bp-row total"><span>Sofort fällig</span><strong>{fmtEur(payable)}</strong></div>
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
              Nach dem Buchen ist die Rechnung unveränderlich. Vorher kann sie als Entwurf zwischengespeichert werden.
            </p>
            <Message text={msg?.text ?? null} type={msg?.type} />
            <div className="wizard-nav">
              <button onClick={handleCancel}>Abbrechen</button>
              <button onClick={() => setStep(2)}>← Zurück</button>
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
                    se_percent:           seEnabled ? sePctNum : null,
                    se_basis:             seEnabled ? seBasis : null,
                    se_basis_amt:         seEnabled ? seBasisAmt : null,
                    se_amount:            seEnabled ? seAmt : null,
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
    </div>
  )
}
