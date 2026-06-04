import { useState, useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler,
  Tooltip, Legend,
  type ChartOptions,
} from 'chart.js'
import { Bar, Chart, Doughnut, Line } from 'react-chartjs-2'
import { Link, useNavigate } from 'react-router-dom'
import { useSession } from '@/hooks/useSession'
import { computeEvm, fmtCpi, portfolioCpi } from '@/utils/projectForecasting'
import {
  fetchDashboardKpis,
  fetchDashboardProjects,
  fetchDashboardMonthly,
  fetchDashboardByStatus,
  fetchProjectsTimeline,
  fetchDashboardAlerts,
  fetchOverdueInvoices,
  fetchTeamUtilization,
  fetchRiskProjects,
  fetchBillingSummary,
  fetchTeamHours,
  type DashboardKpis,
  type DashboardProject,
  type DashboardMonthly,
  type DashboardByStatus,
  type TimelinePoint,
  type DashboardAlert,
  type OverdueInvoice,
  type TeamMemberUtilization,
  type RiskProject,
  type BillingSummaryData,
  type TeamHoursData,
} from '@/api/reports'
import { Modal } from '@/components/ui/Modal'
import { fetchCompanies, fetchDefaults, fetchLogo } from '@/api/stammdaten'
import { fetchNumberRanges } from '@/api/numberRanges'
import {
  fetchMonthBalance, fetchRunningBalance,
  type DayBooking, type RunningMonth,
} from '@/api/mitarbeiter'
import { fetchMahnungStats, type MahnungStats, type MahnungSuggestion } from '@/api/mahnungen'
import { fetchDashboardOpenSe }     from '@/api/reports'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Filler, Tooltip, Legend)

// ── Formatters ────────────────────────────────────────────────────────────────

const FMT_EUR = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const FMT_EUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const FMT_NUM  = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const MONTHS_DE = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']

