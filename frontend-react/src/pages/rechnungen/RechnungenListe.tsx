import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal }   from '@/components/ui/Modal'
import { Message } from '@/components/ui/Message'
import {
  fetchInvoices, fetchPartialPayments,
  openInvoicePdf, openPpPdf,
  downloadInvoiceEinvoice, downloadPpEinvoice,
  cancelInvoice, cancelPartialPayment,
  deleteInvoice, deletePartialPayment,
  fetchPayments, createPayment, deletePayment,
  type Invoice, type PartialPayment, type Payment,
} from '@/api/rechnungen'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? v.slice(0, 10) : '—'

function todayIso() { return new Date().toISOString().slice(0, 10) }

function capitalizeInvType(t: string | null | undefined): string {
  if (!t) return 'Rechnung'
  const map: Record<string, string> = {
    rechnung:            'Rechnung',
    schlussrechnung:     'Teilschluss-/Schlussrechnung',
    teilschlussrechnung: 'Teilschluss-/Schlussrechnung',
    stornorechnung:      'Stornorechnung',
  }
  return map[t.toLowerCase()] ?? (t.charAt(0).toUpperCase() + t.slice(1))
}

// ── Unified row ───────────────────────────────────────────────────────────────

interface UnifiedRow {
  key:        string
  source:     'invoice' | 'pp'
  number:     string | null
  typ:        string
  date:       string | null
  project:    string | null
  net:        number | null
  gross:      number | null
  paid:       number | null
  statusLabel: string
  statusClass: string
  raw:        Invoice | PartialPayment
}

function fromInvoice(inv: Invoice): UnifiedRow {
  const isOrigCancelled = inv.STATUS_ID === 3
  const isStornoRow     = inv.INVOICE_TYPE === 'stornorechnung'

  let statusLabel: string
  let statusClass: string
  if (isOrigCancelled)          { statusLabel = 'Storniert';       statusClass = 'cancelled' }
  else if (isStornoRow)         { statusLabel = 'Storno-Rechnung'; statusClass = 'cancelled' }
  else if (inv.STATUS_ID === 2) { statusLabel = 'Gebucht';         statusClass = 'booked' }
  else                          { statusLabel = 'Entwurf';         statusClass = 'draft' }

  return {
    key:         `inv-${inv.ID}`,
    source:      'invoice',
    number:      inv.INVOICE_NUMBER ?? null,
    typ:         capitalizeInvType(inv.INVOICE_TYPE),
    date:        inv.INVOICE_DATE ?? null,
    project:     inv.PROJECT ?? null,
    net:         inv.TOTAL_AMOUNT_NET   != null ? Number(inv.TOTAL_AMOUNT_NET)   : null,
    gross:       inv.TOTAL_AMOUNT_GROSS != null ? Number(inv.TOTAL_AMOUNT_GROSS) : null,
    paid:        inv.AMOUNT_PAYED_GROSS != null ? Number(inv.AMOUNT_PAYED_GROSS) : null,
    statusLabel,
    statusClass,
    raw:         inv,
  }
}

function fromPp(pp: PartialPayment): UnifiedRow {
  const cancelled = pp.CANCELS_PARTIAL_PAYMENT_ID != null || pp.STATUS_ID === 3
  return {
    key:         `pp-${pp.ID}`,
    source:      'pp',
    number:      pp.PARTIAL_PAYMENT_NUMBER ?? null,
    typ:         'Abschlagsrechnung',
    date:        pp.PARTIAL_PAYMENT_DATE ?? null,
    project:     pp.PROJECT ?? null,
    net:         pp.TOTAL_AMOUNT_NET  != null ? Number(pp.TOTAL_AMOUNT_NET)  : null,
    gross:       pp.TOTAL_AMOUNT_GROSS != null ? Number(pp.TOTAL_AMOUNT_GROSS) : null,
    paid:        pp.AMOUNT_PAYED_GROSS != null ? Number(pp.AMOUNT_PAYED_GROSS) : null,
    statusLabel: cancelled ? 'Storniert' : pp.STATUS_ID === 2 ? 'Gebucht' : 'Entwurf',
    statusClass: cancelled ? 'cancelled' : pp.STATUS_ID === 2 ? 'booked'  : 'draft',
    raw:         pp,
  }
}

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = 'number' | 'typ' | 'date' | 'project' | 'net' | 'gross' | 'paid' | 'statusLabel'

