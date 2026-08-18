import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { HelpHint } from '@/components/ui/HelpHint'
import {
  fetchFeeZoneSplits, saveFeeZoneSplits,
  type FeeZone, type MischhonorarResult,
} from '@/api/fee'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)

interface Row { zoneId: number | ''; zonePercent: string; amount: string }

interface Props {
  open:         boolean
  onClose:      () => void
  calcMasterId: number
  zones:        FeeZone[]
  /** Nach dem Speichern neu berechnen: Wizard lädt die Berechnung (K0/REVENUE_K0) neu. */
  onApplied:    () => void
}

/**
 * TGA-Mischhonorar: anrechenbare Kosten einer Anlagengruppe auf mehrere
 * Honorarzonen aufteilen. K0 = Σ Beträge; REVENUE_K0 = gewichtetes
 * Mischhonorar (serverseitig aus der Honorartafel).
 *
 * Trug früher die Angabe "§ 54 Abs. 3" — die ist falsch, der Absatz regelt
 * die Minderung bei Wiederholungen. Herleitung siehe services/mischhonorar.js.
 */
export function MischhonorarEditor({ open, onClose, calcMasterId, zones, onApplied }: Props) {
  const [rows,    setRows]    = useState<Row[]>([])
  const [result,  setResult]  = useState<MischhonorarResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [available, setAvailable] = useState(true)
  const [msg,     setMsg]     = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setMsg(null); setResult(null)
    ;(async () => {
      try {
        const r = await fetchFeeZoneSplits(calcMasterId)
        if (cancelled) return
        setAvailable(r.available !== false)
        setRows((r.data ?? []).map(s => ({ zoneId: s.ZONE_ID, zonePercent: String(s.ZONE_PERCENT ?? 0), amount: String(s.AMOUNT ?? 0) })))
      } catch (e) {
        if (!cancelled) setMsg({ text: (e as Error).message, type: 'error' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, calcMasterId])

  const akGesamt = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount.replace(',', '.')) || 0), 0), [rows])

  function setRow(i: number, patch: Partial<Row>) {
    setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r)); setResult(null)
  }
  function addRow() { setRows(rs => [...rs, { zoneId: zones[0]?.ID ?? '', zonePercent: '0', amount: '' }]) }
  function removeRow(i: number) { setRows(rs => rs.filter((_, idx) => idx !== i)); setResult(null) }

  async function saveAndCompute() {
    setLoading(true); setMsg(null)
    try {
      const payload = rows
        .filter(r => r.zoneId !== '' && (Number(r.amount.replace(',', '.')) || 0) > 0)
        .map(r => ({ zone_id: Number(r.zoneId), zone_percent: Number(r.zonePercent.replace(',', '.')) || 0, amount: Number(r.amount.replace(',', '.')) || 0 }))
      const res = await saveFeeZoneSplits(calcMasterId, payload)
      setResult(res.data.result)
      setMsg({ text: payload.length ? 'Gespeichert und berechnet ✅' : 'Mischhonorar entfernt — Einzelzone gilt wieder.', type: 'success' })
      onApplied()
    } catch (e) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const zoneName = (id: number) => {
    const z = zones.find(z => z.ID === id)
    return z ? z.NAME_SHORT : `Zone ${id}`
  }

  return (
    <Modal open={open} onClose={onClose} title="Mischhonorar — anrechenbare Kosten auf Honorarzonen aufteilen">
      {!available ? (
        <p className="empty-note" style={{ color: 'var(--warning-strong)' }}>
          Das Mischhonorar ist noch nicht verfügbar — die Datenbank-Migration 0100 wurde noch nicht ausgeführt.
        </p>
      ) : (
        <>
          <p className="admin-section-hint" style={{ marginTop: 0, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span>
              Für die Technische Ausrüstung: Gehören die Anlagen einer Anlagengruppe
              verschiedenen Honorarzonen an, teile die anrechenbaren Kosten je Zone auf. Die Gesamtkosten (K0)
              ergeben sich als Summe; das Grundhonorar wird als gewichtetes Mischhonorar berechnet.
              Die HOAI regelt diese Aufteilung nicht ausdrücklich — sie ist eine verbreitete
              Auslegung und vor Rechnungsstellung fachlich abzusichern.
            </span>
            <HelpHint id="hoai.mischhonorar" />
          </p>

          <div className="table-scroll">
            <table className="master-table">
              <thead>
                <tr>
                  <th scope="col">Honorarzone</th>
                  <th scope="col" style={{ width: 120 }}>Position&nbsp;%</th>
                  <th scope="col" className="num">Anrechenbare Kosten €</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <select value={r.zoneId} onChange={e => setRow(i, { zoneId: e.target.value ? Number(e.target.value) : '' })}>
                        <option value="">— wählen —</option>
                        {zones.map(z => <option key={z.ID} value={z.ID}>{z.NAME_SHORT}{z.NAME_LONG ? ` – ${z.NAME_LONG}` : ''}</option>)}
                      </select>
                    </td>
                    <td>
                      <input className="tbl-input num" type="text" inputMode="numeric" style={{ width: 90, textAlign: 'right' }}
                        value={r.zonePercent} onChange={e => setRow(i, { zonePercent: e.target.value })} />
                    </td>
                    <td className="num">
                      <input className="tbl-input num" type="text" inputMode="numeric" style={{ width: 130, textAlign: 'right' }}
                        value={r.amount} onChange={e => setRow(i, { amount: e.target.value })} />
                    </td>
                    <td>
                      <button type="button" className="row-action-btn" title="Zeile entfernen" onClick={() => removeRow(i)}>
                        <Trash2 size={12} strokeWidth={2.5} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="sum-row">
                  <td colSpan={2}><strong>Anrechenbare Gesamtkosten (K0)</strong></td>
                  <td className="num"><strong>{fmtEur(akGesamt)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <button type="button" className="btn-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6 }} onClick={addRow}>
            <Plus size={13} strokeWidth={2} /> Honorarzone hinzufügen
          </button>

          {result && result.herleitung.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Herleitung (gewichtetes Mischhonorar)</div>
              <div className="table-scroll">
                <table className="master-table">
                  <thead>
                    <tr>
                      <th scope="col">Zone</th>
                      <th scope="col" className="num">Kosten €</th>
                      <th scope="col" className="num">Honorar (voll) €</th>
                      <th scope="col" className="num">Anteil %</th>
                      <th scope="col" className="num">Einzelhonorar €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.herleitung.map((h, i) => (
                      <tr key={i}>
                        <td>{zoneName(h.zoneId)}</td>
                        <td className="num">{fmtEur(h.amount)}</td>
                        <td className="num">{fmtEur(h.hVoll)}</td>
                        <td className="num">{h.anteilPct}</td>
                        <td className="num">{fmtEur(h.einzelhonorar)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="sum-row">
                      <td colSpan={4}><strong>Mischhonorar (Grundhonorar-Basis)</strong></td>
                      <td className="num"><strong>{fmtEur(result.honorar)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {msg && <div style={{ marginTop: 10 }}><Message text={msg.text} type={msg.type} /></div>}
        </>
      )}

      <DialogFooter>
        <button type="button" className="btn-secondary" onClick={onClose}>Schließen</button>
        <button type="button" className="btn-primary" disabled={loading} onClick={saveAndCompute}>
          {loading ? '…' : 'Speichern & berechnen'}
        </button>
      </DialogFooter>
    </Modal>
  )
}
