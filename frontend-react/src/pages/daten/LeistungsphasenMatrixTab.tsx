import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend, type ChartOptions,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { fetchPhaseMatrix } from '@/api/reports'
import { fetchProjectGroups } from '@/api/gesamtprojekte'
import { groupLabel } from '@/pages/projekte/gesamtprojekt/gesamtprojektUi'
import { HelpHint } from '@/components/ui/HelpHint'
import { FilterBar } from '@/components/ui/FilterBar'
import { FilterChip } from '@/components/ui/FilterChip'
import { KpiValue } from '@/components/ui/KpiValue'
import { useChartTheme, useSeriesColors } from '@/theme/chartTheme'
import { useTenantDefaults } from '@/hooks/useTenantDefaults'
import { costRatioLevel, readCpiThresholds, type CpiThresholds } from '@/utils/kpiLevel'
import { fmtEur, fmtEur0, money, money0, NO_VALUE } from '@/utils/money'
import {
  activeFilterCount, aggregateLph, applyLphFilters, emptyLphFilters, hoursShareExceeds,
  lphColumns, lphFilterOptions, type LphCell, type LphDim, type LphFilters,
} from './lphMatrixCalc'

const FMT_H    = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
const FMT_PCT  = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const fmtH     = (v: number | null | undefined) => v == null ? NO_VALUE : FMT_H.format(v) + ' h'
const fmtPct   = (v: number | null | undefined) => v == null ? NO_VALUE : FMT_PCT.format(v) + ' %'
const fmtRate  = (v: number | null | undefined) => v == null ? NO_VALUE : `${fmtEur0(v)}/h`
const fmtKq    = (c: LphCell) => c.KOSTENQUOTE != null ? fmtPct(c.KOSTENQUOTE * 100) : NO_VALUE

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

type Metric = 'kostenquote' | 'leistungsstand' | 'db' | 'db_prognose' | 'leistung_h' | 'stunden' | 'reststunden'

const METRICS: { id: Metric; label: string }[] = [
  { id: 'kostenquote',    label: 'Kostenquote' },
  { id: 'leistungsstand', label: 'Leistungsstand' },
  { id: 'db',             label: 'Deckungsbeitrag' },
  { id: 'db_prognose',    label: 'DB-Prognose bei Fertigstellung' },
  { id: 'leistung_h',     label: 'Leistung je Stunde' },
  { id: 'stunden',        label: 'Stunden' },
  { id: 'reststunden',    label: 'Reststunden (Prognose)' },
]

const METRIC_KEY = 'lph-matrix:metric'
function readMetric(): Metric {
  try {
    const v = localStorage.getItem(METRIC_KEY)
    return METRICS.some(m => m.id === v) ? v as Metric : 'kostenquote'
  } catch { return 'kostenquote' }
}

/** Zellwert; kompakt (ganze Euro), die Tabelle darunter zeigt Cent. */
function cellValue(c: LphCell, metric: Metric) {
  switch (metric) {
    case 'kostenquote':    return fmtKq(c)
    case 'leistungsstand': return fmtPct(c.LEISTUNGSSTAND_PERCENT)
    case 'db':             return money0(c.DB)
    case 'db_prognose':    return money0(c.DB_PROGNOSE)
    case 'leistung_h':     return fmtRate(c.LEISTUNG_JE_STUNDE)
    case 'stunden':        return fmtH(c.HOURS_TOTAL)
    case 'reststunden':    return fmtH(c.RESTSTUNDEN)
  }
}

function cellTitle(c: LphCell): string {
  return [
    `Honorar: ${fmtEur(c.HONORAR_NET)}`,
    `Leistung: ${fmtEur(c.EARNED_VALUE_NET)} (${fmtPct(c.LEISTUNGSSTAND_PERCENT)})`,
    `Stunden: ${fmtH(c.HOURS_TOTAL)}`,
    `Kosten: ${fmtEur(c.COST_TOTAL)}`,
    `Kostenquote: ${fmtKq(c)}`,
    `Deckungsbeitrag: ${fmtEur(c.DB)}`,
    `DB-Prognose: ${c.DB_PROGNOSE != null ? fmtEur(c.DB_PROGNOSE) : NO_VALUE}`,
    `Leistung je Stunde: ${fmtRate(c.LEISTUNG_JE_STUNDE)} (Kosten je Stunde ${fmtRate(c.KOSTEN_JE_STUNDE)})`,
    `Reststunden: ${fmtH(c.RESTSTUNDEN)}`,
  ].join('\n')
}

