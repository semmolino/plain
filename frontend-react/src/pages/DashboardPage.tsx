import { useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useSession } from '@/hooks/useSession'
import {
  fetchDashboardKpis,
  fetchDashboardProjects,
  fetchDashboardMonthly,
  fetchDashboardByStatus,
  type DashboardKpis,
  type DashboardProject,
  type DashboardMonthly,
  type DashboardByStatus,
} from '@/api/reports'
import { fetchCompanies, fetchDefaults, fetchLogo } from '@/api/stammdaten'
import { fetchNumberRanges } from '@/api/numberRanges'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// ── Formatters ────────────────────────────────────────────────────────────────

const FMT_EUR = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
})
const FMT_NUM = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const MONTHS_DE = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']

function fmtEur(v: number | null | undefined) {
  return v == null ? '—' : FMT_EUR.format(v)
}
function fmtH(v: number | null | undefined) {
  return v == null ? '—' : FMT_NUM.format(v) + ' h'
}
function monthLabel(yyyymm: string) {
  const m = parseInt(yyyymm.split('-')[1], 10)
  return MONTHS_DE[m - 1] ?? yyyymm
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="kpi-card">
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
  const abschl = Number(kpis.ABSCHLAGSRECHNUNGEN) || 0
  const schluss = Number(kpis.SCHLUSSGERECHNET)   || 0
  const offen  = Math.max(0, Number(kpis.OFFENE_LEISTUNG) || 0)
  const total  = abschl + schluss + offen

  const colors = ['rgba(59,130,246,0.75)', 'rgba(34,197,94,0.75)', 'rgba(156,163,175,0.55)']
  const labels = ['Abschlagsrechnungen', 'Schlussgerechnet', 'Offene Leistung']
  const values = [abschl, schluss, offen]

  return (
    <div className="donut-wrap">
      <div className="donut-canvas-wrap">
        <Doughnut
          data={{
            labels,
            datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            cutout: '65%',
          }}
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

function ProjectTable({ projects }: { projects: DashboardProject[] }) {
  if (!projects.length) {
    return <p className="empty-note">Keine Projekte gefunden.</p>
  }
  return (
    <table className="dash-table">
      <thead>
        <tr>
          <th>Projekt</th>
          <th className="num">Budget</th>
          <th className="num">Leistungsstand</th>
          <th className="num">Stunden</th>
          <th className="num">Kosten</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((p, i) => (
          <tr key={i}>
            <td>{p.NAME_SHORT || p.NAME_LONG || '—'}</td>
            <td className="num">{fmtEur(p.BUDGET_TOTAL_NET)}</td>
            <td className="num">{fmtEur(p.LEISTUNGSSTAND_VALUE)}</td>
            <td className="num">{fmtH(p.HOURS_TOTAL)}</td>
            <td className="num">{fmtEur(p.COST_TOTAL)}</td>
          </tr>
        ))}
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

// ── Setup checklist ───────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear()

function SetupChecklist() {
  const { data: companiesData, isLoading: l1 } = useQuery({ queryKey: ['companies'],     queryFn: fetchCompanies,                  staleTime: 60000 })
  const { data: defaultsData,  isLoading: l2 } = useQuery({ queryKey: ['defaults'],      queryFn: fetchDefaults,                   staleTime: 60000 })
  const { data: logoData,      isLoading: l3 } = useQuery({ queryKey: ['logo'],          queryFn: fetchLogo,                       staleTime: 60000 })
  const { data: nrData,        isLoading: l4 } = useQuery({ queryKey: ['number-ranges', CURRENT_YEAR], queryFn: () => fetchNumberRanges(CURRENT_YEAR), staleTime: 60000 })

  if (l1 || l2 || l3 || l4) return null

  const companies = companiesData?.data ?? []
  const defaults  = defaultsData?.data  ?? {}
  const logoId    = logoData?.data?.logo_asset_id ?? null

  const hasCompany    = companies.some(c => c.COMPANY_NAME_1?.trim() && c.STREET?.trim() && c.CITY?.trim())
  const hasLogo       = logoId !== null
  const hasVat        = !!defaults.default_vat_id
  const hasNr         = nrData != null

  const items = [
    { done: hasCompany, label: 'Firmendaten vervollständigen',   hint: 'Name, Adresse, Steuernummer', tab: 'unternehmen' },
    { done: hasLogo,    label: 'Firmenlogo hochladen',           hint: 'Wird auf PDFs angezeigt',     tab: 'unternehmen' },
    { done: hasVat,     label: 'Standard-MwSt. festlegen',       hint: 'Für neue Verträge & Angebote', tab: 'vorbelegungen' },
    { done: hasNr,      label: 'Nummernkreise konfigurieren',    hint: 'Rechnungs-, Projekt-, Angebotsnummern', tab: 'nummernkreise' },
  ]

  const allDone = items.every(i => i.done)
  if (allDone) return null

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
            <span style={{ fontSize: 16, lineHeight: 1, color: item.done ? '#16a34a' : '#d97706' }}>
              {item.done ? '✓' : '○'}
            </span>
            <div style={{ flex: 1 }}>
              {item.done ? (
                <span style={{ fontSize: 12, color: '#6b7280', textDecoration: 'line-through' }}>{item.label}</span>
              ) : (
                <Link to={`/admin?tab=${item.tab}`} style={{ fontSize: 12, color: '#1d4ed8', textDecoration: 'none', fontWeight: 500 }}>
                  {item.label}
                </Link>
              )}
              <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>{item.hint}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const navigate    = useNavigate()
  const clearAuth   = useAuthStore(s => s.clearAuth)
  useSession()
  const qc          = useQueryClient()
  const [confirmLogout, setConfirmLogout] = useState(false)

  const now        = new Date()
  const monthLabel_ = `${MONTHS_DE[now.getMonth()]} ${now.getFullYear()}`

  const [kpisQ, projectsQ, monthlyQ, byStatusQ] = useQueries({
    queries: [
      { queryKey: ['dashboard', 'kpis'],      queryFn: fetchDashboardKpis      },
      { queryKey: ['dashboard', 'projects'],   queryFn: fetchDashboardProjects  },
      { queryKey: ['dashboard', 'monthly'],    queryFn: fetchDashboardMonthly   },
      { queryKey: ['dashboard', 'by-status'],  queryFn: fetchDashboardByStatus  },
    ],
  })

  const kpis      = kpisQ.data?.data
  const projects  = projectsQ.data?.data  ?? []
  const monthly   = monthlyQ.data?.data   ?? []
  const byStatus  = byStatusQ.data?.data  ?? []

  const isLoading = kpisQ.isLoading || projectsQ.isLoading || monthlyQ.isLoading || byStatusQ.isLoading

  return (
    <div className="dash-page">
      {/* ── Header ── */}
      <div className="dash-header">
        <div className="dash-title">Übersicht</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="dash-logout" onClick={() => navigate('/profil')}>
            Profil
          </button>
          {confirmLogout ? (
            <span className="dash-logout-confirm">
              Wirklich abmelden?&nbsp;
              <button className="dash-logout-yes" onClick={() => { qc.clear(); clearAuth(); navigate('/login') }}>Ja</button>
              &nbsp;
              <button className="dash-logout-no" onClick={() => setConfirmLogout(false)}>Nein</button>
            </span>
          ) : (
            <button className="dash-logout" onClick={() => setConfirmLogout(true)}>
              Abmelden
            </button>
          )}
        </div>
      </div>

      <SetupChecklist />

      {isLoading && <div className="dash-loading">Laden …</div>}

      {/* ── KPI cards ── */}
      {kpis && (
        <div className="kpi-grid">
          <KpiCard label="Honorar gesamt"   value={fmtEur(kpis.HONORAR_GESAMT)}       />
          <KpiCard label="Leistungsstand"   value={fmtEur(kpis.LEISTUNGSSTAND_VALUE)} />
          <KpiCard label="Offene Leistung"  value={fmtEur(kpis.OFFENE_LEISTUNG)}      />
          <KpiCard label="Stunden (Monat)"  value={fmtH(kpis.STUNDEN_MONAT)}          meta={monthLabel_} />
        </div>
      )}

      {/* ── Monthly chart ── */}
      {monthly.length > 0 && (
        <div className="dash-card">
          <div className="dash-card-title">Stunden &amp; Kosten (letzte Monate)</div>
          <div className="chart-wrap">
            <MonthlyChart data={monthly} />
          </div>
        </div>
      )}

      {/* ── Project table + Donut side by side ── */}
      <div className="dash-two-col">
        <div className="dash-card">
          <div className="dash-card-title">Top-Projekte</div>
          <ProjectTable projects={projects} />
        </div>

        {kpis && (
          <div className="dash-card">
            <div className="dash-card-title">Leistungsverteilung</div>
            <DonutChart kpis={kpis} />
            <div className="dash-card-title" style={{ marginTop: 20 }}>Projekte nach Status</div>
            <StatusList items={byStatus} />
          </div>
        )}
      </div>
    </div>
  )
}
