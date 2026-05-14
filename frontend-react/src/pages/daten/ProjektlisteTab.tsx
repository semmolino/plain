import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchProjectList,
  type ProjectListRow,
  type DateFilter,
  type FilterMode,
} from '@/api/reports'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_H   = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_PCT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtH    = (v: number | null | undefined) => v == null ? '—' : FMT_H.format(v) + ' h'
const fmtPct  = (v: number | null | undefined) => v == null ? '—' : FMT_PCT.format(v) + ' %'

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterDimension = 'status' | 'manager' | 'typ' | 'abteilung' | 'adresse'
type ActiveFilters   = Record<FilterDimension, Set<string>>
const emptyFilters = (): ActiveFilters =>
  ({ status: new Set(), manager: new Set(), typ: new Set(), abteilung: new Set(), adresse: new Set() })

type ColKey = 'status' | 'manager' | 'typ' | 'abteilung' | 'adresse'
  | 'honorar' | 'lstPct' | 'lstEur' | 'rest' | 'hoursInt' | 'cost'
  | 'billed' | 'open' | 'payed' | 'kq'

type SortField = 'name' | ColKey

interface ColDef {
  key:            ColKey
  label:          string
  className?:     string
  defaultVisible: boolean
  render:         (r: ProjectListRow) => React.ReactNode
  sortValue:      (r: ProjectListRow) => number | string
  renderTotal:    (rows: ProjectListRow[]) => React.ReactNode
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sumRows = (rows: ProjectListRow[], fn: (r: ProjectListRow) => number | null | undefined): number =>
  rows.reduce((acc, r) => acc + (fn(r) ?? 0), 0)

// ── Column definitions ────────────────────────────────────────────────────────

const COLUMNS: ColDef[] = [
  {
    key: 'status', label: 'Status', defaultVisible: true,
    render:      r  => r.PROJECT_STATUS_NAME_SHORT ?? '—',
    sortValue:   r  => r.PROJECT_STATUS_NAME_SHORT ?? '',
    renderTotal: ()  => '',
  },
  {
    key: 'manager', label: 'Projektleiter', defaultVisible: true,
    render:      r  => r.PROJECT_MANAGER_DISPLAY ?? '—',
    sortValue:   r  => r.PROJECT_MANAGER_DISPLAY ?? '',
    renderTotal: ()  => '',
  },
  {
    key: 'typ', label: 'Typ', defaultVisible: true,
    render:      r  => r.PROJECT_TYPE_NAME_SHORT ?? '—',
    sortValue:   r  => r.PROJECT_TYPE_NAME_SHORT ?? '',
    renderTotal: ()  => '',
  },
  {
    key: 'abteilung', label: 'Abteilung', defaultVisible: false,
    render:      r  => r.DEPARTMENT_NAME ?? '—',
    sortValue:   r  => r.DEPARTMENT_NAME ?? '',
    renderTotal: ()  => '',
  },
  {
    key: 'adresse', label: 'Adresse', defaultVisible: true,
    render:      r  => r.ADDRESS_NAME ?? r.COMPANY_NAME ?? '—',
    sortValue:   r  => r.ADDRESS_NAME ?? r.COMPANY_NAME ?? '',
    renderTotal: ()  => '',
  },
  {
    key: 'honorar', label: 'Honorar Netto', className: 'num', defaultVisible: true,
    render:      r  => fmtEur(r.BUDGET_TOTAL_NET),
    sortValue:   r  => r.BUDGET_TOTAL_NET ?? 0,
    renderTotal: rs => fmtEur(sumRows(rs, r => r.BUDGET_TOTAL_NET)),
  },
  {
    key: 'lstPct', label: 'Lst.%', className: 'num', defaultVisible: true,
    render:      r  => fmtPct(r.LEISTUNGSSTAND_PERCENT),
    sortValue:   r  => r.LEISTUNGSSTAND_PERCENT ?? 0,
    renderTotal: rs => {
      const h = sumRows(rs, r => r.BUDGET_TOTAL_NET)
      const l = sumRows(rs, r => r.LEISTUNGSSTAND_VALUE)
      return h > 0 ? fmtPct((l / h) * 100) : '—'
    },
  },
  {
    key: 'lstEur', label: 'Lst.€', className: 'num', defaultVisible: true,
    render:      r  => fmtEur(r.LEISTUNGSSTAND_VALUE),
    sortValue:   r  => r.LEISTUNGSSTAND_VALUE ?? 0,
    renderTotal: rs => fmtEur(sumRows(rs, r => r.LEISTUNGSSTAND_VALUE)),
  },
  {
    key: 'rest', label: 'Restbudget', className: 'num', defaultVisible: true,
    render:      r  => fmtEur(r.REMAINING_BUDGET_NET),
    sortValue:   r  => r.REMAINING_BUDGET_NET ?? 0,
    renderTotal: rs => fmtEur(sumRows(rs, r => r.REMAINING_BUDGET_NET)),
  },
  {
    key: 'hoursInt', label: 'Std.int.', className: 'num', defaultVisible: true,
    render:      r  => fmtH(r.HOURS_TOTAL),
    sortValue:   r  => r.HOURS_TOTAL ?? 0,
    renderTotal: rs => fmtH(sumRows(rs, r => r.HOURS_TOTAL)),
  },
  {
    key: 'cost', label: 'Kosten €', className: 'num', defaultVisible: false,
    render:      r  => fmtEur(r.COST_TOTAL),
    sortValue:   r  => r.COST_TOTAL ?? 0,
    renderTotal: rs => fmtEur(sumRows(rs, r => r.COST_TOTAL)),
  },
  {
    key: 'billed', label: 'Abgerechnet', className: 'num', defaultVisible: true,
    render:      r  => fmtEur(r.BILLED_NET_TOTAL),
    sortValue:   r  => r.BILLED_NET_TOTAL ?? 0,
    renderTotal: rs => fmtEur(sumRows(rs, r => r.BILLED_NET_TOTAL)),
  },
  {
    key: 'open', label: 'Abrechenbar', className: 'num', defaultVisible: true,
    render:      r  => <span className="accent">{fmtEur(r.OPEN_NET_TOTAL)}</span>,
    sortValue:   r  => r.OPEN_NET_TOTAL ?? 0,
    renderTotal: rs => <span className="accent">{fmtEur(sumRows(rs, r => r.OPEN_NET_TOTAL))}</span>,
  },
  {
    key: 'payed', label: 'Bezahlt', className: 'num', defaultVisible: false,
    render:      r  => fmtEur(r.PAYED_NET_TOTAL),
    sortValue:   r  => r.PAYED_NET_TOTAL ?? 0,
    renderTotal: rs => fmtEur(sumRows(rs, r => r.PAYED_NET_TOTAL)),
  },
  {
    key: 'kq', label: 'Kostenquote', className: 'num', defaultVisible: false,
    render:      r  => r.COST_RATIO != null ? fmtPct(r.COST_RATIO * 100) : '—',
    sortValue:   r  => r.COST_RATIO ?? -1,
    renderTotal: rs => {
      const l = sumRows(rs, r => r.LEISTUNGSSTAND_VALUE)
      const c = sumRows(rs, r => r.COST_TOTAL)
      return l > 0 ? fmtPct((c / l) * 100) : '—'
    },
  },
]

// ── FilterChip ────────────────────────────────────────────────────────────────

function FilterChip({ label, options, active, onChange }: {
  label:    string
  options:  string[]
  active:   Set<string>
  onChange: (values: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function toggle(val: string) {
    const next = new Set(active)
    next.has(val) ? next.delete(val) : next.add(val)
    onChange(next)
  }

  const count = active.size

  return (
    <div ref={ref} className="filter-chip-wrap">
      <button
        className={`filter-chip-btn${count > 0 ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        {label}{count > 0 ? ` (${count})` : ''} ▾
      </button>
      {count > 0 && (
        <button className="filter-chip-clear" onClick={() => { onChange(new Set()); setOpen(false) }} title="Zurücksetzen">
          ×
        </button>
      )}
      {open && (
        <div className="filter-chip-dropdown">
          {options.length === 0 ? (
            <div className="filter-chip-empty">Keine Optionen</div>
          ) : (
            options.map(opt => (
              <label key={opt} className="filter-chip-option">
                <input type="checkbox" checked={active.has(opt)} onChange={() => toggle(opt)} />
                {opt || '(ohne)'}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── SortTh ────────────────────────────────────────────────────────────────────

function SortTh({ label, field, current, dir, onSort, className }: {
  label: string; field: SortField; current: SortField; dir: 'asc' | 'desc'
  onSort: (f: SortField) => void; className?: string
}) {
  const active = current === field
  return (
    <th
      className={`sortable${className ? ' ' + className : ''}${active ? ' sorted' : ''}`}
      onClick={() => onSort(field)}
    >
      {label}{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjektlisteTab() {
  const navigate = useNavigate()

  const [mode,     setMode]     = useState<FilterMode>('now')
  const [asOfDate, setAsOfDate] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [search,   setSearch]   = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir,   setSortDir]  = useState<'asc' | 'desc'>('asc')
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(emptyFilters())
  const [hiddenCols,    setHiddenCols]    = useState<Set<ColKey>>(
    new Set(COLUMNS.filter(c => !c.defaultVisible).map(c => c.key))
  )
  const [colPanelOpen, setColPanelOpen] = useState(false)
  const colPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!colPanelOpen) return
    const h = (e: MouseEvent) => {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setColPanelOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [colPanelOpen])

  const filter: DateFilter = { mode, asOfDate, dateFrom, dateTo }
  const filterReady =
    mode === 'now' ||
    (mode === 'as_of'  && asOfDate !== '') ||
    (mode === 'period' && dateFrom !== '' && dateTo !== '')

  const { data, isLoading } = useQuery({
    queryKey: ['project-list', filter],
    queryFn:  () => fetchProjectList(filter),
    enabled:  filterReady,
  })

  const allRows = data?.data ?? []

  // Unique values for each filter dimension
  const filterOptions: Record<FilterDimension, string[]> = useMemo(() => {
    const uniq = (fn: (r: ProjectListRow) => string | null | undefined): string[] =>
      [...new Set(allRows.map(fn).filter((v): v is string => v != null && v !== ''))].sort()
    return {
      status:    uniq(r => r.PROJECT_STATUS_NAME_SHORT),
      manager:   uniq(r => r.PROJECT_MANAGER_DISPLAY),
      typ:       uniq(r => r.PROJECT_TYPE_NAME_SHORT),
      abteilung: uniq(r => r.DEPARTMENT_NAME),
      adresse:   uniq(r => r.ADDRESS_NAME ?? r.COMPANY_NAME),
    }
  }, [allRows])

  function setDimFilter(dim: FilterDimension, vals: Set<string>) {
    setActiveFilters(prev => ({ ...prev, [dim]: vals }))
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function toggleCol(key: ColKey) {
    setHiddenCols(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const visibleCols = COLUMNS.filter(c => !hiddenCols.has(c.key))

  // Apply search + dimension filters
  const filtered = useMemo(() => {
    let rows = allRows

    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        r.NAME_SHORT.toLowerCase().includes(q) ||
        (r.NAME_LONG ?? '').toLowerCase().includes(q) ||
        (r.PROJECT_STATUS_NAME_SHORT ?? '').toLowerCase().includes(q) ||
        (r.PROJECT_MANAGER_DISPLAY ?? '').toLowerCase().includes(q) ||
        (r.ADDRESS_NAME ?? '').toLowerCase().includes(q) ||
        (r.COMPANY_NAME ?? '').toLowerCase().includes(q)
      )
    }

    const dimMap: [FilterDimension, (r: ProjectListRow) => string | null | undefined][] = [
      ['status',    r => r.PROJECT_STATUS_NAME_SHORT],
      ['manager',   r => r.PROJECT_MANAGER_DISPLAY],
      ['typ',       r => r.PROJECT_TYPE_NAME_SHORT],
      ['abteilung', r => r.DEPARTMENT_NAME],
      ['adresse',   r => r.ADDRESS_NAME ?? r.COMPANY_NAME],
    ]

    for (const [dim, getter] of dimMap) {
      if (activeFilters[dim].size > 0) {
        rows = rows.filter(r => {
          const v = getter(r)
          return v != null && activeFilters[dim].has(v)
        })
      }
    }

    return rows
  }, [allRows, search, activeFilters])

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const col = COLUMNS.find(c => c.key === sortField)
      const va  = sortField === 'name' ? a.NAME_SHORT : (col?.sortValue(a) ?? '')
      const vb  = sortField === 'name' ? b.NAME_SHORT : (col?.sortValue(b) ?? '')
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ?  1 : -1
      return 0
    })
    return arr
  }, [filtered, sortField, sortDir])

  const hasActiveFilter = Object.values(activeFilters).some(s => s.size > 0) || search.trim() !== ''

  return (
    <div>
      {/* Date filter */}
      <div className="daten-filter-bar">
        <div className="daten-filter-modes">
          {(['now', 'as_of', 'period'] as FilterMode[]).map(m => (
            <label key={m} className={`daten-filter-mode-btn${mode === m ? ' active' : ''}`}>
              <input type="radio" name="plFilterMode" value={m} checked={mode === m}
                onChange={() => setMode(m)} />
              {m === 'now' ? 'Aktuell' : m === 'as_of' ? 'Stichtag' : 'Zeitraum'}
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

      {isLoading && <p className="empty-note">Laden …</p>}

      {!isLoading && filterReady && allRows.length > 0 && (
        <>
          {/* Toolbar: search + filter chips + column panel */}
          <div className="pl-toolbar">
            <input
              type="search"
              placeholder="Suche …"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="list-search"
            />
            <div className="pl-filter-chips">
              <FilterChip label="Status"        options={filterOptions.status}    active={activeFilters.status}    onChange={v => setDimFilter('status', v)}    />
              <FilterChip label="Projektleiter" options={filterOptions.manager}   active={activeFilters.manager}   onChange={v => setDimFilter('manager', v)}   />
              <FilterChip label="Typ"           options={filterOptions.typ}       active={activeFilters.typ}       onChange={v => setDimFilter('typ', v)}       />
              <FilterChip label="Abteilung"     options={filterOptions.abteilung} active={activeFilters.abteilung} onChange={v => setDimFilter('abteilung', v)} />
              <FilterChip label="Adresse"       options={filterOptions.adresse}   active={activeFilters.adresse}   onChange={v => setDimFilter('adresse', v)}   />
              {hasActiveFilter && (
                <button className="pl-clear-btn" onClick={() => { setActiveFilters(emptyFilters()); setSearch('') }}>
                  Alle Filter löschen
                </button>
              )}
            </div>

            {/* Column visibility */}
            <div ref={colPanelRef} className="pl-col-wrap">
              <button className="pl-col-btn" onClick={() => setColPanelOpen(o => !o)}>
                ⚙ Spalten
              </button>
              {colPanelOpen && (
                <div className="pl-col-panel">
                  <div className="pl-col-panel-title">Sichtbare Spalten</div>
                  {COLUMNS.map(c => (
                    <label key={c.key} className="pl-col-option">
                      <input
                        type="checkbox"
                        checked={!hiddenCols.has(c.key)}
                        onChange={() => toggleCol(c.key)}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {hasActiveFilter && (
            <p className="empty-note" style={{ margin: '0 0 8px' }}>
              {sorted.length} von {allRows.length} Projekten
            </p>
          )}

          {/* Table */}
          <div className="list-section table-scroll">
            <table className="master-table">
              <thead>
                <tr>
                  <SortTh label="Projekt" field="name" current={sortField} dir={sortDir} onSort={toggleSort} />
                  {visibleCols.map(c => (
                    <SortTh key={c.key} label={c.label} field={c.key} current={sortField} dir={sortDir} onSort={toggleSort} className={c.className} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr
                    key={r.PROJECT_ID}
                    className="clickable-row"
                    onClick={() => navigate('/projekte', { state: { tab: 'struktur', projectId: r.PROJECT_ID } })}
                  >
                    <td>
                      <strong>{r.NAME_SHORT}</strong>
                      {r.NAME_LONG && <span className="tree-name-long"> – {r.NAME_LONG}</span>}
                    </td>
                    {visibleCols.map(c => (
                      <td key={c.key} className={c.className}>{c.render(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {sorted.length > 1 && (
                <tfoot>
                  <tr className="sum-row">
                    <td><strong>Gesamt ({sorted.length})</strong></td>
                    {visibleCols.map(c => (
                      <td key={c.key} className={c.className}>
                        <strong>{c.renderTotal(sorted)}</strong>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {sorted.length === 0 && (
            <p className="empty-note">Keine Treffer für diesen Filter.</p>
          )}
        </>
      )}

      {!isLoading && filterReady && allRows.length === 0 && (
        <p className="empty-note">Keine Projekte vorhanden.</p>
      )}

      {!isLoading && !filterReady && (
        <p className="empty-note">Bitte Datumfilter vervollständigen.</p>
      )}
    </div>
  )
}
