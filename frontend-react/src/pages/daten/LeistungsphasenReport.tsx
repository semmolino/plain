import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
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

type Ampel = PhaseReportRow['ampel']

const AMPEL_COLOR: Record<Ampel, string> = {
  rot:    'var(--danger)',
  orange: 'var(--warning)',
  gruen:  'var(--success)',
}
const AMPEL_LABEL: Record<Ampel, string> = {
  rot:    'Kritisch — Kostenquote hoch oder Deckungsbeitrag negativ',
  orange: 'Beobachten — Kostenquote erhöht',
  gruen:  'Im Plan',
}

function AmpelDot({ ampel }: { ampel: Ampel }) {
  return (
    <span
      title={AMPEL_LABEL[ampel]}
      aria-label={AMPEL_LABEL[ampel]}
      style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: AMPEL_COLOR[ampel] }}
    />
  )
}

// ── Aggregation zu Blöcken (clientseitig aus den Phasen-Zeilen) ────────────────

interface BlockGroup {
  key:        string
  name:       string
  sort:       number
  isCatchAll: boolean   // "Weitere Phasen" (Phasen ohne Block)
  phases:     PhaseReportRow[]
  HONORAR_NET: number
  EARNED_VALUE_NET: number
  HOURS_TOTAL: number
  COST_TOTAL:  number
  LEISTUNGSSTAND_PERCENT: number | null
  KOSTENQUOTE: number | null
  DB:          number
  ampel:       Ampel
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function ampelFor(earned: number, cost: number): Ampel {
  const kq = earned > 0 ? cost / earned : null
  const db = earned - cost
  if ((kq != null && kq >= 0.9) || (db < 0 && (cost > 500 || earned > 500))) return 'rot'
  if (kq != null && kq >= 0.75) return 'orange'
  return 'gruen'
}

function buildBlocks(phases: PhaseReportRow[]): BlockGroup[] {
  const map = new Map<string, BlockGroup>()
  for (const p of phases) {
    const key  = p.BLOCK_ID != null ? `b${p.BLOCK_ID}` : 'none'
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: p.BLOCK_ID != null ? (p.BLOCK_NAME ?? 'Block') : 'Weitere Phasen',
        sort: p.BLOCK_ID != null ? (p.BLOCK_SORT ?? 0) : Number.MAX_SAFE_INTEGER,
        isCatchAll: p.BLOCK_ID == null,
        phases: [],
        HONORAR_NET: 0, EARNED_VALUE_NET: 0, HOURS_TOTAL: 0, COST_TOTAL: 0,
        LEISTUNGSSTAND_PERCENT: null, KOSTENQUOTE: null, DB: 0, ampel: 'gruen',
      })
    }
    const g = map.get(key)!
    g.phases.push(p)
    g.HONORAR_NET      += p.HONORAR_NET
    g.EARNED_VALUE_NET += p.EARNED_VALUE_NET
    g.HOURS_TOTAL      += p.HOURS_TOTAL
    g.COST_TOTAL       += p.COST_TOTAL
  }
  const groups = [...map.values()]
  for (const g of groups) {
    g.HONORAR_NET = round2(g.HONORAR_NET)
    g.EARNED_VALUE_NET = round2(g.EARNED_VALUE_NET)
    g.HOURS_TOTAL = round2(g.HOURS_TOTAL)
    g.COST_TOTAL = round2(g.COST_TOTAL)
    g.LEISTUNGSSTAND_PERCENT = g.HONORAR_NET > 0 ? round2((g.EARNED_VALUE_NET / g.HONORAR_NET) * 100) : null
    g.KOSTENQUOTE = g.EARNED_VALUE_NET > 0 ? g.COST_TOTAL / g.EARNED_VALUE_NET : null
    g.DB = round2(g.EARNED_VALUE_NET - g.COST_TOTAL)
    g.ampel = ampelFor(g.EARNED_VALUE_NET, g.COST_TOTAL)
  }
  return groups.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
}

// ── Balkendiagramm: Honorar/Leistung/Kosten je Phase (oder Block) ─────────────

function PhaseBarChart({ labels, honorar, leistung, kosten, title }: {
  labels: string[]; honorar: number[]; leistung: number[]; kosten: number[]; title: string
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
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 16, color: t.text, font: { size: 12 } } },
      tooltip: {
        backgroundColor: t.tooltipBg, titleColor: t.tooltipFg, bodyColor: t.tooltipFg, padding: 12, cornerRadius: 8,
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
      <h3 className="timeline-title">{title}</h3>
      <div className="timeline-chart"><Bar data={data} options={options} /></div>
    </div>
  )
}

