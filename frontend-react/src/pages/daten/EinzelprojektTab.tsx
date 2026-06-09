import { useMemo, useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { computeEvm, computeBurnRate, monthsRemaining, fmtCpi } from '@/utils/projectForecasting'
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
import { fetchProjectsShort } from '@/api/projekte'
import {
  fetchProjectReportHeader,
  fetchProjectReportStructure,
  fetchProjectTimeline,
  type DateFilter,
  type FilterMode,
  type ProjectReportStructure,
  type TimelinePoint,
} from '@/api/reports'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_EUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const FMT_H   = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_PCT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtH    = (v: number | null | undefined) => v == null ? '—' : FMT_H.format(v) + ' h'
const fmtPct  = (v: number | null | undefined) => v == null ? '—' : FMT_PCT.format(v) + ' %'

type SortField = 'path' | 'honorar' | 'lstPct' | 'lstEur' | 'rest' | 'hours' | 'cost' | 'kq'

function KpiTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="daten-kpi-tile">
      <span className="daten-kpi-label">{label}</span>
      <span className={`daten-kpi-value${accent ? ' accent' : ''}`}>{value}</span>
    </div>
  )
}

function SortTh({
  label, field, current, dir, onSort, className,
}: {
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

function buildAncestorPath(
  id: number | null,
  byId: Map<number, ProjectReportStructure>,
): string {
  if (id == null) return ''
  const node = byId.get(id)
  if (!node) return ''
  const parent = buildAncestorPath(node.PARENT_STRUCTURE_ID, byId)
  return parent ? `${parent} › ${node.NAME_SHORT}` : node.NAME_SHORT
}

// ── Timeline chart ────────────────────────────────────────────────────────────

const CHART_COLORS = {
  honorar:       '#3b82f6',
  leistungsstand:'#10b981',
  kosten:        '#f59e0b',
  abgerechnet:   '#8b5cf6',
  bezahlt:       '#06b6d4',
}

function fmtDateDE(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function ProjectTimeline({ projectId, filter }: { projectId: number; filter: DateFilter }) {
  const { data, isLoading } = useQuery({
    queryKey: ['project-timeline', projectId, filter],
    queryFn:  () => fetchProjectTimeline(projectId, filter),
    enabled:  projectId !== null,
  })

  const points: TimelinePoint[] = data?.data ?? []

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
        borderColor: CHART_COLORS.honorar,
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
        borderColor: CHART_COLORS.leistungsstand,
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
        borderColor: CHART_COLORS.kosten,
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
        borderColor: CHART_COLORS.abgerechnet,
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
        borderColor: CHART_COLORS.bezahlt,
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
            `  ${ctx.dataset.label ?? ''}: ${FMT_EUR.format(ctx.parsed.y ?? 0)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(0,0,0,0.04)' },
        ticks: {
          maxRotation: 45,
          maxTicksLimit: 12,
          font: { size: 11 },
          color: '#6b7280',
        },
      },
      y: {
        grid: { color: 'rgba(0,0,0,0.06)' },
        ticks: {
          font: { size: 11 },
          color: '#6b7280',
          callback: (v) => FMT_EUR0.format(Number(v)),
        },
      },
    },
  }

  return (
    <div className="timeline-wrap">
      <h3 className="timeline-title">Projektverlauf</h3>
      <div className="timeline-chart">
        <Line data={chartData} options={options} />
      </div>
    </div>
  )
}

// ── Main tab component ────────────────────────────────────────────────────────

export function EinzelprojektTab({ initialProjectId }: { initialProjectId?: number } = {}) {
  const navigate = useNavigate()
  const [pid,       setPid]      = useState<number | null>(initialProjectId ?? null)
  const [projectInput,         setProjectInput]         = useState('')
  const [projectDropdownOpen,  setProjectDropdownOpen]  = useState(false)
  const projectAcRef                                   = useRef<HTMLDivElement>(null)
  const [mode,      setMode]     = useState<FilterMode>('now')
  const [asOfDate,  setAsOfDate] = useState('')
  const [dateFrom,  setDateFrom] = useState('')
  const [dateTo,    setDateTo]   = useState('')
  const [search,    setSearch]   = useState('')
  const [sortField, setSortField] = useState<SortField>('path')
  const [sortDir,   setSortDir]  = useState<'asc' | 'desc'>('asc')

  const filter: DateFilter = { mode, asOfDate, dateFrom, dateTo }

  const filterReady =
    mode === 'now' ||
    (mode === 'as_of'  && asOfDate !== '') ||
    (mode === 'period' && dateFrom !== '' && dateTo !== '')

  const { data: projectsData } = useQuery({
    queryKey: ['projects-short'],
    queryFn:  fetchProjectsShort,
  })
  const { data: headerData, isLoading: headerLoading } = useQuery({
    queryKey: ['report-header', pid, filter],
    queryFn:  () => fetchProjectReportHeader(pid!, filter),
    enabled:  pid !== null && filterReady,
  })
  const { data: structData, isLoading: structLoading } = useQuery({
    queryKey: ['report-structure', pid, filter],
    queryFn:  () => fetchProjectReportStructure(pid!, filter),
    enabled:  pid !== null && filterReady,
  })
  const { data: timelineData } = useQuery({
    queryKey: ['project-timeline', pid, filter],
    queryFn:  () => fetchProjectTimeline(pid!, filter),
    enabled:  pid !== null && filterReady,
    staleTime: 300000,
  })

  const projects  = projectsData?.data ?? []
  const header    = headerData?.data   ?? null
  const structure = structData?.data   ?? []

  // Sync project input display when pid or projects change
  useEffect(() => {
    if (pid && projects.length > 0) {
      const p = projects.find(proj => proj.ID === pid)
      if (p) setProjectInput(p.NAME_SHORT + (p.NAME_LONG ? ` – ${p.NAME_LONG}` : ''))
    } else if (!pid) {
      setProjectInput('')
    }
  }, [pid, projects])

  // Close project autocomplete on outside click, restore display name
  useEffect(() => {
    if (!projectDropdownOpen) return
    function onDown(e: MouseEvent) {
      if (projectAcRef.current && !projectAcRef.current.contains(e.target as Node)) {
        setProjectDropdownOpen(false)
        if (pid) {
          const p = projects.find(proj => proj.ID === pid)
          if (p) setProjectInput(p.NAME_SHORT + (p.NAME_LONG ? ` – ${p.NAME_LONG}` : ''))
        }
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [projectDropdownOpen, pid, projects])

  const filteredProjects = useMemo(() => {
    if (!projectDropdownOpen) return projects
    const sq = projectInput.toLowerCase().trim()
    if (!sq) return projects
    return projects.filter(p =>
      p.NAME_SHORT.toLowerCase().includes(sq) ||
      (p.NAME_LONG?.toLowerCase().includes(sq) ?? false)
    )
  }, [projects, projectInput, projectDropdownOpen])
  const loading   = headerLoading || structLoading

  const byId = useMemo(
    () => new Map(structure.map(s => [s.STRUCTURE_ID, s])),
    [structure],
  )

  const leafRows = useMemo(() => {
    return structure
      .filter(s => s.IS_LEAF)
      .map(s => ({
        ...s,
        ancestorPath: buildAncestorPath(s.PARENT_STRUCTURE_ID, byId),
        displayLabel: s.NAME_LONG ? `${s.NAME_SHORT}: ${s.NAME_LONG}` : s.NAME_SHORT,
      }))
  }, [structure, byId])

  const filtered = useMemo(() => {
    if (!search.trim()) return leafRows
    const q = search.toLowerCase()
    return leafRows.filter(s =>
      s.ancestorPath.toLowerCase().includes(q) ||
      s.NAME_SHORT.toLowerCase().includes(q) ||
      (s.NAME_LONG ?? '').toLowerCase().includes(q),
    )
  }, [leafRows, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let va: number | string
      let vb: number | string
      switch (sortField) {
        case 'path':   va = a.ancestorPath + a.displayLabel; vb = b.ancestorPath + b.displayLabel; break
        case 'honorar': va = a.HONORAR_NET;           vb = b.HONORAR_NET;           break
        case 'lstPct':  va = a.LEISTUNGSSTAND_PERCENT; vb = b.LEISTUNGSSTAND_PERCENT; break
        case 'lstEur':  va = a.EARNED_VALUE_NET;       vb = b.EARNED_VALUE_NET;       break
        case 'rest':    va = a.REST_HONORAR;           vb = b.REST_HONORAR;           break
        case 'hours':   va = a.HOURS_TOTAL;            vb = b.HOURS_TOTAL;            break
        case 'cost':    va = a.COST_TOTAL;             vb = b.COST_TOTAL;             break
        case 'kq':      va = a.KOSTENQUOTE ?? -1;      vb = b.KOSTENQUOTE ?? -1;      break
        default:        return 0
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ?  1 : -1
      return 0
    })
    return arr
  }, [filtered, sortField, sortDir])

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="form-group" style={{ maxWidth: 400, marginBottom: 0 }}>
          <label>Projekt</label>
          <div ref={projectAcRef} className="project-ac-wrap" style={{ position: 'relative' }}>
            <input
              style={{ width: '100%' }}
              placeholder="Suchen oder auswählen …"
              value={projectInput}
              onFocus={() => setProjectDropdownOpen(true)}
              onChange={e => { setProjectInput(e.target.value); setProjectDropdownOpen(true) }}
            />
            {projectDropdownOpen && (
              <div className="project-ac-dropdown">
                {filteredProjects.length === 0 && (
                  <div className="project-ac-option" style={{ color: '#6b7280', fontStyle: 'italic' }}>Keine Treffer</div>
                )}
                {filteredProjects.map(p => (
                  <div key={p.ID} className="project-ac-option"
                    onMouseDown={e => {
                      e.preventDefault()
                      setProjectInput(p.NAME_SHORT + (p.NAME_LONG ? ` – ${p.NAME_LONG}` : ''))
                      setProjectDropdownOpen(false)
                      setPid(p.ID)
                    }}>
                    <span className="project-ac-short">{p.NAME_SHORT}</span>
                    {p.NAME_LONG && <span className="project-ac-long">{p.NAME_LONG}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {pid !== null && (
          <button className="btn-small" onClick={() => navigate('/projekte', { state: { tab: 'struktur', projectId: pid } })}>
            ← Projektstruktur
          </button>
        )}
      </div>

      <div className="daten-filter-bar">
        <div className="daten-filter-modes">
          {(['now', 'as_of', 'period'] as FilterMode[]).map(m => (
            <label key={m} className={`daten-filter-mode-btn${mode === m ? ' active' : ''}`}>
              <input type="radio" name="epFilterMode" value={m} checked={mode === m}
                onChange={() => setMode(m)} />
              {m === 'now' ? 'Aktuell' : m === 'as_of' ? 'Stichtag' : 'Zeitraum'}
            </label>
          ))}
        </div>
        {mode === 'as_of' && (
          <div className="daten-filter-dates">
            <label>Stichtag
              <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} />
            </label>
          </div>
        )}
        {mode === 'period' && (
          <div className="daten-filter-dates">
            <label>Von
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </label>
            <label>Bis
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </label>
          </div>
        )}
      </div>

      {pid !== null && loading && <p className="empty-note">Laden …</p>}

      {header && (
        <>
          <div className="daten-header-meta">
            {header.PROJECT_MANAGER_DISPLAY  && <span>Leitung: <strong>{header.PROJECT_MANAGER_DISPLAY}</strong></span>}
            {header.COMPANY_NAME             && <span>Firma: <strong>{header.COMPANY_NAME}</strong></span>}
            {header.PROJECT_STATUS_NAME_SHORT && <span>Status: <strong>{header.PROJECT_STATUS_NAME_SHORT}</strong></span>}
          </div>

          <div className="daten-kpi-grid">
            <KpiTile label="HONORAR inkl. Nebenkosten"  value={fmtEur(header.BUDGET_TOTAL_NET)} />
            <KpiTile label="Leistungsstand %"            value={fmtPct(header.LEISTUNGSSTAND_PERCENT)} />
            <KpiTile label="Leistungsstand (€)"          value={fmtEur(header.LEISTUNGSSTAND_VALUE)} />
            <KpiTile label="Resthonorar"                  value={fmtEur(header.REMAINING_BUDGET_NET)} />
            <KpiTile label="Stunden (int.)"               value={fmtH(header.HOURS_TOTAL)} />
            <KpiTile label="Kosten (int.)"                value={fmtEur(header.COST_TOTAL)} />
            <KpiTile label="Abgerechnet (Netto)"          value={fmtEur(header.BILLED_NET_TOTAL)} />
            <KpiTile label="ABRECHENBAR (Netto)"          value={fmtEur(header.OPEN_NET_TOTAL)} accent />
            <KpiTile label="Bezahlt (Netto)"              value={fmtEur(header.PAYED_NET_TOTAL)} />
            {header.COST_RATIO != null && (
              <KpiTile label="Kostenquote"                value={fmtPct((header.COST_RATIO ?? 0) * 100)} />
            )}
          </div>

          {/* ── Prognose (EVM) ── */}
          {(() => {
            const evm     = computeEvm(header)
            const tl      = timelineData?.data ?? []
            const avgBurn = computeBurnRate(tl.map(p => p.KOSTEN_TOTAL))
            const moRem   = monthsRemaining(evm.etc, avgBurn)
            if (evm.cpi == null) return null
            const cpiColor = evm.cpiStatus === 'good' ? '#16a34a' : evm.cpiStatus === 'warn' ? '#b45309' : '#b91c1c'
            const fmtM    = (v: number | null) => v == null ? '–' : `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(v)} Mon.`
            const fmtB    = (v: number | null) => v == null ? '–' : `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0, style: 'currency', currency: 'EUR' }).format(v)}/Mon.`
            return (
              <div className="prognose-section">
                <div className="prognose-title">Prognose</div>
                <div className="prognose-grid">
                  <div className="prognose-tile">
                    <span className="prognose-label">CPI (Effizienz)</span>
                    <span className="prognose-value" style={{ color: cpiColor }}>{fmtCpi(evm.cpi)}</span>
                    <span className="prognose-sub">{evm.cpiStatus === 'good' ? 'Unter Budget' : evm.cpiStatus === 'warn' ? 'Leicht überbudget' : 'Überbudget — Handlungsbedarf'}</span>
                  </div>
                  <div className="prognose-tile">
                    <span className="prognose-label">EAC (Progn. Gesamtkosten)</span>
                    <span className="prognose-value">{fmtEur(evm.eac)}</span>
                    <span className="prognose-sub">von {fmtEur(header.BUDGET_TOTAL_NET)} Budget</span>
                  </div>
                  <div className="prognose-tile">
                    <span className="prognose-label">VAC (Ergebnisabweichung)</span>
                    <span className="prognose-value" style={{ color: (evm.vac ?? 0) >= 0 ? '#16a34a' : '#b91c1c' }}>{fmtEur(evm.vac)}</span>
                    <span className="prognose-sub">{(evm.vac ?? 0) >= 0 ? 'Projekt im Plan' : 'Prognose: Überschreitung'}</span>
                  </div>
                  <div className="prognose-tile">
                    <span className="prognose-label">ETC (Noch zu erwartende Kosten)</span>
                    <span className="prognose-value">{fmtEur(evm.etc)}</span>
                    <span className="prognose-sub">verbleibend bis Abschluss</span>
                  </div>
                  {avgBurn != null && (
                    <div className="prognose-tile">
                      <span className="prognose-label">Burn Rate (Ø letzte 3 Perioden)</span>
                      <span className="prognose-value">{fmtB(avgBurn)}</span>
                      <span className="prognose-sub">{moRem != null ? `≈ ${fmtM(moRem)} bis Abschluss` : '–'}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <input
                type="search"
                placeholder="Suchen …"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="list-search"
              />
              {search && filtered.length !== leafRows.length && (
                <span className="empty-note" style={{ margin: 0 }}>
                  {filtered.length} von {leafRows.length}
                </span>
              )}
            </div>

            {sorted.length > 0 ? (
              <div className="list-section table-scroll">
                <table className="master-table">
                  <thead>
                    <tr>
                      <SortTh label="Strukturelement"  field="path"    current={sortField} dir={sortDir} onSort={toggleSort} />
                      <SortTh label="Honorar Netto"    field="honorar" current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Lst.stand %"      field="lstPct"  current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Lst.stand €"      field="lstEur"  current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Rest-Honorar"     field="rest"    current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Stunden"          field="hours"   current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Kosten €"         field="cost"    current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Kostenquote"      field="kq"      current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <th className="num" title="CPI (Cost-Performance-Index): Kosten-Leistung-Index">CPI</th>
                      <th className="num" title="Estimate at Completion: Prognose Gesamtkosten">EAC (Prognose)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(s => (
                      <tr key={s.STRUCTURE_ID}>
                        <td>
                          {s.ancestorPath && (
                            <span className="tree-name-long">{s.ancestorPath} › </span>
                          )}
                          <strong>{s.displayLabel}</strong>
                        </td>
                        <td className="num">{fmtEur(s.HONORAR_NET)}</td>
                        <td className="num">{fmtPct(s.LEISTUNGSSTAND_PERCENT)}</td>
                        <td className="num">{fmtEur(s.EARNED_VALUE_NET)}</td>
                        <td className="num">{fmtEur(s.REST_HONORAR)}</td>
                        <td className="num">{fmtH(s.HOURS_TOTAL)}</td>
                        <td className="num">{fmtEur(s.COST_TOTAL)}</td>
                        <td className="num">
                          {s.KOSTENQUOTE != null ? fmtPct(s.KOSTENQUOTE * 100) : '—'}
                        </td>
                        {(() => {
                          const evm = computeEvm({ BUDGET_TOTAL_NET: s.HONORAR_NET, LEISTUNGSSTAND_VALUE: s.EARNED_VALUE_NET, COST_TOTAL: s.COST_TOTAL })
                          const color = evm.cpiStatus === 'good' ? '#16a34a' : evm.cpiStatus === 'warn' ? '#b45309' : evm.cpiStatus === 'bad' ? '#b91c1c' : 'var(--text-3)'
                          return (
                            <>
                              <td className="num" style={{ color, fontWeight: evm.cpi != null ? 600 : undefined }}>{fmtCpi(evm.cpi)}</td>
                              <td className="num">{fmtEur(evm.eac)}</td>
                            </>
                          )
                        })()}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {(() => {
                      // Sum of displayed rows (leaves) — may miss parent-level surcharges
                      const sumLeafHonorar = sorted.reduce((a, s) => a + s.HONORAR_NET, 0)
                      const sumLeafEarned  = sorted.reduce((a, s) => a + s.EARNED_VALUE_NET, 0)
                      // Use the header's project-wide BUDGET_TOTAL_NET (includes parent surcharges)
                      // — but only if it's larger than the leaf sum to avoid breaking other cases
                      const totHonorar  = header?.BUDGET_TOTAL_NET != null && Number(header.BUDGET_TOTAL_NET) >= sumLeafHonorar
                        ? Number(header.BUDGET_TOTAL_NET) : sumLeafHonorar
                      const surchargeDelta = totHonorar - sumLeafHonorar
                      const totEarned   = sumLeafEarned + (sumLeafHonorar > 0 ? surchargeDelta * Math.min(1, sumLeafEarned / sumLeafHonorar) : 0)
                      const totRest     = totHonorar - totEarned
                      const totHours    = sorted.reduce((a, s) => a + s.HOURS_TOTAL, 0)
                      const totCost     = sorted.reduce((a, s) => a + s.COST_TOTAL, 0)
                      const totLstPct   = totHonorar > 0 ? (totEarned / totHonorar) * 100 : null
                      const totKq       = totEarned > 0 ? (totCost / totEarned) * 100 : null
                      return (
                        <tr className="sum-row">
                          <td><strong>Gesamt</strong></td>
                          <td className="num"><strong>{fmtEur(totHonorar)}</strong></td>
                          <td className="num"><strong>{fmtPct(totLstPct)}</strong></td>
                          <td className="num"><strong>{fmtEur(totEarned)}</strong></td>
                          <td className="num"><strong>{fmtEur(totRest)}</strong></td>
                          <td className="num"><strong>{fmtH(totHours)}</strong></td>
                          <td className="num"><strong>{fmtEur(totCost)}</strong></td>
                          <td className="num"><strong>{totKq != null ? fmtPct(totKq) : '—'}</strong></td>
                          {(() => {
                            const totEvm = computeEvm({ BUDGET_TOTAL_NET: totHonorar, LEISTUNGSSTAND_VALUE: totEarned, COST_TOTAL: totCost })
                            const col = totEvm.cpiStatus === 'good' ? '#16a34a' : totEvm.cpiStatus === 'warn' ? '#b45309' : totEvm.cpiStatus === 'bad' ? '#b91c1c' : undefined
                            return (
                              <>
                                <td className="num" style={{ color: col }}><strong>{fmtCpi(totEvm.cpi)}</strong></td>
                                <td className="num"><strong>{fmtEur(totEvm.eac)}</strong></td>
                              </>
                            )
                          })()}
                        </tr>
                      )
                    })()}
                  </tfoot>
                </table>
              </div>
            ) : (
              !structLoading && (
                <p className="empty-note">
                  {leafRows.length === 0
                    ? 'Keine Strukturdaten vorhanden.'
                    : 'Keine Treffer für diese Suche.'}
                </p>
              )
            )}
          </div>

          {/* Timeline chart — shown when a project is selected and filter is ready */}
          {pid !== null && filterReady && (
            <ProjectTimeline projectId={pid} filter={filter} />
          )}
        </>
      )}
    </div>
  )
}
