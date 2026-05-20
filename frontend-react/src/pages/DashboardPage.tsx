import { useState } from 'react'
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
import {
  fetchDashboardKpis,
  fetchDashboardProjects,
  fetchDashboardMonthly,
  fetchDashboardByStatus,
  fetchProjectsTimeline,
  fetchDashboardAlerts,
  fetchOverdueInvoices,
  fetchTeamUtilization,
  type DashboardKpis,
  type DashboardProject,
  type DashboardMonthly,
  type DashboardByStatus,
  type TimelinePoint,
  type DashboardAlert,
  type OverdueInvoice,
  type TeamMemberUtilization,
} from '@/api/reports'
import { fetchCompanies, fetchDefaults, fetchLogo } from '@/api/stammdaten'
import { fetchNumberRanges } from '@/api/numberRanges'
import {
  fetchMonthBalance, fetchRunningBalance,
  type DayBooking, type RunningMonth,
} from '@/api/mitarbeiter'

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

function DonutChart({ kpis }: { kpis: DashboardKpis }) {
  const abschl  = Number(kpis.ABSCHLAGSRECHNUNGEN) || 0
  const schluss = Number(kpis.SCHLUSSGERECHNET)   || 0
  const offen   = Math.max(0, Number(kpis.OFFENE_LEISTUNG) || 0)
  const total   = abschl + schluss + offen
  const colors  = ['rgba(59,130,246,0.75)', 'rgba(34,197,94,0.75)', 'rgba(156,163,175,0.55)']
  const labels  = ['Abschlagsrechnungen', 'Schlussgerechnet', 'Offene Leistung']
  const values  = [abschl, schluss, offen]
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

function DashboardTimeline() {
  const today    = new Date()
  const dateFrom = `${today.getFullYear()}-01-01`
  const dateTo   = today.toISOString().substring(0, 10)

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
      <h3 className="timeline-title">Gesamtverlauf {today.getFullYear()} (Jahr bis heute)</h3>
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
  kpis, projects, byStatus, alerts,
}: {
  kpis: DashboardKpis; projects: DashboardProject[]; byStatus: DashboardByStatus[]; alerts: DashboardAlert[];
}) {
  const honorar      = Number(kpis.HONORAR_GESAMT)       || 0
  const leistung     = Number(kpis.LEISTUNGSSTAND_VALUE) || 0
  const offeneLeist  = Number(kpis.OFFENE_LEISTUNG)      || 0
  const leistPct     = honorar > 0 ? (leistung / honorar) * 100 : 0
  const budgetAlerts = alerts.filter(a => a.type === 'budget_critical')
  const atRiskCount  = budgetAlerts[0]?.count ?? 0
  const activeCount  = projects.length

  return (
    <>
      <AlertStrip alerts={alerts} />

      <div className="kpi-grid">
        <KpiCard label="Honorar gesamt"   value={fmtEur(kpis.HONORAR_GESAMT)}       />
        <KpiCard label="Offene Leistung"  value={fmtEur(kpis.OFFENE_LEISTUNG)}      />
        <KpiCard label="Leistungsstand"   value={fmtEur(kpis.LEISTUNGSSTAND_VALUE)} meta={`${fmtPct(leistPct)} des Honorars`} />
        <KpiCard label="Aktive Projekte"  value={String(activeCount)}               />
      </div>

      <NarrativeBlock>
        Honorar gesamt: <strong>{fmtEur(honorar)}</strong>. Leistungsstand bei{' '}
        <strong>{fmtPct(leistPct)}</strong> — {leistPct >= 80 ? 'gut im Plan' : leistPct >= 50 ? 'im Aufbau' : 'frühe Phase'}.
        {' '}{activeCount} Projekt{activeCount !== 1 ? 'e' : ''} aktiv
        {atRiskCount > 0 ? `, davon ${atRiskCount} über 90% Budget` : ', alle im Budget-Rahmen'}.
        {' '}Offene Leistung zu fakturieren: <strong>{fmtEur(offeneLeist)}</strong>.
      </NarrativeBlock>

      <DashboardTimeline />

      <div className="dash-two-col">
        <div className="dash-card">
          <div className="dash-card-title">Top-Projekte</div>
          <ProjectTable projects={projects} maxRows={5} />
        </div>
        <div className="dash-card">
          <div className="dash-card-title">Leistungsverteilung</div>
          <DonutChart kpis={kpis} />
          <div className="dash-card-title" style={{ marginTop: 20 }}>Projekte nach Status</div>
          <StatusList items={byStatus} />
        </div>
      </div>
    </>
  )
}

