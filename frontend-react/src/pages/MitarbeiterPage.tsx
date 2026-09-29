import { useState, useMemo, useRef, useEffect, Fragment } from 'react'
import { ListLoading } from '@/components/ui/Skeleton'
import { FilterChip } from '@/components/ui/FilterChip'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs } from '@/components/ui/Tabs'
import { HelpHint } from '@/components/ui/HelpHint'
import type { HelpId } from '@/help/helpContent'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useToast } from '@/store/toastStore'
import { useConfirm } from '@/hooks/useConfirm'
import { Download, AlertTriangle, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ArrowRight, Circle, CircleCheck } from 'lucide-react'
import { useFilterTabs, usePermission } from '@/store/permissionsStore'
import { useLicenseFilterTabs, useFeature } from '@/store/licenseStore'
import { FilterBar } from '@/components/ui/FilterBar'
import { MyAbsencesPanel, ClarificationThread } from '@/components/mitarbeiter/MyAbsencesPanel'
import { fetchEmployeeList, closeMonth, reopenMonth, fetchMonthCloseOverview, fetchEmployeeReportList, type Employee, type MonthCloseOverviewEmployee, type EmployeeReportRow } from '@/api/mitarbeiter'
import { RecentList } from '@/components/recents/RecentList'
import { useTrackFilterRecent } from '@/hooks/useTrackFilterRecent'
import { fetchArbzgAudit, downloadArbzgAuditCsv, type AuditEntry, type ArbzgSeverity } from '@/api/arbzg'
import { fetchAbsences, fetchAllEntitlements, putEntitlementsBulk, decideAbsence, type Absence, type AbsenceStatus } from '@/api/abwesenheit'
import { fmtEur } from '@/utils/money'
import { fmtH, fmtBalance, fmtDateShort, localIso, todayLocal } from '@/pages/mitarbeiter/mitarbeiterFormat'
import { SegmentNav } from '@/pages/mitarbeiter/SegmentNav'
import { EmployeeTimeAccount } from '@/pages/mitarbeiter/EmployeeTimeAccount'
import { ClarifyModal } from '@/pages/mitarbeiter/EmployeeAbsenceSection'
import { MitarbeiterListe } from '@/pages/mitarbeiter/MitarbeiterListe'

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { id: string; label: string; permissions: string[]; feature?: string }[] = [
  { id: 'list',          label: 'Mitarbeiter',           permissions: ['employees.view'] },
  { id: 'zeitwirtschaft', label: 'Stundencontrolling',   permissions: ['employees.bookings.view_all','employees.month_close.edit'] },
  { id: 'abwesenheiten', label: 'Abwesenheiten',         permissions: ['absence.view','absence.request'] },
  { id: 'arbzg',         label: 'Arbeitszeit (Details)', permissions: ['employees.bookings.view_all'], feature: 'arbzg.compliance' },
]
const MONTH_NAMES   = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

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


// ── FilterChip ────────────────────────────────────────────────────────────────


