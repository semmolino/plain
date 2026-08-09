import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend, type ChartOptions,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { fetchPhaseMatrix, type PhaseCell, type PhaseMatrixProject } from '@/api/reports'
import { HelpHint } from '@/components/ui/HelpHint'
import { useChartTheme } from '@/theme/chartTheme'

const FMT_EUR  = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_EUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const FMT_H    = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_PCT  = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur   = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtH     = (v: number | null | undefined) => v == null ? '—' : FMT_H.format(v) + ' h'
const fmtPct   = (v: number | null | undefined) => v == null ? '—' : FMT_PCT.format(v) + ' %'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const AMPEL_BG: Record<PhaseCell['ampel'], string> = {
  rot:    'var(--danger-bg)',
  orange: 'var(--warning-bg)',
  gruen:  'var(--success-bg)',
}

type Metric = 'kostenquote' | 'leistungsstand' | 'db'

const METRICS: { id: Metric; label: string }[] = [
  { id: 'kostenquote',    label: 'Kostenquote' },
  { id: 'leistungsstand', label: 'Leistungsstand %' },
  { id: 'db',             label: 'Deckungsbeitrag' },
]

function cellValue(c: PhaseCell, metric: Metric): string {
  if (metric === 'kostenquote')    return c.KOSTENQUOTE != null ? fmtPct(c.KOSTENQUOTE * 100) : '—'
  if (metric === 'leistungsstand') return fmtPct(c.LEISTUNGSSTAND_PERCENT)
  return fmtEur(c.DB)
}

function cellTitle(c: PhaseCell): string {
  return [
    `Honorar: ${fmtEur(c.HONORAR_NET)}`,
    `Leistung: ${fmtEur(c.EARNED_VALUE_NET)} (${fmtPct(c.LEISTUNGSSTAND_PERCENT)})`,
    `Stunden: ${fmtH(c.HOURS_TOTAL)}`,
    `Kosten: ${fmtEur(c.COST_TOTAL)}`,
    `Kostenquote: ${c.KOSTENQUOTE != null ? fmtPct(c.KOSTENQUOTE * 100) : '—'}`,
    `Deckungsbeitrag: ${fmtEur(c.DB)}`,
  ].join('\n')
}

