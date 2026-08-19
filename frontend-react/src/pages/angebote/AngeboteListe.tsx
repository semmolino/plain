import { useState, useMemo } from 'react'
import { useStickyState, useStickySet } from '@/hooks/useStickyState'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, FileText, FolderOpen, CheckCircle2, XCircle, Trash2, FileSignature } from 'lucide-react'
import { Can } from '@/components/ui/Can'
import { rowClickHandler } from '@/utils/rowClick'
import { RowMenu } from '@/components/ui/RowMenu'
import { FilterBar } from '@/components/ui/FilterBar'
import { FilterChip } from '@/components/ui/FilterChip'
import { ListLoading } from '@/components/ui/Skeleton'
import { usePermission } from '@/store/permissionsStore'
import { InlineSelect, InlineDate, InlineNumber, type InlineOption } from '@/components/ui/InlineEdit'
import { Message } from '@/components/ui/Message'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { RecentList }  from '@/components/recents/RecentList'
import { trackRecent } from '@/api/recents'
import {
  fetchOffers, deleteOffer, openOfferPdf, openAuftragsbestaetigungPdf, fetchOfferStructure, convertOffer, updateOffer,
  fetchOfferStatuses,
  type OfferListItem, type ConvertOfferPayload, type UpdateOfferPayload,
} from '@/api/angebote'
import { BeauftragtModal } from './BeauftragtModal'
import { AngeboteAnlegen } from './AngeboteAnlegen'
import { Modal }          from '@/components/ui/Modal'

const PAGE_SIZE = 25

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)

const TODAY = new Date().toISOString().slice(0, 10)

