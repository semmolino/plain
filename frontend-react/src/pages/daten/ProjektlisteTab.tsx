import { useMemo, useState, useRef, useEffect } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { HelpHint } from '@/components/ui/HelpHint'
import type { HelpId } from '@/help/helpContent'

function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v != null ? JSON.parse(v) as T : fallback } catch { return fallback }
}
function lsPut(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import {
  fetchProjectList,
  fetchProjectsTimeline,
  type ProjectListRow,
  type DateFilter,
  type FilterMode,
  type TimelinePoint,
} from '@/api/reports'
import { computeEvm, fmtCpi, portfolioCpi } from '@/utils/projectForecasting'
import { RecentList } from '@/components/recents/RecentList'
import { useTrackFilterRecent } from '@/hooks/useTrackFilterRecent'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

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

const PL_KEY = 'plain:filt:proj-list'

function serializeFilters(f: ActiveFilters): Record<string, string[]> {
  const r: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(f)) r[k] = [...v]
  return r
}
/** Liefert eine menschenlesbare Beschreibung des Filter-Sets fuer Recents-Labels. */
function buildFilterLabel(
  mode: FilterMode, asOfDate: string, dateFrom: string, dateTo: string,
  dimensions: Record<string, string[]>,
): string {
  const parts: string[] = []
  if (mode === 'as_of'  && asOfDate)             parts.push(`Stichtag ${asOfDate}`)
  if (mode === 'period' && dateFrom && dateTo)   parts.push(`${dateFrom} – ${dateTo}`)
  if (mode === 'now')                            parts.push('Aktuell')
  const dimLabels: Record<string, string> = { status: 'Status', manager: 'PL', typ: 'Typ', abteilung: 'Abt.', adresse: 'Adresse' }
  for (const [k, arr] of Object.entries(dimensions)) {
    if (arr.length === 0) continue
    const head = arr.slice(0, 2).join(', ')
    const more = arr.length > 2 ? ` +${arr.length - 2}` : ''
    parts.push(`${dimLabels[k] ?? k}: ${head}${more}`)
  }
  return parts.join(' · ') || 'Alle'
}

function deserializeFilters(raw: Record<string, string[]>): ActiveFilters {
  const base = emptyFilters()
  for (const k of Object.keys(base)) {
    if (Array.isArray(raw[k])) (base as Record<string, Set<string>>)[k] = new Set(raw[k])
  }
  return base
}

type ColKey = 'status' | 'manager' | 'typ' | 'abteilung' | 'adresse'
  | 'honorar' | 'lstPct' | 'lstEur' | 'rest' | 'hoursInt' | 'cost'
  | 'billed' | 'open' | 'payed' | 'kq'
  | 'cpi' | 'eac' | 'vac'

type SortField = 'name' | ColKey

