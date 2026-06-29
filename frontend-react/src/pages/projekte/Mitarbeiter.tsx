import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }     from '@/components/ui/Message'
import { Modal }       from '@/components/ui/Modal'
import { FormField }   from '@/components/ui/FormField'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { Can } from '@/components/ui/Can'
import {
  fetchProjectsShort, fetchActiveEmployees, fetchActiveRoles,
  fetchE2PByProject, createE2P, updateE2P, deleteE2P,
  type E2PEntry,
} from '@/api/projekte'
import {
  fetchProjectBookingPrices, upsertProjectBookingPrice,
  createProjectBookingType, deleteProjectBookingType,
  BOOKING_KIND_LABEL,
  type ProjectBookingPrice, type BookingKind, type BookingTypePayload,
} from '@/api/bookingTypes'
import { HelpHint } from '@/components/ui/HelpHint'

interface Props {
  initialProjectId?: number
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

export function Mitarbeiter({ initialProjectId }: Props) {
  const qc       = useQueryClient()
  const navigate = useNavigate()

  const [pid,       setPid]       = useState<number | null>(initialProjectId ?? null)
  // Projektauswahl kommt zentral aus dem Seitenkopf (ProjectPicker).
  useEffect(() => { setPid(initialProjectId ?? null); setEditingId(null); setMsg(null); setAddForm(emptyAdd()) }, [initialProjectId])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm,  setEditForm]  = useState<EditState>({ role_id: '', role_name_short: '', role_name_long: '', sp_rate: '' })
  const [addForm,      setAddForm]      = useState(emptyAdd())
  const [msg,          setMsg]          = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

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

  function handleDelete(row: E2PEntry) {
    setConfirmState({
      title: 'Mitarbeiter entfernen',
      message: `${empName(row)} aus dem Projekt entfernen?`,
      onConfirm: () => deleteMut.mutate(row.ID),
    })
  }

  const setEF = (k: keyof EditState) => (v: string) => setEditForm(f => ({ ...f, [k]: v }))
  const setAF = (k: keyof ReturnType<typeof emptyAdd>) => (v: string) => setAddForm(f => ({ ...f, [k]: v }))

  return (
    <div className="list-section">
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

      {!pid && <p className="empty-note">Bitte oben ein Projekt auswählen.</p>}
      {pid && isLoading && <p className="empty-note">Lade Mitarbeiterdaten…</p>}
      {pid && isError   && <p className="empty-note" style={{ color: 'var(--color-danger)' }}>Fehler beim Laden.</p>}

      {pid && !isLoading && !isError && (
        <>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '8px 0 0' }}>Mitarbeiter-Stundensätze</h3>
        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table className="master-table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th>Rolle (Vorlage)</th>
                <th>Rollenkürzel</th>
                <th>Rollenbezeichnung</th>
                <th className="num">Stundensatz</th>
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
                        <td className="doc-actions">
                          <Can permission="projects.hourly_rates.edit">
                            <button className="row-action-btn" onClick={() => startEdit(row)} title="Bearbeiten">
                              <Pencil size={14} strokeWidth={2} />
                            </button>
                            <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }} onClick={() => handleDelete(row)} title="Entfernen">
                              <Trash2 size={14} strokeWidth={2} />
                            </button>
                          </Can>
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

        <BookingPriceBlock projectId={pid} />
        </>
      )}

      <ConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel="Entfernen"
        confirmClass="danger"
        onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  )
}

// ── Buchungsarten-Preise je Projekt ────────────────────────────────────────────

function fmtRateOpt(v: number | null | undefined) {
  return v == null ? '—' : FMT_EUR.format(v) + ' €'
}

