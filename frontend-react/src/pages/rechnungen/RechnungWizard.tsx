import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
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

export function RechnungWizard() {
  const qc = useQueryClient()
  const [step,    setStep]    = useState(0)
  const [draftId, setDraftId] = useState<number | null>(null)
  const [msg,     setMsg]     = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Step 0 fields
  const [projectId,    setProjectId]    = useState<number | null>(null)
  const [projectLabel, setProjectLabel] = useState('')
  const [companyId,    setCompanyId]    = useState<number | null>(null)
  const [contractId,   setContractId]   = useState<number | null>(null)
  const [contractLabel, setContractLabel] = useState('')
  const [contractsForProject, setContractsForProject] = useState<Array<{ ID: number; NAME_SHORT: string; NAME_LONG: string }>>([])
  const [employeeId,   setEmployeeId]   = useState('')
  const [invType,      setInvType]      = useState<InvoiceType>('rechnung')

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

  const draftIdRef = useRef<number | null>(null)
  useEffect(() => { draftIdRef.current = draftId }, [draftId])

  // Cache COMPANY_ID from project search results for lookup on select
  const projectResultsRef = useRef<Map<number, number | null>>(new Map())

  // Show browser "leave?" dialog and delete draft when user closes/reloads
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      const id = draftIdRef.current
      if (!id) return
      e.preventDefault()
      e.returnValue = ''
      const token = useAuthStore.getState().session?.access_token
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
    mutationFn: bookInvoice,
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
    setEmployeeId(''); setInvType('rechnung')
    setDetDate(todayIso()); setDueDate(''); setBpStart(''); setBpFinish(''); setComment('')
    setProposal(null); setPerfInput(''); setTecList([]); setSelected(new Set()); setHasBt2(false)
    setMsg(null)
  }

  function handleCancel() {
    if (!window.confirm('Entwurf wirklich löschen und Wizard abbrechen?')) return
    if (draftId) deleteMut.mutate(draftId)
    else resetAll()
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

  function applyPerf() {
    if (!draftId || !perfInput) return
    perfMut.mutate({ id: draftId, amount: Number(perfInput) })
  }

  function toggleTec(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function handleWeiterStep2() {
    setMsg(null)
    if (!draftId || !hasBt2) { setStep(3); return }
    const orig = new Set(tecList.filter(t => t.ASSIGNED).map(t => t.ID))
    const ids_assign   = tecList.filter(t =>  selected.has(t.ID) && !orig.has(t.ID)).map(t => t.ID)
    const ids_unassign = tecList.filter(t => !selected.has(t.ID) &&  orig.has(t.ID)).map(t => t.ID)
    tecMut.mutate({ id: draftId, body: { ids_assign, ids_unassign } }, { onSuccess: () => setStep(3) })
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
          <div className="form-group">
            <label>Rechnungstyp</label>
            <select value={invType} onChange={e => setInvType(e.target.value as InvoiceType)}>
              <option value="rechnung">Rechnung</option>
              <option value="schlussrechnung">Schlussrechnung</option>
              <option value="teilschlussrechnung">Teilschlussrechnung</option>
            </select>
          </div>
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
                setContractId(Number(id)); setContractLabel(label)
              }}
              search={async q => {
                if (!projectId) return []
                const res = await searchContracts(projectId, q)
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
        const selectedTecSum = tecList.filter(t => selected.has(t.ID)).reduce((s, t) => s + (t.SP_TOT ?? 0), 0)
        const liveNet   = (proposal?.performance_amount ?? 0) + selectedTecSum
        const vatFactor = 1 + (proposal?.vat_percent ?? 0) / 100
        const liveGross = liveNet * vatFactor
        return (
          <div className="wizard-step-content">
            <p className="wizard-step-title">Beträge & Leistungsnachweise</p>
            {proposal && (
              <div className="billing-proposal-box">
                <div className="bp-row"><span>Empfohlener Leistungsbetrag</span><strong>{fmtEur(proposal.performance_suggested)}</strong></div>
                <div className="bp-row"><span>Leistungsbetrag (Netto)</span><strong>{fmtEur(proposal.performance_amount)}</strong></div>
                {hasBt2 && <div className="bp-row"><span>TEC-Buchungen (ausgewählt)</span><strong>{fmtEur(selectedTecSum)}</strong></div>}
                <div className="bp-row total"><span>Netto gesamt</span><strong>{fmtEur(liveNet)}</strong></div>
                <div className="bp-row total"><span>Brutto gesamt</span><strong>{fmtEur(liveGross)}</strong></div>
              </div>
            )}
            <div className="form-row" style={{ alignItems: 'flex-end', marginTop: 12 }}>
              <FormField label="Leistungsbetrag (Netto)" id="ripf" type="number"
                value={perfInput} onChange={e => setPerfInput(e.target.value)} step="0.01" />
              <button onClick={applyPerf} disabled={perfMut.isPending}>
                {perfMut.isPending ? '…' : 'Übernehmen'}
              </button>
            </div>
            {hasBt2 && (
              <>
                <p style={{ margin: '14px 0 6px', fontWeight: 700, fontSize: 14 }}>TEC-Buchungen zuweisen</p>
                {tecList.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'rgba(17,24,39,0.45)', margin: '4px 0 8px' }}>
                    Keine offenen Buchungen für dieses Projekt vorhanden.
                  </p>
                ) : (
                  <div className="list-section table-scroll">
                    <table className="master-table">
                      <thead>
                        <tr><th></th><th>Datum</th><th>Mitarbeiter</th><th>Beschreibung</th><th className="num">Betrag €</th></tr>
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
              <button className="btn-primary" onClick={handleWeiterStep2} disabled={tecMut.isPending}>
                {tecMut.isPending ? 'Speichert …' : 'Weiter →'}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Step 3: Book */}
      {step === 3 && (
        <div className="wizard-step-content">
          <p className="wizard-step-title">Rechnung buchen</p>
          {proposal && (
            <div className="billing-proposal-box">
              <div className="bp-row"><span>Leistungsbetrag Netto</span><strong>{fmtEur(proposal.performance_amount)}</strong></div>
              <div className="bp-row"><span>TEC-Beträge Netto</span><strong>{fmtEur(proposal.bookings_sum)}</strong></div>
              <div className="bp-row total"><span>Netto gesamt</span><strong>{fmtEur(proposal.total_amount_net)}</strong></div>
              <div className="bp-row total"><span>Brutto gesamt</span><strong>{fmtEur(proposal.total_amount_gross)}</strong></div>
            </div>
          )}
          {draftId && (
            <div style={{ display: 'flex', gap: 8, margin: '12px 0 4px', flexWrap: 'wrap' }}>
              <button className="btn-small" onClick={() => openInvoicePdf(draftId)}>PDF ansehen</button>
              <button className="btn-small" onClick={() => void downloadInvoiceEinvoice(draftId, invType, null, 'ubl')}>XRechnung herunterladen</button>
              <button className="btn-small" onClick={() => void downloadInvoiceEinvoice(draftId, invType, null, 'cii')}>ZUGFeRD herunterladen</button>
            </div>
          )}
          <p style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', marginTop: 8 }}>
            Nach dem Buchen ist die Rechnung unveränderlich.
          </p>
          <Message text={msg?.text ?? null} type={msg?.type} />
          <div className="wizard-nav">
            <button onClick={handleCancel}>Abbrechen</button>
            <button onClick={() => setStep(2)}>← Zurück</button>
            <button className="btn-primary" onClick={() => { if (draftId) bookMut.mutate(draftId) }} disabled={bookMut.isPending}>
              {bookMut.isPending ? 'Bucht …' : 'Jetzt buchen ✓'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