/**
 * Zelle mit Controlling-Ampel. Die Stufe kommt aus der Kostenquote — mit den
 * Schwellen des Büros wie in Projektliste und Einzelprojekt — und markiert
 * die Zelle, gleich welche Kennzahl gerade darin steht: die Matrix fragt
 * „wo brennt es?". Markiert wird nur „beobachten" und „Handlungsbedarf";
 * eine gesunde Zelle ist der Normalfall (Farbkonzept §2).
 */
function MatrixCell({ c, metric, t, strong }: { c: LphCell; metric: Metric; t: CpiThresholds; strong?: boolean }) {
  const level = costRatioLevel(c.KOSTENQUOTE, t)
  const flagged = level === 'watch' || level === 'critical'
  const value = cellValue(c, metric)
  return (
    <td className={`num${flagged ? ` lph-cell lph-cell--${level}` : ''}`} title={cellTitle(c)}>
      {flagged
        ? <KpiValue level={level} reason={`Kostenquote ${fmtKq(c)}`} bold={strong}>{value}</KpiValue>
        : strong ? <strong>{value}</strong> : value}
    </td>
  )
}

function PortfolioBarChart({ labels, honorar, leistung, kosten, scopeLabel }: {
  labels: string[]; honorar: number[]; leistung: number[]; kosten: number[]; scopeLabel: string
}) {
  const t = useChartTheme()
  const c = useSeriesColors()
  const data = useMemo(() => ({
    labels,
    datasets: [
      { label: 'Honorar',  data: honorar,  backgroundColor: c.honorar,  borderRadius: 3, maxBarThickness: 34 },
      { label: 'Leistung', data: leistung, backgroundColor: c.leistung, borderRadius: 3, maxBarThickness: 34 },
      { label: 'Kosten',   data: kosten,   backgroundColor: c.kosten,   borderRadius: 3, maxBarThickness: 34 },
    ],
  }), [labels, honorar, leistung, kosten, c])
  const options: ChartOptions<'bar'> = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 16, color: t.text, font: { size: 12 } } },
      tooltip: { backgroundColor: t.tooltipBg, titleColor: t.tooltipFg, bodyColor: t.tooltipFg, padding: 12, cornerRadius: 8,
        callbacks: { label: (ctx) => `  ${ctx.dataset.label ?? ''}: ${fmtEur(ctx.parsed.y ?? 0)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: t.textMuted, font: { size: 11 } } },
      y: { grid: { color: t.grid }, ticks: { color: t.textMuted, font: { size: 11 }, callback: (v) => fmtEur0(Number(v)) } },
    },
  }
  return (
    <div className="timeline-wrap">
      <h3 className="timeline-title">Honorar · Leistung · Kosten je Leistungsphase ({scopeLabel})</h3>
      <div className="timeline-chart"><Bar data={data} options={options} /></div>
    </div>
  )
}

const CHIPS: { dim: LphDim; label: string }[] = [
  { dim: 'lb',           label: 'Leistungsbild' },
  { dim: 'zone',         label: 'Honorarzone' },
  { dim: 'status',       label: 'Status' },
  { dim: 'typ',          label: 'Typ' },
  { dim: 'abteilung',    label: 'Abteilung' },
  { dim: 'leitung',      label: 'Projektleitung' },
  { dim: 'auftraggeber', label: 'Auftraggeber' },
]

/**
 * LPH-Controlling: Projekte × Leistungsphasen. Mit `fixedGroupId` (Reiter im
 * Gesamtprojekt) nur dessen Projekte — beim Stufenvertrag stehen LPH 1–4 und
 * 5–8 aus zwei Verträgen dann als ein Bild. Im Reporting lässt sich ein
 * Gesamtprojekt wählen; Leistungsbild, Honorarzone und Projektmerkmale
 * filtern im Browser (`lphMatrixCalc.ts`).
 */
export function LeistungsphasenMatrixTab({ fixedGroupId }: { fixedGroupId?: number } = {}) {
  const navigate = useNavigate()
  const cpiT = readCpiThresholds(useTenantDefaults())
  const [metric, setMetricState] = useState<Metric>(readMetric)
  const setMetric = (m: Metric) => {
    setMetricState(m)
    try { localStorage.setItem(METRIC_KEY, m) } catch { /* nur Vorliebe */ }
  }
  const [chosenGroup, setChosenGroup] = useState('')
  const [filters, setFilters] = useState<LphFilters>(emptyLphFilters)
  const [search, setSearch] = useState('')
  const groupId = fixedGroupId ?? (chosenGroup ? Number(chosenGroup) : null)

  // Auswahl nur im Reporting; ohne projects.view (403) entfällt sie.
  const { data: groupsData } = useQuery({
    queryKey: ['project-groups'], queryFn: fetchProjectGroups,
    enabled: fixedGroupId == null, retry: false, staleTime: 60_000,
  })
  const groups = groupsData?.data ?? []

  const { data, isLoading, isError } = useQuery({
    queryKey: ['phase-matrix', groupId],
    queryFn:  () => fetchPhaseMatrix(groupId),
    staleTime: 300000,
  })

  const matrix   = data?.data
  const meta     = data?.meta
  const allProjects = matrix?.projects ?? []
  const allFacts    = matrix?.facts ?? []
  const leistungsbilder = matrix?.leistungsbilder ?? []

  const options  = useMemo(() => lphFilterOptions(allProjects, allFacts), [allProjects, allFacts])
  const filtered = useMemo(() => applyLphFilters(allProjects, allFacts, filters, search), [allProjects, allFacts, filters, search])
  const columns  = useMemo(() => lphColumns(filtered.facts, leistungsbilder), [filtered.facts, leistungsbilder])
  const view     = useMemo(() => aggregateLph(filtered.projects, filtered.facts, columns), [filtered, columns])
  const lbInView = useMemo(() => [...new Set(filtered.facts.map(f => f.LB))], [filtered.facts])
  const lbLabel  = (key: string) => leistungsbilder.find(l => l.key === key)?.label ?? (key || 'ohne Leistungsbild')
  const chipLabel = (dim: LphDim, v: string) =>
    dim === 'lb' ? lbLabel(v) : !v ? '(ohne)' : dim === 'zone' ? `Zone ${v}` : v
  const singleLb = lbInView.length === 1
  const scopeLabel = groupId ? 'Gesamtprojekt' : 'Portfolio'
  const nActive  = activeFilterCount(filters)

  const setDim = (dim: LphDim, v: Set<string>) => setFilters(f => ({ ...f, [dim]: v }))
  const resetFilters = () => { setFilters(emptyLphFilters()); setSearch('') }
  const onlyLb = (key: string) => setFilters(f => ({ ...f, lb: new Set([key]) }))

  const goToProject = (projectId: number) =>
    navigate('/daten', { state: { tab: 'einzelprojekt', projectId } })

  const groupPicker = fixedGroupId == null && groups.length > 0 && (
    <label className="pg-matrix-pick">
      <span>Gesamtprojekt</span>
      <select value={chosenGroup} onChange={e => setChosenGroup(e.target.value)}>
        <option value="">Alle Projekte</option>
        {groups.map(g => <option key={g.ID} value={g.ID}>{groupLabel(g)}</option>)}
      </select>
    </label>
  )
  const partial = meta && meta.members_visible < meta.members_total && (
    <p className="pg-scope-note">
      {meta.members_visible} von {meta.members_total} Projekten des Gesamtprojekts liegen in deinem Reporting-Bereich.
      <HelpHint id="report.gesamtprojekt" size={12} />
    </p>
  )

  if (isLoading) return <p className="empty-note">Laden …</p>
  if (isError)   return <p className="empty-note" style={{ color: 'var(--danger)' }}>Fehler beim Laden der Leistungsphasen-Auswertung.</p>
  if (allProjects.length === 0) {
    return (
      <div>
        {groupPicker}
        {partial}
        <p className="empty-note">
          {groupId
            ? 'Keines der Projekte dieses Gesamtprojekts hat eine Leistungsphasen-Struktur. Sie entsteht, wenn ein Projekt aus einer HOAI-Kalkulation erzeugt oder die Kalkulation in die Struktur übernommen wird.'
            : 'Keine Projekte mit Leistungsphasen-Struktur. Sobald Projekte aus einer HOAI-Honorarberechnung erzeugt werden, erscheinen sie hier — mit Kennzahlen je Leistungsphase über das gesamte Portfolio.'}
        </p>
      </div>
    )
  }

  const chips = CHIPS.filter(c => options[c.dim].length > 1 || filters[c.dim].size > 0)

  return (
    <div>
      <div className="lph-head">
        <h3 className="timeline-title" style={{ margin: 0 }}>
          {groupId ? 'Leistungsphasen im Gesamtprojekt' : 'Leistungsphasen über alle Projekte'}
        </h3>
        <HelpHint id="report.lph_matrix" />
        {groupPicker}
      </div>

      <div className="list-toolbar">
        <input type="search" className="list-search" placeholder="Projekt suchen …" aria-label="Projekt suchen"
          value={search} onChange={e => setSearch(e.target.value)} />
        {chips.length > 0 && (
          <FilterBar activeCount={nActive} onReset={resetFilters}>
            {chips.map(c => (
              <FilterChip key={c.dim} label={c.label}
                options={options[c.dim].map(v => ({ value: v, label: chipLabel(c.dim, v) }))}
                active={filters[c.dim]} onChange={v => setDim(c.dim, v)} />
            ))}
          </FilterBar>
        )}
        <label className="lph-metric">
          <span>Kennzahl</span>
          <select value={metric} onChange={e => setMetric(e.target.value as Metric)}>
            {METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      </div>
      {partial}

      {lbInView.length > 1 && (
        <p className="pg-scope-note lph-mixed">
          Hier stehen {lbInView.length} Leistungsbilder zusammen — eine Leistungsphase ist dort nicht überall
          dieselbe Leistung. Für Vergleiche ein Leistungsbild wählen:
          {lbInView.map(k => (
            <button key={k} type="button" className="link-btn" onClick={() => onlyLb(k)}>{lbLabel(k)}</button>
          ))}
          <HelpHint id="report.lph_leistungsbild" size={12} />
        </p>
      )}

      {view.rows.length === 0 ? (
        <p className="empty-note">
          Keine Leistungsphasen passen zu Suche und Filtern.{' '}
          <button type="button" className="link-btn" onClick={resetFilters}>Filter zurücksetzen</button>
        </p>
      ) : (
        <>
          {/* Matrix: Projekte × Leistungsphase */}
          <div className="list-section table-scroll lph-table">
            <table className="master-table">
              <thead>
                <tr>
                  <th scope="col">Projekt</th>
                  {columns.map(col => <th key={col.key} scope="col" className="num" title={col.title}>{col.key}</th>)}
                  <th scope="col" className="num">Gesamt</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map(r => (
                  <tr key={r.project.PROJECT_ID}>
                    <td>
                      <button type="button" className="link-btn" onClick={() => goToProject(r.project.PROJECT_ID)}
                        title="Zum Projekt-Report">
                        <strong>{r.project.ABBR}</strong>
                      </button>
                      {r.project.NAME && <span className="tree-name-long"> {r.project.NAME}</span>}
                    </td>
                    {columns.map(col => {
                      const c = r.cells[col.key]
                      return c ? <MatrixCell key={col.key} c={c} metric={metric} t={cpiT} />
                        : <td key={col.key} className="num">{NO_VALUE}</td>
                    })}
                    <MatrixCell c={r.total} metric={metric} t={cpiT} strong />
                  </tr>
                ))}
              </tbody>
              {view.totals && view.rows.length > 1 && (
                <tfoot>
                  <tr className="sum-row">
                    <td>Summe</td>
                    {columns.map(col => {
                      const a = view.byPhase.find(p => p.key === col.key)
                      return a ? <MatrixCell key={col.key} c={a} metric={metric} t={cpiT} strong />
                        : <td key={col.key} className="num">{NO_VALUE}</td>
                    })}
                    <MatrixCell c={view.totals} metric={metric} t={cpiT} strong />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Aggregat je Leistungsphase */}
          <div className="lph-head" style={{ marginTop: 24 }}>
            <h3 className="timeline-title" style={{ margin: 0 }}>
              Je Leistungsphase{singleLb ? ` — ${lbLabel(lbInView[0])}` : ''}
            </h3>
            <HelpHint id="report.lph_stundenanteil" />
          </div>
          <div className="list-section table-scroll lph-table">
            <table className="master-table">
              <thead>
                <tr>
                  <th scope="col">Leistungsphase</th>
                  <th scope="col" className="num">Projekte</th>
                  <th scope="col" className="num">Honorar</th>
                  <th scope="col" className="num">Leistung</th>
                  <th scope="col" className="num">Stunden</th>
                  <th scope="col" className="num">Kosten</th>
                  <th scope="col" className="num">Kostenquote</th>
                  <th scope="col" className="num">Deckungsbeitrag</th>
                  <th scope="col" className="num">DB-Prognose <HelpHint id="report.lph_db_prognose" size={12} /></th>
                  <th scope="col" className="num">Leistung je h <HelpHint id="report.lph_leistung_je_stunde" size={12} /></th>
                  <th scope="col" className="num">Reststunden <HelpHint id="report.lph_reststunden" size={12} /></th>
                  <th scope="col" className="num">Stundenanteil</th>
                  <th scope="col" className="num">Honoraranteil</th>
                  {singleLb && <th scope="col" className="num">HOAI-Anteil</th>}
                </tr>
              </thead>
              <tbody>
                {view.byPhase.map(ph => {
                  const col = columns.find(c => c.key === ph.key)
                  const over = hoursShareExceeds(ph)
                  const level = costRatioLevel(ph.KOSTENQUOTE, cpiT)
                  return (
                    <tr key={ph.key}>
                      <td title={col?.title}>
                        <strong>{ph.key}</strong>
                        {col?.name && <span className="tree-name-long"> {col.name}</span>}
                      </td>
                      <td className="num">{ph.PROJECT_COUNT}</td>
                      <td className="num">{money(ph.HONORAR_NET)}</td>
                      <td className="num">{money(ph.EARNED_VALUE_NET)}</td>
                      <td className="num">{fmtH(ph.HOURS_TOTAL)}</td>
                      <td className="num">{money(ph.COST_TOTAL)}</td>
                      <td className="num">
                        {level === 'watch' || level === 'critical'
                          ? <KpiValue level={level} bold={false}>{fmtKq(ph)}</KpiValue>
                          : fmtKq(ph)}
                      </td>
                      <td className="num">{money(ph.DB)}</td>
                      <td className="num">{money(ph.DB_PROGNOSE)}</td>
                      <td className="num" title={`Kosten je Stunde: ${fmtRate(ph.KOSTEN_JE_STUNDE)}`}>{fmtRate(ph.LEISTUNG_JE_STUNDE)}</td>
                      <td className="num">{fmtH(ph.RESTSTUNDEN)}</td>
                      <td className="num">
                        {over
                          ? <KpiValue level="watch" bold reason={`Stundenanteil ${fmtPct(ph.HOURS_SHARE)} über Honoraranteil ${fmtPct(ph.HONORAR_SHARE)}`}>{fmtPct(ph.HOURS_SHARE)}</KpiValue>
                          : fmtPct(ph.HOURS_SHARE)}
                      </td>
                      <td className="num">{fmtPct(ph.HONORAR_SHARE)}</td>
                      {singleLb && <td className="num">{fmtPct(col?.hoaiPercent)}</td>}
                    </tr>
                  )
                })}
              </tbody>
              {view.totals && (
                <tfoot>
                  <tr className="sum-row">
                    <td>Summe</td>
                    <td className="num">{view.rows.length}</td>
                    <td className="num">{money(view.totals.HONORAR_NET)}</td>
                    <td className="num">{money(view.totals.EARNED_VALUE_NET)}</td>
                    <td className="num">{fmtH(view.totals.HOURS_TOTAL)}</td>
                    <td className="num">{money(view.totals.COST_TOTAL)}</td>
                    <td className="num">{fmtKq(view.totals)}</td>
                    <td className="num">{money(view.totals.DB)}</td>
                    <td className="num">{money(view.totals.DB_PROGNOSE)}</td>
                    <td className="num">{fmtRate(view.totals.LEISTUNG_JE_STUNDE)}</td>
                    <td className="num">{fmtH(view.totals.RESTSTUNDEN)}</td>
                    <td className="num" />
                    <td className="num" />
                    {singleLb && <td className="num" />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {view.byPhase.length > 0 && (
            <PortfolioBarChart
              labels={view.byPhase.map(p => p.key)}
              honorar={view.byPhase.map(p => p.HONORAR_NET)}
              leistung={view.byPhase.map(p => p.EARNED_VALUE_NET)}
              kosten={view.byPhase.map(p => p.COST_TOTAL)}
              scopeLabel={scopeLabel}
            />
          )}
        </>
      )}
    </div>
  )
}
