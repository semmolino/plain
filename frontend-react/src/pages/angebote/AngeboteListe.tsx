import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, FileText, MoreHorizontal } from 'lucide-react'
import { Message } from '@/components/ui/Message'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import {
  fetchOffers, deleteOffer, openOfferPdf, openAuftragsbestaetigungPdf, fetchOfferStructure, convertOffer, updateOffer,
  fetchOfferStatuses,
  type OfferListItem, type ConvertOfferPayload,
} from '@/api/angebote'
import { BeauftragtModal } from './BeauftragtModal'

const PAGE_SIZE = 25

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('de-DE')
}

const TODAY = new Date().toISOString().slice(0, 10)

// ── Row overflow menu ──────────────────────────────────────────────────────────

function RowMenu({ open, onOpen, onClose, children }: {
  open: boolean; onOpen: () => void; onClose: () => void; children: React.ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onClose])
  return (
    <div ref={wrapRef} className="row-menu-wrap" style={{ display: 'inline-block', position: 'relative' }}>
      <button className="row-action-btn" onClick={open ? onClose : onOpen} title="Weitere Aktionen"><MoreHorizontal size={15} strokeWidth={1.75} /></button>
      {open && <div className="row-menu-dropdown">{children}</div>}
    </div>
  )
}

export function AngeboteListe({ onSelectOffer }: { onSelectOffer?: (id: number, name: string) => void }) {
  const qc = useQueryClient()
  const [search,      setSearch]      = useState('')
  const [page,        setPage]        = useState(1)
  const [onlyOpen,    setOnlyOpen]    = useState(false)
  const [msg,         setMsg]         = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [beauftragtRow, setBeauftragtRow] = useState<OfferListItem | null>(null)
  const [convertErr,    setConvertErr]    = useState<string | null>(null)
  const [menuOpenId,    setMenuOpenId]    = useState<number | null>(null)
  const [confirmState,  setConfirmState]  = useState<{ title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['offers'], queryFn: fetchOffers })
  const { data: statusData } = useQuery({ queryKey: ['offer-statuses'], queryFn: fetchOfferStatuses })
  const rejectedId = statusData?.data?.find(s => s.NAME_SHORT === 'Abgelehnt')?.ID ?? null

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
    mutationFn: (id: number) => updateOffer(id, { offer_status_id: rejectedId!, refusal_date: TODAY }),
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
    if (onlyOpen) result = result.filter(r => r.PROJECT_ID === null && (rejectedId === null || r.OFFER_STATUS_ID !== rejectedId))
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

  function requestDelete(r: OfferListItem) {
    setMenuOpenId(null)
    setConfirmState({
      title: 'Angebot löschen',
      message: `Angebot „${r.NAME_SHORT ?? r.NAME_LONG}" wirklich löschen?`,
      confirmLabel: 'Löschen',
      onConfirm: () => deleteMut.mutate(r.ID),
    })
  }

  function requestReject(r: OfferListItem) {
    setMenuOpenId(null)
    setConfirmState({
      title: 'Als abgelehnt markieren',
      message: `Angebot „${r.NAME_SHORT ?? r.NAME_LONG}" als abgelehnt markieren?`,
      confirmLabel: 'Abgelehnt markieren',
      onConfirm: () => rejectMut.mutate(r.ID),
    })
  }

  const isOpen = (r: OfferListItem) =>
    r.PROJECT_ID === null && (rejectedId === null || r.OFFER_STATUS_ID !== rejectedId)
  const isRejected = (r: OfferListItem) =>
    rejectedId !== null && r.OFFER_STATUS_ID === rejectedId

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
                  <td className="doc-actions" onClick={e => e.stopPropagation()}>
                    <button className="row-action-btn" onClick={() => onSelectOffer?.(r.ID, r.NAME_SHORT ?? '')} title="Bearbeiten"><Pencil size={14} strokeWidth={2} /></button>
                    <button className="row-action-btn" onClick={() => openOfferPdf(r.ID)} title="PDF"><FileText size={14} strokeWidth={1.75} /></button>
                    {r.PROJECT_ID && (
                      <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, padding: '0 4px', whiteSpace: 'nowrap' }}>
                        ✅ {r.PROJECT_NAME ?? `#${r.PROJECT_ID}`}
                      </span>
                    )}
                    <RowMenu
                      open={menuOpenId === r.ID}
                      onOpen={() => setMenuOpenId(r.ID)}
                      onClose={() => setMenuOpenId(null)}
                    >
                      {isOpen(r) && (
                        <button className="row-menu-item" onClick={() => { setMenuOpenId(null); setConvertErr(null); setBeauftragtRow(r) }}>
                          Beauftragt
                        </button>
                      )}
                      {r.PROJECT_ID && (
                        <button className="row-menu-item" onClick={() => { setMenuOpenId(null); openAuftragsbestaetigungPdf(r.ID) }}>
                          Auftragsbestätigung
                        </button>
                      )}
                      {isOpen(r) && (
                        <button className="row-menu-item" onClick={() => requestReject(r)}>
                          Als abgelehnt markieren
                        </button>
                      )}
                      {isRejected(r) && (
                        <button className="row-menu-item" style={{ color: 'var(--text-2)', fontSize: 11 }} disabled>
                          Abgelehnt
                        </button>
                      )}
                      <div className="row-menu-divider" />
                      <button className="row-menu-item danger" onClick={() => requestDelete(r)}>
                        Löschen
                      </button>
                    </RowMenu>
                  </td>
                </tr>
              ))}
              {!pageRows.length && (
                <tr><td colSpan={10} className="empty-note">
                  {rows.length === 0 ? 'Noch keine Angebote vorhanden.' : 'Keine Angebote für diese Filter.'}
                </td></tr>
              )}
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

    <ConfirmModal
      open={confirmState !== null}
      title={confirmState?.title ?? ''}
      message={confirmState?.message ?? ''}
      confirmLabel={confirmState?.confirmLabel ?? 'Bestätigen'}
      confirmClass="danger"
      onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null) }}
      onCancel={() => setConfirmState(null)}
    />
    </>
  )
}