interface ColDef {
  key:            ColKey
  label:          string
  className?:     string
  help?:          HelpId
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
    key: 'lstPct', label: 'Lst.%', className: 'num', help: 'report.leistungsstand', defaultVisible: true,
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
    key: 'rest', label: 'Restbudget', className: 'num', help: 'report.restbudget', defaultVisible: true,
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
    key: 'open', label: 'Abrechenbar', className: 'num', help: 'report.abrechenbar', defaultVisible: true,
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
    key: 'kq', label: 'Kostenquote', className: 'num', help: 'report.kostenquote', defaultVisible: false,
    render:      r  => r.COST_RATIO != null ? fmtPct(r.COST_RATIO * 100) : '—',
    sortValue:   r  => r.COST_RATIO ?? -1,
    renderTotal: rs => {
      const l = sumRows(rs, r => r.LEISTUNGSSTAND_VALUE)
      const c = sumRows(rs, r => r.COST_TOTAL)
      return l > 0 ? fmtPct((c / l) * 100) : '—'
    },
  },
  {
    key: 'cpi', label: 'CPI', className: 'num', defaultVisible: false,
    render: r => {
      const evm = computeEvm(r)
      const color = evm.cpiStatus === 'good' ? '#16a34a' : evm.cpiStatus === 'warn' ? '#b45309' : evm.cpiStatus === 'bad' ? '#b91c1c' : 'var(--text-3)'
      return <span style={{ color, fontWeight: evm.cpi != null ? 600 : undefined }}>{fmtCpi(evm.cpi)}</span>
    },
    sortValue:   r  => computeEvm(r).cpi ?? -999,
    renderTotal: rs => {
      const cpi = portfolioCpi(rs)
      const color = cpi == null ? undefined : cpi >= 0.95 ? '#16a34a' : cpi >= 0.80 ? '#b45309' : '#b91c1c'
      return <span style={{ color, fontWeight: 600 }}>{fmtCpi(cpi)}</span>
    },
  },
  {
    key: 'eac', label: 'EAC (Prognose)', className: 'num', defaultVisible: false,
    render:      r  => fmtEur(computeEvm(r).eac),
    sortValue:   r  => computeEvm(r).eac ?? 0,
    renderTotal: rs => fmtEur(rs.reduce((s, r) => s + (computeEvm(r).eac ?? Number(r.BUDGET_TOTAL_NET) ?? 0), 0)),
  },
  {
    key: 'vac', label: 'VAC (Abweichung)', className: 'num', defaultVisible: false,
    render: r => {
      const vac = computeEvm(r).vac
      if (vac == null) return '—'
      return <span style={{ color: vac >= 0 ? '#16a34a' : '#b91c1c' }}>{fmtEur(vac)}</span>
    },
    sortValue:   r  => computeEvm(r).vac ?? 0,
    renderTotal: rs => {
      const total = rs.reduce((s, r) => s + (computeEvm(r).vac ?? 0), 0)
      return <span style={{ color: total >= 0 ? '#16a34a' : '#b91c1c', fontWeight: 600 }}>{fmtEur(total)}</span>
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

function SortTh({ label, field, current, dir, onSort, className, help }: {
  label: string; field: SortField; current: SortField; dir: 'asc' | 'desc'
  onSort: (f: SortField) => void; className?: string; help?: HelpId
}) {
  const active = current === field
  return (
    <th
      className={`sortable${className ? ' ' + className : ''}${active ? ' sorted' : ''}`}
      onClick={() => onSort(field)}
    >
      {label}{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
      {help && (
        <span onClick={e => e.stopPropagation()} style={{ cursor: 'default' }}>
          <HelpHint id={help} align="right" />
        </span>
      )}
    </th>
  )
}

// ── Aggregate timeline chart ──────────────────────────────────────────────────

const FMT_EUR_CHART = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_EUR0_CHART = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

function fmtDateDE(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function ProjectsTimeline({ filter, filterReady, projectIds }: { filter: DateFilter; filterReady: boolean; projectIds?: number[] }) {
  const { data, isLoading } = useQuery({
    queryKey: ['projects-timeline', filter, projectIds ?? null],
    queryFn:  () => fetchProjectsTimeline(filter, projectIds),
    enabled:  filterReady,
  })

  const points: TimelinePoint[] = data?.data ?? []

  if (!filterReady) return null
  if (isLoading) {
    return (
      <div className="timeline-wrap">
        <p className="empty-note">Laden …</p>
      </div>
    )
  }
  if (points.length === 0) {
    return (
      <div className="timeline-wrap">
        <p className="empty-note">Keine Zeitreihendaten vorhanden.</p>
      </div>
    )
  }

  const labels = points.map(p => fmtDateDE(p.DATE))

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Honorar inkl. NK',
        data: points.map(p => p.HONORAR_NET),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.07)',
        fill: true,
        tension: 0.35,
        pointRadius: points.length > 60 ? 0 : 3,
        pointHoverRadius: 6,
        borderWidth: 2,
      },
      {
        label: 'Leistungsstand €',
        data: points.map(p => p.LEISTUNGSSTAND_VALUE),
        borderColor: '#10b981',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.35,
        pointRadius: points.length > 60 ? 0 : 3,
        pointHoverRadius: 6,
        borderWidth: 2,
      },
      {
        label: 'Kosten €',
        data: points.map(p => p.KOSTEN_TOTAL),
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.35,
        pointRadius: points.length > 60 ? 0 : 3,
        pointHoverRadius: 6,
        borderWidth: 2,
      },
      {
        label: 'Abgerechnet €',
        data: points.map(p => p.ABGERECHNET_NET),
        borderColor: '#8b5cf6',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.35,
        borderDash: [6, 3],
        pointRadius: points.length > 60 ? 0 : 3,
        pointHoverRadius: 6,
        borderWidth: 1.5,
      },
      {
        label: 'Bezahlt €',
        data: points.map(p => p.BEZAHLT_NET),
        borderColor: '#06b6d4',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.35,
        borderDash: [6, 3],
        pointRadius: points.length > 60 ? 0 : 3,
        pointHoverRadius: 6,
        borderWidth: 1.5,
      },
    ],
  }

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          usePointStyle: true,
          pointStyle: 'circle',
          boxWidth: 8,
          padding: 16,
          font: { size: 12 },
        },
      },
      tooltip: {
        backgroundColor: 'rgba(17,24,39,0.92)',
        titleColor: '#f9fafb',
        bodyColor: '#d1d5db',
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (ctx) =>
            `  ${ctx.dataset.label ?? ''}: ${FMT_EUR_CHART.format(ctx.parsed.y ?? 0)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(0,0,0,0.04)' },
        ticks: { maxRotation: 45, maxTicksLimit: 12, font: { size: 11 }, color: '#6b7280' },
      },
      y: {
        grid: { color: 'rgba(0,0,0,0.06)' },
        ticks: {
          font: { size: 11 },
          color: '#6b7280',
          callback: (v) => FMT_EUR0_CHART.format(Number(v)),
        },
      },
    },
  }

  return (
    <div className="timeline-wrap">
      <h3 className="timeline-title">{projectIds !== undefined ? 'Gesamtverlauf der gefilterten Projekte' : 'Gesamtverlauf aller Projekte'}</h3>
      <div className="timeline-chart">
        <Line data={chartData} options={options} />
      </div>
    </div>
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
  const [sortField, setSortField] = useState<SortField>(() => lsGet<SortField>(`${PL_KEY}:sortField`, 'name'))
  const [sortDir,   setSortDir]  = useState<'asc' | 'desc'>(() => lsGet<'asc'|'desc'>(`${PL_KEY}:sortDir`, 'asc'))
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(() =>
    deserializeFilters(lsGet<Record<string, string[]>>(`${PL_KEY}:filters`, {}))
  )
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

  useEffect(() => { lsPut(`${PL_KEY}:sortField`, sortField)                   }, [sortField])
  useEffect(() => { lsPut(`${PL_KEY}:sortDir`,   sortDir)                     }, [sortDir])
  useEffect(() => { lsPut(`${PL_KEY}:filters`,   serializeFilters(activeFilters)) }, [activeFilters])

  const filter: DateFilter = { mode, asOfDate, dateFrom, dateTo }
  const filterReady =
    mode === 'now' ||
    (mode === 'as_of'  && asOfDate !== '') ||
    (mode === 'period' && dateFrom !== '' && dateTo !== '')

  // ── Recents-Tracking ──────────────────────────────────────────────────────
  // Snapshot der Filter-Kombi, die zum Wiederherstellen reicht
  const serializedDimensions = useMemo(() => serializeFilters(activeFilters), [activeFilters])
  const recentSnapshot = useMemo(() => ({
    mode, asOfDate, dateFrom, dateTo,
    dimensions: serializedDimensions,
  }), [mode, asOfDate, dateFrom, dateTo, serializedDimensions])
  const recentLabel = useMemo(() => buildFilterLabel(mode, asOfDate, dateFrom, dateTo, serializedDimensions), [mode, asOfDate, dateFrom, dateTo, serializedDimensions])
  const hasAnyDimension = Object.values(serializedDimensions).some(arr => arr.length > 0)
  const shouldTrack = filterReady && (mode !== 'now' || hasAnyDimension)
  useTrackFilterRecent('report_projektliste_filter', recentSnapshot, recentLabel, shouldTrack)

  function applyRecent(meta: Record<string, unknown> | null) {
    if (!meta) return
    if (typeof meta.mode     === 'string') setMode(meta.mode as FilterMode)
    if (typeof meta.asOfDate === 'string') setAsOfDate(meta.asOfDate)
    if (typeof meta.dateFrom === 'string') setDateFrom(meta.dateFrom)
    if (typeof meta.dateTo   === 'string') setDateTo(meta.dateTo)
    if (meta.dimensions && typeof meta.dimensions === 'object') {
      setActiveFilters(deserializeFilters(meta.dimensions as Record<string, string[]>))
    }
  }

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

  // Projekt-IDs der aktuell angezeigten (gefilterten) Liste — stabil sortiert,
  // damit sich der Query-Key nur bei Aenderung der Menge (nicht der Sortierung) aendert.
  const filteredProjectIds = useMemo(
    () => [...new Set(filtered.map(r => r.PROJECT_ID))].sort((a, b) => a - b),
    [filtered]
  )

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
      <RecentList
        type="report_filter"
        title="Zuletzt verwendete Filter"
        onSelect={(e) => applyRecent(e.META)}
      />
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
              <button className="pl-col-btn" onClick={() => setColPanelOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <SlidersHorizontal size={13} strokeWidth={2} />Spalten
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
                    <SortTh key={c.key} label={c.label} field={c.key} current={sortField} dir={sortDir} onSort={toggleSort} className={c.className} help={c.help} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr
                    key={r.PROJECT_ID}
                    className="clickable-row"
                    title="Projektbericht öffnen"
                    onClick={() => navigate('/daten', { state: { tab: 'einzelprojekt', projectId: r.PROJECT_ID } })}
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
            <p className="empty-note">
              {allRows.length === 0
                ? 'Noch keine Projekte — sobald welche angelegt sind, erscheint hier die Auswertung.'
                : 'Keine Treffer für die aktuelle Filterung.'}
            </p>
          )}

          <ProjectsTimeline filter={filter} filterReady={filterReady} projectIds={hasActiveFilter ? filteredProjectIds : undefined} />
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
