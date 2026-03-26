import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { FormField }    from '@/components/ui/FormField'
import {
  fetchCompanies, searchContracts,
  initInvoice, patchInvoice, getInvoiceBillingProposal,
  putInvoicePerformance, getInvoiceTec, postInvoiceTec, bookInvoice, deleteInvoice,
  type InvoiceType, type BillingProposal, type TecEntry,
} from '@/api/rechnungen'
import { fetchActiveEmployees, searchProjectsApi } from '@/api/projekte'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? v.slice(0, 10) : '—'
function todayIso() { return new Date().toISOString().slice(0, 10) }

const STEPS = ['Init', 'Details', 'Beträge', 'Buchen']

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="wizard-steps">
      {STEPS.map((s, i) => (
        <div key={s} className={`wizard-step${i === step ? ' active' : i < step ? ' done' : ''}`}>{s}</div>
      ))}
    </div>
  )
}

export function RechnungWizard() {
  const qc = useQueryClient()
  const [step,       setStep]       = useState(0)
  const [draftId,    setDraftId]    = useState<number | null>(null)
  const [msg,        setMsg]        = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Step 0
  const [projectId,     setProjectId]     = useState<number | null>(null)
  const [projectLabel,  setProjectLabel]  = useState('')
  const [contractId,    setContractId]    = useState<number | null>(null)
  const [contractLabel, setContractLabel] = useState('')
  const [employeeId,    setEmployeeId]    = useState('')
  const [companyId,     setCompanyId]     = useState('')
  const [invType,       setInvType]       = useState<InvoiceType>('rechnung')

  // Step 1
  const [detDate,   setDetDate]   = useState(todayIso())
  const [dueDate,   setDueDate]   = useState('')
  const [bpStart,   setBpStart]   = useState('')
  const [bpFinish,  setBpFinish]  = useState('')
  const [comment,   setComment]   = useState('')

  // Step 2
  const [proposal,  setProposal]  = useState<BillingProposal | null>(null)
  const [perfInput, setPerfInput] = useState('')
  const [tecList,   setTecList]   = useState<TecEntry[]>([])
  const [selected,  setSelected]  = useState<Set<number>>(new Set())

  const { data: empData }  = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const { data: compData } = useQuery({ queryKey: ['companies'],        queryFn: fetchCompanies })
  const employees = empData?.data  ?? []
  const companies = compData?.data ?? []

  const initMut = useMutation({
    mutationFn: initInvoice,
    onSuccess: async (res) => {
      setDraftId(res.id); setMsg(null); setStep(1)
    },
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
      setPerfInput(String(prop.data.performance_amount ?? ''))
      setTecList(tec.data)
      setSelected(new Set(tec.data.filter(t => t.ASSIGNED).map(t => t.ID)))
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

  function resetAll() {
    setStep(0); setDraftId(null); setProjectId(null); setProjectLabel('')
    setContractId(null); setContractLabel(''); setEmployeeId(''); setCompanyId('')
    setInvType('rechnung'); setDetDate(todayIso()); setDueDate('')
    setBpStart(''); setBpFinish(''); setComment('')
    setProposal(null); setPerfInput(''); setTecList([]); setSelected(new Set())
    setMsg(null)
  }

  function handleCancel() {
    if (draftId) deleteMut.mutate(draftId)
    else resetAll()
  }

  function submitStep0() {
    setMsg(null)
    if (!projectId || !contractId || !employeeId || !companyId) {
      setMsg({ text: 'Bitte alle Felder ausfüllen', type: 'error' }); return
    }
    initMut.mutate({
      company_id: Number(companyId), employee_id: Number(employeeId),
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

  function saveTec() {
    if (!draftId) return
    const orig = new Set(tecList.filter(t => t.ASSIGNED).map(t => t.ID))
    const ids_assign   = tecList.filter(t =>  selected.has(t.ID) && !orig.has(t.ID)).map(t => t.ID)
    const ids_unassign = tecList.filter(t => !selected.has(t.ID) &&  orig.has(t.ID)).map(t => t.ID)
    tecMut.mutate({ id: draftId, body: { ids_assign, ids_unassign } })
  }

  return (
    <div className="wizard-wrap">
      <StepIndicator step={step} />

      {/* Step 0 */}
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
          <div className="form-group">
            <label>Projekt*</label>
            <Autocomplete
              value={projectLabel}
              onChange={setProjectLabel}
              onSelect={(id, label) => {
                setProjectId(Number(id)); setProjectLabel(label)
                setContractId(null); setContractLabel('')
              }}
              search={async q => {
                const res = await searchProjectsApi(q)
                return res.data.map(p => ({ id: p.ID, label: `${p.NAME_SHORT} – ${p.NAME_LONG}` }))
              }}
              placeholder="Projekt suchen …"
            />
          </div>
          <div className="form-group">
            <label>Vertrag*</label>
            <Autocomplete
              value={contractLabel}
              onChange={setContractLabel}
              onSelect={(id, label) => { setContractId(Number(id)); setContractLabel(label) }}
              search={async q => {
                if (!projectId) return []
                const res = await searchContracts(projectId, q)
                return res.data.map(c => ({ id: c.ID, label: `${c.NAME_SHORT} – ${c.NAME_LONG}` }))
              }}
              placeholder={projectId ? 'Vertrag suchen …' : 'Erst Projekt wählen'}
            />
          </div>
          <div className="form-group">
            <label>Mitarbeiter*</label>
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {employees.map(e => <option key={e.ID} value={e.ID}>{e.SHORT_NAME}: {e.FIRST_NAME} {e.LAST_NAME}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Firma*</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {companies.map(c => <option key={c.ID} value={c.ID}>{c.COMPANY_NAME_1}</option>)}
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
            <button className="btn-primary" onClick={submitStep1} disabled={patchMut.isPending}>
              {patchMut.isPending ? 'Speichert …' : 'Weiter →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div className="wizard-step-content">
          <p className="wizard-step-title">Beträge & Leistungsnachweise</p>
          {proposal && (
            <div className="billing-proposal-box">
              <div className="bp-row"><span>Empfohlener Leistungsbetrag</span><strong>{fmtEur(proposal.performance_suggested)}</strong></div>
              <div className="bp-row"><span>TEC-Beträge</span><strong>{fmtEur(proposal.bookings_sum)}</strong></div>
              <div className="bp-row total"><span>Netto gesamt</span><strong>{fmtEur(proposal.total_amount_net)}</strong></div>
              <div className="bp-row total"><span>Brutto gesamt</span><strong>{fmtEur(proposal.total_amount_gross)}</strong></div>
            </div>
          )}
          <div className="form-row" style={{ alignItems: 'flex-end', marginTop: 12 }}>
            <FormField label="Leistungsbetrag (Netto)" id="ripf" type="number"
              value={perfInput} onChange={e => setPerfInput(e.target.value)} step="0.01" />
            <button onClick={applyPerf} disabled={perfMut.isPending}>
              {perfMut.isPending ? '…' : 'Übernehmen'}
            </button>
          </div>
          {tecList.length > 0 && (
            <>
              <p style={{ margin: '14px 0 6px', fontWeight: 700, fontSize: 14 }}>TEC-Einträge zuweisen</p>
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
              <button onClick={saveTec} disabled={tecMut.isPending} style={{ marginTop: 8 }}>
                {tecMut.isPending ? 'Speichert …' : 'TEC-Zuweisung speichern'}
              </button>
            </>
          )}
          <Message text={msg?.text ?? null} type={msg?.type} />
          <div className="wizard-nav">
            <button onClick={handleCancel}>Abbrechen</button>
            <button className="btn-primary" onClick={() => { setMsg(null); setStep(3) }}>Weiter →</button>
          </div>
        </div>
      )}

      {/* Step 3 */}
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
          <p style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', marginTop: 12 }}>
            Nach dem Buchen ist die Rechnung unveränderlich. Eine PDF wird automatisch generiert.
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
