import { useMemo, useState, useRef, useEffect } from 'react'
import { ListLoading } from '@/components/ui/Skeleton'
import { FilterChip } from '@/components/ui/FilterChip'
import { useStickyState } from '@/hooks/useStickyState'
import { SlidersHorizontal } from 'lucide-react'
import { HelpHint } from '@/components/ui/HelpHint'
import { FilterBar } from '@/components/ui/FilterBar'
import type { HelpId } from '@/help/helpContent'
import { KpiValue } from '@/components/ui/KpiValue'
import { useTenantDefaults } from '@/hooks/useTenantDefaults'
import { cpiLevel, vacLevel, readCpiThresholds, type CpiThresholds } from '@/utils/kpiLevel'
import { fmtEur, fmtEur0, money, moneyOr, negativeStyle } from '@/utils/money'

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
import { useChartDefaults } from '@/theme/useChartDefaults'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const FMT_H   = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_PCT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
  /** `t` = CPI-Schwellen des Mandanten. Nur die Ampel-Spalten werten sie aus;
   *  COLUMNS steht auf Modulebene und kann selbst keine Hooks lesen. */
  render:         (r: ProjectListRow, t: CpiThresholds) => React.ReactNode
  sortValue:      (r: ProjectListRow) => number | string
  renderTotal:    (rows: ProjectListRow[], t: CpiThresholds) => React.ReactNode
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
    render:      r  => money(r.BUDGET_TOTAL_NET),
    sortValue:   r  => r.BUDGET_TOTAL_NET ?? 0,
    renderTotal: rs => money(sumRows(rs, r => r.BUDGET_TOTAL_NET)),
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
    render:      r  => money(r.LEISTUNGSSTAND_VALUE),
    sortValue:   r  => r.LEISTUNGSSTAND_VALUE ?? 0,
    renderTotal: rs => money(sumRows(rs, r => r.LEISTUNGSSTAND_VALUE)),
  },
  {
    key: 'rest', label: 'Restbudget', className: 'num', help: 'report.restbudget', defaultVisible: true,
    render:      r  => money(r.REMAINING_BUDGET_NET),
    sortValue:   r  => r.REMAINING_BUDGET_NET ?? 0,
    renderTotal: rs => money(sumRows(rs, r => r.REMAINING_BUDGET_NET)),
  },
  {
    key: 'hoursInt', label: 'Std.int.', className: 'num', defaultVisible: true,
    render:      r  => fmtH(r.HOURS_TOTAL),
    sortValue:   r  => r.HOURS_TOTAL ?? 0,
    renderTotal: rs => fmtH(sumRows(rs, r => r.HOURS_TOTAL)),
  },
  {
    key: 'cost', label: 'Kosten €', className: 'num', defaultVisible: false,
    render:      r  => money(r.COST_TOTAL),
    sortValue:   r  => r.COST_TOTAL ?? 0,
    renderTotal: rs => money(sumRows(rs, r => r.COST_TOTAL)),
  },
  {
    key: 'billed', label: 'Abgerechnet', className: 'num', defaultVisible: true,
    render:      r  => money(r.BILLED_NET_TOTAL),
    sortValue:   r  => r.BILLED_NET_TOTAL ?? 0,
    renderTotal: rs => money(sumRows(rs, r => r.BILLED_NET_TOTAL)),
  },
  {
    key: 'open', label: 'Abrechenbar', className: 'num', help: 'report.abrechenbar', defaultVisible: true,
    render:      r  => moneyOr(r.OPEN_NET_TOTAL, 'var(--accent)'),
    sortValue:   r  => r.OPEN_NET_TOTAL ?? 0,
    renderTotal: rs => moneyOr(sumRows(rs, r => r.OPEN_NET_TOTAL), 'var(--accent)'),
  },
  {
    key: 'payed', label: 'Bezahlt', className: 'num', defaultVisible: false,
    render:      r  => money(r.PAYED_NET_TOTAL),
    sortValue:   r  => r.PAYED_NET_TOTAL ?? 0,
    renderTotal: rs => money(sumRows(rs, r => r.PAYED_NET_TOTAL)),
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
    key: 'cpi', label: 'CPI', className: 'num', help: 'report.cpi', defaultVisible: false,
    render: (r, t) => {
      const cpi = computeEvm(r).cpi
      const lvl = cpiLevel(cpi, t)
      return (
        <KpiValue level={lvl} reason={cpi == null
          ? 'zu wenig Kosten oder Budget erfasst'
          : `CPI ${cpi.toFixed(2)} bei Schwelle ${t.watch.toFixed(2)} / ${t.critical.toFixed(2)}`}>
          {fmtCpi(cpi)}
        </KpiValue>
      )
    },
    sortValue:   r  => computeEvm(r).cpi ?? -999,
    renderTotal: (rs, t) => {
      const cpi = portfolioCpi(rs)
      return <KpiValue level={cpiLevel(cpi, t)}>{fmtCpi(cpi)}</KpiValue>
    },
  },
  {
    key: 'eac', label: 'EAC (Prognose)', className: 'num', defaultVisible: false,
    render:      r  => <span style={negativeStyle(computeEvm(r).eac)}>{money(computeEvm(r).eac)}</span>,
    sortValue:   r  => computeEvm(r).eac ?? 0,
    renderTotal: rs => fmtEur(rs.reduce((s, r) => s + (computeEvm(r).eac ?? Number(r.BUDGET_TOTAL_NET) ?? 0), 0)),
  },
  {
    key: 'vac', label: 'VAC (Abweichung)', className: 'num', help: 'report.vac', defaultVisible: false,
    render: r => {
      const vac = computeEvm(r).vac
      if (vac == null) return '—'
      return (
        <KpiValue level={vacLevel(vac)} bold={vac < 0}
          reason={vac < 0 ? 'Prognose liegt über dem Budget' : 'Prognose bleibt im Budget'}>
          {money(vac)}
        </KpiValue>
      )
    },
    sortValue:   r  => computeEvm(r).vac ?? 0,
    renderTotal: rs => {
      const total = rs.reduce((s, r) => s + (computeEvm(r).vac ?? 0), 0)
      return <KpiValue level={vacLevel(total)}>{money(total)}</KpiValue>
    },
  },
]

