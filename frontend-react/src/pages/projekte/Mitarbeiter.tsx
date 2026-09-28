import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Plus, UserPlus } from 'lucide-react'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message }      from '@/components/ui/Message'
import { Modal }        from '@/components/ui/Modal'
import { FormField }    from '@/components/ui/FormField'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { AmountInput }  from '@/components/ui/AmountInput'
import { FormSection }  from '@/components/ui/FormSection'
import { usePermission } from '@/store/permissionsStore'
import { money, fmtEur, NO_VALUE } from '@/utils/money'
import {
  fetchActiveEmployees, fetchActiveRoles,
  fetchE2PByProject, createE2P, updateE2P, deleteE2P,
  type E2PEntry, type ActiveRole,
} from '@/api/projekte'
import {
  fetchProjectBookingPrices, upsertProjectBookingPrice,
  createProjectBookingType, deleteProjectBookingType,
  BOOKING_KIND_LABEL,
  type ProjectBookingPrice, type BookingKind, type BookingTypePayload,
} from '@/api/bookingTypes'

interface Props {
  initialProjectId?: number
}

function empName(row: E2PEntry) {
  const full = `${row.EMPLOYEE_FIRST_NAME ?? ''} ${row.EMPLOYEE_LAST_NAME ?? ''}`.trim()
  return row.EMPLOYEE_SHORT_NAME ? `${row.EMPLOYEE_SHORT_NAME}: ${full}` : full
}

function roleText(abbr: string | null | undefined, name: string | null | undefined) {
  return [abbr, name].filter(Boolean).join(' · ')
}

/** Stundensatz mit Einheit — ohne Satz „—" (kein Wert, nicht 0 €). */
function Rate({ v, unit }: { v: number | null | undefined; unit?: string }) {
  if (v == null) return <>{NO_VALUE}</>
  return <>{money(v)}{unit && <span className="prl-unit">{unit}</span>}</>
}

export function Mitarbeiter({ initialProjectId }: Props) {
  if (initialProjectId == null) return <p className="ls-empty">Bitte oben ein Projekt auswählen.</p>
  // Neuer Zustand je Projekt — offene Dialoge gehören zu genau einem.
  return (
    <div className="ws-form" key={initialProjectId}>
      <p className="ws-form-intro">
        Welche Sätze in diesem Projekt gelten: je Mitarbeiter der Stundensatz, je Buchungsart der Preis.
        Buchungen übernehmen sie beim Erfassen.
      </p>
      <StundensatzBlock projectId={initialProjectId} />
      <BookingPriceBlock projectId={initialProjectId} />
    </div>
  )
}

// ── Stundensätze je Mitarbeiter (EMPLOYEE2PROJECT) ─────────────────────────────

interface E2PDraft {
  employee_id: string
  role_id:     string
  role_abbr:   string
  role_name:   string
  hourly_rate: string
}

const emptyDraft = (): E2PDraft => ({ employee_id: '', role_id: '', role_abbr: '', role_name: '', hourly_rate: '' })