function fmtEur(v: number | null | undefined)   { return v == null ? '—' : FMT_EUR.format(v) }
function fmtH(v: number | null | undefined)     { return v == null ? '—' : FMT_NUM.format(v) + ' h' }
function fmtPct(v: number)                      { return FMT_NUM.format(v) + ' %' }
function fmtSaldo(v: number | null | undefined) {
  if (v == null) return '—'
  const abs = FMT_NUM.format(Math.abs(v)) + ' h'
  return v >= 0 ? `+${abs}` : `−${abs}`
}
function monthLabel(yyyymm: string) {
  const m = parseInt(yyyymm.split('-')[1], 10)
  return MONTHS_DE[m - 1] ?? yyyymm
}
function fmtDateDE(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── Dashboard filter types ────────────────────────────────────────────────────

type ZeitraumKey = 'last12m' | 'last6m' | 'last3m' | 'thisYear' | 'lastYear'

interface DashboardFilters {
  zeitraum:      ZeitraumKey
  abteilung:     string
  projektleiter: string
  status:        string
}

const DEFAULT_FILTERS: DashboardFilters = { zeitraum: 'last12m', abteilung: '', projektleiter: '', status: '' }

const ZEITRAUM_OPTIONS: { value: ZeitraumKey; label: string }[] = [
  { value: 'last12m',  label: 'Letzte 12 Monate' },
  { value: 'last6m',   label: 'Letzte 6 Monate'  },
  { value: 'last3m',   label: 'Letzte 3 Monate'  },
  { value: 'thisYear', label: 'Dieses Jahr'       },
  { value: 'lastYear', label: 'Letztes Jahr'      },
]

function computeDateRange(z: ZeitraumKey): { dateFrom: string; dateTo: string } {
  const today = new Date()
  const dateTo = today.toISOString().substring(0, 10)
  if (z === 'last3m')    { const d = new Date(today); d.setMonth(d.getMonth() - 3);  return { dateFrom: d.toISOString().substring(0, 10), dateTo } }
  if (z === 'last6m')    { const d = new Date(today); d.setMonth(d.getMonth() - 6);  return { dateFrom: d.toISOString().substring(0, 10), dateTo } }
  if (z === 'thisYear')  return { dateFrom: `${today.getFullYear()}-01-01`, dateTo }
  if (z === 'lastYear')  { const y = today.getFullYear() - 1; return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` } }
  const d = new Date(today); d.setMonth(d.getMonth() - 12); return { dateFrom: d.toISOString().substring(0, 10), dateTo }
}

// ── Shared sub-components ────────────────────────────────────────────────────

function KpiCard({ label, value, meta, accent }: { label: string; value: string; meta?: string; accent?: boolean }) {
  return (
    <div className={`kpi-card${accent ? ' kpi-card-accent' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {meta && <div className="kpi-meta">{meta}</div>}
    </div>
  )
}

function MonthlyChart({ data }: { data: DashboardMonthly[] }) {
  const labels = data.map(r => monthLabel(r.MONTH))
  const hours  = data.map(r => Number(r.HOURS_TOTAL) || 0)
  const costs  = data.map(r => Number(r.COST_TOTAL)  || 0)
  return (
    <Bar
      data={{
        labels,
        datasets: [
          { label: 'Stunden (h)', data: hours, backgroundColor: 'rgba(59,130,246,0.65)', borderRadius: 5, yAxisID: 'yH' },
          { label: 'Kosten (€)',  data: costs,  backgroundColor: 'rgba(249,115,22,0.55)',  borderRadius: 5, yAxisID: 'yC' },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 10 } } },
        scales: {
          yH: { type: 'linear', position: 'left',  ticks: { font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
          yC: { type: 'linear', position: 'right', ticks: { font: { size: 10 }, callback: v => fmtEur(v as number) }, grid: { display: false } },
          x:  { ticks: { font: { size: 11 } }, grid: { display: false } },
        },
      }}
    />
  )
}

function DonutChart({ billed, open, remaining }: { billed: number; open: number; remaining: number }) {
  const total   = billed + open + remaining
  const colors  = ['rgba(34,197,94,0.75)', 'rgba(59,130,246,0.75)', 'rgba(156,163,175,0.45)']
  const labels  = ['Abgerechnet', 'Offene Leistung', 'Noch zu erbringen']
  const values  = [billed, open, remaining]
  return (
    <div className="donut-wrap">
      <div className="donut-canvas-wrap">
        <Doughnut
          data={{ labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] }}
          options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '65%' }}
        />
      </div>
      <div className="donut-legend">
        {labels.map((lbl, i) => {
          const pct = total > 0 ? ((values[i] / total) * 100).toFixed(0) : '0'
          return (
            <div key={lbl} className="donut-legend-item">
              <span className="donut-legend-dot" style={{ background: colors[i] }} />
              <span>{lbl}: <strong>{fmtEur(values[i])}</strong> ({pct}%)</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function deriveRiskFromProject(p: DashboardProject): RiskProject {
  const budget    = Number(p.BUDGET_TOTAL_NET    || 0)
  const costs     = Number(p.COST_TOTAL          || 0)
  const leistung  = Number(p.LEISTUNGSSTAND_VALUE || 0)
  const openNet   = Number(p.OPEN_NET_TOTAL       || 0)
  const costRatio = budget > 0 ? costs / budget : 0
  const db        = leistung - costs
  const cpi = costs > 100 && leistung > 0 ? leistung / costs : null
  const flags: string[] = []
  if (budget > 0 && costRatio >= 0.9)                     flags.push('budget_kritisch')
  if (db < 0 && (costs > 500 || leistung > 500))          flags.push('db_negativ')
  if (budget > 0 && costRatio >= 0.75 && costRatio < 0.9) flags.push('budget_warn')
  if (openNet > 5000)                                      flags.push('abrechnung_potential')
  if (cpi != null && cpi < 0.80 && !flags.includes('budget_kritisch')) flags.push('cpi_warn')
  let ampel: 'rot' | 'orange' | 'gelb' | 'gruen' = 'gruen'
  if (flags.includes('budget_kritisch') || flags.includes('db_negativ')) ampel = 'rot'
  else if (flags.includes('budget_warn'))                                 ampel = 'orange'
  else if (flags.includes('abrechnung_potential'))                        ampel = 'gelb'
  return {
    PROJECT_ID:                Number(p.PROJECT_ID || 0),
    NAME_SHORT:                p.NAME_SHORT ?? '',
    NAME_LONG:                 p.NAME_LONG,
    PROJECT_STATUS_ID:         p.PROJECT_STATUS_ID,
    PROJECT_STATUS_NAME_SHORT: p.PROJECT_STATUS_NAME_SHORT,
    PROJECT_MANAGER_ID:        p.PROJECT_MANAGER_ID,
    PROJECT_MANAGER_DISPLAY:   p.PROJECT_MANAGER_DISPLAY,
    DEPARTMENT_ID:             p.DEPARTMENT_ID,
    DEPARTMENT_NAME:           p.DEPARTMENT_NAME,
    BUDGET_TOTAL_NET:          budget,
    LEISTUNGSSTAND_PERCENT:    p.LEISTUNGSSTAND_PERCENT,
    LEISTUNGSSTAND_VALUE:      leistung,
    COST_TOTAL:                costs,
    COST_RATIO:                costRatio,
    BILLED_NET_TOTAL:          Number(p.BILLED_NET_TOTAL || 0),
    OPEN_NET_TOTAL:            openNet,
    ampel, flags, db,
  }
}

function budgetHealthClass(cost: number | null, budget: number | null): string {
  if (!budget || budget <= 0) return ''
  const ratio = Number(cost || 0) / Number(budget)
  if (ratio >= 0.9) return 'budget-red'
  if (ratio >= 0.8) return 'budget-amber'
  return 'budget-green'
}

function ProjectTable({ projects, maxRows }: { projects: DashboardProject[]; maxRows?: number }) {
  const navigate = useNavigate()
  const rows = maxRows ? projects.slice(0, maxRows) : projects
  if (!rows.length) return <p className="empty-note">Keine Projekte gefunden.</p>
  return (
    <table className="dash-table dash-table-clickable">
      <thead>
        <tr>
          <th>Projekt</th>
          <th className="num">Budget</th>
          <th className="num">Leistungsstand</th>
          <th className="num">Stunden</th>
          <th className="num">Kosten</th>
          <th className="num col-hide-mobile" style={{ width: 56 }} title="Cost Performance Index">CPI</th>
          <th className="col-hide-mobile" style={{ width: 80 }}>Budget %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p, i) => {
          const healthCls = budgetHealthClass(p.COST_TOTAL, p.BUDGET_TOTAL_NET)
          const budgetRatio = (Number(p.BUDGET_TOTAL_NET) > 0)
            ? Math.min(Number(p.COST_TOTAL || 0) / Number(p.BUDGET_TOTAL_NET), 1)
            : 0
          const barColor = budgetRatio >= 0.9 ? 'var(--danger,#c0392b)' : budgetRatio >= 0.8 ? '#b45309' : 'var(--success,#2e7d32)'
          return (
            <tr
              key={i}
              className={`${healthCls} ${p.PROJECT_ID ? 'clickable-row' : ''}`.trim()}
              onClick={() => p.PROJECT_ID && navigate('/daten', { state: { tab: 'einzelprojekt', projectId: p.PROJECT_ID } })}
              title={p.PROJECT_ID ? 'Projektbericht öffnen' : undefined}
            >
              <td>{p.NAME_SHORT || p.NAME_LONG || '—'}</td>
              <td className="num">{fmtEur(p.BUDGET_TOTAL_NET)}</td>
              <td className="num">{fmtEur(p.LEISTUNGSSTAND_VALUE)}</td>
              <td className="num">{fmtH(p.HOURS_TOTAL)}</td>
              <td className="num">{fmtEur(p.COST_TOTAL)}</td>
              <td className="num col-hide-mobile">
                {(() => {
                  const evm = computeEvm(p)
                  if (evm.cpi == null) return <span style={{ color: 'var(--text-4)' }}>–</span>
                  const color = evm.cpiStatus === 'good' ? '#16a34a' : evm.cpiStatus === 'warn' ? '#b45309' : '#b91c1c'
                  return <span style={{ color, fontWeight: 600, fontSize: 12 }}>{fmtCpi(evm.cpi)}</span>
                })()}
              </td>
              <td className="col-hide-mobile">
                {Number(p.BUDGET_TOTAL_NET) > 0 ? (
                  <div className="budget-bar-wrap">
                    <div className="budget-bar-track">
                      <div className="budget-bar-fill" style={{ width: `${Math.round(budgetRatio * 100)}%`, background: barColor }} />
                    </div>
                    <span className="budget-bar-pct">{Math.round(budgetRatio * 100)}%</span>
                  </div>
                ) : <span style={{ color: 'var(--text-4)', fontSize: 11 }}>—</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function StatusList({ items }: { items: DashboardByStatus[] }) {
  if (!items.length) return <p className="empty-note">Keine Daten.</p>
  const max = Math.max(...items.map(r => Number(r.PROJECT_COUNT) || 0), 1)
  return (
    <div className="status-list">
      {items.map((r, i) => {
        const count = Number(r.PROJECT_COUNT) || 0
        const pct   = Math.round((count / max) * 100)
        return (
          <div key={i} className="status-row">
            <div className="status-label-row">
              <span>{r.STATUS_NAME || '—'}</span>
              <span className="status-count">{count}</span>
            </div>
            <div className="status-bar-wrap">
              <div className="status-bar" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Timeline chart ────────────────────────────────────────────────────────────

function DashboardTimeline({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['projects-timeline', dateFrom, dateTo],
    queryFn:  () => fetchProjectsTimeline({ mode: 'period', dateFrom, dateTo }),
    staleTime: 300000,
  })

  const points: TimelinePoint[] = data?.data ?? []
  if (isLoading) return <div className="timeline-wrap"><p className="empty-note">Laden …</p></div>
  if (points.length === 0) return null

  const labels   = points.map(p => fmtDateDE(p.DATE))
  const ptRadius = points.length > 60 ? 0 : 3

  const chartData = {
    labels,
    datasets: [
      { label: 'Honorar inkl. NK', data: points.map(p => p.HONORAR_NET), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.07)', fill: true, tension: 0.35, pointRadius: ptRadius, pointHoverRadius: 6, borderWidth: 2 },
      { label: 'Leistungsstand €', data: points.map(p => p.LEISTUNGSSTAND_VALUE), borderColor: '#10b981', backgroundColor: 'transparent', fill: false, tension: 0.35, pointRadius: ptRadius, pointHoverRadius: 6, borderWidth: 2 },
      { label: 'Kosten €', data: points.map(p => p.KOSTEN_TOTAL), borderColor: '#f59e0b', backgroundColor: 'transparent', fill: false, tension: 0.35, pointRadius: ptRadius, pointHoverRadius: 6, borderWidth: 2 },
      { label: 'Abgerechnet €', data: points.map(p => p.ABGERECHNET_NET), borderColor: '#8b5cf6', backgroundColor: 'transparent', fill: false, tension: 0.35, borderDash: [6, 3], pointRadius: ptRadius, pointHoverRadius: 6, borderWidth: 1.5 },
      { label: 'Bezahlt €', data: points.map(p => p.BEZAHLT_NET), borderColor: '#06b6d4', backgroundColor: 'transparent', fill: false, tension: 0.35, borderDash: [6, 3], pointRadius: ptRadius, pointHoverRadius: 6, borderWidth: 1.5 },
    ],
  }

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 16, font: { size: 12 } } },
      tooltip: {
        backgroundColor: 'rgba(17,24,39,0.92)', titleColor: '#f9fafb', bodyColor: '#d1d5db', padding: 12, cornerRadius: 8,
        callbacks: { label: (ctx) => `  ${ctx.dataset.label ?? ''}: ${FMT_EUR.format(ctx.parsed.y ?? 0)}` },
      },
    },
    scales: {
      x: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { maxRotation: 45, maxTicksLimit: 12, font: { size: 11 }, color: '#6b7280' } },
      y: { grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { font: { size: 11 }, color: '#6b7280', callback: (v) => FMT_EUR0.format(Number(v)) } },
    },
  }

  return (
    <div className="timeline-wrap">
      <h3 className="timeline-title">Projektverlauf {dateFrom.substring(0, 4)}{dateFrom.substring(0, 4) !== dateTo.substring(0, 4) ? `–${dateTo.substring(0, 4)}` : ''}</h3>
      <div className="timeline-chart"><Line data={chartData} options={options} /></div>
    </div>
  )
}

// ── Setup checklist ───────────────────────────────────────────────────────────

const CURRENT_YEAR   = new Date().getFullYear()
const SETUP_DONE_KEY = 'plain_setup_checklist_done'

function SetupChecklist() {
  const [dismissed] = useState(() => localStorage.getItem(SETUP_DONE_KEY) === '1')
  const { data: companiesData, isLoading: l1, isFetching: f1 } = useQuery({ queryKey: ['companies'],     queryFn: fetchCompanies,                           staleTime: 60000 })
  const { data: defaultsData,  isLoading: l2, isFetching: f2 } = useQuery({ queryKey: ['defaults'],      queryFn: fetchDefaults,                            staleTime: 60000 })
  const { data: logoData,      isLoading: l3, isFetching: f3 } = useQuery({ queryKey: ['logo'],          queryFn: fetchLogo,                                staleTime: 60000 })
  const { data: nrData,        isLoading: l4, isFetching: f4 } = useQuery({ queryKey: ['number-ranges', CURRENT_YEAR], queryFn: () => fetchNumberRanges(CURRENT_YEAR), staleTime: 60000 })
  if (dismissed || l1 || l2 || l3 || l4 || f1 || f2 || f3 || f4) return null
  const companies = companiesData?.data ?? []
  const defaults  = defaultsData?.data  ?? {}
  const logoId    = logoData?.data?.logo_asset_id ?? null
  const hasCompany = companies.some(c => c.COMPANY_NAME_1?.trim() && c.STREET?.trim() && c.CITY?.trim())
  const hasLogo    = logoId !== null
  const hasVat     = !!defaults.default_vat_id
  const hasNr      = nrData != null
  const items = [
    { done: hasCompany, label: 'Firmendaten vervollständigen',   hint: 'Name, Adresse, Steuernummer',           tab: 'unternehmen'   },
    { done: hasLogo,    label: 'Firmenlogo hochladen',           hint: 'Wird auf PDFs angezeigt',               tab: 'unternehmen'   },
    { done: hasVat,     label: 'Standard-MwSt. festlegen',       hint: 'Für neue Verträge & Angebote',          tab: 'vorbelegungen' },
    { done: hasNr,      label: 'Nummernkreise konfigurieren',    hint: 'Rechnungs-, Projekt-, Angebotsnummern', tab: 'nummernkreise' },
  ]
  const allDone = items.every(i => i.done)
  if (allDone) { localStorage.setItem(SETUP_DONE_KEY, '1'); return null }
  const doneCount = items.filter(i => i.done).length
  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '14px 18px', marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Einrichtung abschließen</strong>
        <span style={{ fontSize: 12, color: '#92400e' }}>{doneCount}/{items.length} erledigt</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, lineHeight: 1, color: item.done ? '#16a34a' : '#d97706' }}>{item.done ? '✓' : '○'}</span>
            <div style={{ flex: 1 }}>
              {item.done
                ? <span style={{ fontSize: 12, color: '#6b7280', textDecoration: 'line-through' }}>{item.label}</span>
                : <Link to={`/admin?tab=${item.tab}`} style={{ fontSize: 12, color: '#1d4ed8', textDecoration: 'none', fontWeight: 500 }}>{item.label}</Link>}
              <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>{item.hint}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Alert strip ───────────────────────────────────────────────────────────────

function AlertStrip({ alerts }: { alerts: DashboardAlert[] }) {
  const navigate = useNavigate()
  if (!alerts.length) return null
  return (
    <div className="alert-strip">
      {alerts.map((a, i) => (
        <button
          key={i}
          className={`alert-chip alert-chip-${a.severity}`}
          onClick={() => navigate(a.action_url)}
        >
          <span className={`alert-dot alert-dot-${a.severity}`} />
          {a.message}
        </button>
      ))}
    </div>
  )
}

// ── Team utilization chart ────────────────────────────────────────────────────

function TeamUtilizationChart({ data }: { data: TeamMemberUtilization[] }) {
  if (!data.length) return <p className="empty-note">Keine Buchungen in den letzten 28 Tagen.</p>
  const sorted = [...data].sort((a, b) => b.hours_4weeks - a.hours_4weeks)
  const values = sorted.map(e => e.hours_4weeks)
  const maxH   = Math.max(...values, 1)
  return (
    <div className="util-bar-chart">
      {sorted.map((e, i) => {
        const pct = Math.round((e.hours_4weeks / maxH) * 100)
        return (
          <div key={i} className="util-bar-row">
            <span className="util-bar-label">{e.short_name}</span>
            <div className="util-bar-track">
              <div className="util-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="util-bar-value">{fmtH(e.hours_4weeks)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Overdue invoices table ────────────────────────────────────────────────────

function OverdueInvoicesTable({ invoices }: { invoices: OverdueInvoice[] }) {
  const navigate = useNavigate()
  if (!invoices.length) {
    return (
      <div className="narrative-block" style={{ background: 'rgba(34,197,94,0.08)', borderLeft: '3px solid #22c55e' }}>
        Keine überfälligen Rechnungen. Alle offenen Forderungen sind im Zeitplan.
      </div>
    )
  }
  return (
    <table className="dash-table dash-table-clickable">
      <thead>
        <tr>
          <th>Nr.</th>
          <th>Rechnungsdatum</th>
          <th>Fälligkeit</th>
          <th className="num">Tage überfällig</th>
          <th className="num">Betrag</th>
        </tr>
      </thead>
      <tbody>
        {invoices.map(inv => {
          const dClass = inv.days_overdue > 30 ? 'overdue-red' : inv.days_overdue > 14 ? 'overdue-amber' : ''
          const invoiceNum = inv.INVOICE_NUMBER || String(inv.ID)
          return (
            <tr
              key={inv.ID}
              className="clickable-row"
              onClick={() => navigate('/rechnungen', { state: { projectSearch: invoiceNum } })}
              title="Rechnung in der Rechnungsliste öffnen"
            >
              <td>{inv.INVOICE_NUMBER || `#${inv.ID}`}</td>
              <td>{inv.INVOICE_DATE ? fmtDateDE(inv.INVOICE_DATE) : '—'}</td>
              <td>{fmtDateDE(inv.DUE_DATE)}</td>
              <td className={`num ${dClass}`}><strong>{inv.days_overdue}</strong></td>
              <td className="num">{fmtEur(inv.TOTAL_AMOUNT_NET)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Narrative block helper ────────────────────────────────────────────────────

function NarrativeBlock({ children }: { children: React.ReactNode }) {
  return <div className="narrative-block">{children}</div>
}

// ── Role selector ─────────────────────────────────────────────────────────────

const ROLES = [
  {
    id:    'geschaeftsleitung',
    icon:  '📈',
    title: 'Geschäftsleitung',
    desc:  'Gesamtüberblick über Honorare, Leistungsstand, Projektportfolio und strategische KPIs.',
  },
  {
    id:    'controller',
    icon:  '💰',
    title: 'Controller / Buchhaltung',
    desc:  'Rechnungen, Zahlungsstatus, überfällige Forderungen und monatliche Kostenentwicklung.',
  },
  {
    id:    'bereichsleiter',
    icon:  '🏗',
    title: 'Bereichsleiter',
    desc:  'Projektportfolio, Team-Auslastung, Budget-Gesundheit und Ressourcensteuerung.',
  },
  {
    id:    'mitarbeiter',
    icon:  '🕐',
    title: 'Mitarbeiter',
    desc:  'Eigene Stunden, Zeitkonto-Saldo, heutige Buchungen und Monatsverlauf.',
  },
]

function RoleSelector({ onSelect }: { onSelect: (role: string) => void }) {
  return (
    <div className="role-selector-wrap">
      <h2 className="role-selector-title">Wählen Sie Ihre Dashboard-Ansicht</h2>
      <p className="role-selector-sub">Die Auswahl wird lokal gespeichert und kann jederzeit geändert werden.</p>
      <div className="role-selector">
        {ROLES.map(r => (
          <button key={r.id} className="role-card" onClick={() => onSelect(r.id)}>
            <span className="role-card-icon">{r.icon}</span>
            <span className="role-card-title">{r.title}</span>
            <span className="role-card-desc">{r.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Role views ────────────────────────────────────────────────────────────────

function GeschaeftsleitungView({
  projects, byStatus, alerts, riskProjects, billingSummary, teamHours, dateFrom, dateTo,
  subPage, onSubPageChange,
}: {
  projects: DashboardProject[]; byStatus: DashboardByStatus[]; alerts: DashboardAlert[];
  riskProjects: RiskProject[]; billingSummary: BillingSummaryData | null; teamHours: TeamHoursData | null;
  dateFrom: string; dateTo: string;
  subPage: 'uebersicht' | 'risiko' | 'abrechnung' | 'personal';
  onSubPageChange: (id: string) => void;
}) {
  const honorar     = projects.reduce((s, p) => s + Number(p.BUDGET_TOTAL_NET    || 0), 0)
  const leistung    = projects.reduce((s, p) => s + Number(p.LEISTUNGSSTAND_VALUE || 0), 0)
  const offeneLeist = projects.reduce((s, p) => s + Number(p.OPEN_NET_TOTAL      || 0), 0)
  const leistPct    = honorar > 0 ? (leistung / honorar) * 100 : 0
  const budgetAlerts = alerts.filter(a => a.type === 'budget_critical')
  const atRiskCount  = budgetAlerts[0]?.count ?? 0
  const activeCount  = projects.length

  return (
    <>
      <SubNav
        options={[
          { id: 'uebersicht',  label: 'Übersicht'     },
          { id: 'risiko',      label: 'Projekte'       },
          { id: 'abrechnung',  label: 'Abrechnung'     },
          { id: 'personal',    label: 'Personal'       },
        ]}
        active={subPage}
        onChange={onSubPageChange}
      />

      {subPage === 'uebersicht' && (<>
        <AlertStrip alerts={alerts} />

        <div className="kpi-grid">
          <KpiCard label="Honorar gesamt"   value={fmtEur(honorar)}    />
          <KpiCard label="Offene Leistung"  value={fmtEur(offeneLeist)} />
          <KpiCard label="Leistungsstand"   value={fmtEur(leistung)}   meta={`${fmtPct(leistPct)} des Honorars`} />
          <KpiCard label="Aktive Projekte"  value={String(activeCount)} />
          {(() => {
            const cpi = portfolioCpi(projects)
            const vacTotal = projects.reduce((s, p) => { const v = computeEvm(p).vac; return s + (v ?? 0) }, 0)
            return <>
              <KpiCard label="Portfolio-CPI" value={fmtCpi(cpi)} meta={cpi == null ? undefined : cpi >= 0.95 ? 'Effizient' : cpi >= 0.80 ? 'Leicht überbudget' : 'Überbudget'} accent={cpi != null && cpi < 0.80} />
              <KpiCard label="Prognose-Ergebnis (VAC)" value={fmtEur(vacTotal)} meta={vacTotal >= 0 ? 'Projekte im Plan' : 'Progn. Überschreitung'} accent={vacTotal < 0} />
            </>
          })()}
        </div>

        <NarrativeBlock>
          Honorar gesamt: <strong>{fmtEur(honorar)}</strong>. Leistungsstand bei{' '}
          <strong>{fmtPct(leistPct)}</strong> — {leistPct >= 80 ? 'gut im Plan' : leistPct >= 50 ? 'im Aufbau' : 'frühe Phase'}.
          {' '}{activeCount} Projekt{activeCount !== 1 ? 'e' : ''} aktiv
          {atRiskCount > 0 ? `, davon ${atRiskCount} über 90% Budget` : ', alle im Budget-Rahmen'}.
          {' '}Offene Leistung zu fakturieren: <strong>{fmtEur(offeneLeist)}</strong>.
        </NarrativeBlock>

        <DashboardTimeline dateFrom={dateFrom} dateTo={dateTo} />

        <div className="dash-two-col">
          <div className="dash-card">
            <div className="dash-card-title">Top-Projekte</div>
            <ProjectTable projects={projects} maxRows={5} />
          </div>
          <div className="dash-card">
            <div className="dash-card-title">Leistungsverteilung</div>
            <DonutChart
              billed={projects.reduce((s, p) => s + Number(p.BILLED_NET_TOTAL || 0), 0)}
              open={offeneLeist}
              remaining={Math.max(0, honorar - leistung)}
            />
            <div className="dash-card-title" style={{ marginTop: 20 }}>Projekte nach Status</div>
            <StatusList items={byStatus} />
          </div>
        </div>
      </>)}

      {subPage === 'risiko'     && <RisikoView projects={riskProjects} />}
      {subPage === 'abrechnung' && <AbrechnungView billing={billingSummary} />}
      {subPage === 'personal'   && <PersonalView teamHours={teamHours} dateFrom={dateFrom} dateTo={dateTo} />}
    </>
  )
}

const STUFEN_LABELS_DASH: Record<number, string> = {
  0: 'Keine', 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung', 4: '3. Mahnung',
}

const FMT_EUR_DASH = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

function SuggestionRow({ s, navigate }: { s: MahnungSuggestion; navigate: ReturnType<typeof useNavigate> }) {
  const isActionDue = s.reason === 'action_due'
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: isActionDue ? 'rgba(220,38,38,0.05)' : 'transparent', border: isActionDue ? '1px solid rgba(220,38,38,0.15)' : '1px solid transparent', marginBottom: 3 }}
      onClick={() => navigate('/rechnungen', { state: { tab: 'mahnungen', openMahnung: { sourceType: s.sourceType, sourceId: s.sourceId } } })}
      title="Mahnung direkt öffnen"
    >
      <span className={`mahnstufe-badge ms-${s.mahnstufe}`} style={{ flexShrink: 0 }}>{STUFEN_LABELS_DASH[s.mahnstufe]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {s.number}{s.addressName1 ? ` · ${s.addressName1}` : ''}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
          {s.daysOverdue}d überfällig
          {isActionDue ? ' · Aktion fällig!' : ' · noch keine Mahnung'}
        </div>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', flexShrink: 0 }}>{FMT_EUR_DASH.format(s.openAmount)}</span>
    </div>
  )
}

function MahnungsStatusCard({ stats }: { stats: MahnungStats }) {
  const navigate = useNavigate()
  const stufen   = [1, 2, 3, 4].filter(s => (stats.byStufe[s] ?? 0) > 0)

  return (
    <div className="dash-card">
      <div className="dash-card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Offene Mahnvorgänge</span>
        <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => navigate('/rechnungen?tab=mahnungen')}>
          → Mahnungen öffnen
        </button>
      </div>

      {/* Primary alert: urgent count */}
      {stats.overdueActionsCount > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 14px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', cursor: 'pointer' }}
          onClick={() => navigate('/rechnungen?tab=mahnungen')}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#991b1b' }}>
              {stats.overdueActionsCount} Aktion{stats.overdueActionsCount !== 1 ? 'en' : ''} fällig
            </div>
            <div style={{ fontSize: 12, color: '#b91c1c' }}>
              {stats.noDunningCount > 0 ? `${stats.noDunningCount} noch ungemahnt` : 'Nächste Mahnung überfällig'}
            </div>
          </div>
        </div>
      ) : stats.totalOverdue === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 12px', background: 'rgba(34,197,94,0.07)', borderRadius: 8, border: '1px solid rgba(34,197,94,0.25)' }}>
          <span style={{ color: '#16a34a', fontSize: 14 }}>✓</span>
          <span style={{ fontSize: 13, color: '#15803d' }}>Keine überfälligen Rechnungen</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 12px', background: 'rgba(234,179,8,0.07)', borderRadius: 8, border: '1px solid rgba(234,179,8,0.3)' }}>
          <span style={{ color: '#b45309', fontSize: 14 }}>ℹ</span>
          <span style={{ fontSize: 13, color: '#92400e' }}>{stats.totalOverdue} überfällig, alle in Bearbeitung</span>
        </div>
      )}

      {/* Suggestions */}
      {(stats.suggestions ?? []).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-4)', marginBottom: 6 }}>
            Vorschläge für nächste Aktionen
          </div>
          {stats.suggestions.map((s, i) => (
            <SuggestionRow key={i} s={s} navigate={navigate} />
          ))}
        </div>
      )}

      {/* Breakdown by stufe */}
      {(stats.byStufe[0] ?? 0) + stufen.reduce((a, s) => a + (stats.byStufe[s] ?? 0), 0) > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-4)', marginBottom: 6 }}>
            {stats.totalOpen} offene Vorgänge nach Stufe
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {(stats.byStufe[0] ?? 0) > 0 && (
              <div className="mahnung-stufe-row">
                <span className="mahnstufe-badge ms-0">Noch keine Mahnung</span>
                <span className="count">{stats.byStufe[0]}</span>
              </div>
            )}
            {stufen.map(s => (
              <div key={s} className="mahnung-stufe-row">
                <span className={`mahnstufe-badge ms-${s}`}>{STUFEN_LABELS_DASH[s]}</span>
                <span className="count">{stats.byStufe[s]}</span>
              </div>
            ))}
          </div>
          {stats.totalClosed > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 8 }}>
              {stats.totalClosed} abgeschlossen
            </div>
          )}
        </div>
      )}

      {stats.totalOverdue === 0 && (stats.suggestions ?? []).length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-4)', margin: 0 }}>Keine überfälligen Rechnungen.</p>
      )}
    </div>
  )
}

function ControllerView({
  kpis, monthly, alerts, overdueInvoices, mahnStats,
}: {
  kpis: DashboardKpis; monthly: DashboardMonthly[]; alerts: DashboardAlert[];
  overdueInvoices: OverdueInvoice[]; mahnStats: MahnungStats | null;
}) {
  const openSeQ = useQuery({
    queryKey: ['dashboard', 'open-se'],
    queryFn:  fetchDashboardOpenSe,
    staleTime: 300000,
  })
  const openSe = openSeQ.data?.data ?? null

  const overdueTotal = overdueInvoices.reduce((s, inv) => s + Number(inv.TOTAL_AMOUNT_NET || 0), 0)
  const avgMonthlyCost = monthly.length
    ? monthly.reduce((s, m) => s + (Number(m.COST_TOTAL) || 0), 0) / monthly.length
    : 0

  return (
    <>
      <AlertStrip alerts={alerts} />

      <div className="kpi-grid">
        <KpiCard label="Abschlagsrechnungen"     value={fmtEur(kpis.ABSCHLAGSRECHNUNGEN)} />
        <KpiCard label="Schlussgerechnet"         value={fmtEur(kpis.SCHLUSSGERECHNET)}   />
        <KpiCard
          label="Überfällige Rechnungen"
          value={overdueInvoices.length > 0 ? String(overdueInvoices.length) : '—'}
          meta={overdueInvoices.length > 0 ? fmtEur(overdueTotal) : undefined}
          accent={overdueInvoices.length > 0}
        />
        {mahnStats && (
          <KpiCard
            label="Überfällige Rechnungen"
            value={String(mahnStats.totalOverdue)}
            meta={mahnStats.overdueActionsCount > 0 ? `${mahnStats.overdueActionsCount} Aktion(en) fällig` : mahnStats.noDunningCount > 0 ? `${mahnStats.noDunningCount} ungemahnt` : undefined}
            accent={mahnStats.overdueActionsCount > 0}
          />
        )}
        {!mahnStats && <KpiCard label="Offene Leistung" value={fmtEur(kpis.OFFENE_LEISTUNG)} />}
        {openSe && openSe.totalOpen > 0 && (
          <KpiCard
            label="Offene Sicherheitseinbehalte"
            value={fmtEur(openSe.totalOpen)}
            meta={`${openSe.count} ${openSe.count === 1 ? 'Eintrag' : 'Einträge'} aus ${openSe.byProject.length} ${openSe.byProject.length === 1 ? 'Projekt' : 'Projekten'}`}
          />
        )}
      </div>

      <NarrativeBlock>
        {overdueInvoices.length > 0
          ? <>
              <strong>{overdueInvoices.length} Rechnung{overdueInvoices.length !== 1 ? 'en' : ''}</strong> sind
              insgesamt <strong>{fmtEur(overdueTotal)}</strong> überfällig.{' '}
            </>
          : 'Keine überfälligen Rechnungen. '}
        Monatliche Kosten Ø (letzte {monthly.length} Monate): <strong>{fmtEur(avgMonthlyCost)}</strong>.
        Zu fakturierende Leistung: <strong>{fmtEur(kpis.OFFENE_LEISTUNG)}</strong>.
        {mahnStats && mahnStats.totalOverdue > 0 && (
          <> {mahnStats.totalOverdue} überfällige Rechnung{mahnStats.totalOverdue !== 1 ? 'en' : ''}
          {mahnStats.noDunningCount > 0 ? `, davon ${mahnStats.noDunningCount} noch ungemahnt` : ''}
          {mahnStats.overdueActionsCount > 0 ? `, ${mahnStats.overdueActionsCount} mit fälliger Mahnaktion` : ''}.
          </>
        )}
      </NarrativeBlock>

      <div className="dash-card">
        <div className="dash-card-title">Überfällige Rechnungen</div>
        <OverdueInvoicesTable invoices={overdueInvoices} />
      </div>

      {mahnStats && <MahnungsStatusCard stats={mahnStats} />}

      <div className="dash-card">
        <div className="dash-card-title">Stunden &amp; Kosten (letzte Monate)</div>
        <div className="chart-wrap">
          <MonthlyChart data={monthly} />
        </div>
      </div>
    </>
  )
}

function BereichsleiterView({
  projects, byStatus, alerts, teamUtil, riskProjects, teamHours, monthly, dateFrom, dateTo,
  subPage, onSubPageChange,
}: {
  projects: DashboardProject[]; byStatus: DashboardByStatus[]; alerts: DashboardAlert[];
  teamUtil: TeamMemberUtilization[]; riskProjects: RiskProject[]; teamHours: TeamHoursData | null;
  monthly: DashboardMonthly[]; dateFrom: string; dateTo: string;
  subPage: 'uebersicht' | 'risiko' | 'personal';
  onSubPageChange: (id: string) => void;
}) {
  const budgetHealthy = projects.filter(p =>
    Number(p.BUDGET_TOTAL_NET) > 0 &&
    Number(p.COST_TOTAL) / Number(p.BUDGET_TOTAL_NET) < 0.8
  ).length
  const budgetHealthPct = projects.length > 0 ? Math.round((budgetHealthy / projects.length) * 100) : 0
  const totalHours4w    = teamUtil.reduce((s, e) => s + e.hours_4weeks, 0)
  const offeneLeist     = projects.reduce((s, p) => s + Number(p.OPEN_NET_TOTAL || 0), 0)
  const stundenZeitraum = monthly.reduce((s, m) => s + Number(m.HOURS_TOTAL || 0), 0)

  return (
    <>
      <SubNav
        options={[
          { id: 'uebersicht', label: 'Übersicht'     },
          { id: 'risiko',     label: 'Projekte'       },
          { id: 'personal',   label: 'Personal'       },
        ]}
        active={subPage}
        onChange={onSubPageChange}
      />

      {subPage === 'uebersicht' && (<>
        <AlertStrip alerts={alerts} />

        <div className="kpi-grid">
          <KpiCard label="Aktive Projekte"    value={String(projects.length)}              />
          <KpiCard label="Stunden (Zeitraum)" value={fmtH(stundenZeitraum)}               />
          <KpiCard label="Budget-Gesundheit"  value={fmtPct(budgetHealthPct)}              meta={`${budgetHealthy} von ${projects.length} im grünen Bereich`} />
          <KpiCard label="Offene Leistung"    value={fmtEur(offeneLeist)}                 />
        </div>

        <NarrativeBlock>
          Team-Stunden letzte 4 Wochen: <strong>{fmtH(totalHours4w)}</strong> gesamt über {teamUtil.length} Mitarbeiter.{' '}
          <strong>{budgetHealthy}</strong> von <strong>{projects.length}</strong> Projekt{projects.length !== 1 ? 'en' : ''} im grünen Bereich (unter 80% Budget).
          {budgetHealthPct < 60 && ' Mehrere Projekte benötigen Aufmerksamkeit.'}
        </NarrativeBlock>

        <div className="dash-two-col">
          <div className="dash-card">
            <div className="dash-card-title">Team-Auslastung (letzte 4 Wochen)</div>
            <TeamUtilizationChart data={teamUtil} />
          </div>
          <div className="dash-card">
            <div className="dash-card-title">Projekte nach Status</div>
            <StatusList items={byStatus} />
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-title">Projektportfolio</div>
          <ProjectTable projects={projects} />
        </div>
      </>)}

      {subPage === 'risiko'   && <RisikoView projects={riskProjects} />}
      {subPage === 'personal' && <PersonalView teamHours={teamHours} dateFrom={dateFrom} dateTo={dateTo} />}
    </>
  )
}

// ── Mitarbeiter view ─────────────────────────────────────────────────────────

function MitarbeiterBalanceChart({ months }: { months: RunningMonth[] }) {
  if (!months.length) return null
  const labels   = months.map(m => `${MONTHS_DE[m.month - 1]} ${m.year}`)
  const required = months.map(m => Math.round(m.required * 10) / 10)
  const actual   = months.map(m => Math.round(m.actual   * 10) / 10)
  const cumul    = months.map(m => Math.round(m.cumulative * 10) / 10)
  return (
    <div style={{ height: 220 }}>
      <Chart
        type='bar'
        data={{
          labels,
          datasets: [
            { type: 'bar',  label: 'Soll (h)',        data: required, backgroundColor: 'rgba(156,163,175,0.45)', borderRadius: 4, yAxisID: 'yH' },
            { type: 'bar',  label: 'Ist (h)',          data: actual,   backgroundColor: 'rgba(59,130,246,0.65)',  borderRadius: 4, yAxisID: 'yH' },
            { type: 'line', label: 'Saldo kum. (h)',   data: cumul,    borderColor: '#f59e0b', backgroundColor: 'transparent', pointRadius: 3, borderWidth: 2, yAxisID: 'yS' },
          ],
        }}
        options={{
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 10 } } },
          scales: {
            yH: { type: 'linear', position: 'left',  ticks: { font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
            yS: { type: 'linear', position: 'right', ticks: { font: { size: 10 }, callback: v => `${Number(v) >= 0 ? '+' : ''}${v} h` }, grid: { display: false } },
            x:  { ticks: { font: { size: 10 }, maxRotation: 45 }, grid: { display: false } },
          },
        }}
      />
    </div>
  )
}

function BookingsTable({ bookings }: { bookings: DayBooking[] }) {
  return (
    <table className="dash-table">
      <thead>
        <tr>
          <th>Projekt</th>
          <th>Leistungsposition</th>
          <th className="num">Stunden</th>
          <th>Notiz</th>
        </tr>
      </thead>
      <tbody>
        {bookings.map(b => (
          <tr key={b.id}>
            <td>{b.project || '—'}</td>
            <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{b.structure || '—'}</td>
            <td className="num">{fmtH(b.hours)}</td>
            <td style={{ color: 'var(--text-3)', fontSize: 12, whiteSpace: 'pre-line' }}>{b.description || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MitarbeiterView({ employeeId }: { employeeId: number }) {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth() + 1
  const today = now.toISOString().slice(0, 10)

  const { data: monthRes,   isLoading: l1 } = useQuery({
    queryKey: ['emp-balance', employeeId, year, month],
    queryFn:  () => fetchMonthBalance(employeeId, year, month),
    staleTime: 60000,
  })
  const { data: runningRes, isLoading: l2 } = useQuery({
    queryKey: ['emp-running', employeeId],
    queryFn:  () => fetchRunningBalance(employeeId),
    staleTime: 120000,
  })

  if (l1 || l2) return <div className="dash-loading">Laden …</div>

  const monthBal   = monthRes?.data
  const runningData = runningRes?.data
  const months     = runningData?.months ?? []
  const totalSaldo = runningData?.totalBalance ?? 0

  const todayDay   = monthBal?.days.find(d => d.date === today)
  const todayH     = todayDay?.actual ?? 0
  const todayBkgs  = todayDay?.bookings ?? []

  const recentDays = (monthBal?.days ?? [])
    .filter(d => d.date < today && d.bookings.length > 0)
    .slice(-7)

  const monthActual  = monthBal?.actual   ?? 0
  const monthReq     = monthBal?.required ?? 0
  const monthSaldo   = monthBal?.balance  ?? 0
  const saldoStatus  = totalSaldo >= 0 ? 'im Plus' : 'im Minus'

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Stunden diesen Monat" value={fmtH(monthActual)} meta={`von ${fmtH(monthReq)} Soll`} />
        <KpiCard label="Saldo diesen Monat"   value={fmtSaldo(monthSaldo)} accent={monthSaldo < -8} />
        <KpiCard label="Laufender Saldo"       value={fmtSaldo(totalSaldo)} accent={totalSaldo < -8} />
        <KpiCard label="Stunden heute"         value={fmtH(todayH)} />
      </div>

      <NarrativeBlock>
        Diesen Monat: <strong>{fmtH(monthActual)}</strong> von <strong>{fmtH(monthReq)}</strong> Soll-Stunden gebucht
        {monthReq > 0 ? ` (${fmtPct((monthActual / monthReq) * 100)})` : ''}.{' '}
        Monatssaldo: <strong>{fmtSaldo(monthSaldo)}</strong>.{' '}
        Laufendes Zeitkonto: <strong>{fmtSaldo(totalSaldo)}</strong> — {saldoStatus}.
      </NarrativeBlock>

      <div className="dash-card">
        <div className="dash-card-title">Monatsverlauf Stunden &amp; Saldo</div>
        <MitarbeiterBalanceChart months={months} />
      </div>

      <div className="dash-card">
        <div className="dash-card-title">Buchungen heute</div>
        {todayBkgs.length > 0
          ? <BookingsTable bookings={todayBkgs} />
          : <p className="empty-note">Noch keine Buchungen für heute erfasst.</p>
        }
      </div>

      {recentDays.length > 0 && (
        <div className="dash-card">
          <div className="dash-card-title">Letzte Buchungen dieses Monats</div>
          {recentDays.map(d => (
            <div key={d.date} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>
                {fmtDateDE(d.date)} — {fmtH(d.actual)}
              </div>
              <BookingsTable bookings={d.bookings} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── Risk cockpit helpers ──────────────────────────────────────────────────────

const FLAG_LABELS: Record<string, { label: string; sev: 'rot' | 'orange' | 'gelb' }> = {
  budget_kritisch:      { label: 'Budget >90%',         sev: 'rot'    },
  db_negativ:           { label: 'Kosten > Leistung',   sev: 'rot'    },
  budget_warn:          { label: 'Budget 75–90%',        sev: 'orange' },
  cpi_warn:             { label: 'CPI < 0.80',           sev: 'orange' },
  abrechnung_potential: { label: 'Abrechnungspotenzial', sev: 'gelb'   },
}

const ACTION_MAP: Record<string, string> = {
  budget_kritisch:      'Zusatzleistungen beauftragen oder Kosten reduzieren.',
  db_negativ:           'Kosten übersteigen Leistungsstand — Budgetgespräch führen.',
  budget_warn:          'Fortschritt und verbleibende Leistungen prüfen.',
  cpi_warn:             'Kosteneffizienz unter 0.80 — Prognose zeigt mögliche Überschreitung.',
  abrechnung_potential: 'Offene Leistungen können jetzt fakturiert werden.',
}

const AMPEL_COLORS: Record<string, string> = {
  rot: '#dc2626', orange: '#ea580c', gelb: '#ca8a04', gruen: '#16a34a',
}

const AMPEL_LABELS: Record<string, string> = {
  rot: 'Kritisch', orange: 'Warnung', gelb: 'Aufmerksamkeit', gruen: 'OK',
}

function ampelDot(ampel: string, size = 10) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: AMPEL_COLORS[ampel] ?? '#9ca3af', flexShrink: 0,
      verticalAlign: 'middle',
    }} />
  )
}

// ── Sub-navigation ────────────────────────────────────────────────────────────

function SubNav({ options, active, onChange }: {
  options: Array<{ id: string; label: string }>
  active:  string
  onChange: (id: string) => void
}) {
  return (
    <div className="dash-subnav">
      {options.map(o => (
        <button
          key={o.id}
          className={`dash-subnav-btn${active === o.id ? ' active' : ''}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Projekt detail modal ──────────────────────────────────────────────────────

function ProjektDetailModal({ project, onClose }: { project: RiskProject; onClose: () => void }) {
  const navigate = useNavigate()
  const flags    = project.flags ?? []

  return (
    <Modal open={true} onClose={onClose} title={project.NAME_SHORT} className="projekt-detail-modal">
      <div className="projekt-detail-grid">

        <div>
          <table className="detail-kv-table">
            <tbody>
              <tr><td>Status</td><td>{project.PROJECT_STATUS_NAME_SHORT || '—'}</td></tr>
              <tr><td>Projektleitung</td><td>{project.PROJECT_MANAGER_DISPLAY || '—'}</td></tr>
              <tr><td>Abteilung</td><td>{project.DEPARTMENT_NAME ? <span className="dept-badge">{project.DEPARTMENT_NAME}</span> : '—'}</td></tr>
              <tr><td>Honorar</td><td>{fmtEur(project.BUDGET_TOTAL_NET)}</td></tr>
              <tr><td>Leistungsstand</td><td>
                {fmtEur(project.LEISTUNGSSTAND_VALUE)}
                {project.LEISTUNGSSTAND_PERCENT != null ? ` (${fmtPct(Number(project.LEISTUNGSSTAND_PERCENT))})` : ''}
              </td></tr>
              <tr><td>Kosten</td><td>{fmtEur(project.COST_TOTAL)}</td></tr>
              <tr>
                <td>Deckungsbeitrag</td>
                <td style={{ color: project.db < 0 ? '#b91c1c' : '#16a34a', fontWeight: 700 }}>
                  {fmtEur(project.db)}
                </td>
              </tr>
              <tr><td>Abgerechnet</td><td>{fmtEur(project.BILLED_NET_TOTAL)}</td></tr>
              <tr><td>Zu fakturieren</td><td style={{ color: Number(project.OPEN_NET_TOTAL) > 0 ? '#1d4ed8' : undefined }}>{fmtEur(project.OPEN_NET_TOTAL)}</td></tr>
              {(() => {
                const evm = computeEvm(project)
                if (evm.cpi == null) return null
                const cpiColor = evm.cpiStatus === 'good' ? '#16a34a' : evm.cpiStatus === 'warn' ? '#b45309' : '#b91c1c'
                return (<>
                  <tr><td colSpan={2}><div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} /></td></tr>
                  <tr><td>CPI (Effizienz)</td><td style={{ color: cpiColor, fontWeight: 700 }}>{fmtCpi(evm.cpi)}</td></tr>
                  <tr><td>EAC (Progn. Kosten)</td><td>{fmtEur(evm.eac)}</td></tr>
                  <tr><td>VAC (Abweichung)</td><td style={{ color: (evm.vac ?? 0) >= 0 ? '#16a34a' : '#b91c1c', fontWeight: 700 }}>{fmtEur(evm.vac)}</td></tr>
                </>)
              })()}
            </tbody>
          </table>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => { onClose(); navigate('/daten', { state: { tab: 'einzelprojekt', projectId: project.PROJECT_ID } }) }}>
              → Projektbericht
            </button>
            <button className="btn btn-sm" onClick={() => { onClose(); navigate('/rechnungen', { state: { projectSearch: project.NAME_SHORT } }) }}>
              → Rechnungen
            </button>
          </div>
        </div>

        <div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-4)', textTransform: 'uppercase', marginBottom: 6 }}>Ampel</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {ampelDot(project.ampel, 14)}
              <strong style={{ color: AMPEL_COLORS[project.ampel] }}>{AMPEL_LABELS[project.ampel] ?? '—'}</strong>
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-4)', textTransform: 'uppercase', marginBottom: 8 }}>
            Risikohinweise
          </div>
          {flags.length === 0 ? (
            <div style={{ color: '#16a34a', fontSize: 13 }}>✓ Keine Risiken erkannt</div>
          ) : (
            flags.map(f => {
              const info = FLAG_LABELS[f]
              if (!info) return null
              return (
                <div key={f} style={{ marginBottom: 10 }}>
                  <span className={`flag-badge flag-${info.sev}`}>{info.label}</span>
                  {ACTION_MAP[f] && (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{ACTION_MAP[f]}</div>
                  )}
                </div>
              )
            })
          )}
        </div>

      </div>
    </Modal>
  )
}

// ── Risiko-Cockpit view ───────────────────────────────────────────────────────

type AmpelFilter = 'alle' | 'rot' | 'orange' | 'gelb' | 'gruen'

function RisikoView({ projects }: { projects: RiskProject[] }) {
  const [ampelFilter, setAmpelFilter] = useState<AmpelFilter>('alle')
  const [selected, setSelected]       = useState<RiskProject | null>(null)

  const counts = {
    rot:    projects.filter(p => p.ampel === 'rot').length,
    orange: projects.filter(p => p.ampel === 'orange').length,
    gelb:   projects.filter(p => p.ampel === 'gelb').length,
    gruen:  projects.filter(p => p.ampel === 'gruen').length,
  }

  const AMPEL_ORDER: Record<string, number> = { rot: 0, orange: 1, gelb: 2, gruen: 3 }
  const filtered = (ampelFilter === 'alle' ? projects : projects.filter(p => p.ampel === ampelFilter))
    .slice()
    .sort((a, b) => (AMPEL_ORDER[a.ampel] ?? 4) - (AMPEL_ORDER[b.ampel] ?? 4))

  return (
    <>
      {selected && <ProjektDetailModal project={selected} onClose={() => setSelected(null)} />}

      <div className="kpi-grid">
        <KpiCard label="Projekte gesamt"   value={String(projects.length)}   />
        <KpiCard label="Kritisch (rot)"    value={String(counts.rot)}    accent={counts.rot > 0} />
        <KpiCard label="Warnung (orange)"  value={String(counts.orange)} />
        <KpiCard label="OK (grün)"         value={String(counts.gruen)}  />
      </div>

      <div className="dash-ampel-filter">
        {(['alle', 'rot', 'orange', 'gelb', 'gruen'] as const).map(a => (
          <button
            key={a}
            className={`ampel-filter-btn${ampelFilter === a ? ' active' : ''} ampel-${a}`}
            onClick={() => setAmpelFilter(a)}
          >
            {a === 'alle'
              ? 'Alle'
              : <>{ampelDot(a)} {AMPEL_LABELS[a]} ({counts[a as keyof typeof counts]})</>
            }
          </button>
        ))}
      </div>

      {filtered.length === 0
        ? <p className="empty-note">Keine Projekte gefunden.</p>
        : (
          <div className="dash-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="dash-table dash-table-clickable" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 4, padding: 0 }}></th>
                  <th>Projekt</th>
                  <th className="num col-hide-mobile">Honorar</th>
                  <th className="num">Kosten</th>
                  <th className="num col-hide-mobile">Budget %</th>
                  <th className="num col-hide-mobile" title="Cost Performance Index">CPI</th>
                  <th className="num col-hide-mobile">Offen</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr
                    key={p.PROJECT_ID}
                    className="clickable-row"
                    onClick={() => setSelected(p)}
                    style={{ borderLeft: `4px solid ${AMPEL_COLORS[p.ampel] ?? '#9ca3af'}` }}
                  >
                    <td style={{ padding: 0 }}></td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.NAME_SHORT}</div>
                      {p.PROJECT_MANAGER_DISPLAY && (
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{p.PROJECT_MANAGER_DISPLAY}</div>
                      )}
                    </td>
                    <td className="num col-hide-mobile">{fmtEur(p.BUDGET_TOTAL_NET)}</td>
                    <td className="num">{fmtEur(p.COST_TOTAL)}</td>
                    <td className="num col-hide-mobile">
                      {Number(p.BUDGET_TOTAL_NET) > 0 ? fmtPct(Number(p.COST_RATIO || 0) * 100) : '—'}
                    </td>
                    <td className="num col-hide-mobile">
                      {(() => {
                        const evm = computeEvm(p)
                        if (evm.cpi == null) return <span style={{ color: 'var(--text-4)' }}>–</span>
                        const color = evm.cpiStatus === 'good' ? '#16a34a' : evm.cpiStatus === 'warn' ? '#b45309' : '#b91c1c'
                        return <span style={{ color, fontWeight: 600 }}>{fmtCpi(evm.cpi)}</span>
                      })()}
                    </td>
                    <td className="num col-hide-mobile">
                      {Number(p.OPEN_NET_TOTAL) > 0 ? fmtEur(p.OPEN_NET_TOTAL) : '—'}
                    </td>
                    <td>
                      {p.flags.map(f => {
                        const info = FLAG_LABELS[f]
                        return info
                          ? <span key={f} className={`flag-badge flag-${info.sev}`} style={{ marginRight: 3 }}>{info.label}</span>
                          : null
                      })}
                      {p.flags.length === 0 && <span style={{ color: '#16a34a', fontSize: 12 }}>✓</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </>
  )
}

// ── Abrechnung view ───────────────────────────────────────────────────────────

function AbrechnungView({ billing }: { billing: BillingSummaryData | null }) {
  const navigate  = useNavigate()
  if (!billing) return <p className="empty-note">Laden …</p>

  const totalOpen = billing.projects.reduce((s, p) => s + p.OPEN_NET_TOTAL, 0)
  const maxPl     = Math.max(...billing.byPl.map(p => p.total), 1)

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label="Zu fakturieren gesamt"       value={fmtEur(totalOpen)}                   accent={totalOpen > 0} />
        <KpiCard label="Projekte mit offenem Betrag" value={String(billing.projects.length)}      />
        <KpiCard label="Projektleiter involviert"    value={String(billing.byPl.length)}          />
      </div>

      {billing.projects.length === 0 ? (
        <div className="narrative-block" style={{ background: 'rgba(34,197,94,0.08)', borderLeft: '3px solid #22c55e' }}>
          Kein Abrechnungspotenzial erkannt. Alle Projekte sind vollständig fakturiert.
        </div>
      ) : (
        <div className="dash-two-col">
          <div className="dash-card">
            <div className="dash-card-title">Top Projektleiter (offene Beträge)</div>
            {billing.byPl.length === 0
              ? <p className="empty-note">Keine Daten.</p>
              : (
                <div className="util-bar-chart">
                  {billing.byPl.slice(0, 10).map((pl, i) => {
                    const pct = Math.round((pl.total / maxPl) * 100)
                    return (
                      <div key={i} className="util-bar-row">
                        <span className="util-bar-label">{pl.name}</span>
                        <div className="util-bar-track">
                          <div className="util-bar-fill" style={{ width: `${pct}%`, background: 'rgba(139,92,246,0.65)' }} />
                        </div>
                        <span className="util-bar-value">{fmtEur(pl.total)}</span>
                      </div>
                    )
                  })}
                </div>
              )
            }
          </div>

          <div className="dash-card">
            <div className="dash-card-title">Projekte mit Abrechnungspotenzial</div>
            <table className="dash-table dash-table-clickable">
              <thead>
                <tr>
                  <th>Projekt</th>
                  <th className="num">Zu fakturieren</th>
                </tr>
              </thead>
              <tbody>
                {billing.projects.slice(0, 10).map((p, i) => (
                  <tr
                    key={i}
                    className="clickable-row"
                    onClick={() => navigate('/rechnungen', { state: { projectSearch: p.NAME_SHORT } })}
                  >
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.NAME_SHORT}</div>
                      {p.PROJECT_MANAGER_DISPLAY && (
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{p.PROJECT_MANAGER_DISPLAY}</div>
                      )}
                    </td>
                    <td className="num" style={{ fontWeight: 600, color: '#1d4ed8' }}>{fmtEur(p.OPEN_NET_TOTAL)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ── Personal / HR analytics view ──────────────────────────────────────────────

function PersonalView({ teamHours, dateFrom, dateTo }: { teamHours: TeamHoursData | null; dateFrom: string; dateTo: string }) {
  if (!teamHours) return <p className="empty-note">Laden …</p>
  const { employees, months } = teamHours
  const periodLabel = months.length > 0
    ? `${MONTHS_DE[parseInt(months[0].split('-')[1], 10) - 1]} ${months[0].split('-')[0]} – ${MONTHS_DE[parseInt(months[months.length - 1].split('-')[1], 10) - 1]} ${months[months.length - 1].split('-')[0]}`
    : `${dateFrom.substring(0, 7)} – ${dateTo.substring(0, 7)}`
  if (employees.length === 0) return <p className="empty-note">Keine Buchungen im Zeitraum {periodLabel}.</p>

  const totalHours = employees.reduce((s, e) => s + e.total, 0)
  const avgHours   = employees.length > 0 ? totalHours / employees.length : 0

  const colors = [
    'rgba(59,130,246,0.75)', 'rgba(16,185,129,0.75)', 'rgba(245,158,11,0.75)',
    'rgba(139,92,246,0.75)', 'rgba(236,72,153,0.75)',  'rgba(6,182,212,0.75)',
  ]
  const topEmps = employees.slice(0, 6)

  const datasets = topEmps.map((emp, i) => ({
    label:           emp.short_name,
    data:            emp.months.map(m => m.hours),
    backgroundColor: colors[i % colors.length],
    borderRadius:    3,
    stack:           'stack',
  }))

  const labels = months.map(m => {
    const month = parseInt(m.split('-')[1], 10)
    return MONTHS_DE[month - 1] ?? m
  })

  return (
    <>
      <div className="kpi-grid">
        <KpiCard label={`Gesamtstunden (${months.length} Mon.)`} value={fmtH(totalHours)}         />
        <KpiCard label="Ø pro Mitarbeiter"                       value={fmtH(avgHours)}           />
        <KpiCard label="Aktive Mitarbeiter"                      value={String(employees.length)} />
      </div>

      <div className="dash-card">
        <div className="dash-card-title">Stunden nach Mitarbeiter ({periodLabel})</div>
        <div className="chart-wrap">
          <Bar
            data={{ labels, datasets }}
            options={{
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { position: 'top', labels: { font: { size: 10 }, boxWidth: 10 } } },
              scales: {
                x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
                y: { stacked: true, ticks: { font: { size: 10 } } },
              },
            }}
          />
        </div>
      </div>

      <div className="dash-card">
        <div className="dash-card-title">Mitarbeiter-Übersicht</div>
        <table className="dash-table">
          <thead>
            <tr>
              <th>Mitarbeiter</th>
              {months.map(m => {
                const month = parseInt(m.split('-')[1], 10)
                return <th key={m} className="num col-hide-mobile">{MONTHS_DE[month - 1]}</th>
              })}
              <th className="num">Gesamt</th>
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => (
              <tr key={emp.employee_id}>
                <td>{emp.short_name}</td>
                {emp.months.map(m => (
                  <td key={m.month} className="num col-hide-mobile">
                    {m.hours > 0 ? fmtH(m.hours) : <span style={{ color: 'var(--text-4)' }}>—</span>}
                  </td>
                ))}
                <td className="num"><strong>{fmtH(emp.total)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

// ── Dashboard filter bar ──────────────────────────────────────────────────────

function DashboardFilterBar({
  filters, onChange, abteilungen, plOptions, statusOptions, showDimensions,
}: {
  filters:        DashboardFilters
  onChange:       (patch: Partial<DashboardFilters>) => void
  abteilungen:    string[]
  plOptions:      string[]
  statusOptions:  string[]
  showDimensions: boolean
}) {
  const isActive = filters.zeitraum !== 'last12m' || !!filters.abteilung || !!filters.projektleiter || !!filters.status
  return (
    <div className="dash-filter-bar">
      <div className="dash-filter-group">
        <span className="dash-filter-label">Zeitraum</span>
        <select className="inline-select" value={filters.zeitraum}
          onChange={e => onChange({ zeitraum: e.target.value as ZeitraumKey })}>
          {ZEITRAUM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {showDimensions && abteilungen.length > 1 && (
        <div className="dash-filter-group">
          <span className="dash-filter-label">Abteilung</span>
          <select className="inline-select" value={filters.abteilung}
            onChange={e => onChange({ abteilung: e.target.value })}>
            <option value="">Alle</option>
            {abteilungen.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}

      {showDimensions && plOptions.length > 1 && (
        <div className="dash-filter-group">
          <span className="dash-filter-label">Projektleiter</span>
          <select className="inline-select" value={filters.projektleiter}
            onChange={e => onChange({ projektleiter: e.target.value })}>
            <option value="">Alle</option>
            {plOptions.map(pl => <option key={pl} value={pl}>{pl}</option>)}
          </select>
        </div>
      )}

      {showDimensions && statusOptions.length > 1 && (
        <div className="dash-filter-group">
          <span className="dash-filter-label">Status</span>
          <select className="inline-select" value={filters.status}
            onChange={e => onChange({ status: e.target.value })}>
            <option value="">Alle</option>
            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {isActive && (
        <button className="dash-filter-reset" onClick={() => onChange(DEFAULT_FILTERS)}>
          Zurücksetzen
        </button>
      )}
    </div>
  )
}

export function DashboardPage() {
  const { dashboardRole, setDashboardRole, employeeId } = useSession()
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS)
  const [glSubPage, setGlSubPage] = useState<'uebersicht' | 'risiko' | 'abrechnung' | 'personal'>('uebersicht')
  const [blSubPage, setBlSubPage] = useState<'uebersicht' | 'risiko' | 'personal'>('uebersicht')

  const isMitarbeiter = dashboardRole === 'mitarbeiter'
  const isController  = dashboardRole === 'controller'
  const isGl          = dashboardRole === 'geschaeftsleitung'
  const isBl          = dashboardRole === 'bereichsleiter'

  // dateRange computed before useQueries so it can drive query keys + fns
  const dateRange = useMemo(() => computeDateRange(filters.zeitraum), [filters.zeitraum])

  const [kpisQ, projectsQ, monthlyQ, byStatusQ, alertsQ, overdueQ, teamQ, mahnungenQ, , billingQ, teamHoursQ] = useQueries({
    queries: [
      { queryKey: ['dashboard', 'kpis'],                                       queryFn: fetchDashboardKpis,       staleTime: 300000, enabled: isController },
      { queryKey: ['dashboard', 'projects', dateRange.dateFrom, dateRange.dateTo], queryFn: () => fetchDashboardProjects(dateRange.dateFrom, dateRange.dateTo), staleTime: 300000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'monthly',  dateRange.dateFrom, dateRange.dateTo], queryFn: () => fetchDashboardMonthly(dateRange.dateFrom, dateRange.dateTo),  staleTime: 300000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'by-status'],                                  queryFn: fetchDashboardByStatus,  staleTime: 300000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'alerts'],                                     queryFn: fetchDashboardAlerts,    staleTime: 120000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'overdue-invoices'],                           queryFn: fetchOverdueInvoices,    staleTime: 120000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'team-utilization'],                           queryFn: fetchTeamUtilization,    staleTime: 300000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'mahnung-stats'],                              queryFn: fetchMahnungStats,       staleTime: 120000, enabled: isController },
      { queryKey: ['dashboard', 'risk-projects'],                              queryFn: fetchRiskProjects,       staleTime: 300000, enabled: false },
      { queryKey: ['dashboard', 'billing-summary'],                            queryFn: fetchBillingSummary,     staleTime: 300000, enabled: isGl },
      { queryKey: ['dashboard', 'team-hours', dateRange.dateFrom, dateRange.dateTo], queryFn: () => fetchTeamHours(dateRange.dateFrom, dateRange.dateTo), staleTime: 300000, enabled: isGl || isBl },
    ],
  })

  const kpis           = kpisQ.data?.data
  const projects       = projectsQ.data?.data   ?? []
  const monthly        = monthlyQ.data?.data    ?? []
  const byStatus       = byStatusQ.data?.data   ?? []
  const alerts         = alertsQ.data?.data     ?? []
  const overdue        = overdueQ.data?.data    ?? []
  const teamUtil       = teamQ.data?.data       ?? []
  const mahnStats      = mahnungenQ.data?.data  ?? null

  const billingSummary = billingQ.data?.data     ?? null
  const teamHours      = teamHoursQ.data?.data  ?? null

  const isLoading = projectsQ.isLoading || monthlyQ.isLoading || (isController && kpisQ.isLoading)

  // ── Filter computations ──

  // Dimension filter options from date-filtered projects (now has all dimension fields)
  const abteilungen = useMemo(() =>
    [...new Set(projects.map(p => p.DEPARTMENT_NAME).filter(Boolean))].sort() as string[],
    [projects])
  const plOptions = useMemo(() =>
    [...new Set(projects.map(p => p.PROJECT_MANAGER_DISPLAY).filter(Boolean))].sort() as string[],
    [projects])
  const statusOptions = useMemo(() =>
    [...new Set(projects.map(p => p.PROJECT_STATUS_NAME_SHORT).filter(Boolean))].sort() as string[],
    [projects])

  // Client-side dimension filter on server-time-filtered project list
  const filteredProjects = useMemo(() =>
    projects
      .filter(p => !filters.abteilung     || p.DEPARTMENT_NAME          === filters.abteilung)
      .filter(p => !filters.projektleiter || p.PROJECT_MANAGER_DISPLAY  === filters.projektleiter)
      .filter(p => !filters.status        || p.PROJECT_STATUS_NAME_SHORT === filters.status),
    [projects, filters.abteilung, filters.projektleiter, filters.status])

  // Derive risk flags from the already time+dimension-filtered projects (no separate endpoint needed)
  const derivedRiskProjects = useMemo(() => filteredProjects.map(deriveRiskFromProject), [filteredProjects])

  const roleLabel = ROLES.find(r => r.id === dashboardRole)?.title ?? ''

  return (
    <div className="dash-page">
      <div className="dash-header">
        <div>
          <div className="dash-title">Übersicht</div>
          {roleLabel && <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 2 }}>{roleLabel}</div>}
        </div>
        {dashboardRole && (
          <button
            className="dash-role-switch"
            onClick={() => setDashboardRole(null)}
          >
            Ansicht wechseln
          </button>
        )}
      </div>

      <SetupChecklist />

      {dashboardRole && !isMitarbeiter && (
        <DashboardFilterBar
          filters={filters}
          onChange={patch => setFilters(f => ({ ...f, ...patch }))}
          abteilungen={abteilungen}
          plOptions={plOptions}
          statusOptions={statusOptions}
          showDimensions={isGl || isBl}
        />
      )}

      {!dashboardRole && <RoleSelector onSelect={setDashboardRole} />}

      {isLoading && dashboardRole && <div className="dash-loading">Laden …</div>}

      {!isLoading && dashboardRole === 'geschaeftsleitung' && (
        <GeschaeftsleitungView
          projects={filteredProjects} byStatus={byStatus} alerts={alerts}
          riskProjects={derivedRiskProjects} billingSummary={billingSummary} teamHours={teamHours}
          dateFrom={dateRange.dateFrom} dateTo={dateRange.dateTo}
          subPage={glSubPage} onSubPageChange={id => setGlSubPage(id as typeof glSubPage)}
        />
      )}

      {!isLoading && kpis && dashboardRole === 'controller' && (
        <ControllerView kpis={kpis} monthly={monthly} alerts={alerts} overdueInvoices={overdue} mahnStats={mahnStats} />
      )}

      {!isLoading && dashboardRole === 'bereichsleiter' && (
        <BereichsleiterView
          projects={filteredProjects} byStatus={byStatus} alerts={alerts}
          teamUtil={teamUtil} riskProjects={derivedRiskProjects} teamHours={teamHours}
          monthly={monthly} dateFrom={dateRange.dateFrom} dateTo={dateRange.dateTo}
          subPage={blSubPage} onSubPageChange={id => setBlSubPage(id as typeof blSubPage)}
        />
      )}

      {isMitarbeiter && employeeId !== null && (
        <MitarbeiterView employeeId={employeeId} />
      )}
    </div>
  )
}
