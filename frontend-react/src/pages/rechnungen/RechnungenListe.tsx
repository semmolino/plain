import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs }    from '@/components/ui/Tabs'
import { Modal }   from '@/components/ui/Modal'
import { Message } from '@/components/ui/Message'
import {
  fetchInvoices, fetchPartialPayments,
  openInvoicePdf, openPpPdf,
  downloadInvoiceEinvoice, downloadPpEinvoice,
  cancelInvoice, cancelPartialPayment,
  deleteInvoice, deletePartialPayment,
  createPayment,
  type Invoice, type PartialPayment,
} from '@/api/rechnungen'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? v.slice(0, 10) : '—'

function todayIso() { return new Date().toISOString().slice(0, 10) }

function invStatusLabel(inv: Invoice): string {
  if (inv.INVOICE_TYPE === 'stornorechnung') return 'Storno'
  if (inv.STATUS_ID === 3) return 'Storniert'
  if (inv.STATUS_ID === 2) return 'Gebucht'
  return 'Entwurf'
}
function invStatusClass(inv: Invoice): string {
  if (inv.INVOICE_TYPE === 'stornorechnung') return 'cancelled'
  if (inv.STATUS_ID === 3) return 'cancelled'
  if (inv.STATUS_ID === 2) return 'booked'
  return 'draft'
}
function ppStatusLabel(pp: PartialPayment): string {
  if (pp.CANCELS_PARTIAL_PAYMENT_ID != null) return 'Storno'
  if (pp.STATUS_ID === 3) return 'Storniert'
  if (pp.STATUS_ID === 2) return 'Gebucht'
  return 'Entwurf'
}
function ppStatusClass(pp: PartialPayment): string {
  if (pp.CANCELS_PARTIAL_PAYMENT_ID != null) return 'cancelled'
  if (pp.STATUS_ID === 3) return 'cancelled'
  if (pp.STATUS_ID === 2) return 'booked'
  return 'draft'
}

const LIST_TABS = [
  { id: 'invoices', label: 'Rechnungen' },
  { id: 'pp',       label: 'Abschlagsrechnungen' },
]

interface PaymentTarget {
  type: 'invoice' | 'pp'
  id: number
  label: string
  totalGross: number | null
  paidGross: number | null
}

function emptyPaymentForm() {
  return { amount_payed_gross: '', payment_date: todayIso(), purpose_of_payment: '', comment: '' }
}

type InvSortKey = 'INVOICE_NUMBER' | 'INVOICE_TYPE' | 'INVOICE_DATE' | 'PROJECT' | 'TOTAL_AMOUNT_NET' | 'TOTAL_AMOUNT_GROSS' | 'AMOUNT_PAYED_GROSS' | 'STATUS'
type PpSortKey  = 'PARTIAL_PAYMENT_NUMBER' | 'PARTIAL_PAYMENT_DATE' | 'PROJECT' | 'TOTAL_AMOUNT_NET' | 'TOTAL_AMOUNT_GROSS' | 'AMOUNT_PAYED_GROSS' | 'STATUS'

