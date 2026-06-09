import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { fetchSeOverviewForProject, fetchSeSummary, type SeSummaryRow } from '@/api/rechnungen'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s); if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('de-DE')
}

interface Props {
  initialProjectId?: number
  onProjectChange?: (id: number | null) => void
}

export function Sicherheitseinbehalte({ initialProjectId, onProjectChange }: Props) {
  // null = Uebersicht ueber alle Projekte; number = Drill-down ins Projekt
  const [pid, setPid] = useState<number | null>(initialProjectId ?? null)

  useEffect(() => { if (initialProjectId) setPid(initialProjectId) }, [initialProjectId])

  function selectProject(id: number | null) {
    setPid(id); onProjectChange?.(id)
  }

  return pid === null
    ? <SeUebersicht onSelectProject={selectProject} />
    : <SeProjektDetails projectId={pid} onBack={() => selectProject(null)} />
}

// ── Aggregat ueber alle Projekte/Vertraege ───────────────────────────────────

function SeUebersicht({ onSelectProject }: { onSelectProject: (id: number) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['se-summary'], queryFn: fetchSeSummary })
  const rows: SeSummaryRow[] = data?.data ?? []

  const totalOpen     = rows.reduce((s, r) => s + r.open_sum,     0)
  const totalReleased = rows.reduce((s, r) => s + r.released_sum, 0)

  return (
    <div className="ls-wrap">
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Sicherheitseinbehalte — Übersicht</h2>

      {/* KPI-Kacheln */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, padding: '14px 16px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#92400e', fontWeight: 600, marginBottom: 4 }}>OFFENE SICHERHEITSEINBEHALTE</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#78350f' }}>{fmtEur(totalOpen)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 200, padding: '14px 16px', background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.25)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#166534', fontWeight: 600, marginBottom: 4 }}>BEREITS AUFGELÖST</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#14532d' }}>{fmtEur(totalReleased)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 200, padding: '14px 16px', background: 'rgba(17, 24, 39, 0.04)', border: '1px solid rgba(17, 24, 39, 0.10)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#374151', fontWeight: 600, marginBottom: 4 }}>PROJEKTE / VERTRÄGE</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{rows.length}</div>
        </div>
      </div>

      {isLoading && <p className="ls-empty">Lade …</p>}
      {!isLoading && rows.length === 0 && (
        <p className="ls-empty">Aktuell keine Sicherheitseinbehalte in deinen Projekten.</p>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="table-scroll">
          <table className="ls-table">
            <thead>
              <tr>
                <th className="ls-th">Projekt</th>
                <th className="ls-th">Vertrag</th>
                <th className="ls-th ls-col-num">Offen</th>
                <th className="ls-th ls-col-num">Aufgelöst</th>
                <th className="ls-th ls-col-num">Aktiv gesamt</th>
                <th className="ls-th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.project_id}-${r.contract_id ?? 'none'}`} className="ls-row"
                    style={{ cursor: 'pointer' }}
                    onClick={() => r.project_id && onSelectProject(r.project_id)}>
                  <td className="ls-td">
                    <strong>{r.project_number || `#${r.project_id}`}</strong>
                    {r.project_name && <span style={{ color: '#6b7280', fontSize: 12 }}> · {r.project_name}</span>}
                  </td>
                  <td className="ls-td">
                    {r.contract_number ? (
                      <>
                        {r.contract_number}
                        {r.contract_name && <span style={{ color: '#6b7280', fontSize: 12 }}> · {r.contract_name}</span>}
                      </>
                    ) : '—'}
                  </td>
                  <td className="ls-td ls-right">
                    <span style={{ color: r.open_sum > 0 ? '#92400e' : undefined, fontWeight: r.open_sum > 0 ? 600 : 400 }}>
                      {fmtEur(r.open_sum)}
                    </span>
                    {r.open_count > 0 && <span style={{ color: '#6b7280', fontSize: 11 }}> · {r.open_count}</span>}
                  </td>
                  <td className="ls-td ls-right">
                    {fmtEur(r.released_sum)}
                    {r.released_count > 0 && <span style={{ color: '#6b7280', fontSize: 11 }}> · {r.released_count}</span>}
                  </td>
                  <td className="ls-td ls-right" style={{ fontWeight: 600 }}>{fmtEur(r.total_active_sum)}</td>
                  <td className="ls-td">
                    <button className="btn-small" onClick={e => { e.stopPropagation(); r.project_id && onSelectProject(r.project_id) }}>
                      Details →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Detail-Ansicht pro Projekt (alte Logik, jetzt mit Zurueck-Button) ────────

function SeProjektDetails({ projectId, onBack }: { projectId: number; onBack: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['se-overview', projectId],
    queryFn:  () => fetchSeOverviewForProject(projectId),
  })

  const seRows = data?.data ?? []
  const open      = seRows.filter(r => r.status === 'OFFEN')
  const released  = seRows.filter(r => r.status === 'AUFGELOEST')
  const cancelled = seRows.filter(r => r.status === 'STORNIERT')
  const openSum     = open.reduce((s, r) => s + r.se_amount, 0)
  const releasedSum = released.reduce((s, r) => s + r.se_amount, 0)
  const activeRows  = seRows.filter(r => r.status !== 'STORNIERT')

  return (
    <div className="ls-wrap">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button className="btn-small" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ArrowLeft size={14} strokeWidth={2} /> Übersicht
        </button>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Sicherheitseinbehalte — Projektdetails</h2>
      </div>

      {isLoading && <p className="ls-empty">Lade …</p>}

      {!isLoading && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200, padding: '14px 16px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#92400e', fontWeight: 600, marginBottom: 4 }}>OFFENE SICHERHEITSEINBEHALTE</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#78350f' }}>{fmtEur(openSum)}</div>
              <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>{open.length} {open.length === 1 ? 'Eintrag' : 'Einträge'}</div>
            </div>
            <div style={{ flex: 1, minWidth: 200, padding: '14px 16px', background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.25)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#166534', fontWeight: 600, marginBottom: 4 }}>BEREITS AUFGELÖST</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#14532d' }}>{fmtEur(releasedSum)}</div>
              <div style={{ fontSize: 12, color: '#166534', marginTop: 2 }}>{released.length} {released.length === 1 ? 'Eintrag' : 'Einträge'}</div>
            </div>
            <div style={{ flex: 1, minWidth: 200, padding: '14px 16px', background: 'rgba(17, 24, 39, 0.04)', border: '1px solid rgba(17, 24, 39, 0.10)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#374151', fontWeight: 600, marginBottom: 4 }}>GESAMT (AKTIV)</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{fmtEur(openSum + releasedSum)}</div>
              <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>
                {activeRows.length} {activeRows.length === 1 ? 'Eintrag' : 'Einträge'}
                {cancelled.length > 0 && <span style={{ color: '#9ca3af' }}> · {cancelled.length} storniert</span>}
              </div>
            </div>
          </div>

          {seRows.length === 0 && (
            <p className="ls-empty">Für dieses Projekt sind keine Sicherheitseinbehalte erfasst.</p>
          )}

          {seRows.length > 0 && (
            <div className="table-scroll">
              <table className="ls-table">
                <thead>
                  <tr>
                    <th className="ls-th">Quelle</th>
                    <th className="ls-th">Datum</th>
                    <th className="ls-th ls-col-num">Brutto AR</th>
                    <th className="ls-th ls-col-num">SE %</th>
                    <th className="ls-th">Basis</th>
                    <th className="ls-th ls-col-num">SE-Betrag</th>
                    <th className="ls-th">Status</th>
                    <th className="ls-th">Aufgelöst durch</th>
                  </tr>
                </thead>
                <tbody>
                  {seRows.map(r => {
                    const isStorno = r.status === 'STORNIERT'
                    return (
                    <tr key={r.id} className="ls-row" style={isStorno ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}>
                      <td className="ls-td"><strong>{r.partial_payment_number || `#${r.id}`}</strong></td>
                      <td className="ls-td">{fmtDate(r.partial_payment_date)}</td>
                      <td className="ls-td ls-right">{fmtEur(r.total_amount_gross)}</td>
                      <td className="ls-td ls-right">{r.se_percent != null ? `${r.se_percent} %` : '—'}</td>
                      <td className="ls-td">{r.se_basis === 'NETTO' ? 'Netto' : r.se_basis === 'BRUTTO' ? 'Brutto' : '—'}</td>
                      <td className="ls-td ls-right" style={{ fontWeight: 600 }}>{fmtEur(r.se_amount)}</td>
                      <td className="ls-td" style={{ textDecoration: 'none' }}>
                        {r.status === 'OFFEN' && (
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'rgba(245, 158, 11, 0.15)', color: '#92400e', fontSize: 11, fontWeight: 600 }}>OFFEN</span>
                        )}
                        {r.status === 'AUFGELOEST' && (
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'rgba(34, 197, 94, 0.15)', color: '#166534', fontSize: 11, fontWeight: 600 }}>AUFGELÖST</span>
                        )}
                        {r.status === 'STORNIERT' && (
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'rgba(107, 114, 128, 0.15)', color: '#4b5563', fontSize: 11, fontWeight: 600 }}>STORNIERT</span>
                        )}
                      </td>
                      <td className="ls-td" style={{ textDecoration: 'none' }}>
                        {r.status === 'AUFGELOEST' ? (
                          <>
                            <strong>{r.released_by_invoice_number || `#${r.released_by_invoice_id}`}</strong>
                            {r.released_by_invoice_date && <span style={{ color: '#6b7280', fontSize: 12 }}> · {fmtDate(r.released_by_invoice_date)}</span>}
                          </>
                        ) : '—'}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