function BookingPriceBlock({ projectId }: { projectId: number }) {
  const qc = useQueryClient()
  const [editId, setEditId] = useState<number | null>(null)
  const [editSp, setEditSp] = useState('')
  const [editCp, setEditCp] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [delConfirm, setDelConfirm] = useState<{ id: number; label: string } | null>(null)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['project-booking-prices', projectId],
    queryFn:  () => fetchProjectBookingPrices(projectId),
  })
  const rows = data?.data ?? []

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['project-booking-prices', projectId] })
    void qc.invalidateQueries({ queryKey: ['booking-types-selectable', projectId] })
  }

  const delTypeMut = useMutation({
    mutationFn: (id: number) => deleteProjectBookingType(id),
    onSuccess: () => { invalidate(); setMsg({ text: 'Projektbezogene Buchungsart gelöscht', type: 'success' }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const saveMut = useMutation({
    mutationFn: (r: ProjectBookingPrice) => upsertProjectBookingPrice({
      project_id:      projectId,
      booking_type_id: r.BOOKING_TYPE_ID,
      sp_rate:         editSp !== '' ? Number(editSp) : null,
      cp_rate:         editCp !== '' ? Number(editCp) : null,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project-booking-prices', projectId] })
      void qc.invalidateQueries({ queryKey: ['booking-types-selectable', projectId] })
      setMsg({ text: 'Projektpreis gespeichert ✅', type: 'success' })
      setEditId(null)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function startEdit(r: ProjectBookingPrice) {
    setEditId(r.BOOKING_TYPE_ID)
    setEditSp(r.PROJECT_SP_RATE != null ? String(r.PROJECT_SP_RATE) : '')
    setEditCp(r.PROJECT_CP_RATE != null ? String(r.PROJECT_CP_RATE) : '')
    setMsg(null)
  }

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px', display: 'inline-flex', alignItems: 'center' }}>
          Buchungsarten-Preise <HelpHint id="settings.booking_types" />
        </h3>
        <Can permission="projects.hourly_rates.edit">
          <button className="btn-small" onClick={() => setCreateOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} strokeWidth={2} /> Projektbezogene Buchungsart
          </button>
        </Can>
      </div>
      <p style={{ fontSize: 12, color: 'rgba(17,24,39,0.55)', margin: '0 0 8px' }}>
        Standardpreise aus den Stammdaten; hier optional projektbezogen überschreiben. Leer = Standardpreis gilt.
        Projektbezogene Buchungsarten gelten nur in diesem Projekt.
      </p>

      {msg && <div style={{ marginBottom: 8 }}><Message type={msg.type} text={msg.text} /></div>}
      {isLoading && <p className="empty-note">Lade Buchungsarten …</p>}
      {!isLoading && rows.length === 0 && (
        <p className="empty-note">Noch keine Buchungsarten definiert (Einstellungen → Stammdaten → Buchungsarten).</p>
      )}

      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="master-table">
            <thead>
              <tr>
                <th>Art</th>
                <th>Buchungsart</th>
                <th>Einheit</th>
                <th className="num">Standard VK</th>
                <th className="num">Standard Kosten</th>
                <th className="num">Projekt VK</th>
                <th className="num">Projekt Kosten</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const isEditing = editId === r.BOOKING_TYPE_ID
                return (
                  <tr key={r.BOOKING_TYPE_ID}>
                    <td style={{ fontSize: 12, color: 'rgba(17,24,39,0.6)' }}>{BOOKING_KIND_LABEL[r.KIND]}{r.SCOPE === 'project' ? ' · Projekt' : ''}</td>
                    <td>{r.NAME_SHORT}{r.NAME_LONG ? <span style={{ color: 'rgba(17,24,39,0.5)' }}> – {r.NAME_LONG}</span> : null}</td>
                    <td>{r.KIND === 'UNIT' ? (r.UNIT_LABEL || '—') : '—'}</td>
                    <td className="num">{fmtRateOpt(r.DEFAULT_SP_RATE)}</td>
                    <td className="num">{fmtRateOpt(r.DEFAULT_CP_RATE)}</td>
                    {isEditing ? (
                      <>
                        <td className="num"><input className="tbl-input num" style={{ width: 80 }} type="number" step="0.01" value={editSp} onChange={e => setEditSp(e.target.value)} placeholder="Standard" /></td>
                        <td className="num"><input className="tbl-input num" style={{ width: 80 }} type="number" step="0.01" value={editCp} onChange={e => setEditCp(e.target.value)} placeholder="Standard" /></td>
                        <td className="doc-actions">
                          <button className="btn-small btn-save" disabled={saveMut.isPending} onClick={() => saveMut.mutate(r)}>
                            {saveMut.isPending ? '…' : 'Speichern'}
                          </button>
                          <button className="btn-small" onClick={() => setEditId(null)}>Abbrechen</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="num" style={{ fontWeight: r.PROJECT_SP_RATE != null ? 600 : 400 }}>{r.PROJECT_SP_RATE != null ? FMT_EUR.format(r.PROJECT_SP_RATE) + ' €' : '—'}</td>
                        <td className="num" style={{ fontWeight: r.PROJECT_CP_RATE != null ? 600 : 400 }}>{r.PROJECT_CP_RATE != null ? FMT_EUR.format(r.PROJECT_CP_RATE) + ' €' : '—'}</td>
                        <td className="doc-actions">
                          <Can permission="projects.hourly_rates.edit">
                            <button className="row-action-btn" onClick={() => startEdit(r)} title="Projektpreis setzen">
                              <Pencil size={14} strokeWidth={2} />
                            </button>
                            {r.SCOPE === 'project' && (
                              <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }}
                                onClick={() => setDelConfirm({ id: r.BOOKING_TYPE_ID, label: r.NAME_SHORT })} title="Projektbezogene Buchungsart löschen">
                                <Trash2 size={14} strokeWidth={2} />
                              </button>
                            )}
                          </Can>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <ProjectBookingTypeModal
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); invalidate(); setMsg({ text: 'Projektbezogene Buchungsart angelegt ✅', type: 'success' }) }}
        />
      )}

      <ConfirmModal
        open={delConfirm !== null}
        title="Buchungsart löschen"
        message={`Projektbezogene Buchungsart „${delConfirm?.label ?? ''}" löschen? Bereits erfasste Buchungen bleiben erhalten.`}
        confirmLabel="Löschen"
        confirmClass="danger"
        onConfirm={() => { if (delConfirm) delTypeMut.mutate(delConfirm.id); setDelConfirm(null) }}
        onCancel={() => setDelConfirm(null)}
      />
    </div>
  )
}

// ── Projektbezogene Buchungsart anlegen ────────────────────────────────────────

function ProjectBookingTypeModal({ projectId, onClose, onSaved }: { projectId: number; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<BookingKind>('UNIT')
  const [nameShort, setNameShort] = useState('')
  const [nameLong,  setNameLong]  = useState('')
  const [unitLabel, setUnitLabel] = useState('')
  const [sp, setSp] = useState('')
  const [cp, setCp] = useState('')
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const isUnit = kind === 'UNIT'

  const saveMut = useMutation({
    mutationFn: () => {
      const payload: BookingTypePayload & { project_id: number } = {
        project_id:      projectId,
        kind,
        name_short:      nameShort.trim(),
        name_long:       nameLong.trim() || null,
        unit_label:      isUnit ? (unitLabel.trim() || null) : null,
        // Bei Pauschalen ist der Betrag der Standardwert: Kosten→CP, Erlös→SP.
        default_sp_rate: (isUnit || kind === 'LUMP_REVENUE') && sp !== '' ? Number(sp) : null,
        default_cp_rate: (isUnit || kind === 'LUMP_COST')    && cp !== '' ? Number(cp) : null,
      }
      return createProjectBookingType(payload)
    },
    onSuccess: onSaved,
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function handleSave() {
    if (!nameShort.trim()) { setMsg({ text: 'Kürzel erforderlich', type: 'error' }); return }
    setMsg(null); saveMut.mutate()
  }

  return (
    <Modal open onClose={onClose} title="Projektbezogene Buchungsart">
      <div className="master-form">
        <div className="form-group">
          <label>Art*</label>
          <select value={kind} onChange={e => setKind(e.target.value as BookingKind)}>
            <option value="UNIT">{BOOKING_KIND_LABEL.UNIT}</option>
            <option value="LUMP_COST">{BOOKING_KIND_LABEL.LUMP_COST}</option>
            <option value="LUMP_REVENUE">{BOOKING_KIND_LABEL.LUMP_REVENUE}</option>
          </select>
        </div>
        <div className="form-row">
          <FormField label="Kürzel*"     id="pbt-short" value={nameShort} onChange={e => setNameShort(e.target.value)} required />
          <FormField label="Bezeichnung" id="pbt-long"  value={nameLong}  onChange={e => setNameLong(e.target.value)} />
        </div>
        {isUnit ? (
          <>
            <div className="form-row">
              <FormField label="Einheit" id="pbt-unit" value={unitLabel} onChange={e => setUnitLabel(e.target.value)} placeholder="z. B. Stk, m²" />
            </div>
            <div className="form-row">
              <FormField label="Stückpreis (€)"  id="pbt-sp" type="number" step="0.01" value={sp} onChange={e => setSp(e.target.value)} />
              <FormField label="Stückkosten (€)" id="pbt-cp" type="number" step="0.01" value={cp} onChange={e => setCp(e.target.value)} />
            </div>
          </>
        ) : (
          <div className="form-row">
            <FormField
              label={kind === 'LUMP_COST' ? 'Standard-Betrag Kosten (€)' : 'Standard-Betrag Erlös (€)'}
              id="pbt-amount" type="number" step="0.01"
              value={kind === 'LUMP_COST' ? cp : sp}
              onChange={e => (kind === 'LUMP_COST' ? setCp(e.target.value) : setSp(e.target.value))}
            />
          </div>
        )}
        <Message text={msg?.text ?? null} type={msg?.type} />
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" onClick={handleSave} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Speichert …' : 'Anlegen'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
