import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message } from '@/components/ui/Message'
import {
  fetchOffers, deleteOffer, openOfferPdf, fetchOfferStructure, convertOffer, updateOffer,
  type OfferListItem, type ConvertOfferPayload,
} from '@/api/angebote'
import { BeauftragtModal } from './BeauftragtModal'

const PAGE_SIZE = 25

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('de-DE')
}

const TODAY = new Date().toISOString().slice(0, 10)

export function AngeboteListe({ onSelectOffer }: { onSelectOffer?: (id: number) => void }) {
  const qc = useQueryClient()
  const [search,      setSearch]      = useState('')
  const [page,        setPage]        = useState(1)
  const [onlyOpen,    setOnlyOpen]    = useState(false)
  const [msg,         setMsg]         = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [beauftragtRow, setBeauftragtRow] = useState<OfferListItem | null>(null)
  const [convertErr,    setConvertErr]    = useState<string | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['offers'], queryFn: fetchOffers })

  const { data: structData } = useQuery({
    queryKey: ['offer-structure', beauftragtRow?.ID],
    queryFn:  () => fetchOfferStructure(beauftragtRow!.ID),
    enabled:  beauftragtRow !== null,
  })

  const deleteMut = useMutation({
    mutationFn: deleteOffer,
    onSuccess: () => { setMsg({ text: 'Angebot gelöscht ✅', type: 'success' }); void qc.invalidateQueries({ queryKey: ['offers'] }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const rejectMut = useMutation({
    mutationFn: (id: number) => updateOffer(id, { offer_status_id: 4, refusal_date: TODAY }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['offers'] }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const convertMut = useMutation({
    mutationFn: (body: ConvertOfferPayload) => convertOffer(beauftragtRow!.ID, body),
    onSuccess: (res) => {
      setBeauftragtRow(null)
      setConvertErr(null)
      void qc.invalidateQueries({ queryKey: ['offers'] })
      setMsg({ text: `Projekt ${res.data.projectName} wurde angelegt ✅`, type: 'success' })
    },
    onError: (e: Error) => setConvertErr(e.message),
  })

  const rows = data?.data ?? []

  const filtered = useMemo(() => {
    let result = rows
    if (onlyOpen) result = result.filter(r => r.PROJECT_ID === null)
    const q = search.trim().toLowerCase()
    if (q) result = result.filter(r =>
      `${r.NAME_SHORT} ${r.NAME_LONG} ${r.STATUS_NAME ?? ''} ${r.ADDRESS_NAME ?? ''} ${r.EMPLOYEE_NAME ?? ''}`.toLowerCase().includes(q)
    )
    return result
  }, [rows, search, onlyOpen])

  const totalSum = useMemo(() => filtered.reduce((s, r) => s + (r.TOTAL_AMOUNT ?? 0), 0), [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function handleDelete(r: OfferListItem) {
    if (!confirm(`Angebot "${r.NAME_SHORT ?? r.NAME_LONG}" wirklich löschen?`)) return
    deleteMut.mutate(r.ID)
  }

  function handleReject(r: OfferListItem) {
    if (!confirm(`Angebot "${r.NAME_SHORT ?? r.NAME_LONG}" als abgelehnt markieren?`)) return
    rejectMut.mutate(r.ID)
  }

  return (
    <>
    <div>
      <div className="list-toolbar" style={{ marginTop: 10 }}>
        <input
          className="list-search"
          placeholder="Suchen …"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={onlyOpen} onChange={e => { setOnlyOpen(e.target.checked); setPage(1) }} />
          Offene Angebote
        </label>
        <span className="list-info">{filtered.length} Einträge</span>
      </div>

      {msg && <div style={{ marginBottom: 12 }}><Message type={msg.type} text={msg.text} /></div>}

      {isLoading && <p className="empty-note">Laden …</p>}

      {!isLoading && (
        <div className="list-section table-scroll">
          <table className="master-table">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Titel</th>
                <th>Status</th>
                <th>Ansprechpartner</th>
                <th>Adresse</th>
                <th className="num">Angebotssumme</th>
                <th className="num">Wahrsch.</th>
                <th>Angebotsdatum</th>
                <th>Gültig bis</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => (
                <tr key={r.ID}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.NAME_SHORT ?? '—'}</td>
                  <td>{r.NAME_LONG}</td>
                  <td>{r.STATUS_NAME ?? '—'}</td>
                  <td>{r.EMPLOYEE_NAME ?? '—'}</td>
                  <td>{r.ADDRESS_NAME ?? '—'}</td>
                  <td className="num">{fmtEur(r.TOTAL_AMOUNT)}</td>
                  <td className="num">{r.PROBABILITY != null ? `${r.PROBABILITY} %` : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.OFFER_DATE ?? r.CREATED_AT)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.VALID_UNTIL)}</td>
                  <td className="doc-actions">
                    <button className="btn-small" onClick={() => onSelectOffer?.(r.ID)}>Bearbeiten</button>
                    <button className="btn-small" onClick={() => openOfferPdf(r.ID)}>PDF</button>
                    {r.PROJECT_ID ? (
                      <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        ✅ {r.PROJECT_NAME ?? `Projekt #${r.PROJECT_ID}`}
                      </span>
                    ) : (
                      <>
                        <button
                          className="btn-small"
                          style={{ background: '#16a34a', color: '#fff', borderColor: '#16a34a' }}
                          onClick={() => { setConvertErr(null); setBeauftragtRow(r) }}
                        >
                          Beauftragt
                        </button>
                        {r.OFFER_STATUS_ID !== 4 && (
                          <button
                            className="btn-small"
                            style={{ background: '#dc2626', color: '#fff', borderColor: '#dc2626' }}
                            disabled={rejectMut.isPending}
                            onClick={() => handleReject(r)}
                          >
                            Abgelehnt
                          </button>
                        )}
                      </>
                    )}
                    <button className="btn-small btn-danger" disabled={deleteMut.isPending} onClick={() => handleDelete(r)}>Löschen</button>
                  </td>
                </tr>
              ))}
              {!pageRows.length && <tr><td colSpan={10} className="empty-note">Keine Angebote vorhanden.</td></tr>}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                <td colSpan={5} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                  {filtered.length} Einträge
                </td>
                <td className="num">{fmtEur(totalSum)}</td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <button disabled={safePage <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
          <span style={{ fontSize: 13 }}>Seite {safePage} / {totalPages}</span>
          <button disabled={safePage >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
        </div>
      )}
    </div>

    {beauftragtRow && (
      <BeauftragtModal
        open={beauftragtRow !== null}
        offerName={beauftragtRow.NAME_SHORT ?? beauftragtRow.NAME_LONG}
        structNodes={structData?.data ?? []}
        onConvert={body => convertMut.mutate(body)}
        onClose={() => setBeauftragtRow(null)}
        isPending={convertMut.isPending}
        error={convertErr}
      />
    )}
    </>
  )
}
