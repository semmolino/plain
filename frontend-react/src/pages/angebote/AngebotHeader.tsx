import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, CheckCircle2, Copy, FileSignature, FileText, FolderOpen, Pencil, Trash2, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { RowMenu } from '@/components/ui/RowMenu'
import { Modal } from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ProjectPicker } from '@/components/projekte/ProjectPicker'
import {
  fetchOffers, fetchOfferStatuses, openOfferPdf, openAuftragsbestaetigungPdf,
  copyOffer, deleteOffer, updateOffer,
} from '@/api/angebote'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useTrackRecent } from '@/hooks/useTrackRecent'
import { money0, NO_VALUE } from '@/utils/money'
import { BeauftragtDialog } from './BeauftragtDialog'

const deDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : NO_VALUE)
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Kopf des Angebots-Arbeitsbereichs — dasselbe Muster wie ProjektHeader.
 *
 * Vorher stand ueber der Angebotsstruktur nur „← Angebotsliste" und die
 * Nummer; Status, Auftraggeber, Summe und Gueltigkeit sah man nur in der
 * Liste, und das Angebot wechselte man ueber ein eigenes Suchfeld in der
 * Struktur. Jetzt: Nummer und Status oben, der Name ist der Umschalter
 * (Strg+K), darunter Auftraggeber und Kennzahlen; PDF und „Beauftragt" rechts,
 * alles Seltene im ⋯-Menue — dieselben Befehle wie in der Listenzeile.
 */