// ── Zeilen ────────────────────────────────────────────────────────────────────

function PhaseCells({ p, indent }: { p: PhaseReportRow; indent?: boolean }) {
  return (
    <>
      <td style={indent ? { paddingLeft: 28 } : undefined}>
        {p.NAME_SHORT}
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
    </>
  )
}

export function LeistungsphasenReport({ projectId }: { projectId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['project-phases', projectId],
    queryFn:  () => fetchProjectPhases(projectId),
    enabled:  projectId != null,
  })

  const report = data?.data
  const phases = useMemo(() => report?.phases ?? [], [report])
  const totals = report?.totals ?? null
  const hasBlocks = report?.hasBlocks ?? false

  const blocks = useMemo(() => hasBlocks ? buildBlocks(phases) : [], [hasBlocks, phases])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggle = (key: string) => setCollapsed(c => ({ ...c, [key]: !c[key] }))

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

  // Diagramm: bei Blöcken je Block, sonst je Phase.
  const chart = hasBlocks
    ? { labels: blocks.map(b => b.name), honorar: blocks.map(b => b.HONORAR_NET), leistung: blocks.map(b => b.EARNED_VALUE_NET), kosten: blocks.map(b => b.COST_TOTAL), title: 'Honorar · Leistung · Kosten je Block' }
    : { labels: phases.map(p => p.NAME_SHORT), honorar: phases.map(p => p.HONORAR_NET), leistung: phases.map(p => p.EARNED_VALUE_NET), kosten: phases.map(p => p.COST_TOTAL), title: 'Honorar · Leistung · Kosten je Leistungsphase' }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <h3 className="timeline-title" style={{ margin: 0 }}>Auswertung nach Leistungsphase</h3>
        <HelpHint id="report.leistungsphasen" />
        {hasBlocks && (
          <span className="empty-note" style={{ margin: 0, marginLeft: 'auto' }}>
            Nach Blöcken gruppiert — Zeile aufklappen für die einzelnen Phasen
          </span>
        )}
      </div>

      <div className="list-section table-scroll">
        <table className="master-table">
          <thead>
            <tr>
              <th scope="col">{hasBlocks ? 'Block / Leistungsphase' : 'Leistungsphase'}</th>
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
            {hasBlocks
              ? blocks.map(b => {
                  const isCollapsed = collapsed[b.key]
                  return (
                    <FragmentRows key={b.key}>
                      <tr
                        className="sum-row"
                        style={{ cursor: 'pointer' }}
                        onClick={() => toggle(b.key)}
                      >
                        <td>
                          <button type="button" className="row-action-btn" aria-label={isCollapsed ? 'Aufklappen' : 'Zuklappen'}
                            style={{ marginRight: 4, verticalAlign: 'middle' }}
                            onClick={(e) => { e.stopPropagation(); toggle(b.key) }}>
                            {isCollapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
                          </button>
                          <strong>{b.name}</strong>
                        </td>
                        <td className="num"><strong>{fmtEur(b.HONORAR_NET)}</strong></td>
                        <td className="num"><strong>{fmtPct(b.LEISTUNGSSTAND_PERCENT)}</strong></td>
                        <td className="num"><strong>{fmtEur(b.EARNED_VALUE_NET)}</strong></td>
                        <td className="num"><strong>{fmtH(b.HOURS_TOTAL)}</strong></td>
                        <td className="num"><strong>{fmtEur(b.COST_TOTAL)}</strong></td>
                        <td className="num"><strong>{b.KOSTENQUOTE != null ? fmtPct(b.KOSTENQUOTE * 100) : '—'}</strong></td>
                        <td className="num" style={{ color: b.DB < 0 ? 'var(--danger)' : undefined }}><strong>{fmtEur(b.DB)}</strong></td>
                        <td style={{ textAlign: 'center' }}>{!b.isCatchAll && <AmpelDot ampel={b.ampel} />}</td>
                      </tr>
                      {!isCollapsed && b.phases.map(p => (
                        <tr key={p.PHASE_STRUCTURE_ID ?? `none-${p.NAME_SHORT}`}>
                          <PhaseCells p={p} indent />
                        </tr>
                      ))}
                    </FragmentRows>
                  )
                })
              : phases.map(p => (
                  <tr key={p.PHASE_STRUCTURE_ID ?? 'none'} className={p.IS_UNASSIGNED ? 'is-muted-row' : undefined}>
                    <PhaseCells p={p} />
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

      {phases.length > 0 && <PhaseBarChart {...chart} />}
    </div>
  )
}

// Kleiner Helfer: mehrere <tr> ohne zusätzliches DOM-Element gruppieren.
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
