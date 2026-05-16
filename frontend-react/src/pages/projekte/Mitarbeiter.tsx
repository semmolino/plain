import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message } from '@/components/ui/Message'
import {
  fetchProjectsShort, fetchActiveEmployees, fetchActiveRoles,
  fetchE2PByProject, createE2P, updateE2P, deleteE2P,
  type E2PEntry,
} from '@/api/projekte'

interface Props {
  initialProjectId?: number
  onProjectChange?: (id: number | null) => void
}

const FMT_EUR = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtRate = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v) + ' €/h'

function empName(row: E2PEntry) {
  const full = `${row.EMPLOYEE_FIRST_NAME ?? ''} ${row.EMPLOYEE_LAST_NAME ?? ''}`.trim()
  return row.EMPLOYEE_SHORT_NAME ? `${row.EMPLOYEE_SHORT_NAME}: ${full}` : full
}

interface EditState {
  role_id: string
  role_name_short: string
  role_name_long: string
  sp_rate: string
}

function emptyEdit(row: E2PEntry): EditState {
  return {
    role_id:         row.ROLE_ID   != null ? String(row.ROLE_ID) : '',
    role_name_short: row.ROLE_NAME_SHORT ?? '',
    role_name_long:  row.ROLE_NAME_LONG  ?? '',
    sp_rate:         row.SP_RATE   != null ? String(row.SP_RATE)  : '',
  }
}

function emptyAdd(): { employee_id: string; role_id: string; role_name_short: string; role_name_long: string; sp_rate: string } {
  return { employee_id: '', role_id: '', role_name_short: '', role_name_long: '', sp_rate: '' }
}

