import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message } from '@/components/ui/Message'
import { fetchOffers, deleteOffer, getOfferPdfUrl, type OfferListItem } from '@/api/angebote'

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
    <div className="ls-wrap">
      <div className="ls-toolbar">
        <input
          className="ls-select"
          placeholder="Suchen …"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
      </div>

      {msg && <div style={{ marginBottom: 12 }}><Message type={msg.type} text={msg.text} /></div>}

      {isLoading && <p className="ls-empty">Lade Daten …</p>}
      {!isLoading && filtered.length === 0 && <p className="ls-empty">Keine Angebote vorhanden.</p>}

      {!isLoading && filtered.length > 0 && (
        <>
          <div className="ls-table-wrap">
            <table className="ls-table">
              <thead>
                <tr>
                  <th className="ls-th">Nr.</th>
                  <th className="ls-th">Titel</th>
                  <th className="ls-th">Status</th>
                  <th className="ls-th">Ansprechpartner</th>
                  <th className="ls-th">Adresse</th>
                  <th className="ls-th ls-col-num">Wahrsch.</th>
                  <th className="ls-th">Erstellt</th>
                  <th className="ls-th"></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(r => (
                  <tr key={r.ID} className="ls-row ls-row-leaf">
                    <td className="ls-td" style={{ whiteSpace: 'nowrap' }}>{r.NAME_SHORT ?? '—'}</td>
                    <td className="ls-td">{r.NAME_LONG}</td>
                    <td className="ls-td">{r.STATUS_NAME ?? '—'}</td>
                    <td className="ls-td">{r.EMPLOYEE_NAME ?? '—'}</td>
                    <td className="ls-td">{r.ADDRESS_NAME ?? '—'}</td>
                    <td className="ls-td ls-right">{r.PROBABILITY != null ? `${r.PROBABILITY} %` : '—'}</td>
                    <td className="ls-td" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.CREATED_AT)}</td>
                    <td className="ls-td" style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn-small"
                        onClick={() => onSelectOffer?.(r.ID)}
                        title="Bearbeiten"
                      >Bearbeiten</button>
                      {' '}
                      <a
                        className="btn-small"
                        href={getOfferPdfUrl(r.ID)}
                        target="_blank"
                        rel="noreferrer"
                        title="PDF öffnen"
                      >PDF</a>
                      {' '}
                      <button
                        className="btn-small"
                        style={{ color: 'var(--color-danger, #ef4444)' }}
                        disabled={deleteMut.isPending}
                        onClick={() => handleDelete(r)}
                        title="Löschen"
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="ls-footer" style={{ justifyContent: 'flex-start', gap: 8 }}>
              <button disabled={safePage <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
              <span style={{ fontSize: 13 }}>Seite {safePage} / {totalPages}</span>
              <button disabled={safePage >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