// ── FilterChip ────────────────────────────────────────────────────────────────


// ── SortTh ────────────────────────────────────────────────────────────────────

function SortTh({ label, field, current, dir, onSort, className, help }: {
  label: string; field: SortField; current: SortField; dir: 'asc' | 'desc'
  onSort: (f: SortField) => void; className?: string; help?: HelpId
}) {
  const active = current === field
  return (
    <th scope="col" 
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
        borderColor: 'var(--info)',
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
        borderColor: 'var(--success)',
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
        borderColor: 'var(--warning)',
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
        borderColor: 'var(--accent2)',
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
        borderColor: 'var(--info)',
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
        titleColor: 'var(--surface-2)',
        bodyColor: 'var(--border)',
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (ctx) =>
            `  ${ctx.dataset.label ?? ''}: ${fmtEur(ctx.parsed.y ?? 0)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: 'var(--text-3)' },
        ticks: { maxRotation: 45, maxTicksLimit: 12, font: { size: 11 }, color: 'var(--text-3)' },
      },
      y: {
        grid: { color: 'var(--text-3)' },
        ticks: {
          font: { size: 11 },
          color: 'var(--text-3)',
          callback: (v) => fmtEur0(Number(v)),
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
  // Achsen-, Gitter- und Legendenfarben ans Theme koppeln.
  useChartDefaults()

  const navigate = useNavigate()

  // Schwellen der Controlling-Ampel (Einstellungen → Vorbelegungen). Ungepflegt
  // heisst hier „Standardwerte", nicht „Ampel aus" — die Einfaerbung gab es
  // vorher schon, sie wegzunehmen waere ein Rueckschritt.
  const cpiT = readCpiThresholds(useTenantDefaults())

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
  const [hiddenCols,    setHiddenCols]    = useStickyState<Set<ColKey>>(
    'report.projektliste.cols',
    () => new Set(COLUMNS.filter(c => !c.defaultVisible).map(c => c.key)),
    { serialize: s => [...s], deserialize: raw => new Set(Array.isArray(raw) ? raw as ColKey[] : []) },
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

      {isLoading && <ListLoading columns={7} />}

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
            {/* Fuenf Chips — auf dem Handy besonders wichtig, dass sie
                eingeklappt sind (siehe FilterBar). */}
            <FilterBar
              activeCount={Object.values(activeFilters).reduce((n, s) => n + s.size, 0)}
              onReset={() => { setActiveFilters(emptyFilters()); setSearch('') }}
            >
              <FilterChip label="Status"        options={filterOptions.status}    active={activeFilters.status}    onChange={v => setDimFilter('status', v)}    />
              <FilterChip label="Projektleiter" options={filterOptions.manager}   active={activeFilters.manager}   onChange={v => setDimFilter('manager', v)}   />
              <FilterChip label="Typ"           options={filterOptions.typ}       active={activeFilters.typ}       onChange={v => setDimFilter('typ', v)}       />
              <FilterChip label="Abteilung"     options={filterOptions.abteilung} active={activeFilters.abteilung} onChange={v => setDimFilter('abteilung', v)} />
              <FilterChip label="Adresse"       options={filterOptions.adresse}   active={activeFilters.adresse}   onChange={v => setDimFilter('adresse', v)}   />
            </FilterBar>

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
                      <td key={c.key} className={c.className}>{c.render(r, cpiT)}</td>
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
                        <strong>{c.renderTotal(sorted, cpiT)}</strong>
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
