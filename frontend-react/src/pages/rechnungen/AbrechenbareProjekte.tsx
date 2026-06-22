import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, FileText, Receipt, FileCheck2, RefreshCcw } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { HelpHint } from '@/components/ui/HelpHint'
import { fetchBillingSummary } from '@/api/reports'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)

export type WizardType = 'abschlag' | 'rechnung' | 'schluss'

interface Props {
  /** Aufgerufen wenn der Nutzer fuer ein Projekt einen Rechnungstyp gewaehlt hat */
  onCreateInvoice: (wizardType: WizardType, projectId: number, projectLabel: string) => void
  /** Storage key fuer collapsed-Zustand. Default: 'rl-abrechenbar-collapsed' */
  storageKey?: string
}

interface PickRow {
  projectId:       number
  projectName:     string
  projectNameLong: string | null
  openAmount:      number
}

export function AbrechenbareProjekte({ onCreateInvoice, storageKey = 'rl-abrechenbar-collapsed' }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(storageKey) === '1'
  })
  const [picker, setPicker] = useState<PickRow | null>(null)

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(storageKey, next ? '1' : '0')
  }

  const qc = useQueryClient()
  // Eigener Query-Key + immer beim Mounten neu laden, damit das Widget
  // nicht den Dashboard-Cache (staleTime 5 min) erbt — wer eine Rechnung
  // gebucht hat, soll beim naechsten Aufruf den aktuellen Stand sehen.
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['rechnungen', 'billing-summary'],
    queryFn:  fetchBillingSummary,
    staleTime: 30_000,
    refetchOnMount: 'always',
  })

  const billing  = data?.data ?? null
  const projects = useMemo(() => (billing?.projects ?? []).slice().sort((a, b) => b.OPEN_NET_TOTAL - a.OPEN_NET_TOTAL), [billing])
  const total    = projects.reduce((s, p) => s + p.OPEN_NET_TOTAL, 0)

  function handlePick(wizardType: WizardType) {
    if (!picker) return
    const row = picker
    setPicker(null)
    onCreateInvoice(wizardType, row.projectId, row.projectName)
  }

  if (error) return null

  return (
    <div className="abrechenbar-card" style={{
      border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16,
      background: 'var(--surface-1, #fff)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 8px 6px 14px', borderRadius: 8,
      }}>
        <button
          type="button"
          onClick={toggleCollapsed}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '4px 0', textAlign: 'left',
          }}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          <strong style={{ fontSize: 14 }}>Abrechenbare Projekte</strong>
          {!isLoading && projects.length > 0 && (
            <span style={{
              background: 'rgba(29, 78, 216, 0.12)', color: '#1d4ed8',
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            }}>
              {projects.length}
            </span>
          )}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-4, #6b7280)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {isLoading
            ? 'lädt …'
            : projects.length === 0
              ? 'keine'
              : `Zur Abrechnung: ${fmtEur(total)}`}
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: ['rechnungen', 'billing-summary'] })}
            disabled={isFetching}
            title="Aktualisieren"
            style={{
              background: 'transparent', border: 'none', cursor: isFetching ? 'wait' : 'pointer',
              padding: 4, borderRadius: 4, display: 'inline-flex', alignItems: 'center',
              color: 'var(--text-4, #6b7280)',
            }}
          >
            <RefreshCcw size={14} strokeWidth={1.75} style={{
              animation: isFetching ? 'spin 1s linear infinite' : undefined,
            }} />
          </button>
        </span>
      </div>

      {!collapsed && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {isLoading && <p style={{ padding: 12, fontSize: 12, color: '#6b7280' }}>Lädt …</p>}
          {!isLoading && projects.length === 0 && (
            <p style={{ padding: 12, fontSize: 13, color: '#16a34a' }}>
              Kein Abrechnungspotenzial — alle Projekte sind vollständig fakturiert.
            </p>
          )}
          {!isLoading && projects.length > 0 && (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table className="ls-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th className="ls-th">Projekt</th>
                    <th className="ls-th">Projektleiter</th>
                    <th className="ls-th ls-col-num">Zur Abrechnung</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map(p => (
                    <tr
                      key={p.PROJECT_ID}
                      className="ls-row clickable-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setPicker({
                        projectId:       p.PROJECT_ID,
                        projectName:     p.NAME_SHORT,
                        projectNameLong: p.NAME_LONG,
                        openAmount:      p.OPEN_NET_TOTAL,
                      })}
                      title="Klicken um Rechnung zu erstellen"
                    >
                      <td className="ls-td">
                        <strong>{p.NAME_SHORT}</strong>
                        {p.NAME_LONG && (
                          <span style={{ display: 'block', fontSize: 11, color: '#6b7280', fontWeight: 400 }}>
                            {p.NAME_LONG}
                          </span>
                        )}
                      </td>
                      <td className="ls-td" style={{ fontSize: 12, color: '#6b7280' }}>
                        {p.PROJECT_MANAGER_DISPLAY ?? '—'}
                      </td>
                      <td className="ls-td ls-col-num" style={{ color: '#1d4ed8', fontWeight: 600 }}>
                        {fmtEur(p.OPEN_NET_TOTAL)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal
        open={picker != null}
        onClose={() => setPicker(null)}
        title="Welche Rechnung erstellen?"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 320 }}>
          <p style={{ margin: 0, fontSize: 13, color: '#374151', display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>
              Projekt <strong>{picker?.projectName}</strong>
              {picker && picker.openAmount > 0 && (
                <> — offener Betrag {fmtEur(picker.openAmount)}</>
              )}
            </span>
            <HelpHint id="invoice.abschlag_vs_schluss" />
          </p>
          <button className="btn-secondary" style={{ justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={() => handlePick('abschlag')}>
            <FileText size={16} strokeWidth={1.75} />
            <span><strong>Abschlagsrechnung</strong><br/><span style={{ fontSize: 11, color: '#6b7280' }}>Teilbetrag eines laufenden Vertrags</span></span>
          </button>
          <button className="btn-secondary" style={{ justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={() => handlePick('rechnung')}>
            <Receipt size={16} strokeWidth={1.75} />
            <span><strong>Rechnung</strong><br/><span style={{ fontSize: 11, color: '#6b7280' }}>Einzelrechnung / Nebenleistungen</span></span>
          </button>
          <button className="btn-secondary" style={{ justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={() => handlePick('schluss')}>
            <FileCheck2 size={16} strokeWidth={1.75} />
            <span><strong>Teilschluss- / Schlussrechnung</strong><br/><span style={{ fontSize: 11, color: '#6b7280' }}>Vertrag abrechnen, vorherige Abschläge verrechnen</span></span>
          </button>
        </div>
      </Modal>
    </div>
  )
}
