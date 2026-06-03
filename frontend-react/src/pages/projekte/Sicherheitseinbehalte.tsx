import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchProjectsShort } from '@/api/projekte'
import { fetchSeOverviewForProject } from '@/api/rechnungen'

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
  const [pid, setPid] = useState<number | null>(initialProjectId ?? null)

  useEffect(() => { if (initialProjectId) setPid(initialProjectId) }, [initialProjectId])

  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: seData, isLoading } = useQuery({
    queryKey: ['se-overview', pid],
    queryFn:  () => fetchSeOverviewForProject(pid!),
    enabled:  pid !== null,
  })

  const projects = projectsData?.data ?? []
  const seRows   = seData?.data ?? []

  const open      = seRows.filter(r => r.status === 'OFFEN')
  const released  = seRows.filter(r => r.status === 'AUFGELOEST')
  const openSum   = open.reduce((s, r) => s + r.se_amount, 0)
  const releasedSum = released.reduce((s, r) => s + r.se_amount, 0)

  function handleProjectChange(id: number | null) {
    setPid(id); onProjectChange?.(id)
  }

  return (
    <div className="ls-wrap">
      <div className="ls-toolbar" style={{ marginBottom: 16 }}>
        <label className="ls-label">Projekt</label>
        <select className="ls-select" value={pid ?? ''}
          onChange={e => handleProjectChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— Projekt wählen —</option>
          {projects.map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>)}
        </select>
      </div>

      {!pid && <p className="ls-empty">Bitte ein Projekt auswählen.</p>}
      {pid && isLoading && <p className="ls-empty">Lade …</p>}

      {pid && !isLoading && (
        <>
          {/* KPI cards */}
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
              <div style={{ fontSize: 12, color: '#374151', fontWeight: 600, marginBottom: 4 }}>GESAMT</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{fmtEur(openSum + releasedSum)}</div>
              <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>{seRows.length} {seRows.length === 1 ? 'Eintrag' : 'Einträge'}</div>
            </div>
          </div>

          {seRows.length === 0 && (
            <p className="ls-empty">
              Für dieses Projekt sind keine Sicherheitseinbehalte erfasst.
            </p>
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
                  {seRows.map(r => (
                    <tr key={r.id} className="ls-row">
                      <td className="ls-td"><strong>{r.partial_payment_number || `#${r.id}`}</strong></td>
                      <td className="ls-td">{fmtDate(r.partial_payment_date)}</td>
                      <td className="ls-td ls-right">{fmtEur(r.total_amount_gross)}</td>
                      <td className="ls-td ls-right">{r.se_percent != null ? `${r.se_percent} %` : '—'}</td>
                      <td className="ls-td">{r.se_basis === 'NETTO' ? 'Netto' : r.se_basis === 'BRUTTO' ? 'Brutto' : '—'}</td>
                      <td className="ls-td ls-right" style={{ fontWeight: 600 }}>{fmtEur(r.se_amount)}</td>
                      <td className="ls-td">
                        {r.status === 'OFFEN' ? (
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'rgba(245, 158, 11, 0.15)', color: '#92400e', fontSize: 11, fontWeight: 600 }}>OFFEN</span>
                        ) : (
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'rgba(34, 197, 94, 0.15)', color: '#166534', fontSize: 11, fontWeight: 600 }}>AUFGELÖST</span>
                        )}
                      </td>
                      <td className="ls-td">
                        {r.status === 'AUFGELOEST' ? (
                          <>
                            <strong>{r.released_by_invoice_number || `#${r.released_by_invoice_id}`}</strong>
                            {r.released_by_invoice_date && <span style={{ color: '#6b7280', fontSize: 12 }}> · {fmtDate(r.released_by_invoice_date)}</span>}
                          </>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