function SortTh({ label, k, sortKey, dir, onClick, className }: {
  label: string; k: SortKey; sortKey: SortKey; dir: 'asc'|'desc'
  onClick: (k: SortKey) => void; className?: string
}) {
  return (
    <th className={`sortable-th${className ? ' ' + className : ''}`} onClick={() => onClick(k)}>
      {label} {sortKey === k ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )
}

// ── Payment modal target ──────────────────────────────────────────────────────

interface PaymentTarget {
  source:     'invoice' | 'pp'
  id:         number
  label:      string
  totalGross: number | null
  paidGross:  number | null
}

function emptyPaymentForm() {
  return { amount_payed_gross: '', payment_date: todayIso(), purpose_of_payment: '', comment: '' }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RechnungenListe() {
  const qc = useQueryClient()

  const [search,    setSearch]    = useState('')
  const [onlyOpen,  setOnlyOpen]  = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc')

  const [payTarget,   setPayTarget]   = useState<PaymentTarget | null>(null)
  const [payForm,     setPayForm]     = useState(emptyPaymentForm())
  const [payMsg,      setPayMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [existingPayments, setExistingPayments] = useState<Payment[]>([])
  const [deletingPayId, setDeletingPayId] = useState<number | null>(null)

  const { data: invData, isLoading: invLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn:  () => fetchInvoices(''),
  })
  const { data: ppData, isLoading: ppLoading } = useQuery({
    queryKey: ['partial-payments'],
    queryFn:  () => fetchPartialPayments(''),
  })

  const isLoading = invLoading || ppLoading

  const allRows = useMemo<UnifiedRow[]>(() => [
    ...(invData?.data ?? []).map(fromInvoice),
    ...(ppData?.data  ?? []).map(fromPp),
  ], [invData, ppData])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let filtered = q
      ? allRows.filter(r =>
          `${r.number ?? ''} ${r.typ} ${r.date ?? ''} ${r.project ?? ''} ${r.statusLabel}`
            .toLowerCase().includes(q)
        )
      : allRows
    if (onlyOpen) {
      filtered = filtered.filter(r =>
        r.statusClass === 'booked' &&
        Math.round((r.gross ?? 0) * 100) !== Math.round((r.paid ?? 0) * 100)
      )
    }
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'de', { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [allRows, search, onlyOpen, sortKey, sortDir])

  const totals = useMemo(() => ({
    net:   rows.reduce((s, r) => s + (r.net   ?? 0), 0),
    gross: rows.reduce((s, r) => s + (r.gross ?? 0), 0),
    paid:  rows.reduce((s, r) => s + (r.paid  ?? 0), 0),
  }), [rows])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

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

  function openPayment(row: UnifiedRow) {
    setPayForm(emptyPaymentForm())
    setPayMsg(null)
    setExistingPayments([])
    setDeletingPayId(null)
    const id = (row.raw as Invoice).ID ?? (row.raw as PartialPayment).ID
    setPayTarget({
      source:     row.source,
      id,
      label:      row.number ?? `#${id}`,
      totalGross: row.gross,
      paidGross:  row.paid,
    })
    const params = row.source === 'invoice' ? { invoice_id: id } : { partial_payment_id: id }
    fetchPayments(params).then(r => setExistingPayments(r.data ?? [])).catch(() => {})
  }

  async function handleDeletePayment(payId: number) {
    if (!window.confirm('Zahlung wirklich löschen?')) return
    setDeletingPayId(payId)
    try {
      await deletePayment(payId)
      setExistingPayments(prev => prev.filter(p => p.ID !== payId))
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      // Update the displayed paidGross in the modal header
      setPayTarget(prev => {
        if (!prev) return prev
        const removed = existingPayments.find(p => p.ID === payId)
        if (!removed) return prev
        return { ...prev, paidGross: (prev.paidGross ?? 0) - removed.AMOUNT_PAYED_GROSS }
      })
    } catch (e: unknown) {
      setPayMsg({ text: (e as { message?: string })?.message ?? 'Fehler beim Löschen', type: 'error' })
    } finally {
      setDeletingPayId(null)
    }
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
      ...(payTarget.source === 'invoice'
        ? { invoice_id: payTarget.id }
        : { partial_payment_id: payTarget.id }),
      amount_payed_gross: gross,
      payment_date:       payForm.payment_date,
      purpose_of_payment: payForm.purpose_of_payment || undefined,
      comment:            payForm.comment || undefined,
    })
  }

  async function handleCancel(row: UnifiedRow) {
    const label = row.number ?? `#${(row.raw as Invoice).ID}`

    if (row.source === 'invoice') {
      const inv = row.raw as Invoice
      // Check for existing payments before cancelling
      let deletePayments = false
      try {
        const paysRes = await fetchPayments({ invoice_id: inv.ID })
        const pays = paysRes.data ?? []
        if (pays.length > 0) {
          const totalPaid = pays.reduce((s, p) => s + (p.AMOUNT_PAYED_GROSS ?? 0), 0)
          const choice = window.confirm(
            `Für Rechnung ${label} existieren ${pays.length} Zahlung(en) über ${FMT_EUR.format(totalPaid)}.\n\n` +
            `OK = Zahlung(en) ebenfalls löschen\nAbbrechen = nur Rechnung stornieren`
          )
          deletePayments = choice
        } else {
          if (!window.confirm(`Stornorechnung für ${label} erstellen?`)) return
        }
      } catch {
        if (!window.confirm(`Stornorechnung für ${label} erstellen?`)) return
      }
      try {
        await cancelInvoice(inv.ID, { delete_payments: deletePayments })
        void qc.invalidateQueries({ queryKey: ['invoices'] })
        void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      } catch (e: unknown) {
        alert((e as { message?: string })?.message ?? 'Fehler beim Stornieren')
      }
    } else {
      const pp = row.raw as PartialPayment
      let deletePayments = false
      try {
        const paysRes = await fetchPayments({ partial_payment_id: pp.ID })
        const pays = paysRes.data ?? []
        if (pays.length > 0) {
          const totalPaid = pays.reduce((s, p) => s + (p.AMOUNT_PAYED_GROSS ?? 0), 0)
          const choice = window.confirm(
            `Für Abschlagsrechnung ${label} existieren ${pays.length} Zahlung(en) über ${FMT_EUR.format(totalPaid)}.\n\n` +
            `OK = Zahlung(en) ebenfalls löschen\nAbbrechen = nur Abschlagsrechnung stornieren`
          )
          deletePayments = choice
        } else {
          if (!window.confirm(`Stornorechnung für ${label} erstellen?`)) return
        }
      } catch {
        if (!window.confirm(`Stornorechnung für ${label} erstellen?`)) return
      }
      try {
        await cancelPartialPayment(pp.ID, { delete_payments: deletePayments })
        void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      } catch (e: unknown) {
        alert((e as { message?: string })?.message ?? 'Fehler beim Stornieren')
      }
    }
  }

  async function handleDelete(row: UnifiedRow) {
    if (!window.confirm(`Entwurf löschen?`)) return
    try {
      if (row.source === 'invoice') {
        await deleteInvoice((row.raw as Invoice).ID)
        void qc.invalidateQueries({ queryKey: ['invoices'] })
      } else {
        await deletePartialPayment((row.raw as PartialPayment).ID)
        void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      }
    } catch (e: unknown) {
      alert((e as { message?: string })?.message ?? 'Fehler beim Löschen')
    }
  }

  function canPay(row: UnifiedRow) {
    if (row.source === 'invoice') {
      const inv = row.raw as Invoice
      return inv.STATUS_ID === 2 && inv.INVOICE_TYPE !== 'stornorechnung'
    }
    const pp = row.raw as PartialPayment
    return pp.STATUS_ID === 2 && !pp.CANCELS_PARTIAL_PAYMENT_ID
  }

  function canCancel(row: UnifiedRow) { return canPay(row) }

  function canDelete(row: UnifiedRow) {
    if (row.source === 'invoice') return (row.raw as Invoice).STATUS_ID === 1
    return (row.raw as PartialPayment).STATUS_ID === 1
  }

  function openPdf(row: UnifiedRow) {
    if (row.source === 'invoice') openInvoicePdf((row.raw as Invoice).ID)
    else openPpPdf((row.raw as PartialPayment).ID)
  }

  function openXRechnung(row: UnifiedRow) {
    if (row.source === 'invoice') {
      const inv = row.raw as Invoice
      downloadInvoiceEinvoice(inv.ID, inv.INVOICE_TYPE, inv.INVOICE_NUMBER, 'ubl')
    } else {
      const pp = row.raw as PartialPayment
      downloadPpEinvoice(pp.ID, pp.PARTIAL_PAYMENT_NUMBER, 'ubl')
    }
  }

  function openZUGFeRD(row: UnifiedRow) {
    if (row.source === 'invoice') {
      const inv = row.raw as Invoice
      downloadInvoiceEinvoice(inv.ID, inv.INVOICE_TYPE, inv.INVOICE_NUMBER, 'cii')
    } else {
      const pp = row.raw as PartialPayment
      downloadPpEinvoice(pp.ID, pp.PARTIAL_PAYMENT_NUMBER, 'cii')
    }
  }

  const sp = { sortKey, dir: sortDir, onClick: toggleSort }
  const remaining = payTarget ? (Math.round(((payTarget.totalGross ?? 0) - (payTarget.paidGross ?? 0)) * 100) / 100) : null

  return (
    <div>
      <div className="list-toolbar" style={{ marginTop: 10 }}>
        <input
          className="list-search"
          placeholder="Suchen …"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <label className="list-checkbox-label">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={e => setOnlyOpen(e.target.checked)}
          />
          nur offene Posten
        </label>
        <span className="list-info">
          {rows.length}{rows.length !== allRows.length ? ` / ${allRows.length}` : ''} Einträge
        </span>
      </div>

      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && (
        <div className="list-section table-scroll">
          <table className="master-table">
            <thead>
              <tr>
                <SortTh label="Nummer"    k="number"      {...sp} />
                <SortTh label="Typ"       k="typ"         {...sp} />
                <SortTh label="Datum"     k="date"        {...sp} />
                <SortTh label="Projekt"   k="project"     {...sp} />
                <SortTh label="Netto €"   k="net"         {...sp} className="num" />
                <SortTh label="Brutto €"  k="gross"       {...sp} className="num" />
                <SortTh label="Bezahlt €" k="paid"        {...sp} className="num" />
                <SortTh label="Status"    k="statusLabel" {...sp} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key}>
                  <td>{row.number ?? '—'}</td>
                  <td>{row.typ}</td>
                  <td>{fmtDate(row.date)}</td>
                  <td>{row.project ?? '—'}</td>
                  <td className="num">{fmtEur(row.net)}</td>
                  <td className="num">{fmtEur(row.gross)}</td>
                  <td className="num">{fmtEur(row.paid)}</td>
                  <td><span className={`status-badge ${row.statusClass}`}>{row.statusLabel}</span></td>
                  <td className="doc-actions">
                    <button className="btn-small" onClick={() => openPdf(row)}>PDF</button>
                    <button className="btn-small" onClick={() => openXRechnung(row)}>XRechnung</button>
                    <button className="btn-small" onClick={() => openZUGFeRD(row)}>ZUGFeRD</button>
                    {canPay(row) && (
                      <button className="btn-small btn-save" onClick={() => openPayment(row)}>Zahlung</button>
                    )}
                    {canCancel(row) && (
                      <button className="btn-small btn-danger" onClick={() => handleCancel(row)}>Storno</button>
                    )}
                    {canDelete(row) && (
                      <button className="btn-small btn-danger" onClick={() => handleDelete(row)}>Löschen</button>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9} className="empty-note">Keine Einträge</td></tr>}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                <td colSpan={4} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                  {rows.length !== allRows.length ? `${rows.length} / ${allRows.length} Einträge` : `${allRows.length} Einträge`}
                </td>
                <td className="num">{fmtEur(totals.net)}</td>
                <td className="num">{fmtEur(totals.gross)}</td>
                <td className="num">{fmtEur(totals.paid)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Payment modal */}
      <Modal open={payTarget !== null} onClose={() => setPayTarget(null)} title={`Zahlung erfassen – ${payTarget?.label ?? ''}`}>
        {payTarget && (
          <form onSubmit={submitPayment} className="master-form">

            {/* Existing payments list */}
            {existingPayments.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(17,24,39,0.5)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Bisherige Zahlungen
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {existingPayments.map(p => (
                      <tr key={p.ID} style={{ borderBottom: '1px solid rgba(17,24,39,0.08)' }}>
                        <td style={{ padding: '4px 0', color: 'rgba(17,24,39,0.55)' }}>{p.PAYMENT_DATE?.slice(0, 10)}</td>
                        <td style={{ padding: '4px 6px', fontWeight: 500 }}>{fmtEur(p.AMOUNT_PAYED_GROSS)}</td>
                        <td style={{ padding: '4px 0', color: 'rgba(17,24,39,0.45)', flex: 1 }}>{p.PURPOSE_OF_PAYMENT ?? ''}</td>
                        <td style={{ padding: '4px 0 4px 8px', textAlign: 'right' }}>
                          <button
                            type="button"
                            title="Zahlung löschen"
                            disabled={deletingPayId === p.ID}
                            onClick={() => handleDeletePayment(p.ID)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontWeight: 700, fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {payTarget.totalGross != null && (
              <div style={{ marginBottom: 12, fontSize: 14, color: 'rgba(17,24,39,0.6)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>
                  Rechnungsbetrag: <strong>{fmtEur(payTarget.totalGross)}</strong>
                  {payTarget.paidGross != null && payTarget.paidGross > 0 && (
                    <> · bereits bezahlt: <strong>{fmtEur(payTarget.paidGross)}</strong>
                    · offen: <strong>{fmtEur(remaining)}</strong></>
                  )}
                </span>
                <button
                  type="button"
                  className="btn-small"
                  onClick={() => setPayForm(f => ({ ...f, amount_payed_gross: String(remaining ?? payTarget.totalGross) }))}
                >
                  wie gefordert
                </button>
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
              <input id="pay-purpose" type="text"
                value={payForm.purpose_of_payment}
                onChange={e => setPayForm(f => ({ ...f, purpose_of_payment: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label htmlFor="pay-comment">Kommentar</label>
              <input id="pay-comment" type="text"
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