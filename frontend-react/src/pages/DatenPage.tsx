import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchProjectsShort } from '@/api/projekte'
import {
  fetchProjectReportHeader,
  fetchProjectReportStructure,
  type DateFilter,
  type FilterMode,
  type ProjectReportStructure,
} from '@/api/reports'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

export function DatenPage() {
  const [pid,       setPid]      = useState<number | null>(null)
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

  const projects  = projectsData?.data ?? []
  const header    = headerData?.data   ?? null
  const structure = structData?.data   ?? []
  const loading   = headerLoading || structLoading

  // Build lookup map for path resolution
  const byId = useMemo(
    () => new Map(structure.map(s => [s.STRUCTURE_ID, s])),
    [structure],
  )

  // Leaf rows enriched with ancestor path string
  const leafRows = useMemo(() => {
    return structure
      .filter(s => s.IS_LEAF)
      .map(s => ({
        ...s,
        ancestorPath: buildAncestorPath(s.PARENT_STRUCTURE_ID, byId),
        displayLabel: s.NAME_LONG ? `${s.NAME_SHORT}: ${s.NAME_LONG}` : s.NAME_SHORT,
      }))
  }, [structure, byId])

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return leafRows
    const q = search.toLowerCase()
    return leafRows.filter(s =>
      s.ancestorPath.toLowerCase().includes(q) ||
      s.NAME_SHORT.toLowerCase().includes(q) ||
      (s.NAME_LONG ?? '').toLowerCase().includes(q),
    )
  }, [leafRows, search])

  // Sort
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
    <div className="master-page">
      <h1 className="master-title">Projektdaten</h1>

      <div className="form-group" style={{ maxWidth: 400, marginBottom: 16 }}>
        <label>Projekt</label>
        <select value={pid ?? ''} onChange={e => setPid(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Bitte wählen …</option>
          {projects.map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>)}
        </select>
      </div>

      {/* Date filter */}
      <div className="daten-filter-bar">
        <div className="daten-filter-modes">
          {(['now', 'as_of', 'period'] as FilterMode[]).map(m => (
            <label key={m} className={`daten-filter-mode-btn${mode === m ? ' active' : ''}`}>
              <input type="radio" name="filterMode" value={m} checked={mode === m}
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

          {/* KPI grid */}
          <div className="daten-kpi-grid">
            <KpiTile label="HONORAR inkl. Nebenkosten"  value={fmtEur(header.BUDGET_TOTAL_NET)} />
            <KpiTile label="Leistungsstand %"            value={fmtPct(header.LEISTUNGSSTAND_PERCENT)} />
            <KpiTile label="Leistungsstand (€)"          value={fmtEur(header.LEISTUNGSSTAND_VALUE)} />
            <KpiTile label="Restbudget"                   value={fmtEur(header.REMAINING_BUDGET_NET)} />
            <KpiTile label="Stunden (int.)"               value={fmtH(header.HOURS_TOTAL)} />
            <KpiTile label="Kosten (int.)"                value={fmtEur(header.COST_TOTAL)} />
            <KpiTile label="Abgerechnet (Netto)"          value={fmtEur(header.BILLED_NET_TOTAL)} />
            <KpiTile label="ABRECHENBAR (Netto)"          value={fmtEur(header.OPEN_NET_TOTAL)} accent />
            <KpiTile label="Bezahlt (Netto)"              value={fmtEur(header.PAYED_NET_TOTAL)} />
            <KpiTile label="Erlös (ext.)"                 value={fmtEur(header.SALES_TOTAL)} />
            <KpiTile label="Stunden (ext.)"               value={fmtH(header.QTY_EXT_TOTAL)} />
            {header.COST_RATIO != null && (
              <KpiTile label="Kostenquote"                value={fmtPct((header.COST_RATIO ?? 0) * 100)} />
            )}
          </div>

          {/* Structure table */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <input
                type="search"
                placeholder="Suche …"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ flex: '0 0 260px' }}
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
                      <SortTh label="Strukturelement"  field="path"   current={sortField} dir={sortDir} onSort={toggleSort} />
                      <SortTh label="Honorar Netto"    field="honorar" current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Lst.stand %"      field="lstPct"  current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Lst.stand €"      field="lstEur"  current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Rest-Honorar"     field="rest"    current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Stunden"          field="hours"   current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Kosten €"         field="cost"    current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
                      <SortTh label="Kostenquote"      field="kq"      current={sortField} dir={sortDir} onSort={toggleSort} className="num" />
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
                      </tr>
                    ))}
                  </tbody>
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
        </>
      )}
    </div>
  )
}
