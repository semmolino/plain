import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tabs } from '@/components/ui/Tabs'
import {
  fetchInvoices, fetchPartialPayments, invoicePdfUrl, ppPdfUrl,
  type Invoice, type PartialPayment,
} from '@/api/rechnungen'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? v.slice(0, 10) : '—'
const STATUS  = (id: number) => id === 2 ? 'Gebucht' : 'Entwurf'

const LIST_TABS = [
  { id: 'invoices', label: 'Rechnungen' },
  { id: 'pp',       label: 'Abschlagsrechnungen' },
]

export function RechnungenListe() {
  const [tab,    setTab]    = useState<'invoices' | 'pp'>('invoices')
  const [search, setSearch] = useState('')

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
                        <span className={`status-badge ${inv.STATUS_ID === 2 ? 'booked' : 'draft'}`}>
                          {STATUS(inv.STATUS_ID)}
                        </span>
                      </td>
                      <td>
                        <a href={invoicePdfUrl(inv.ID)} target="_blank" rel="noreferrer" className="btn-small">
                          PDF
                        </a>
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
                        <span className={`status-badge ${pp.STATUS_ID === 2 ? 'booked' : 'draft'}`}>
                          {STATUS(pp.STATUS_ID)}
                        </span>
                      </td>
                      <td>
                        <a href={ppPdfUrl(pp.ID)} target="_blank" rel="noreferrer" className="btn-small">
                          PDF
                        </a>
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
