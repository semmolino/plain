import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Message } from '@/components/ui/Message'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { HelpHint } from '@/components/ui/HelpHint'
import { useConfirm } from '@/hooks/useConfirm'
import { usePermission } from '@/store/permissionsStore'
import { money, fmtEur } from '@/utils/money'
import {
  fetchPayments, createPayment, deletePayment,
  fetchAdjustments, createAdjustment, deleteAdjustment,
  ADJUSTMENT_REASONS, type AdjustmentReason,
} from '@/api/rechnungen'

/**
 * Zahlung erfassen — und, wenn der Kunde weniger zahlt und das Büro das
 * akzeptiert, den Rest ausbuchen (Forderungsminderung, Migration 0177).
 *
 * Vorher gab es für einen akzeptierten Rest nur Storno plus neue Rechnung;
 * ohne Storno blieb er für immer offen und wurde gemahnt. Stand bis dahin
 * mitten in RechnungenListe.tsx.
 *
 * Die Beträge (Forderung, bezahlt, ausgebucht, offen) rechnet der Server
 * (services/openAmount.js) — hier wird nur noch subtrahiert, was gerade
 * eingegeben wird.
 */

export interface ZahlungZiel {
  source:            'invoice' | 'pp'
  id:                number
  label:             string
  /** Forderung nach Nachlass und Einbehalt */
  payable:           number
  open:              number
  cashDiscountPct:   number
  cashDiscountDays:  number
  /** Darf ein ausgebuchter Rest „wieder abrechenbar" sein? Nicht nach einer Schlussrechnung. */
  rebillableAllowed: boolean
  /** Abschlag ist in einer Schlussrechnung aufgegangen — Zahlungen gehören dorthin */
  absorbed?:         boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100
const todayIso = () => new Date().toISOString().slice(0, 10)
const toNum = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : NaN }
const reasonLabel = (id: string) => ADJUSTMENT_REASONS.find(r => r.id === id)?.label ?? id
const dateDe = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

function leeresFormular() {
  return {
    amount: '', date: todayIso(), purpose: '', comment: '',
    rest: false, reason: 'kuerzung' as AdjustmentReason, rebillable: false, restComment: '',
  }
}

