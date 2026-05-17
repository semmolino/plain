import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Tabs }      from '@/components/ui/Tabs'
import { Modal }     from '@/components/ui/Modal'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'
import { useCtrlS }  from '@/hooks/useCtrlS'
import {
  fetchEmployeeList, fetchEmployeeGenders, createEmployee, updateEmployee, deleteEmployee,
  fetchEmployeeWorkModels, createEmployeeWorkModel, updateEmployeeWorkModel, deleteEmployeeWorkModel,
  fetchEmployeeCpRates, createEmployeeCpRate, updateEmployeeCpRate, deleteEmployeeCpRate,
  fetchMonthBalance, fetchRunningBalance,
  type Employee, type CreateEmployeePayload, type UpdateEmployeePayload,
  type EmployeeWorkModel, type EmployeeCpRate, type MonthBalance, type RunningMonth,
} from '@/api/mitarbeiter'
import { fetchDepartments, fetchWorkingTimeModels, type StammdatenItem, type WorkingTimeModel } from '@/api/stammdaten'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25
const TABS = [
  { id: 'list',      label: 'Mitarbeiterliste' },
  { id: 'create',    label: 'Anlegen'          },
  { id: 'reporting', label: 'Reporting'        },
]
const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const MONTH_NAMES   = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

type SortKey = 'SHORT_NAME' | 'FIRST_NAME' | 'LAST_NAME' | 'MAIL'

function fmtH(n: number) {
  return n.toFixed(2).replace('.', ',') + ' h'
}
function fmtBalance(n: number) {
  const s = Math.abs(n).toFixed(2).replace('.', ',') + ' h'
  return n >= 0 ? `+${s}` : `−${s}`
}

function emptyCreateForm(): CreateEmployeePayload {
  return { short_name: '', title: '', first_name: '', last_name: '', password: '', email: '', mobile: '', personnel_number: '', gender_id: '' }
}

// ── FilterChip ────────────────────────────────────────────────────────────────

