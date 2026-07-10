import { useState, useMemo, useRef, useEffect, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs }        from '@/components/ui/Tabs'
import { Modal }       from '@/components/ui/Modal'
import { Message }     from '@/components/ui/Message'
import { FormField }   from '@/components/ui/FormField'
import { HelpHint }    from '@/components/ui/HelpHint'
import type { HelpId } from '@/help/helpContent'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useCtrlS }    from '@/hooks/useCtrlS'
import { useToast }    from '@/store/toastStore'
import { Pencil, Trash2, Download, AlertTriangle } from 'lucide-react'
import { fetchRoles, fetchEmployeeRoleMap, setEmployeeRoles, type UserRole, type EmployeeRoleMapping } from '@/api/rbac'
import { useFilterTabs, usePermission } from '@/store/permissionsStore'
import { useLicenseFilterTabs, useFeature } from '@/store/licenseStore'
import { Can } from '@/components/ui/Can'
import {
  fetchEmployeeList, fetchEmployeeGenders, createEmployee, updateEmployee, deleteEmployee,
  fetchEmployeeWorkModels, createEmployeeWorkModel, updateEmployeeWorkModel, deleteEmployeeWorkModel,
  fetchEmployeeCpRates, createEmployeeCpRate, updateEmployeeCpRate, deleteEmployeeCpRate,
  fetchMonthBalance, fetchRunningBalance,
  fetchMonthCloseStatus, closeMonth, reopenMonth, fetchMonthCloseOverview, setEmployeePassword,
  fetchEmployeeReportList, fetchEmployeeProjects, fetchEmployeeAvatar,
  type Employee, type CreateEmployeePayload, type UpdateEmployeePayload,
  type EmployeeWorkModel, type EmployeeCpRate, type MonthBalance, type RunningMonth,
  type MonthCloseOverviewEmployee, type DayBooking, type EmployeeReportRow, type EmployeeProject,
} from '@/api/mitarbeiter'
import { fetchDepartments, fetchWorkingTimeModels, type StammdatenItem, type WorkingTimeModel } from '@/api/stammdaten'
import { RecentList } from '@/components/recents/RecentList'
import { useTrackFilterRecent } from '@/hooks/useTrackFilterRecent'
import { fetchArbzgAudit, downloadArbzgAuditCsv, type AuditEntry, type ArbzgSeverity } from '@/api/arbzg'
import { updateBuchung, deleteBuchung } from '@/api/projekte'
import {
  fetchAbsenceTypes, fetchAbsences, fetchVacationBalance, fetchEntitlements, putEntitlement,
  createAbsence, decideAbsence, cancelAbsence, deleteAbsence,
  type Absence, type AbsenceStatus,
} from '@/api/abwesenheit'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25
const TABS: { id: string; label: string; permissions: string[]; feature?: string }[] = [
  { id: 'list',          label: 'Mitarbeiter',           permissions: ['employees.view'] },
  { id: 'zeitwirtschaft', label: 'Zeitwirtschaft',       permissions: ['employees.bookings.view_all','employees.month_close.edit','absence.view'] },
  { id: 'arbzg',         label: 'Arbeitszeit (Details)', permissions: ['employees.bookings.view_all'], feature: 'arbzg.compliance' },
]
const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const MONTH_NAMES   = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

type SortKey = 'SHORT_NAME' | 'FIRST_NAME' | 'LAST_NAME' | 'MAIL'
type EmpSection = 'stammdaten' | 'kostensatz' | 'arbeitszeit' | 'zeitkonto' | 'abwesenheit' | 'projekte' | 'rolle' | 'passwort'

function fmtH(n: number) {
  return n.toFixed(2).replace('.', ',') + ' h'
}
function fmtBalance(n: number) {
  const s = Math.abs(n).toFixed(2).replace('.', ',') + ' h'
  return n >= 0 ? `+${s}` : `−${s}`
}

function emptyCreateForm(): CreateEmployeePayload {
  return { short_name: '', title: '', first_name: '', last_name: '', password: '', email: '', mobile: '', personnel_number: '', gender_id: '', entry_date: '' }
}

// ID des aktuell gueltigen Eintrags (juengstes VALID_FROM <= heute) aus einer
// datierten Historie (Kostensatz / Arbeitszeitmodell).
function latestValidId<T extends { ID: number; VALID_FROM: string }>(items: T[], today: string): number | null {
  const valid = items.filter(i => i.VALID_FROM <= today)
  if (!valid.length) return null
  return valid.reduce((a, b) => (a.VALID_FROM >= b.VALID_FROM ? a : b)).ID
}

function HistBadge({ kind }: { kind: 'current' | 'planned' }) {
  const style = kind === 'current'
    ? { background: '#dcfce7', color: '#166534' }
    : { background: '#dbeafe', color: '#1e40af' }
  return (
    <span style={{ ...style, fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8, marginLeft: 6 }}>
      {kind === 'current' ? 'aktuell' : 'geplant'}
    </span>
  )
}