export function AngebotHeader({ offerId, onBack, onSwitch, onEditData, onDeleted }: {
  offerId:    number
  onBack:     () => void
  onSwitch:   (id: number) => void
  onEditData: () => void
  onDeleted:  () => void
}) {
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const toast    = useToast()
  const narrow   = useIsNarrow()
  const canEdit    = usePermission('offers.edit')
  const canConvert = usePermission('offers.convert')
  const canCreate  = usePermission('offers.create')
  const canDelete  = usePermission('offers.delete')

  const { data: offersData } = useQuery({ queryKey: ['offers'], queryFn: fetchOffers })
  const { data: statusData } = useQuery({ queryKey: ['offer-statuses'], queryFn: fetchOfferStatuses })
  const offers  = offersData?.data ?? []
  const offer   = offers.find(o => o.ID === offerId)
  const abbr    = offer?.ABBR ?? ''
  const name    = offer?.NAME ?? ''
  const rejectedId = statusData?.data?.find(s => s.ABBR === 'Abgelehnt')?.ID ?? null
  const isOpen  = !!offer && offer.PROJECT_ID == null && (rejectedId == null || offer.OFFER_STATUS_ID !== rejectedId)
  const expired = !!offer?.VALID_UNTIL && isOpen && offer.VALID_UNTIL.slice(0, 10) < todayIso()

  useTrackRecent('offer', offerId, abbr ? [abbr, name].filter(Boolean).join(' · ') : null)

  const [beauftragt, setBeauftragt] = useState(false)
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; run: () => void } | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['offers'] })
    void qc.invalidateQueries({ queryKey: ['offer', offerId] })
    void qc.invalidateQueries({ queryKey: ['offer-detail', offerId] })
  }
  const copyMut = useMutation({
    mutationFn: () => copyOffer(offerId),
    onSuccess: (res) => {
      refresh()
      toast.success('Angebot kopiert')
      if (res.data?.ID) onSwitch(res.data.ID)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const rejectMut = useMutation({
    mutationFn: () => updateOffer(offerId, { offer_status_id: rejectedId!, refusal_date: todayIso() }),
    onSuccess: () => { refresh(); toast.success('Angebot als abgelehnt markiert') },
    onError: (e: Error) => toast.error(e.message),
  })
  const deleteMut = useMutation({
    mutationFn: () => deleteOffer(offerId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['offers'] }); toast.success('Angebot gelöscht'); onDeleted() },
    onError: (e: Error) => toast.error(e.message),
  })

  // Angebot wechseln: der Name ist der Umschalter, wie im Projekt.
  const [switching, setSwitching] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!switching || narrow) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setSwitching(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setSwitching(false)
      btnRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [switching, narrow])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      setSwitching(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function pick(id: number) {
    setSwitching(false)
    if (id !== offerId) onSwitch(id)
  }
  const picker = (inline: boolean) => (
    <ProjectPicker
      kind="offer"
      projects={offers.map(o => ({ ID: o.ID, ABBR: o.ABBR ?? '', NAME: o.NAME }))}
      selectedId={offerId}
      autoFocus
      startEmpty
      inline={inline}
      onSelect={pick}
      onGoToList={() => { setSwitching(false); onBack() }}
    />
  )

  const kpis = offer ? [
    { key: 'sum',  label: 'Angebotssumme',     value: money0(offer.TOTAL_AMOUNT) },
    { key: 'prob', label: 'Wahrscheinlichkeit', value: offer.PROBABILITY != null ? `${offer.PROBABILITY} %` : NO_VALUE },
    { key: 'date', label: 'Angebotsdatum',     value: deDate(offer.OFFER_DATE) },
    { key: 'valid', label: 'Gültig bis', value: <>{deDate(offer.VALID_UNTIL)}{expired && <span className="aw-kpi-note">abgelaufen</span>}</> },
  ] : []

  const menuItem = (key: string, label: string, icon: React.ReactNode, run: () => void, danger = false) => (
    <button key={key} type="button" role="menuitem" className={`row-menu-item${danger ? ' danger' : ''}`} onClick={run}>
      {icon}{label}
    </button>
  )
  const ic = (C: typeof Pencil) => <C size={13} strokeWidth={1.75} style={{ marginRight: 8 }} aria-hidden="true" />

  return (
    <>
      <PageHeader
        className="pw-header"
        back={{ label: 'Angebote', onClick: onBack }}
        eyebrow={<>
          <span>{abbr}</span>
          {offer?.STATUS_NAME && <span className="status-pill">{offer.STATUS_NAME}</span>}
          {offer?.PROJECT_ID != null && <span className="status-pill">Projekt {offer.PROJECT_NAME ?? ''}</span>}
        </>}
        title={
          <button ref={btnRef} type="button" className="pw-title-btn"
            aria-haspopup="dialog" aria-expanded={switching}
            title={`${name || abbr} – Angebot wechseln (Strg+K)`}
            onClick={() => setSwitching(s => !s)}>
            <span className="pw-title-text">{name || abbr || NO_VALUE}</span>
            <ChevronDown size={20} strokeWidth={2.25} className="pw-title-chev" aria-hidden="true" />
            <span className="sr-only">, Angebot wechseln</span>
          </button>
        }
        titleAddon={switching && !narrow ? (
          <div className="pw-switch-pop" ref={popRef} role="dialog" aria-label="Angebot wechseln">
            {picker(false)}
            <p className="pw-switch-hint">Pfeiltasten wählen · Enter öffnet · Esc schließt</p>
          </div>
        ) : undefined}
        meta={offer && (<>
          {offer.ADDRESS_NAME && <span><span className="page-header-meta-label">Auftraggeber</span>{offer.ADDRESS_NAME}</span>}
          {offer.CONTACT_NAME && !narrow && <span><span className="page-header-meta-label">Ansprechpartner</span>{offer.CONTACT_NAME}</span>}
          {offer.EMPLOYEE_NAME && <span><span className="page-header-meta-label">Zuständig</span>{offer.EMPLOYEE_NAME}</span>}
        </>)}
        actions={<>
          <button type="button" className="btn-secondary aw-action" onClick={() => openOfferPdf(offerId)}>
            <FileText size={15} strokeWidth={2} aria-hidden="true" /> PDF
          </button>
          {isOpen && canConvert && !narrow && (
            <button type="button" className="btn-primary aw-action" onClick={() => setBeauftragt(true)}>
              <CheckCircle2 size={15} strokeWidth={2} aria-hidden="true" /> Beauftragt …
            </button>
          )}
          <RowMenu label="Weitere Aktionen zum Angebot" triggerClassName="btn-secondary pw-more-btn">
            {isOpen && canConvert && narrow && menuItem('conv', 'Als beauftragt markieren', ic(CheckCircle2), () => setBeauftragt(true))}
            {canEdit && menuItem('edit', 'Angebotsdaten bearbeiten', ic(Pencil), onEditData)}
            {offer?.PROJECT_ID != null && menuItem('ab', 'Auftragsbestätigung (PDF)', ic(FileSignature), () => openAuftragsbestaetigungPdf(offerId))}
            {offer?.PROJECT_ID != null && menuItem('proj', `Zum Projekt ${offer.PROJECT_NAME ?? ''}`, ic(FolderOpen),
              () => navigate(`/projekte?projectId=${offer.PROJECT_ID}&tab=struktur`))}
            {canCreate && menuItem('copy', 'Angebot kopieren', ic(Copy), () => copyMut.mutate())}
            {isOpen && canEdit && rejectedId != null && menuItem('rej', 'Als abgelehnt markieren', ic(XCircle), () => setConfirm({
              title: 'Angebot ablehnen', message: `„${abbr}" als abgelehnt markieren?`, label: 'Als abgelehnt markieren', run: () => rejectMut.mutate(),
            }))}
            {canDelete && menuItem('del', 'Angebot löschen', ic(Trash2), () => setConfirm({
              title: 'Angebot löschen', message: `„${abbr}" mit seiner Struktur löschen? Das lässt sich nicht rückgängig machen.`, label: 'Löschen', run: () => deleteMut.mutate(),
            }), true)}
          </RowMenu>
        </>}
      >
        {kpis.length > 0 && (
          <dl className="pw-kpis">
            {kpis.map(k => <div key={k.key} className="pw-kpi"><dt>{k.label}</dt><dd>{k.value}</dd></div>)}
          </dl>
        )}
        {narrow && (
          <Modal open={switching} onClose={() => setSwitching(false)} title="Angebot wechseln" className="pw-switch-sheet">
            {picker(true)}
          </Modal>
        )}
      </PageHeader>

      {beauftragt && offer && (
        <BeauftragtDialog offer={offer} onClose={() => setBeauftragt(false)}
          onDone={m => { setBeauftragt(false); toast.success(m) }} />
      )}
      <ConfirmModal
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.label ?? 'Bestätigen'}
        confirmClass="danger"
        onConfirm={() => { confirm?.run(); setConfirm(null) }}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}