function SortTh<K extends string>({ label, k, sortKey, dir, onClick, className }: {
  label: string; k: K; sortKey: K; dir: 'asc'|'desc'; onClick: (k: K) => void; className?: string
}) {
  return (
    <th className={`sortable-th${className ? ' ' + className : ''}`} onClick={() => onClick(k)}>
      {label} {sortKey === k ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )
}

export function RechnungenListe() {
  const [tab,    setTab]    = useState<'invoices' | 'pp'>('invoices')
  const [search, setSearch] = useState('')

  const [invSortKey, setInvSortKey] = useState<InvSortKey>('INVOICE_DATE')
  const [invSortDir, setInvSortDir] = useState<'asc'|'desc'>('desc')
  const [ppSortKey,  setPpSortKey]  = useState<PpSortKey>('PARTIAL_PAYMENT_DATE')
  const [ppSortDir,  setPpSortDir]  = useState<'asc'|'desc'>('desc')

  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null)
  const [payForm,   setPayForm]   = useState(emptyPaymentForm())
  const [payMsg,    setPayMsg]    = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const qc = useQueryClient()

  const { data: invData, isLoading: invLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn:  () => fetchInvoices(''),
  })
  const { data: ppData, isLoading: ppLoading } = useQuery({
    queryKey: ['partial-payments'],
    queryFn:  () => fetchPartialPayments(''),
  })

  const allInvoices = invData?.data ?? []
  const allPayments = ppData?.data  ?? []

  const invoices = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? allInvoices.filter(inv =>
          `${inv.INVOICE_NUMBER ?? ''} ${inv.INVOICE_TYPE ?? ''} ${inv.PROJECT ?? ''} ${invStatusLabel(inv)}`
            .toLowerCase().includes(q)
        )
      : allInvoices
    return [...rows].sort((a, b) => {
      let av: string | number = '', bv: string | number = ''
      if (invSortKey === 'STATUS') { av = invStatusLabel(a); bv = invStatusLabel(b) }
      else { av = (a[invSortKey as keyof Invoice] ?? '') as string | number; bv = (b[invSortKey as keyof Invoice] ?? '') as string | number }
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'de', { numeric: true })
      return invSortDir === 'asc' ? cmp : -cmp
    })
  }, [allInvoices, search, invSortKey, invSortDir])

  const payments = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? allPayments.filter(pp =>
          `${pp.PARTIAL_PAYMENT_NUMBER ?? ''} ${pp.PROJECT ?? ''} ${ppStatusLabel(pp)}`
            .toLowerCase().includes(q)
        )
      : allPayments
    return [...rows].sort((a, b) => {
      let av: string | number = '', bv: string | number = ''
      if (ppSortKey === 'STATUS') { av = ppStatusLabel(a); bv = ppStatusLabel(b) }
      else { av = (a[ppSortKey as keyof PartialPayment] ?? '') as string | number; bv = (b[ppSortKey as keyof PartialPayment] ?? '') as string | number }
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'de', { numeric: true })
      return ppSortDir === 'asc' ? cmp : -cmp
    })
  }, [allPayments, search, ppSortKey, ppSortDir])

  function toggleInvSort(k: InvSortKey) {
    if (invSortKey === k) setInvSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setInvSortKey(k); setInvSortDir('asc') }
  }
  function togglePpSort(k: PpSortKey) {
    if (ppSortKey === k) setPpSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setPpSortKey(k); setPpSortDir('asc') }
  }

  const invTotals = useMemo(() => ({
    net:   invoices.reduce((s, r) => s + (Number(r.TOTAL_AMOUNT_NET)   || 0), 0),
    gross: invoices.reduce((s, r) => s + (Number(r.TOTAL_AMOUNT_GROSS) || 0), 0),
    paid:  invoices.reduce((s, r) => s + (Number(r.AMOUNT_PAYED_GROSS) || 0), 0),
  }), [invoices])

  const ppTotals = useMemo(() => ({
    net:   payments.reduce((s, r) => s + (Number(r.TOTAL_AMOUNT_NET)   || 0), 0),
    gross: payments.reduce((s, r) => s + (Number(r.TOTAL_AMOUNT_GROSS) || 0), 0),
    paid:  payments.reduce((s, r) => s + (Number(r.AMOUNT_PAYED_GROSS) || 0), 0),
  }), [payments])

  const payMut = useMutation({
    mutationFn: createPayment,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      setPayMsg({ text: 'Zahlung gespeichert ✅', type: 'success' })
      setTimeout(() => { setPayTarget(null); setPayForm(emptyPaymentForm()); setPayMsg(null) }, 900)
    },
    onError: (e: Error) => setPayMsg({ text: e.message, type: 'error' }),
  })

  function openPayment(target: PaymentTarget) {
    setPayForm(emptyPaymentForm())
    setPayMsg(null)
    setPayTarget(target)
  }

  function submitPayment(e: React.FormEvent) {
    e.preventDefault()
    setPayMsg(null)
    const gross = parseFloat(payForm.amount_payed_gross)
    if (!payForm.amount_payed_gross || !Number.isFinite(gross) || gross <= 0) {
      setPayMsg({ text: 'Betrag (Brutto) ist erforderlich', type: 'error' }); return
    }
    if (!payForm.payment_date) {
      setPayMsg({ text: 'Datum ist erforderlich', type: 'error' }); return
    }
    if (!payTarget) return
    payMut.mutate({
      ...(payTarget.type === 'invoice' ? { invoice_id: payTarget.id } : { partial_payment_id: payTarget.id }),
      amount_payed_gross:  gross,
      payment_date:        payForm.payment_date,
      purpose_of_payment:  payForm.purpose_of_payment || undefined,
      comment:             payForm.comment || undefined,
    })
  }

  async function handleCancelInvoice(inv: Invoice) {
    if (!window.confirm(`Stornorechnung für Rechnung ${inv.INVOICE_NUMBER ?? inv.ID} erstellen?`)) return
    try {
      await cancelInvoice(inv.ID)
      qc.invalidateQueries({ queryKey: ['invoices'] })
    } catch (e: unknown) {
      alert((e as { message?: string })?.message ?? 'Fehler beim Stornieren')
    }
  }

  async function handleCancelPp(pp: PartialPayment) {
    if (!window.confirm(`Storno-Abschlagsrechnung für ${pp.PARTIAL_PAYMENT_NUMBER ?? pp.ID} erstellen?`)) return
    try {
      await cancelPartialPayment(pp.ID)
      qc.invalidateQueries({ queryKey: ['partial-payments'] })
    } catch (e: unknown) {
      alert((e as { message?: string })?.message ?? 'Fehler beim Stornieren')
    }
  }

  async function handleDeleteInvoice(inv: Invoice) {
    if (!window.confirm(`Entwurf ${inv.ID} löschen?`)) return
    try {
      await deleteInvoice(inv.ID)
      qc.invalidateQueries({ queryKey: ['invoices'] })
    } catch (e: unknown) {
      alert((e as { message?: string })?.message ?? 'Fehler beim Löschen')
    }
  }

  async function handleDeletePp(pp: PartialPayment) {
    if (!window.confirm(`Entwurf ${pp.ID} löschen?`)) return
    try {
      await deletePartialPayment(pp.ID)
      qc.invalidateQueries({ queryKey: ['partial-payments'] })
    } catch (e: unknown) {
      alert((e as { message?: string })?.message ?? 'Fehler beim Löschen')
    }
  }

  const remaining = payTarget
    ? ((payTarget.totalGross ?? 0) - (payTarget.paidGross ?? 0))
    : null

  const invSortProps = { sortKey: invSortKey, dir: invSortDir, onClick: toggleInvSort }
  const ppSortProps  = { sortKey: ppSortKey,  dir: ppSortDir,  onClick: togglePpSort  }

  return (
    <div>
      <Tabs tabs={LIST_TABS} active={tab} onChange={id => setTab(id as typeof tab)} />

      <div className="list-toolbar" style={{ marginTop: 10 }}>
        <input
          className="list-search"
          placeholder="Suchen …"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="list-info">
          {tab === 'invoices'
            ? `${invoices.length}${invoices.length !== allInvoices.length ? ` / ${allInvoices.length}` : ''} Rechnungen`
            : `${payments.length}${payments.length !== allPayments.length ? ` / ${allPayments.length}` : ''} Abschlagsrechnungen`}
        </span>
      </div>

      {tab === 'invoices' && (
        <>
          {invLoading && <p className="empty-note">Laden …</p>}
          {!invLoading && (
            <div className="list-section table-scroll">
              <table className="master-table">
                <thead>
                  <tr>
                    <SortTh label="Nummer"    k="INVOICE_NUMBER"    {...invSortProps} />
                    <SortTh label="Typ"       k="INVOICE_TYPE"      {...invSortProps} />
                    <SortTh label="Datum"     k="INVOICE_DATE"      {...invSortProps} />
                    <SortTh label="Projekt"   k="PROJECT"           {...invSortProps} />
                    <SortTh label="Netto €"   k="TOTAL_AMOUNT_NET"  {...invSortProps} className="num" />
                    <SortTh label="Brutto €"  k="TOTAL_AMOUNT_GROSS"{...invSortProps} className="num" />
                    <SortTh label="Bezahlt €" k="AMOUNT_PAYED_GROSS"{...invSortProps} className="num" />
                    <SortTh label="Status"    k="STATUS"            {...invSortProps} />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv: Invoice) => (
                    <tr key={inv.ID}>
                      <td>{inv.INVOICE_NUMBER ?? '—'}</td>
                      <td>{inv.INVOICE_TYPE ?? 'rechnung'}</td>
                      <td>{fmtDate(inv.INVOICE_DATE)}</td>
                      <td>{inv.PROJECT ?? '—'}</td>
                      <td className="num">{fmtEur(inv.TOTAL_AMOUNT_NET)}</td>
                      <td className="num">{fmtEur(inv.TOTAL_AMOUNT_GROSS)}</td>
                      <td className="num">{fmtEur(inv.AMOUNT_PAYED_GROSS)}</td>
                      <td>
                        <span className={`status-badge ${invStatusClass(inv)}`}>
                          {invStatusLabel(inv)}
                        </span>
                      </td>
                      <td className="doc-actions">
                        <button className="btn-small" onClick={() => openInvoicePdf(inv.ID)}>PDF</button>
                        <button className="btn-small" onClick={() => downloadInvoiceEinvoice(inv.ID, inv.INVOICE_TYPE, inv.INVOICE_NUMBER, 'ubl')}>XRechnung</button>
                        <button className="btn-small" onClick={() => downloadInvoiceEinvoice(inv.ID, inv.INVOICE_TYPE, inv.INVOICE_NUMBER, 'cii')}>ZUGFeRD</button>
                        {inv.STATUS_ID === 2 && inv.INVOICE_TYPE !== 'stornorechnung' && (
                          <button className="btn-small btn-save" onClick={() => openPayment({
                            type: 'invoice', id: inv.ID,
                            label: inv.INVOICE_NUMBER ?? `Rechnung #${inv.ID}`,
                            totalGross: inv.TOTAL_AMOUNT_GROSS,
                            paidGross:  inv.AMOUNT_PAYED_GROSS,
                          })}>Zahlung</button>
                        )}
                        {inv.STATUS_ID === 2 && inv.INVOICE_TYPE !== 'stornorechnung' && (
                          <button className="btn-small btn-danger" onClick={() => handleCancelInvoice(inv)}>Storno</button>
                        )}
                        {inv.STATUS_ID === 1 && (
                          <button className="btn-small btn-danger" onClick={() => handleDeleteInvoice(inv)}>Löschen</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!invoices.length && <tr><td colSpan={9} className="empty-note">Keine Rechnungen</td></tr>}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                    <td colSpan={4} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                      {invoices.length !== allInvoices.length ? `${invoices.length} / ${allInvoices.length} Einträge` : `${allInvoices.length} Einträge`}
                    </td>
                    <td className="num">{fmtEur(invTotals.net)}</td>
                    <td className="num">{fmtEur(invTotals.gross)}</td>
                    <td className="num">{fmtEur(invTotals.paid)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'pp' && (
        <>
          {ppLoading && <p className="empty-note">Laden …</p>}
          {!ppLoading && (
            <div className="list-section table-scroll">
              <table className="master-table">
                <thead>
                  <tr>
                    <SortTh label="Nummer"    k="PARTIAL_PAYMENT_NUMBER" {...ppSortProps} />
                    <SortTh label="Datum"     k="PARTIAL_PAYMENT_DATE"   {...ppSortProps} />
                    <SortTh label="Projekt"   k="PROJECT"                {...ppSortProps} />
                    <SortTh label="Netto €"   k="TOTAL_AMOUNT_NET"       {...ppSortProps} className="num" />
                    <SortTh label="Brutto €"  k="TOTAL_AMOUNT_GROSS"     {...ppSortProps} className="num" />
                    <SortTh label="Bezahlt €" k="AMOUNT_PAYED_GROSS"     {...ppSortProps} className="num" />
                    <SortTh label="Status"    k="STATUS"                 {...ppSortProps} />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((pp: PartialPayment) => (
                    <tr key={pp.ID}>
                      <td>{pp.PARTIAL_PAYMENT_NUMBER ?? '—'}</td>
                      <td>{fmtDate(pp.PARTIAL_PAYMENT_DATE)}</td>
                      <td>{pp.PROJECT ?? '—'}</td>
                      <td className="num">{fmtEur(pp.TOTAL_AMOUNT_NET)}</td>
                      <td className="num">{fmtEur(pp.TOTAL_AMOUNT_GROSS)}</td>
                      <td className="num">{fmtEur(pp.AMOUNT_PAYED_GROSS)}</td>
                      <td>
                        <span className={`status-badge ${ppStatusClass(pp)}`}>
                          {ppStatusLabel(pp)}
                        </span>
                      </td>
                      <td className="doc-actions">
                        <button className="btn-small" onClick={() => openPpPdf(pp.ID)}>PDF</button>
                        <button className="btn-small" onClick={() => downloadPpEinvoice(pp.ID, pp.PARTIAL_PAYMENT_NUMBER, 'ubl')}>XRechnung</button>
                        <button className="btn-small" onClick={() => downloadPpEinvoice(pp.ID, pp.PARTIAL_PAYMENT_NUMBER, 'cii')}>ZUGFeRD</button>
                        {pp.STATUS_ID === 2 && !pp.CANCELS_PARTIAL_PAYMENT_ID && (
                          <button className="btn-small btn-save" onClick={() => openPayment({
                            type: 'pp', id: pp.ID,
                            label: pp.PARTIAL_PAYMENT_NUMBER ?? `Abschlag #${pp.ID}`,
                            totalGross: pp.TOTAL_AMOUNT_GROSS,
                            paidGross:  pp.AMOUNT_PAYED_GROSS,
                          })}>Zahlung</button>
                        )}
                        {pp.STATUS_ID === 2 && !pp.CANCELS_PARTIAL_PAYMENT_ID && (
                          <button className="btn-small btn-danger" onClick={() => handleCancelPp(pp)}>Storno</button>
                        )}
                        {pp.STATUS_ID === 1 && (
                          <button className="btn-small btn-danger" onClick={() => handleDeletePp(pp)}>Löschen</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!payments.length && <tr><td colSpan={8} className="empty-note">Keine Abschlagsrechnungen</td></tr>}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                    <td colSpan={3} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                      {payments.length !== allPayments.length ? `${payments.length} / ${allPayments.length} Einträge` : `${allPayments.length} Einträge`}
                    </td>
                    <td className="num">{fmtEur(ppTotals.net)}</td>
                    <td className="num">{fmtEur(ppTotals.gross)}</td>
                    <td className="num">{fmtEur(ppTotals.paid)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {/* Payment modal */}
      <Modal open={payTarget !== null} onClose={() => setPayTarget(null)} title={`Zahlung erfassen – ${payTarget?.label ?? ''}`}>
        {payTarget && (
          <form onSubmit={submitPayment} className="master-form">
            {payTarget.totalGross != null && (
              <div style={{ marginBottom: 12, fontSize: 14, color: 'rgba(17,24,39,0.6)' }}>
                Rechnungsbetrag: <strong>{fmtEur(payTarget.totalGross)}</strong>
                {payTarget.paidGross != null && payTarget.paidGross > 0 && (
                  <> · bereits bezahlt: <strong>{fmtEur(payTarget.paidGross)}</strong>
                  · offen: <strong>{fmtEur(remaining)}</strong></>
                )}
              </div>
            )}
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="pay-amount">Betrag brutto (€)*</label>
                <input
                  id="pay-amount" type="number" step="0.01" min="0.01" required
                  value={payForm.amount_payed_gross}
                  onChange={e => setPayForm(f => ({ ...f, amount_payed_gross: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label htmlFor="pay-date">Datum*</label>
                <input
                  id="pay-date" type="date" required
                  value={payForm.payment_date}
                  onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="pay-purpose">Verwendungszweck</label>
              <input
                id="pay-purpose" type="text"
                value={payForm.purpose_of_payment}
                onChange={e => setPayForm(f => ({ ...f, purpose_of_payment: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label htmlFor="pay-comment">Kommentar</label>
              <input
                id="pay-comment" type="text"
                value={payForm.comment}
                onChange={e => setPayForm(f => ({ ...f, comment: e.target.value }))}
              />
            </div>
            <Message text={payMsg?.text ?? null} type={payMsg?.type} />
            <div className="modal-actions">
              <button className="btn-primary" type="submit" disabled={payMut.isPending}>
                {payMut.isPending ? 'Speichert …' : 'Zahlung speichern'}
              </button>
              <button type="button" onClick={() => setPayTarget(null)}>Abbrechen</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
