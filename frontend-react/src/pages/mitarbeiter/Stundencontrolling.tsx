import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Circle, CircleCheck, Download } from 'lucide-react'
import { ListLoading } from '@/components/ui/Skeleton'
import { SortTh } from '@/components/ui/SortTh'
import { FilterBar } from '@/components/ui/FilterBar'
import { FilterChip } from '@/components/ui/FilterChip'
import { HelpHint } from '@/components/ui/HelpHint'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { RecentList } from '@/components/recents/RecentList'
import type { HelpId } from '@/help/helpContent'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useStickySet, useStickyState } from '@/hooks/useStickyState'
import { useTrackFilterRecent } from '@/hooks/useTrackFilterRecent'
import { usePermission } from '@/store/permissionsStore'
import { useFeature } from '@/store/licenseStore'
import { useToast } from '@/store/toastStore'
import {
  closeMonth, reopenMonth, fetchMonthCloseOverview, fetchEmployeeReportList,
  type Employee, type EmployeeReportRow, type MonthCloseOverviewEmployee,
} from '@/api/mitarbeiter'
import { fmtEur, NO_VALUE } from '@/utils/money'
import { fmtH, fmtBalance, fmtDateShort, localIso, todayLocal } from './mitarbeiterFormat'
import { mitarbeiterHref } from './mitarbeiterUrl'
import { SegmentNav } from './SegmentNav'
import { EmployeeTimeAccount } from './EmployeeTimeAccount'

/**
 * Reiter „Stundencontrolling" im Modul Mitarbeiter (UI-Pilot Runde 11):
 * Auswertung, einzelne/r Mitarbeiter, Monatsabschluss.
 *
 * Unterreiter und gewählter Mitarbeiter stehen in der URL
 * (`?tab=zeitwirtschaft&sub=single&emp=2`) — vorher fing jeder Besuch wieder
 * bei der Auswertung an, und ein Link auf ein Zeitkonto ging nicht.
 */

type ScSub = 'list' | 'single' | 'close'
const SC_SUBS: ScSub[] = ['list', 'single', 'close']
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

export function Stundencontrolling({ employees, onGoToList }: { employees: Employee[]; onGoToList?: () => void }) {
  const [params, setParams] = useSearchParams()
  const canCloseMonths = usePermission('employees.month_close.edit')
  const hasMonthClose  = useFeature('employees.month_close')
  const canViewAll     = usePermission('employees.bookings.view_all')
  const showClose      = canCloseMonths && hasMonthClose

  // Auswertung und Einzelansicht lesen fremde Stunden (Runde 10).
  const items: { id: ScSub; label: string }[] = [
    ...(canViewAll ? [{ id: 'list' as ScSub, label: 'Auswertung' }, { id: 'single' as ScSub, label: 'Einzelne/r Mitarbeiter' }] : []),
    ...(showClose  ? [{ id: 'close' as ScSub, label: 'Monatsabschluss' }] : []),
  ]
  const raw = params.get('sub') as ScSub | null
  const sub: ScSub = raw && SC_SUBS.includes(raw) && items.some(i => i.id === raw) ? raw : (items[0]?.id ?? 'list')
  const empId = Number(params.get('emp')) || null

  function patch(next: Record<string, string | null>) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) { if (v == null) p.delete(k); else p.set(k, v) }
    setParams(p, { replace: true })
  }

  if (!items.length) return <p className="empty-note">Für das Stundencontrolling fehlt das Recht „Alle Buchungen sehen" — oder der Monatsabschluss ist im Tarif nicht enthalten.</p>

  return (
    <div>
      <SegmentNav items={items} active={sub} onChange={s => patch({ sub: s === 'list' ? null : s })} />
      {sub === 'list' && <StundenAuswertung employees={employees} />}
      {sub === 'single' && (
        <div className="sc-single">
          <div className="form-group sc-picker">
            <label htmlFor="sc-emp">Mitarbeiter</label>
            <MitarbeiterPicker id="sc-emp" employees={employees} selectedId={empId} onSelect={id => patch({ emp: String(id) })} onGoToList={onGoToList} />
          </div>
          {!empId && <p className="empty-note">Mitarbeiter wählen, um sein Zeitkonto zu sehen — Soll, Ist und Saldo je Tag, mit den Buchungen dahinter.</p>}
          {empId && <EmployeeTimeAccount key={empId} empId={empId} />}
        </div>
      )}
      {sub === 'close' && <Monatsabschluss />}
    </div>
  )
}

