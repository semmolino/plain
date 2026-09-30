import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Message } from '@/components/ui/Message'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { HelpHint } from '@/components/ui/HelpHint'
import { AmountInput } from '@/components/ui/AmountInput'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import { money, fmtEur } from '@/utils/money'
import {
  fetchInvoices, fetchPartialPayments, fetchCorrectionBasis, saveCorrection, bookInvoice, bookInvoiceForce,
  type Invoice, type PartialPayment,
} from '@/api/rechnungen'

/**
 * Rechnungskorrektur (Migration 0179) — mindert eine GEBUCHTE Rechnung oder
 * Abschlagsrechnung, mit Bezug auf sie und einem Grund, der auf dem Beleg
 * steht (§ 31 Abs. 5 UStDV).
 *
 * Vorher hieß das „Gutschrift" und lief durch den Einzelrechnungs-Assistenten:
 * ohne Bezug auf das Original, mit positiven Beträgen (das Abgerechnete stieg
 * statt zu sinken) und als Forderung im Mahnwesen. Hier wählt man das
 * Original und je Element, um wie viel es gemindert wird; der Server rechnet
 * die negativen Beträge.
 */

export interface KorrekturStart {
  kind:  'invoice' | 'pp'
  id:    number
  label: string
}

const r2 = (n: number) => Math.round(n * 100) / 100
const todayIso = () => new Date().toISOString().slice(0, 10)

