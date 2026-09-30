import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, ChevronLeft, ChevronRight, Mail, Phone } from 'lucide-react'
import { ListLoading } from '@/components/ui/Skeleton'
import { SortTh } from '@/components/ui/SortTh'
import { FilterBar } from '@/components/ui/FilterBar'
import { FilterChip } from '@/components/ui/FilterChip'
import { HelpHint } from '@/components/ui/HelpHint'
import { InlineSelect, type InlineOption } from '@/components/ui/InlineEdit'
import { LimitBanner } from '@/components/ui/LimitBanner'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useStickySet, useStickyState } from '@/hooks/useStickyState'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import { fetchRoles, fetchEmployeeRoleMap, type UserRole, type EmployeeRoleMapping } from '@/api/rbac'
import { fetchEmployeeReportList, updateEmployee, type Employee, type EmployeeReportRow, type UpdateEmployeePayload } from '@/api/mitarbeiter'
import { fetchDepartments } from '@/api/stammdaten'
import { fmtEur, NO_VALUE } from '@/utils/money'
import { fmtBalance } from './mitarbeiterFormat'
import { mitarbeiterHref } from './mitarbeiterUrl'
import { MitarbeiterAnlegenDialog } from './MitarbeiterAnlegenDialog'

/**
 * Mitarbeiterliste (UI-Pilot Runde 10).
 *
 * Vorher öffnete jede Zeile einen Dialog; hier führt sie auf die Seite des
 * Mitarbeiters. Die Direktbearbeitung (Abteilung, Status) schickte die ganze
 * Zeile mit — samt allem, was ein Kollege zwischendurch geändert hatte. Die
 * Rollenabfragen liefen auch ohne das Recht „Rollen sehen" und meldeten
 * dann einen Fehler. Leere Liste und „kein Treffer" sahen gleich aus, und am
 * Handy lief die Tabelle mit 13 Spalten aus dem Bild.
 *
 * Vorname und Nachname sind eine Spalte (sortiert nach Nachname), die
 * Dashboard-Rolle steht nur noch auf der Seite des Mitarbeiters — mit beiden
 * passte die Tabelle bei 1280 px nicht ins Bild.
 */

const PAGE_SIZE = 25
type SortKey = 'ABBR' | 'LAST_NAME' | 'PERSONNEL_NUMBER' | 'MAIL'
const SORT_KEYS: SortKey[] = ['ABBR', 'LAST_NAME', 'PERSONNEL_NUMBER', 'MAIL']

const STATUS_OPTS: InlineOption[] = [
  { value: '1', label: 'Aktiv' },
  { value: '2', label: 'Inaktiv' },
]
const fullName = (e: Employee) => `${e.FIRST_NAME ?? ''} ${e.LAST_NAME ?? ''}`.trim()

function RoleChips({ employeeId, roles, mapping, href }: { employeeId: number; roles: UserRole[]; mapping: EmployeeRoleMapping[]; href: string | null }) {
  const ids = mapping.filter(m => m.EMPLOYEE_ID === employeeId).map(m => m.ROLE_ID)
  const assigned = roles.filter(r => ids.includes(r.ID))
  const body = assigned.length
    ? assigned.map(r => (
        <span key={r.ID} className="ma-role-chip">
          <span className="ma-role-dot" style={{ background: r.COLOR || 'var(--text-3)' }} aria-hidden="true" />{r.ABBR}
        </span>
      ))
    : <span className="ma-role-none">keine Rolle</span>
  if (!href) return <span className="ma-role-chips">{body}</span>
  return <Link to={href} className="ma-role-chips ma-role-link" onClick={e => e.stopPropagation()} title="Rollen ändern">{body}</Link>
}

