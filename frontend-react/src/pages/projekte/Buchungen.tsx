import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'
import {
  fetchProjectsShort, fetchProjectStructure, fetchBuchungen, createBuchung, deleteBuchung,
  type Buchung,
} from '@/api/projekte'
import { fetchActiveEmployees } from '@/api/projekte'

const FMT_NUM = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const fmtN    = (v: number | null | undefined) => v == null ? '—' : FMT_NUM.format(v)
const fmtDate = (v: string | null) => v ? v.slice(0, 10) : ''

function todayIso() { return new Date().toISOString().slice(0, 10) }

interface BuchungForm {
  EMPLOYEE_ID:         string
  STRUCTURE_ID:        string
  DATE_VOUCHER:        string
  TIME_START:          string
  TIME_FINISH:         string
  QUANTITY_INT:        string
  CP_RATE:             string
  QUANTITY_EXT:        string
  SP_RATE:             string
  POSTING_DESCRIPTION: string
}

function emptyForm(): BuchungForm {
  return {
    EMPLOYEE_ID: '', STRUCTURE_ID: '', DATE_VOUCHER: todayIso(),
    TIME_START: '', TIME_FINISH: '',
    QUANTITY_INT: '', CP_RATE: '', QUANTITY_EXT: '', SP_RATE: '',
    POSTING_DESCRIPTION: '',
  }
}

