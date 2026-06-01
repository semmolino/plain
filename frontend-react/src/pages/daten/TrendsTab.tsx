import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  Tooltip,
  Legend,
} from 'chart.js'
import { Chart } from 'react-chartjs-2'
import { fetchTrends, type TrendPeriod, type TrendsGroupBy } from '@/api/reports'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, BarController,
  LineElement, LineController,
  PointElement,
  Tooltip, Legend,
)

// ── Formatters ────────────────────────────────────────────────────────────────

const FMT_EUR  = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const FMT_EUR2 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_H    = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const FMT_PCT  = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const fmtEur  = (v: number | null | undefined) => v == null ? '–' : FMT_EUR.format(v)
const fmtEur2 = (v: number | null | undefined) => v == null ? '–' : FMT_EUR2.format(v)
const fmtH    = (v: number | null | undefined) => v == null ? '–' : FMT_H.format(v) + ' h'
const fmtPct  = (v: number | null | undefined) => v == null ? '–' : FMT_PCT.format(v) + ' %'

// ── Colors ────────────────────────────────────────────────────────────────────

const C = {
  fakturiert: '#10b981',
  kosten:     '#ef4444',
  db:         '#3b82f6',
  bezahlt:    '#06b6d4',
  stunden:    '#8b5cf6',
  backlog:    '#f59e0b',
}

// ── Date range helpers ────────────────────────────────────────────────────────