/** Belege, die sich korrigieren lassen: gebucht, kein Storno, keine Korrektur, nicht aufgegangen. */
function korrigierbar(inv: Invoice[], pps: PartialPayment[]): KorrekturStart[] {
  const a = inv
    .filter(i => i.STATUS_ID === 2 && i.INVOICE_TYPE !== 'stornorechnung' && i.INVOICE_TYPE !== 'gutschrift' && !i.CANCELS_INVOICE_ID)
    .map(i => ({ kind: 'invoice' as const, id: i.ID, label: `${i.INVOICE_NUMBER ?? `#${i.ID}`} · ${i.ADDRESS_NAME_1 ?? ''} · ${fmtEur(Number(i.TOTAL_AMOUNT_GROSS ?? 0))}` }))
  const b = pps
    .filter(p => p.STATUS_ID === 2 && !p.CANCELS_ADVANCE_INVOICE_ID && !p.ABSORBED_BY_INVOICE_ID)
    .map(p => ({ kind: 'pp' as const, id: p.ID, label: `${p.ADVANCE_INVOICE_NUMBER ?? `#${p.ID}`} · ${p.ADDRESS_NAME_1 ?? ''} · ${fmtEur(Number(p.TOTAL_AMOUNT_GROSS ?? 0))}` }))
  return [...a, ...b]
}

export function KorrekturDialog({ open, start, draftId, onClose }: {
  open:     boolean
  /** Original, das korrigiert wird; ohne Angabe wählt man es im Dialog. */
  start:    KorrekturStart | null
  /** Fortgesetzter Korrektur-Entwurf */
  draftId?: number
  onClose:  () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const canBook = usePermission('invoices.book')
  const [picked, setPicked] = useState<KorrekturStart | null>(start)
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [date, setDate] = useState(todayIso())
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<{ text: string; type: 'error' | 'success' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [forceId, setForceId] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setPicked(start); setAmounts({}); setDate(todayIso()); setReason(''); setMsg(null); setForceId(null)
  }, [open, start?.kind, start?.id, draftId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auswahl des Originals nur, wenn keins vorgegeben ist
  const listInv = useQuery({ queryKey: ['invoices'], queryFn: () => fetchInvoices(''), enabled: open && !start })
  const listPp  = useQuery({ queryKey: ['partial-payments'], queryFn: () => fetchPartialPayments(''), enabled: open && !start })
  const auswahl = useMemo(() => korrigierbar(listInv.data?.data ?? [], listPp.data?.data ?? []), [listInv.data, listPp.data])

  const basisParams = picked ? (picked.kind === 'invoice' ? { invoice_id: picked.id } : { advance_invoice_id: picked.id }) : null
  const basis = useQuery({
    queryKey: ['correction-basis', picked?.kind, picked?.id, draftId ?? null],
    queryFn:  () => fetchCorrectionBasis({ ...basisParams!, draft_id: draftId }).then(r => r.data),
    enabled:  open && !!picked,
  })

  // Entwurf fortsetzen: Beträge vorbelegen
  useEffect(() => {
    if (!basis.data || !draftId) return
    setAmounts(Object.fromEntries(basis.data.rows.filter(r => r.DRAFT_NET != null).map(r => [r.STRUCTURE_ID, String(r.DRAFT_NET)])))
  }, [basis.data, draftId])

  const rows = basis.data?.rows ?? []
  const vatPct = basis.data?.original.vatPercent ?? 0
  const net = r2(rows.reduce((s, r) => s + (Number(amounts[r.STRUCTURE_ID]) || 0), 0))
  const vat = r2(net * vatPct / 100)
  const tooHigh = rows.find(r => (Number(amounts[r.STRUCTURE_ID]) || 0) > r.MAX_NET + 0.005)

  function invalidate() {
    for (const key of [['invoices'], ['partial-payments'], ['mahnungen'], ['dashboard', 'open-invoices']]) {
      void qc.invalidateQueries({ queryKey: key })
    }
  }

  async function speichern(buchen: boolean) {
    if (!picked) return
    setMsg(null); setForceId(null)
    if (!reason.trim()) { setMsg({ text: 'Bitte den Grund der Korrektur angeben — er steht auf dem Beleg.', type: 'error' }); return }
    if (net <= 0) { setMsg({ text: 'Bitte mindestens einen Betrag angeben, um den korrigiert wird.', type: 'error' }); return }
    if (tooHigh) { setMsg({ text: `${tooHigh.ABBR || 'Element'}: höchstens ${fmtEur(tooHigh.MAX_NET)} lassen sich noch korrigieren.`, type: 'error' }); return }
    setBusy(true)
    let id: number | null = null
    try {
      const r = await saveCorrection({
        ...(picked.kind === 'invoice' ? { invoice_id: picked.id } : { advance_invoice_id: picked.id }),
        draft_id: draftId,
        invoice_date: date,
        reason: reason.trim(),
        rows: rows.filter(x => (Number(amounts[x.STRUCTURE_ID]) || 0) > 0)
          .map(x => ({ structure_id: x.STRUCTURE_ID, amount_net: Number(amounts[x.STRUCTURE_ID]) })),
      })
      id = r.id
      if (buchen) await bookInvoice(r.id)
      invalidate()
      toast.success(buchen ? 'Rechnungskorrektur gebucht.' : 'Korrektur als Entwurf gespeichert.')
      onClose()
    } catch (e) {
      invalidate()
      const err = e as Error & { status?: number }
      const text = err?.message || 'Speichern fehlgeschlagen'
      if (buchen && id && err?.status === 422) {
        setForceId(id)
        setMsg({ text: `Als Entwurf gespeichert, aber die E-Rechnungs-Prüfung meldet Fehler: ${text}`, type: 'error' })
      } else {
        setMsg({ text: id && buchen ? `Als Entwurf gespeichert, Buchen nicht: ${text}` : text, type: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }

  async function trotzdemBuchen() {
    if (!forceId) return
    setBusy(true)
    try {
      await bookInvoiceForce(forceId)
      invalidate()
      toast.success('Rechnungskorrektur gebucht.')
      onClose()
    } catch (e) {
      setMsg({ text: (e as Error)?.message || 'Buchen fehlgeschlagen', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const titel = picked ? `Rechnung korrigieren – ${picked.label.split(' · ')[0]}` : 'Rechnung korrigieren'

  return (
    <Modal open={open} onClose={onClose} title={titel} className="modal-wide">
      <div className="master-form kd-form">
        <p className="zd-note">
          Für eine geänderte <strong>Leistung</strong> (Aufmaß, Umfang). Zahlt der Kunde nur weniger, ohne dass sich
          die Leistung ändert, genügt „Rest ausbuchen" im Zahlungsdialog. <HelpHint id="invoice.rechnungskorrektur" />
        </p>

        {!start && (
          <div className="form-group">
            <label htmlFor="kd-original">Welche Rechnung wird korrigiert?*</label>
            <select id="kd-original" value={picked ? `${picked.kind}:${picked.id}` : ''}
              onChange={e => {
                const [k, i] = e.target.value.split(':')
                setPicked(auswahl.find(a => a.kind === k && String(a.id) === i) ?? null)
                setAmounts({})
              }}>
              <option value="">— bitte wählen —</option>
              <optgroup label="Rechnungen">
                {auswahl.filter(a => a.kind === 'invoice').map(a => <option key={`i${a.id}`} value={`invoice:${a.id}`}>{a.label}</option>)}
              </optgroup>
              <optgroup label="Abschlagsrechnungen">
                {auswahl.filter(a => a.kind === 'pp').map(a => <option key={`p${a.id}`} value={`pp:${a.id}`}>{a.label}</option>)}
              </optgroup>
            </select>
          </div>
        )}

        {picked && basis.isLoading && <p className="empty-note">Lädt …</p>}
        {picked && basis.error && <Message text={(basis.error as Error).message} type="error" />}

        {picked && basis.data && (
          <>
            {rows.length === 0 ? (
              <p className="empty-note">An diesem Beleg ist nichts mehr zu korrigieren.</p>
            ) : (
              <div className="list-section table-scroll">
                <table className="master-table sw-table" aria-label="Minderung je Element">
                  <thead>
                    <tr>
                      <th scope="col">Element</th>
                      <th scope="col" className="num sw-hide-narrow">berechnet netto €</th>
                      <th scope="col" className="num sw-hide-narrow">schon korrigiert €</th>
                      <th scope="col" className="num">Minderung netto €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.STRUCTURE_ID}>
                        <td><strong>{r.ABBR}</strong>{r.NAME ? ` – ${r.NAME}` : ''}</td>
                        <td className="num sw-hide-narrow">{money(r.BILLED_NET)}</td>
                        <td className="num sw-hide-narrow">{money(r.CORRECTED_NET)}</td>
                        <td className="num">
                          <AmountInput className="sw-amount" aria-label={`Minderung netto ${r.ABBR}`}
                            value={amounts[r.STRUCTURE_ID] ?? ''} disabled={r.MAX_NET <= 0}
                            onChange={v => setAmounts(prev => ({ ...prev, [r.STRUCTURE_ID]: v }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <dl className="zd-summary">
              <div><dt>Minderung netto</dt><dd>{money(-net)}</dd></div>
              <div><dt>USt {vatPct} %</dt><dd>{money(-vat)}</dd></div>
              <div><dt>Minderung brutto</dt><dd><strong>{money(-r2(net + vat))}</strong></dd></div>
            </dl>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="kd-date">Datum*</label>
                <input id="kd-date" type="date" required value={date} onChange={e => setDate(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="kd-reason">Grund der Korrektur* (steht auf dem Beleg)</label>
              <textarea id="kd-reason" rows={3} value={reason} onChange={e => setReason(e.target.value)}
                placeholder="z. B. Aufmaß LPH 8 berichtigt, 12 m² weniger" />
            </div>
          </>
        )}

        <Message text={msg?.text ?? null} type={msg?.type} />
        <DialogFooter secondary={forceId ? (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void trotzdemBuchen()}>Trotzdem buchen</button>
        ) : undefined}>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          {picked && basis.data && rows.length > 0 && (
            <>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => void speichern(false)}>Entwurf speichern</button>
              {canBook && (
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void speichern(true)}>
                  {busy ? 'Speichert …' : 'Korrektur buchen'}
                </button>
              )}
            </>
          )}
        </DialogFooter>
      </div>
    </Modal>
  )
}
