import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FileText, Lock, SlidersHorizontal, Table2, Trash2 } from 'lucide-react'
import { ListLoading } from '@/components/ui/Skeleton'
import { FilterBar } from '@/components/ui/FilterBar'
import { FilterChip } from '@/components/ui/FilterChip'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message } from '@/components/ui/Message'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Can } from '@/components/ui/Can'
import { usePermission } from '@/store/permissionsStore'
import { useStickyState } from '@/hooks/useStickyState'
import { downloadCsv } from '@/utils/exportData'
import type { HelpId } from '@/help/helpContent'
import {
  fetchWipReport, openWipPdf, fetchWipClosings, createWipClosing, deleteWipClosing,
  type WipMethod, type WipReport, type WipRow, type WipClosing,
} from '@/api/reports'

/**
 * Report „Teilfertige Leistungen" — der kaufmännische Abschluss.
 *
 * Fachliche Herleitung, Rechtsgrundlagen und Rechenmodell:
 * docs/TEILFERTIGE_LEISTUNGEN_CONCEPT.md
 *
 * Zwei Dinge sind hier Absicht und keine Lücke:
 *   • Aktiva (teilfertige Leistungen) und Passiva (erhaltene Anzahlungen)
 *     stehen getrennt und werden nie zu einer Zahl verrechnet — § 246 Abs. 2 HGB.
 *   • Die Zeilenmarker sind Teil des Ergebnisses. Ein Projekt ohne
 *     Leistungsstand-Snapshot zum Stichtag liefert keinen belegten Wert; das
 *     muss man sehen, sonst sieht eine 0 aus wie „nichts geleistet".
 */

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_PCT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const FMT_H   = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtEur = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtPct = (v: number | null | undefined) => v == null ? '—' : `${FMT_PCT.format(v)} %`
const fmtH   = (v: number | null | undefined) => v == null ? '—' : `${FMT_H.format(v)} h`
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return d ? `${d}.${m}.${y}` : iso
}
/** CSV/Excel erwartet deutsche Dezimalkommas. */
const csvNum = (v: number | null | undefined) => v == null ? '' : String(v).replace('.', ',')

// ── Stichtags-Vorbelegungen ───────────────────────────────────────────────────
// Ein Abschluss wird auf einen Ultimo gezogen, nicht auf „heute". Deshalb
// startet der Report auf dem letzten Monatsletzten und vergleicht mit dem
// davor — das ist die Bestandsveränderung, die in der GuV landet.

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Letzter Tag des Monats, der `monthsBack` Monate vor dem aktuellen liegt. */
function monthEnd(monthsBack: number): string {
  const now = new Date()
  return isoDay(new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 0))
}
/** Ultimo des Monats vor dem übergebenen Stichtag. */
function previousMonthEnd(asOf: string): string {
  const [y, m] = asOf.split('-').map(Number)
  if (!y || !m) return ''
  return isoDay(new Date(y, m - 1, 0))
}

// ── Spalten ───────────────────────────────────────────────────────────────────

type ColKey =
  | 'status' | 'manager' | 'typ' | 'abteilung'
  | 'order' | 'performance' | 'lstPct' | 'billed' | 'unbilled'
  | 'cost' | 'costUnbilled' | 'wip' | 'prepayment'
  | 'lossRisk' | 'gain' | 'hours' | 'compare' | 'change' | 'snapshot'

type SortField = 'name' | ColKey

interface ColDef {
  key:            ColKey
  label:          string
  numeric:        boolean
  help?:          HelpId
  defaultVisible: boolean
  /** Nur mit Vergleichsstichtag sinnvoll. */
  needsCompare?:  boolean
  render:      (r: WipRow, method: WipMethod) => React.ReactNode
  sortValue:   (r: WipRow, method: WipMethod) => number | string
  total?:      (rows: WipRow[], method: WipMethod) => React.ReactNode
}

const wipValue = (r: WipRow, method: WipMethod) => method === 'erloes' ? r.WIP_REVENUE_NET : r.WIP_HK_NET
const sumBy = (rows: WipRow[], fn: (r: WipRow) => number) =>
  rows.reduce((acc, r) => acc + (fn(r) || 0), 0)

