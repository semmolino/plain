import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message } from '@/components/ui/Message'
import { fetchOffers, deleteOffer, openOfferPdf, type OfferListItem } from '@/api/angebote'

const PAGE_SIZE = 25

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('de-DE')
}

export function AngeboteListe({ onSelectOffer }: { onSelectOffer?: (id: number) => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [page,   setPage]   = useState(1)
  const [msg, setMsg]       = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['offers'],
    queryFn:  fetchOffers,
  })

  const deleteMut = useMutation({
    mutationFn: deleteOffer,
    onSuccess: () => { setMsg({ text: 'Angebot gelöscht ✅', type: 'success' }); void qc.invalidateQueries({ queryKey: ['offers'] }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const rows = data?.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q
      ? rows.filter(r => `${r.NAME_SHORT} ${r.NAME_LONG} ${r.STATUS_NAME ?? ''} ${r.ADDRESS_NAME ?? ''} ${r.EMPLOYEE_NAME ?? ''}`.toLowerCase().includes(q))
      : rows
  }, [rows, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function handleDelete(r: OfferListItem) {
    if (!confirm(`Angebot "${r.NAME_SHORT ?? r.NAME_LONG}" wirklich löschen?`)) return
    deleteMut.mutate(r.ID)
  }

  return (
    <div>
      <div className="list-toolbar" style={{ marginTop: 10 }}>
        <input
          className="list-search"
          placeholder="Suchen …"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
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
                <th className="num">Wahrsch.</th>
                <th>Erstellt</th>
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
                  <td className="num">{r.PROBABILITY != null ? `${r.PROBABILITY} %` : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.CREATED_AT)}</td>
                  <td className="doc-actions">
                    <button className="btn-small" onClick={() => onSelectOffer?.(r.ID)}>Bearbeiten</button>
                    <button className="btn-small" onClick={() => openOfferPdf(r.ID)}>PDF</button>
                    <button className="btn-small btn-danger" disabled={deleteMut.isPending} onClick={() => handleDelete(r)}>Löschen</button>
                  </td>
                </tr>
              ))}
              {!pageRows.length && <tr><td colSpan={8} className="empty-note">Keine Angebote vorhanden.</td></tr>}
            </tbody>
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
  )
}
