import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { fetchProjectPhases, type PhaseReportRow } from '@/api/reports'
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

const AMPEL_COLOR: Record<PhaseReportRow['ampel'], string> = {
  rot:    'var(--danger)',
  orange: 'var(--warning)',
  gruen:  'var(--success)',
}
const AMPEL_LABEL: Record<PhaseReportRow['ampel'], string> = {
  rot:    'Kritisch — Kostenquote hoch oder Deckungsbeitrag negativ',
  orange: 'Beobachten — Kostenquote erhöht',
  gruen:  'Im Plan',
}

function AmpelDot({ ampel }: { ampel: PhaseReportRow['ampel'] }) {
  return (
    <span
      title={AMPEL_LABEL[ampel]}
      aria-label={AMPEL_LABEL[ampel]}
      style={{
        display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
        background: AMPEL_COLOR[ampel],
      }}
    />
  )
}

// Soll-Honorar vs. erbrachte Leistung vs. Kosten je Leistungsphase.
function PhaseBarChart({ phases }: { phases: PhaseReportRow[] }) {
  const t = useChartTheme()

  const data = useMemo(() => ({
    labels: phases.map(p => p.NAME_SHORT),
    datasets: [
      { label: 'Honorar',   data: phases.map(p => p.HONORAR_NET),      backgroundColor: t.series[0], borderRadius: 3, maxBarThickness: 34 },
      { label: 'Leistung',  data: phases.map(p => p.EARNED_VALUE_NET), backgroundColor: t.series[1], borderRadius: 3, maxBarThickness: 34 },
      { label: 'Kosten',    data: phases.map(p => p.COST_TOTAL),       backgroundColor: t.series[5], borderRadius: 3, maxBarThickness: 34 },
    ],
  }), [phases, t])

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 16, color: t.text, font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: t.tooltipBg, titleColor: t.tooltipFg, bodyColor: t.tooltipFg,
        padding: 12, cornerRadius: 8,
        callbacks: { label: (ctx) => `  ${ctx.dataset.label ?? ''}: ${FMT_EUR.format(ctx.parsed.y ?? 0)}` },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: t.textMuted, font: { size: 11 } } },
      y: { grid: { color: t.grid }, ticks: { color: t.textMuted, font: { size: 11 }, callback: (v) => FMT_EUR0.format(Number(v)) } },
    },
  }

  return (
    <div className="timeline-wrap">
      <h3 className="timeline-title">Honorar · Leistung · Kosten je Leistungsphase</h3>
      <div className="timeline-chart">
        <Bar data={data} options={options} />
      </div>
    </div>
  )
}

export function LeistungsphasenReport({ projectId }: { projectId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['project-phases', projectId],
    queryFn:  () => fetchProjectPhases(projectId),
    enabled:  projectId != null,
  })

  const report = data?.data
  const phases = report?.phases ?? []
  const totals = report?.totals ?? null

  if (isLoading) return <p className="empty-note">Laden …</p>
  if (isError)   return <p className="empty-note" style={{ color: 'var(--danger)' }}>Fehler beim Laden der Leistungsphasen.</p>
  if (!report?.hasPhases) {
    return (
      <p className="empty-note">
        Dieses Projekt hat keine Leistungsphasen-Struktur. Der Report steht zur Verfügung, sobald das
        Projekt aus einer HOAI-Honorarberechnung erzeugt oder eine Berechnung in die Projektstruktur
        übernommen wurde.
      </p>
    )
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <h3 className="timeline-title" style={{ margin: 0 }}>Auswertung nach Leistungsphase</h3>
        <HelpHint id="report.leistungsphasen" />
      </div>

      <div className="list-section table-scroll">
        <table className="master-table">
          <thead>
            <tr>
              <th scope="col">Leistungsphase</th>
              <th scope="col" className="num">Honorar</th>
              <th scope="col" className="num">Lst.stand&nbsp;%</th>
              <th scope="col" className="num">Lst.stand&nbsp;€</th>
              <th scope="col" className="num">Stunden</th>
              <th scope="col" className="num">Kosten&nbsp;€</th>
              <th scope="col" className="num">Kostenquote</th>
              <th scope="col" className="num">Deckungsbeitrag</th>
              <th scope="col" style={{ textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {phases.map(p => (
              <tr key={p.PHASE_STRUCTURE_ID ?? 'none'} className={p.IS_UNASSIGNED ? 'is-muted-row' : undefined}>
                <td>
                  <strong>{p.NAME_SHORT}</strong>
                  {p.NAME_LONG && <span className="tree-name-long"> {p.NAME_LONG}</span>}
                </td>
                <td className="num">{fmtEur(p.HONORAR_NET)}</td>
                <td className="num">{fmtPct(p.LEISTUNGSSTAND_PERCENT)}</td>
                <td className="num">{fmtEur(p.EARNED_VALUE_NET)}</td>
                <td className="num">{fmtH(p.HOURS_TOTAL)}</td>
                <td className="num">{fmtEur(p.COST_TOTAL)}</td>
                <td className="num">{p.KOSTENQUOTE != null ? fmtPct(p.KOSTENQUOTE * 100) : '—'}</td>
                <td className="num" style={{ color: p.DB < 0 ? 'var(--danger)' : undefined }}>{fmtEur(p.DB)}</td>
                <td style={{ textAlign: 'center' }}>{!p.IS_UNASSIGNED && <AmpelDot ampel={p.ampel} />}</td>
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="sum-row">
                <td><strong>Gesamt</strong></td>
                <td className="num"><strong>{fmtEur(totals.HONORAR_NET)}</strong></td>
                <td className="num"><strong>{fmtPct(totals.LEISTUNGSSTAND_PERCENT)}</strong></td>
                <td className="num"><strong>{fmtEur(totals.EARNED_VALUE_NET)}</strong></td>
                <td className="num"><strong>{fmtH(totals.HOURS_TOTAL)}</strong></td>
                <td className="num"><strong>{fmtEur(totals.COST_TOTAL)}</strong></td>
                <td className="num"><strong>{totals.KOSTENQUOTE != null ? fmtPct(totals.KOSTENQUOTE * 100) : '—'}</strong></td>
                <td className="num" style={{ color: totals.DB < 0 ? 'var(--danger)' : undefined }}><strong>{fmtEur(totals.DB)}</strong></td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {phases.length > 0 && <PhaseBarChart phases={phases} />}
    </div>
  )
}