// ── Employee List Report ───────────────────────────────────────────────────────


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
        r.ABBR.toLowerCase().includes(q) ||
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
  function si(field: string) {
    if (sortField !== field) return null
    return sortDir === 'asc'
      ? <ChevronUp size={12} strokeWidth={2.25} aria-label="aufsteigend" style={{ marginLeft: 3, verticalAlign: -1 }} />
      : <ChevronDown size={12} strokeWidth={2.25} aria-label="absteigend" style={{ marginLeft: 3, verticalAlign: -1 }} />
  }

  const balanceColor = (n: number) => n > 0 ? 'var(--success)' : n < 0 ? 'var(--danger)' : 'var(--text-3)'

  function sortFlat(rows: EmployeeReportRow[]) {
    return [...rows].sort((a, b) => {
      let va: string | number = 0, vb: string | number = 0
      if      (sortField === 'name')     { va = a.ABBR;      vb = b.ABBR      }
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
      ? [...filtered].sort((a, b) => a.ABBR.localeCompare(b.ABBR) || a.YEAR - b.YEAR || a.MONTH - b.MONTH)
      : sortFlat(filtered)
    for (const r of sorted) {
      const base = [r.ABBR, r.FIRST_NAME, r.LAST_NAME, r.DEPARTMENT_NAME || '']
      const prod = r.PRODUCTIVITY_PCT != null ? num(r.PRODUCTIVITY_PCT) : ''
      const cost = r.COST > 0 ? num(r.COST) : ''
      rows.push(isPeriod
        ? [...base, r.YEAR, r.MONTH, num(r.REQUIRED), num(r.ACTUAL), num(r.BALANCE), cost, prod]
        : [...base, num(r.REQUIRED), num(r.ACTUAL), num(r.BALANCE), r.RUNNING_BALANCE != null ? num(r.RUNNING_BALANCE) : '', cost, prod])
    }
    const stamp = mode === 'period' ? `${dateFrom}_bis_${dateTo}` : mode === 'as_of' ? asOfDate : todayLocal()
    downloadCsv(`mitarbeiter-auswertung_${stamp}.csv`, rows)
  }

  function NumTh({ label, field, help }: { label: string; field: string; help?: HelpId }) {
    return (
      <th scope="col" className="num sortable-th" onClick={() => toggleSort(field)} style={{ cursor: 'pointer' }}>
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
        <td className="num"><strong>{sumF(rows, r => r.COST) > 0 ? fmtEur(sumF(rows, r => r.COST)) : '—'}</strong></td>
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
          {employees.map(e => <option key={e.ID} value={e.ID}>{e.ABBR} – {e.FIRST_NAME} {e.LAST_NAME}</option>)}
        </select>
      </div>

      {isLoading && <ListLoading columns={6} />}
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
            {/* Auf dem Handy hinter „Filter" eingeklappt (siehe FilterBar). */}
            <FilterBar
              activeCount={deptFilter.size + statusFilter.size + modelFilter.size}
              onReset={clearFilters}
            >
              <FilterChip label="Abteilung" options={deptOptions}    active={deptFilter}   onChange={setDeptFilter}   />
              <FilterChip label="Status"    options={statusOptions}  active={statusFilter} onChange={setStatusFilter} />
              <FilterChip label="Modell"    options={modelOptions}   active={modelFilter}  onChange={setModelFilter}  />
            </FilterBar>
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
                    <th scope="col" className="sortable-th" style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>Kürzel{si('name')}</th>
                    <th scope="col">Name</th>
                    <th scope="col" className="sortable-th" style={{ cursor: 'pointer' }} onClick={() => toggleSort('dept')}>Abteilung{si('dept')}</th>
                    <NumTh label="Soll"            field="required"     />
                    <NumTh label="Ist"             field="actual"       />
                    <NumTh label="Monatssaldo"     field="balance"      help="mitarbeiter.saldo" />
                    <th scope="col" className="num">Laufender Saldo<HelpHint id="mitarbeiter.saldo" align="right" /></th>
                    <NumTh label="Kosten"          field="cost"         />
                    <th scope="col" className="num" title="Projektstunden (ohne interne) / Alle gebuchten Stunden">Produktivität</th>
                  </tr>
                </thead>
                <tbody>
                  {sortFlat(filtered).map(r => (
                    <tr key={r.EMPLOYEE_ID}>
                      <td><strong>{r.ABBR}</strong></td>
                      <td>{r.FIRST_NAME} {r.LAST_NAME}</td>
                      <td>{r.DEPARTMENT_NAME || '—'}</td>
                      <td className="num">{fmtH(r.REQUIRED)}</td>
                      <td className="num">{fmtH(r.ACTUAL)}</td>
                      <td className="num" style={{ color: balanceColor(r.BALANCE), fontWeight: 600 }}>{fmtBalance(r.BALANCE)}</td>
                      <td className="num" style={{ color: balanceColor(r.RUNNING_BALANCE ?? 0), fontWeight: 600 }}>
                        {r.RUNNING_BALANCE != null ? fmtBalance(r.RUNNING_BALANCE) : '…'}
                      </td>
                      <td className="num">{r.COST > 0 ? fmtEur(r.COST) : '—'}</td>
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
              (a[1][0]?.ABBR ?? '').localeCompare(b[1][0]?.ABBR ?? '')
            )
            return (
              <div className="list-section table-scroll">
                <table className="master-table">
                  <thead>
                    <tr>
                      <th scope="col">Mitarbeiter</th>
                      <th scope="col">Abteilung</th>
                      <th scope="col">Monat</th>
                      <NumTh label="Soll"          field="required"     />
                      <NumTh label="Ist"           field="actual"       />
                      <NumTh label="Monatssaldo"   field="balance"      />
                      <th scope="col" className="num">Laufender Saldo<HelpHint id="mitarbeiter.saldo" align="right" /></th>
                      <NumTh label="Kosten"        field="cost"         />
                      <th scope="col" className="num" title="Projektstunden (ohne interne) / Alle gebuchten Stunden">Produktivität</th>
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
                                  <strong>{r.ABBR}</strong>
                                  <br /><span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>{r.FIRST_NAME} {r.LAST_NAME}</span>
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
                              <td className="num">{r.COST > 0 ? fmtEur(r.COST) : '—'}</td>
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
                        <td className="num"><strong>{sumF(filtered, r => r.COST) > 0 ? fmtEur(sumF(filtered, r => r.COST)) : '—'}</strong></td>
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


// ── Zeitwirtschaft Tab (Auswertung · Einzel-Mitarbeiter · Monatsabschluss) ─────

// ── Abwesenheiten-Tab (Genehmigungs-Postfach + Team-Kalender) ─────────────────

type AbsSub = 'inbox' | 'calendar' | 'my' | 'entitlements'
const ABS_SUBS: AbsSub[] = ['inbox', 'calendar', 'my', 'entitlements']

function AbwesenheitenTab({ employees }: { employees: Employee[] }) {
  // Deep-Link aus einer Benachrichtigung: ?sub=my&absence=42 fuehrt direkt zum
  // betroffenen Antrag. Ohne das landete der Nutzer nur irgendwo im Modul und
  // musste den Antrag selbst suchen.
  const [absSearchParams, setAbsSearchParams] = useSearchParams()
  const linkedSub     = absSearchParams.get('sub') as AbsSub | null
  const linkedAbsence = Number(absSearchParams.get('absence')) || null
  const qc = useQueryClient()
  const toast = useToast()
  const canApprove = usePermission('absence.approve')
  const canView    = usePermission('absence.view')
  const canRequest = usePermission('absence.request')
  const canManage  = usePermission('absence.manage')
  const [sub, setSub] = useState<AbsSub>(
    linkedSub && ABS_SUBS.includes(linkedSub) ? linkedSub : (canView ? 'inbox' : 'my'),
  )
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [clarifyId, setClarifyId] = useState<number | null>(null)

  const { data: inboxRes, isLoading: inboxLoading } = useQuery({
    queryKey: ['absences-inbox'],
    queryFn:  () => fetchAbsences({ status: 'REQUESTED' }),
    enabled:  canView,
  })
  const inbox = inboxRes?.data ?? []

  const monthFrom = `${year}-${String(month).padStart(2, '0')}-01`
  const monthTo   = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
  const { data: calRes } = useQuery({
    queryKey: ['absences-calendar', year, month],
    queryFn:  () => fetchAbsences({ from: monthFrom, to: monthTo }),
    enabled:  sub === 'calendar' && canView,
  })

  // Überschneidungen: alle Abwesenheiten im Zeitfenster der offenen Anträge laden,
  // um beim Genehmigen zu sehen, wer gleichzeitig (bereits genehmigt) abwesend ist.
  const inboxRange = useMemo(() => {
    if (!inbox.length) return null
    let f = inbox[0].DATE_FROM, t = inbox[0].DATE_TO
    for (const a of inbox) { if (a.DATE_FROM < f) f = a.DATE_FROM; if (a.DATE_TO > t) t = a.DATE_TO }
    return { from: f, to: t }
  }, [inbox])
  const { data: overlapRes } = useQuery({
    queryKey: ['absences-overlap', inboxRange?.from, inboxRange?.to],
    queryFn:  () => fetchAbsences({ from: inboxRange!.from, to: inboxRange!.to }),
    enabled:  canView && sub === 'inbox' && !!inboxRange,
  })
  const overlapPool = overlapRes?.data ?? []
  const overlapsFor = (a: Absence): Absence[] =>
    overlapPool.filter(o =>
      o.ID !== a.ID && o.EMPLOYEE_ID !== a.EMPLOYEE_ID && o.STATUS === 'APPROVED' &&
      o.DATE_FROM <= a.DATE_TO && o.DATE_TO >= a.DATE_FROM)

  const subItems: { id: AbsSub; label: string }[] = [
    ...(canView    ? [{ id: 'inbox'    as AbsSub, label: `Anträge${inbox.length ? ` (${inbox.length})` : ''}` }, { id: 'calendar' as AbsSub, label: 'Kalender' }] : []),
    ...(canRequest ? [{ id: 'my'       as AbsSub, label: 'Meine Anträge' }] : []),
    ...(canManage  ? [{ id: 'entitlements' as AbsSub, label: 'Urlaubsansprüche' }] : []),
  ]
  useEffect(() => {
    if (subItems.length && !subItems.some(s => s.id === sub)) setSub(subItems[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subItems.map(s => s.id).join(',')])

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

  // Wechselt der Nutzer den Bereich, ist der Deep-Link abgearbeitet. Ohne das
  // Aufraeumen bliebe ?sub=…&absence=… in der Adresse stehen und wuerde den
  // alten Antrag bei jeder Rueckkehr erneut hervorheben.
  function changeSub(next: AbsSub) {
    setSub(next)
    if (absSearchParams.has('sub') || absSearchParams.has('absence')) {
      const p = new URLSearchParams(absSearchParams)
      p.delete('sub'); p.delete('absence')
      setAbsSearchParams(p, { replace: true })
    }
  }

  function prevMonth() { if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1) }
  function nextMonth() { if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1) }

  return (
    <div>
      <SegmentNav items={subItems} active={sub} onChange={changeSub} />

      {sub === 'my' && <MyAbsencesPanel focusAbsenceId={linkedAbsence} />}

      {sub === 'entitlements' && canManage && <EntitlementsBulkEditor employees={employees} />}

      {sub === 'inbox' && canView && (
        <>
          {inboxLoading && <p className="empty-note">Laden …</p>}
          {!inboxLoading && inbox.length === 0 && <p className="empty-note">Keine offenen Anträge.</p>}
          {inbox.length > 0 && (
            <div className="table-scroll">
              <table className="master-table">
                <thead><tr>
                  <th scope="col">Mitarbeiter</th><th scope="col">Zeitraum</th><th scope="col">Art</th><th scope="col" className="num">Tage</th><th scope="col">Notiz</th><th scope="col"></th>
                </tr></thead>
                <tbody>
                  {inbox.map((a: Absence) => (
                    // Aus einer Benachrichtigung verlinkter Antrag wird
                    // hervorgehoben — die Liste kann lang sein.
                    <tr key={a.ID} style={a.ID === linkedAbsence ? { background: 'var(--accent-tint)' } : undefined}>
                      <td><strong>{a.EMPLOYEE_SHORT_NAME}</strong> {a.EMPLOYEE_FIRST_NAME} {a.EMPLOYEE_LAST_NAME}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {fmtDateShort(a.DATE_FROM)}{a.DATE_TO !== a.DATE_FROM ? `–${fmtDateShort(a.DATE_TO)}` : ''}{a.HALF_DAY ? ' (½)' : ''}
                        {(() => {
                          const ov = overlapsFor(a)
                          return ov.length > 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'normal' }}
                              title={`Gleichzeitig abwesend: ${ov.map(o => `${o.EMPLOYEE_SHORT_NAME} (${o.TYPE_NAME})`).join(', ')}`}>
                              <AlertTriangle size={11} strokeWidth={2} /> {ov.length} gleichzeitig: {ov.map(o => o.EMPLOYEE_SHORT_NAME).filter(Boolean).join(', ')}
                            </div>
                          ) : null
                        })()}
                      </td>
                      <td><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: a.TYPE_COLOR || 'var(--text-4)', marginRight: 6 }} />{a.TYPE_NAME}</td>
                      <td className="num">{a.DAYS}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        {a.NOTE || '—'}
                        <ClarificationThread a={a} />
                      </td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {canApprove ? (
                          <>
                            <button className="btn-small btn-save" style={{ padding: '1px 8px', fontSize: 11, marginRight: 4 }} disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: a.ID, decision: 'APPROVED' })}>Genehmigen</button>
                            <button className="btn-small" style={{ padding: '1px 8px', fontSize: 11, marginRight: 4 }} disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: a.ID, decision: 'REJECTED' })}>Ablehnen</button>
                            <button className="btn-small" style={{ padding: '1px 8px', fontSize: 11 }} onClick={() => setClarifyId(a.ID)}>Rückfrage</button>
                          </>
                        ) : <span style={{ fontSize: 11, color: 'var(--text-3)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {sub === 'calendar' && canView && (() => {
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
              byEmp.get(a.EMPLOYEE_ID)!.set(d.getDate(), { color: a.TYPE_COLOR || 'var(--text-4)', status: a.STATUS, name: a.TYPE_NAME || '', half: a.HALF_DAY })
            }
            d.setDate(d.getDate() + 1)
          }
        }
        const activeEmployees = employees.filter(e => e.ACTIVE !== 2)
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <button type="button" className="btn-secondary btn-small ent-year-btn" onClick={prevMonth} aria-label="Vormonat"><ChevronLeft size={15} strokeWidth={2} aria-hidden="true" /></button>
              <span className="ta-month" aria-live="polite">{MONTH_NAMES[month - 1]} {year}</span>
              <button type="button" className="btn-secondary btn-small ent-year-btn" onClick={nextMonth} aria-label="Folgemonat"><ChevronRight size={15} strokeWidth={2} aria-hidden="true" /></button>
            </div>
            <div className="table-scroll">
              <table className="master-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>Mitarbeiter</th>
                    {dayList.map(day => {
                      const we = [0, 6].includes(new Date(year, month - 1, day).getDay())
                      return <th scope="col" key={day} style={{ textAlign: 'center', padding: '2px 3px', color: 'var(--text-3)', background: we ? 'var(--surface-2)' : undefined, fontWeight: 500 }}>{day}</th>
                    })}
                  </tr>
                </thead>
                <tbody>
                  {activeEmployees.map(emp => {
                    const dm = byEmp.get(emp.ID)
                    return (
                      <tr key={emp.ID}>
                        <td style={{ whiteSpace: 'nowrap' }}><strong>{emp.ABBR}</strong></td>
                        {dayList.map(day => {
                          const cell = dm?.get(day)
                          const we = [0, 6].includes(new Date(year, month - 1, day).getDay())
                          return (
                            <td key={day}
                              title={cell ? `${cell.name}${cell.status === 'REQUESTED' ? ' (beantragt)' : ''}${cell.half ? ' (halber Tag)' : ''}` : ''}
                              style={{ textAlign: 'center', padding: 0, height: 22, borderLeft: '1px solid var(--border-3)',
                                // Beantragt: nur umrandet statt blass gefüllt — vorher stand
                                // dort ein weißes „?" in 9px auf der Farbe, in hellen
                                // Abwesenheitsfarben unlesbar.
                                background: cell && cell.status !== 'REQUESTED' ? cell.color : (we ? 'var(--surface-2)' : undefined),
                                boxShadow: cell && cell.status === 'REQUESTED' ? `inset 0 0 0 2px ${cell.color}` : undefined }}>
                              {cell && cell.status === 'REQUESTED' ? <span style={{ color: 'var(--text-2)', fontSize: 11, fontWeight: 700 }} aria-hidden="true">?</span> : ''}
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
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
              Farbe = Abwesenheitsart · umrandet mit „?" = beantragt (offen) · gefüllt = genehmigt
            </p>
          </>
        )
      })()}

      {clarifyId != null && (
        <ClarifyModal absenceId={clarifyId} onClose={() => setClarifyId(null)}
          onDone={() => {
            setClarifyId(null)
            void qc.invalidateQueries({ queryKey: ['absences-inbox'] })
            void qc.invalidateQueries({ queryKey: ['absences'] })
          }} />
      )}
    </div>
  )
}

// ── Urlaubsansprüche (Bulk-Editor je Jahr) ────────────────────────────────────
// Runde 10: Eingaben liegen über dem geladenen Stand. Vorher setzte jedes
// Nachladen der Mitarbeiterliste (Fensterwechsel genügte) alle Felder
// zurück, ein leeres Feld ging als 0 Tage an den Server — für jeden
// Mitarbeiter ohne Eintrag entstand so ein Anspruch von 0 —, und „27,5"
// ließ das Zahlenfeld gar nicht erst zu.
const parseDays = (v: string): number | null => {
  const t = v.trim()
  if (!t) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const daysText = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))

function EntitlementsBulkEditor({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const [year, setYear] = useState(new Date().getFullYear())
  const [edits, setEdits] = useState<Record<number, { days?: string; carry?: string }>>({})
  const [bulkVal, setBulkVal] = useState('')
  const [tried, setTried] = useState(false)

  const { data: entRes, isLoading } = useQuery({ queryKey: ['entitlements-all', year], queryFn: () => fetchAllEntitlements(year) })

  const active = useMemo(
    () => employees.filter(e => e.ACTIVE !== 2).sort((a, b) => (a.ABBR || '').localeCompare(b.ABBR || '')),
    [employees])
  const saved = useMemo(() => {
    const byEmp = new Map((entRes?.data ?? []).map(e => [e.EMPLOYEE_ID, e]))
    const out: Record<number, { days: string; carry: string }> = {}
    for (const e of active) {
      const ent = byEmp.get(e.ID)
      out[e.ID] = { days: daysText(ent?.DAYS_ENTITLED), carry: daysText(ent?.CARRYOVER_OVERRIDE) }
    }
    return out
  }, [entRes, active])
  const val = (id: number) => ({ ...saved[id], ...edits[id] })
  const changedIds = active.map(e => e.ID).filter(id => {
    const v = val(id)
    return v.days !== saved[id]?.days || v.carry !== saved[id]?.carry
  })
  const invalidIds = changedIds.filter(id => {
    const d = parseDays(val(id).days), c = parseDays(val(id).carry)
    return d == null || Number.isNaN(d) || d < 0 || d > 366 || Number.isNaN(c as number)
  })
  const dirty = changedIds.length > 0

  const saveMut = useMutation({
    mutationFn: () => putEntitlementsBulk(year, changedIds.map(id => ({
      employee_id: id,
      days_entitled: parseDays(val(id).days) ?? 0,
      carryover_override: parseDays(val(id).carry),
    }))),
    onSuccess: (r) => {
      toast.success(`${r.count} ${r.count === 1 ? 'Urlaubsanspruch' : 'Urlaubsansprüche'} gespeichert`)
      setEdits({}); setTried(false)
      void qc.invalidateQueries({ queryKey: ['entitlements-all'] })
      void qc.invalidateQueries({ queryKey: ['entitlements'] })
      void qc.invalidateQueries({ queryKey: ['vacation-balance'] })
      void qc.invalidateQueries({ queryKey: ['my-vacation-balance'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function save() {
    setTried(true)
    if (invalidIds.length) {
      toast.error('Bitte bei den markierten Mitarbeitern einen Anspruch zwischen 0 und 366 Tagen angeben.')
      return
    }
    saveMut.mutate()
  }

  async function changeYear(delta: number) {
    if (dirty && !(await confirm({
      title: 'Änderungen verwerfen?',
      message: `Die Ansprüche für ${year} sind noch nicht gespeichert (${changedIds.length} ${changedIds.length === 1 ? 'Mitarbeiter' : 'Mitarbeiter'}).`,
      confirmLabel: 'Verwerfen',
    }))) return
    setEdits({}); setTried(false); setYear(y => y + delta)
  }

  function applyBulk() {
    const v = bulkVal.trim()
    if (v === '') return
    setEdits(prev => { const n = { ...prev }; for (const e of active) n[e.ID] = { ...n[e.ID], days: v }; return n })
  }
  const setField = (id: number, k: 'days' | 'carry', v: string) => setEdits(p => ({ ...p, [id]: { ...p[id], [k]: v } }))

  return (
    <div className="ent-editor">
      <div className="ent-toolbar">
        <button type="button" className="btn-secondary btn-small ent-year-btn" onClick={() => void changeYear(-1)} aria-label="Vorjahr">
          <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="ent-year" aria-live="polite">{year}</span>
        <button type="button" className="btn-secondary btn-small ent-year-btn" onClick={() => void changeYear(1)} aria-label="Folgejahr">
          <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="ent-bulk">
          <label className="sr-only" htmlFor="ent-bulk">Tage für alle</label>
          <input id="ent-bulk" type="text" inputMode="decimal" className="tbl-input ent-input"
            placeholder="Tage" value={bulkVal} onChange={e => setBulkVal(e.target.value)} />
          <button type="button" className="btn-secondary btn-small" onClick={applyBulk} disabled={!bulkVal.trim()}>Allen zuweisen</button>
        </span>
      </div>
      <p className="ent-hint">
        Jahres-Urlaubsanspruch je Mitarbeiter für {year}. „Übertrag manuell" überschreibt den automatischen
        Übertrag aus dem Vorjahr (leer = automatisch). Gespeichert werden nur geänderte Zeilen.
      </p>

      {isLoading && <ListLoading columns={3} />}
      {!isLoading && active.length === 0 && (
        <p className="empty-note">Keine aktiven Mitarbeiter. (Der Editor benötigt das Recht „Mitarbeiter ansehen".)</p>
      )}

      {!isLoading && active.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="master-table">
              <thead><tr>
                <th scope="col">Mitarbeiter</th>
                <th scope="col" className="num">Anspruch (Tage)</th>
                <th scope="col" className="num">Übertrag manuell</th>
              </tr></thead>
              <tbody>
                {active.map(e => {
                  const v = val(e.ID)
                  const bad = tried && invalidIds.includes(e.ID)
                  return (
                    <tr key={e.ID}>
                      <td><strong>{e.ABBR}</strong> {e.FIRST_NAME} {e.LAST_NAME}</td>
                      <td className="num">
                        <input type="text" inputMode="decimal" className="tbl-input ent-input" aria-label={`Anspruch ${e.ABBR}`}
                          placeholder="—" aria-invalid={bad || undefined}
                          value={v.days} onChange={ev => setField(e.ID, 'days', ev.target.value)} />
                      </td>
                      <td className="num">
                        <input type="text" inputMode="decimal" className="tbl-input ent-input" aria-label={`Übertrag ${e.ABBR}`}
                          placeholder="auto" value={v.carry} onChange={ev => setField(e.ID, 'carry', ev.target.value)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="ent-actions">
            {dirty && <span className="ent-status">{changedIds.length} {changedIds.length === 1 ? 'Zeile' : 'Zeilen'} geändert</span>}
            {dirty && <button type="button" className="btn-secondary btn-small" onClick={() => { setEdits({}); setTried(false) }} disabled={saveMut.isPending}>Verwerfen</button>}
            <button type="button" className="btn-primary btn-small" disabled={saveMut.isPending || !dirty} onClick={save}>
              {saveMut.isPending ? 'Speichert …' : `Ansprüche ${year} speichern`}
            </button>
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  )
}

// Einheitliche Mitarbeiter-Suchbox (analog ProjectPicker): tippen filtert,
// optional Sprung „Zur Mitarbeiterliste →". Nutzt die project-picker-Styles.
function MitarbeiterPicker({ employees, selectedId, onSelect, onGoToList, placeholder = 'Mitarbeiter suchen …' }: {
  employees: Employee[]; selectedId: number | null; onSelect: (id: number) => void; onGoToList?: () => void; placeholder?: string
}) {
  const [input, setInput] = useState('')
  const [open, setOpen]   = useState(false)
  const acRef = useRef<HTMLDivElement>(null)

  const nameOf = (e: Employee) => `${e.ABBR} – ${e.FIRST_NAME} ${e.LAST_NAME}`
  const selectedName = useMemo(() => {
    const e = selectedId != null ? employees.find(x => x.ID === selectedId) : undefined
    return e ? nameOf(e) : ''
  }, [selectedId, employees])
  useEffect(() => { setInput(selectedName) }, [selectedName])

  const query = input.toLowerCase().trim()
  const isFiltering = query.length > 0 && query !== selectedName.toLowerCase()
  const filtered = useMemo(() => {
    const list = [...employees].sort((a, b) => (a.ABBR || '').localeCompare(b.ABBR || ''))
    if (!isFiltering) return list
    return list.filter(e =>
      (e.ABBR || '').toLowerCase().includes(query) ||
      (e.FIRST_NAME || '').toLowerCase().includes(query) ||
      (e.LAST_NAME  || '').toLowerCase().includes(query))
  }, [employees, query, isFiltering])

  useEffect(() => {
    if (!open) return
    function onDown(ev: MouseEvent) {
      if (acRef.current && !acRef.current.contains(ev.target as Node)) { setOpen(false); setInput(selectedName) }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, selectedName])

  function pick(id: number) {
    onSelect(id)
    const e = employees.find(x => x.ID === id)
    setInput(e ? nameOf(e) : ''); setOpen(false)
  }

  return (
    <div ref={acRef} className="project-picker">
      <input type="text" className="list-search" placeholder={placeholder} value={input}
        onChange={e => { setInput(e.target.value); setOpen(true) }}
        onFocus={e => { setOpen(true); e.currentTarget.select() }}
        onKeyDown={e => {
          if (e.key === 'Enter') { if (filtered[0]) pick(filtered[0].ID); e.preventDefault() }
          if (e.key === 'Escape') { setOpen(false); setInput(selectedName) }
        }} />
      {open && (
        <div className="project-ac-dropdown">
          {filtered.length === 0 && <div className="project-ac-empty">Keine Mitarbeiter gefunden</div>}
          {filtered.slice(0, 50).map(e => (
            <button key={e.ID} type="button"
              className={`project-ac-option${e.ID === selectedId ? ' active' : ''}`}
              onMouseDown={ev => { ev.preventDefault(); pick(e.ID) }}>
              <span className="project-ac-short">{e.ABBR}</span>
              <span className="project-ac-long">{e.FIRST_NAME} {e.LAST_NAME}{e.ACTIVE === 2 ? ' (inaktiv)' : ''}</span>
            </button>
          ))}
          {onGoToList && (
            <button type="button" className="project-ac-tolist"
              onMouseDown={ev => { ev.preventDefault(); setOpen(false); onGoToList() }}>
              Zur Mitarbeiterliste <ArrowRight size={13} strokeWidth={2} aria-hidden="true" style={{ verticalAlign: -2 }} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

type ZwSub = 'list' | 'single' | 'close'

function ZeitwirtschaftTab({ employees, onGoToList }: { employees: Employee[]; onGoToList?: () => void }) {
  const canCloseMonths = usePermission('employees.month_close.edit')
  const hasMonthClose  = useFeature('employees.month_close')
  const canViewAll     = usePermission('employees.bookings.view_all')
  const showClose      = canCloseMonths && hasMonthClose

  // Auswertung und Einzelansicht lesen fremde Stunden. Wer nur Monate
  // abschließen darf, sah vorher als Erstes eine Auswertung, die mit
  // „Fehlende Berechtigung" endete (Runde 10).
  const items: { id: ZwSub; label: string }[] = [
    ...(canViewAll ? [{ id: 'list' as ZwSub, label: 'Auswertung' }, { id: 'single' as ZwSub, label: 'Einzelne/r Mitarbeiter' }] : []),
    ...(showClose  ? [{ id: 'close' as ZwSub, label: 'Monatsabschluss' }] : []),
  ]
  const [picked, setSubTab] = useState<ZwSub | null>(null)
  const subTab: ZwSub = picked && items.some(i => i.id === picked) ? picked : (items[0]?.id ?? 'list')
  const [empId,  setEmpId]  = useState<number | null>(null)

  return (
    <div>
      <SegmentNav items={items} active={subTab} onChange={setSubTab} />

      {!items.length && <p className="empty-note">Für das Stundencontrolling fehlt das Recht „Alle Buchungen sehen" — oder der Monatsabschluss ist im Tarif nicht enthalten.</p>}
      {subTab === 'list' && canViewAll && <EmployeeListReport employees={employees} />}

      {subTab === 'single' && canViewAll && (
        <div style={{ maxWidth: 760 }}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Mitarbeiter</label>
            <div style={{ maxWidth: 360 }}>
              <MitarbeiterPicker employees={employees} selectedId={empId} onSelect={setEmpId} onGoToList={onGoToList} />
            </div>
          </div>

          {!empId && (
            <p className="empty-note">Mitarbeiter auswählen, um das Reporting anzuzeigen.</p>
          )}
          {empId && <EmployeeTimeAccount empId={empId} />}
        </div>
      )}

      {subTab === 'close' && showClose && <MonthsOverviewTab />}
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
            <th scope="col" style={{ textAlign: 'left', paddingRight: 16, whiteSpace: 'nowrap' }}>Mitarbeiter</th>
            {months.map(m => {
              const open = openInColumn(m.year, m.month)
              return (
                <th scope="col" key={`${m.year}-${m.month}`} style={{ textAlign: 'center', whiteSpace: 'nowrap', fontWeight: 500, color: 'var(--text-3)' }}>
                  {MONTH_NAMES[m.month - 1].slice(0, 3)}<br />{m.year}
                  <div style={{ marginTop: 3, minHeight: 18 }}>
                    {open > 0 && (
                      <button
                        type="button"
                        className="btn-small"
                        style={{ fontSize: 11, padding: '0 6px' }}
                        disabled={busy}
                        title={`${open} offene Einträge für ${MONTH_NAMES[m.month - 1]} ${m.year} abschließen`}
                        onClick={() => askCloseColumn(m.year, m.month)}
                      >
                        alle abschließen
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
                <strong>{emp.ABBR}</strong> {emp.FIRST_NAME} {emp.LAST_NAME}
              </td>
              {emp.months.map(m => (
                <td key={`${m.year}-${m.month}`} style={{ textAlign: 'center', padding: '4px 8px' }}>
                  <button
                    type="button"
                    disabled={busy}
                    title={m.closed
                      ? `Abgeschlossen am ${new Date(m.closed_at!).toLocaleDateString('de-DE')} – klicken zum Öffnen`
                      : 'Offen – klicken zum Abschließen'}
                    className={`mc-cell${m.closed ? ' mc-cell--closed' : ''}`}
                    aria-label={`${emp.ABBR} ${MONTH_NAMES[m.month - 1]} ${m.year}: ${m.closed ? 'abgeschlossen' : 'offen'}`}
                    onClick={() => toggle(emp, m.year, m.month, m.closed)}
                  >
                    {m.closed
                      ? <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
                      : <Circle size={18} strokeWidth={1.75} aria-hidden="true" />}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="mc-legend">
        <span><CircleCheck size={13} strokeWidth={2} aria-hidden="true" className="mc-legend-closed" /> abgeschlossen</span>
        <span><Circle size={13} strokeWidth={1.75} aria-hidden="true" /> offen</span>
        <span>Eine Zelle umschalten per Klick · „alle abschließen" schließt eine ganze Monatsspalte ab</span>
      </p>

      <ConfirmModal
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel="Abschließen"
        confirmClass="btn-primary"
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
    INFO:  { background: 'rgba(59,130,246,0.12)',  color: 'var(--info)' },
    WARN:  { background: 'rgba(245,158,11,0.15)',  color: 'var(--warning-strong)' },
    BLOCK: { background: 'rgba(220,38,38,0.13)',   color: 'var(--danger-strong)' },
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
    return localIso(d)
  })
  const [dateTo,   setDateTo]   = useState<string>(todayLocal)
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
        event_type:  evtType  || undefined,
        severity:    sev      || undefined,
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
          {employees.map(e => <option key={e.ID} value={e.ID}>{e.ABBR} – {e.FIRST_NAME} {e.LAST_NAME}</option>)}
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
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
          {EVENT_TYPES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
        <select value={sev} onChange={e => setSev(e.target.value as '' | ArbzgSeverity)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
          {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button type="button" className="btn-small btn-save"
          style={{ marginLeft: 'auto' }} onClick={handleExport}>
          ↓ CSV-Export
        </button>
      </div>

      {warning && (
        <p className="ta-note" style={{ marginBottom: 12 }}>
          <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />{warning}
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
                <th scope="col">Mitarbeiter</th>
                <th scope="col">Datum</th>
                <th scope="col">Ereignis</th>
                <th scope="col">Schwere</th>
                <th scope="col">Details</th>
                <th scope="col">Erfasst</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const emp = empMap.get(r.EMPLOYEE_ID)
                return (
                  <tr key={r.ID}>
                    <td>
                      <strong>{emp?.ABBR ?? `#${r.EMPLOYEE_ID}`}</strong>
                      {emp && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)' }}>
                        {emp.FIRST_NAME} {emp.LAST_NAME}
                      </span>}
                    </td>
                    <td>{fmtDate(r.BOOKING_DATE)}</td>
                    <td>{EVENT_LABEL[r.EVENT_TYPE] ?? r.EVENT_TYPE}</td>
                    <td>{sevBadge(r.SEVERITY)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{fmtDetails(r.DETAILS || {})}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
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
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
          {rows.length} Einträge · limitiert auf 1.000 — bei mehr Treffern Filter verfeinern.
        </p>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function MitarbeiterPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState(() => searchParams.get('tab') || 'list')

  // Die Liste braucht employees.view. Nutzer, die nur eigene Abwesenheiten
  // beantragen (absence.request), erreichen die Seite ebenfalls — für sie
  // gaten wir ab, sonst lösen die 403 den globalen Fehler-Toast aus.
  const canViewEmployees = usePermission('employees.view')
  const { data: listData, isLoading } = useQuery({ queryKey: ['employees'], queryFn: fetchEmployeeList, enabled: canViewEmployees })
  const employees = listData?.data ?? []

  const visibleTabs = useLicenseFilterTabs(useFilterTabs(TABS))
  // Aktuellen Tab an verfügbare Tabs + ?tab=-Deeplink angleichen.
  useEffect(() => {
    if (!visibleTabs.length) return
    const urlTab = searchParams.get('tab')
    if (urlTab && visibleTabs.some(t => t.id === urlTab)) { setTab(urlTab); return }
    setTab(cur => (visibleTabs.some(t => t.id === cur) ? cur : visibleTabs[0].id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTabs.map(t => t.id).join(','), searchParams])
  function changeTab(t: string) {
    setTab(t)
    const p = new URLSearchParams(searchParams)
    if (t === 'list') p.delete('tab'); else p.set('tab', t)
    setSearchParams(p, { replace: true })
  }

  return (
    <div className="master-page">
      <h1 className="sr-only">Mitarbeiter</h1>
      <Tabs tabs={visibleTabs} active={tab} onChange={changeTab} />

      <div className="master-section">
        {tab === 'list' && <MitarbeiterListe employees={employees} isLoading={isLoading} />}

        {tab === 'zeitwirtschaft' && (
          <ZeitwirtschaftTab employees={employees} onGoToList={() => changeTab('list')} />
        )}

        {tab === 'abwesenheiten' && (
          <AbwesenheitenTab employees={employees} />
        )}

        {tab === 'arbzg' && (
          <ArbzgAuditTab employees={employees} />
        )}
      </div>
    </div>
  )
}
