import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
import { Autocomplete } from '@/components/ui/Autocomplete'
import {
  fetchProjectStatuses, fetchProjectTypes, fetchProjectManagers,
  fetchActiveEmployees, fetchActiveRoles, fetchBillingTypes,
  createProject, type E2PRow, type StructureDraftRow,
} from '@/api/projekte'
import { searchAddressesApi, searchContactsApi } from '@/api/stammdaten'

// ── Wizard state ──────────────────────────────────────────────────────────────

interface BasicForm {
  name_long:           string
  company_id:          string
  project_status_id:   string
  project_type_id:     string
  project_manager_id:  string
  address_id:          string
  contact_id:          string
}

interface E2PState {
  [empId: number]: { role_id: string; role_name_short: string; role_name_long: string; sp_rate: string }
}

function emptyBasic(): BasicForm {
  return { name_long: '', company_id: '', project_status_id: '', project_type_id: '', project_manager_id: '', address_id: '', contact_id: '' }
}

function newStructRow(): StructureDraftRow {
  const tmp = 't' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  return { tmp_key: tmp, father_tmp_key: '', NAME_SHORT: '', NAME_LONG: '', BILLING_TYPE_ID: '' }
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
  const [contactText, setContactText] = useState('')
  const [selectedEmpIds, setSelectedEmpIds] = useState<Set<number>>(new Set())
  const [e2p, setE2p]             = useState<E2PState>({})
  const [structDraft, setStructDraft] = useState<StructureDraftRow[]>([])
  const [msg, setMsg]             = useState<{ text: string; type: 'success'|'error'|'info' } | null>(null)

  const { data: statusData  } = useQuery({ queryKey: ['project-statuses'],  queryFn: fetchProjectStatuses  })
  const { data: typeData    } = useQuery({ queryKey: ['project-types'],     queryFn: fetchProjectTypes     })
  const { data: mgrData     } = useQuery({ queryKey: ['project-managers'],  queryFn: fetchProjectManagers  })
  const { data: empData     } = useQuery({ queryKey: ['active-employees'],  queryFn: fetchActiveEmployees  })
  const { data: roleData    } = useQuery({ queryKey: ['active-roles'],      queryFn: fetchActiveRoles      })
  const { data: btData      } = useQuery({ queryKey: ['billing-types'],     queryFn: fetchBillingTypes     })

  const statuses  = statusData?.data ?? []
  const types     = typeData?.data   ?? []
  const managers  = mgrData?.data    ?? []
  const employees = empData?.data    ?? []
  const roles     = roleData?.data   ?? []
  const btypes    = btData?.data     ?? []

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return res.data.map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  const searchContacts = useCallback(async (q: string) => {
    if (!basic.address_id) return []
    const res = await searchContactsApi(Number(basic.address_id), q)
    return res.data.map(c => ({ id: c.ID, label: `${c.FIRST_NAME} ${c.LAST_NAME}`.trim() }))
  }, [basic.address_id])

  const createMut = useMutation({
    mutationFn: createProject,
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['projects-full'] })
      setMsg({ text: `Projekt "${res.data.NAME_SHORT}" wurde angelegt ✅`, type: 'success' })
      // reset
      setStep(1); setBasic(emptyBasic()); setAddrText(''); setContactText('')
      setSelectedEmpIds(new Set()); setE2p({}); setStructDraft([])
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

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
        sp_rate:         prev[empId]?.sp_rate ?? '',
      },
    }))
  }

  function addStructRow() {
    setStructDraft(d => [...d, newStructRow()])
  }

  function removeStructRow(tmpKey: string) {
    setStructDraft(d => d.filter(r => r.tmp_key !== tmpKey).map(r => ({
      ...r, father_tmp_key: r.father_tmp_key === tmpKey ? '' : r.father_tmp_key,
    })))
  }

  function setStructField(tmpKey: string, field: keyof StructureDraftRow, value: string) {
    setStructDraft(d => d.map(r => r.tmp_key === tmpKey ? { ...r, [field]: value } : r))
  }

  function validateStep1() {
    if (!basic.name_long || !basic.project_status_id || !basic.project_manager_id || !basic.address_id || !basic.contact_id) {
      setMsg({ text: 'Bitte alle Pflichtfelder ausfüllen (Name, Status, Leitung, Adresse, Kontakt)', type: 'error' })
      return false
    }
    // company_id — we'll skip for now and pass empty (backend may allow null)
    setMsg(null)
    return true
  }

  function goNext() {
    if (step === 1 && !validateStep1()) return
    setMsg(null)
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
      project_manager_id: Number(basic.project_manager_id),
      address_id:         Number(basic.address_id),
      contact_id:         Number(basic.contact_id),
      employee2project:   e2pRows.length ? e2pRows : undefined,
      project_structure:  structDraft.length ? structDraft : undefined,
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
            <label>Projektleitung*</label>
            <select value={basic.project_manager_id} onChange={e => setB('project_manager_id')(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {managers.map(m => <option key={m.ID} value={m.ID}>{m.SHORT_NAME}</option>)}
            </select>
          </div>
          <Autocomplete label="Rechnungsadresse*" htmlId="prj-addr"
            value={addrText}
            onChange={t => { setAddrText(t); if (!t) { setB('address_id')(''); setB('contact_id')(''); setContactText('') } }}
            onSelect={(id, lbl) => { setAddrText(lbl); setB('address_id')(String(id)); setB('contact_id')(''); setContactText('') }}
            search={searchAddresses} placeholder="Name eingeben …" />
          <Autocomplete label="Rechnungskontakt*" htmlId="prj-con"
            value={contactText}
            onChange={t => { setContactText(t); if (!t) setB('contact_id')('') }}
            onSelect={(id, lbl) => { setContactText(lbl); setB('contact_id')(String(id)) }}
            search={searchContacts}
            placeholder={basic.address_id ? 'Name eingeben …' : 'Erst Adresse wählen'} />
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
                    <th>SP-Rate</th>
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
                          <select value={row.role_id} onChange={e => applyRolePreset(empId, e.target.value)} style={{ fontSize: 11 }}>
                            <option value="">—</option>
                            {roles.map(r => <option key={r.ID} value={r.ID}>{r.NAME_SHORT}{r.NAME_LONG ? ' – ' + r.NAME_LONG : ''}</option>)}
                          </select>
                        </td>
                        <td><input style={{ width: 80 }} value={row.role_name_short} onChange={e => setE2pField(empId, 'role_name_short', e.target.value)} /></td>
                        <td><input style={{ width: 140 }} value={row.role_name_long} onChange={e => setE2pField(empId, 'role_name_long', e.target.value)} /></td>
                        <td><input style={{ width: 80 }} type="number" step="0.01" value={row.sp_rate} onChange={e => setE2pField(empId, 'sp_rate', e.target.value)} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Step 4: Projektstruktur ── */}
      {step === 4 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 4: Projektstruktur</h3>
          <p className="admin-section-hint">Optional — Strukturelemente können später ergänzt werden.</p>
          <div className="table-scroll">
            <table className="master-table">
              <thead>
                <tr><th>#</th><th>Kürzel</th><th>Bezeichnung</th><th>Abrechnungsart*</th><th>Übergeordnet</th><th></th></tr>
              </thead>
              <tbody>
                {structDraft.map((r, i) => (
                  <tr key={r.tmp_key}>
                    <td>{i + 1}</td>
                    <td><input style={{ width: 70 }} value={r.NAME_SHORT} onChange={e => setStructField(r.tmp_key, 'NAME_SHORT', e.target.value)} /></td>
                    <td><input style={{ width: 140 }} value={r.NAME_LONG} onChange={e => setStructField(r.tmp_key, 'NAME_LONG', e.target.value)} /></td>
                    <td>
                      <select style={{ fontSize: 11 }} value={String(r.BILLING_TYPE_ID)} onChange={e => setStructField(r.tmp_key, 'BILLING_TYPE_ID', e.target.value)}>
                        <option value="">Bitte wählen …</option>
                        {btypes.map(b => <option key={b.ID} value={b.ID}>{b.NAME_SHORT}{b.NAME_LONG ? ' – ' + b.NAME_LONG : ''}</option>)}
                      </select>
                    </td>
                    <td>
                      <select style={{ fontSize: 11 }} value={r.father_tmp_key} onChange={e => setStructField(r.tmp_key, 'father_tmp_key', e.target.value)}>
                        <option value="">(Root)</option>
                        {structDraft.filter(x => x.tmp_key !== r.tmp_key).map(x => (
                          <option key={x.tmp_key} value={x.tmp_key}>
                            {(`${x.NAME_SHORT} ${x.NAME_LONG}`).trim() || `Zeile ${structDraft.indexOf(x) + 1}`}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td><button className="btn-small" type="button" onClick={() => removeStructRow(r.tmp_key)}>Entfernen</button></td>
                  </tr>
                ))}
                {!structDraft.length && <tr><td colSpan={6} className="empty-note">Keine Strukturelemente</td></tr>}
              </tbody>
            </table>
          </div>
          <button className="btn-small btn-save" type="button" onClick={addStructRow} style={{ marginTop: 8 }}>+ Zeile hinzufügen</button>
        </div>
      )}

      <Message text={msg?.text ?? null} type={msg?.type} />

      {/* Navigation */}
      <div className="wizard-nav">
        {step > 1 && <button type="button" onClick={() => { setMsg(null); setStep(s => s - 1) }}>← Zurück</button>}
        {step < 4 && <button className="btn-primary" type="button" onClick={goNext}>Weiter →</button>}
        {step === 4 && (
          <button className="btn-primary" type="button" disabled={createMut.isPending} onClick={submit}>
            {createMut.isPending ? 'Speichert …' : 'Projekt anlegen'}
          </button>
        )}
      </div>
    </div>
  )
}