export function MitarbeiterListe({ employees, isLoading }: { employees: Employee[]; isLoading: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const narrow = useIsNarrow()
  const canCreate   = usePermission('employees.create')
  const canEdit     = usePermission('employees.edit')
  const canSalary   = usePermission('employees.salary.view')
  const canBookings = usePermission('employees.bookings.view_all')
  const canRoles    = usePermission('roles.view')
  const canAssign   = usePermission('employees.role.assign')

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [activeAbt, setActiveAbt]       = useStickySet('mitarbeiter.dept')
  // Vorbelegt: nur aktive — eine bewusst gespeicherte Auswahl (auch „alle") bleibt.
  const [activeStatus, setActiveStatus] = useStickySet('mitarbeiter.status', () => new Set(['Aktiv']))
  const [activeModel, setActiveModel]   = useStickySet('mitarbeiter.model')
  const [storedSort, setSortKey] = useStickyState<SortKey>('mitarbeiter.sortKey', 'ABBR')
  // Vorname und Nachname sind seit Runde 10 eine Spalte — eine gemerkte
  // Sortierung nach FIRST_NAME fällt auf das Kürzel zurück.
  const sortKey: SortKey = SORT_KEYS.includes(storedSort) ? storedSort : 'ABBR'
  const [sortDir, setSortDir] = useStickyState<'asc' | 'desc'>('mitarbeiter.sortDir', 'asc')

  const { data: deptData }    = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const { data: rolesData }   = useQuery({ queryKey: ['user-roles'], queryFn: fetchRoles, enabled: canRoles })
  const { data: empRoleData } = useQuery({ queryKey: ['employee-role-map'], queryFn: fetchEmployeeRoleMap, enabled: canRoles })
  const { data: balData }     = useQuery({
    queryKey: ['emp-report-list', { mode: 'now' }],
    queryFn:  () => fetchEmployeeReportList({ mode: 'now' }),
    enabled:  canBookings,
  })
  const deptOpts: InlineOption[] = useMemo(() => (deptData?.data ?? []).map(d => ({ value: String(d.ID), label: d.ABBR })), [deptData])
  const roles = rolesData?.data ?? []
  const roleMap = empRoleData?.data ?? []
  const balByEmp = useMemo(() => {
    const m = new Map<number, EmployeeReportRow>()
    for (const row of balData?.data ?? []) m.set(row.EMPLOYEE_ID, row)
    return m
  }, [balData])

  // Nur das geänderte Feld — vorher ging die ganze Zeile mit.
  const inlineMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<UpdateEmployeePayload>; label: string }) => updateEmployee(id, body),
    onSuccess: (_r, v) => { toast.success(v.label); void qc.invalidateQueries({ queryKey: ['employees'] }); void qc.invalidateQueries({ queryKey: ['license-usage'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const filterOptions = useMemo(() => ({
    abt:    [...new Set(employees.map(e => e.DEPARTMENT_NAME).filter(Boolean))].sort(),
    status: ['Aktiv', 'Inaktiv'],
    model:  [...new Set(employees.map(e => e.CURRENT_MODEL_NAME).filter(Boolean))].sort(),
  }), [employees])

  const processed = useMemo(() => {
    let rows = employees
    const q = search.trim().toLowerCase()
    if (q) rows = rows.filter(r =>
      [r.ABBR, r.FIRST_NAME, r.LAST_NAME, r.MAIL, r.MOBILE, r.PHONE, r.PERSONNEL_NUMBER, r.DEPARTMENT_NAME]
        .map(v => String(v ?? '')).join(' ').toLowerCase().includes(q))
    if (activeAbt.size)    rows = rows.filter(r => activeAbt.has(r.DEPARTMENT_NAME))
    if (activeStatus.size) rows = rows.filter(r => activeStatus.has(r.ACTIVE === 2 ? 'Inaktiv' : 'Aktiv'))
    if (activeModel.size)  rows = rows.filter(r => activeModel.has(r.CURRENT_MODEL_NAME))
    return [...rows].sort((a, b) => {
      const c = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''), 'de', { sensitivity: 'base', numeric: true })
      return sortDir === 'asc' ? c : -c
    })
  }, [employees, search, sortKey, sortDir, activeAbt, activeStatus, activeModel])

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = processed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const filtered   = activeAbt.size + activeStatus.size + activeModel.size
  const resetFilters = () => { setActiveAbt(new Set()); setActiveStatus(new Set()); setActiveModel(new Set()); setSearch(''); setPage(1) }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }
  const sortProps = { sortKey, dir: sortDir, onSort: toggleSort }
  const rolesHref = (id: number) => (canAssign || canRoles ? mitarbeiterHref(id, 'rollen') : null)
  const open = (id: number) => navigate(mitarbeiterHref(id))

  // Spaltenzahl aus denselben Bedingungen wie der Kopf — vorher stand dort
  // eine feste 9 bzw. 10 bei bis zu 13 Spalten.
  const colCount = 8 + (canSalary ? 1 : 0) + (canBookings ? 1 : 0) + (canRoles ? 1 : 0)

  // Status-Schild (Testversion 1): weiss mit farbigem Punkt, die Auswahl
  // bleibt direkt bedienbar.
  const statusCell = (r: Employee) => (
    <span className="status-select" data-tone={r.ACTIVE === 2 ? 'ruhend' : 'aktiv'}>
      <InlineSelect
        value={r.ACTIVE === 2 ? 2 : 1} options={STATUS_OPTS} allowEmpty={false}
        readOnly={!canEdit} ariaLabel={`Status ${r.ABBR}`}
        onChange={v => inlineMut.mutate({ id: r.ID, body: { active: Number(v) }, label: `${r.ABBR} ist jetzt ${Number(v) === 2 ? 'inaktiv' : 'aktiv'}.` })}
      />
    </span>
  )

  let body: React.ReactNode
  if (isLoading) body = <ListLoading columns={6} />
  else if (!employees.length) body = (
    <div className="empty-block">
      <p className="empty-note">Noch keine Mitarbeiter angelegt.</p>
      <p className="empty-block-why">Mitarbeiter buchen Stunden auf Projekte, leiten Projekte und bekommen über Rollen ihre Rechte. Jeder bekommt eine Einladung und legt sein Passwort selbst fest.</p>
      {canCreate && (
        <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> Ersten Mitarbeiter anlegen
        </button>
      )}
    </div>
  )
  else if (!processed.length) body = (
    <div className="empty-block">
      <p className="empty-note">Kein Mitarbeiter passt zu Suche und Filter.</p>
      <button type="button" className="btn-secondary" onClick={resetFilters}>Suche und Filter zurücksetzen</button>
    </div>
  )
  else if (narrow) body = (
    <ul className="ad-cards" aria-label="Mitarbeiter">
      {pageRows.map(r => (
        <li key={r.ID} className="ad-card">
          <div className="ad-card-top">
            <Link to={mitarbeiterHref(r.ID)} className="ad-card-main ma-card-link">
              <span className="ad-card-name">{fullName(r)}</span>
              <span className="ad-card-sub">{[r.ABBR, r.DEPARTMENT_NAME, r.CURRENT_MODEL_NAME].filter(Boolean).join(' · ')}</span>
            </Link>
            <div className="ad-card-actions">{statusCell(r)}</div>
          </div>
          {(r.MAIL || r.MOBILE || r.PHONE) && (
            <div className="ad-card-links">
              {r.MAIL && <a href={`mailto:${r.MAIL}`}><Mail size={14} strokeWidth={1.75} aria-hidden="true" />{r.MAIL}</a>}
              {(r.MOBILE || r.PHONE) && <a href={`tel:${r.MOBILE || r.PHONE}`}><Phone size={14} strokeWidth={1.75} aria-hidden="true" />{r.MOBILE || r.PHONE}</a>}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
  else body = (
    <div className="table-scroll">
      <table className="master-table">
        <thead>
          <tr>
            <SortTh label="Kürzel"      column="ABBR"             {...sortProps} />
            <SortTh label="Name"        column="LAST_NAME"        {...sortProps} />
            <SortTh label="Personalnr." column="PERSONNEL_NUMBER" {...sortProps} />
            <SortTh label="E-Mail"      column="MAIL"             {...sortProps} />
            <th scope="col">Abteilung</th>
            <th scope="col">Modell</th>
            {canSalary && <th scope="col" className="num">Kostensatz<HelpHint id="mitarbeiter.kostensatz_liste" align="right" /></th>}
            {canBookings && <th scope="col" className="num">Saldo<HelpHint id="mitarbeiter.saldo" align="right" /></th>}
            <th scope="col">Status</th>
            {canRoles && <th scope="col">Rollen</th>}
            <th scope="col" className="doc-actions"><span className="sr-only">Aktionen</span></th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map(r => {
            const bal = balByEmp.get(r.ID)
            return (
              <tr key={r.ID} className="clickable-row" onClick={() => open(r.ID)}>
                <td><Link to={mitarbeiterHref(r.ID)} className="ad-row-link" onClick={e => e.stopPropagation()}>{r.ABBR}</Link></td>
                <td className="ma-name">{fullName(r)}</td>
                <td className="cell-nowrap num">{r.PERSONNEL_NUMBER || <span className="ma-none">{NO_VALUE}</span>}</td>
                <td className="ma-mail">{r.MAIL || <span className="ma-none">{NO_VALUE}</span>}</td>
                <td onClick={e => e.stopPropagation()}>
                  <InlineSelect
                    value={r.DEPARTMENT_ID} options={deptOpts} placeholder={NO_VALUE}
                    readOnly={!canEdit} ariaLabel={`Abteilung ${r.ABBR}`} fallbackLabel={r.DEPARTMENT_NAME || undefined}
                    onChange={v => inlineMut.mutate({ id: r.ID, body: { department_id: v ? Number(v) : null }, label: `Abteilung von ${r.ABBR} geändert.` })}
                  />
                </td>
                <td>{r.CURRENT_MODEL_NAME || <span className="ma-none">{NO_VALUE}</span>}</td>
                {canSalary && (
                  <td className="num">
                    {r.CURRENT_COST_RATE != null
                      ? <span title={r.CURRENT_COST_RATE_FROM ? `gültig ab ${r.CURRENT_COST_RATE_FROM}` : undefined}>{fmtEur(Number(r.CURRENT_COST_RATE))}/h</span>
                      : <span className="ma-none">{NO_VALUE}</span>}
                  </td>
                )}
                {canBookings && (
                  <td className="num" title={bal ? `Monatssaldo (akt. Monat): ${fmtBalance(bal.BALANCE)}` : undefined}>
                    {bal
                      ? <span className={(bal.RUNNING_BALANCE ?? 0) < 0 ? 'ma-balance-neg' : 'ma-balance'}>{fmtBalance(bal.RUNNING_BALANCE ?? 0)}</span>
                      : <span className="ma-none">{NO_VALUE}</span>}
                  </td>
                )}
                <td onClick={e => e.stopPropagation()}>{statusCell(r)}</td>
                {canRoles && <td><RoleChips employeeId={r.ID} roles={roles} mapping={roleMap} href={rolesHref(r.ID)} /></td>}
                <td className="doc-actions" onClick={e => e.stopPropagation()}>
                  <Link to={mitarbeiterHref(r.ID)} className="row-action-btn" title="Öffnen" aria-label={`${r.ABBR} öffnen`}>
                    <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="ma-foot">
            <td colSpan={colCount}>
              {processed.length !== employees.length ? `${processed.length} von ${employees.length} Mitarbeitern` : `${employees.length} Mitarbeiter`}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )

  return (
    <>
      <LimitBanner capability="limits.employees" />
      <div className="list-toolbar">
        <input type="search" className="list-search" placeholder="Suchen …" aria-label="Mitarbeiter suchen"
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <span className="list-info">{processed.length} Mitarbeiter{totalPages > 1 ? ` · Seite ${safePage}/${totalPages}` : ''}</span>
        {canCreate && (
          <button type="button" className="btn-primary btn-small" style={{ marginLeft: 'auto' }} onClick={() => setShowCreate(true)}>
            <Plus size={14} strokeWidth={2.25} aria-hidden="true" /> Neuer Mitarbeiter
          </button>
        )}
      </div>

      <FilterBar activeCount={filtered} onReset={resetFilters}>
        <FilterChip label="Abteilung" options={filterOptions.abt}    active={activeAbt}    onChange={v => { setActiveAbt(v);    setPage(1) }} />
        <FilterChip label="Status"    options={filterOptions.status} active={activeStatus} onChange={v => { setActiveStatus(v); setPage(1) }} />
        <FilterChip label="Modell"    options={filterOptions.model}  active={activeModel}  onChange={v => { setActiveModel(v);  setPage(1) }} />
      </FilterBar>

      {body}

      {totalPages > 1 && !!processed.length && (
        <div className="pagination">
          <button type="button" className="btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>
            <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />Zurück
          </button>
          <span className="pagination-info">Seite {safePage} / {totalPages}</span>
          <button type="button" className="btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
            Weiter<ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      <MitarbeiterAnlegenDialog open={showCreate} onClose={() => setShowCreate(false)} employees={employees} />
    </>
  )
}