export function AngeboteListe({ onSelectOffer, onEditStammdaten, onOfferCreated }: { onSelectOffer?: (id: number, name: string) => void; onEditStammdaten?: (id: number) => void; onOfferCreated?: (id: number) => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search,        setSearch]        = useState('')
  const [page,          setPage]          = useState(1)
  const [onlyOpen,      setOnlyOpen]      = useStickyState<boolean>('angebote.onlyOpen', false)
  const [activeStatus,   setActiveStatus]   = useStickySet('angebote.status')
  const [activeEmployee, setActiveEmployee] = useStickySet('angebote.employee')
  const [msg,           setMsg]           = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [beauftragtRow, setBeauftragtRow] = useState<OfferListItem | null>(null)
  // Anlegen lief frueher ueber einen eigenen Tab. Jetzt Primaeraktion in der
  // Liste — wie "+ Neues Projekt" in der Projektliste.
  const [showCreate,    setShowCreate]    = useState(false)
  const [convertErr,    setConvertErr]    = useState<string | null>(null)
  const [confirmState,  setConfirmState]  = useState<{ title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['offers'], queryFn: fetchOffers })
  const { data: statusData } = useQuery({ queryKey: ['offer-statuses'], queryFn: fetchOfferStatuses })
  const rejectedId   = statusData?.data?.find(s => s.NAME_SHORT === 'Abgelehnt')?.ID ?? null
  const beauftragtId = statusData?.data?.find(s => s.NAME_SHORT === 'Beauftragt')?.ID ?? null

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

  const markOrderedMut = useMutation({
    mutationFn: (body: { order_date: string; project_id?: number | null }) =>
      updateOffer(beauftragtRow!.ID, {
        order_date:      body.order_date,
        project_id:      body.project_id ?? null,
        ...(beauftragtId ? { offer_status_id: beauftragtId } : {}),
      }),
    onSuccess: () => {
      setBeauftragtRow(null)
      setConvertErr(null)
      void qc.invalidateQueries({ queryKey: ['offers'] })
      setMsg({ text: 'Angebot als beauftragt markiert ✅', type: 'success' })
    },
    onError: (e: Error) => setConvertErr(e.message),
  })

  const rows = data?.data ?? []

  // ── Inline-Edit (Status / Wahrscheinlichkeit / Datumsfelder direkt in der Liste) ──
  const canEdit = usePermission('offers.edit')
  const statusOpts: InlineOption[] = useMemo(
    () => (statusData?.data ?? []).map(s => ({ value: String(s.ID), label: s.NAME_SHORT })),
    [statusData],
  )
  const inlineMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateOfferPayload }) => updateOffer(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['offers'] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  // Filterwerte kommen aus den geladenen Daten, nicht aus festen Listen —
  // so wie in den uebrigen Listen auch.
  const filterOptions = useMemo(() => {
    const uniq = (pick: (r: OfferListItem) => string | null | undefined) =>
      [...new Set(rows.map(pick).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'de'))
    return { status: uniq(r => r.STATUS_NAME), employee: uniq(r => r.EMPLOYEE_NAME) }
  }, [rows])

  const filtered = useMemo(() => {
    let result = rows
    if (onlyOpen) result = result.filter(r => r.PROJECT_ID === null && (rejectedId === null || r.OFFER_STATUS_ID !== rejectedId))
    if (activeStatus.size > 0)   result = result.filter(r => r.STATUS_NAME   && activeStatus.has(r.STATUS_NAME))
    if (activeEmployee.size > 0) result = result.filter(r => r.EMPLOYEE_NAME && activeEmployee.has(r.EMPLOYEE_NAME))
    const q = search.trim().toLowerCase()
    if (q) result = result.filter(r =>
      `${r.NAME_SHORT} ${r.NAME_LONG} ${r.STATUS_NAME ?? ''} ${r.ADDRESS_NAME ?? ''} ${r.EMPLOYEE_NAME ?? ''}`.toLowerCase().includes(q)
    )
    return result
  }, [rows, search, onlyOpen, rejectedId, activeStatus, activeEmployee])

  const totalSum = useMemo(() => filtered.reduce((s, r) => s + (r.TOTAL_AMOUNT ?? 0), 0), [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function requestDelete(r: OfferListItem) {
    setConfirmState({
      title: 'Angebot löschen',
      message: `Angebot „${r.NAME_SHORT ?? r.NAME_LONG}" wirklich löschen?`,
      confirmLabel: 'Löschen',
      onConfirm: () => deleteMut.mutate(r.ID),
    })
  }

  function requestReject(r: OfferListItem) {
    setConfirmState({
      title: 'Als abgelehnt markieren',
      message: `Angebot „${r.NAME_SHORT ?? r.NAME_LONG}" als abgelehnt markieren?`,
      confirmLabel: 'Abgelehnt markieren',
      onConfirm: () => rejectMut.mutate(r.ID),
    })
  }

  const isOpen = (r: OfferListItem) =>
    r.PROJECT_ID === null && (rejectedId === null || r.OFFER_STATUS_ID !== rejectedId)
  // isRejected entfaellt: der Status steht in der Status-Spalte, ein
  // zusaetzlicher Hinweis in der Aktionsspalte war doppelt.

  return (
    <>
    <div>
      <RecentList
        type="offer"
        title="Zuletzt verwendete Angebote"
        onSelect={(e) => onSelectOffer?.(e.ENTITY_ID, e.LABEL ?? '')}
      />

      <div className="list-toolbar" style={{ marginTop: 10 }}>
        <input type="search"
          className="list-search"
          placeholder="Suchen …"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        {/* Bis hierher war das die einzige Liste ohne Filter-Chips — nur
            Suche plus eine Checkbox. Status und Ansprechpartner sind die
            Dimensionen, nach denen man Angebote tatsaechlich einschraenkt. */}
        <FilterBar
          activeCount={activeStatus.size + activeEmployee.size + (onlyOpen ? 1 : 0)}
          onReset={() => { setActiveStatus(new Set()); setActiveEmployee(new Set()); setOnlyOpen(false); setPage(1) }}
        >
          <FilterChip label="Status"     options={filterOptions.status}   active={activeStatus}   onChange={v => { setActiveStatus(v); setPage(1) }} />
          <FilterChip label="Ansprechp." options={filterOptions.employee} active={activeEmployee} onChange={v => { setActiveEmployee(v); setPage(1) }} />
          <label className="list-checkbox-label">
            <input type="checkbox" checked={onlyOpen} onChange={e => { setOnlyOpen(e.target.checked); setPage(1) }} />
            Offene Angebote
          </label>
        </FilterBar>
        <Can permission="offers.create">
          <button className="btn-primary btn-small" style={{ marginLeft: 'auto' }} onClick={() => setShowCreate(true)}>
            + Neues Angebot
          </button>
        </Can>
      </div>

      {msg && <div style={{ marginBottom: 12 }}><Message type={msg.type} text={msg.text} /></div>}

      {isLoading && <ListLoading columns={6} />}

      {!isLoading && (
        <div className="list-section table-scroll">
          {/* Bewusst OHNE die fixierte Aktionsspalte: die Zeilen zeigen je
              nach Status unterschiedlich viele Knoepfe (Beauftragen,
              Ablehnen, Projekt oeffnen). Die Spalte bekommt dadurch pro
              Zeile eine andere Breite und ueberlappt fixiert die Daten.
              Voraussetzung waere ein konstanter Satz Inline-Aktionen mit
              ⋯-Menue wie in der Rechnungsliste — siehe Notiz unten. */}
          {/* Die Aktionsspalte ist jetzt konstant breit (Bearbeiten, PDF, ⋯) —
              damit laesst sie sich rechts fixieren, ohne die Daten zu
              ueberlappen. Die Tabelle ist auch auf ueblichen Desktop-Breiten
              breiter als ihr Container. */}
          <table className="master-table master-table--sticky-actions">
            <thead>
              <tr>
                <th scope="col">Nr.</th>
                <th scope="col">Titel</th>
                <th scope="col">Status</th>
                <th scope="col">Ansprechpartner</th>
                <th scope="col">Adresse</th>
                <th scope="col" className="num">Angebotssumme</th>
                <th scope="col" className="num">Wahrsch.</th>
                <th scope="col">Angebotsdatum</th>
                <th scope="col">Gültig bis</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => (
                <tr
                  key={r.ID}
                  className={onSelectOffer ? 'clickable-row' : undefined}
                  onClick={onSelectOffer ? rowClickHandler(() => {
                    void trackRecent('offer', r.ID, [r.NAME_SHORT, r.NAME_LONG].filter(Boolean).join(' · ') || `#${r.ID}`).catch(() => {})
                    onSelectOffer(r.ID, r.NAME_SHORT ?? '')
                  }) : undefined}
                >
                  {/* Die Nummer ist der fokussierbare Einstieg in die Zeile —
                      sie ersetzt die frueher in jeder Zeile wiederholte
                      Schaltflaeche „Oeffnen" und bleibt per Tab erreichbar. */}
                  <td className="cell-nowrap">
                    {onSelectOffer
                      ? <button className="link-btn" onClick={() => {
                          void trackRecent('offer', r.ID, [r.NAME_SHORT, r.NAME_LONG].filter(Boolean).join(' · ') || `#${r.ID}`).catch(() => {})
                          onSelectOffer(r.ID, r.NAME_SHORT ?? '')
                        }}>{r.NAME_SHORT ?? '—'}</button>
                      : (r.NAME_SHORT ?? '—')}
                  </td>
                  {/* Einzeilig mit Auslassung: die Titel brachen sonst auf bis
                      zu vier Zeilen um, wodurch die Zeilenhoehen zwischen 56
                      und 96px schwankten. Volltext im title-Attribut. */}
                  <td className="cell-ellipsis" title={r.NAME_LONG}>{r.NAME_LONG}</td>
                  <td>
                    <InlineSelect
                      value={r.OFFER_STATUS_ID} options={statusOpts} allowEmpty={false}
                      readOnly={!canEdit} ariaLabel="Status" fallbackLabel={r.STATUS_NAME ?? undefined}
                      onChange={v => v && inlineMut.mutate({ id: r.ID, body: { offer_status_id: Number(v) } })}
                    />
                  </td>
                  <td className="cell-nowrap">{r.EMPLOYEE_NAME ?? '—'}</td>
                  <td className="cell-ellipsis" title={r.ADDRESS_NAME ?? undefined}>{r.ADDRESS_NAME ?? '—'}</td>
                  <td className="num">{fmtEur(r.TOTAL_AMOUNT)}</td>
                  <td className="num">
                    <InlineNumber
                      value={r.PROBABILITY} suffix=" %" min={0} max={100} step={5}
                      readOnly={!canEdit}
                      onSave={v => inlineMut.mutate({ id: r.ID, body: { probability: v } })}
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <InlineDate
                      value={r.OFFER_DATE} readOnly={!canEdit}
                      onSave={v => inlineMut.mutate({ id: r.ID, body: { offer_date: v || null } })}
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <InlineDate
                      value={r.VALID_UNTIL} readOnly={!canEdit}
                      onSave={v => inlineMut.mutate({ id: r.ID, body: { valid_until: v || null } })}
                    />
                  </td>
                  <td className="doc-actions" onClick={e => e.stopPropagation()}>
                    <Can permission="offers.edit">
                      <button className="row-action-btn" onClick={() => onEditStammdaten?.(r.ID)} title="Angebotsdaten bearbeiten">
                        <Pencil size={14} strokeWidth={2} />
                      </button>
                    </Can>
                    {/* „Oeffnen" entfaellt — die Zeile ist anklickbar und die
                        Nummer ist ein Link. */}
                    <button className="row-action-btn" onClick={() => openOfferPdf(r.ID)} title="PDF">
                      <FileText size={14} strokeWidth={1.75} />
                    </button>
                    {/* Alles Bedingte steckt im ⋯-Menue. Inline standen vorher
                        je nach Status drei bis sieben Knoepfe — die Spalte
                        bekam dadurch pro Zeile eine andere Breite und liess
                        sich nicht fixieren. Jetzt konstant: Bearbeiten, PDF, ⋯
                        Der Hinweis „Abgelehnt" entfaellt hier; der Status
                        steht bereits in der eigenen Spalte. */}
                    <RowMenu triggerClassName="row-action-btn">
                      {r.PROJECT_ID && (
                        <>
                          <button className="row-menu-item" onClick={() => openAuftragsbestaetigungPdf(r.ID)}>
                            <FileSignature size={13} strokeWidth={1.75} /> Auftragsbestätigung (PDF)
                          </button>
                          <button
                            className="row-menu-item"
                            onClick={() => navigate('/projekte', { state: { tab: 'struktur', projectId: r.PROJECT_ID } })}
                          >
                            <FolderOpen size={13} strokeWidth={1.75} /> Zum Projekt {r.PROJECT_NAME ?? ''}
                          </button>
                        </>
                      )}
                      {isOpen(r) && (
                        <Can permission="offers.convert">
                          <button className="row-menu-item" onClick={() => { setConvertErr(null); setBeauftragtRow(r) }}>
                            <CheckCircle2 size={13} strokeWidth={2} /> Als beauftragt markieren
                          </button>
                        </Can>
                      )}
                      {isOpen(r) && (
                        <Can permission="offers.edit">
                          <button className="row-menu-item" onClick={() => requestReject(r)}>
                            <XCircle size={13} strokeWidth={2} /> Als abgelehnt markieren
                          </button>
                        </Can>
                      )}
                      <Can permission="offers.delete">
                        <button className="row-menu-item danger" onClick={() => requestDelete(r)}>
                          <Trash2 size={13} strokeWidth={2} /> Löschen
                        </button>
                      </Can>
                    </RowMenu>
                  </td>
                </tr>
              ))}
              {!pageRows.length && (
                <tr><td colSpan={10} className="empty-note">
                  {rows.length === 0
                    ? 'Noch keine Angebote — erstelle dein erstes über den Tab „Anlegen". Aus einem beauftragten Angebot wird per „Beauftragt" ein Projekt.'
                    : 'Keine Angebote für diese Filter.'}
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
                <td colSpan={5} style={{ fontSize: 13, color: 'var(--text-3)', paddingTop: 6 }}>
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
        onMarkOrdered={body => markOrderedMut.mutate(body)}
        onClose={() => setBeauftragtRow(null)}
        isPending={convertMut.isPending || markOrderedMut.isPending}
        error={convertErr}
      />
    )}

    <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Neues Angebot anlegen" className="modal-wide">
      <AngeboteAnlegen onOfferCreated={id => { setShowCreate(false); onOfferCreated?.(id) }} />
    </Modal>

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
