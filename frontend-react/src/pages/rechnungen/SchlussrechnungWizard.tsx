import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { FormField }    from '@/components/ui/FormField'
import {
  fetchCompanies, searchContracts,
  initInvoice, patchInvoice,
  getFinalInvoicePhases, saveFinalInvoicePhases,
  getFinalInvoiceDeductions, saveFinalInvoiceDeductions,
  bookFinalInvoice, deleteInvoice,
  type FinalPhase, type FinalDeduction, type FinalTotals,
} from '@/api/rechnungen'
import { fetchActiveEmployees, searchProjectsApi } from '@/api/projekte'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? v.slice(0, 10) : '—'
function todayIso() { return new Date().toISOString().slice(0, 10) }

const STEPS = ['Init', 'Details', 'Positionen', 'Abzüge', 'Buchen']

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="wizard-steps">
      {STEPS.map((s, i) => (
        <div key={s} className={`wizard-step${i === step ? ' active' : i < step ? ' done' : ''}`}>{s}</div>
      ))}
    </div>
  )
}

export function SchlussrechnungWizard() {
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
  const [isTeil,        setIsTeil]        = useState(false)

  // Step 1
  const [detDate,   setDetDate]   = useState(todayIso())
  const [dueDate,   setDueDate]   = useState('')
  const [bpStart,   setBpStart]   = useState('')
  const [bpFinish,  setBpFinish]  = useState('')
  const [comment,   setComment]   = useState('')

  // Step 2: phases
  const [phases,       setPhases]       = useState<FinalPhase[]>([])
  const [phaseChecked, setPhaseChecked] = useState<Set<number>>(new Set())
  const [phaseTotals,  setPhaseTotals]  = useState<FinalTotals | null>(null)

  // Step 3: deductions
  const [deductions,    setDeductions]    = useState<FinalDeduction[]>([])
  const [deductAmounts, setDeductAmounts] = useState<Record<number, string>>({})
  const [dedSelected,   setDedSelected]   = useState<Set<number>>(new Set())
  const [dedTotals,     setDedTotals]     = useState<FinalTotals | null>(null)

  const { data: empData }  = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const { data: compData } = useQuery({ queryKey: ['companies'],        queryFn: fetchCompanies })
  const employees = empData?.data  ?? []
  const companies = compData?.data ?? []

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
      setPhaseChecked(new Set(res.data.filter(p => p.SELECTED && !p.CLOSED).map(p => p.ID)))
      setStep(2)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const phasesMut = useMutation({
    mutationFn: ({ id, ids }: { id: number; ids: number[] }) =>
      saveFinalInvoicePhases(id, ids),
    onSuccess: async (res) => {
      setPhaseTotals({ phaseTotal: res.phaseTotal, deductionsTotal: res.deductionsTotal, totalNet: res.totalNet })
      if (!draftId) return
      setMsg(null)
      const ded = await getFinalInvoiceDeductions(draftId)
      setDeductions(ded.data)
      setDeductAmounts(Object.fromEntries(ded.data.map(d => [d.ID, String(d.AMOUNT_NET ?? '')])))
      setDedSelected(new Set()) // user explicitly selects which to deduct
      setStep(3)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const dedMut = useMutation({
    mutationFn: ({ id, items }: { id: number; items: { partial_payment_id: number; deduction_amount_net: number }[] }) =>
      saveFinalInvoiceDeductions(id, items),
    onSuccess: (res) => {
      setDedTotals({ phaseTotal: res.phaseTotal, deductionsTotal: res.deductionsTotal, totalNet: res.totalNet })
      setMsg(null)
      setStep(4)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const bookMut = useMutation({
    mutationFn: bookFinalInvoice,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      setMsg({ text: 'Schlussrechnung gebucht ✅', type: 'success' })
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
    setIsTeil(false); setDetDate(todayIso()); setDueDate(''); setBpStart(''); setBpFinish(''); setComment('')
    setPhases([]); setPhaseChecked(new Set()); setPhaseTotals(null)
    setDeductions([]); setDeductAmounts({}); setDedSelected(new Set()); setDedTotals(null)
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
      project_id: projectId, contract_id: contractId,
      invoice_type: isTeil ? 'teilschlussrechnung' : 'schlussrechnung',
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

  function submitPhases() {
    if (!draftId) return
    setMsg(null)
    phasesMut.mutate({ id: draftId, ids: Array.from(phaseChecked) })
  }

  function submitDeductions() {
    if (!draftId) return
    setMsg(null)
    const items = Array.from(dedSelected).map(id => ({
      partial_payment_id:    id,
      deduction_amount_net:  Number(deductAmounts[id] ?? 0),
    }))
    dedMut.mutate({ id: draftId, items })
  }

  function toggleDed(id: number) {
    setDedSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="wizard-wrap">
      <StepIndicator step={step} />

      {/* Step 0 */}
      {step === 0 && (
        <div className="wizard-step-content">
          <p className="wizard-step-title">Projekt & Vertrag wählen</p>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={isTeil} onChange={e => setIsTeil(e.target.checked)} />
              Teilschlussrechnung (nur ausgewählte Positionen)
            </label>
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
          <Message text={msg?.text ?? null} type={msg?.type} />
          <div className="wizard-nav">
            <button onClick={handleCancel}>Abbrechen</button>
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
                  <th></th>
                  <th>Position</th>
                  <th className="num">Leistungsstand €</th>
                  <th className="num">Bereits abgerechnet €</th>
                  <th className="num">Dieser Rechnung €</th>
                </tr>
              </thead>
              <tbody>
                {phases.map(p => (
                  <tr key={p.ID} style={{ opacity: p.CLOSED ? 0.4 : 1 }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={phaseChecked.has(p.ID)}
                        disabled={p.CLOSED}
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
                      <strong>{p.NAME_SHORT}</strong>
                      {p.NAME_LONG && <span className="tree-name-long"> – {p.NAME_LONG}</span>}
                      {p.CLOSED && <span style={{ marginLeft: 6, fontSize: 11, color: '#dc2626' }}>(bereits geschlossen)</span>}
                    </td>
                    <td className="num">{fmtEur(p.TOTAL_EARNED)}</td>
                    <td className="num">{fmtEur(p.ALREADY_BILLED)}</td>
                    <td className="num">{fmtEur(p.AMOUNT_NET)}</td>
                  </tr>
                ))}
                {!phases.length && <tr><td colSpan={5} className="empty-note">Keine Positionen gefunden</td></tr>}
              </tbody>
            </table>
          </div>
          <Message text={msg?.text ?? null} type={msg?.type} />
          <div className="wizard-nav">
            <button onClick={handleCancel}>Abbrechen</button>
            <button onClick={() => setStep(1)}>← Zurück</button>
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
            <p className="empty-note">Keine gebuchten Abschlagsrechnungen für dieses Projekt.</p>
          )}
          {deductions.length > 0 && (
            <div className="list-section table-scroll">
              <table className="master-table">
                <thead>
                  <tr>
                    <th></th>
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
                        <input type="checkbox" checked={dedSelected.has(d.ID)} onChange={() => toggleDed(d.ID)} />
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
          <Message text={msg?.text ?? null} type={msg?.type} />
          <div className="wizard-nav">
            <button onClick={handleCancel}>Abbrechen</button>
            <button onClick={() => setStep(2)}>← Zurück</button>
            <button className="btn-primary" onClick={submitDeductions} disabled={dedMut.isPending}>
              {dedMut.isPending ? 'Speichert …' : 'Weiter →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Book */}
      {step === 4 && (
        <div className="wizard-step-content">
          <p className="wizard-step-title">Schlussrechnung buchen</p>
          {dedTotals && (
            <div className="billing-proposal-box">
              <div className="bp-row"><span>Positionen Netto</span><strong>{fmtEur(dedTotals.phaseTotal)}</strong></div>
              <div className="bp-row"><span>Abzüge Netto</span><strong>– {fmtEur(dedTotals.deductionsTotal)}</strong></div>
              <div className="bp-row total"><span>Netto gesamt</span><strong>{fmtEur(dedTotals.totalNet)}</strong></div>
            </div>
          )}
          <p style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', marginTop: 12 }}>
            Nach dem Buchen sind alle gewählten Strukturpositionen als abgeschlossen markiert.
          </p>
          <Message text={msg?.text ?? null} type={msg?.type} />
          <div className="wizard-nav">
            <button onClick={handleCancel}>Abbrechen</button>
            <button onClick={() => setStep(3)}>← Zurück</button>
            <button className="btn-primary" onClick={() => { if (draftId) bookMut.mutate(draftId) }} disabled={bookMut.isPending}>
              {bookMut.isPending ? 'Bucht …' : 'Jetzt buchen ✓'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