const COLUMNS: ColDef[] = [
  { key: 'status', label: 'Status', numeric: false, defaultVisible: true,
    render: r => r.PROJECT_STATUS_NAME_SHORT ?? '—', sortValue: r => r.PROJECT_STATUS_NAME_SHORT ?? '' },
  { key: 'manager', label: 'Projektleiter', numeric: false, defaultVisible: false,
    render: r => r.PROJECT_MANAGER_DISPLAY ?? '—', sortValue: r => r.PROJECT_MANAGER_DISPLAY ?? '' },
  { key: 'typ', label: 'Typ', numeric: false, defaultVisible: false,
    render: r => r.PROJECT_TYPE_NAME_SHORT ?? '—', sortValue: r => r.PROJECT_TYPE_NAME_SHORT ?? '' },
  { key: 'abteilung', label: 'Abteilung', numeric: false, defaultVisible: false,
    render: r => r.DEPARTMENT_NAME ?? '—', sortValue: r => r.DEPARTMENT_NAME ?? '' },

  { key: 'order', label: 'Auftragswert', numeric: true, defaultVisible: true, help: 'report.tfl.auftragswert',
    render: r => fmtEur(r.ORDER_VALUE_NET), sortValue: r => r.ORDER_VALUE_NET,
    total: rows => fmtEur(sumBy(rows, r => r.ORDER_VALUE_NET)) },
  { key: 'performance', label: 'Leistungswert', numeric: true, defaultVisible: true, help: 'report.leistungsstand',
    render: r => fmtEur(r.PERFORMANCE_NET), sortValue: r => r.PERFORMANCE_NET,
    total: rows => fmtEur(sumBy(rows, r => r.PERFORMANCE_NET)) },
  { key: 'lstPct', label: 'Leistungsstand', numeric: true, defaultVisible: false, help: 'report.leistungsstand',
    render: r => fmtPct(r.PERFORMANCE_PERCENT), sortValue: r => r.PERFORMANCE_PERCENT ?? -1 },
  { key: 'billed', label: 'Abgerechnet', numeric: true, defaultVisible: true,
    render: r => fmtEur(r.BILLED_NET), sortValue: r => r.BILLED_NET,
    total: rows => fmtEur(sumBy(rows, r => r.BILLED_NET)) },
  { key: 'unbilled', label: 'Unfertig', numeric: true, defaultVisible: true, help: 'report.tfl.unfertig',
    render: r => fmtEur(r.UNBILLED_NET), sortValue: r => r.UNBILLED_NET,
    total: rows => fmtEur(sumBy(rows, r => r.UNBILLED_NET)) },
  { key: 'cost', label: 'Kosten', numeric: true, defaultVisible: false,
    render: r => fmtEur(r.COST_NET), sortValue: r => r.COST_NET,
    total: rows => fmtEur(sumBy(rows, r => r.COST_NET)) },
  { key: 'costUnbilled', label: 'Kosten unfertig', numeric: true, defaultVisible: true, help: 'report.tfl.kostenfaktor',
    render: r => fmtEur(r.COST_UNBILLED_NET), sortValue: r => r.COST_UNBILLED_NET,
    total: rows => fmtEur(sumBy(rows, r => r.COST_UNBILLED_NET)) },
  { key: 'wip', label: 'Teilfertig', numeric: true, defaultVisible: true, help: 'report.tfl.was',
    render: (r, m) => fmtEur(wipValue(r, m)), sortValue: (r, m) => wipValue(r, m),
    total: (rows, m) => fmtEur(sumBy(rows, r => wipValue(r, m))) },
  { key: 'prepayment', label: 'Erh. Anzahlung', numeric: true, defaultVisible: true, help: 'report.tfl.anzahlungen',
    render: r => fmtEur(r.PREPAYMENT_NET), sortValue: r => r.PREPAYMENT_NET,
    total: rows => fmtEur(sumBy(rows, r => r.PREPAYMENT_NET)) },
  { key: 'lossRisk', label: 'Drohverlust', numeric: true, defaultVisible: true, help: 'report.tfl.drohverlust',
    render: r => r.LOSS_RISK_NET > 0
      ? <span style={{ color: 'var(--danger-strong)' }}>{fmtEur(r.LOSS_RISK_NET)}</span>
      : fmtEur(0),
    sortValue: r => r.LOSS_RISK_NET,
    total: rows => fmtEur(sumBy(rows, r => r.LOSS_RISK_NET)) },
  { key: 'gain', label: 'Nicht real. Gewinn', numeric: true, defaultVisible: false, help: 'report.tfl.methode',
    render: r => fmtEur(r.UNREALIZED_GAIN_NET), sortValue: r => r.UNREALIZED_GAIN_NET,
    total: rows => fmtEur(sumBy(rows, r => r.UNREALIZED_GAIN_NET)) },
  { key: 'hours', label: 'Stunden', numeric: true, defaultVisible: false,
    render: r => fmtH(r.HOURS_TOTAL), sortValue: r => r.HOURS_TOTAL,
    total: rows => fmtH(sumBy(rows, r => r.HOURS_TOTAL)) },

  { key: 'compare', label: 'Vergleichswert', numeric: true, defaultVisible: true, needsCompare: true,
    help: 'report.tfl.bestandsveraenderung',
    render: r => fmtEur(r.COMPARE_WIP_NET), sortValue: r => r.COMPARE_WIP_NET ?? 0,
    total: rows => fmtEur(sumBy(rows, r => r.COMPARE_WIP_NET ?? 0)) },
  { key: 'change', label: 'Veränderung', numeric: true, defaultVisible: true, needsCompare: true,
    help: 'report.tfl.bestandsveraenderung',
    render: r => fmtEur(r.CHANGE_WIP_NET), sortValue: r => r.CHANGE_WIP_NET ?? 0,
    total: rows => fmtEur(sumBy(rows, r => r.CHANGE_WIP_NET ?? 0)) },

  { key: 'snapshot', label: 'Snapshot', numeric: false, defaultVisible: true, help: 'report.tfl.stichtag_snapshot',
    render: r => r.SNAPSHOT_DATE ? fmtDate(r.SNAPSHOT_DATE) : <span style={{ color: 'var(--warning-strong)' }}>fehlt</span>,
    sortValue: r => r.SNAPSHOT_DATE ?? '' },
]