// ── Mitarbeiter-Suchbox ──────────────────────────────────────────────────────
// Tippen filtert, optional Sprung „Zur Mitarbeiterliste". Nutzt die
// project-picker-Styles.
function MitarbeiterPicker({ id, employees, selectedId, onSelect, onGoToList }: {
  id: string; employees: Employee[]; selectedId: number | null; onSelect: (id: number) => void; onGoToList?: () => void
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

  function pick(eid: number) {
    onSelect(eid)
    const e = employees.find(x => x.ID === eid)
    setInput(e ? nameOf(e) : ''); setOpen(false)
  }

  return (
    <div ref={acRef} className="project-picker">
      <input id={id} type="text" className="list-search" placeholder="Mitarbeiter suchen …" value={input} autoComplete="off"
        onChange={e => { setInput(e.target.value); setOpen(true) }}
        onFocus={e => { setOpen(true); e.currentTarget.select() }}
        onKeyDown={e => {
          if (e.key === 'Enter') { if (filtered[0]) pick(filtered[0].ID); e.preventDefault() }
          if (e.key === 'Escape') { setOpen(false); setInput(selectedName) }
        }} />
      {open && (
        <div className="project-ac-dropdown">
          {filtered.length === 0 && <div className="project-ac-empty">Kein Mitarbeiter gefunden</div>}
          {filtered.slice(0, 50).map(e => (
            <button key={e.ID} type="button"
              className={`project-ac-option${e.ID === selectedId ? ' active' : ''}`}
              onMouseDown={ev => { ev.preventDefault(); pick(e.ID) }}>
              <span className="project-ac-short">{e.ABBR}</span>
              <span className="project-ac-long">{e.FIRST_NAME} {e.LAST_NAME}{e.ACTIVE === 2 ? ' (inaktiv)' : ''}</span>
            </button>
          ))}
          {onGoToList && (
            <button type="button" className="project-ac-tolist" onMouseDown={ev => { ev.preventDefault(); setOpen(false); onGoToList() }}>
              Zur Mitarbeiterliste <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Auswertung ───────────────────────────────────────────────────────────────

type Mode = 'now' | 'as_of' | 'period'
type SortKey = 'ABBR' | 'LAST_NAME' | 'DEPARTMENT_NAME' | 'REQUIRED' | 'ACTUAL' | 'BALANCE' | 'RUNNING_BALANCE' | 'COST' | 'PRODUCTIVITY_PCT'
const SORT_KEYS: SortKey[] = ['ABBR', 'LAST_NAME', 'DEPARTMENT_NAME', 'REQUIRED', 'ACTUAL', 'BALANCE', 'RUNNING_BALANCE', 'COST', 'PRODUCTIVITY_PCT']

const r2 = (n: number) => Math.round(n * 100) / 100
const sum = (rows: EmployeeReportRow[], fn: (r: EmployeeReportRow) => number) => r2(rows.reduce((s, r) => s + fn(r), 0))
const pct = (n: number | null) => (n == null ? NO_VALUE : `${n.toFixed(1).replace('.', ',')} %`)
function Bal({ n }: { n: number | null | undefined }) {
  if (n == null) return <span className="ma-none">{NO_VALUE}</span>
  return <span className={n < 0 ? 'ma-balance-neg' : 'ma-balance'}>{fmtBalance(n)}</span>
}

// CSV-Export (clientseitig): deutsches Excel-Format (Semikolon, UTF-8-BOM).
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const body = rows.map(r => r.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xFEFF) + body], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

function lastMonthEnd() { const d = new Date(); d.setDate(0); return localIso(d) }

/** Spaltenkopf mit Hilfe — der Klick auf das „i" sortiert nicht mit. */
function withHelp(label: string, id: HelpId) {
  return <>{label}<span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}><HelpHint id={id} align="right" /></span></>
}

function StundenAuswertung({ employees }: { employees: Employee[] }) {
  const narrow = useIsNarrow()
  const canSalary = usePermission('employees.salary.view')
  const canOpenEmployee = usePermission('employees.view')
  const [mode, setMode] = useState<Mode>('now')
  const [asOfDate, setAsOfDate] = useState(lastMonthEnd)
  const [dateFrom, setDateFrom] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [dateTo, setDateTo]     = useState(todayLocal)
  const [search, setSearch] = useState('')
  const [dept, setDept]     = useStickySet('mitarbeiter.report.dept')
  const [status, setStatus] = useStickySet('mitarbeiter.report.status')
  const [model, setModel]   = useStickySet('mitarbeiter.report.model')
  const [sort, setSort] = useStickyState<{ key: SortKey; dir: 'asc' | 'desc' }>('mitarbeiter.report.sort', { key: 'ABBR', dir: 'asc' })
  const sortKey: SortKey = SORT_KEYS.includes(sort.key) ? sort.key : 'ABBR'
  const onSort = (k: SortKey) => setSort(s => ({ key: k, dir: s.key === k && s.dir === 'asc' ? 'desc' : 'asc' }))
  const sortProps = { sortKey, dir: sort.dir, onSort }

  const empMap = useMemo(() => new Map(employees.map(e => [e.ID, e])), [employees])
  const filterReady = mode === 'now' || (mode === 'as_of' && !!asOfDate) || (mode === 'period' && !!dateFrom && !!dateTo && dateTo >= dateFrom)
  const isPeriod = mode === 'period'

  // Zuletzt verwendete Filter
  const snapshot = useMemo(() => ({ mode, asOfDate, dateFrom, dateTo, dept: [...dept].sort(), status: [...status].sort(), model: [...model].sort() }),
    [mode, asOfDate, dateFrom, dateTo, dept, status, model])
  const recentLabel = useMemo(() => {
    const parts: string[] = []
    if (mode === 'as_of')  parts.push(`Stichtag ${fmtDateShort(asOfDate)}`)
    if (mode === 'period') parts.push(`${fmtDateShort(dateFrom)} – ${fmtDateShort(dateTo)}`)
    if (mode === 'now')    parts.push('Aktueller Monat')
    if (dept.size)   parts.push(`Abt.: ${[...dept].slice(0, 2).join(', ')}${dept.size > 2 ? ` +${dept.size - 2}` : ''}`)
    if (status.size) parts.push(`Status: ${[...status].join(', ')}`)
    if (model.size)  parts.push(`Modell: ${[...model].slice(0, 2).join(', ')}${model.size > 2 ? ` +${model.size - 2}` : ''}`)
    return parts.join(' · ')
  }, [mode, asOfDate, dateFrom, dateTo, dept, status, model])
  useTrackFilterRecent('mitarbeiter_report_filter', snapshot, recentLabel, filterReady && (mode !== 'now' || dept.size > 0 || model.size > 0))
  function applyRecent(meta: Record<string, unknown> | null) {
    if (!meta) return
    if (meta.mode === 'now' || meta.mode === 'as_of' || meta.mode === 'period') setMode(meta.mode)
    if (typeof meta.asOfDate === 'string' && meta.asOfDate) setAsOfDate(meta.asOfDate)
    if (typeof meta.dateFrom === 'string' && meta.dateFrom) setDateFrom(meta.dateFrom)
    if (typeof meta.dateTo   === 'string' && meta.dateTo)   setDateTo(meta.dateTo)
    if (Array.isArray(meta.dept))   setDept(new Set(meta.dept as string[]))
    if (Array.isArray(meta.status)) setStatus(new Set(meta.status as string[]))
    if (Array.isArray(meta.model))  setModel(new Set(meta.model as string[]))
  }

  const qparams = filterReady ? {
    mode,
    asOfDate: mode === 'as_of'  ? asOfDate : undefined,
    dateFrom: mode === 'period' ? dateFrom : undefined,
    dateTo:   mode === 'period' ? dateTo   : undefined,
  } : null
  const { data, isLoading } = useQuery({
    queryKey: ['emp-report-list', qparams],
    queryFn:  () => fetchEmployeeReportList(qparams!),
    enabled:  filterReady,
  })
  const allRows = useMemo(() => data?.data ?? [], [data])

  const options = useMemo(() => ({
    dept:   [...new Set(allRows.map(r => r.DEPARTMENT_NAME).filter(Boolean))].sort(),
    status: ['Aktiv', 'Inaktiv'],
    model:  [...new Set(employees.map(e => e.CURRENT_MODEL_NAME).filter(Boolean) as string[])].sort(),
  }), [allRows, employees])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allRows.filter(r => {
      const emp = empMap.get(r.EMPLOYEE_ID)
      if (q && ![r.ABBR, r.FIRST_NAME, r.LAST_NAME, r.DEPARTMENT_NAME].some(v => (v || '').toLowerCase().includes(q))) return false
      if (dept.size && !dept.has(r.DEPARTMENT_NAME)) return false
      if (status.size && !status.has(emp?.ACTIVE === 2 ? 'Inaktiv' : 'Aktiv')) return false
      if (model.size && !model.has(emp?.CURRENT_MODEL_NAME ?? '')) return false
      return true
    })
  }, [allRows, search, dept, status, model, empMap])

  const sorted = useMemo(() => {
    const val = (r: EmployeeReportRow): string | number => {
      const v = r[sortKey as keyof EmployeeReportRow]
      return typeof v === 'number' ? v : (v ?? '') as string
    }
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b)
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'de')
      return c * sign || a.ABBR.localeCompare(b.ABBR)
    })
  }, [filtered, sortKey, sort.dir])

  const activeCount = dept.size + status.size + model.size
  const reset = () => { setSearch(''); setDept(new Set()); setStatus(new Set()); setModel(new Set()) }
  const empCount = (rows: EmployeeReportRow[]) => new Set(rows.map(r => r.EMPLOYEE_ID)).size

  function exportCsv() {
    const num = (n: number) => n.toFixed(2).replace('.', ',')
    const head = ['Kürzel', 'Vorname', 'Nachname', 'Abteilung', ...(isPeriod ? ['Jahr', 'Monat'] : []), 'Soll (h)', 'Ist (h)', 'Monatssaldo (h)',
      ...(isPeriod ? [] : ['Laufender Saldo (h)']), ...(canSalary ? ['Kosten (EUR)'] : []), 'Produktivität (%)']
    const rows: (string | number)[][] = [head]
    const src = isPeriod ? [...filtered].sort((a, b) => a.ABBR.localeCompare(b.ABBR) || a.YEAR - b.YEAR || a.MONTH - b.MONTH) : sorted
    for (const r of src) {
      rows.push([r.ABBR, r.FIRST_NAME, r.LAST_NAME, r.DEPARTMENT_NAME || '', ...(isPeriod ? [r.YEAR, r.MONTH] : []),
        num(r.REQUIRED), num(r.ACTUAL), num(r.BALANCE), ...(isPeriod ? [] : [r.RUNNING_BALANCE != null ? num(r.RUNNING_BALANCE) : '']),
        ...(canSalary ? [r.COST > 0 ? num(r.COST) : ''] : []), r.PRODUCTIVITY_PCT != null ? num(r.PRODUCTIVITY_PCT) : ''])
    }
    downloadCsv(`stundencontrolling_${mode === 'period' ? `${dateFrom}_bis_${dateTo}` : mode === 'as_of' ? asOfDate : todayLocal()}.csv`, rows)
  }

  const nameCell = (r: EmployeeReportRow) => canOpenEmployee
    ? <Link to={mitarbeiterHref(r.EMPLOYEE_ID, 'zeitkonto')} className="ad-row-link" title="Zeitkonto öffnen">{r.FIRST_NAME} {r.LAST_NAME}</Link>
    : <>{r.FIRST_NAME} {r.LAST_NAME}</>
  const cost = (n: number) => (n > 0 ? fmtEur(n) : <span className="ma-none">{NO_VALUE}</span>)

  let body: ReactNode
  if (!filterReady) body = <p className="empty-note">{mode === 'period' && dateTo < dateFrom ? '„Bis" liegt vor „Von".' : 'Bitte ein Datum wählen.'}</p>
  else if (isLoading) body = <ListLoading columns={6} />
  else if (!allRows.length) body = (
    <div className="empty-block">
      <p className="empty-note">Für diesen Zeitraum gibt es keine Stunden.</p>
      <p className="empty-block-why">Die Auswertung stellt Soll und Ist je Mitarbeiter gegenüber. Soll gibt es nur mit einem Arbeitszeitmodell — das steht auf der Seite des Mitarbeiters unter „Arbeitszeit".</p>
    </div>
  )
  else if (!filtered.length) body = (
    <div className="empty-block">
      <p className="empty-note">Kein Mitarbeiter passt zu Suche und Filter.</p>
      <button type="button" className="btn-secondary" onClick={reset}>Suche und Filter zurücksetzen</button>
    </div>
  )
  else if (!isPeriod && narrow) body = (
    <ul className="ad-cards" aria-label="Stunden je Mitarbeiter">
      {sorted.map(r => (
        <li key={r.EMPLOYEE_ID} className="ad-card">
          <div className="ad-card-main">
            <span className="ad-card-name">{nameCell(r)}</span>
            <span className="ad-card-sub">{[r.ABBR, r.DEPARTMENT_NAME].filter(Boolean).join(' · ')}</span>
          </div>
          <dl className="sc-figs">
            <div><dt>Soll</dt><dd>{fmtH(r.REQUIRED)}</dd></div>
            <div><dt>Ist</dt><dd>{fmtH(r.ACTUAL)}</dd></div>
            <div><dt>Monat</dt><dd><Bal n={r.BALANCE} /></dd></div>
            <div><dt>Laufend</dt><dd><Bal n={r.RUNNING_BALANCE} /></dd></div>
          </dl>
        </li>
      ))}
    </ul>
  )
  else if (!isPeriod) body = (
    <div className="table-scroll">
      <table className="master-table sc-table">
        <thead>
          <tr>
            <SortTh label="Kürzel"    column="ABBR"            {...sortProps} />
            <SortTh label="Name"      column="LAST_NAME"       {...sortProps} />
            <SortTh label="Abteilung" column="DEPARTMENT_NAME" {...sortProps} />
            <SortTh label="Soll"      column="REQUIRED"        {...sortProps} className="num" />
            <SortTh label="Ist"       column="ACTUAL"          {...sortProps} className="num" />
            <SortTh label={withHelp('Monatssaldo', 'mitarbeiter.saldo')} column="BALANCE" {...sortProps} className="num" />
            <SortTh label={withHelp('Laufender Saldo', 'mitarbeiter.saldo_laufend')} column="RUNNING_BALANCE" {...sortProps} className="num" />
            {canSalary && <SortTh label="Kosten" column="COST" {...sortProps} className="num" />}
            <SortTh label={withHelp('Produktivität', 'mitarbeiter.produktivitaet')} column="PRODUCTIVITY_PCT" {...sortProps} className="num" />
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.EMPLOYEE_ID}>
              <td><strong>{r.ABBR}</strong></td>
              <td className="ma-name">{nameCell(r)}</td>
              <td>{r.DEPARTMENT_NAME || <span className="ma-none">{NO_VALUE}</span>}</td>
              <td className="num">{fmtH(r.REQUIRED)}</td>
              <td className="num">{fmtH(r.ACTUAL)}</td>
              <td className="num"><Bal n={r.BALANCE} /></td>
              <td className="num"><Bal n={r.RUNNING_BALANCE} /></td>
              {canSalary && <td className="num">{cost(r.COST)}</td>}
              <td className="num">{pct(r.PRODUCTIVITY_PCT)}</td>
            </tr>
          ))}
        </tbody>
        {sorted.length > 1 && (
          <tfoot>
            <tr className="sum-row">
              <td colSpan={3}>Summe ({sorted.length} Mitarbeiter)</td>
              <td className="num">{fmtH(sum(sorted, r => r.REQUIRED))}</td>
              <td className="num">{fmtH(sum(sorted, r => r.ACTUAL))}</td>
              <td className="num"><Bal n={sum(sorted, r => r.BALANCE)} /></td>
              <td className="num"><Bal n={sum(sorted, r => r.RUNNING_BALANCE ?? 0)} /></td>
              {canSalary && <td className="num">{cost(sum(sorted, r => r.COST))}</td>}
              <td className="num"><span className="ma-none">{NO_VALUE}</span></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
  else {
    const byEmp = new Map<number, EmployeeReportRow[]>()
    for (const r of filtered) { if (!byEmp.has(r.EMPLOYEE_ID)) byEmp.set(r.EMPLOYEE_ID, []); byEmp.get(r.EMPLOYEE_ID)!.push(r) }
    const groups = [...byEmp.values()].sort((a, b) => a[0].ABBR.localeCompare(b[0].ABBR))
    body = (
      <div className="table-scroll">
        <table className="master-table sc-table">
          <thead>
            <tr>
              <th scope="col">Mitarbeiter</th>
              <th scope="col">Monat</th>
              <th scope="col" className="num">Soll</th>
              <th scope="col" className="num">Ist</th>
              <th scope="col" className="num">Monatssaldo</th>
              <th scope="col" className="num">Saldo im Zeitraum<HelpHint id="mitarbeiter.saldo_laufend" align="right" /></th>
              {canSalary && <th scope="col" className="num">Kosten</th>}
              <th scope="col" className="num">Produktivität</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(rows => {
              const ordered = [...rows].sort((a, b) => a.YEAR - b.YEAR || a.MONTH - b.MONTH)
              let cum = 0
              return (
                <Fragment key={rows[0].EMPLOYEE_ID}>
                  {ordered.map((r, i) => {
                    cum = r2(cum + r.BALANCE)
                    return (
                      <tr key={`${r.YEAR}-${r.MONTH}`}>
                        {i === 0 && (
                          <th scope="rowgroup" rowSpan={ordered.length} className="sc-group">
                            <strong>{r.ABBR}</strong><span className="sc-group-sub">{nameCell(r)}</span>
                          </th>
                        )}
                        <td>{MONTH_NAMES[r.MONTH - 1]} {r.YEAR}</td>
                        <td className="num">{fmtH(r.REQUIRED)}</td>
                        <td className="num">{fmtH(r.ACTUAL)}</td>
                        <td className="num"><Bal n={r.BALANCE} /></td>
                        <td className="num"><Bal n={cum} /></td>
                        {canSalary && <td className="num">{cost(r.COST)}</td>}
                        <td className="num">{pct(r.PRODUCTIVITY_PCT)}</td>
                      </tr>
                    )
                  })}
                  <tr className="sum-row sc-group-sum">
                    <td colSpan={2}>Summe {rows[0].ABBR}</td>
                    <td className="num">{fmtH(sum(rows, r => r.REQUIRED))}</td>
                    <td className="num">{fmtH(sum(rows, r => r.ACTUAL))}</td>
                    <td className="num"><Bal n={sum(rows, r => r.BALANCE)} /></td>
                    <td className="num"><span className="ma-none">{NO_VALUE}</span></td>
                    {canSalary && <td className="num">{cost(sum(rows, r => r.COST))}</td>}
                    <td className="num"><span className="ma-none">{NO_VALUE}</span></td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
          {groups.length > 1 && (
            <tfoot>
              <tr className="sum-row">
                <td colSpan={2}>Gesamt ({groups.length} Mitarbeiter)</td>
                <td className="num">{fmtH(sum(filtered, r => r.REQUIRED))}</td>
                <td className="num">{fmtH(sum(filtered, r => r.ACTUAL))}</td>
                <td className="num"><Bal n={sum(filtered, r => r.BALANCE)} /></td>
                <td className="num"><span className="ma-none">{NO_VALUE}</span></td>
                {canSalary && <td className="num">{cost(sum(filtered, r => r.COST))}</td>}
                <td className="num"><span className="ma-none">{NO_VALUE}</span></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    )
  }

  return (
    <div>
      <RecentList type="mitarbeiter_report_filter" title="Zuletzt verwendete Filter" onSelect={e => applyRecent(e.META)} />
      <div className="daten-filter-bar" role="group" aria-label="Zeitraum">
        <div className="daten-filter-modes">
          {(['now', 'as_of', 'period'] as Mode[]).map(m => (
            <label key={m} className={`daten-filter-mode-btn${mode === m ? ' active' : ''}`}>
              <input type="radio" name="scMode" value={m} checked={mode === m} onChange={() => setMode(m)} />
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
            <label>Bis <input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} /></label>
          </div>
        )}
      </div>

      <div className="list-toolbar">
        <input type="search" className="list-search" placeholder="Suchen …" aria-label="Mitarbeiter in der Auswertung suchen"
          value={search} onChange={e => setSearch(e.target.value)} />
        {filterReady && !isLoading && allRows.length > 0 && (
          <span className="list-info">
            {filtered.length !== allRows.length ? `${empCount(filtered)} von ${empCount(allRows)} Mitarbeitern` : `${empCount(allRows)} Mitarbeiter`}
          </span>
        )}
        <button type="button" className="btn-secondary btn-small sc-export" disabled={!filtered.length || !filterReady} onClick={exportCsv}
          title="Gefilterte Auswertung als CSV (Excel) exportieren">
          <Download size={13} strokeWidth={2} aria-hidden="true" /> CSV-Export
        </button>
      </div>
      <FilterBar activeCount={activeCount} onReset={reset}>
        <FilterChip label="Abteilung" options={options.dept}   active={dept}   onChange={setDept} />
        <FilterChip label="Status"    options={options.status} active={status} onChange={setStatus} />
        <FilterChip label="Modell"    options={options.model}  active={model}  onChange={setModel} />
      </FilterBar>

      {body}
    </div>
  )
}

// ── Monatsabschluss ──────────────────────────────────────────────────────────

type Target = { empId: number; year: number; month: number }

function Monatsabschluss() {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<{ title: string; message: string; label: string; run: () => Promise<void> } | null>(null)
  const { data, isLoading } = useQuery({ queryKey: ['month-close-overview'], queryFn: fetchMonthCloseOverview })
  const rows: MonthCloseOverviewEmployee[] = data?.data ?? []
  const months = data?.months ?? []
  const monthLabel = (y: number, m: number) => `${MONTH_NAMES[m - 1]} ${y}`

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['month-close-overview'] })
    void qc.invalidateQueries({ queryKey: ['month-close-status'] })
  }
  async function run(targets: Target[], action: 'close' | 'reopen') {
    setBusy(true)
    let done = 0
    try {
      for (const t of targets) { await (action === 'close' ? closeMonth : reopenMonth)(t.empId, t.year, t.month); done++ }
      toast.success(action === 'close' ? `${done} ${done === 1 ? 'Monat' : 'Monate'} abgeschlossen.` : 'Monat wieder geöffnet.')
    } catch (e) {
      toast.error(`${(e as Error).message}${done ? ` — ${done} von ${targets.length} erledigt.` : ''}`)
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const open = (filter: (e: MonthCloseOverviewEmployee, m: MonthCloseOverviewEmployee['months'][number]) => boolean): Target[] =>
    rows.flatMap(e => e.months.filter(m => !m.closed && filter(e, m)).map(m => ({ empId: e.ID, year: m.year, month: m.month })))
  const openTotal = open(() => true).length

  function toggle(e: MonthCloseOverviewEmployee, year: number, month: number, closed: boolean) {
    if (!closed) { void run([{ empId: e.ID, year, month }], 'close'); return }
    // Öffnen gibt Buchungen wieder frei — deshalb mit Rückfrage.
    setAsk({
      title: `${monthLabel(year, month)} für ${e.ABBR} öffnen?`,
      message: `Danach lassen sich Buchungen von ${e.FIRST_NAME} ${e.LAST_NAME} in diesem Monat wieder ändern und löschen. Auswertungen des Monats können sich dadurch noch ändern.`,
      label: 'Öffnen',
      run: () => run([{ empId: e.ID, year, month }], 'reopen'),
    })
  }
  function askAll(targets: Target[], title: string) {
    if (!targets.length) return
    setAsk({ title, message: `${targets.length} ${targets.length === 1 ? 'offener Monat wird' : 'offene Monate werden'} abgeschlossen. Buchungen darin lassen sich danach nicht mehr ändern.`, label: 'Abschließen', run: () => run(targets, 'close') })
  }

  if (isLoading) return <ListLoading columns={5} />
  if (!rows.length) return <p className="empty-note">Keine aktiven Mitarbeiter.</p>

  return (
    <div>
      <div className="sc-close-head">
        <span className="list-info">{openTotal === 0 ? 'Alle Monate abgeschlossen' : `${openTotal} ${openTotal === 1 ? 'offener Monat' : 'offene Monate'}`}<HelpHint id="mitarbeiter.monatsabschluss" /></span>
        <button type="button" className="btn-primary btn-small" disabled={busy || openTotal === 0} onClick={() => askAll(open(() => true), 'Alle offenen Monate abschließen?')}>
          {busy ? 'Schließt ab …' : 'Alle offenen abschließen'}
        </button>
      </div>
      <div className="table-scroll">
        <table className="master-table sc-close-table">
          <thead>
            <tr>
              <th scope="col">Mitarbeiter</th>
              {months.map(m => {
                const n = open((_e, x) => x.year === m.year && x.month === m.month).length
                return (
                  <th scope="col" key={`${m.year}-${m.month}`} className="sc-close-month">
                    <span>{MONTH_NAMES[m.month - 1].slice(0, 3)} {m.year}</span>
                    {n > 0 && (
                      <button type="button" className="btn-secondary btn-small sc-close-col" disabled={busy}
                        aria-label={`${monthLabel(m.year, m.month)}: ${n} offene abschließen`}
                        onClick={() => askAll(open((_e, x) => x.year === m.year && x.month === m.month), `${monthLabel(m.year, m.month)} abschließen?`)}>
                        {n} abschließen
                      </button>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(e => (
              <tr key={e.ID}>
                <th scope="row" className="sc-close-name"><strong>{e.ABBR}</strong> {e.FIRST_NAME} {e.LAST_NAME}</th>
                {e.months.map(m => (
                  <td key={`${m.year}-${m.month}`} className="sc-close-cell">
                    <button type="button" disabled={busy} className={`mc-cell${m.closed ? ' mc-cell--closed' : ''}`}
                      title={m.closed ? `Abgeschlossen${m.closed_at ? ` am ${fmtDateShort(m.closed_at)}` : ''} — öffnen` : 'Offen — abschließen'}
                      aria-label={`${e.ABBR} ${monthLabel(m.year, m.month)}: ${m.closed ? 'abgeschlossen, öffnen' : 'offen, abschließen'}`}
                      onClick={() => toggle(e, m.year, m.month, m.closed)}>
                      {m.closed ? <CircleCheck size={18} strokeWidth={2} aria-hidden="true" /> : <Circle size={18} strokeWidth={1.75} aria-hidden="true" />}
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
        <span>Ein Klick schließt einen Monat ab; Öffnen fragt nach.</span>
      </p>
      <ConfirmModal open={ask !== null} title={ask?.title ?? ''} message={ask?.message ?? ''} confirmLabel={ask?.label ?? 'OK'}
        confirmClass="btn-primary" onConfirm={() => { const a = ask; setAsk(null); void a?.run() }} onCancel={() => setAsk(null)} />
    </div>
  )
}