function ControllerView({
  kpis, monthly, alerts, overdueInvoices,
}: {
  kpis: DashboardKpis; monthly: DashboardMonthly[]; alerts: DashboardAlert[]; overdueInvoices: OverdueInvoice[];
}) {
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
        <KpiCard label="Offene Leistung" value={fmtEur(kpis.OFFENE_LEISTUNG)} />
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
      </NarrativeBlock>

      <div className="dash-card">
        <div className="dash-card-title">Überfällige Rechnungen</div>
        <OverdueInvoicesTable invoices={overdueInvoices} />
      </div>

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
  kpis, projects, byStatus, alerts, teamUtil,
}: {
  kpis: DashboardKpis; projects: DashboardProject[]; byStatus: DashboardByStatus[]; alerts: DashboardAlert[]; teamUtil: TeamMemberUtilization[];
}) {
  const budgetHealthy = projects.filter(p =>
    Number(p.BUDGET_TOTAL_NET) > 0 &&
    Number(p.COST_TOTAL) / Number(p.BUDGET_TOTAL_NET) < 0.8
  ).length
  const budgetHealthPct = projects.length > 0 ? Math.round((budgetHealthy / projects.length) * 100) : 0
  const totalHours4w    = teamUtil.reduce((s, e) => s + e.hours_4weeks, 0)

  return (
    <>
      <AlertStrip alerts={alerts} />

      <div className="kpi-grid">
        <KpiCard label="Aktive Projekte"    value={String(projects.length)}             />
        <KpiCard label="Stunden (Monat)"    value={fmtH(kpis.STUNDEN_MONAT)}           />
        <KpiCard label="Budget-Gesundheit"  value={fmtPct(budgetHealthPct)}             meta={`${budgetHealthy} von ${projects.length} im grünen Bereich`} />
        <KpiCard label="Offene Leistung"    value={fmtEur(kpis.OFFENE_LEISTUNG)}       />
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

// ── Page ──────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { dashboardRole, setDashboardRole, employeeId } = useSession()

  const isMitarbeiter = dashboardRole === 'mitarbeiter'

  const [kpisQ, projectsQ, monthlyQ, byStatusQ, alertsQ, overdueQ, teamQ] = useQueries({
    queries: [
      { queryKey: ['dashboard', 'kpis'],             queryFn: fetchDashboardKpis,      staleTime: 300000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'projects'],          queryFn: fetchDashboardProjects,  staleTime: 300000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'monthly'],           queryFn: fetchDashboardMonthly,   staleTime: 300000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'by-status'],         queryFn: fetchDashboardByStatus,  staleTime: 300000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'alerts'],            queryFn: fetchDashboardAlerts,    staleTime: 120000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'overdue-invoices'],  queryFn: fetchOverdueInvoices,    staleTime: 120000, enabled: !isMitarbeiter },
      { queryKey: ['dashboard', 'team-utilization'],  queryFn: fetchTeamUtilization,    staleTime: 300000, enabled: !isMitarbeiter },
    ],
  })

  const kpis     = kpisQ.data?.data
  const projects = projectsQ.data?.data  ?? []
  const monthly  = monthlyQ.data?.data   ?? []
  const byStatus = byStatusQ.data?.data  ?? []
  const alerts   = alertsQ.data?.data    ?? []
  const overdue  = overdueQ.data?.data   ?? []
  const teamUtil = teamQ.data?.data      ?? []

  const isLoading = kpisQ.isLoading || projectsQ.isLoading

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

      {!dashboardRole && <RoleSelector onSelect={setDashboardRole} />}

      {isLoading && dashboardRole && <div className="dash-loading">Laden …</div>}

      {!isLoading && kpis && dashboardRole === 'geschaeftsleitung' && (
        <GeschaeftsleitungView kpis={kpis} projects={projects} byStatus={byStatus} alerts={alerts} />
      )}

      {!isLoading && kpis && dashboardRole === 'controller' && (
        <ControllerView kpis={kpis} monthly={monthly} alerts={alerts} overdueInvoices={overdue} />
      )}

      {!isLoading && kpis && dashboardRole === 'bereichsleiter' && (
        <BereichsleiterView kpis={kpis} projects={projects} byStatus={byStatus} alerts={alerts} teamUtil={teamUtil} />
      )}

      {isMitarbeiter && employeeId !== null && (
        <MitarbeiterView employeeId={employeeId} />
      )}
    </div>
  )
}