function StundensatzBlock({ projectId }: { projectId: number }) {
  const qc = useQueryClient()
  // Das Backend prüft Team und Satz getrennt (routes/employee2project.js):
  // zuordnen/entfernen/ändern braucht projects.edit, einen Satz setzen
  // zusätzlich projects.hourly_rates.edit. Vorher hing hier alles an Letzterem,
  // und die Zeile „Hinzufügen" stand für jeden da — der Klick endete in einer 403.
  const canTeam = usePermission('projects.edit')
  const canRate = usePermission('projects.hourly_rates.edit')
  const [dialog, setDialog] = useState<{ row: E2PEntry | null } | null>(null)
  const [removing, setRemoving] = useState<E2PEntry | null>(null)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: e2pData, isLoading, isError } = useQuery({
    queryKey: ['e2p', projectId],
    queryFn:  () => fetchE2PByProject(projectId),
  })
  const { data: roleData } = useQuery({ queryKey: ['active-roles'], queryFn: fetchActiveRoles })
  const rows  = e2pData?.data ?? []
  const roles = roleData?.data ?? []

  const deleteMut = useMutation({
    mutationFn: deleteE2P,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['e2p', projectId] })
      setMsg({ text: 'Zuordnung entfernt. Bereits erfasste Buchungen behalten ihren Satz.', type: 'success' })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const addButton = canTeam && (
    <button type="button" className="btn-small prl-btn" onClick={() => { setMsg(null); setDialog({ row: null }) }}>
      <UserPlus size={13} strokeWidth={2} aria-hidden="true" /> Mitarbeiter zuordnen
    </button>
  )

  return (
    <FormSection title="Stundensätze je Mitarbeiter" help="projects.hourly_rates" layout="block" actions={rows.length > 0 ? addButton : undefined}>
      <Message type={msg?.type ?? 'info'} text={msg?.text ?? null} />
      {isLoading && <p className="ls-empty">Lädt …</p>}
      {isError && <Message type="error" text="Die Zuordnungen konnten nicht geladen werden." />}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="empty-block">
          <p className="empty-note">Diesem Projekt ist noch niemand zugeordnet.</p>
          <p className="empty-block-why">
            Die Zuordnung legt Rolle und Stundensatz fest, zu dem jemand in diesem Projekt bucht. Ohne sie
            gibt es keinen Satz — Stunden über die Stempeluhr zählen dann mit 0 €.
          </p>
          {addButton}
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="ls-table prl-table">
            <thead>
              <tr>
                <th scope="col" className="ls-th">Mitarbeiter · Rolle</th>
                <th scope="col" className="ls-th ls-col-num">Stundensatz</th>
                {canTeam && <th scope="col" className="ls-th prl-col-actions"><span className="sr-only">Aktionen</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const name = empName(row)
                const role = roleText(row.ROLE_ABBR, row.ROLE_NAME)
                return (
                  <tr key={row.ID} className="ls-row">
                    <td className="ls-td">
                      <div className="prl-name">{name}</div>
                      <div className="prl-sub">{role || 'ohne Rolle'}</div>
                    </td>
                    <td className="ls-td ls-col-num prl-rate"><Rate v={row.HOURLY_RATE} unit="/h" /></td>
                    {canTeam && (
                      <td className="ls-td prl-col-actions">
                        <div className="doc-actions">
                          <button type="button" className="row-action-btn" title="Bearbeiten" aria-label={`${name} bearbeiten`}
                            onClick={() => { setMsg(null); setDialog({ row }) }}>
                            <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                          </button>
                          <button type="button" className="row-action-btn row-action-btn--danger" title="Aus dem Projekt entfernen"
                            aria-label={`${name} aus dem Projekt entfernen`} onClick={() => setRemoving(row)}>
                            <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <E2PDialog
          projectId={projectId}
          row={dialog.row}
          assigned={new Set(rows.map(r => r.EMPLOYEE_ID))}
          roles={roles}
          canRate={canRate}
          onClose={() => setDialog(null)}
          onSaved={text => { setDialog(null); setMsg({ text, type: 'success' }) }}
        />
      )}

      <ConfirmModal
        open={removing !== null}
        title="Aus dem Projekt entfernen"
        message={removing ? `${empName(removing)} aus dem Projekt entfernen? Bereits erfasste Buchungen bleiben mit ihrem Satz erhalten, neue gibt es ohne Satz.` : ''}
        confirmLabel="Entfernen"
        confirmClass="danger"
        onConfirm={() => { if (removing) deleteMut.mutate(removing.ID); setRemoving(null) }}
        onCancel={() => setRemoving(null)}
      />
    </FormSection>
  )
}

function E2PDialog({ projectId, row, assigned, roles, canRate, onClose, onSaved }: {
  projectId: number
  row:       E2PEntry | null
  assigned:  Set<number>
  roles:     ActiveRole[]
  canRate:   boolean
  onClose:   () => void
  onSaved:   (text: string) => void
}) {
  const qc = useQueryClient()
  const isNew = row == null
  const [d, setD] = useState<E2PDraft>(() => row ? {
    employee_id: String(row.EMPLOYEE_ID),
    role_id:     row.ROLE_ID != null ? String(row.ROLE_ID) : '',
    role_abbr:   row.ROLE_ABBR ?? '',
    role_name:   row.ROLE_NAME ?? '',
    hourly_rate: row.HOURLY_RATE != null ? String(row.HOURLY_RATE) : '',
  } : emptyDraft())
  const [msg, setMsg] = useState<string | null>(null)
  const { data: empData } = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees, enabled: isNew })
  const candidates = (empData?.data ?? []).filter(e => !assigned.has(e.ID))

  function applyRole(roleId: string) {
    const role = roles.find(r => String(r.ID) === roleId)
    setD(f => ({
      ...f,
      role_id:     roleId,
      role_abbr:   role?.ABBR ?? f.role_abbr,
      role_name:   role?.NAME ?? f.role_name,
      hourly_rate: canRate && role?.HOURLY_RATE != null ? String(role.HOURLY_RATE) : f.hourly_rate,
    }))
  }

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        role_id:   d.role_id ? Number(d.role_id) : null,
        role_abbr: d.role_abbr.trim(),
        role_name: d.role_name.trim(),
        // Ohne das Recht auf Sätze geht das Feld gar nicht erst mit — sonst
        // lehnt das Backend die ganze Änderung ab (satzGuard).
        ...(canRate ? { hourly_rate: d.hourly_rate !== '' ? Number(d.hourly_rate) : null } : {}),
      }
      if (isNew) return createE2P(projectId, { employee_id: Number(d.employee_id), ...body }).then(() => undefined)
      return updateE2P(row.ID, body).then(() => undefined)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['e2p', projectId] })
      onSaved(isNew ? 'Mitarbeiter zugeordnet.' : 'Zuordnung gespeichert. Neue Buchungen übernehmen den Satz.')
    },
    onError: (e: Error) => setMsg(e.message),
  })

  function submit() {
    if (isNew && !d.employee_id) { setMsg('Bitte einen Mitarbeiter wählen.'); return }
    setMsg(null); mut.mutate()
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Mitarbeiter zuordnen' : `Zuordnung: ${empName(row)}`}>
      <div className="master-form prl-dialog">
        {isNew && (
          <div className="form-group">
            <label htmlFor="prl-emp">Mitarbeiter</label>
            <select id="prl-emp" value={d.employee_id} data-autofocus onChange={e => setD(f => ({ ...f, employee_id: e.target.value }))}>
              <option value="">— wählen —</option>
              {candidates.map(e => (
                <option key={e.ID} value={e.ID}>{`${e.ABBR ? e.ABBR + ': ' : ''}${e.FIRST_NAME ?? ''} ${e.LAST_NAME ?? ''}`.trim()}</option>
              ))}
            </select>
            {empData && candidates.length === 0 && <p className="form-field-hint">Alle aktiven Mitarbeiter sind schon zugeordnet.</p>}
          </div>
        )}
        <div className="form-group">
          <label htmlFor="prl-role">Rolle als Vorlage</label>
          <select id="prl-role" value={d.role_id} aria-describedby="prl-role-hint" onChange={e => applyRole(e.target.value)}>
            <option value="">— keine —</option>
            {roles.map(r => <option key={r.ID} value={r.ID}>{roleText(r.ABBR, r.NAME)}{r.HOURLY_RATE != null ? ` (${fmtEur(r.HOURLY_RATE)}/h)` : ''}</option>)}
          </select>
          <p id="prl-role-hint" className="form-field-hint">Füllt Kürzel, Bezeichnung und Satz aus Einstellungen → Stammdaten vor.</p>
        </div>
        <div className="form-row">
          <FormField label="Rollenkürzel" id="prl-role-abbr" value={d.role_abbr} onChange={e => setD(f => ({ ...f, role_abbr: e.target.value }))} placeholder="z. B. PL" />
          <FormField label="Rollenbezeichnung" id="prl-role-name" value={d.role_name} onChange={e => setD(f => ({ ...f, role_name: e.target.value }))} placeholder="z. B. Projektleitung" />
        </div>
        <div className="form-group">
          <label htmlFor="prl-rate">Stundensatz (€/h)</label>
          <AmountInput id="prl-rate" value={d.hourly_rate} placeholder="0,00" disabled={!canRate}
            aria-describedby={canRate ? undefined : 'prl-rate-hint'}
            onChange={v => setD(f => ({ ...f, hourly_rate: v }))} />
          {!canRate && <p id="prl-rate-hint" className="form-field-hint">Den Satz ändern darf, wer das Recht „Stundensätze bearbeiten" hat.</p>}
        </div>
        <Message text={msg} type="error" />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={mut.isPending || (isNew && !d.employee_id)}>
            {mut.isPending ? 'Speichert …' : isNew ? 'Zuordnen' : 'Speichern'}
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}

// ── Preise je Buchungsart ──────────────────────────────────────────────────────

/** Wirksamer Preis: der Projektpreis, sonst der Standard — mit Herkunft. */
function PriceCell({ project, standard }: { project: number | null; standard: number | null }) {
  if (project != null) return (
    <>
      <div className="prl-rate prl-rate--own">{money(project)}</div>
      <div className="prl-sub">Standard {standard != null ? fmtEur(standard) : NO_VALUE}</div>
    </>
  )
  return (
    <>
      <div className="prl-rate"><Rate v={standard} /></div>
      {standard != null && <div className="prl-sub">Standard</div>}
    </>
  )
}

function BookingPriceBlock({ projectId }: { projectId: number }) {
  const qc = useQueryClient()
  const canEdit = usePermission('projects.hourly_rates.edit')
  const [editing, setEditing] = useState<ProjectBookingPrice | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [delConfirm, setDelConfirm] = useState<{ id: number; label: string } | null>(null)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data, isLoading, isError } = useQuery({
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
    onSuccess: () => { invalidate(); setMsg({ text: 'Projektbezogene Buchungsart gelöscht. Erfasste Buchungen bleiben erhalten.', type: 'success' }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const createButton = canEdit && (
    <button type="button" className="btn-small prl-btn" onClick={() => { setMsg(null); setCreateOpen(true) }}>
      <Plus size={13} strokeWidth={2} aria-hidden="true" /> Buchungsart nur für dieses Projekt
    </button>
  )

  return (
    <FormSection
      title="Preise je Buchungsart"
      help="settings.booking_types"
      layout="block"
      actions={rows.length > 0 ? createButton : undefined}
      hint="Pauschalen und Stückleistungen. Ein Projektpreis ersetzt hier den Standard aus den Stammdaten; ohne ihn gilt der Standard."
    >
      <Message type={msg?.type ?? 'info'} text={msg?.text ?? null} />
      {isLoading && <p className="ls-empty">Lädt …</p>}
      {isError && <Message type="error" text="Die Buchungsarten konnten nicht geladen werden." />}
      {!isLoading && !isError && rows.length === 0 && (
        <div className="empty-block">
          <p className="empty-note">Es gibt noch keine Buchungsarten.</p>
          <p className="empty-block-why">
            Buchungsarten sind Pauschalen und Stückleistungen mit festem Preis, z. B. Plots oder Fahrten. Angelegt
            werden sie für alle Projekte unter Einstellungen → Stammdaten, oder hier nur für dieses Projekt.
          </p>
          {createButton}
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="ls-table prl-table">
            <thead>
              <tr>
                <th scope="col" className="ls-th">Buchungsart</th>
                <th scope="col" className="ls-th ls-col-num">Preis</th>
                <th scope="col" className="ls-th ls-col-num">Kosten</th>
                {canEdit && <th scope="col" className="ls-th prl-col-actions"><span className="sr-only">Aktionen</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const label = r.NAME ? `${r.ABBR} – ${r.NAME}` : r.ABBR
                return (
                  <tr key={r.BOOKING_TYPE_ID} className="ls-row">
                    <td className="ls-td">
                      <div className="prl-name">{label}</div>
                      <div className="prl-sub">
                        {BOOKING_KIND_LABEL[r.KIND]}
                        {r.KIND === 'UNIT' && r.UNIT_LABEL ? ` · je ${r.UNIT_LABEL}` : ''}
                        {r.SCOPE === 'project' ? ' · nur dieses Projekt' : ''}
                      </div>
                    </td>
                    <td className="ls-td ls-col-num"><PriceCell project={r.PROJECT_SP_RATE} standard={r.DEFAULT_SP_RATE} /></td>
                    <td className="ls-td ls-col-num"><PriceCell project={r.PROJECT_CP_RATE} standard={r.DEFAULT_CP_RATE} /></td>
                    {canEdit && (
                      <td className="ls-td prl-col-actions">
                        <div className="doc-actions">
                          <button type="button" className="row-action-btn" title="Projektpreis setzen" aria-label={`Projektpreis für ${r.ABBR} setzen`}
                            onClick={() => { setMsg(null); setEditing(r) }}>
                            <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                          </button>
                          {r.SCOPE === 'project' && (
                            <button type="button" className="row-action-btn row-action-btn--danger" title="Buchungsart löschen"
                              aria-label={`Buchungsart ${r.ABBR} löschen`} onClick={() => setDelConfirm({ id: r.BOOKING_TYPE_ID, label: r.ABBR })}>
                              <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PriceDialog
          projectId={projectId}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); setMsg({ text: 'Projektpreis gespeichert. Neue Buchungen übernehmen ihn.', type: 'success' }) }}
        />
      )}

      {createOpen && (
        <ProjectBookingTypeModal
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); invalidate(); setMsg({ text: 'Buchungsart für dieses Projekt angelegt.', type: 'success' }) }}
        />
      )}

      <ConfirmModal
        open={delConfirm !== null}
        title="Buchungsart löschen"
        message={`Buchungsart „${delConfirm?.label ?? ''}" löschen? Sie gilt nur in diesem Projekt; bereits erfasste Buchungen bleiben erhalten.`}
        confirmLabel="Löschen"
        confirmClass="danger"
        onConfirm={() => { if (delConfirm) delTypeMut.mutate(delConfirm.id); setDelConfirm(null) }}
        onCancel={() => setDelConfirm(null)}
      />
    </FormSection>
  )
}

function PriceDialog({ projectId, row, onClose, onSaved }: {
  projectId: number
  row:       ProjectBookingPrice
  onClose:   () => void
  onSaved:   () => void
}) {
  const [sp, setSp] = useState(row.PROJECT_SP_RATE != null ? String(row.PROJECT_SP_RATE) : '')
  const [cp, setCp] = useState(row.PROJECT_CP_RATE != null ? String(row.PROJECT_CP_RATE) : '')
  const [msg, setMsg] = useState<string | null>(null)
  const mut = useMutation({
    mutationFn: () => upsertProjectBookingPrice({
      project_id:      projectId,
      booking_type_id: row.BOOKING_TYPE_ID,
      hourly_rate:     sp !== '' ? Number(sp) : null,
      cost_rate:       cp !== '' ? Number(cp) : null,
    }),
    onSuccess: onSaved,
    onError: (e: Error) => setMsg(e.message),
  })
  const std = (v: number | null) => v != null ? fmtEur(v) : 'keiner'

  return (
    <Modal open onClose={onClose} title={`Projektpreis: ${row.ABBR}`}>
      <div className="master-form prl-dialog">
        <p className="form-field-hint prl-dialog-intro">Leer lassen, damit der Standard aus den Stammdaten gilt.</p>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="prl-sp">Preis (€)</label>
            <AmountInput id="prl-sp" value={sp} data-autofocus placeholder={row.DEFAULT_SP_RATE != null ? fmtEur(row.DEFAULT_SP_RATE) : ''}
              aria-describedby="prl-sp-hint" onChange={setSp} />
            <p id="prl-sp-hint" className="form-field-hint">Standard: {std(row.DEFAULT_SP_RATE)}</p>
          </div>
          <div className="form-group">
            <label htmlFor="prl-cp">Kosten (€)</label>
            <AmountInput id="prl-cp" value={cp} placeholder={row.DEFAULT_CP_RATE != null ? fmtEur(row.DEFAULT_CP_RATE) : ''}
              aria-describedby="prl-cp-hint" onChange={setCp} />
            <p id="prl-cp-hint" className="form-field-hint">Standard: {std(row.DEFAULT_CP_RATE)}</p>
          </div>
        </div>
        <Message text={msg} type="error" />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={() => { setMsg(null); mut.mutate() }} disabled={mut.isPending}>
            {mut.isPending ? 'Speichert …' : 'Speichern'}
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}

// ── Projektbezogene Buchungsart anlegen ────────────────────────────────────────

function ProjectBookingTypeModal({ projectId, onClose, onSaved }: { projectId: number; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<BookingKind>('UNIT')
  const [abbr, setAbbr] = useState('')
  const [name, setName] = useState('')
  const [unitLabel, setUnitLabel] = useState('')
  const [sp, setSp] = useState('')
  const [cp, setCp] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const isUnit = kind === 'UNIT'

  const saveMut = useMutation({
    mutationFn: () => {
      const payload: BookingTypePayload & { project_id: number } = {
        project_id:      projectId,
        kind,
        abbr:            abbr.trim(),
        name:            name.trim() || null,
        unit_label:      isUnit ? (unitLabel.trim() || null) : null,
        // Bei Pauschalen ist der Betrag der Standardwert: Kosten→CP, Erlös→SP.
        default_sp_rate: (isUnit || kind === 'LUMP_REVENUE') && sp !== '' ? Number(sp) : null,
        default_cp_rate: (isUnit || kind === 'LUMP_COST')    && cp !== '' ? Number(cp) : null,
      }
      return createProjectBookingType(payload)
    },
    onSuccess: onSaved,
    onError: (e: Error) => setMsg(e.message),
  })

  function handleSave() {
    if (!abbr.trim()) { setMsg('Bitte ein Kürzel angeben.'); return }
    setMsg(null); saveMut.mutate()
  }

  return (
    <Modal open onClose={onClose} title="Buchungsart nur für dieses Projekt">
      <div className="master-form prl-dialog">
        <div className="form-group">
          <label htmlFor="pbt-kind">Art</label>
          <select id="pbt-kind" value={kind} data-autofocus onChange={e => setKind(e.target.value as BookingKind)}>
            <option value="UNIT">{BOOKING_KIND_LABEL.UNIT}</option>
            <option value="LUMP_COST">{BOOKING_KIND_LABEL.LUMP_COST}</option>
            <option value="LUMP_REVENUE">{BOOKING_KIND_LABEL.LUMP_REVENUE}</option>
          </select>
        </div>
        <div className="form-row">
          <FormField label="Kürzel" id="pbt-short" value={abbr} onChange={e => setAbbr(e.target.value)} required />
          <FormField label="Bezeichnung" id="pbt-long" value={name} onChange={e => setName(e.target.value)} />
        </div>
        {isUnit ? (
          <>
            <FormField label="Einheit" id="pbt-unit" value={unitLabel} onChange={e => setUnitLabel(e.target.value)} placeholder="z. B. Stk, m²" />
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="pbt-sp">Stückpreis (€)</label>
                <AmountInput id="pbt-sp" value={sp} placeholder="0,00" onChange={setSp} />
              </div>
              <div className="form-group">
                <label htmlFor="pbt-cp">Stückkosten (€)</label>
                <AmountInput id="pbt-cp" value={cp} placeholder="0,00" onChange={setCp} />
              </div>
            </div>
          </>
        ) : (
          <div className="form-group">
            <label htmlFor="pbt-amount">{kind === 'LUMP_COST' ? 'Betrag Kosten (€)' : 'Betrag Erlös (€)'}</label>
            <AmountInput id="pbt-amount" value={kind === 'LUMP_COST' ? cp : sp} placeholder="0,00"
              onChange={v => (kind === 'LUMP_COST' ? setCp(v) : setSp(v))} />
          </div>
        )}
        <Message text={msg} type="error" />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Speichert …' : 'Anlegen'}
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}