// CSV-Export (clientseitig): deutsches Excel-Format (Semikolon, UTF-8-BOM).
function csvEscape(v: string | number): string {
  const s = String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const body = rows.map(r => r.map(csvEscape).join(';')).join('\r\n')
  const blob = new Blob([String.fromCharCode(0xFEFF) + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

// ── SegmentNav ────────────────────────────────────────────────────────────────
// Einheitlicher Umschalter (Segment-Control) fuer Unter-Navigation/Sektionen.

function SegmentNav<T extends string>({ items, active, onChange, style }: {
  items:    { id: T; label: string }[]
  active:   T
  onChange: (id: T) => void
  style?:   React.CSSProperties
}) {
  return (
    <div className="seg-nav" style={style}>
      {items.map(it => (
        <button
          key={it.id}
          type="button"
          className={`seg-nav-btn${active === it.id ? ' active' : ''}`}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
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

// ── Rolle-Sektion (innerhalb der Mitarbeiter-Akte) ───────────────────────────

function RoleSection({ employeeId, roles, mapping }: {
  employeeId: number
  roles:   UserRole[]
  mapping: EmployeeRoleMapping[]
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const currentIds = mapping.filter(m => m.EMPLOYEE_ID === employeeId).map(m => m.ROLE_ID)
  const [selected, setSelected] = useState<Set<number>>(new Set(currentIds))

  const saveMut = useMutation({
    mutationFn: () => setEmployeeRoles(employeeId, Array.from(selected)),
    onSuccess: () => {
      toast.success('Rollen aktualisiert')
      void qc.invalidateQueries({ queryKey: ['employee-role-map'] })
      void qc.invalidateQueries({ queryKey: ['user-roles'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
        Mehrere Rollen sind möglich — der Mitarbeiter erhält die Vereinigungsmenge der Berechtigungen.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
        {roles.map(r => {
          const on = selected.has(r.ID)
          return (
            <label key={r.ID} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
              border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
              background: on ? '#f0f9ff' : 'transparent',
            }}>
              <input type="checkbox" checked={on} onChange={() => setSelected(prev => {
                const next = new Set(prev)
                if (next.has(r.ID)) next.delete(r.ID); else next.add(r.ID)
                return next
              })} />
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: r.COLOR || '#6b7280' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.NAME_SHORT}</div>
                {r.NAME_LONG && <div style={{ fontSize: 11, color: '#6b7280' }}>{r.NAME_LONG}</div>}
              </div>
              {r.IS_SYSTEM && <span style={{ fontSize: 10, color: '#6b7280' }}>SYSTEM</span>}
            </label>
          )
        })}
        {!roles.length && <p className="empty-note">Noch keine Rollen definiert.</p>}
      </div>
      <div className="modal-actions">
        <button className="btn-primary" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {saveMut.isPending ? 'Speichert …' : 'Rollen speichern'}
        </button>
      </div>
    </div>
  )
}

// ── Projekte-Sektion (innerhalb der Mitarbeiter-Akte) ────────────────────────

function EmployeeProjectsSection({ employeeId }: { employeeId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['emp-projects', employeeId],
    queryFn:  () => fetchEmployeeProjects(employeeId),
  })
  const rows: EmployeeProject[] = data?.data ?? []

  if (isLoading) return <p className="empty-note">Laden …</p>
  if (!rows.length) return <p className="empty-note">Dieser Mitarbeiter ist keinem Projekt zugeordnet.</p>

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: 12 }}>
          <th style={{ textAlign: 'left',  padding: '3px 8px 4px 0' }}>Projekt</th>
          <th style={{ textAlign: 'left',  padding: '3px 8px 4px 0' }}>Status</th>
          <th style={{ textAlign: 'left',  padding: '3px 8px 4px 0' }}>Rolle</th>
          <th style={{ textAlign: 'right', padding: '3px 0 4px 8px' }}>Stundensatz</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.ID} style={{ borderBottom: '1px solid #f3f4f6' }}>
            <td style={{ padding: '4px 8px 4px 0' }}>
              <strong>{r.PROJECT_NUMBER || '—'}</strong>
              {r.PROJECT_NAME ? <span style={{ color: '#6b7280' }}> · {r.PROJECT_NAME}</span> : null}
            </td>
            <td style={{ padding: '4px 8px 4px 0' }}>{r.STATUS_NAME || '—'}</td>
            <td style={{ padding: '4px 8px 4px 0' }}>{r.ROLE_NAME_SHORT || '—'}</td>
            <td style={{ padding: '4px 0 4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {r.SP_RATE != null ? `${Number(r.SP_RATE).toFixed(2)} €/h` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Abwesenheits-Sektion (innerhalb der Mitarbeiter-Akte) ────────────────────

function fmtDateShort(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function AbsenceStatusBadge({ status }: { status: AbsenceStatus }) {
  const map: Record<AbsenceStatus, { label: string; bg: string; color: string }> = {
    REQUESTED: { label: 'Beantragt',  bg: '#fef3c7', color: '#92400e' },
    APPROVED:  { label: 'Genehmigt',  bg: '#dcfce7', color: '#166534' },
    REJECTED:  { label: 'Abgelehnt',  bg: '#fee2e2', color: '#b91c1c' },
    CANCELLED: { label: 'Storniert',  bg: '#f3f4f6', color: '#6b7280' },
  }
  const s = map[status]
  return <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>{s.label}</span>
}

function EmployeeAbsenceSection({ employeeId }: { employeeId: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const canManage  = usePermission('absence.manage')
  const canApprove = usePermission('absence.approve')
  const year = new Date().getFullYear()

  const { data: typesRes }            = useQuery({ queryKey: ['absence-types'],                queryFn: fetchAbsenceTypes })
  const { data: absRes, isLoading }   = useQuery({ queryKey: ['absences', employeeId],         queryFn: () => fetchAbsences({ employee_id: employeeId }) })
  const { data: balRes }              = useQuery({ queryKey: ['vacation-balance', employeeId, year], queryFn: () => fetchVacationBalance(employeeId, year) })
  const { data: entRes }              = useQuery({ queryKey: ['entitlements', employeeId, year],     queryFn: () => fetchEntitlements(employeeId, year), enabled: canManage })

  const types     = (typesRes?.data ?? []).filter(t => t.ACTIVE)
  const absences  = absRes?.data ?? []
  const bal       = balRes?.data
  const entThisYear = (entRes?.data ?? []).find(e => e.YEAR === year)

  const [editEnt, setEditEnt] = useState(false)
  const [entDays,  setEntDays]  = useState('')
  const [entCarry, setEntCarry] = useState('')
  function openEntEditor() {
    setEntDays(entThisYear ? String(entThisYear.DAYS_ENTITLED) : (bal ? String(bal.entitled) : '0'))
    setEntCarry(entThisYear?.CARRYOVER_OVERRIDE != null ? String(entThisYear.CARRYOVER_OVERRIDE) : '')
    setEditEnt(true)
  }
  const entMut = useMutation({
    mutationFn: () => putEntitlement({
      employee_id: employeeId, year,
      days_entitled: Number(entDays.replace(',', '.')) || 0,
      carryover_override: entCarry.trim() === '' ? null : Number(entCarry.replace(',', '.')),
    }),
    onSuccess: () => {
      toast.success('Urlaubsanspruch gespeichert'); setEditEnt(false)
      void qc.invalidateQueries({ queryKey: ['entitlements', employeeId] })
      void qc.invalidateQueries({ queryKey: ['vacation-balance', employeeId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [showForm, setShowForm] = useState(false)
  const [fType, setFType] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo,   setFTo]   = useState('')
  const [fHalf, setFHalf] = useState(false)
  const [fNote, setFNote] = useState('')

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['absences', employeeId] })
    void qc.invalidateQueries({ queryKey: ['vacation-balance', employeeId] })
  }

  const createMut = useMutation({
    mutationFn: () => createAbsence({
      employee_id: employeeId, absence_type_id: Number(fType),
      date_from: fFrom, date_to: fTo || fFrom, half_day: fHalf && (!fTo || fTo === fFrom), note: fNote,
    }),
    onSuccess: () => { toast.success('Abwesenheit erfasst'); setShowForm(false); setFType(''); setFFrom(''); setFTo(''); setFHalf(false); setFNote(''); invalidate() },
    onError: (e: Error) => toast.error(e.message),
  })
  const decideMut = useMutation({
    mutationFn: (v: { id: number; decision: 'APPROVED' | 'REJECTED' }) => decideAbsence(v.id, v.decision),
    onSuccess: () => { toast.success('Entscheidung gespeichert'); invalidate() },
    onError: (e: Error) => toast.error(e.message),
  })
  const cancelMut = useMutation({ mutationFn: (id: number) => cancelAbsence(id), onSuccess: () => { toast.success('Storniert'); invalidate() }, onError: (e: Error) => toast.error(e.message) })
  const deleteMut = useMutation({ mutationFn: (id: number) => deleteAbsence(id), onSuccess: () => { toast.success('Gelöscht'); invalidate() }, onError: (e: Error) => toast.error(e.message) })

  const singleDay = !!fFrom && (!fTo || fTo === fFrom)
  const stat = (label: string, value: string, color?: string) => (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 16, color: color ?? 'inherit' }}>{value}</div>
    </div>
  )

  return (
    <div>
      {/* Urlaubssaldo */}
      <div style={{ display: 'flex', gap: 18, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 16px', marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {stat('Anspruch', bal ? `${bal.entitled} T` : '…')}
        {stat('Übertrag', bal ? `${bal.carryover} T` : '…')}
        {stat('Genommen', bal ? `${bal.taken} T` : '…')}
        {bal && !!bal.forfeited && bal.forfeited > 0 && stat('Verfallen', `${bal.forfeited} T`, '#dc2626')}
        {stat('Resturlaub', bal ? `${bal.remaining} T` : '…', bal && bal.remaining < 0 ? '#dc2626' : '#059669')}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af', textAlign: 'right' }}>
          Urlaub {year} ({bal?.carryoverExpires ? `Übertrag verfällt ${bal.carryoverExpiryLabel ?? '31.03.'}` : 'Übertrag automatisch'})
          {bal && !!bal.atRisk && bal.atRisk > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', color: '#d97706', marginTop: 2 }}>
              <AlertTriangle size={12} strokeWidth={2} /> {bal.atRisk} T Übertrag verfallen am {bal.carryoverExpiryLabel ?? '31.03.'}
            </span>
          )}
        </span>
      </div>

      {canManage && !editEnt && (
        <button type="button" className="btn-small" style={{ marginBottom: 14 }} onClick={openEntEditor}>
          Urlaubsanspruch {year} bearbeiten
        </button>
      )}
      {canManage && editEnt && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, marginBottom: 14 }}>
          <div className="form-row">
            <div className="form-group">
              <label>Anspruch {year} (Tage)</label>
              <input type="number" step="0.5" min="0" value={entDays} onChange={e => setEntDays(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Übertrag manuell (optional)</label>
              <input type="number" step="0.5" value={entCarry} onChange={e => setEntCarry(e.target.value)} placeholder="automatisch" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-small btn-save" disabled={entMut.isPending} onClick={() => entMut.mutate()}>
              {entMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" className="btn-small" onClick={() => setEditEnt(false)}>Abbrechen</button>
          </div>
          <p style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
            Übertrag leer lassen = automatisch aus dem Resturlaub des Vorjahres.
          </p>
        </div>
      )}

      {canManage && (
        <div style={{ marginBottom: 12 }}>
          {!showForm
            ? <button type="button" className="btn-small btn-save" onClick={() => setShowForm(true)}>+ Abwesenheit erfassen</button>
            : (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Art</label>
                    <select value={fType} onChange={e => setFType(e.target.value)}>
                      <option value="">Bitte wählen …</option>
                      {types.map(t => <option key={t.ID} value={t.ID}>{t.NAME}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Von</label>
                    <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Bis</label>
                    <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} />
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: singleDay ? 'var(--text-2)' : '#9ca3af', margin: '4px 0 8px' }}>
                  <input type="checkbox" checked={fHalf} disabled={!singleDay} onChange={e => setFHalf(e.target.checked)} />
                  Halber Tag (nur bei eintägiger Abwesenheit)
                </label>
                <div className="form-group">
                  <label>Notiz</label>
                  <input type="text" value={fNote} onChange={e => setFNote(e.target.value)} placeholder="optional" />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn-small btn-save" disabled={!fType || !fFrom || createMut.isPending}
                    onClick={() => createMut.mutate()}>{createMut.isPending ? 'Speichert …' : 'Speichern'}</button>
                  <button type="button" className="btn-small" onClick={() => setShowForm(false)}>Abbrechen</button>
                </div>
              </div>
            )}
        </div>
      )}

      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && absences.length === 0 && <p className="empty-note">Noch keine Abwesenheiten erfasst.</p>}

      {absences.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: 12 }}>
              <th style={{ textAlign: 'left', padding: '3px 8px 4px 0' }}>Zeitraum</th>
              <th style={{ textAlign: 'left', padding: '3px 8px 4px 0' }}>Art</th>
              <th style={{ textAlign: 'right', padding: '3px 8px 4px 0' }}>Tage</th>
              <th style={{ textAlign: 'left', padding: '3px 8px 4px 0' }}>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {absences.map((a: Absence) => (
              <tr key={a.ID} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '5px 8px 5px 0', whiteSpace: 'nowrap' }}>
                  {fmtDateShort(a.DATE_FROM)}{a.DATE_TO !== a.DATE_FROM ? `–${fmtDateShort(a.DATE_TO)}` : ''}
                  {a.HALF_DAY && <span style={{ color: '#6b7280' }}> (½)</span>}
                </td>
                <td style={{ padding: '5px 8px 5px 0' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: a.TYPE_COLOR || '#9ca3af', marginRight: 6 }} />
                  {a.TYPE_NAME || '—'}
                </td>
                <td style={{ padding: '5px 8px 5px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.DAYS}</td>
                <td style={{ padding: '5px 8px 5px 0' }}><AbsenceStatusBadge status={a.STATUS} /></td>
                <td style={{ padding: '5px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {canApprove && a.STATUS === 'REQUESTED' && (
                    <>
                      <button type="button" className="btn-small btn-save" style={{ padding: '1px 8px', fontSize: 11, marginRight: 4 }}
                        disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: a.ID, decision: 'APPROVED' })}>Genehmigen</button>
                      <button type="button" className="btn-small" style={{ padding: '1px 8px', fontSize: 11, marginRight: 4 }}
                        disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: a.ID, decision: 'REJECTED' })}>Ablehnen</button>
                    </>
                  )}
                  {canManage && a.STATUS === 'APPROVED' && (
                    <button type="button" className="btn-small" style={{ padding: '1px 8px', fontSize: 11, marginRight: 4 }}
                      disabled={cancelMut.isPending} onClick={() => cancelMut.mutate(a.ID)}>Stornieren</button>
                  )}
                  {canManage && (
                    <button type="button" className="btn-small btn-danger" style={{ padding: '1px 6px', fontSize: 11 }}
                      disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(a.ID)}>×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Employee Edit Modal ───────────────────────────────────────────────────────

function EmployeeEditModal({ employee, onClose, genders, departments, workModels, roles, mapping, initialSection = 'stammdaten' }: {
  employee:    Employee
  onClose:     () => void
  genders:     Array<{ ID: number; GENDER: string }>
  departments: StammdatenItem[]
  workModels:  WorkingTimeModel[]
  roles:       UserRole[]
  mapping:     EmployeeRoleMapping[]
  initialSection?: EmpSection
}) {
  const qc = useQueryClient()
  const canAssignRoles = usePermission('employees.role.assign')
  const canViewBookings = usePermission('employees.bookings.view_all')
  const canViewAbsence = usePermission('absence.view')
  const [section,  setSection]  = useState<EmpSection>(initialSection)
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
    entry_date:       employee.ENTRY_DATE ?? '',
    exit_date:        employee.EXIT_DATE ?? '',
    active:           employee.ACTIVE ?? 1,
    dashboard_role:   employee.DASHBOARD_ROLE ?? null,
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

  // Password management state
  const [newPw,      setNewPw]      = useState('')
  const [pwMsg,      setPwMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [pwSaving,   setPwSaving]   = useState(false)

  const { data: cpRatesRes }    = useQuery({ queryKey: ['emp-cp-rates',    employee.ID], queryFn: () => fetchEmployeeCpRates(employee.ID)   })
  const { data: workModelsRes } = useQuery({ queryKey: ['emp-work-models', employee.ID], queryFn: () => fetchEmployeeWorkModels(employee.ID) })
  const cpRates:   EmployeeCpRate[]    = cpRatesRes?.data   ?? []
  const empWmList: EmployeeWorkModel[] = workModelsRes?.data ?? []

  // Laufender Saldo fuer den Akten-Kopf (gleicher Query-Key wie das Zeitkonto
  // -> nach einer Buchungsaenderung aktualisiert sich der Kopf automatisch).
  const { data: runRes } = useQuery({
    queryKey: ['emp-balance-running', employee.ID],
    queryFn:  () => fetchRunningBalance(employee.ID),
    enabled:  canViewBookings,
  })
  const runningBalance = runRes?.data?.totalBalance ?? null

  const { data: avatarRes } = useQuery({
    queryKey: ['emp-avatar', employee.ID],
    queryFn:  () => fetchEmployeeAvatar(employee.ID),
  })
  const avatarUri = avatarRes?.data?.data_uri ?? null

  // Aktuell gueltiger Kostensatz/Modell = Eintrag mit dem juengsten VALID_FROM <= heute.
  const todayStr = new Date().toISOString().slice(0, 10)
  const currentCpId = useMemo(() => latestValidId(cpRates,   todayStr), [cpRates,   todayStr])
  const currentWmId = useMemo(() => latestValidId(empWmList, todayStr), [empWmList, todayStr])
  const currentCpRate = useMemo(() => {
    const cur = cpRates.find(r => r.ID === currentCpId)
    return cur ? cur.CP_RATE : null
  }, [cpRates, currentCpId])

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

  const sectionItems: { id: EmpSection; label: string }[] = [
    { id: 'stammdaten',  label: 'Stammdaten' },
    { id: 'kostensatz',  label: 'Kostensatz' },
    { id: 'arbeitszeit', label: 'Arbeitszeit' },
    ...(canViewBookings ? [{ id: 'zeitkonto' as EmpSection, label: 'Zeitkonto' }] : []),
    ...(canViewAbsence  ? [{ id: 'abwesenheit' as EmpSection, label: 'Abwesenheit' }] : []),
    { id: 'projekte',    label: 'Projekte' },
    ...(canAssignRoles  ? [{ id: 'rolle' as EmpSection, label: 'Rolle & Rechte' }] : []),
    { id: 'passwort',    label: 'Passwort' },
  ]

  const seed = employee.SHORT_NAME || employee.LAST_NAME || 'x'
  const avatarHue = [...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0)
  const avatarBg = `hsl(${avatarHue}, 50%, 45%)`
  const initials = `${employee.FIRST_NAME?.[0] ?? ''}${employee.LAST_NAME?.[0] ?? ''}`.toUpperCase() || '?'
  const balColor = (n: number) => n > 0 ? '#059669' : n < 0 ? '#dc2626' : '#6b7280'

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: '0 0 14px', marginBottom: 14, borderBottom: '1px solid #e5e7eb',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
          background: avatarBg, color: '#fff', fontWeight: 700, fontSize: 15,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {avatarUri
            ? <img src={avatarUri} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{employee.FIRST_NAME} {employee.LAST_NAME}</span>
            <span style={{ fontSize: 11, color: '#6b7280' }}>{employee.SHORT_NAME}</span>
            <span style={{
              fontSize: 11, padding: '1px 7px', borderRadius: 10, fontWeight: 500,
              background: employee.ACTIVE === 2 ? '#fee2e2' : '#dcfce7',
              color:      employee.ACTIVE === 2 ? '#b91c1c' : '#166534',
            }}>{employee.ACTIVE === 2 ? 'Inaktiv' : 'Aktiv'}</span>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            {employee.DEPARTMENT_NAME || '—'} · {employee.CURRENT_MODEL_NAME || 'kein Modell'}
            {employee.ENTRY_DATE && ` · seit ${new Date(employee.ENTRY_DATE).toLocaleDateString('de-DE')}`}
            {employee.EXIT_DATE && ` · bis ${new Date(employee.EXIT_DATE).toLocaleDateString('de-DE')}`}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 18, textAlign: 'right' }}>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Kostensatz</div>
            <div style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
              {currentCpRate != null ? `${currentCpRate.toFixed(2)} €/h` : '—'}
            </div>
          </div>
          {canViewBookings && (
            <div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Saldo (laufend)</div>
              <div style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums',
                            color: runningBalance != null ? balColor(runningBalance) : '#9ca3af' }}>
                {runningBalance != null ? fmtBalance(runningBalance) : '…'}
              </div>
            </div>
          )}
        </div>
      </div>

      <SegmentNav items={sectionItems} active={section} onChange={setSection} />

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
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="eentry">Eintrittsdatum</label>
              <input id="eentry" type="date" value={editForm.entry_date ?? ''} onChange={setE('entry_date')} />
            </div>
            <div className="form-group">
              <label htmlFor="eexit">Austrittsdatum</label>
              <input id="eexit" type="date" value={editForm.exit_date ?? ''} onChange={setE('exit_date')} />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="edashrole">Dashboard-Rolle</label>
            <select id="edashrole" value={editForm.dashboard_role ?? ''} onChange={e => setEditForm(f => ({ ...f, dashboard_role: e.target.value || null }))}>
              <option value="">— Standard (Nutzer wählt selbst) —</option>
              <option value="geschaeftsleitung">Geschäftsleitung</option>
              <option value="controller">Controller / Buchhaltung</option>
              <option value="bereichsleiter">Projektleiter</option>
              <option value="mitarbeiter">Mitarbeiter</option>
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
                      <td style={{ padding: '3px 8px 3px 0' }}>
                        {r.VALID_FROM}
                        {r.ID === currentCpId ? <HistBadge kind="current" /> : r.VALID_FROM > todayStr ? <HistBadge kind="planned" /> : null}
                      </td>
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
                      <td style={{ padding: '3px 8px 3px 0' }}>
                        {wm.VALID_FROM}
                        {wm.ID === currentWmId ? <HistBadge kind="current" /> : wm.VALID_FROM > todayStr ? <HistBadge kind="planned" /> : null}
                      </td>
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

      {section === 'zeitkonto' && canViewBookings && (
        <EmployeeTimeAccount empId={employee.ID} />
      )}

      {section === 'abwesenheit' && canViewAbsence && (
        <EmployeeAbsenceSection employeeId={employee.ID} />
      )}

      {section === 'projekte' && (
        <EmployeeProjectsSection employeeId={employee.ID} />
      )}

      {section === 'rolle' && canAssignRoles && (
        <RoleSection employeeId={employee.ID} roles={roles} mapping={mapping} />
      )}

      {section === 'passwort' && (
        <div>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
            Hier können Sie das Passwort des Mitarbeiters setzen oder löschen (Passwort = leer → Mitarbeiter kann sich ohne Passwort anmelden).
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
            <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 12 }}>Neues Passwort (mind. 8 Zeichen)</label>
              <input
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="Leer lassen, um Passwort zu löschen"
              />
            </div>
            <button
              type="button"
              className="btn-small btn-save"
              disabled={pwSaving || (newPw.length > 0 && newPw.length < 8)}
              onClick={async () => {
                setPwMsg(null)
                setPwSaving(true)
                try {
                  await setEmployeePassword(employee.ID, newPw || null)
                  setPwMsg({ text: newPw ? 'Passwort gesetzt ✅' : 'Passwort gelöscht ✅', type: 'success' })
                  setNewPw('')
                } catch (e: unknown) {
                  setPwMsg({ text: (e as Error).message, type: 'error' })
                } finally { setPwSaving(false) }
              }}
            >
              {pwSaving ? '…' : newPw ? 'Passwort setzen' : 'Passwort löschen'}
            </button>
          </div>
          <Message text={pwMsg?.text ?? null} type={pwMsg?.type} />
        </div>
      )}
    </>
  )
}

// ── Employee List Report ───────────────────────────────────────────────────────

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v != null ? JSON.parse(v) as T : fallback } catch { return fallback }
}
function lsPut(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }

type EmpRepMode = 'now' | 'as_of' | 'period'

const ERP = 'plain:filt:emp-rep'

function EmployeeListReport({ employees }: { employees: Employee[] }) {
  const [mode,        setMode]        = useState<EmpRepMode>('now')
  const [asOfDate,    setAsOfDate]    = useState('')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [filterEmpId, setFilterEmpId] = useState<number | null>(null)
  const [search,      setSearch]      = useState('')
  const [deptFilter,  setDeptFilter]  = useState<Set<string>>(() => new Set(lsGet<string[]>(`${ERP}:dept`,   [])))
  const [statusFilter,setStatusFilter]= useState<Set<string>>(() => new Set(lsGet<string[]>(`${ERP}:status`,[])))
  const [modelFilter, setModelFilter] = useState<Set<string>>(() => new Set(lsGet<string[]>(`${ERP}:model`, [])))
  const [sortField,   setSortField]   = useState<string>(() => lsGet(`${ERP}:sortField`, 'name'))
  const [sortDir,     setSortDir]     = useState<'asc' | 'desc'>(() => lsGet<'asc'|'desc'>(`${ERP}:sortDir`, 'asc'))

  useEffect(() => { lsPut(`${ERP}:dept`,      [...deptFilter])   }, [deptFilter])
  useEffect(() => { lsPut(`${ERP}:status`,    [...statusFilter]) }, [statusFilter])
  useEffect(() => { lsPut(`${ERP}:model`,     [...modelFilter])  }, [modelFilter])
  useEffect(() => { lsPut(`${ERP}:sortField`, sortField)         }, [sortField])
  useEffect(() => { lsPut(`${ERP}:sortDir`,   sortDir)           }, [sortDir])

  const empMap = useMemo(() => new Map(employees.map(e => [e.ID, e])), [employees])
  const statusOptions = ['Aktiv', 'Inaktiv']
  const modelOptions  = useMemo(() =>
    [...new Set(employees.map(e => e.CURRENT_MODEL_NAME).filter(Boolean))].sort(),
  [employees])

  const filterReady =
    mode === 'now' ||
    (mode === 'as_of'  && asOfDate !== '') ||
    (mode === 'period' && dateFrom !== '' && dateTo !== '')

  // ── Recents-Tracking fuer Mitarbeiter-Reports-Filter ────────────────────
  const recentSnapshot = useMemo(() => ({
    mode, asOfDate, dateFrom, dateTo,
    dept:   [...deptFilter].sort(),
    status: [...statusFilter].sort(),
    model:  [...modelFilter].sort(),
  }), [mode, asOfDate, dateFrom, dateTo, deptFilter, statusFilter, modelFilter])
  const recentLabel = useMemo(() => {
    const parts: string[] = []
    if (mode === 'as_of'  && asOfDate)             parts.push(`Stichtag ${asOfDate}`)
    if (mode === 'period' && dateFrom && dateTo)   parts.push(`${dateFrom} – ${dateTo}`)
    if (mode === 'now')                            parts.push('Aktuell')
    if (deptFilter.size  > 0) parts.push(`Abt.: ${[...deptFilter].slice(0,2).join(', ')}${deptFilter.size > 2 ? ` +${deptFilter.size-2}` : ''}`)
    if (statusFilter.size > 0) parts.push(`Status: ${[...statusFilter].join(', ')}`)
    if (modelFilter.size  > 0) parts.push(`Modell: ${[...modelFilter].slice(0,2).join(', ')}${modelFilter.size > 2 ? ` +${modelFilter.size-2}` : ''}`)
    return parts.join(' · ') || 'Alle'
  }, [mode, asOfDate, dateFrom, dateTo, deptFilter, statusFilter, modelFilter])
  const hasAnyDimension = deptFilter.size > 0 || statusFilter.size > 0 || modelFilter.size > 0
  const shouldTrack = filterReady && (mode !== 'now' || hasAnyDimension)
  useTrackFilterRecent('mitarbeiter_report_filter', recentSnapshot, recentLabel, shouldTrack)

  function applyRecent(meta: Record<string, unknown> | null) {
    if (!meta) return
    if (typeof meta.mode     === 'string') setMode(meta.mode as EmpRepMode)
    if (typeof meta.asOfDate === 'string') setAsOfDate(meta.asOfDate)
    if (typeof meta.dateFrom === 'string') setDateFrom(meta.dateFrom)
    if (typeof meta.dateTo   === 'string') setDateTo(meta.dateTo)
    if (Array.isArray(meta.dept))   setDeptFilter(new Set(meta.dept   as string[]))
    if (Array.isArray(meta.status)) setStatusFilter(new Set(meta.status as string[]))
    if (Array.isArray(meta.model))  setModelFilter(new Set(meta.model  as string[]))
  }

  const qparams = filterReady ? {
    mode,
    asOfDate:   mode === 'as_of'  ? asOfDate : undefined,
    dateFrom:   mode === 'period' ? dateFrom : undefined,
    dateTo:     mode === 'period' ? dateTo   : undefined,
    employeeId: filterEmpId ?? undefined,
  } : null

  const { data, isLoading } = useQuery({
    queryKey: ['emp-report-list', qparams],
    queryFn:  () => fetchEmployeeReportList(qparams!),
    enabled:  filterReady,
  })

  const allRows: EmployeeReportRow[] = data?.data ?? []

  const deptOptions = useMemo(() =>
    [...new Set(allRows.map(r => r.DEPARTMENT_NAME).filter(Boolean))].sort(),
  [allRows])

  const filtered = useMemo(() => {
    let rows = allRows
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        r.SHORT_NAME.toLowerCase().includes(q) ||
        r.FIRST_NAME.toLowerCase().includes(q) ||
        r.LAST_NAME.toLowerCase().includes(q) ||
        (r.DEPARTMENT_NAME || '').toLowerCase().includes(q)
      )
    }
    if (deptFilter.size > 0)   rows = rows.filter(r => deptFilter.has(r.DEPARTMENT_NAME))
    if (statusFilter.size > 0) rows = rows.filter(r => {
      const emp = empMap.get(r.EMPLOYEE_ID)
      return statusFilter.has(emp?.ACTIVE === 2 ? 'Inaktiv' : 'Aktiv')
    })
    if (modelFilter.size > 0) rows = rows.filter(r => {
      const emp = empMap.get(r.EMPLOYEE_ID)
      return modelFilter.has(emp?.CURRENT_MODEL_NAME ?? '')
    })
    return rows
  }, [allRows, search, deptFilter, statusFilter, modelFilter, empMap])

  function toggleSort(field: string) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }
  function si(field: string) { return sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '' }

  const balanceColor = (n: number) => n > 0 ? '#059669' : n < 0 ? '#dc2626' : '#6b7280'

  function sortFlat(rows: EmployeeReportRow[]) {
    return [...rows].sort((a, b) => {
      let va: string | number = 0, vb: string | number = 0
      if      (sortField === 'name')     { va = a.SHORT_NAME;      vb = b.SHORT_NAME      }
      else if (sortField === 'dept')     { va = a.DEPARTMENT_NAME; vb = b.DEPARTMENT_NAME }
      else if (sortField === 'required') { va = a.REQUIRED;        vb = b.REQUIRED        }
      else if (sortField === 'actual')   { va = a.ACTUAL;          vb = b.ACTUAL          }
      else if (sortField === 'balance')  { va = a.BALANCE;         vb = b.BALANCE         }
      else if (sortField === 'cost')     { va = a.COST;            vb = b.COST            }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ?  1 : -1
      return 0
    })
  }

  const sumF = (rows: EmployeeReportRow[], fn: (r: EmployeeReportRow) => number) =>
    Math.round(rows.reduce((s, r) => s + fn(r), 0) * 100) / 100

  const hasFilter = search.trim() !== '' || deptFilter.size > 0 || statusFilter.size > 0 || modelFilter.size > 0
  const isPeriod  = mode === 'period'

  function clearFilters() {
    setSearch(''); setDeptFilter(new Set()); setStatusFilter(new Set()); setModelFilter(new Set())
  }

  function exportCsv() {
    const num = (n: number) => n.toFixed(2).replace('.', ',')
    const head = isPeriod
      ? ['Kürzel', 'Vorname', 'Nachname', 'Abteilung', 'Jahr', 'Monat', 'Soll (h)', 'Ist (h)', 'Monatssaldo (h)', 'Kosten (EUR)', 'Produktivität (%)']
      : ['Kürzel', 'Vorname', 'Nachname', 'Abteilung', 'Soll (h)', 'Ist (h)', 'Monatssaldo (h)', 'Laufender Saldo (h)', 'Kosten (EUR)', 'Produktivität (%)']
    const rows: (string | number)[][] = [head]
    const sorted = isPeriod
      ? [...filtered].sort((a, b) => a.SHORT_NAME.localeCompare(b.SHORT_NAME) || a.YEAR - b.YEAR || a.MONTH - b.MONTH)
      : sortFlat(filtered)
    for (const r of sorted) {
      const base = [r.SHORT_NAME, r.FIRST_NAME, r.LAST_NAME, r.DEPARTMENT_NAME || '']
      const prod = r.PRODUCTIVITY_PCT != null ? num(r.PRODUCTIVITY_PCT) : ''
      const cost = r.COST > 0 ? num(r.COST) : ''
      rows.push(isPeriod
        ? [...base, r.YEAR, r.MONTH, num(r.REQUIRED), num(r.ACTUAL), num(r.BALANCE), cost, prod]
        : [...base, num(r.REQUIRED), num(r.ACTUAL), num(r.BALANCE), r.RUNNING_BALANCE != null ? num(r.RUNNING_BALANCE) : '', cost, prod])
    }
    const stamp = mode === 'period' ? `${dateFrom}_bis_${dateTo}` : mode === 'as_of' ? asOfDate : new Date().toISOString().slice(0, 10)
    downloadCsv(`mitarbeiter-auswertung_${stamp}.csv`, rows)
  }

  function NumTh({ label, field, help }: { label: string; field: string; help?: HelpId }) {
    return (
      <th className="num sortable-th" onClick={() => toggleSort(field)} style={{ cursor: 'pointer' }}>
        {label}{si(field)}
        {help && (
          <span onClick={e => e.stopPropagation()} style={{ cursor: 'default' }}>
            <HelpHint id={help} align="right" />
          </span>
        )}
      </th>
    )
  }

  function TotalsRow({ rows, colSpan = 3, showCumulative = false, showRunning = false }: { rows: EmployeeReportRow[]; colSpan?: number; showCumulative?: boolean; showRunning?: boolean }) {
    const bal = sumF(rows, r => r.BALANCE)
    const run = showRunning ? sumF(rows, r => r.RUNNING_BALANCE ?? 0) : 0
    return (
      <tr className="sum-row">
        <td colSpan={colSpan}></td>
        <td className="num"><strong>{fmtH(sumF(rows, r => r.REQUIRED))}</strong></td>
        <td className="num"><strong>{fmtH(sumF(rows, r => r.ACTUAL))}</strong></td>
        <td className="num" style={{ color: balanceColor(bal) }}><strong>{fmtBalance(bal)}</strong></td>
        {showRunning    && <td className="num" style={{ color: balanceColor(run) }}><strong>{fmtBalance(run)}</strong></td>}
        {showCumulative && <td className="num">—</td>}
        <td className="num"><strong>{sumF(rows, r => r.COST) > 0 ? FMT_EUR.format(sumF(rows, r => r.COST)) : '—'}</strong></td>
        <td className="num">—</td>
      </tr>
    )
  }

  return (
    <div>
      <RecentList
        type="mitarbeiter_report_filter"
        title="Zuletzt verwendete Filter"
        onSelect={(e) => applyRecent(e.META)}
      />
      {/* Date filter */}
      <div className="daten-filter-bar">
        <div className="daten-filter-modes">
          {(['now', 'as_of', 'period'] as EmpRepMode[]).map(m => (
            <label key={m} className={`daten-filter-mode-btn${mode === m ? ' active' : ''}`}>
              <input type="radio" name="empRepMode" value={m} checked={mode === m} onChange={() => setMode(m)} />
              {m === 'now' ? 'Aktueller Monat' : m === 'as_of' ? 'Stichtag' : 'Zeitraum'}
            </label>
          ))}
        </div>
        {mode === 'as_of' && (
          <div className="daten-filter-dates">
            <label>Stichtag <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} /></label>
          </div>
        )}
        {mode === 'period' && (
          <div className="daten-filter-dates">
            <label>Von <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
            <label>Bis <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)} /></label>
          </div>
        )}
      </div>

      {/* Employee filter */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 600, marginRight: 8, color: 'var(--text-3)' }}>Mitarbeiter</label>
        <select
          style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text)' }}
          value={filterEmpId ?? ''}
          onChange={e => setFilterEmpId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— Alle Mitarbeiter —</option>
          {employees.map(e => <option key={e.ID} value={e.ID}>{e.SHORT_NAME} – {e.FIRST_NAME} {e.LAST_NAME}</option>)}
        </select>
      </div>

      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && !filterReady && <p className="empty-note">Bitte Datumfilter ausfüllen.</p>}
      {!isLoading && filterReady && allRows.length === 0 && <p className="empty-note">Keine Daten vorhanden.</p>}

      {!isLoading && filterReady && allRows.length > 0 && (
        <>
          {/* Toolbar */}
          <div className="pl-toolbar">
            <input
              type="search"
              placeholder="Suche …"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="list-search"
            />
            <div className="pl-filter-chips">
              <FilterChip label="Abteilung" options={deptOptions}    active={deptFilter}   onChange={setDeptFilter}   />
              <FilterChip label="Status"    options={statusOptions}  active={statusFilter} onChange={setStatusFilter} />
              <FilterChip label="Modell"    options={modelOptions}   active={modelFilter}  onChange={setModelFilter}  />
              {hasFilter && <button className="pl-clear-btn" onClick={clearFilters}>Alle Filter löschen</button>}
            </div>
            <button
              type="button"
              className="btn-small"
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              disabled={filtered.length === 0}
              onClick={exportCsv}
              title="Gefilterte Auswertung als CSV (Excel) exportieren"
            >
              <Download size={13} strokeWidth={2} /> CSV-Export
            </button>
          </div>

          {hasFilter && (
            <p className="empty-note" style={{ margin: '0 0 8px' }}>
              {isPeriod
                ? `${new Set(filtered.map(r => r.EMPLOYEE_ID)).size} von ${new Set(allRows.map(r => r.EMPLOYEE_ID)).size} Mitarbeitern`
                : `${filtered.length} von ${allRows.length} Mitarbeitern`}
            </p>
          )}

          {/* Flat table for now / as_of */}
          {!isPeriod && (
            <div className="list-section table-scroll">
              <table className="master-table">
                <thead>
                  <tr>
                    <th className="sortable-th" style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>Kürzel{si('name')}</th>
                    <th>Name</th>
                    <th className="sortable-th" style={{ cursor: 'pointer' }} onClick={() => toggleSort('dept')}>Abteilung{si('dept')}</th>
                    <NumTh label="Soll"            field="required"     />
                    <NumTh label="Ist"             field="actual"       />
                    <NumTh label="Monatssaldo"     field="balance"      help="mitarbeiter.saldo" />
                    <th className="num">Laufender Saldo<HelpHint id="mitarbeiter.saldo" align="right" /></th>
                    <NumTh label="Kosten"          field="cost"         />
                    <th className="num" title="Projektstunden (ohne interne) / Alle gebuchten Stunden">Produktivität</th>
                  </tr>
                </thead>
                <tbody>
                  {sortFlat(filtered).map(r => (
                    <tr key={r.EMPLOYEE_ID}>
                      <td><strong>{r.SHORT_NAME}</strong></td>
                      <td>{r.FIRST_NAME} {r.LAST_NAME}</td>
                      <td>{r.DEPARTMENT_NAME || '—'}</td>
                      <td className="num">{fmtH(r.REQUIRED)}</td>
                      <td className="num">{fmtH(r.ACTUAL)}</td>
                      <td className="num" style={{ color: balanceColor(r.BALANCE), fontWeight: 600 }}>{fmtBalance(r.BALANCE)}</td>
                      <td className="num" style={{ color: balanceColor(r.RUNNING_BALANCE ?? 0), fontWeight: 600 }}>
                        {r.RUNNING_BALANCE != null ? fmtBalance(r.RUNNING_BALANCE) : '…'}
                      </td>
                      <td className="num">{r.COST > 0 ? FMT_EUR.format(r.COST) : '—'}</td>
                      <td className="num">{r.PRODUCTIVITY_PCT != null ? `${r.PRODUCTIVITY_PCT.toFixed(1)} %` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {filtered.length > 1 && (
                  <tfoot>
                    <TotalsRow rows={filtered} colSpan={3} showRunning />
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* Grouped table for period mode */}
          {isPeriod && (() => {
            const byEmp = new Map<number, EmployeeReportRow[]>()
            for (const row of filtered) {
              if (!byEmp.has(row.EMPLOYEE_ID)) byEmp.set(row.EMPLOYEE_ID, [])
              byEmp.get(row.EMPLOYEE_ID)!.push(row)
            }
            const groups = [...byEmp.entries()].sort((a, b) =>
              (a[1][0]?.SHORT_NAME ?? '').localeCompare(b[1][0]?.SHORT_NAME ?? '')
            )
            return (
              <div className="list-section table-scroll">
                <table className="master-table">
                  <thead>
                    <tr>
                      <th>Mitarbeiter</th>
                      <th>Abteilung</th>
                      <th>Monat</th>
                      <NumTh label="Soll"          field="required"     />
                      <NumTh label="Ist"           field="actual"       />
                      <NumTh label="Monatssaldo"   field="balance"      />
                      <th className="num">Laufender Saldo<HelpHint id="mitarbeiter.saldo" align="right" /></th>
                      <NumTh label="Kosten"        field="cost"         />
                      <th className="num" title="Projektstunden (ohne interne) / Alle gebuchten Stunden">Produktivität</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([empId, rows]) => {
                      const sorted = [...rows].sort((a, b) =>
                        a.YEAR !== b.YEAR ? a.YEAR - b.YEAR : a.MONTH - b.MONTH
                      )
                      let cum = 0
                      const withCum = sorted.map(r => {
                        cum = Math.round((cum + r.BALANCE) * 100) / 100
                        return { ...r, CUMULATIVE: cum }
                      })
                      return (
                        <Fragment key={empId}>
                          {withCum.map((r, i) => (
                            <tr key={`${r.YEAR}-${r.MONTH}`}>
                              {i === 0 && (
                                <td rowSpan={sorted.length} style={{ verticalAlign: 'top', paddingTop: 8 }}>
                                  <strong>{r.SHORT_NAME}</strong>
                                  <br /><span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 400 }}>{r.FIRST_NAME} {r.LAST_NAME}</span>
                                </td>
                              )}
                              {i === 0 && (
                                <td rowSpan={sorted.length} style={{ verticalAlign: 'top', paddingTop: 8 }}>
                                  {r.DEPARTMENT_NAME || '—'}
                                </td>
                              )}
                              <td>{MONTH_NAMES[r.MONTH - 1]} {r.YEAR}</td>
                              <td className="num">{fmtH(r.REQUIRED)}</td>
                              <td className="num">{fmtH(r.ACTUAL)}</td>
                              <td className="num" style={{ color: balanceColor(r.BALANCE), fontWeight: r.BALANCE !== 0 ? 600 : 400 }}>{fmtBalance(r.BALANCE)}</td>
                              <td className="num" style={{ color: balanceColor(r.CUMULATIVE), fontWeight: 600 }}>{fmtBalance(r.CUMULATIVE)}</td>
                              <td className="num">{r.COST > 0 ? FMT_EUR.format(r.COST) : '—'}</td>
                              <td className="num">{r.PRODUCTIVITY_PCT != null ? `${r.PRODUCTIVITY_PCT.toFixed(1)} %` : '—'}</td>
                            </tr>
                          ))}
                          <TotalsRow rows={rows} colSpan={3} showCumulative />
                        </Fragment>
                      )
                    })}
                  </tbody>
                  {groups.length > 1 && (
                    <tfoot>
                      <tr className="sum-row" style={{ borderTop: '2px solid var(--border)' }}>
                        <td colSpan={3}><strong>Gesamt ({groups.length} Mitarbeiter)</strong></td>
                        <td className="num"><strong>{fmtH(sumF(filtered, r => r.REQUIRED))}</strong></td>
                        <td className="num"><strong>{fmtH(sumF(filtered, r => r.ACTUAL))}</strong></td>
                        <td className="num" style={{ color: balanceColor(sumF(filtered, r => r.BALANCE)) }}>
                          <strong>{fmtBalance(sumF(filtered, r => r.BALANCE))}</strong>
                        </td>
                        <td className="num">—</td>
                        <td className="num"><strong>{sumF(filtered, r => r.COST) > 0 ? FMT_EUR.format(sumF(filtered, r => r.COST)) : '—'}</strong></td>
                        <td className="num">—</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}

// ── Employee Time Account (Monat/Verlauf, wiederverwendbar) ─────────────────────

function EmployeeTimeAccount({ empId }: { empId: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [year,     setYear]     = useState(new Date().getFullYear())
  const [month,    setMonth]    = useState(new Date().getMonth() + 1)
  const [viewMode, setViewMode] = useState<'month' | 'running'>('month')
  const [closeLoading, setCloseLoading] = useState(false)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())
  const [editBooking, setEditBooking] = useState<DayBooking | null>(null)
  const [editSiblings, setEditSiblings] = useState<DayBooking[]>([])
  const [editStart,   setEditStart]   = useState('')
  const [editFinish,  setEditFinish]  = useState('')
  const [editQty,     setEditQty]     = useState('')
  const [editDesc,    setEditDesc]    = useState('')

  function openEditBooking(b: DayBooking, sameDay: DayBooking[]) {
    setEditBooking(b)
    setEditSiblings(sameDay.filter(x => x.id !== b.id))
    setEditStart(b.time_start ?? '')
    setEditFinish(b.time_finish ?? '')
    setEditQty(String(b.hours ?? 0))
    setEditDesc(b.description ?? '')
  }

  // Erkennt Überschneidung mit anderen Buchungen desselben Tages.
  // Liefert die Liste der überlappenden Geschwister (leer = kein Konflikt).
  function detectOverlaps(start: string, finish: string): DayBooking[] {
    const s = start.slice(0, 5), f = finish.slice(0, 5)
    if (!s || !f) return []
    const [sh, sm] = s.split(':').map(Number)
    const [fh, fm] = f.split(':').map(Number)
    const a1 = sh * 60 + sm, a2 = fh * 60 + fm
    if (a2 <= a1) return []
    return editSiblings.filter(x => {
      if (!x.time_start || !x.time_finish) return false
      const [bsh, bsm] = x.time_start.slice(0, 5).split(':').map(Number)
      const [bfh, bfm] = x.time_finish.slice(0, 5).split(':').map(Number)
      const b1 = bsh * 60 + bsm, b2 = bfh * 60 + bfm
      // Klassische Intervall-Überschneidung: a1 < b2 && b1 < a2
      return a1 < b2 && b1 < a2
    })
  }

  const patchBookingMut = useMutation({
    mutationFn: async () => {
      if (!editBooking) return
      // PATCH-Semantik: nur die wirklich geänderten Felder schicken. DATE_VOUCHER,
      // CP_RATE etc. bleiben so unverändert in der DB. Ohne diesen Trimm
      // setzte das Backend DATE_VOUCHER auf NULL → Buchung war aus der
      // Monatsübersicht verschwunden.
      const qty = Number(editQty.replace(',', '.')) || 0
      await updateBuchung(editBooking.id, {
        TIME_START:   editStart  ? `${editStart}:00`  : '',
        TIME_FINISH:  editFinish ? `${editFinish}:00` : '',
        QUANTITY_INT: qty,
        QUANTITY_EXT: qty,
        POSTING_DESCRIPTION: editDesc,
      })
    },
    onSuccess: () => {
      toast.success('Buchung aktualisiert')
      setEditBooking(null)
      void qc.invalidateQueries({ queryKey: ['emp-balance-month'] })
      void qc.invalidateQueries({ queryKey: ['emp-balance-running'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteBookingMut = useMutation({
    mutationFn: (id: number) => deleteBuchung(id),
    onSuccess: () => {
      toast.success('Buchung gelöscht')
      setEditBooking(null)
      void qc.invalidateQueries({ queryKey: ['emp-balance-month'] })
      void qc.invalidateQueries({ queryKey: ['emp-balance-running'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function toggleDay(date: string) {
    setExpandedDays(prev => {
      const s = new Set(prev)
      s.has(date) ? s.delete(date) : s.add(date)
      return s
    })
  }

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
    queryFn:  () => fetchMonthBalance(empId, year, month),
    enabled:  viewMode === 'month',
  })
  const { data: runningRes, isLoading: loadingRunning } = useQuery({
    queryKey: ['emp-balance-running', empId],
    queryFn:  () => fetchRunningBalance(empId),
    enabled:  viewMode === 'running',
  })
  const { data: closeStatusRes, refetch: refetchClose } = useQuery({
    queryKey: ['month-close-status', empId, year, month],
    queryFn:  () => fetchMonthCloseStatus(empId, year, month),
  })

  const monthData: MonthBalance | undefined = monthRes?.data
  const runningData = runningRes?.data
  const isClosed = closeStatusRes?.data != null

  const balanceColor = (n: number) => n > 0 ? '#059669' : n < 0 ? '#dc2626' : '#6b7280'

  async function toggleMonthClose() {
    setCloseLoading(true)
    try {
      if (isClosed) {
        await reopenMonth(empId, year, month)
      } else {
        await closeMonth(empId, year, month)
      }
      await refetchClose()
      void qc.invalidateQueries({ queryKey: ['month-close-overview'] })
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setCloseLoading(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
        {viewMode === 'month' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" className="btn-small" onClick={prevMonth}>◀</button>
            <span style={{ fontWeight: 600, minWidth: 110, textAlign: 'center', fontSize: 14 }}>
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button type="button" className="btn-small" onClick={nextMonth}>▶</button>
          </div>
        )}
        <SegmentNav
          items={[{ id: 'month', label: 'Monat' }, { id: 'running', label: 'Verlauf' }]}
          active={viewMode}
          onChange={setViewMode}
          style={{ marginBottom: 0 }}
        />
      </div>

      {viewMode === 'month' && (
        <>
          {loadingMonth && <p className="empty-note">Laden …</p>}
          {monthData && (
            <>
              <div style={{ display: 'flex', gap: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 16px', marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
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
                <div style={{ marginLeft: 'auto' }}>
                  <button
                    type="button"
                    className={`btn-small${isClosed ? '' : ' btn-save'}`}
                    style={{ whiteSpace: 'nowrap' }}
                    disabled={closeLoading}
                    onClick={toggleMonthClose}
                  >
                    {closeLoading ? '…' : isClosed ? '✓ Abgeschlossen – Öffnen' : 'Monat abschließen'}
                  </button>
                </div>
              </div>

              {!monthData.days.length && (
                <p className="empty-note">Kein Arbeitszeitmodell für diesen Zeitraum zugewiesen.</p>
              )}
              {monthData.days.length > 0 && (
                <table className="master-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 18 }}></th>
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
                      const isExpanded = expandedDays.has(d.date)
                      const hasBookings = d.bookings && d.bookings.length > 0
                      const rowStyle: React.CSSProperties = {
                        background: isWeekend ? '#f9fafb' : undefined,
                        color:      isWeekend ? '#9ca3af' : undefined,
                      }
                      return (
                        <>
                          <tr key={d.date} style={rowStyle}>
                            <td style={{ padding: '2px 0', textAlign: 'center' }}>
                              {hasBookings && (
                                <button
                                  type="button"
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#6b7280', padding: 0 }}
                                  onClick={() => toggleDay(d.date)}
                                  title={isExpanded ? 'Buchungen ausblenden' : 'Buchungen anzeigen'}
                                >
                                  {isExpanded ? '▼' : '▶'}
                                </button>
                              )}
                            </td>
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
                              {d.absence && (
                                <div style={{ fontSize: 10, fontWeight: 600, color: '#7c3aed' }} title={`${d.absence.name} — als Soll gutgeschrieben`}>
                                  {d.absence.name}{d.absence.fraction === 0.5 ? ' ½' : ''}
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: d.required > 0 ? balanceColor(d.balance) : '#d1d5db', fontWeight: d.required > 0 ? 600 : 400 }}>
                              {d.required > 0 ? fmtBalance(d.balance) : '—'}
                            </td>
                          </tr>
                          {isExpanded && (d.bookings as DayBooking[]).map(b => (
                            <tr key={`bk-${b.id}`} style={{ background: '#f0f9ff', cursor: 'pointer' }}
                                title="Klicken zum Bearbeiten"
                                onClick={() => openEditBooking(b, d.bookings as DayBooking[])}>
                              <td></td>
                              <td colSpan={2} style={{ color: '#0369a1', fontSize: 11, paddingLeft: 12 }}>
                                {b.time_start && b.time_finish && (
                                  <span style={{ color: '#6b7280', marginRight: 6 }}>
                                    {b.time_start.slice(0, 5)}–{b.time_finish.slice(0, 5)}
                                  </span>
                                )}
                                {b.project}{b.structure ? ` / ${b.structure}` : ''}
                              </td>
                              <td colSpan={2} style={{ color: '#374151', fontSize: 11 }}>{b.description}</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 11, color: '#374151' }}>
                                {fmtH(b.hours)}
                              </td>
                            </tr>
                          ))}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}

      {viewMode === 'running' && (
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
                    <th style={{ textAlign: 'right' }}>Laufender Saldo</th>
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

      <Modal open={editBooking !== null} onClose={() => setEditBooking(null)}
        title={`Buchung bearbeiten`}>
        {editBooking && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
              {editBooking.project}{editBooking.structure ? ` / ${editBooking.structure}` : ''}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Zeit Start</label>
                <input type="time" value={editStart.slice(0, 5)}
                  onChange={e => {
                    const v = e.target.value
                    setEditStart(v)
                    const f = editFinish.slice(0, 5)
                    if (v && f) {
                      const [sh, sm] = v.split(':').map(Number)
                      const [fh, fm] = f.split(':').map(Number)
                      const min = Math.max(0, (fh * 60 + fm) - (sh * 60 + sm))
                      setEditQty((Math.round(min / 60 * 100) / 100).toString().replace('.', ','))
                    }
                  }} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Zeit Ende</label>
                <input type="time" value={editFinish.slice(0, 5)}
                  onChange={e => {
                    const v = e.target.value
                    setEditFinish(v)
                    const s = editStart.slice(0, 5)
                    if (s && v) {
                      const [sh, sm] = s.split(':').map(Number)
                      const [fh, fm] = v.split(':').map(Number)
                      const min = Math.max(0, (fh * 60 + fm) - (sh * 60 + sm))
                      setEditQty((Math.round(min / 60 * 100) / 100).toString().replace('.', ','))
                    }
                  }} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Stunden</label>
                <input type="number" step="0.25" min={0} value={editQty}
                  onChange={e => setEditQty(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>Beschreibung</label>
              <input type="text" value={editDesc}
                onChange={e => setEditDesc(e.target.value)} />
            </div>
            {(() => {
              const overlaps = detectOverlaps(editStart, editFinish)
              if (overlaps.length === 0) {
                return (
                  <p style={{ fontSize: 11, color: '#92400e', background: 'rgba(245,158,11,0.08)',
                              padding: '6px 10px', borderRadius: 6, margin: 0 }}>
                    ⚠ Änderungen wirken sich auf das Zeitkonto, Projektkosten und ggf. das ArbZG-Audit aus.
                  </p>
                )
              }
              return (
                <p style={{ fontSize: 12, color: '#7f1d1d', background: 'rgba(220,38,38,0.08)',
                            padding: '8px 12px', borderRadius: 6, margin: 0,
                            border: '1px solid rgba(220,38,38,0.25)' }}>
                  <strong>Zeitliche Überschneidung</strong> mit {overlaps.length === 1 ? '1 Buchung' : `${overlaps.length} Buchungen`} desselben Tages:
                  <span style={{ display: 'block', marginTop: 4, fontSize: 11 }}>
                    {overlaps.map(o => (
                      <span key={o.id} style={{ display: 'block' }}>
                        {o.time_start?.slice(0, 5)}–{o.time_finish?.slice(0, 5)} · {o.project}
                        {o.structure ? ` / ${o.structure}` : ''}
                      </span>
                    ))}
                  </span>
                </p>
              )
            })()}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
              <button className="btn-small btn-danger" disabled={deleteBookingMut.isPending}
                onClick={() => deleteBookingMut.mutate(editBooking.id)}>
                {deleteBookingMut.isPending ? '…' : 'Löschen'}
              </button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-small" onClick={() => setEditBooking(null)}>Abbrechen</button>
                <button className="btn-small btn-save"
                  disabled={patchBookingMut.isPending || detectOverlaps(editStart, editFinish).length > 0}
                  title={detectOverlaps(editStart, editFinish).length > 0 ? 'Zeitliche Überschneidung beheben' : ''}
                  onClick={() => patchBookingMut.mutate()}>
                  {patchBookingMut.isPending ? 'Speichert…' : 'Speichern'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ── Zeitwirtschaft Tab (Auswertung · Einzel-Mitarbeiter · Monatsabschluss) ─────

// ── Abwesenheiten-Tab (Genehmigungs-Postfach + Team-Kalender) ─────────────────

type AbsSub = 'inbox' | 'calendar'

function AbwesenheitenTab({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const canApprove = usePermission('absence.approve')
  const [sub, setSub] = useState<AbsSub>('inbox')
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const { data: inboxRes, isLoading: inboxLoading } = useQuery({
    queryKey: ['absences-inbox'],
    queryFn:  () => fetchAbsences({ status: 'REQUESTED' }),
  })
  const inbox = inboxRes?.data ?? []

  const monthFrom = `${year}-${String(month).padStart(2, '0')}-01`
  const monthTo   = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
  const { data: calRes } = useQuery({
    queryKey: ['absences-calendar', year, month],
    queryFn:  () => fetchAbsences({ from: monthFrom, to: monthTo }),
    enabled:  sub === 'calendar',
  })

  const decideMut = useMutation({
    mutationFn: (v: { id: number; decision: 'APPROVED' | 'REJECTED' }) => decideAbsence(v.id, v.decision),
    onSuccess: () => {
      toast.success('Entscheidung gespeichert')
      void qc.invalidateQueries({ queryKey: ['absences-inbox'] })
      void qc.invalidateQueries({ queryKey: ['absences-calendar'] })
      void qc.invalidateQueries({ queryKey: ['absences'] })
      void qc.invalidateQueries({ queryKey: ['vacation-balance'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function prevMonth() { if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1) }
  function nextMonth() { if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1) }

  return (
    <div>
      <SegmentNav
        items={[{ id: 'inbox', label: `Anträge${inbox.length ? ` (${inbox.length})` : ''}` }, { id: 'calendar', label: 'Kalender' }]}
        active={sub}
        onChange={setSub}
      />

      {sub === 'inbox' && (
        <>
          {inboxLoading && <p className="empty-note">Laden …</p>}
          {!inboxLoading && inbox.length === 0 && <p className="empty-note">Keine offenen Anträge.</p>}
          {inbox.length > 0 && (
            <div className="table-scroll">
              <table className="master-table">
                <thead><tr>
                  <th>Mitarbeiter</th><th>Zeitraum</th><th>Art</th><th className="num">Tage</th><th>Notiz</th><th></th>
                </tr></thead>
                <tbody>
                  {inbox.map((a: Absence) => (
                    <tr key={a.ID}>
                      <td><strong>{a.EMPLOYEE_SHORT_NAME}</strong> {a.EMPLOYEE_FIRST_NAME} {a.EMPLOYEE_LAST_NAME}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateShort(a.DATE_FROM)}{a.DATE_TO !== a.DATE_FROM ? `–${fmtDateShort(a.DATE_TO)}` : ''}{a.HALF_DAY ? ' (½)' : ''}</td>
                      <td><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: a.TYPE_COLOR || '#9ca3af', marginRight: 6 }} />{a.TYPE_NAME}</td>
                      <td className="num">{a.DAYS}</td>
                      <td style={{ fontSize: 12, color: '#6b7280' }}>{a.NOTE || '—'}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {canApprove ? (
                          <>
                            <button className="btn-small btn-save" style={{ padding: '1px 8px', fontSize: 11, marginRight: 4 }} disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: a.ID, decision: 'APPROVED' })}>Genehmigen</button>
                            <button className="btn-small" style={{ padding: '1px 8px', fontSize: 11 }} disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: a.ID, decision: 'REJECTED' })}>Ablehnen</button>
                          </>
                        ) : <span style={{ fontSize: 11, color: '#9ca3af' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {sub === 'calendar' && (() => {
        const daysInMonth = new Date(year, month, 0).getDate()
        const dayList = Array.from({ length: daysInMonth }, (_, i) => i + 1)
        const cal = calRes?.data ?? []
        const byEmp = new Map<number, Map<number, { color: string; status: AbsenceStatus; name: string; half: boolean }>>()
        for (const a of cal) {
          if (a.STATUS === 'REJECTED' || a.STATUS === 'CANCELLED') continue
          const d = new Date(`${a.DATE_FROM}T00:00:00`)
          const to = new Date(`${a.DATE_TO}T00:00:00`)
          while (d <= to) {
            if (d.getFullYear() === year && d.getMonth() + 1 === month) {
              if (!byEmp.has(a.EMPLOYEE_ID)) byEmp.set(a.EMPLOYEE_ID, new Map())
              byEmp.get(a.EMPLOYEE_ID)!.set(d.getDate(), { color: a.TYPE_COLOR || '#9ca3af', status: a.STATUS, name: a.TYPE_NAME || '', half: a.HALF_DAY })
            }
            d.setDate(d.getDate() + 1)
          }
        }
        const activeEmployees = employees.filter(e => e.ACTIVE !== 2)
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <button type="button" className="btn-small" onClick={prevMonth}>◀</button>
              <span style={{ fontWeight: 600, minWidth: 120, textAlign: 'center' }}>{MONTH_NAMES[month - 1]} {year}</span>
              <button type="button" className="btn-small" onClick={nextMonth}>▶</button>
            </div>
            <div className="table-scroll">
              <table className="master-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>Mitarbeiter</th>
                    {dayList.map(day => {
                      const we = [0, 6].includes(new Date(year, month - 1, day).getDay())
                      return <th key={day} style={{ textAlign: 'center', padding: '2px 3px', color: we ? '#d1d5db' : '#6b7280', fontWeight: 500 }}>{day}</th>
                    })}
                  </tr>
                </thead>
                <tbody>
                  {activeEmployees.map(emp => {
                    const dm = byEmp.get(emp.ID)
                    return (
                      <tr key={emp.ID}>
                        <td style={{ whiteSpace: 'nowrap' }}><strong>{emp.SHORT_NAME}</strong></td>
                        {dayList.map(day => {
                          const cell = dm?.get(day)
                          const we = [0, 6].includes(new Date(year, month - 1, day).getDay())
                          return (
                            <td key={day}
                              title={cell ? `${cell.name}${cell.status === 'REQUESTED' ? ' (beantragt)' : ''}${cell.half ? ' ½' : ''}` : ''}
                              style={{ textAlign: 'center', padding: 0, height: 22, borderLeft: '1px solid #f3f4f6',
                                background: cell ? cell.color : (we ? '#f9fafb' : undefined),
                                opacity: cell && cell.status === 'REQUESTED' ? 0.45 : 1 }}>
                              {cell && cell.status === 'REQUESTED' ? <span style={{ color: '#fff', fontSize: 9 }}>?</span> : ''}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  {activeEmployees.length === 0 && <tr><td colSpan={dayList.length + 1} className="empty-note">Keine aktiven Mitarbeiter.</td></tr>}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
              Farbe = Abwesenheitsart · blass mit „?" = beantragt (offen) · voll = genehmigt
            </p>
          </>
        )
      })()}
    </div>
  )
}

type ZwSub = 'list' | 'single' | 'close' | 'absence'

function ZeitwirtschaftTab({ employees }: { employees: Employee[] }) {
  const canCloseMonths = usePermission('employees.month_close.edit')
  const hasMonthClose  = useFeature('employees.month_close')
  const showClose      = canCloseMonths && hasMonthClose
  const canViewAbsence = usePermission('absence.view')

  const [subTab, setSubTab] = useState<ZwSub>('list')
  const [empId,  setEmpId]  = useState<number | null>(null)

  const items: { id: ZwSub; label: string }[] = [
    { id: 'list',   label: 'Auswertung' },
    { id: 'single', label: 'Einzelne/r Mitarbeiter' },
    ...(showClose      ? [{ id: 'close'   as ZwSub, label: 'Monatsabschluss' }] : []),
    ...(canViewAbsence ? [{ id: 'absence' as ZwSub, label: 'Abwesenheiten' }] : []),
  ]

  return (
    <div>
      <SegmentNav items={items} active={subTab} onChange={setSubTab} />

      {subTab === 'list' && <EmployeeListReport employees={employees} />}

      {subTab === 'single' && (
        <div style={{ maxWidth: 760 }}>
          <div style={{ marginBottom: 20 }}>
            <div className="form-group" style={{ marginBottom: 0, minWidth: 220 }}>
              <label style={{ fontSize: 12 }}>Mitarbeiter</label>
              <select value={empId ?? ''} onChange={e => setEmpId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Mitarbeiter wählen —</option>
                {employees.map(e => <option key={e.ID} value={e.ID}>{e.SHORT_NAME} – {e.FIRST_NAME} {e.LAST_NAME}</option>)}
              </select>
            </div>
          </div>

          {!empId && (
            <p className="empty-note">Mitarbeiter auswählen, um das Reporting anzuzeigen.</p>
          )}
          {empId && <EmployeeTimeAccount empId={empId} />}
        </div>
      )}

      {subTab === 'close' && showClose && <MonthsOverviewTab />}

      {subTab === 'absence' && canViewAbsence && <AbwesenheitenTab employees={employees} />}
    </div>
  )
}

// ── Months Overview Tab ───────────────────────────────────────────────────────

function MonthsOverviewTab() {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<void> } | null>(null)
  const { data: overviewRes, isLoading } = useQuery({
    queryKey: ['month-close-overview'],
    queryFn:  fetchMonthCloseOverview,
  })

  const rows:   MonthCloseOverviewEmployee[]                       = overviewRes?.data   ?? []
  const months: Array<{ year: number; month: number }> = overviewRes?.months ?? []

  async function toggle(emp: MonthCloseOverviewEmployee, year: number, month: number, closed: boolean) {
    try {
      if (closed) await reopenMonth(emp.ID, year, month)
      else        await closeMonth(emp.ID, year, month)
      void qc.invalidateQueries({ queryKey: ['month-close-overview'] })
      void qc.invalidateQueries({ queryKey: ['month-close-status', emp.ID] })
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  }

  // Offene (noch nicht abgeschlossene) Eintraege sammeln — gesamt oder je Spalte.
  type Target = { empId: number; year: number; month: number }
  const openTotal = useMemo(
    () => rows.reduce((s, e) => s + e.months.filter(m => !m.closed).length, 0),
    [rows],
  )
  function openInColumn(year: number, month: number) {
    return rows.reduce((s, e) => s + (e.months.some(m => m.year === year && m.month === month && !m.closed) ? 1 : 0), 0)
  }
  function collectAll(): Target[] {
    const t: Target[] = []
    for (const e of rows) for (const m of e.months) if (!m.closed) t.push({ empId: e.ID, year: m.year, month: m.month })
    return t
  }
  function collectColumn(year: number, month: number): Target[] {
    const t: Target[] = []
    for (const e of rows) {
      const m = e.months.find(x => x.year === year && x.month === month)
      if (m && !m.closed) t.push({ empId: e.ID, year, month })
    }
    return t
  }

  async function closeMany(targets: Target[]) {
    setBusy(true)
    try {
      for (const t of targets) await closeMonth(t.empId, t.year, t.month)
      void qc.invalidateQueries({ queryKey: ['month-close-overview'] })
      void qc.invalidateQueries({ queryKey: ['month-close-status'] })
      toast.success(`${targets.length} Monat${targets.length === 1 ? '' : 'e'} abgeschlossen`)
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function askCloseAll() {
    const t = collectAll()
    if (!t.length) return
    setConfirm({
      title: 'Alle offenen Monate abschließen',
      message: `${t.length} offene Monatsabschnitte über alle Mitarbeiter abschließen?`,
      run: () => closeMany(t),
    })
  }
  function askCloseColumn(year: number, month: number) {
    const t = collectColumn(year, month)
    if (!t.length) return
    setConfirm({
      title: `${MONTH_NAMES[month - 1]} ${year} abschließen`,
      message: `${t.length} offene Einträge für ${MONTH_NAMES[month - 1]} ${year} abschließen?`,
      run: () => closeMany(t),
    })
  }

  if (isLoading) return <p className="empty-note">Laden …</p>
  if (!rows.length) return <p className="empty-note">Keine aktiven Mitarbeiter.</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {openTotal === 0 ? 'Alle Monate abgeschlossen' : `${openTotal} offene${openTotal === 1 ? 'r' : ''} Monat${openTotal === 1 ? '' : 'e'}`}
        </span>
        <button
          type="button"
          className="btn-small btn-save"
          style={{ marginLeft: 'auto' }}
          disabled={busy || openTotal === 0}
          onClick={askCloseAll}
        >
          {busy ? 'Schließt ab …' : 'Alle offenen abschließen'}
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
      <table className="master-table" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingRight: 16, whiteSpace: 'nowrap' }}>Mitarbeiter</th>
            {months.map(m => {
              const open = openInColumn(m.year, m.month)
              return (
                <th key={`${m.year}-${m.month}`} style={{ textAlign: 'center', whiteSpace: 'nowrap', fontWeight: 500, color: '#6b7280' }}>
                  {MONTH_NAMES[m.month - 1].slice(0, 3)}<br />{m.year}
                  <div style={{ marginTop: 3, minHeight: 18 }}>
                    {open > 0 && (
                      <button
                        type="button"
                        className="btn-small"
                        style={{ fontSize: 10, padding: '0 6px' }}
                        disabled={busy}
                        title={`${open} offene Einträge für ${MONTH_NAMES[m.month - 1]} ${m.year} abschließen`}
                        onClick={() => askCloseColumn(m.year, m.month)}
                      >
                        alle ✓
                      </button>
                    )}
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(emp => (
            <tr key={emp.ID}>
              <td style={{ whiteSpace: 'nowrap', paddingRight: 16 }}>
                <strong>{emp.SHORT_NAME}</strong> {emp.FIRST_NAME} {emp.LAST_NAME}
              </td>
              {emp.months.map(m => (
                <td key={`${m.year}-${m.month}`} style={{ textAlign: 'center', padding: '4px 8px' }}>
                  <button
                    type="button"
                    disabled={busy}
                    title={m.closed
                      ? `Abgeschlossen am ${new Date(m.closed_at!).toLocaleDateString('de-DE')} – klicken zum Öffnen`
                      : 'Offen – klicken zum Abschließen'}
                    style={{
                      background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', fontSize: 16,
                      color: m.closed ? '#059669' : '#d1d5db', lineHeight: 1,
                    }}
                    onClick={() => toggle(emp, m.year, m.month, m.closed)}
                  >
                    {m.closed ? '✓' : '○'}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
        ✓ Abgeschlossen &nbsp;·&nbsp; ○ Offen &nbsp;·&nbsp; Einzelne Zelle klicken zum Umschalten &nbsp;·&nbsp; „alle ✓" schließt eine ganze Monatsspalte ab
      </p>

      <ConfirmModal
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel="Abschließen"
        onConfirm={() => { const c = confirm; setConfirm(null); void c?.run() }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

// ── ArbZG-Auditlog ────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  { value: '',                    label: '— alle Ereignisse —' },
  { value: 'BOOKING_CONFIRMED',   label: 'Buchung freigegeben' },
  { value: 'OVER_8H',             label: '> 8 Stunden (§ 16 Abs. 2)' },
  { value: 'OVER_10H',            label: '> 10 Stunden (§ 3 ArbZG)' },
  { value: 'OVER_8H_MINOR',       label: '> 8 Stunden (U18, JArbSchG)' },
  { value: 'BREAK_MISSING',       label: 'Pflichtpause fehlt' },
  { value: 'REST_LT_11H',         label: 'Ruhezeit unterschritten' },
  { value: 'SUNDAY_WORK',         label: 'Sonntagsarbeit' },
  { value: 'HOLIDAY_WORK',        label: 'Feiertagsarbeit' },
  { value: 'PAUSE_AUTO_DEDUCT',   label: 'Auto-Pausenabzug' },
  { value: 'MANUAL_OVERRIDE',     label: 'Manueller Override' },
]
const SEVERITIES: Array<{ value: '' | ArbzgSeverity; label: string }> = [
  { value: '',      label: '— alle —' },
  { value: 'INFO',  label: 'Info' },
  { value: 'WARN',  label: 'Warnung' },
  { value: 'BLOCK', label: 'Blockade' },
]
const EVENT_LABEL: Record<string, string> = Object.fromEntries(
  EVENT_TYPES.filter(e => e.value).map(e => [e.value, e.label])
)

function sevBadge(s: ArbzgSeverity) {
  const style: Record<ArbzgSeverity, React.CSSProperties> = {
    INFO:  { background: 'rgba(59,130,246,0.12)',  color: '#1e40af' },
    WARN:  { background: 'rgba(245,158,11,0.15)',  color: '#92400e' },
    BLOCK: { background: 'rgba(220,38,38,0.13)',   color: '#7f1d1d' },
  }
  return (
    <span style={{ ...style[s], display: 'inline-block', padding: '2px 8px',
                    borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
      {s}
    </span>
  )
}

function ArbzgAuditTab({ employees }: { employees: Employee[] }) {
  const [empId,    setEmpId]    = useState<number | ''>('')
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo,   setDateTo]   = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [evtType,  setEvtType]  = useState<string>('')
  const [sev,      setSev]      = useState<'' | ArbzgSeverity>('')

  const params = useMemo(() => ({
    employee_id: empId === '' ? undefined : Number(empId),
    date_from:   dateFrom || undefined,
    date_to:     dateTo   || undefined,
    event_type:  evtType  || undefined,
    severity:    sev      || undefined,
  }), [empId, dateFrom, dateTo, evtType, sev])

  const { data, isLoading } = useQuery({
    queryKey: ['arbzg-audit', params],
    queryFn:  () => fetchArbzgAudit(params),
  })

  const rows: AuditEntry[] = data?.data ?? []
  const warning = data?.warning

  const empMap = useMemo(() => new Map(employees.map(e => [e.ID, e])), [employees])

  function fmtDateTime(s: string) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? s : d.toLocaleString('de-DE')
  }
  function fmtDate(s: string) {
    return new Date(s).toLocaleDateString('de-DE')
  }
  function fmtDetails(d: Record<string, unknown>) {
    if (!d) return '—'
    const parts: string[] = []
    const hHum = (n: number) => `${n.toFixed(2).replace('.', ',')} h`

    // entryKind + quantityInt zusammen als "X h Projektzeit" / "X h Pause" zeigen
    const entryKind   = d.entryKind
    const quantityInt = typeof d.quantityInt === 'number' ? d.quantityInt : null
    if (entryKind === 'BREAK') {
      parts.push(quantityInt != null && quantityInt > 0 ? `${hHum(quantityInt)} Pause` : 'Pause-Block')
    } else if (entryKind === 'WORK') {
      parts.push(quantityInt != null && quantityInt > 0 ? `${hHum(quantityInt)} Projektzeit` : 'Arbeitsblock')
    } else if (quantityInt != null && quantityInt > 0) {
      parts.push(`${hHum(quantityInt)}`)
    }

    // ArbZG-spezifische Felder
    if (typeof d.dayTotal === 'number')   parts.push(`Tagessumme ${hHum(d.dayTotal as number)}`)
    if (typeof d.dayWork === 'number')    parts.push(`Arbeit heute ${hHum(d.dayWork as number)}`)
    if (typeof d.max === 'number')        parts.push(`Maximum ${d.max} h`)
    if (typeof d.required === 'number')   parts.push(`erforderlich ${d.required} min`)
    if (typeof d.current === 'number')    parts.push(`erfasst ${d.current} min`)
    if (typeof d.breakRule === 'string')  parts.push(`Pausenregel: ${d.breakRule}`)
    if (typeof d.restHours === 'number')  parts.push(`Ruhezeit ${(d.restHours as number).toFixed(1).replace('.', ',')} h`)
    if (typeof d.deductedMin === 'number') parts.push(`Auto-Abzug ${d.deductedMin} min`)

    const kind = d.kind
    if (typeof kind === 'string') {
      if (kind === 'BREAK_TAKEN_UNRECORDED') parts.push('Pause nachgetragen')
      else if (kind === 'ACCEPT_AUTO_DEDUCT') parts.push('Auto-Abzug akzeptiert')
      // andere kind-Werte bewusst weggelassen — keine DB-Rohformate
    }

    return parts.length > 0 ? parts.join(' · ') : '—'
  }

  const toast = useToast()
  async function handleExport() {
    try {
      await downloadArbzgAuditCsv({
        employee_id: empId === '' ? undefined : Number(empId),
        date_from:   dateFrom || undefined,
        date_to:     dateTo   || undefined,
      })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <p className="admin-section-hint" style={{ marginBottom: 14 }}>
        Audit-Log der ArbZG-Ereignisse — Pflichtarchiv nach § 16 Abs. 2 ArbZG (2 Jahre).
        Datensätze sind gegen Löschen und Manipulation geschützt.
      </p>

      <div className="pl-toolbar" style={{ marginBottom: 12 }}>
        <select className="list-search" value={empId}
          onChange={e => setEmpId(e.target.value === '' ? '' : Number(e.target.value))}
          style={{ minWidth: 200, maxWidth: 240 }}>
          <option value="">— Alle Mitarbeiter —</option>
          {employees.map(e => <option key={e.ID} value={e.ID}>{e.SHORT_NAME} – {e.FIRST_NAME} {e.LAST_NAME}</option>)}
        </select>
        <label style={{ fontSize: 12 }}>Von
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ marginLeft: 4 }} />
        </label>
        <label style={{ fontSize: 12 }}>Bis
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ marginLeft: 4 }} />
        </label>
        <select value={evtType} onChange={e => setEvtType(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}>
          {EVENT_TYPES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
        <select value={sev} onChange={e => setSev(e.target.value as '' | ArbzgSeverity)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}>
          {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button type="button" className="btn-small btn-save"
          style={{ marginLeft: 'auto' }} onClick={handleExport}>
          ↓ CSV-Export
        </button>
      </div>

      {warning && (
        <p style={{ fontSize: 12, color: '#92400e', background: 'rgba(245,158,11,0.08)',
                    border: '1px solid rgba(245,158,11,0.25)', borderRadius: 6,
                    padding: '8px 12px', marginBottom: 12 }}>
          ⚠ {warning}
        </p>
      )}

      {isLoading && <p className="empty-note">Laden…</p>}

      {!isLoading && rows.length === 0 && !warning && (
        <p className="empty-note">Keine Einträge für die gewählten Filter.</p>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="list-section table-scroll">
          <table className="master-table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th>Datum</th>
                <th>Ereignis</th>
                <th>Schwere</th>
                <th>Details</th>
                <th>Erfasst</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const emp = empMap.get(r.EMPLOYEE_ID)
                return (
                  <tr key={r.ID}>
                    <td>
                      <strong>{emp?.SHORT_NAME ?? `#${r.EMPLOYEE_ID}`}</strong>
                      {emp && <span style={{ display: 'block', fontSize: 11, color: '#6b7280' }}>
                        {emp.FIRST_NAME} {emp.LAST_NAME}
                      </span>}
                    </td>
                    <td>{fmtDate(r.DATE_VOUCHER)}</td>
                    <td>{EVENT_LABEL[r.EVENT_TYPE] ?? r.EVENT_TYPE}</td>
                    <td>{sevBadge(r.SEVERITY)}</td>
                    <td style={{ fontSize: 12, color: '#374151' }}>{fmtDetails(r.DETAILS || {})}</td>
                    <td style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {fmtDateTime(r.CREATED_AT)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
          {rows.length} Einträge · limitiert auf 1.000 — bei mehr Treffern Filter verfeinern.
        </p>
      )}
    </div>
  )
}

// ── Rolle pro Mitarbeiter (Badge + Edit-Modal) ───────────────────────────────

function EmployeeRoleBadge({ employeeId, roles, mapping, onClick }: {
  employeeId: number
  roles:    UserRole[]
  mapping:  EmployeeRoleMapping[]
  onClick:  () => void
}) {
  const assignedIds = mapping.filter(m => m.EMPLOYEE_ID === employeeId).map(m => m.ROLE_ID)
  const assigned    = roles.filter(r => assignedIds.includes(r.ID))

  if (assigned.length === 0) {
    return (
      <button onClick={onClick} style={{
        background: 'transparent', border: '1px dashed #d1d5db', borderRadius: 12, padding: '2px 8px',
        fontSize: 11, color: '#9ca3af', cursor: 'pointer',
      }}>+ Rolle</button>
    )
  }

  return (
    <button onClick={onClick} style={{
      background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
      display: 'inline-flex', gap: 4, flexWrap: 'wrap',
    }}>
      {assigned.map(r => (
        <span key={r.ID} style={{
          background: r.COLOR || '#6b7280', color: '#fff',
          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
        }}>
          {r.NAME_SHORT}
        </span>
      ))}
    </button>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function MitarbeiterPage() {
  const qc = useQueryClient()
  const ML = 'plain:filt:mitarb-list'
  const [tab,       setTab]      = useState('list')
  const [search,    setSearch]   = useState('')
  const [activeAbt,    setActiveAbt]    = useState<Set<string>>(() => new Set(lsGet<string[]>(`${ML}:dept`,   [])))
  // Default: nur aktive Mitarbeiter (greift nur bei frischem Storage; eine
  // bewusst gespeicherte Auswahl – auch die leere „alle" – bleibt erhalten).
  const [activeStatus, setActiveStatus] = useState<Set<string>>(() => new Set(lsGet<string[]>(`${ML}:status`, ['Aktiv'])))
  const [activeModel,  setActiveModel]  = useState<Set<string>>(() => new Set(lsGet<string[]>(`${ML}:model`, [])))
  const [sortKey,   setSortKey]  = useState<SortKey>(() => lsGet<SortKey>(`${ML}:sortKey`, 'SHORT_NAME'))
  const [sortDir,   setSortDir]  = useState<'asc' | 'desc'>(() => lsGet<'asc'|'desc'>(`${ML}:sortDir`, 'asc'))
  const [page,      setPage]     = useState(1)
  const [editRow,   setEditRow]  = useState<Employee | null>(null)
  const [editInitialSection, setEditInitialSection] = useState<EmpSection>('stammdaten')
  const [showCreate, setShowCreate] = useState(false)
  const [form,      setForm]     = useState<CreateEmployeePayload>(emptyCreateForm)
  const [createWmModelId,    setCreateWmModelId]    = useState('')
  const [createWmValidFrom,  setCreateWmValidFrom]  = useState('')
  const [createCpRate,       setCreateCpRate]       = useState('')
  const [createCpValidFrom,  setCreateCpValidFrom]  = useState('')
  const [createMsg,    setCreateMsg]    = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [creating,     setCreating]     = useState(false)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const toast = useToast()
  const createFormRef = useRef<HTMLFormElement>(null)

  const { data: listData,   isLoading } = useQuery({ queryKey: ['employees'],           queryFn: fetchEmployeeList      })
  const { data: genData }               = useQuery({ queryKey: ['emp-genders'],         queryFn: fetchEmployeeGenders   })
  const { data: deptData }              = useQuery({ queryKey: ['departments'],         queryFn: fetchDepartments       })
  const { data: wtmData }               = useQuery({ queryKey: ['working-time-models'], queryFn: fetchWorkingTimeModels })
  const { data: rolesData }             = useQuery({ queryKey: ['user-roles'],          queryFn: fetchRoles })
  const { data: empRoleData }           = useQuery({ queryKey: ['employee-role-map'],   queryFn: fetchEmployeeRoleMap })

  // Aktueller Monats-/Laufsaldo je Mitarbeiter fuer die Listenspalte „Saldo".
  // Nur laden, wenn der Nutzer fremde Buchungen sehen darf.
  const canViewBookings = usePermission('employees.bookings.view_all')
  const { data: balData } = useQuery({
    queryKey: ['emp-report-list', { mode: 'now' }],
    queryFn:  () => fetchEmployeeReportList({ mode: 'now' }),
    enabled:  canViewBookings,
  })

  const employees  = listData?.data  ?? []
  const userRoles  = rolesData?.data ?? []
  const empRoleMap = empRoleData?.data ?? []
  const genders    = genData?.data   ?? []
  const departments = deptData?.data ?? []
  const workModels = wtmData?.data   ?? []

  const balByEmp = useMemo(() => {
    const m = new Map<number, EmployeeReportRow>()
    for (const row of balData?.data ?? []) m.set(row.EMPLOYEE_ID, row)
    return m
  }, [balData])

  // Derive filter option lists from data
  const filterOptions = useMemo(() => {
    const abt    = [...new Set(employees.map(e => e.DEPARTMENT_NAME).filter(Boolean))].sort()
    const status = ['Aktiv', 'Inaktiv']
    const model  = [...new Set(employees.map(e => e.CURRENT_MODEL_NAME).filter(Boolean))].sort()
    return { abt, status, model }
  }, [employees])

  useEffect(() => { lsPut(`${ML}:dept`,    [...activeAbt])    }, [activeAbt])
  useEffect(() => { lsPut(`${ML}:status`,  [...activeStatus]) }, [activeStatus])
  useEffect(() => { lsPut(`${ML}:model`,   [...activeModel])  }, [activeModel])
  useEffect(() => { lsPut(`${ML}:sortKey`, sortKey)           }, [sortKey])
  useEffect(() => { lsPut(`${ML}:sortDir`, sortDir)           }, [sortDir])

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

  function handleDelete(row: Employee) {
    setConfirmState({
      title: 'Mitarbeiter löschen',
      message: `${row.SHORT_NAME}: ${row.FIRST_NAME} ${row.LAST_NAME} wirklich löschen?`,
      onConfirm: async () => {
        try {
          await deleteEmployee(row.ID)
          void qc.invalidateQueries({ queryKey: ['employees'] })
        } catch (e: unknown) { toast.error((e as Error).message) }
      },
    })
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
      toast.success('Mitarbeiter angelegt')
      setForm(emptyCreateForm())
      setCreateWmModelId(''); setCreateWmValidFrom('')
      setCreateCpRate(''); setCreateCpValidFrom('')
      setShowCreate(false)
    } catch (e: unknown) {
      setCreateMsg({ text: (e as Error).message, type: 'error' })
    } finally {
      setCreating(false)
    }
  }

  useCtrlS(() => createFormRef.current?.requestSubmit(), showCreate)

  const setF = (k: keyof CreateEmployeePayload) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const sortProps = { current: sortKey, dir: sortDir, onClick: toggleSort }

  const hasActiveFilter = activeAbt.size > 0 || activeStatus.size > 0 || activeModel.size > 0

  return (
    <div className="master-page">
      <div className="master-page-header">
        <h1 className="master-page-title">Mitarbeiter</h1>
      </div>
      <Tabs tabs={useLicenseFilterTabs(useFilterTabs(TABS))} active={tab} onChange={t => { setTab(t); setCreateMsg(null) }} />

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
              <Can permission="employees.create">
                <button
                  className="btn-primary btn-small"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => {
                    setForm(emptyCreateForm())
                    setCreateWmModelId(''); setCreateWmValidFrom('')
                    setCreateCpRate(''); setCreateCpValidFrom('')
                    setCreateMsg(null)
                    setShowCreate(true)
                  }}
                >
                  + Neuer Mitarbeiter
                </button>
              </Can>
            </div>

            <div className="pl-filter-chips" style={{ marginBottom: 12 }}>
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
                <div className="table-scroll">
                <table className="master-table">
                  <thead>
                    <tr>
                      <SortTh label="Kürzel"    sortKey="SHORT_NAME" {...sortProps} />
                      <SortTh label="Vorname"   sortKey="FIRST_NAME" {...sortProps} />
                      <SortTh label="Nachname"  sortKey="LAST_NAME"  {...sortProps} />
                      <SortTh label="E-Mail"    sortKey="MAIL"       {...sortProps} />
                      <th>Abteilung</th>
                      <th>Modell</th>
                      {canViewBookings && (
                        <th className="num">Saldo<HelpHint id="mitarbeiter.saldo" align="right" /></th>
                      )}
                      <th>Status</th>
                      <th>Rolle</th>
                      <th>Dashboard-Rolle</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(r => (
                      <tr key={r.ID} className="clickable-row" onClick={() => { setEditInitialSection('stammdaten'); setEditRow(r) }}>
                        <td>{r.SHORT_NAME}</td>
                        <td>{r.FIRST_NAME}</td>
                        <td>{r.LAST_NAME}</td>
                        <td>{r.MAIL}</td>
                        <td>{r.DEPARTMENT_NAME || <span style={{ color: '#d1d5db' }}>—</span>}</td>
                        <td>{r.CURRENT_MODEL_NAME || <span style={{ color: '#d1d5db' }}>—</span>}</td>
                        {canViewBookings && (() => {
                          const bal = balByEmp.get(r.ID)
                          const run = bal?.RUNNING_BALANCE ?? 0
                          return (
                            <td className="num" style={{ fontVariantNumeric: 'tabular-nums' }}
                                title={bal ? `Monatssaldo (akt. Monat): ${fmtBalance(bal.BALANCE)}` : undefined}>
                              {bal
                                ? <span style={{ color: run > 0 ? '#059669' : run < 0 ? '#dc2626' : '#6b7280', fontWeight: 600 }}>{fmtBalance(run)}</span>
                                : <span style={{ color: '#d1d5db' }}>—</span>}
                            </td>
                          )
                        })()}
                        <td>
                          <span style={{
                            fontSize: 11, padding: '2px 7px', borderRadius: 10, fontWeight: 500,
                            background: r.ACTIVE === 2 ? '#fee2e2' : '#dcfce7',
                            color:      r.ACTIVE === 2 ? '#b91c1c' : '#166534',
                          }}>
                            {r.ACTIVE === 2 ? 'Inaktiv' : 'Aktiv'}
                          </span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <Can permission="employees.role.assign" fallback={
                            <EmployeeRoleBadge employeeId={r.ID} roles={userRoles} mapping={empRoleMap} onClick={() => {}} />
                          }>
                            <EmployeeRoleBadge employeeId={r.ID} roles={userRoles} mapping={empRoleMap} onClick={() => { setEditInitialSection('rolle'); setEditRow(r) }} />
                          </Can>
                        </td>
                        <td style={{ color: r.DASHBOARD_ROLE ? 'var(--text-2)' : '#d1d5db', fontSize: 12 }}>
                          {{ geschaeftsleitung: 'Geschäftsleitung', controller: 'Controller', bereichsleiter: 'Projektleiter', mitarbeiter: 'Mitarbeiter' }[r.DASHBOARD_ROLE ?? ''] ?? '—'}
                        </td>
                        <td className="doc-actions" onClick={e => e.stopPropagation()}>
                          <Can permission="employees.edit">
                            <button className="row-action-btn" onClick={() => { setEditInitialSection('stammdaten'); setEditRow(r) }} title="Bearbeiten">
                              <Pencil size={14} strokeWidth={2} />
                            </button>
                          </Can>
                          <Can permission="employees.delete">
                            <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }} onClick={() => handleDelete(r)} title="Löschen">
                              <Trash2 size={14} strokeWidth={2} />
                            </button>
                          </Can>
                        </td>
                      </tr>
                    ))}
                    {!pageRows.length && <tr><td colSpan={canViewBookings ? 10 : 9} className="empty-note">Keine Einträge</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                      <td colSpan={canViewBookings ? 10 : 9} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                        {processed.length !== employees.length ? `${processed.length} / ${employees.length} Einträge` : `${employees.length} Einträge`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                </div>
                <div className="pagination">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>← Zurück</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>Weiter →</button>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'zeitwirtschaft' && (
          <ZeitwirtschaftTab employees={employees} />
        )}

        {tab === 'arbzg' && (
          <ArbzgAuditTab employees={employees} />
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
            roles={userRoles}
            mapping={empRoleMap}
            initialSection={editInitialSection}
          />
        )}
      </Modal>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Neuer Mitarbeiter">
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
          <div className="form-group">
            <label htmlFor="mentry">Eintrittsdatum</label>
            <input id="mentry" type="date" value={form.entry_date ?? ''} onChange={setF('entry_date')} />
          </div>
          <FormField label="Passwort"    id="mpw" value={form.password ?? ''}       onChange={setF('password')} type="password" autoComplete="new-password" />
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
          <div className="modal-actions">
            <button className="btn-primary" type="submit" disabled={creating}>
              {creating ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)}>Abbrechen</button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel="Löschen"
        confirmClass="danger"
        onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  )
}