function defaultRange(g: TrendsGroupBy): { from: string; to: string } {
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  const pad = (n: number) => String(n).padStart(2, '0')
  if (g === 'year') {
    return { from: `${y - 4}-01-01`, to: `${y}-12-31` }
  } else if (g === 'quarter') {
    return { from: `${y - 2}-01-01`, to: today.toISOString().slice(0, 10) }
  } else {
    const start = new Date(y, m - 1 - 17, 1)
    const lastDay = new Date(y, m, 0).getDate()
    return {
      from: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01`,
      to:   `${y}-${pad(m)}-${pad(lastDay)}`,
    }
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

const GROUP_TABS: { id: TrendsGroupBy; label: string }[] = [
  { id: 'month',   label: 'Monat'   },
  { id: 'quarter', label: 'Quartal' },
  { id: 'year',    label: 'Jahr'    },
]

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="trends-section-header">
      <h3 className="trends-section-title">{title}</h3>
      {subtitle && <p className="trends-section-subtitle">{subtitle}</p>}
    </div>
  )
}

function ChartBox({ children }: { children: ReactNode }) {
  return <div className="trends-chart-box">{children}</div>
}

// ── Transposed period table (metrics as rows, periods as columns) ──────────────

interface TableRow {
  label:      string
  values:     string[]
  avg:        string
  total:      string
  rowClass?:  string
}

function PeriodTable({ periods, rows }: { periods: TrendPeriod[]; rows: TableRow[] }) {
  if (periods.length === 0) return null
  return (
    <div className="trends-table-wrap">
      <table className="trends-table">
        <thead>
          <tr>
            <th className="trends-th-label">Kennzahl</th>
            {periods.map(p => (
              <th key={p.period} className="trends-th-period">{p.period_label}</th>
            ))}
            <th className="trends-th-avg">Ø / Periode</th>
            <th className="trends-th-total">Gesamt / Akt.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={row.rowClass}>
              <td className="trends-td-label">{row.label}</td>
              {row.values.map((v, j) => <td key={j} className="trends-td-value">{v}</td>)}
              <td className="trends-td-avg">{row.avg}</td>
              <td className="trends-td-total">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Chart option helpers ──────────────────────────────────────────────────────

function baseOpts(yLabel: string): object {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend:  { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x:  { grid: { display: false }, ticks: { font: { size: 10 } } },
      y:  { title: { display: true, text: yLabel, font: { size: 10 } }, ticks: { font: { size: 10 } } },
    },
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function TrendsTab() {
  const initRange = defaultRange('month')
  const [groupBy,  setGroupBy]  = useState<TrendsGroupBy>('month')
  const [dateFrom, setDateFrom] = useState(initRange.from)
  const [dateTo,   setDateTo]   = useState(initRange.to)

  function handleGroupBy(g: TrendsGroupBy) {
    setGroupBy(g)
    const r = defaultRange(g)
    setDateFrom(r.from)
    setDateTo(r.to)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['trends', groupBy, dateFrom, dateTo],
    queryFn:  () => fetchTrends(groupBy, dateFrom, dateTo).then(r => r.data.data),
    staleTime: 300_000,
  })

  const periods = data ?? []
  const labels  = periods.map(p => p.period_label)
  const n       = periods.length
  const dotR    = n > 24 ? 0 : 3

  // ── Aggregate totals ─────────────────────────────────────────────────────

  const totFakt = periods.reduce((s, p) => s + p.fakturiert, 0)
  const totKost = periods.reduce((s, p) => s + p.kosten, 0)
  const totDb   = totFakt - totKost
  const totDbM  = totFakt > 0 ? (totDb / totFakt) * 100 : null
  const totBez  = periods.reduce((s, p) => s + p.bezahlt, 0)
  const totH    = periods.reduce((s, p) => s + p.stunden, 0)
  const avgSts  = totH > 0 ? totKost / totH : null
  const avgDbM  = n > 0 ? periods.reduce((s, p) => s + (p.db_marge ?? 0), 0) / n : null

  // ── Section 1: Deckungsbeitrag ───────────────────────────────────────────

  const dbData = {
    labels,
    datasets: [
      {
        type: 'bar' as const, label: 'Fakturiert',
        data: periods.map(p => p.fakturiert),
        backgroundColor: C.fakturiert + 'bb', borderColor: C.fakturiert, borderWidth: 1, borderRadius: 3, order: 2,
      },
      {
        type: 'bar' as const, label: 'Kosten',
        data: periods.map(p => p.kosten),
        backgroundColor: C.kosten + 'bb', borderColor: C.kosten, borderWidth: 1, borderRadius: 3, order: 2,
      },
      {
        type: 'line' as const, label: 'Deckungsbeitrag',
        data: periods.map(p => p.db),
        borderColor: C.db, backgroundColor: 'transparent', borderWidth: 2,
        pointRadius: dotR, pointHoverRadius: 5, tension: 0.3, order: 1,
      },
    ],
  }

  const dbOpts = {
    ...baseOpts('EUR'),
    plugins: {
      ...(baseOpts('EUR') as any).plugins,
      tooltip: {
        mode: 'index', intersect: false,
        callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${FMT_EUR.format(ctx.parsed.y)}` },
      },
    },
  }

  const dbRows: TableRow[] = [
    {
      label: 'Fakturiert',
      values: periods.map(p => fmtEur(p.fakturiert)),
      avg: fmtEur(n > 0 ? totFakt / n : null),
      total: fmtEur(totFakt),
    },
    {
      label: 'Kosten',
      values: periods.map(p => fmtEur(p.kosten)),
      avg: fmtEur(n > 0 ? totKost / n : null),
      total: fmtEur(totKost),
    },
    {
      label: 'Deckungsbeitrag',
      values: periods.map(p => fmtEur(p.db)),
      avg: fmtEur(n > 0 ? totDb / n : null),
      total: fmtEur(totDb),
      rowClass: 'trends-tr-bold',
    },
    {
      label: 'DB-Marge',
      values: periods.map(p => fmtPct(p.db_marge)),
      avg: fmtPct(avgDbM),
      total: fmtPct(totDbM),
      rowClass: 'trends-tr-pct',
    },
  ]

  // ── Section 2: Auftragsbestand ───────────────────────────────────────────

  const backlogData = {
    labels,
    datasets: [{
      label: 'Auftragsbestand',
      data: periods.map(p => p.auftragsbestand),
      borderColor: C.backlog, backgroundColor: C.backlog + '22',
      borderWidth: 2, fill: true, tension: 0.3,
      pointRadius: dotR, pointHoverRadius: 5,
    }],
  }

  const backlogOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' as const, labels: { font: { size: 11 }, boxWidth: 12 } },
      tooltip: {
        callbacks: { label: (ctx: any) => `Auftragsbestand: ${FMT_EUR.format(ctx.parsed.y)}` },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { title: { display: true, text: 'EUR', font: { size: 10 } }, ticks: { font: { size: 10 } } },
    },
  }

  const backlogRows: TableRow[] = [
    {
      label: 'Auftragsbestand',
      values: periods.map(p => fmtEur(p.auftragsbestand)),
      avg: '–',
      total: fmtEur(periods[n - 1]?.auftragsbestand ?? null),
    },
    {
      label: 'Δ Vorperiode',
      values: periods.map((p, i) => {
        if (i === 0) return '–'
        const d = p.auftragsbestand - periods[i - 1].auftragsbestand
        return (d >= 0 ? '+' : '') + FMT_EUR.format(d)
      }),
      avg: '–',
      total: '–',
      rowClass: 'trends-tr-delta',
    },
  ]

  // ── Section 3: Stunden & Kosten ──────────────────────────────────────────

  const stundenData = {
    labels,
    datasets: [
      {
        type: 'bar' as const, label: 'Stunden', yAxisID: 'y',
        data: periods.map(p => p.stunden),
        backgroundColor: C.stunden + 'bb', borderColor: C.stunden, borderWidth: 1, borderRadius: 3, order: 2,
      },
      {
        type: 'line' as const, label: 'Ø Stundensatz (€)', yAxisID: 'y2',
        data: periods.map(p => p.avg_stundensatz),
        borderColor: C.kosten, backgroundColor: 'transparent', borderWidth: 2,
        pointRadius: dotR, pointHoverRadius: 5, tension: 0.3, order: 1,
      },
    ],
  }

  const stundenOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' as const, labels: { font: { size: 11 }, boxWidth: 12 } },
      tooltip: {
        mode: 'index', intersect: false,
        callbacks: {
          label: (ctx: any) =>
            ctx.dataset.yAxisID === 'y2'
              ? `Ø Stundensatz: ${FMT_EUR2.format(ctx.parsed.y)}`
              : `Stunden: ${FMT_H.format(ctx.parsed.y)} h`,
        },
      },
    },
    scales: {
      x:  { grid: { display: false }, ticks: { font: { size: 10 } } },
      y:  { title: { display: true, text: 'Stunden', font: { size: 10 } }, ticks: { font: { size: 10 } } },
      y2: {
        position: 'right' as const,
        title: { display: true, text: 'Ø Stundensatz (€)', font: { size: 10 } },
        ticks: { font: { size: 10 } },
        grid:  { drawOnChartArea: false },
      },
    },
  }

  const stundenRows: TableRow[] = [
    {
      label: 'Stunden',
      values: periods.map(p => fmtH(p.stunden)),
      avg: fmtH(n > 0 ? totH / n : null),
      total: fmtH(totH),
    },
    {
      label: 'Kosten',
      values: periods.map(p => fmtEur(p.kosten)),
      avg: fmtEur(n > 0 ? totKost / n : null),
      total: fmtEur(totKost),
    },
    {
      label: 'Ø Stundensatz',
      values: periods.map(p => fmtEur2(p.avg_stundensatz)),
      avg: fmtEur2(avgSts),
      total: fmtEur2(avgSts),
      rowClass: 'trends-tr-pct',
    },
  ]

  // ── Section 4: Zahlungsfluss ─────────────────────────────────────────────

  const cashData = {
    labels,
    datasets: [
      {
        type: 'bar' as const, label: 'Fakturiert',
        data: periods.map(p => p.fakturiert),
        backgroundColor: C.fakturiert + 'bb', borderColor: C.fakturiert, borderWidth: 1, borderRadius: 3,
      },
      {
        type: 'bar' as const, label: 'Bezahlt',
        data: periods.map(p => p.bezahlt),
        backgroundColor: C.bezahlt + 'bb', borderColor: C.bezahlt, borderWidth: 1, borderRadius: 3,
      },
    ],
  }

  const cashOpts = {
    ...baseOpts('EUR'),
    plugins: {
      ...(baseOpts('EUR') as any).plugins,
      tooltip: {
        mode: 'index', intersect: false,
        callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${FMT_EUR.format(ctx.parsed.y)}` },
      },
    },
  }

  const cashRows: TableRow[] = [
    {
      label: 'Fakturiert',
      values: periods.map(p => fmtEur(p.fakturiert)),
      avg: fmtEur(n > 0 ? totFakt / n : null),
      total: fmtEur(totFakt),
    },
    {
      label: 'Bezahlt',
      values: periods.map(p => fmtEur(p.bezahlt)),
      avg: fmtEur(n > 0 ? totBez / n : null),
      total: fmtEur(totBez),
    },
    {
      label: 'Differenz',
      values: periods.map(p => {
        const d = p.fakturiert - p.bezahlt
        return (d >= 0 ? '+' : '') + FMT_EUR.format(d)
      }),
      avg: fmtEur(n > 0 ? (totFakt - totBez) / n : null),
      total: fmtEur(totFakt - totBez),
      rowClass: 'trends-tr-delta',
    },
    {
      label: 'Bezahlt %',
      values: periods.map(p => fmtPct(p.fakturiert > 0 ? (p.bezahlt / p.fakturiert) * 100 : null)),
      avg: fmtPct(totFakt > 0 ? (totBez / totFakt) * 100 : null),
      total: fmtPct(totFakt > 0 ? (totBez / totFakt) * 100 : null),
      rowClass: 'trends-tr-pct',
    },
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="trends-root">

      <div className="trends-controls">
        <div className="unk-period-tabs">
          {GROUP_TABS.map(t => (
            <button
              key={t.id}
              className={`unk-period-tab${groupBy === t.id ? ' active' : ''}`}
              onClick={() => handleGroupBy(t.id)}
            >{t.label}</button>
          ))}
        </div>
        <div className="trends-daterange">
          <span className="trends-range-label">Von</span>
          <input type="date" className="inline-date-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span className="trends-range-label">Bis</span>
          <input type="date" className="inline-date-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
      </div>

      {isLoading && (
        <p className="empty-note" style={{ padding: '60px 0', textAlign: 'center' }}>Laden …</p>
      )}
      {!isLoading && periods.length === 0 && (
        <p className="empty-note" style={{ padding: '60px 0', textAlign: 'center' }}>
          Keine Daten im gewählten Zeitraum.
        </p>
      )}

      {!isLoading && periods.length > 0 && (
        <div className="trends-sections">

          <section className="trends-section">
            <SectionHeader
              title="Deckungsbeitrag-Entwicklung"
              subtitle="Fakturierter Umsatz minus direkte Personalkosten pro Periode"
            />
            <ChartBox>
              <Chart type="bar" data={dbData as any} options={dbOpts as any} />
            </ChartBox>
            <PeriodTable periods={periods} rows={dbRows} />
          </section>

          <section className="trends-section">
            <SectionHeader
              title="Auftragsbestand-Entwicklung"
              subtitle="Kumuliertes Projektbudget abzüglich bereits fakturierter Beträge — zeigt die verbleibende Pipeline"
            />
            <ChartBox>
              <Chart type="line" data={backlogData as any} options={backlogOpts as any} />
            </ChartBox>
            <PeriodTable periods={periods} rows={backlogRows} />
          </section>

          <section className="trends-section">
            <SectionHeader
              title="Stunden & Kosten"
              subtitle="Gebuchte Stunden und direkte Personalkosten sowie Entwicklung des Durchschnittsstundensatzes"
            />
            <ChartBox>
              <Chart type="bar" data={stundenData as any} options={stundenOpts as any} />
            </ChartBox>
            <PeriodTable periods={periods} rows={stundenRows} />
          </section>

          <section className="trends-section">
            <SectionHeader
              title="Zahlungsfluss"
              subtitle="Fakturierter Umsatz vs. tatsächliche Zahlungseingänge — zeigt offene Forderungen und Inkassoeffizienz"
            />
            <ChartBox>
              <Chart type="bar" data={cashData as any} options={cashOpts as any} />
            </ChartBox>
            <PeriodTable periods={periods} rows={cashRows} />
          </section>

        </div>
      )}
    </div>
  )
}