function PortfolioBarChart({ labels, honorar, leistung, kosten }: {
  labels: string[]; honorar: number[]; leistung: number[]; kosten: number[]
}) {
  const t = useChartTheme()
  const data = useMemo(() => ({
    labels,
    datasets: [
      { label: 'Honorar',  data: honorar,  backgroundColor: t.series[0], borderRadius: 3, maxBarThickness: 34 },
      { label: 'Leistung', data: leistung, backgroundColor: t.series[1], borderRadius: 3, maxBarThickness: 34 },
      { label: 'Kosten',   data: kosten,   backgroundColor: t.series[5], borderRadius: 3, maxBarThickness: 34 },
    ],
  }), [labels, honorar, leistung, kosten, t])
  const options: ChartOptions<'bar'> = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 16, color: t.text, font: { size: 12 } } },
      tooltip: { backgroundColor: t.tooltipBg, titleColor: t.tooltipFg, bodyColor: t.tooltipFg, padding: 12, cornerRadius: 8,
        callbacks: { label: (ctx) => `  ${ctx.dataset.label ?? ''}: ${FMT_EUR.format(ctx.parsed.y ?? 0)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: t.textMuted, font: { size: 11 } } },
      y: { grid: { color: t.grid }, ticks: { color: t.textMuted, font: { size: 11 }, callback: (v) => FMT_EUR0.format(Number(v)) } },
    },
  }
  return (
    <div className="timeline-wrap">
      <h3 className="timeline-title">Honorar · Leistung · Kosten je Leistungsphase (Portfolio)</h3>
      <div className="timeline-chart"><Bar data={data} options={options} /></div>
    </div>
  )
}

export function LeistungsphasenMatrixTab() {
  const navigate = useNavigate()
  const [metric, setMetric] = useState<Metric>('kostenquote')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['phase-matrix'],
    queryFn:  fetchPhaseMatrix,
    staleTime: 300000,
  })

  const matrix   = data?.data
  const phases   = matrix?.phases ?? []
  const projects = matrix?.projects ?? []
  const byPhase  = matrix?.byPhase ?? []

  const goToProject = (p: PhaseMatrixProject) =>
    navigate('/daten', { state: { tab: 'einzelprojekt', projectId: p.PROJECT_ID } })

  if (isLoading) return <p className="empty-note">Laden …</p>
  if (isError)   return <p className="empty-note" style={{ color: 'var(--danger)' }}>Fehler beim Laden der Leistungsphasen-Matrix.</p>
  if (projects.length === 0) {
    return (
      <p className="empty-note">
        Keine Projekte mit Leistungsphasen-Struktur. Sobald Projekte aus einer HOAI-Honorarberechnung
        erzeugt werden, erscheinen sie hier — mit Kennzahlen je Leistungsphase über das gesamte Portfolio.
      </p>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 className="timeline-title" style={{ margin: 0 }}>Leistungsphasen über alle Projekte</h3>
        <HelpHint id="report.lph_matrix" />
        <div className="daten-filter-modes" style={{ marginLeft: 'auto' }}>
          {METRICS.map(m => (
            <label key={m.id} className={`daten-filter-mode-btn${metric === m.id ? ' active' : ''}`}>
              <input type="radio" name="matrixMetric" value={m.id} checked={metric === m.id} onChange={() => setMetric(m.id)} />
              {m.label}
            </label>
          ))}
        </div>
      </div>

      {/* Heatmap: Projekte × Leistungsphase */}
      <div className="list-section table-scroll">
        <table className="master-table">
          <thead>
            <tr>
              <th scope="col">Projekt</th>
              {phases.map(ph => <th key={ph.num} scope="col" className="num" title={ph.label}>{ph.label}</th>)}
              <th scope="col" className="num">Gesamt</th>
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.PROJECT_ID}>
                <td>
                  <button type="button" onClick={() => goToProject(p)} title="Zum Projekt-Report"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', font: 'inherit', textAlign: 'left' }}>
                    <strong>{p.NAME_SHORT}</strong>
                  </button>
                  {p.NAME_LONG && <span className="tree-name-long"> {p.NAME_LONG}</span>}
                </td>
                {phases.map(ph => {
                  const c = p.cells[ph.num]
                  return (
                    <td key={ph.num} className="num"
                      style={{ background: c ? AMPEL_BG[c.ampel] : undefined }}
                      title={c ? cellTitle(c) : undefined}>
                      {c ? cellValue(c, metric) : '—'}
                    </td>
                  )
                })}
                <td className="num" title={cellTitle(p.total)}><strong>{cellValue(p.total, metric)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Portfolio-Aggregat je Leistungsphase */}
      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <h3 className="timeline-title" style={{ margin: 0 }}>Aggregat je Leistungsphase</h3>
        <HelpHint id="report.lph_stundenanteil" />
      </div>
      <div className="list-section table-scroll">
        <table className="master-table">
          <thead>
            <tr>
              <th scope="col">Leistungsphase</th>
              <th scope="col" className="num">Honorar</th>
              <th scope="col" className="num">Leistung €</th>
              <th scope="col" className="num">Stunden</th>
              <th scope="col" className="num">Kosten €</th>
              <th scope="col" className="num">Kostenquote</th>
              <th scope="col" className="num">Deckungsbeitrag</th>
              <th scope="col" className="num">Stundenanteil</th>
              <th scope="col" className="num">Honoraranteil</th>
            </tr>
          </thead>
          <tbody>
            {byPhase.map(ph => {
              // Über-/Unterindizierung: Stundenanteil deutlich höher als Honoraranteil → Warnsignal.
              const over = ph.HOURS_SHARE != null && ph.HONORAR_SHARE != null && ph.HOURS_SHARE - ph.HONORAR_SHARE >= 5
              return (
                <tr key={ph.num}>
                  <td><strong>{ph.label}</strong></td>
                  <td className="num">{fmtEur(ph.HONORAR_NET)}</td>
                  <td className="num">{fmtEur(ph.EARNED_VALUE_NET)}</td>
                  <td className="num">{fmtH(ph.HOURS_TOTAL)}</td>
                  <td className="num">{fmtEur(ph.COST_TOTAL)}</td>
                  <td className="num">{ph.KOSTENQUOTE != null ? fmtPct(ph.KOSTENQUOTE * 100) : '—'}</td>
                  <td className="num" style={{ color: ph.DB < 0 ? 'var(--danger)' : undefined }}>{fmtEur(ph.DB)}</td>
                  <td className="num" style={{ color: over ? 'var(--danger-strong)' : undefined, fontWeight: over ? 600 : undefined }}>{fmtPct(ph.HOURS_SHARE)}</td>
                  <td className="num">{fmtPct(ph.HONORAR_SHARE)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {byPhase.length > 0 && (
        <PortfolioBarChart
          labels={byPhase.map(p => p.label)}
          honorar={byPhase.map(p => p.HONORAR_NET)}
          leistung={byPhase.map(p => p.EARNED_VALUE_NET)}
          kosten={byPhase.map(p => p.COST_TOTAL)}
        />
      )}
    </div>
  )
}