function FilterChip({ label, options, active, onChange }: {
  label: string; options: string[]; active: Set<string>; onChange: (v: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function toggle(val: string) { const s = new Set(active); s.has(val) ? s.delete(val) : s.add(val); onChange(s) }
  const count = active.size
  return (
    <div ref={ref} className="filter-chip-wrap">
      <button className={`filter-chip-btn${count > 0 ? ' active' : ''}`} onClick={() => setOpen(o => !o)}>
        {label}{count > 0 ? ` (${count})` : ''} ▾
      </button>
      {count > 0 && <button className="filter-chip-clear" onClick={() => { onChange(new Set()); setOpen(false) }} title="Zurücksetzen">×</button>}
      {open && (
        <div className="filter-chip-dropdown">
          {options.length === 0 ? <div className="filter-chip-empty">Keine Optionen</div> : options.map(opt => (
            <label key={opt} className="filter-chip-option">
              <input type="checkbox" checked={active.has(opt)} onChange={() => toggle(opt)} />
              {opt || '(ohne)'}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── SortTh ────────────────────────────────────────────────────────────────────

function SortTh({ label, sortKey, current, dir, onClick }: {
  label: string; sortKey: SortKey; current: SortKey; dir: 'asc' | 'desc'; onClick: (k: SortKey) => void
}) {
  const active = current === sortKey
  return (
    <th className="sortable-th" onClick={() => onClick(sortKey)}>
      {label} {active ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )
}

// ── Employee Edit Modal ───────────────────────────────────────────────────────

function EmployeeEditModal({ employee, onClose, genders, departments, workModels }: {
  employee:    Employee
  onClose:     () => void
  genders:     Array<{ ID: number; GENDER: string }>
  departments: StammdatenItem[]
  workModels:  WorkingTimeModel[]
}) {
  const qc = useQueryClient()
  const [section,  setSection]  = useState<'stammdaten' | 'kostensatz' | 'arbeitszeit'>('stammdaten')
  const [editForm, setEditForm] = useState<UpdateEmployeePayload>({
    short_name:       employee.SHORT_NAME ?? '',
    title:            employee.TITLE ?? '',
    first_name:       employee.FIRST_NAME ?? '',
    last_name:        employee.LAST_NAME ?? '',
    mail:             employee.MAIL ?? '',
    mobile:           employee.MOBILE ?? '',
    personnel_number: employee.PERSONNEL_NUMBER ?? '',
    gender_id:        employee.GENDER_ID ?? 0,
    department_id:    employee.DEPARTMENT_ID ?? null,
    active:           employee.ACTIVE ?? 1,
  })
  const [editMsg, setEditMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const editFormRef = useRef<HTMLFormElement>(null)

  // CP rate history state
  const [newCpRate,       setNewCpRate]       = useState('')
  const [newCpValidFrom,  setNewCpValidFrom]  = useState('')
  const [editingCpId,     setEditingCpId]     = useState<number | null>(null)
  const [editCpForm,      setEditCpForm]      = useState({ cp_rate: '', valid_from: '' })
  const [cpMsg,           setCpMsg]           = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Work model history state
  const [newWmModelId,    setNewWmModelId]    = useState('')
  const [newWmValidFrom,  setNewWmValidFrom]  = useState('')
  const [editingWmId,     setEditingWmId]     = useState<number | null>(null)
  const [editWmForm,      setEditWmForm]      = useState({ model_id: '', valid_from: '' })
  const [wmMsg,           setWmMsg]           = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: cpRatesRes }    = useQuery({ queryKey: ['emp-cp-rates',    employee.ID], queryFn: () => fetchEmployeeCpRates(employee.ID)   })
  const { data: workModelsRes } = useQuery({ queryKey: ['emp-work-models', employee.ID], queryFn: () => fetchEmployeeWorkModels(employee.ID) })
  const cpRates:   EmployeeCpRate[]    = cpRatesRes?.data   ?? []
  const empWmList: EmployeeWorkModel[] = workModelsRes?.data ?? []

  const [saving, setSaving]   = useState(false)
  const [cpSaving, setCpSaving] = useState(false)
  const [wmSaving, setWmSaving] = useState(false)

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    setEditMsg(null)
    if (!editForm.short_name || !editForm.first_name || !editForm.last_name || !editForm.gender_id) {
      setEditMsg({ text: 'Pflichtfelder ausfüllen', type: 'error' }); return
    }
    setSaving(true)
    try {
      await updateEmployee(employee.ID, editForm)
      void qc.invalidateQueries({ queryKey: ['employees'] })
      setEditMsg({ text: 'Gespeichert ✅', type: 'success' })
      setTimeout(() => onClose(), 700)
    } catch (e: unknown) {
      setEditMsg({ text: (e as Error).message, type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const setE = (k: keyof UpdateEmployeePayload) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditForm(f => ({ ...f, [k]: k === 'gender_id' || k === 'active' ? Number(e.target.value) : e.target.value }))

  useCtrlS(() => editFormRef.current?.requestSubmit(), section === 'stammdaten')

  async function addCpRate() {
    setCpMsg(null)
    if (!newCpRate || !newCpValidFrom) { setCpMsg({ text: 'Kostensatz und Datum erforderlich', type: 'error' }); return }
    setCpSaving(true)
    try {
      await createEmployeeCpRate(employee.ID, { cp_rate: parseFloat(newCpRate), valid_from: newCpValidFrom })
      void qc.invalidateQueries({ queryKey: ['emp-cp-rates', employee.ID] })
      setNewCpRate(''); setNewCpValidFrom('')
    } catch (e: unknown) { setCpMsg({ text: (e as Error).message, type: 'error' }) }
    finally { setCpSaving(false) }
  }

  async function saveCpRate(id: number) {
    setCpSaving(true)
    try {
      await updateEmployeeCpRate(employee.ID, id, { cp_rate: parseFloat(editCpForm.cp_rate), valid_from: editCpForm.valid_from })
      void qc.invalidateQueries({ queryKey: ['emp-cp-rates', employee.ID] })
      setEditingCpId(null)
    } catch (e: unknown) { setCpMsg({ text: (e as Error).message, type: 'error' }) }
    finally { setCpSaving(false) }
  }

  async function deleteCpRate(id: number) {
    try {
      await deleteEmployeeCpRate(employee.ID, id)
      void qc.invalidateQueries({ queryKey: ['emp-cp-rates', employee.ID] })
    } catch (e: unknown) { setCpMsg({ text: (e as Error).message, type: 'error' }) }
  }

  async function addWorkModel() {
    setWmMsg(null)
    if (!newWmModelId || !newWmValidFrom) { setWmMsg({ text: 'Modell und Datum erforderlich', type: 'error' }); return }
    setWmSaving(true)
    try {
      await createEmployeeWorkModel(employee.ID, { model_id: Number(newWmModelId), valid_from: newWmValidFrom })
      void qc.invalidateQueries({ queryKey: ['emp-work-models', employee.ID] })
      setNewWmModelId(''); setNewWmValidFrom('')
    } catch (e: unknown) { setWmMsg({ text: (e as Error).message, type: 'error' }) }
    finally { setWmSaving(false) }
  }

  async function saveWorkModel(id: number) {
    setWmSaving(true)
    try {
      await updateEmployeeWorkModel(employee.ID, id, { model_id: Number(editWmForm.model_id), valid_from: editWmForm.valid_from })
      void qc.invalidateQueries({ queryKey: ['emp-work-models', employee.ID] })
      setEditingWmId(null)
    } catch (e: unknown) { setWmMsg({ text: (e as Error).message, type: 'error' }) }
    finally { setWmSaving(false) }
  }

  async function deleteWorkModel(id: number) {
    try {
      await deleteEmployeeWorkModel(employee.ID, id)
      void qc.invalidateQueries({ queryKey: ['emp-work-models', employee.ID] })
    } catch (e: unknown) { setWmMsg({ text: (e as Error).message, type: 'error' }) }
  }

  const sectionBtnStyle = (s: string) => ({
    padding: '4px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
    border: '1px solid #d1d5db', borderRadius: 4, marginRight: 4,
    background: section === s ? '#1d4ed8' : '#fff',
    color: section === s ? '#fff' : '#374151',
  })

  return (
    <>
      <div style={{ display: 'flex', marginBottom: 16 }}>
        <button type="button" style={sectionBtnStyle('stammdaten')}  onClick={() => setSection('stammdaten')}>Stammdaten</button>
        <button type="button" style={sectionBtnStyle('kostensatz')}  onClick={() => setSection('kostensatz')}>Kostensatz</button>
        <button type="button" style={sectionBtnStyle('arbeitszeit')} onClick={() => setSection('arbeitszeit')}>Arbeitszeit</button>
      </div>

      {section === 'stammdaten' && (
        <form ref={editFormRef} onSubmit={submitEdit} className="master-form">
          <FormField label="Kürzel*"      id="eku" value={editForm.short_name}         onChange={setE('short_name')} required />
          <FormField label="Titel"        id="eti" value={editForm.title ?? ''}         onChange={setE('title')} />
          <div className="form-row">
            <FormField label="Vorname*"   id="efn" value={editForm.first_name}          onChange={setE('first_name')} required />
            <FormField label="Nachname*"  id="eln" value={editForm.last_name}           onChange={setE('last_name')} required />
          </div>
          <FormField label="E-Mail"       id="eem" value={editForm.mail ?? ''}          onChange={setE('mail')} type="email" />
          <FormField label="Mobil"        id="emo" value={editForm.mobile ?? ''}        onChange={setE('mobile')} />
          <FormField label="Personalnr."  id="epn" value={editForm.personnel_number ?? ''} onChange={setE('personnel_number')} />
          <div className="form-group">
            <label htmlFor="ege">Geschlecht*</label>
            <select id="ege" value={String(editForm.gender_id)} onChange={setE('gender_id')} required>
              <option value="">Bitte wählen …</option>
              {genders.map(g => <option key={g.ID} value={g.ID}>{g.GENDER}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="edept">Abteilung</label>
            <select id="edept" value={editForm.department_id ?? ''} onChange={e => setEditForm(f => ({ ...f, department_id: e.target.value ? Number(e.target.value) : null }))}>
              <option value="">— keine —</option>
              {departments.map(d => <option key={d.ID} value={d.ID}>{d.NAME_SHORT}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="eact">Status</label>
            <select id="eact" value={String(editForm.active ?? 1)} onChange={setE('active')}>
              <option value="1">Aktiv</option>
              <option value="2">Inaktiv</option>
            </select>
          </div>
          <Message text={editMsg?.text ?? null} type={editMsg?.type} />
          <div className="modal-actions">
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" onClick={onClose}>Abbrechen</button>
          </div>
        </form>
      )}

      {section === 'kostensatz' && (
        <div>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
            Gilt ab dem angegebenen Datum. Der aktuell gültige Satz ist der mit dem neuesten Datum.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: 12 }}>
                <th style={{ textAlign: 'left', padding: '3px 8px 4px 0' }}>Gültig ab</th>
                <th style={{ textAlign: 'right', padding: '3px 0 4px 8px' }}>Kostensatz (€/h)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cpRates.map(r => (
                <tr key={r.ID} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  {editingCpId === r.ID ? (
                    <>
                      <td style={{ padding: '3px 8px 3px 0' }}>
                        <input type="date" className="tbl-input" value={editCpForm.valid_from} onChange={e => setEditCpForm(f => ({ ...f, valid_from: e.target.value }))} />
                      </td>
                      <td style={{ padding: '3px 0 3px 8px', textAlign: 'right' }}>
                        <input type="number" step="0.01" min="0" className="tbl-input num" style={{ width: 80 }} value={editCpForm.cp_rate} onChange={e => setEditCpForm(f => ({ ...f, cp_rate: e.target.value }))} />
                      </td>
                      <td style={{ padding: '3px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button type="button" className="btn-small btn-save" style={{ padding: '1px 6px', fontSize: 11 }} disabled={cpSaving} onClick={() => saveCpRate(r.ID)}>✓</button>
                        <button type="button" className="btn-small" style={{ padding: '1px 6px', fontSize: 11, marginLeft: 2 }} onClick={() => setEditingCpId(null)}>✗</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '3px 8px 3px 0' }}>{r.VALID_FROM}</td>
                      <td style={{ padding: '3px 0 3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {Number(r.CP_RATE).toFixed(2)} €/h
                      </td>
                      <td style={{ padding: '3px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button type="button" className="btn-small" style={{ padding: '1px 6px', fontSize: 11, marginRight: 2 }} onClick={() => { setEditingCpId(r.ID); setEditCpForm({ cp_rate: String(r.CP_RATE), valid_from: r.VALID_FROM }) }}>✎</button>
                        <button type="button" className="btn-small btn-danger" style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => deleteCpRate(r.ID)}>×</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {!cpRates.length && (
                <tr><td colSpan={3} style={{ color: '#9ca3af', fontSize: 12, padding: '4px 0' }}>Noch kein Verlauf erfasst.</td></tr>
              )}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 12 }}>Gültig ab</label>
              <input type="date" value={newCpValidFrom} onChange={e => setNewCpValidFrom(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 12 }}>Kostensatz (€/h)</label>
              <input type="number" step="0.01" min="0" value={newCpRate} onChange={e => setNewCpRate(e.target.value)} placeholder="z. B. 85.00" />
            </div>
            <button type="button" className="btn-small btn-save" disabled={!newCpRate || !newCpValidFrom || cpSaving} onClick={addCpRate}>
              Eintrag hinzufügen
            </button>
          </div>
          <Message text={cpMsg?.text ?? null} type={cpMsg?.type} />
        </div>
      )}

      {section === 'arbeitszeit' && (
        <div>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
            Das Modell mit dem neuesten Datum vor dem jeweiligen Tag bestimmt die Soll-Arbeitszeit.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: 12 }}>
                <th style={{ textAlign: 'left', padding: '3px 8px 4px 0' }}>Gültig ab</th>
                <th style={{ textAlign: 'left', padding: '3px 0 4px 8px' }}>Modell</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {empWmList.map(wm => (
                <tr key={wm.ID} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  {editingWmId === wm.ID ? (
                    <>
                      <td style={{ padding: '3px 8px 3px 0' }}>
                        <input type="date" className="tbl-input" value={editWmForm.valid_from} onChange={e => setEditWmForm(f => ({ ...f, valid_from: e.target.value }))} />
                      </td>
                      <td style={{ padding: '3px 0 3px 8px' }}>
                        <select className="tbl-input" value={editWmForm.model_id} onChange={e => setEditWmForm(f => ({ ...f, model_id: e.target.value }))}>
                          <option value="">Bitte wählen …</option>
                          {workModels.map(m => <option key={m.ID} value={m.ID}>{m.NAME}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '3px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button type="button" className="btn-small btn-save" style={{ padding: '1px 6px', fontSize: 11 }} disabled={wmSaving} onClick={() => saveWorkModel(wm.ID)}>✓</button>
                        <button type="button" className="btn-small" style={{ padding: '1px 6px', fontSize: 11, marginLeft: 2 }} onClick={() => setEditingWmId(null)}>✗</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '3px 8px 3px 0' }}>{wm.VALID_FROM}</td>
                      <td style={{ padding: '3px 0 3px 8px' }}>{wm.model?.NAME ?? `Modell ${wm.MODEL_ID}`}</td>
                      <td style={{ padding: '3px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button type="button" className="btn-small" style={{ padding: '1px 6px', fontSize: 11, marginRight: 2 }} onClick={() => { setEditingWmId(wm.ID); setEditWmForm({ model_id: String(wm.MODEL_ID), valid_from: wm.VALID_FROM }) }}>✎</button>
                        <button type="button" className="btn-small btn-danger" style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => deleteWorkModel(wm.ID)}>×</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {!empWmList.length && (
                <tr><td colSpan={3} style={{ color: '#9ca3af', fontSize: 12, padding: '4px 0' }}>Kein Modell zugewiesen.</td></tr>
              )}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 12 }}>Gültig ab</label>
              <input type="date" value={newWmValidFrom} onChange={e => setNewWmValidFrom(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 12 }}>Modell</label>
              <select value={newWmModelId} onChange={e => setNewWmModelId(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {workModels.map(m => <option key={m.ID} value={m.ID}>{m.NAME}</option>)}
              </select>
            </div>
            <button type="button" className="btn-small btn-save" disabled={!newWmModelId || !newWmValidFrom || wmSaving} onClick={addWorkModel}>
              Zuweisung hinzufügen
            </button>
          </div>
          <Message text={wmMsg?.text ?? null} type={wmMsg?.type} />
        </div>
      )}
    </>
  )
}

// ── Reporting Tab ─────────────────────────────────────────────────────────────

function ReportingTab({ employees }: { employees: Employee[] }) {
  const [empId,    setEmpId]    = useState<number | null>(null)
  const [year,     setYear]     = useState(new Date().getFullYear())
  const [month,    setMonth]    = useState(new Date().getMonth() + 1)
  const [viewMode, setViewMode] = useState<'month' | 'running'>('month')

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else             setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else               setMonth(m => m + 1)
  }

  const { data: monthRes, isLoading: loadingMonth } = useQuery({
    queryKey: ['emp-balance-month', empId, year, month],
    queryFn:  () => fetchMonthBalance(empId!, year, month),
    enabled:  empId !== null && viewMode === 'month',
  })
  const { data: runningRes, isLoading: loadingRunning } = useQuery({
    queryKey: ['emp-balance-running', empId],
    queryFn:  () => fetchRunningBalance(empId!),
    enabled:  empId !== null && viewMode === 'running',
  })

  const monthData: MonthBalance | undefined = monthRes?.data
  const runningData = runningRes?.data

  const balanceColor = (n: number) => n > 0 ? '#059669' : n < 0 ? '#dc2626' : '#6b7280'

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 220 }}>
          <label style={{ fontSize: 12 }}>Mitarbeiter</label>
          <select value={empId ?? ''} onChange={e => setEmpId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Mitarbeiter wählen —</option>
            {employees.map(e => <option key={e.ID} value={e.ID}>{e.SHORT_NAME} – {e.FIRST_NAME} {e.LAST_NAME}</option>)}
          </select>
        </div>

        {empId && viewMode === 'month' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" className="btn-small" onClick={prevMonth}>◀</button>
            <span style={{ fontWeight: 600, minWidth: 110, textAlign: 'center', fontSize: 14 }}>
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button type="button" className="btn-small" onClick={nextMonth}>▶</button>
          </div>
        )}

        {empId && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className={`btn-small${viewMode === 'month'   ? ' btn-save' : ''}`} onClick={() => setViewMode('month')}>Monat</button>
            <button type="button" className={`btn-small${viewMode === 'running' ? ' btn-save' : ''}`} onClick={() => setViewMode('running')}>Verlauf</button>
          </div>
        )}
      </div>

      {!empId && (
        <p className="empty-note">Mitarbeiter auswählen, um das Reporting anzuzeigen.</p>
      )}

      {empId && viewMode === 'month' && (
        <>
          {loadingMonth && <p className="empty-note">Laden …</p>}
          {monthData && (
            <>
              <div style={{ display: 'flex', gap: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 16px', marginBottom: 14, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>Soll</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{fmtH(monthData.required)}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>Ist</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{fmtH(monthData.actual)}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>Saldo</div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: balanceColor(monthData.balance) }}>{fmtBalance(monthData.balance)}</div>
                </div>
              </div>

              {!monthData.days.length && (
                <p className="empty-note">Kein Arbeitszeitmodell für diesen Zeitraum zugewiesen.</p>
              )}
              {monthData.days.length > 0 && (
                <table className="master-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Datum</th>
                      <th style={{ width: 28 }}>Tag</th>
                      <th style={{ textAlign: 'right', width: 64 }}>Soll</th>
                      <th style={{ textAlign: 'right', width: 64 }}>Ist</th>
                      <th style={{ textAlign: 'right', width: 80 }}>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthData.days.map(d => {
                      const isWeekend  = d.weekday === 0 || d.weekday === 6
                      const rowStyle: React.CSSProperties = {
                        background: isWeekend ? '#f9fafb' : undefined,
                        color:      isWeekend ? '#9ca3af' : undefined,
                      }
                      return (
                        <tr key={d.date} style={rowStyle}>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {d.isHoliday && <span title="Feiertag" style={{ marginRight: 4 }}>🏖</span>}
                            {d.date}
                          </td>
                          <td style={{ color: '#6b7280' }}>{WEEKDAY_SHORT[d.weekday]}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {d.required > 0 ? fmtH(d.required) : <span style={{ color: '#d1d5db' }}>—</span>}
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {d.actual > 0 ? fmtH(d.actual) : <span style={{ color: '#d1d5db' }}>—</span>}
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: d.required > 0 ? balanceColor(d.balance) : '#d1d5db', fontWeight: d.required > 0 ? 600 : 400 }}>
                            {d.required > 0 ? fmtBalance(d.balance) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}

      {empId && viewMode === 'running' && (
        <>
          {loadingRunning && <p className="empty-note">Laden …</p>}
          {runningData && runningData.months.length === 0 && (
            <p className="empty-note">Kein Arbeitszeitmodell hinterlegt oder noch keine Buchungen.</p>
          )}
          {runningData && runningData.months.length > 0 && (
            <>
              <div style={{ marginBottom: 10, fontWeight: 600, fontSize: 14 }}>
                Gesamtsaldo: <span style={{ color: balanceColor(runningData.totalBalance) }}>{fmtBalance(runningData.totalBalance)}</span>
              </div>
              <table className="master-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Monat</th>
                    <th style={{ textAlign: 'right' }}>Soll</th>
                    <th style={{ textAlign: 'right' }}>Ist</th>
                    <th style={{ textAlign: 'right' }}>Saldo</th>
                    <th style={{ textAlign: 'right' }}>Kumuliert</th>
                  </tr>
                </thead>
                <tbody>
                  {runningData.months.map((rm: RunningMonth) => (
                    <tr key={`${rm.year}-${rm.month}`}>
                      <td>{MONTH_NAMES[rm.month - 1]} {rm.year}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtH(rm.required)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtH(rm.actual)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: balanceColor(rm.balance) }}>{fmtBalance(rm.balance)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: balanceColor(rm.cumulative) }}>{fmtBalance(rm.cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function MitarbeiterPage() {
  const qc = useQueryClient()
  const [tab,       setTab]      = useState('list')
  const [search,    setSearch]   = useState('')
  const [activeAbt,     setActiveAbt]     = useState<Set<string>>(new Set())
  const [activeStatus,  setActiveStatus]  = useState<Set<string>>(new Set())
  const [activeModel,   setActiveModel]   = useState<Set<string>>(new Set())
  const [sortKey,   setSortKey]  = useState<SortKey>('SHORT_NAME')
  const [sortDir,   setSortDir]  = useState<'asc' | 'desc'>('asc')
  const [page,      setPage]     = useState(1)
  const [editRow,   setEditRow]  = useState<Employee | null>(null)
  const [form,      setForm]     = useState<CreateEmployeePayload>(emptyCreateForm)
  const [createWmModelId,    setCreateWmModelId]    = useState('')
  const [createWmValidFrom,  setCreateWmValidFrom]  = useState('')
  const [createCpRate,       setCreateCpRate]       = useState('')
  const [createCpValidFrom,  setCreateCpValidFrom]  = useState('')
  const [createMsg, setCreateMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [creating,  setCreating] = useState(false)
  const createFormRef = useRef<HTMLFormElement>(null)

  const { data: listData,   isLoading } = useQuery({ queryKey: ['employees'],           queryFn: fetchEmployeeList      })
  const { data: genData }               = useQuery({ queryKey: ['emp-genders'],         queryFn: fetchEmployeeGenders   })
  const { data: deptData }              = useQuery({ queryKey: ['departments'],         queryFn: fetchDepartments       })
  const { data: wtmData }               = useQuery({ queryKey: ['working-time-models'], queryFn: fetchWorkingTimeModels })

  const employees  = listData?.data  ?? []
  const genders    = genData?.data   ?? []
  const departments = deptData?.data ?? []
  const workModels = wtmData?.data   ?? []

  // Derive filter option lists from data
  const filterOptions = useMemo(() => {
    const abt    = [...new Set(employees.map(e => e.DEPARTMENT_NAME).filter(Boolean))].sort()
    const status = ['Aktiv', 'Inaktiv']
    const model  = [...new Set(employees.map(e => e.CURRENT_MODEL_NAME).filter(Boolean))].sort()
    return { abt, status, model }
  }, [employees])

  const processed = useMemo(() => {
    let rows = employees
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(r =>
        [r.SHORT_NAME, r.FIRST_NAME, r.LAST_NAME, r.MAIL, r.MOBILE, r.PERSONNEL_NUMBER, r.DEPARTMENT_NAME]
          .map(v => String(v ?? '')).join(' ').toLowerCase().includes(q)
      )
    }
    if (activeAbt.size > 0)    rows = rows.filter(r => activeAbt.has(r.DEPARTMENT_NAME))
    if (activeStatus.size > 0) rows = rows.filter(r => {
      const label = (r.ACTIVE === 2) ? 'Inaktiv' : 'Aktiv'
      return activeStatus.has(label)
    })
    if (activeModel.size > 0)  rows = rows.filter(r => activeModel.has(r.CURRENT_MODEL_NAME))
    rows = [...rows].sort((a, b) => {
      const av = String(a[sortKey] ?? '')
      const bv = String(b[sortKey] ?? '')
      return sortDir === 'asc'
        ? av.localeCompare(bv, 'de', { sensitivity: 'base', numeric: true })
        : bv.localeCompare(av, 'de', { sensitivity: 'base', numeric: true })
    })
    return rows
  }, [employees, search, sortKey, sortDir, activeAbt, activeStatus, activeModel])

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = processed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  async function handleDelete(row: Employee) {
    if (!window.confirm(`${row.SHORT_NAME}: ${row.FIRST_NAME} ${row.LAST_NAME} wirklich löschen?`)) return
    try {
      await deleteEmployee(row.ID)
      void qc.invalidateQueries({ queryKey: ['employees'] })
    } catch (e: unknown) { alert((e as Error).message) }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateMsg(null)
    if (!form.short_name || !form.first_name || !form.last_name || !form.gender_id) {
      setCreateMsg({ text: 'Kürzel, Vorname, Nachname und Geschlecht sind Pflichtfelder', type: 'error' }); return
    }
    if (!createWmModelId || !createWmValidFrom) {
      setCreateMsg({ text: 'Arbeitszeitmodell und Gültig-ab-Datum sind Pflichtfelder', type: 'error' }); return
    }
    if (!createCpRate || !createCpValidFrom) {
      setCreateMsg({ text: 'Kostensatz und Gültig-ab-Datum sind Pflichtfelder', type: 'error' }); return
    }
    setCreating(true)
    try {
      const res = await createEmployee(form)
      const empId = res.data.ID
      await createEmployeeWorkModel(empId, { model_id: Number(createWmModelId), valid_from: createWmValidFrom })
      await createEmployeeCpRate(empId, { cp_rate: parseFloat(createCpRate), valid_from: createCpValidFrom })
      void qc.invalidateQueries({ queryKey: ['employees'] })
      setCreateMsg({ text: 'Mitarbeiter gespeichert ✅', type: 'success' })
      setForm(emptyCreateForm())
      setCreateWmModelId(''); setCreateWmValidFrom('')
      setCreateCpRate(''); setCreateCpValidFrom('')
    } catch (e: unknown) {
      setCreateMsg({ text: (e as Error).message, type: 'error' })
    } finally {
      setCreating(false)
    }
  }

  useCtrlS(() => createFormRef.current?.requestSubmit(), tab === 'create')

  const setF = (k: keyof CreateEmployeePayload) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const sortProps = { current: sortKey, dir: sortDir, onClick: toggleSort }

  const hasActiveFilter = activeAbt.size > 0 || activeStatus.size > 0 || activeModel.size > 0

  return (
    <div className="master-page">
      <div className="master-page-header">
        <h1 className="master-page-title">Mitarbeiter</h1>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={t => { setTab(t); setCreateMsg(null) }} />

      <div className="master-section">
        {tab === 'list' && (
          <>
            <div className="list-toolbar">
              <input
                className="list-search"
                placeholder="Suchen …"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
              />
              <span className="list-info">
                {processed.length} Mitarbeiter · Seite {safePage}/{totalPages}
              </span>
            </div>

            <div className="pl-filter-chips">
              <FilterChip label="Abteilung" options={filterOptions.abt}    active={activeAbt}    onChange={v => { setActiveAbt(v);    setPage(1) }} />
              <FilterChip label="Status"    options={filterOptions.status}  active={activeStatus}  onChange={v => { setActiveStatus(v); setPage(1) }} />
              <FilterChip label="Modell"    options={filterOptions.model}   active={activeModel}   onChange={v => { setActiveModel(v);  setPage(1) }} />
              {hasActiveFilter && (
                <button className="pl-clear-btn" onClick={() => { setActiveAbt(new Set()); setActiveStatus(new Set()); setActiveModel(new Set()); setSearch('') }}>
                  Filter löschen
                </button>
              )}
            </div>

            {isLoading && <p className="empty-note">Laden …</p>}
            {!isLoading && (
              <>
                <table className="master-table">
                  <thead>
                    <tr>
                      <SortTh label="Kürzel"    sortKey="SHORT_NAME" {...sortProps} />
                      <SortTh label="Vorname"   sortKey="FIRST_NAME" {...sortProps} />
                      <SortTh label="Nachname"  sortKey="LAST_NAME"  {...sortProps} />
                      <SortTh label="E-Mail"    sortKey="MAIL"       {...sortProps} />
                      <th>Abteilung</th>
                      <th>Modell</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(r => (
                      <tr key={r.ID}>
                        <td>{r.SHORT_NAME}</td>
                        <td>{r.FIRST_NAME}</td>
                        <td>{r.LAST_NAME}</td>
                        <td>{r.MAIL}</td>
                        <td>{r.DEPARTMENT_NAME || <span style={{ color: '#d1d5db' }}>—</span>}</td>
                        <td>{r.CURRENT_MODEL_NAME || <span style={{ color: '#d1d5db' }}>—</span>}</td>
                        <td>
                          <span style={{
                            fontSize: 11, padding: '2px 7px', borderRadius: 10, fontWeight: 500,
                            background: r.ACTIVE === 2 ? '#fee2e2' : '#dcfce7',
                            color:      r.ACTIVE === 2 ? '#b91c1c' : '#166534',
                          }}>
                            {r.ACTIVE === 2 ? 'Inaktiv' : 'Aktiv'}
                          </span>
                        </td>
                        <td className="doc-actions">
                          <button className="btn-small" onClick={() => setEditRow(r)}>Bearbeiten</button>
                          <button className="btn-small btn-danger" onClick={() => handleDelete(r)}>Löschen</button>
                        </td>
                      </tr>
                    ))}
                    {!pageRows.length && <tr><td colSpan={8} className="empty-note">Keine Einträge</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                      <td colSpan={8} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                        {processed.length !== employees.length ? `${processed.length} / ${employees.length} Einträge` : `${employees.length} Einträge`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <div className="pagination">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>← Zurück</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>Weiter →</button>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'create' && (
          <form ref={createFormRef} onSubmit={submitCreate} className="master-form">
            <FormField label="Kürzel*"     id="mku" value={form.short_name}          onChange={setF('short_name')} required />
            <FormField label="Titel"       id="mti" value={form.title ?? ''}          onChange={setF('title')} />
            <div className="form-row">
              <FormField label="Vorname*"  id="mfn" value={form.first_name}          onChange={setF('first_name')} required />
              <FormField label="Nachname*" id="mln" value={form.last_name}           onChange={setF('last_name')} required />
            </div>
            <FormField label="E-Mail"      id="mem" value={form.email ?? ''}          onChange={setF('email')} type="email" />
            <FormField label="Mobil"       id="mmo" value={form.mobile ?? ''}         onChange={setF('mobile')} />
            <FormField label="Personalnr." id="mpn" value={form.personnel_number ?? ''} onChange={setF('personnel_number')} />
            <FormField label="Passwort"    id="mpw" value={form.password ?? ''}       onChange={setF('password')} type="password" />
            <div className="form-group">
              <label htmlFor="mge">Geschlecht*</label>
              <select id="mge" value={String(form.gender_id)} onChange={setF('gender_id')} required>
                <option value="">Bitte wählen …</option>
                {genders.map(g => <option key={g.ID} value={g.ID}>{g.GENDER}</option>)}
              </select>
            </div>

            <hr style={{ margin: '12px 0', borderColor: '#e5e7eb' }} />
            <p style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Arbeitszeitmodell*</p>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="mwm">Modell*</label>
                <select id="mwm" value={createWmModelId} onChange={e => setCreateWmModelId(e.target.value)} required>
                  <option value="">Bitte wählen …</option>
                  {workModels.map(m => <option key={m.ID} value={m.ID}>{m.NAME}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="mwmvf">Gültig ab*</label>
                <input id="mwmvf" type="date" value={createWmValidFrom} onChange={e => setCreateWmValidFrom(e.target.value)} required />
              </div>
            </div>

            <hr style={{ margin: '12px 0', borderColor: '#e5e7eb' }} />
            <p style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Kostensatz*</p>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="mcr">Kostensatz (€/h)*</label>
                <input id="mcr" type="number" step="0.01" min="0" value={createCpRate} onChange={e => setCreateCpRate(e.target.value)} placeholder="z. B. 85.00" required />
              </div>
              <div className="form-group">
                <label htmlFor="mcrvf">Gültig ab*</label>
                <input id="mcrvf" type="date" value={createCpValidFrom} onChange={e => setCreateCpValidFrom(e.target.value)} required />
              </div>
            </div>

            <Message text={createMsg?.text ?? null} type={createMsg?.type} />
            <button className="btn-primary" type="submit" disabled={creating}>
              {creating ? 'Speichert …' : 'Speichern'}
            </button>
          </form>
        )}

        {tab === 'reporting' && (
          <ReportingTab employees={employees} />
        )}
      </div>

      <Modal open={editRow !== null} onClose={() => setEditRow(null)} title={`${editRow?.SHORT_NAME ?? ''} – ${editRow?.FIRST_NAME ?? ''} ${editRow?.LAST_NAME ?? ''}`}>
        {editRow && (
          <EmployeeEditModal
            employee={editRow}
            onClose={() => setEditRow(null)}
            genders={genders}
            departments={departments}
            workModels={workModels}
          />
        )}
      </Modal>
    </div>
  )
}