export function Buchungen() {
  const qc = useQueryClient()
  const [pid,     setPid]     = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form,    setForm]    = useState<BuchungForm>(emptyForm)
  const [msg,     setMsg]     = useState<{ text: string; type: 'success'|'error' } | null>(null)

  const { data: projectsData }  = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: empData }       = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const { data: buchData, isLoading } = useQuery({
    queryKey: ['buchungen', pid],
    queryFn:  () => fetchBuchungen(pid!),
    enabled:  pid !== null,
  })
  const { data: structData } = useQuery({
    queryKey: ['structure', pid],
    queryFn:  () => fetchProjectStructure(pid!),
    enabled:  pid !== null,
  })

  const projects  = projectsData?.data ?? []
  const employees = empData?.data      ?? []
  const buchungen = buchData?.data     ?? []
  const structure = structData?.data   ?? []

  const totalIntH = buchungen.reduce((s, b) => s + (Number(b.QUANTITY_INT) || 0), 0)
  const totalCost = buchungen.reduce((s, b) => s + (Number(b.CP_TOT) || 0), 0)
  const totalRev  = buchungen.reduce((s, b) => s + (Number(b.SP_TOT) || 0), 0)

  const createMut = useMutation({
    mutationFn: createBuchung,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['buchungen', pid] })
      setMsg({ text: 'Buchung gespeichert ✅', type: 'success' })
      setForm(emptyForm())
      setShowForm(false)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteBuchung,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['buchungen', pid] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!pid || !form.EMPLOYEE_ID || !form.DATE_VOUCHER || !form.QUANTITY_INT || !form.CP_RATE || !form.QUANTITY_EXT || !form.SP_RATE || !form.POSTING_DESCRIPTION) {
      setMsg({ text: 'Bitte alle Pflichtfelder ausfüllen', type: 'error' }); return
    }
    createMut.mutate({
      PROJECT_ID:          pid,
      STRUCTURE_ID:        form.STRUCTURE_ID  ? Number(form.STRUCTURE_ID) : undefined,
      EMPLOYEE_ID:         Number(form.EMPLOYEE_ID),
      DATE_VOUCHER:        form.DATE_VOUCHER,
      TIME_START:          form.TIME_START  || undefined,
      TIME_FINISH:         form.TIME_FINISH || undefined,
      QUANTITY_INT:        Number(form.QUANTITY_INT),
      CP_RATE:             Number(form.CP_RATE),
      QUANTITY_EXT:        Number(form.QUANTITY_EXT),
      SP_RATE:             Number(form.SP_RATE),
      POSTING_DESCRIPTION: form.POSTING_DESCRIPTION,
    })
  }

  const setF = (k: keyof BuchungForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  function confirmDelete(b: Buchung) {
    if (!window.confirm(`Buchung vom ${fmtDate(b.DATE_VOUCHER)} löschen?`)) return
    setMsg(null)
    deleteMut.mutate(b.ID)
  }

  return (
    <div>
      <div className="form-group" style={{ maxWidth: 400, marginBottom: 12 }}>
        <label>Projekt</label>
        <select value={pid ?? ''} onChange={e => { setPid(e.target.value ? Number(e.target.value) : null); setMsg(null); setShowForm(false) }}>
          <option value="">Bitte wählen …</option>
          {projects.map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>)}
        </select>
      </div>

      {pid !== null && (
        <>
          {isLoading && <p className="empty-note">Laden …</p>}
          {!isLoading && (
            <>
              {/* Summary row */}
              <div className="buchungen-summary">
                <span>Einträge: <strong>{buchungen.length}</strong></span>
                <span>Stunden (int): <strong>{fmtN(totalIntH)}</strong></span>
                <span>Kosten: <strong>{fmtN(totalCost)} €</strong></span>
                <span>Erlös: <strong>{fmtN(totalRev)} €</strong></span>
              </div>

              <div className="list-section">
                <table className="master-table">
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Mitarbeiter</th>
                      <th>Beschreibung</th>
                      <th className="num">h int.</th>
                      <th className="num">h ext.</th>
                      <th className="num">Kosten €</th>
                      <th className="num">Erlös €</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {buchungen.map(b => (
                      <tr key={b.ID}>
                        <td>{fmtDate(b.DATE_VOUCHER)}</td>
                        <td>{b.EMPLOYEE?.SHORT_NAME}</td>
                        <td>{b.POSTING_DESCRIPTION}</td>
                        <td className="num">{fmtN(b.QUANTITY_INT)}</td>
                        <td className="num">{fmtN(b.QUANTITY_EXT)}</td>
                        <td className="num">{fmtN(b.CP_TOT)}</td>
                        <td className="num">{fmtN(b.SP_TOT)}</td>
                        <td><button className="btn-small" onClick={() => confirmDelete(b)}>×</button></td>
                      </tr>
                    ))}
                    {!buchungen.length && <tr><td colSpan={8} className="empty-note">Keine Buchungen</td></tr>}
                  </tbody>
                </table>
              </div>

              <button className="btn-small btn-save" style={{ marginTop: 10 }} onClick={() => { setShowForm(!showForm); setMsg(null) }}>
                {showForm ? 'Formular schließen' : '+ Neue Buchung'}
              </button>

              {showForm && (
                <form onSubmit={submitForm} className="master-form" style={{ marginTop: 12 }}>
                  <div className="form-group">
                    <label>Mitarbeiter*</label>
                    <select value={form.EMPLOYEE_ID} onChange={setF('EMPLOYEE_ID')} required>
                      <option value="">Bitte wählen …</option>
                      {employees.map(e => <option key={e.ID} value={e.ID}>{e.SHORT_NAME}: {e.FIRST_NAME} {e.LAST_NAME}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Strukturelement</label>
                    <select value={form.STRUCTURE_ID} onChange={setF('STRUCTURE_ID')}>
                      <option value="">—</option>
                      {structure.map(s => <option key={s.STRUCTURE_ID} value={s.STRUCTURE_ID}>{s.NAME_SHORT} – {s.NAME_LONG}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <FormField label="Datum*"      id="bda" type="date"   value={form.DATE_VOUCHER}  onChange={setF('DATE_VOUCHER')} required />
                    <FormField label="Von"         id="bts" type="time"   value={form.TIME_START}    onChange={setF('TIME_START')} />
                    <FormField label="Bis"         id="btf" type="time"   value={form.TIME_FINISH}   onChange={setF('TIME_FINISH')} />
                  </div>
                  <div className="form-row">
                    <FormField label="Stunden int.*" id="bqi" type="number" value={form.QUANTITY_INT}  onChange={setF('QUANTITY_INT')} step="0.25" required />
                    <FormField label="Stunden ext.*" id="bqe" type="number" value={form.QUANTITY_EXT}  onChange={setF('QUANTITY_EXT')} step="0.25" required />
                  </div>
                  <div className="form-row">
                    <FormField label="Kostenrate*"   id="bcr" type="number" value={form.CP_RATE}       onChange={setF('CP_RATE')} step="0.01" required />
                    <FormField label="Erlösrate*"    id="bsr" type="number" value={form.SP_RATE}       onChange={setF('SP_RATE')} step="0.01" required />
                  </div>
                  <div className="form-group">
                    <label>Beschreibung*</label>
                    <textarea rows={2} value={form.POSTING_DESCRIPTION} onChange={setF('POSTING_DESCRIPTION')} required
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(17,24,39,0.10)', borderRadius: 12, fontSize: 15, outline: 'none' }} />
                  </div>
                  <Message text={msg?.text ?? null} type={msg?.type} />
                  <button className="btn-primary" type="submit" disabled={createMut.isPending}>
                    {createMut.isPending ? 'Speichert …' : 'Buchung speichern'}
                  </button>
                </form>
              )}
              {!showForm && <Message text={msg?.text ?? null} type={msg?.type} />}
            </>
          )}
        </>
      )}
    </div>
  )
}