export function ZahlungDialog({ ziel, onClose }: { ziel: ZahlungZiel | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [confirm, confirmDialog] = useConfirm()
  const canDelete = usePermission('payments.delete')
  const [f, setF] = useState(leeresFormular)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setF(leeresFormular()); setMsg(null) }, [ziel?.source, ziel?.id])

  const params = ziel ? (ziel.source === 'invoice' ? { invoice_id: ziel.id } : { advance_invoice_id: ziel.id }) : null
  const payments = useQuery({
    queryKey: ['payments', ziel?.source, ziel?.id],
    queryFn:  () => fetchPayments(params!).then(r => r.data ?? []),
    enabled:  !!ziel,
  })
  const adjustments = useQuery({
    queryKey: ['adjustments', ziel?.source, ziel?.id],
    queryFn:  () => fetchAdjustments(params!).then(r => r.data ?? []),
    enabled:  !!ziel,
  })

  // Offen laut Server. `ziel` leitet die Liste bei jedem Rendern aus ihren
  // Zeilen ab — nach Speichern oder Löschen lädt sie neu, der Betrag folgt.
  const open    = ziel ? r2(ziel.open) : 0
  const amount  = f.amount.trim() === '' ? 0 : toNum(f.amount)
  const restNow = r2(open - (Number.isFinite(amount) ? amount : 0))
  const skontoAmt = ziel && ziel.cashDiscountPct > 0 ? r2(ziel.payable * (1 - ziel.cashDiscountPct / 100)) : null
  const rebillableOk = !!ziel?.rebillableAllowed && f.reason === 'kuerzung'

  const paidSum = useMemo(() => r2((payments.data ?? []).reduce((s, p) => s + Number(p.AMOUNT_PAYED_GROSS || 0), 0)), [payments.data])
  const adjSum  = useMemo(() => r2((adjustments.data ?? []).reduce((s, a) => s + Number(a.AMOUNT_GROSS || 0), 0)), [adjustments.data])

  function invalidate() {
    for (const key of [['invoices'], ['partial-payments'], ['mahnungen'], ['dashboard', 'open-invoices']]) {
      void qc.invalidateQueries({ queryKey: key })
    }
    void qc.invalidateQueries({ queryKey: ['payments', ziel?.source, ziel?.id] })
    void qc.invalidateQueries({ queryKey: ['adjustments', ziel?.source, ziel?.id] })
  }

  async function speichern() {
    if (!ziel || !params) return
    setMsg(null)
    if (f.amount.trim() !== '' && (!Number.isFinite(amount) || amount <= 0)) {
      setMsg({ text: 'Der Betrag muss größer als 0 sein.', type: 'error' }); return
    }
    if (amount <= 0 && !f.rest) {
      setMsg({ text: 'Bitte einen Betrag eingeben oder „Rest ausbuchen" wählen.', type: 'error' }); return
    }
    if (!f.date) { setMsg({ text: 'Datum ist erforderlich.', type: 'error' }); return }
    if (f.rest && restNow <= 0.005) {
      setMsg({ text: 'Nach dieser Zahlung bleibt nichts offen, das sich ausbuchen ließe.', type: 'error' }); return
    }

    setBusy(true)
    try {
      if (amount > 0) {
        await createPayment({
          ...params, amount_payed_gross: amount, payment_date: f.date,
          purpose_of_payment: f.purpose || undefined, comment: f.comment || undefined,
        })
      }
      if (f.rest) {
        await createAdjustment({
          ...params, amount_gross: restNow, adjustment_date: f.date, reason: f.reason,
          rebillable: rebillableOk && f.rebillable, comment: f.restComment || undefined,
        })
      }
      invalidate()
      setMsg({ text: f.rest ? 'Gespeichert — der Beleg ist erledigt.' : 'Zahlung gespeichert.', type: 'success' })
      setTimeout(onClose, 900)
    } catch (e) {
      // Ging die Zahlung durch und nur das Ausbuchen nicht, steht die Zahlung —
      // die Meldung sagt deshalb, was noch fehlt.
      invalidate()
      const text = (e as Error)?.message || 'Speichern fehlgeschlagen'
      setMsg({ text: amount > 0 && f.rest ? `Zahlung gespeichert, Ausbuchen nicht: ${text}` : text, type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function zahlungLoeschen(id: number) {
    if (!(await confirm({ title: 'Zahlung löschen?', message: 'Diese Zahlung wirklich löschen?', confirmLabel: 'Löschen' }))) return
    try { await deletePayment(id); invalidate() }
    catch (e) { setMsg({ text: (e as Error)?.message || 'Löschen fehlgeschlagen', type: 'error' }) }
  }

  async function ausbuchungLoeschen(id: number) {
    if (!(await confirm({
      title: 'Ausbuchung zurücknehmen?',
      message: 'Der Betrag gilt danach wieder als offen und wird gemahnt, bis er bezahlt ist.',
      confirmLabel: 'Zurücknehmen',
    }))) return
    try { await deleteAdjustment(id); invalidate() }
    catch (e) { setMsg({ text: (e as Error)?.message || 'Zurücknehmen fehlgeschlagen', type: 'error' }) }
  }

  return (
    <Modal open={ziel !== null} onClose={onClose} title={`Zahlung erfassen – ${ziel?.label ?? ''}`}>
      {ziel && (
        <form className="master-form" onSubmit={e => { e.preventDefault(); void speichern() }}>
          <dl className="zd-summary">
            <div><dt>Forderung</dt><dd>{money(ziel.payable)}</dd></div>
            {paidSum > 0 && <div><dt>bezahlt</dt><dd>{money(paidSum)}</dd></div>}
            {adjSum > 0 && <div><dt>ausgebucht</dt><dd>{money(adjSum)}</dd></div>}
            <div><dt>offen</dt><dd><strong>{money(open)}</strong></dd></div>
          </dl>

          {(payments.data?.length ?? 0) > 0 && (
            <section className="zd-section" aria-label="Bisherige Zahlungen">
              <h3 className="zd-h">Bisherige Zahlungen</h3>
              <ul className="zd-list">
                {payments.data!.map(p => (
                  <li key={p.ID}>
                    <span className="zd-date">{dateDe(p.PAYMENT_DATE)}</span>
                    <span className="zd-amt">{money(p.AMOUNT_PAYED_GROSS)}</span>
                    <span className="zd-text">{p.PURPOSE_OF_PAYMENT ?? ''}</span>
                    {canDelete && (
                      <button type="button" className="row-action-btn row-action-btn--danger" aria-label={`Zahlung über ${fmtEur(p.AMOUNT_PAYED_GROSS)} löschen`}
                        onClick={() => void zahlungLoeschen(p.ID)}>
                        <Trash2 size={12} strokeWidth={2.5} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(adjustments.data?.length ?? 0) > 0 && (
            <section className="zd-section" aria-label="Ausgebuchte Reste">
              <h3 className="zd-h">Ausgebucht</h3>
              <ul className="zd-list">
                {adjustments.data!.map(a => (
                  <li key={a.ID}>
                    <span className="zd-date">{dateDe(a.ADJUSTMENT_DATE)}</span>
                    <span className="zd-amt">{money(a.AMOUNT_GROSS)}</span>
                    <span className="zd-text">
                      {reasonLabel(a.REASON)}
                      {a.REBILLABLE && <span className="status-pill zd-pill">wieder abrechenbar</span>}
                      {a.COMMENT && <span className="zd-sub"> · {a.COMMENT}</span>}
                    </span>
                    {canDelete && (
                      <button type="button" className="row-action-btn row-action-btn--danger" aria-label={`Ausbuchung über ${fmtEur(a.AMOUNT_GROSS)} zurücknehmen`}
                        onClick={() => void ausbuchungLoeschen(a.ID)}>
                        <Trash2 size={12} strokeWidth={2.5} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {open > 0.005 && (
            <>
              <div className="zd-quick">
                <button type="button" className="btn-small"
                  onClick={() => setF(s => ({ ...s, amount: String(open), rest: false }))}>
                  Offenen Betrag übernehmen
                </button>
                {skontoAmt !== null && skontoAmt < open && (
                  <button type="button" className="btn-small"
                    onClick={() => setF(s => ({ ...s, amount: String(skontoAmt), rest: true, reason: 'skonto', rebillable: false }))}>
                    Zahlung abzgl. {ziel.cashDiscountPct} % Skonto ({money(skontoAmt)})
                  </button>
                )}
              </div>
              {skontoAmt !== null && skontoAmt < open && ziel.cashDiscountDays > 0 && (
                <p className="zd-note">Skonto gilt bei Zahlung innerhalb von {ziel.cashDiscountDays} Tagen ab Rechnungsdatum.</p>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="zd-amount">Betrag brutto (€)</label>
                  <input id="zd-amount" type="number" step="0.01" min="0.01" inputMode="decimal"
                    value={f.amount} onChange={e => setF(s => ({ ...s, amount: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label htmlFor="zd-date">Datum*</label>
                  <input id="zd-date" type="date" required value={f.date}
                    onChange={e => setF(s => ({ ...s, date: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="zd-purpose">Verwendungszweck</label>
                <input id="zd-purpose" type="text" value={f.purpose}
                  onChange={e => setF(s => ({ ...s, purpose: e.target.value }))} />
              </div>
              <div className="form-group">
                <label htmlFor="zd-comment">Kommentar</label>
                <input id="zd-comment" type="text" value={f.comment}
                  onChange={e => setF(s => ({ ...s, comment: e.target.value }))} />
              </div>

              <fieldset className="zd-rest">
                <legend className="sr-only">Rest ausbuchen</legend>
                <label className="zd-check">
                  <input type="checkbox" checked={f.rest} onChange={e => setF(s => ({ ...s, rest: e.target.checked }))} />
                  <span>
                    {amount > 0 && restNow > 0.005
                      ? <>Rest von <strong>{money(restNow)}</strong> ausbuchen statt offen lassen</>
                      : <>Offenen Betrag von <strong>{money(open)}</strong> ausbuchen</>}
                  </span>
                  <HelpHint id="invoice.rest_ausbuchen" />
                </label>
                {!f.rest && amount > 0 && restNow > 0.005 && (
                  <p className="zd-note">Nach dieser Zahlung bleiben {money(restNow)} offen — sie werden weiter gemahnt und nicht noch einmal abgerechnet.</p>
                )}
                {f.rest && (
                  <div className="zd-rest-body">
                    <div className="form-group">
                      <label htmlFor="zd-reason">Grund*</label>
                      <select id="zd-reason" value={f.reason}
                        onChange={e => setF(s => ({ ...s, reason: e.target.value as AdjustmentReason, rebillable: false }))}>
                        {ADJUSTMENT_REASONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                    </div>
                    {rebillableOk && (
                      <label className="zd-check">
                        <input type="checkbox" checked={f.rebillable} onChange={e => setF(s => ({ ...s, rebillable: e.target.checked }))} />
                        <span>Wieder abrechenbar — mit der nächsten Rechnung erneut vorschlagen</span>
                        <HelpHint id="invoice.wieder_abrechenbar" />
                      </label>
                    )}
                    <div className="form-group">
                      <label htmlFor="zd-rest-comment">Begründung</label>
                      <input id="zd-rest-comment" type="text" value={f.restComment} placeholder="z. B. Mängelrüge vom 12.09."
                        onChange={e => setF(s => ({ ...s, restComment: e.target.value }))} />
                    </div>
                  </div>
                )}
              </fieldset>
            </>
          )}

          {open <= 0.005 && (
            <p className="zd-note">
              {ziel.absorbed
                ? 'Diese Abschlagsrechnung ist in einer Schlussrechnung aufgegangen: was hier noch offen war, steht dort in Rechnung. Zahlungen bitte auf der Schlussrechnung erfassen.'
                : 'Dieser Beleg ist vollständig erledigt.'}
            </p>
          )}

          <Message text={msg?.text ?? null} type={msg?.type} />
          <DialogFooter>
            <button type="button" className="btn-secondary" onClick={onClose}>{open > 0.005 ? 'Abbrechen' : 'Schließen'}</button>
            {open > 0.005 && (
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Speichert …' : f.rest && amount <= 0 ? 'Ausbuchen' : 'Speichern'}
              </button>
            )}
          </DialogFooter>
          {confirmDialog}
        </form>
      )}
    </Modal>
  )
}
