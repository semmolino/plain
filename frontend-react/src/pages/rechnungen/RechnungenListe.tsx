import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tabs } from '@/components/ui/Tabs'
import { useQueryClient } from '@tanstack/react-query'
import {
  fetchInvoices, fetchPartialPayments,
  openInvoicePdf, openPpPdf,
  downloadInvoiceEinvoice, downloadPpEinvoice,
  cancelInvoice, cancelPartialPayment,
  deleteInvoice, deletePartialPayment,
  type Invoice, type PartialPayment,
} from '@/api/rechnungen'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? v.slice(0, 10) : '—'

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

export function RechnungenListe() {
  const [tab,    setTab]    = useState<'invoices' | 'pp'>('invoices')
  const [search, setSearch] = useState('')
  const qc = useQueryClient()

  const { data: invData, isLoading: invLoading } = useQuery({
    queryKey: ['invoices', search],
    queryFn:  () => fetchInvoices(search),
  })
  const { data: ppData, isLoading: ppLoading } = useQuery({
    queryKey: ['partial-payments', search],
    queryFn:  () => fetchPartialPayments(search),
  })

  const invoices = invData?.data ?? []
  const payments = ppData?.data  ?? []

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

  return (
    <div>
      <Tabs tabs={LIST_TABS} active={tab} onChange={id => setTab(id as typeof tab)} />

      <div className="list-toolbar" style={{ marginTop: 10 }}>
        <input
          className="list-search"
          placeholder="Nummer suchen …"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {tab === 'invoices' && (
        <>
          {invLoading && <p className="empty-note">Laden …</p>}
          {!invLoading && (
            <div className="list-section table-scroll">
              <table className="master-table">
                <thead>
                  <tr>
                    <th>Nummer</th>
                    <th>Typ</th>
                    <th>Datum</th>
                    <th>Projekt</th>
                    <th className="num">Netto €</th>
                    <th className="num">Brutto €</th>
                    <th>Status</th>
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
                      <td>
                        <span className={`status-badge ${invStatusClass(inv)}`}>
                          {invStatusLabel(inv)}
                        </span>
                      </td>
                      <td className="doc-actions">
                        <button className="btn-small" onClick={() => openInvoicePdf(inv.ID)}>PDF</button>
                        <button className="btn-small" onClick={() => downloadInvoiceEinvoice(inv.ID, inv.INVOICE_TYPE, inv.INVOICE_NUMBER, 'ubl')}>UBL</button>
                        <button className="btn-small" onClick={() => downloadInvoiceEinvoice(inv.ID, inv.INVOICE_TYPE, inv.INVOICE_NUMBER, 'cii')}>ZUGFeRD</button>
                        {inv.STATUS_ID === 2 && inv.INVOICE_TYPE !== 'stornorechnung' && (
                          <button className="btn-small btn-danger" onClick={() => handleCancelInvoice(inv)}>Storno</button>
                        )}
                        {inv.STATUS_ID === 1 && (
                          <button className="btn-small btn-danger" onClick={() => handleDeleteInvoice(inv)}>Löschen</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!invoices.length && <tr><td colSpan={8} className="empty-note">Keine Rechnungen</td></tr>}
                </tbody>
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
                    <th>Nummer</th>
                    <th>Datum</th>
                    <th>Projekt</th>
                    <th className="num">Netto €</th>
                    <th className="num">Brutto €</th>
                    <th>Status</th>
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
                      <td>
                        <span className={`status-badge ${ppStatusClass(pp)}`}>
                          {ppStatusLabel(pp)}
                        </span>
                      </td>
                      <td className="doc-actions">
                        <button className="btn-small" onClick={() => openPpPdf(pp.ID)}>PDF</button>
                        <button className="btn-small" onClick={() => downloadPpEinvoice(pp.ID, pp.PARTIAL_PAYMENT_NUMBER, 'ubl')}>UBL</button>
                        <button className="btn-small" onClick={() => downloadPpEinvoice(pp.ID, pp.PARTIAL_PAYMENT_NUMBER, 'cii')}>ZUGFeRD</button>
                        {pp.STATUS_ID === 2 && !pp.CANCELS_PARTIAL_PAYMENT_ID && (
                          <button className="btn-small btn-danger" onClick={() => handleCancelPp(pp)}>Storno</button>
                        )}
                        {pp.STATUS_ID === 1 && (
                          <button className="btn-small btn-danger" onClick={() => handleDeletePp(pp)}>Löschen</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!payments.length && <tr><td colSpan={7} className="empty-note">Keine Abschlagsrechnungen</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
