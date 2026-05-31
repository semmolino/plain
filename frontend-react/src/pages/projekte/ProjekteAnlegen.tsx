import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
import { Autocomplete } from '@/components/ui/Autocomplete'
import {
  fetchProjectStatuses, fetchProjectTypes, fetchProjectManagers,
  fetchActiveEmployees, fetchActiveRoles, fetchDepartments,
  createProject, type E2PRow,
} from '@/api/projekte'
import { fetchCompanies } from '@/api/rechnungen'
import { searchAddressesApi, fetchContactsByAddress } from '@/api/stammdaten'
import { HonorarWizard } from '@/pages/projekte/HonorarWizard'

// ── Wizard state ──────────────────────────────────────────────────────────────

interface BasicForm {
  name_long:           string
  company_id:          string
  project_status_id:   string
  project_type_id:     string
  department_id:       string
  project_manager_id:  string
  address_id:          string
  contact_id:          string
}

interface E2PState {
  [empId: number]: { role_id: string; role_name_short: string; role_name_long: string; sp_rate: string }
}

function emptyBasic(): BasicForm {
  return { name_long: '', company_id: '', project_status_id: '', project_type_id: '', department_id: '', project_manager_id: '', address_id: '', contact_id: '' }
}

// ── Sub-wizard components ─────────────────────────────────────────────────────

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="wizard-steps">
      {Array.from({ length: total }, (_, i) => i + 1).map(s => (
        <span key={s} className={`wizard-step${s === step ? ' active' : s < step ? ' done' : ''}`}>{s}</span>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ProjekteAnlegen() {
  const qc = useQueryClient()
  const [step, setStep]           = useState(1)
  const [basic, setBasic]         = useState<BasicForm>(emptyBasic)
  const [addrText, setAddrText]   = useState('')
  const [selectedEmpIds, setSelectedEmpIds] = useState<Set<number>>(new Set())
  const [e2p, setE2p]             = useState<E2PState>({})
  const [msg, setMsg]             = useState<{ text: string; type: 'success'|'error'|'info' } | null>(null)
  const [newProjectId, setNewProjectId]   = useState<number | null>(null)

  const { data: deptData    } = useQuery({ queryKey: ['departments'],        queryFn: fetchDepartments      })
  const { data: statusData  } = useQuery({ queryKey: ['project-statuses'],  queryFn: fetchProjectStatuses  })
  const { data: typeData    } = useQuery({ queryKey: ['project-types'],     queryFn: fetchProjectTypes     })
  const { data: mgrData     } = useQuery({ queryKey: ['project-managers'],  queryFn: fetchProjectManagers  })
  const { data: empData     } = useQuery({ queryKey: ['active-employees'],  queryFn: fetchActiveEmployees  })
  const { data: roleData    } = useQuery({ queryKey: ['active-roles'],      queryFn: fetchActiveRoles      })
  const { data: companyData } = useQuery({ queryKey: ['companies'],         queryFn: fetchCompanies        })
  const addressId = basic.address_id ? Number(basic.address_id) : null
  const { data: contactData } = useQuery({
    queryKey: ['contacts-by-address', addressId],
    queryFn:  () => fetchContactsByAddress(addressId!),
    enabled:  !!addressId,
  })

  const departments = deptData?.data    ?? []
  const statuses    = statusData?.data  ?? []
  const types       = typeData?.data    ?? []
  const managers    = mgrData?.data     ?? []
  const employees = empData?.data     ?? []
  const roles     = roleData?.data    ?? []
  const contacts  = contactData?.data ?? []
  const companies = companyData?.data ?? []

  // Auto-select company when there is exactly one
  if (companies.length === 1 && !basic.company_id) {
    setBasic(f => ({ ...f, company_id: String(companies[0].ID) }))
  }

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return res.data.map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  const createMut = useMutation({
    mutationFn: createProject,
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['projects-full'] })
      setMsg({ text: `Projekt "${res.data.NAME_SHORT}" wurde angelegt.`, type: 'success' })
      setNewProjectId(res.data.ID)
      setStep(4)  // advance to HOAI step
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function handleFinish() {
    setStep(1); setBasic(emptyBasic()); setAddrText('')
    setSelectedEmpIds(new Set()); setE2p({})
    setNewProjectId(null); setMsg(null)
  }

  const setB = (k: keyof BasicForm) => (v: string) => setBasic(f => ({ ...f, [k]: v }))

  function toggleEmp(id: number) {
    setSelectedEmpIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setE2pField(empId: number, field: string, value: string) {
    setE2p(prev => {
      const current = prev[empId] ?? { role_id: '', role_name_short: '', role_name_long: '', sp_rate: '' }
      return { ...prev, [empId]: { ...current, [field]: value } }
    })
  }

  function applyRolePreset(empId: number, roleId: string) {
    const role = roles.find(r => String(r.ID) === roleId)
    setE2p(prev => ({
      ...prev,
      [empId]: {
        ...prev[empId],
        role_id:         roleId,
        role_name_short: role?.NAME_SHORT ?? '',
        role_name_long:  role?.NAME_LONG  ?? '',
        sp_rate:         role?.SP_RATE != null ? String(role.SP_RATE) : (prev[empId]?.sp_rate ?? ''),
      },
    }))
  }

  function validateStep1() {
    const missing: string[] = []
    if (companies.length > 1 && !basic.company_id) missing.push('Firma')
    if (!basic.name_long)          missing.push('Projektname')
    if (!basic.project_status_id)  missing.push('Status')
    if (!basic.project_manager_id) missing.push('Projektleitung')
    if (!basic.address_id)         missing.push('Rechnungsadresse')
    if (!basic.contact_id)         missing.push('Rechnungskontakt')
    if (missing.length) {
      setMsg({ text: `Pflichtfeld${missing.length > 1 ? 'er' : ''} fehlt: ${missing.join(', ')}`, type: 'error' })
      return false
    }
    setMsg(null)
    return true
  }

  function goNext() {
    if (step === 1 && !validateStep1()) return
    setMsg(null)
    if (step === 3) {
      submit()  // creates project → onSuccess advances to step 4
      return
    }
    setStep(s => s + 1)
  }

  function submit() {
    setMsg(null)
    const e2pRows: E2PRow[] = Array.from(selectedEmpIds).map(empId => ({
      employee_id:    empId,
      role_id:        e2p[empId]?.role_id        || undefined,
      role_name_short: e2p[empId]?.role_name_short || '',
      role_name_long:  e2p[empId]?.role_name_long  || '',
      sp_rate:        e2p[empId]?.sp_rate        || undefined,
    }))

    createMut.mutate({
      name_long:          basic.name_long,
      company_id:         basic.company_id || 0,
      project_status_id:  Number(basic.project_status_id),
      project_type_id:    basic.project_type_id ? Number(basic.project_type_id) : undefined,
      department_id:      basic.department_id  ? Number(basic.department_id)  : undefined,
      project_manager_id: Number(basic.project_manager_id),
      address_id:         Number(basic.address_id),
      contact_id:         Number(basic.contact_id),
      employee2project:   e2pRows.length ? e2pRows : undefined,
    })
  }

  const empLabel = (e: typeof employees[0]) =>
    `${e.SHORT_NAME ? e.SHORT_NAME + ': ' : ''}${e.FIRST_NAME ?? ''} ${e.LAST_NAME ?? ''}`.trim()

  return (
    <div className="wizard-wrap">
      <StepIndicator step={step} total={4} />

      {/* ── Step 1: Basisdaten ── */}
      {step === 1 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 1: Basisdaten</h3>
          {companies.length > 1 && (
            <div className="form-group">
              <label>Firma*</label>
              <select value={basic.company_id} onChange={e => setB('company_id')(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {companies.map(c => <option key={c.ID} value={c.ID}>{c.COMPANY_NAME_1}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Projektname*</label>
            <input value={basic.name_long} onChange={e => setB('name_long')(e.target.value)} placeholder="Langer Projektname" />
          </div>
          <div className="form-group">
            <label>Status*</label>
            <select value={basic.project_status_id} onChange={e => setB('project_status_id')(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {statuses.map(s => <option key={s.ID} value={s.ID}>{s.NAME_SHORT}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Typ</label>
            <select value={basic.project_type_id} onChange={e => setB('project_type_id')(e.target.value)}>
              <option value="">—</option>
              {types.map(t => <option key={t.ID} value={t.ID}>{t.NAME_SHORT}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Abteilung</label>
            <select value={basic.department_id} onChange={e => setB('department_id')(e.target.value)}>
              <option value="">—</option>
              {departments.map(d => (
                <option key={d.ID} value={d.ID}>{d.NAME_SHORT}: {d.NAME_LONG}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Projektleitung*</label>
            <select value={basic.project_manager_id} onChange={e => setB('project_manager_id')(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {managers.map(m => <option key={m.ID} value={m.ID}>{m.SHORT_NAME}</option>)}
            </select>
          </div>
          <Autocomplete label="Rechnungsadresse*" htmlId="prj-addr"
            value={addrText}
            onChange={t => { setAddrText(t); if (!t) { setB('address_id')(''); setB('contact_id')('') } }}
            onSelect={(id, lbl) => { setAddrText(lbl); setB('address_id')(String(id)); setB('contact_id')('') }}
            search={searchAddresses} placeholder="Name eingeben …" />
          <div className="form-group">
            <label>Rechnungskontakt*</label>
            <select
              value={basic.contact_id}
              onChange={e => setB('contact_id')(e.target.value)}
              disabled={!basic.address_id}
            >
              <option value="">{basic.address_id ? 'Bitte wählen …' : 'Erst Adresse wählen'}</option>
              {contacts.map(c => (
                <option key={c.ID} value={c.ID}>
                  {`${c.FIRST_NAME ?? ''} ${c.LAST_NAME ?? ''}`.trim()}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* ── Step 2: Mitarbeiter ── */}
      {step === 2 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 2: Mitarbeiter auswählen</h3>
          <table className="master-table">
            <tbody>
              {employees.map(emp => (
                <tr key={emp.ID}>
                  <td style={{ width: 32 }}>
                    <input type="checkbox" checked={selectedEmpIds.has(emp.ID)}
                      onChange={() => toggleEmp(emp.ID)} />
                  </td>
                  <td>{empLabel(emp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Step 3: Rollen & Kosten ── */}
      {step === 3 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 3: Rollen &amp; Kosten</h3>
          {selectedEmpIds.size === 0 && <p className="empty-note">Keine Mitarbeiter ausgewählt.</p>}
          {selectedEmpIds.size > 0 && (
            <div className="table-scroll">
              <table className="master-table">
                <thead>
                  <tr>
                    <th>Mitarbeiter</th>
                    <th>Rolle (Vorlage)</th>
                    <th>Rollenkürzel</th>
                    <th>Rollenbezeichnung</th>
                    <th>Stundensatz</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(selectedEmpIds).map(empId => {
                    const emp = employees.find(e => e.ID === empId)
                    if (!emp) return null
                    const row = e2p[empId] ?? { role_id: '', role_name_short: '', role_name_long: '', sp_rate: '' }
                    return (
                      <tr key={empId}>
                        <td>{empLabel(emp)}</td>
                        <td>
                          <select className="tbl-select" value={row.role_id} onChange={e => applyRolePreset(empId, e.target.value)}>
                            <option value="">—</option>
                            {roles.map(r => <option key={r.ID} value={r.ID}>{r.NAME_SHORT}{r.NAME_LONG ? ' – ' + r.NAME_LONG : ''}</option>)}
                          </select>
                        </td>
                        <td><input className="tbl-input" style={{ width: 80 }} value={row.role_name_short} onChange={e => setE2pField(empId, 'role_name_short', e.target.value)} /></td>
                        <td><input className="tbl-input" style={{ width: 140 }} value={row.role_name_long} onChange={e => setE2pField(empId, 'role_name_long', e.target.value)} /></td>
                        <td><input className="tbl-input" style={{ width: 80 }} type="number" step="0.01" value={row.sp_rate} onChange={e => setE2pField(empId, 'sp_rate', e.target.value)} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Step 4: HOAI-Kalkulation ── */}
      {step === 4 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 4: HOAI-Kalkulation (optional)</h3>
          {newProjectId
            ? <HonorarWizard initialProjectId={newProjectId} onDone={handleFinish} />
            : <p className="admin-section-hint">Projekt wird angelegt…</p>
          }
        </div>
      )}

      <Message text={msg?.text ?? null} type={msg?.type} />

      {/* Navigation */}
      <div className="wizard-nav">
        {step > 1 && step < 4 && (
          <button type="button" onClick={() => { setMsg(null); setStep(s => s - 1) }}>← Zurück</button>
        )}
        {step < 3 && (
          <button className="btn-primary" type="button" onClick={goNext}>Weiter →</button>
        )}
        {step === 3 && (
          <button className="btn-primary" type="button" disabled={createMut.isPending} onClick={goNext}>
            {createMut.isPending ? 'Speichert …' : 'Projekt anlegen →'}
          </button>
        )}
        {step === 4 && (
          <button type="button" onClick={handleFinish}>Fertig / Überspringen</button>
        )}
      </div>
    </div>
  )
}
