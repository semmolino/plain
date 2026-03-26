import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchProjectsShort } from '@/api/projekte'
import { fetchProjectReportHeader, fetchProjectReportStructure } from '@/api/reports'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const FMT_H   = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const FMT_PCT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtH    = (v: number | null | undefined) => v == null ? '—' : FMT_H.format(v) + ' h'
const fmtPct  = (v: number | null | undefined) => v == null ? '—' : FMT_PCT.format(v) + ' %'

function KpiTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="daten-kpi-tile">
      <span className="daten-kpi-label">{label}</span>
      <span className={`daten-kpi-value${accent ? ' accent' : ''}`}>{value}</span>
    </div>
  )
}

export function DatenPage() {
  const [pid, setPid] = useState<number | null>(null)

  const { data: projectsData } = useQuery({
    queryKey: ['projects-short'],
    queryFn:  fetchProjectsShort,
  })
  const { data: headerData, isLoading: headerLoading } = useQuery({
    queryKey: ['report-header', pid],
    queryFn:  () => fetchProjectReportHeader(pid!),
    enabled:  pid !== null,
  })
  const { data: structData, isLoading: structLoading } = useQuery({
    queryKey: ['report-structure', pid],
    queryFn:  () => fetchProjectReportStructure(pid!),
    enabled:  pid !== null,
  })

  const projects  = projectsData?.data ?? []
  const header    = headerData?.data   ?? null
  const structure = structData?.data   ?? []
  const loading   = headerLoading || structLoading

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

      {pid !== null && loading && <p className="empty-note">Laden …</p>}

      {header && (
        <>
          <div className="daten-header-meta">
            {header.PROJECT_MANAGER_DISPLAY && <span>Leitung: <strong>{header.PROJECT_MANAGER_DISPLAY}</strong></span>}
            {header.COMPANY_NAME            && <span>Firma: <strong>{header.COMPANY_NAME}</strong></span>}
            {header.PROJECT_STATUS_NAME_SHORT && <span>Status: <strong>{header.PROJECT_STATUS_NAME_SHORT}</strong></span>}
          </div>

          {/* KPI grid */}
          <div className="daten-kpi-grid">
            <KpiTile label="Budget gesamt (Netto)"    value={fmtEur(header.BUDGET_TOTAL_NET)} />
            <KpiTile label="Leistungsstand"           value={fmtPct(header.LEISTUNGSSTAND_PERCENT)} />
            <KpiTile label="Leistungsstand (€)"       value={fmtEur(header.LEISTUNGSSTAND_VALUE)} />
            <KpiTile label="Restbudget"               value={fmtEur(header.REMAINING_BUDGET_NET)} />
            <KpiTile label="Stunden (int.)"           value={fmtH(header.HOURS_TOTAL)} />
            <KpiTile label="Kosten (int.)"            value={fmtEur(header.COST_TOTAL)} />
            <KpiTile label="Abgerechnet (Netto)"      value={fmtEur(header.BILLED_NET_TOTAL)} />
            <KpiTile label="Offen (Netto)"            value={fmtEur(header.OPEN_NET_TOTAL)} accent />
            <KpiTile label="Bezahlt (Netto)"          value={fmtEur(header.PAYED_NET_TOTAL)} />
            <KpiTile label="Erlös (ext.)"             value={fmtEur(header.SALES_TOTAL)} />
            <KpiTile label="Stunden (ext.)"           value={fmtH(header.QTY_EXT_TOTAL)} />
            {header.COST_RATIO != null && (
              <KpiTile label="Kostenquote"            value={fmtPct((header.COST_RATIO ?? 0) * 100)} />
            )}
          </div>

          {/* Structure table */}
          {structure.length > 0 && (
            <div className="list-section table-scroll" style={{ marginTop: 20 }}>
              <table className="master-table">
                <thead>
                  <tr>
                    <th>Strukturelement</th>
                    <th className="num">Honorar Netto</th>
                    <th className="num">Leistungsstand €</th>
                    <th className="num">Rest-Honorar</th>
                    <th className="num">Stunden</th>
                    <th className="num">Kosten €</th>
                  </tr>
                </thead>
                <tbody>
                  {structure.map(s => (
                    <tr key={s.STRUCTURE_ID}>
                      <td>
                        <strong>{s.NAME_SHORT}</strong>
                        {s.NAME_LONG && <span className="tree-name-long"> – {s.NAME_LONG}</span>}
                      </td>
                      <td className="num">{fmtEur(s.HONORAR_NET)}</td>
                      <td className="num">{fmtEur(s.EARNED_VALUE_NET)}</td>
                      <td className="num">{fmtEur(s.REST_HONORAR)}</td>
                      <td className="num">{fmtH(s.HOURS_TOTAL)}</td>
                      <td className="num">{fmtEur(s.COST_TOTAL)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {structure.length === 0 && !structLoading && (
            <p className="empty-note" style={{ marginTop: 12 }}>Keine Strukturdaten vorhanden.</p>
          )}
        </>
      )}
    </div>
  )
}