export function Mitarbeiter({ initialProjectId, onProjectChange }: Props) {
  const qc       = useQueryClient()
  const navigate = useNavigate()

  const [pid,       setPid]       = useState<number | null>(initialProjectId ?? null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm,  setEditForm]  = useState<EditState>({ role_id: '', role_name_short: '', role_name_long: '', sp_rate: '' })
  const [addForm,   setAddForm]   = useState(emptyAdd())
  const [msg,       setMsg]       = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: empData }      = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const { data: roleData }     = useQuery({ queryKey: ['active-roles'],     queryFn: fetchActiveRoles })

  const { data: e2pData, isLoading, isError } = useQuery({
    queryKey: ['e2p', pid],
    queryFn:  () => fetchE2PByProject(pid!),
    enabled:  pid !== null,
  })

  const projects = projectsData?.data ?? []
  const employees = empData?.data     ?? []
  const roles     = roleData?.data    ?? []
  const rows      = e2pData?.data     ?? []

  const currentProject = projects.find(p => p.ID === pid)

  // Employees not yet assigned to this project
  const assignedIds = new Set(rows.map(r => r.EMPLOYEE_ID))
  const unassigned  = employees.filter(e => !assignedIds.has(e.ID))

  function handleProjectChange(id: number | null) {
    setPid(id)
    onProjectChange?.(id)
    setEditingId(null)
    setMsg(null)
    setAddForm(emptyAdd())
  }

  function startEdit(row: E2PEntry) {
    setEditingId(row.ID)
    setEditForm(emptyEdit(row))
    setMsg(null)
  }

  function applyRoleToEdit(roleId: string) {
    const role = roles.find(r => String(r.ID) === roleId)
    setEditForm(f => ({
      ...f,
      role_id:         roleId,
      role_name_short: role?.NAME_SHORT ?? f.role_name_short,
      role_name_long:  role?.NAME_LONG  ?? f.role_name_long,
      sp_rate:         role?.SP_RATE != null ? String(role.SP_RATE) : f.sp_rate,
    }))
  }

  function applyRoleToAdd(roleId: string) {
    const role = roles.find(r => String(r.ID) === roleId)
    setAddForm(f => ({
      ...f,
      role_id:         roleId,
      role_name_short: role?.NAME_SHORT ?? f.role_name_short,
      role_name_long:  role?.NAME_LONG  ?? f.role_name_long,
      sp_rate:         role?.SP_RATE != null ? String(role.SP_RATE) : f.sp_rate,
    }))
  }

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateE2P>[1] }) =>
      updateE2P(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['e2p', pid] })
      setMsg({ text: 'Gespeichert ✅', type: 'success' })
      setEditingId(null)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const createMut = useMutation({
    mutationFn: ({ body }: { body: Parameters<typeof createE2P>[1] }) =>
      createE2P(pid!, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['e2p', pid] })
      setMsg({ text: 'Mitarbeiter hinzugefügt ✅', type: 'success' })
      setAddForm(emptyAdd())
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteE2P,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['e2p', pid] })
      setMsg({ text: 'Entfernt.', type: 'success' })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function submitEdit(rowId: number) {
    updateMut.mutate({
      id: rowId,
      body: {
        role_id:         editForm.role_id         ? Number(editForm.role_id) : null,
        role_name_short: editForm.role_name_short,
        role_name_long:  editForm.role_name_long,
        sp_rate:         editForm.sp_rate !== '' ? parseFloat(editForm.sp_rate) : null,
      },
    })
  }

  function submitAdd() {
    if (!addForm.employee_id) { setMsg({ text: 'Bitte Mitarbeiter wählen', type: 'error' }); return }
    createMut.mutate({
      body: {
        employee_id:     Number(addForm.employee_id),
        role_id:         addForm.role_id         ? Number(addForm.role_id) : null,
        role_name_short: addForm.role_name_short,
        role_name_long:  addForm.role_name_long,
        sp_rate:         addForm.sp_rate !== '' ? parseFloat(addForm.sp_rate) : null,
      },
    })
  }

  async function handleDelete(row: E2PEntry) {
    if (!window.confirm(`${empName(row)} aus dem Projekt entfernen?`)) return
    deleteMut.mutate(row.ID)
  }

  const setEF = (k: keyof EditState) => (v: string) => setEditForm(f => ({ ...f, [k]: v }))
  const setAF = (k: keyof ReturnType<typeof emptyAdd>) => (v: string) => setAddForm(f => ({ ...f, [k]: v }))

  return (
    <div className="list-section">
      {/* Project selector toolbar */}
      <div className="list-toolbar" style={{ marginBottom: 8 }}>
        <select
          className="list-search"
          style={{ maxWidth: 400 }}
          value={pid ?? ''}
          onChange={e => handleProjectChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— Projekt wählen —</option>
          {projects.map(p => (
            <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>
          ))}
        </select>
      </div>

      {/* Jump bar */}
      {pid && (
        <div className="proj-jump-bar">
          <span className="proj-jump-label">{currentProject?.NAME_SHORT ?? ''}</span>
          <button className="btn-small" onClick={() => navigate('/rechnungen', { state: { projectSearch: currentProject?.NAME_LONG ?? currentProject?.NAME_SHORT, backProject: { id: pid, name: currentProject?.NAME_SHORT } } })}>
            Rechnungen →
          </button>
          <button className="btn-small" onClick={() => navigate('/daten', { state: { tab: 'einzelprojekt', projectId: pid } })}>
            Projekt-Report →
          </button>
        </div>
      )}

      {msg && <div style={{ marginBottom: 12 }}><Message type={msg.type} text={msg.text} /></div>}

      {!pid && <p className="empty-note">Bitte ein Projekt auswählen.</p>}
      {pid && isLoading && <p className="empty-note">Lade Mitarbeiterdaten…</p>}
      {pid && isError   && <p className="empty-note" style={{ color: 'var(--color-danger)' }}>Fehler beim Laden.</p>}

      {pid && !isLoading && !isError && (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="master-table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th>Rolle (Vorlage)</th>
                <th>Rollenkürzel</th>
                <th>Rollenbezeichnung</th>
                <th className="num">Stundensatz</th>
                <th className="num">Kostensatz</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isEditing = editingId === row.ID
                return (
                  <tr key={row.ID}>
                    <td>{empName(row)}</td>

                    {isEditing ? (
                      <>
                        <td>
                          <select className="tbl-select" value={editForm.role_id} onChange={e => applyRoleToEdit(e.target.value)}>
                            <option value="">—</option>
                            {roles.map(r => <option key={r.ID} value={r.ID}>{r.NAME_SHORT}{r.NAME_LONG ? ' – ' + r.NAME_LONG : ''}</option>)}
                          </select>
                        </td>
                        <td><input className="tbl-input" style={{ width: 90 }} value={editForm.role_name_short} onChange={e => setEF('role_name_short')(e.target.value)} /></td>
                        <td><input className="tbl-input" style={{ width: 150 }} value={editForm.role_name_long} onChange={e => setEF('role_name_long')(e.target.value)} /></td>
                        <td><input className="tbl-input num" style={{ width: 80 }} type="number" step="0.01" min="0" value={editForm.sp_rate} onChange={e => setEF('sp_rate')(e.target.value)} placeholder="0.00" /></td>
                        <td className="num" style={{ color: 'rgba(17,24,39,0.45)', fontSize: 12 }}>{fmtRate(row.CP_RATE)}</td>
                        <td className="doc-actions">
                          <button className="btn-small btn-save" disabled={updateMut.isPending} onClick={() => submitEdit(row.ID)}>
                            {updateMut.isPending ? '…' : 'Speichern'}
                          </button>
                          <button className="btn-small" onClick={() => setEditingId(null)}>Abbrechen</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ color: 'rgba(17,24,39,0.5)', fontSize: 12 }}>
                          {row.ROLE_ID ? roles.find(r => r.ID === row.ROLE_ID)?.NAME_SHORT ?? '—' : '—'}
                        </td>
                        <td>{row.ROLE_NAME_SHORT || '—'}</td>
                        <td>{row.ROLE_NAME_LONG  || '—'}</td>
                        <td className="num">{fmtRate(row.SP_RATE)}</td>
                        <td className="num" style={{ color: 'rgba(17,24,39,0.45)', fontSize: 12 }}>{fmtRate(row.CP_RATE)}</td>
                        <td className="doc-actions">
                          <button className="btn-small" onClick={() => startEdit(row)}>Bearbeiten</button>
                          <button className="btn-small btn-danger" onClick={() => handleDelete(row)}>Entfernen</button>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}

              {/* Add row */}
              <tr style={{ borderTop: '2px solid rgba(17,24,39,0.1)', background: 'rgba(16,185,129,0.03)' }}>
                <td>
                  <select className="tbl-select" value={addForm.employee_id} onChange={e => setAF('employee_id')(e.target.value)}>
                    <option value="">— Mitarbeiter wählen —</option>
                    {unassigned.map(e => {
                      const label = `${e.SHORT_NAME ? e.SHORT_NAME + ': ' : ''}${e.FIRST_NAME ?? ''} ${e.LAST_NAME ?? ''}`.trim()
                      return <option key={e.ID} value={e.ID}>{label}</option>
                    })}
                  </select>
                </td>
                <td>
                  <select className="tbl-select" value={addForm.role_id} onChange={e => applyRoleToAdd(e.target.value)}>
                    <option value="">—</option>
                    {roles.map(r => <option key={r.ID} value={r.ID}>{r.NAME_SHORT}{r.NAME_LONG ? ' – ' + r.NAME_LONG : ''}</option>)}
                  </select>
                </td>
                <td><input className="tbl-input" style={{ width: 90 }} value={addForm.role_name_short} onChange={e => setAF('role_name_short')(e.target.value)} placeholder="Kürzel" /></td>
                <td><input className="tbl-input" style={{ width: 150 }} value={addForm.role_name_long} onChange={e => setAF('role_name_long')(e.target.value)} placeholder="Bezeichnung" /></td>
                <td><input className="tbl-input num" style={{ width: 80 }} type="number" step="0.01" min="0" value={addForm.sp_rate} onChange={e => setAF('sp_rate')(e.target.value)} placeholder="0.00" /></td>
                <td></td>
                <td className="doc-actions">
                  <button
                    className="btn-small btn-save"
                    disabled={!addForm.employee_id || createMut.isPending}
                    onClick={submitAdd}
                  >
                    {createMut.isPending ? '…' : '+ Hinzufügen'}
                  </button>
                </td>
              </tr>

              {rows.length === 0 && !createMut.isPending && (
                <tr>
                  <td colSpan={7} className="empty-note" style={{ paddingTop: 8 }}>
                    Noch keine Mitarbeiter zugeordnet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid rgba(17,24,39,0.12)', fontWeight: 600 }}>
                <td colSpan={7} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                  {rows.length} Mitarbeiter zugeordnet
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