const FLAG_LABEL: Record<string, string> = {
  no_snapshot:    'kein Leistungsstand-Snapshot zum Stichtag',
  no_performance: 'Leistungsstand nicht gepflegt',
  prepayment:     'mehr abgerechnet als geleistet',
  loss_risk:      'drohender Verlust',
}

function SortTh({ label, field, current, dir, onSort, numeric, help }: {
  label: string; field: SortField; current: SortField; dir: 'asc' | 'desc'
  onSort: (f: SortField) => void; numeric?: boolean; help?: HelpId
}) {
  const active = current === field
  return (
    <th scope="col"
      className={`sortable${numeric ? ' num' : ''}${active ? ' sorted' : ''}`}
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

// ── Hauptkomponente ───────────────────────────────────────────────────────────

type FilterDimension = 'status' | 'manager' | 'typ' | 'abteilung'
type ActiveFilters = Record<FilterDimension, Set<string>>
const emptyFilters = (): ActiveFilters =>
  ({ status: new Set(), manager: new Set(), typ: new Set(), abteilung: new Set() })

export function TeilfertigeLeistungenTab() {
  const qc = useQueryClient()
  const canClose  = usePermission('settings.monthly_close.edit')
  const canExport = usePermission('reports.export')

  const [asOf,      setAsOf]      = useState(() => monthEnd(1))
  const [compareTo, setCompareTo] = useState(() => previousMonthEnd(monthEnd(1)))
  const [method,    setMethod]    = useState<WipMethod | ''>('')   // '' = Mandanten-Vorbelegung
  const [search,    setSearch]    = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir,   setSortDir]   = useState<'asc' | 'desc'>('asc')
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(emptyFilters)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<WipClosing | null>(null)
  const [showClosings, setShowClosings] = useState(false)

  const [hiddenCols, setHiddenCols] = useStickyState<Set<ColKey>>(
    'report.tfl.cols',
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

  const query = useMemo(
    () => ({ asOf, compareTo: compareTo || undefined, method: method || undefined }),
    [asOf, compareTo, method],
  )

  const { data, isLoading, error } = useQuery({
    queryKey: ['wip-report', query],
    queryFn:  () => fetchWipReport(query),
    enabled:  !!asOf,
  })
  const report: WipReport | undefined = data?.data

  const { data: closingsData } = useQuery({
    queryKey: ['wip-closings'],
    queryFn:  fetchWipClosings,
    enabled:  showClosings,
  })
  const closings = closingsData?.data ?? []

  const closeMut = useMutation({
    mutationFn: () => createWipClosing({
      as_of: asOf, compare_to: compareTo || undefined, method: method || undefined,
    }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['wip-closings'] })
      setShowClosings(true)
      setMsg({ text: `Abschluss zum ${fmtDate(res.data.asOf)} festgeschrieben (${res.data.projectCount} Projekte).`, type: 'success' })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteWipClosing(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wip-closings'] })
      setMsg({ text: 'Abschluss gelöscht.', type: 'success' })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  // Die Methode schaltet die Anzeige sofort um: beide Werte stehen in jeder
  // Antwort. Sie geht trotzdem mit in die Abfrage, weil Vergleichswert und
  // Bestandsveraenderung serverseitig methodenabhaengig gerechnet werden.
  const effectiveMethod: WipMethod = method || report?.method || 'hk'
  const methodLabel = effectiveMethod === 'erloes' ? 'Leistungswert (Controlling)' : 'Herstellkosten (HGB)'

  const allRows = report?.rows ?? []

  const filterOptions: Record<FilterDimension, string[]> = useMemo(() => {
    const uniq = (fn: (r: WipRow) => string | null | undefined) =>
      [...new Set(allRows.map(fn).filter((v): v is string => v != null && v !== ''))].sort()
    return {
      status:    uniq(r => r.PROJECT_STATUS_NAME_SHORT),
      manager:   uniq(r => r.PROJECT_MANAGER_DISPLAY),
      typ:       uniq(r => r.PROJECT_TYPE_NAME_SHORT),
      abteilung: uniq(r => r.DEPARTMENT_NAME),
    }
  }, [allRows])

  const filtered = useMemo(() => {
    let rows = allRows
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        (r.NAME_SHORT ?? '').toLowerCase().includes(q) ||
        (r.NAME_LONG  ?? '').toLowerCase().includes(q) ||
        (r.PROJECT_MANAGER_DISPLAY ?? '').toLowerCase().includes(q) ||
        (r.ADDRESS_NAME ?? '').toLowerCase().includes(q)
      )
    }
    const dimMap: [FilterDimension, (r: WipRow) => string | null | undefined][] = [
      ['status',    r => r.PROJECT_STATUS_NAME_SHORT],
      ['manager',   r => r.PROJECT_MANAGER_DISPLAY],
      ['typ',       r => r.PROJECT_TYPE_NAME_SHORT],
      ['abteilung', r => r.DEPARTMENT_NAME],
    ]
    for (const [dim, getter] of dimMap) {
      if (activeFilters[dim].size === 0) continue
      rows = rows.filter(r => {
        const v = getter(r)
        return v != null && activeFilters[dim].has(v)
      })
    }
    return rows
  }, [allRows, search, activeFilters])

  const visibleCols = useMemo(
    () => COLUMNS.filter(c => !hiddenCols.has(c.key) && (!c.needsCompare || !!report?.compareTo)),
    [hiddenCols, report?.compareTo],
  )

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const col = COLUMNS.find(c => c.key === sortField)
    arr.sort((a, b) => {
      const va = sortField === 'name' ? (a.NAME_SHORT ?? '') : (col?.sortValue(a, effectiveMethod) ?? '')
      const vb = sortField === 'name' ? (b.NAME_SHORT ?? '') : (col?.sortValue(b, effectiveMethod) ?? '')
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ?  1 : -1
      return 0
    })
    return arr
  }, [filtered, sortField, sortDir, effectiveMethod])

  /** Summen der aktuell sichtbaren Zeilen — Aktiva und Passiva getrennt. */
  const viewTotals = useMemo(() => ({
    wip:         sumBy(sorted, r => wipValue(r, effectiveMethod)),
    prepayments: sumBy(sorted, r => r.PREPAYMENT_NET),
    lossRisk:    sumBy(sorted, r => r.LOSS_RISK_NET),
    change:      report?.compareTo ? sumBy(sorted, r => r.CHANGE_WIP_NET ?? 0) : null,
  }), [sorted, effectiveMethod, report?.compareTo])

  const activeFilterCount = Object.values(activeFilters).reduce((n, s) => n + s.size, 0)
  const isFiltered = activeFilterCount > 0 || search.trim() !== ''

  function toggleSort(f: SortField) {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(f); setSortDir('asc') }
  }
  function toggleCol(key: ColKey) {
    setHiddenCols(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function exportCsv() {
    const headers = [
      'Projekt-Nr', 'Projekt', 'Status', 'Projektleiter',
      'Auftragswert', 'Leistungswert', 'Leistungsstand %', 'Abgerechnet',
      'Unfertig', 'Kosten', 'Kosten unfertig',
      'Teilfertig (HGB)', 'Teilfertig (Leistungswert)',
      'Erhaltene Anzahlung', 'Drohverlust', 'Nicht realisierter Gewinn',
      'Stunden', 'Snapshot', 'Hinweise',
    ]
    const rows = sorted.map(r => [
      r.NAME_SHORT, r.NAME_LONG, r.PROJECT_STATUS_NAME_SHORT, r.PROJECT_MANAGER_DISPLAY,
      csvNum(r.ORDER_VALUE_NET), csvNum(r.PERFORMANCE_NET), csvNum(r.PERFORMANCE_PERCENT), csvNum(r.BILLED_NET),
      csvNum(r.UNBILLED_NET), csvNum(r.COST_NET), csvNum(r.COST_UNBILLED_NET),
      csvNum(r.WIP_HK_NET), csvNum(r.WIP_REVENUE_NET),
      csvNum(r.PREPAYMENT_NET), csvNum(r.LOSS_RISK_NET), csvNum(r.UNREALIZED_GAIN_NET),
      csvNum(r.HOURS_TOTAL), r.SNAPSHOT_DATE ?? '',
      (r.flags ?? []).map(f => FLAG_LABEL[f] ?? f).join(' | '),
    ])
    downloadCsv(`Teilfertige_Leistungen_${asOf}.csv`, headers, rows)
  }

  return (
    <div>
      <Message text={msg?.text ?? null} type={msg?.type} />

      {/* ── Stichtag, Vergleich, Methode ── */}
      <div className="daten-filter-bar">
        <div className="daten-filter-dates">
          <label>
            Stichtag
            <input
              type="date" value={asOf}
              onChange={e => {
                const v = e.target.value
                setAsOf(v)
                if (compareTo) setCompareTo(previousMonthEnd(v))
              }}
            />
          </label>
          <label>
            Vergleich
            <input type="date" value={compareTo} onChange={e => setCompareTo(e.target.value)} />
          </label>
          {compareTo && (
            <button type="button" className="btn-secondary" onClick={() => setCompareTo('')}>
              ohne Vergleich
            </button>
          )}
        </div>
        <div className="daten-filter-modes">
          {(['hk', 'erloes'] as WipMethod[]).map(m => (
            <label key={m} className={`daten-filter-mode-btn${effectiveMethod === m ? ' active' : ''}`}>
              <input type="radio" name="wipMethod" value={m}
                checked={effectiveMethod === m} onChange={() => setMethod(m)} />
              {m === 'hk' ? 'Herstellkosten (HGB)' : 'Leistungswert'}
            </label>
          ))}
          <HelpHint id="report.tfl.methode" />
        </div>
      </div>

      {error && <p className="message error">{(error as Error).message}</p>}
      {isLoading && <ListLoading columns={8} />}

      {!isLoading && report && (
        <>
          {/* ── Kennzahlen ── */}
          <div className="daten-kpi-grid">
            <div className="daten-kpi-tile">
              <span className="daten-kpi-label">
                Teilfertige Leistungen (Aktiva)
                <HelpHint id="report.tfl.was" />
              </span>
              <span className="daten-kpi-value accent">{fmtEur(viewTotals.wip)}</span>
              <span className="kpi-meta">{methodLabel}</span>
            </div>
            <div className="daten-kpi-tile">
              <span className="daten-kpi-label">
                Erhaltene Anzahlungen (Passiva)
                <HelpHint id="report.tfl.anzahlungen" />
              </span>
              <span className="daten-kpi-value">{fmtEur(viewTotals.prepayments)}</span>
              <span className="kpi-meta">nicht mit den Aktiva verrechnet</span>
            </div>
            {viewTotals.change != null && (
              <div className="daten-kpi-tile">
                <span className="daten-kpi-label">
                  Bestandsveränderung
                  <HelpHint id="report.tfl.bestandsveraenderung" />
                </span>
                <span className="daten-kpi-value">{fmtEur(viewTotals.change)}</span>
                <span className="kpi-meta">gegenüber {fmtDate(report.compareTo)}</span>
              </div>
            )}
            {viewTotals.lossRisk > 0 && (
              <div className="daten-kpi-tile">
                <span className="daten-kpi-label">
                  Drohverlust — Prüfbedarf
                  <HelpHint id="report.tfl.drohverlust" />
                </span>
                <span className="daten-kpi-value" style={{ color: 'var(--danger-strong)' }}>
                  {fmtEur(viewTotals.lossRisk)}
                </span>
                <span className="kpi-meta">{report.dataQuality.lossRiskCount} Projekt(e)</span>
              </div>
            )}
            <div className="daten-kpi-tile">
              <span className="daten-kpi-label">
                Bewertungsfaktor Kosten
                <HelpHint id="report.tfl.kostenfaktor" />
              </span>
              <span className="daten-kpi-value">{fmtPct(report.costFactorPercent)}</span>
              <span className="kpi-meta">Einstellungen → Vorbelegungen</span>
            </div>
          </div>

          {/* ── Datenqualität ── */}
          {report.dataQuality.noSnapshotCount > 0 && (
            <p className="message info" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <AlertTriangle size={14} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                Für {report.dataQuality.noSnapshotCount} von {report.totals.projectCount} Projekten
                liegt zum {fmtDate(report.asOf)} kein Leistungsstand-Snapshot vor. Deren
                Leistungswert ist damit nicht belegt — der Stichtagswert dieser Projekte ist
                nur so gut wie der letzte Snapshot. Snapshots entstehen beim Monatsabschluss
                (Einstellungen → Monatsabschluss) oder über den Projekt-Snapshot im Projekt.
              </span>
            </p>
          )}
          {report.dataQuality.noPerformanceCount > 0 && (
            <p className="empty-note" style={{ margin: '0 0 8px' }}>
              {report.dataQuality.noPerformanceCount} Projekt(e) haben Kosten gebucht, aber
              keinen Leistungsstand gepflegt. Sie sind nicht bewertbar und stehen mit 0 in
              den Aktiva — die Kosten erscheinen unter „Drohverlust".
            </p>
          )}

          {/* ── Bedienleiste ── */}
          <div className="pl-toolbar">
            <input
              type="search" placeholder="Suche …" className="list-search"
              value={search} onChange={e => setSearch(e.target.value)}
            />
            <FilterBar
              activeCount={activeFilterCount}
              onReset={() => { setActiveFilters(emptyFilters()); setSearch('') }}
            >
              <FilterChip label="Status"        options={filterOptions.status}    active={activeFilters.status}    onChange={v => setActiveFilters(p => ({ ...p, status: v }))} />
              <FilterChip label="Projektleiter" options={filterOptions.manager}   active={activeFilters.manager}   onChange={v => setActiveFilters(p => ({ ...p, manager: v }))} />
              <FilterChip label="Typ"           options={filterOptions.typ}       active={activeFilters.typ}       onChange={v => setActiveFilters(p => ({ ...p, typ: v }))} />
              <FilterChip label="Abteilung"     options={filterOptions.abteilung} active={activeFilters.abteilung} onChange={v => setActiveFilters(p => ({ ...p, abteilung: v }))} />
            </FilterBar>

            <div ref={colPanelRef} className="pl-col-wrap">
              <button type="button" className="pl-col-btn" onClick={() => setColPanelOpen(o => !o)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <SlidersHorizontal size={13} strokeWidth={2} />Spalten
              </button>
              {colPanelOpen && (
                <div className="pl-col-panel">
                  <div className="pl-col-panel-title">Sichtbare Spalten</div>
                  {COLUMNS.map(c => (
                    <label key={c.key} className="pl-col-option">
                      <input type="checkbox" checked={!hiddenCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canExport && (
                <>
                  <button type="button" className="btn-secondary" onClick={exportCsv}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Table2 size={14} strokeWidth={2} />CSV
                  </button>
                  <button type="button" className="btn-secondary"
                    onClick={() => { void openWipPdf(query).catch((e: Error) => setMsg({ text: e.message, type: 'error' })) }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <FileText size={14} strokeWidth={2} />PDF
                  </button>
                </>
              )}
              <Can permission="settings.monthly_close.edit">
                <button type="button" className="btn-primary"
                  disabled={closeMut.isPending}
                  onClick={() => { setMsg(null); closeMut.mutate() }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={14} strokeWidth={2} />
                  {closeMut.isPending ? 'Wird festgeschrieben …' : 'Stichtag festschreiben'}
                </button>
              </Can>
            </div>
          </div>

          {isFiltered && (
            <p className="empty-note" style={{ margin: '0 0 8px' }}>
              {sorted.length} von {allRows.length} Projekten
            </p>
          )}

          {/* ── Tabelle ── */}
          {sorted.length > 0 && (
            <div className="list-section table-scroll">
              <table className="master-table">
                <thead>
                  <tr>
                    <SortTh label="Projekt" field="name" current={sortField} dir={sortDir} onSort={toggleSort} />
                    {visibleCols.map(c => (
                      <SortTh key={c.key} label={c.label} field={c.key} numeric={c.numeric}
                        current={sortField} dir={sortDir} onSort={toggleSort} help={c.help} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => (
                    <tr key={r.PROJECT_ID}>
                      <td>
                        <strong>{r.NAME_SHORT}</strong>
                        {r.NAME_LONG && <span className="tree-name-long"> – {r.NAME_LONG}</span>}
                        {(r.flags ?? []).length > 0 && (
                          <span className="tfl-flags">
                            {r.flags.map(f => (
                              <span key={f} className="tfl-flag" title={FLAG_LABEL[f] ?? f}>
                                <AlertTriangle size={11} strokeWidth={2} />
                                {FLAG_LABEL[f] ?? f}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      {visibleCols.map(c => (
                        <td key={c.key} className={c.numeric ? 'num' : undefined}>
                          {c.render(r, effectiveMethod)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {sorted.length > 1 && (
                  <tfoot>
                    <tr className="sum-row">
                      <td><strong>Gesamt ({sorted.length})</strong></td>
                      {visibleCols.map(c => (
                        <td key={c.key} className={c.numeric ? 'num' : undefined}>
                          <strong>{c.total ? c.total(sorted, effectiveMethod) : ''}</strong>
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {sorted.length === 0 && (
            <p className="empty-note">
              {allRows.length === 0
                ? `Zum ${fmtDate(asOf)} gibt es kein Projekt mit Auftragswert, Leistung, Kosten oder Abrechnung. Sobald Projekte bebucht oder abgerechnet werden, erscheinen sie hier.`
                : 'Keine Treffer für die aktuelle Filterung.'}
            </p>
          )}

          {/* ── Bewertungshinweis ── */}
          <p className="empty-note" style={{ marginTop: 12 }}>
            {effectiveMethod === 'hk'
              ? `Bewertung zu Herstellungskosten (§ 255 Abs. 2 HGB): angesetzt sind die auf die
                 noch nicht abgerechnete Leistung entfallenden Kosten, begrenzt auf den noch
                 erzielbaren Erlös (§ 253 Abs. 4 HGB). Ohne anteiligen Gewinn.`
              : `Bewertung zum Leistungswert: Leistungsstand minus abgerechnet, zu
                 Auftragspreisen. Enthält den anteiligen Gewinn und ist damit kein
                 Bilanzansatz nach HGB.`}
            {' '}Aktiva und erhaltene Anzahlungen sind je Projekt getrennt ermittelt
            (§ 246 Abs. 2 HGB).
          </p>

          {/* ── Festgeschriebene Abschlüsse ── */}
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={() => setShowClosings(o => !o)}>
              {showClosings ? 'Festgeschriebene Abschlüsse ausblenden' : 'Festgeschriebene Abschlüsse anzeigen'}
            </button>

            {showClosings && (
              closings.length === 0 ? (
                <p className="empty-note" style={{ marginTop: 8 }}>
                  Noch kein Abschluss festgeschrieben. Ein festgeschriebener Abschluss bleibt
                  unverändert, auch wenn später Stunden nachgebucht oder Rechnungen storniert
                  werden — für den Jahresabschluss ist genau das der Punkt.
                </p>
              ) : (
                <div className="list-section table-scroll" style={{ marginTop: 8 }}>
                  <table className="master-table">
                    <thead>
                      <tr>
                        <th scope="col">Stichtag</th>
                        <th scope="col">Methode</th>
                        <th scope="col" className="num">Faktor</th>
                        <th scope="col" className="num">Teilfertig</th>
                        <th scope="col" className="num">Anzahlungen</th>
                        <th scope="col" className="num">Projekte</th>
                        <th scope="col">Erstellt</th>
                        {canClose && <th scope="col" aria-label="Aktionen" />}
                      </tr>
                    </thead>
                    <tbody>
                      {closings.map(c => (
                        <tr key={c.ID}>
                          <td><strong>{fmtDate(c.AS_OF_DATE)}</strong></td>
                          <td>{c.METHOD === 'erloes' ? 'Leistungswert' : 'Herstellkosten'}</td>
                          <td className="num">{fmtPct(c.COST_FACTOR_PERCENT)}</td>
                          <td className="num">
                            {fmtEur(c.METHOD === 'erloes' ? c.TOTAL_WIP_REVENUE : c.TOTAL_WIP_HK)}
                          </td>
                          <td className="num">{fmtEur(c.TOTAL_PREPAYMENTS)}</td>
                          <td className="num">{c.PROJECT_COUNT}</td>
                          <td>
                            {fmtDate(c.created_at)}
                            {c.CREATED_BY_NAME && <span className="tree-name-long"> · {c.CREATED_BY_NAME}</span>}
                          </td>
                          {canClose && (
                            <td>
                              <button type="button" className="row-action-btn" title="Abschluss löschen"
                                onClick={() => setConfirmDelete(c)}>
                                <Trash2 size={14} strokeWidth={2} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        title="Abschluss löschen"
        message={confirmDelete
          ? `Der festgeschriebene Abschluss zum ${fmtDate(confirmDelete.AS_OF_DATE)} wird gelöscht. Die Werte dieses Stichtags sind danach nicht mehr reproduzierbar.`
          : ''}
        confirmLabel="Löschen"
        onConfirm={() => {
          if (confirmDelete) deleteMut.mutate(confirmDelete.ID)
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
