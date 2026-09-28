import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus } from 'lucide-react'
import { FilterChip } from '@/components/ui/FilterChip'
import { SortTh } from '@/components/ui/SortTh'
import { Message } from '@/components/ui/Message'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useGuardedAction } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/store/permissionsStore'
import { fetchFeeCalcMasters, deleteFeeCalcMaster } from '@/api/fee'
import { angebotHref } from '@/pages/angebote/angebotUrlState'
import { money } from '@/utils/money'
import { HonorarWizard, HONORAR_WIZARD_GUARD } from './HonorarWizard'
import { KalkulationActions } from './KalkulationActions'

type WizardMode = null | { mode: 'create' } | { mode: 'edit'; id: number }
type SortCol = 'nameShort' | 'nameLong' | 'project' | 'grundhonorar' | 'gesamthonorar'

interface HonorarTabProps {
  initialProjectId?: number
}

/**
 * Kalkulationen: Liste aller HOAI-Kalkulationen (Projekt-Liste) bzw. der
 * eines Projekts (Projekt-Reiter), dazu der Assistent an Ort und Stelle.
 */
export function HonorarTab({ initialProjectId }: HonorarTabProps) {
  const navigate = useNavigate()
  const guarded  = useGuardedAction()
  const canEdit   = usePermission('projects.calculations.edit')
  const canDelete = usePermission('projects.calculations.delete')
  const [wizardMode, setWizardMode]     = useState<WizardMode>(null)
  const [search, setSearch]             = useState('')
  const [sort, setSort]                 = useState<{ col: SortCol; dir: 'asc' | 'desc' }>({ col: 'grundhonorar', dir: 'desc' })
  const [paraFilter, setParaFilter]     = useState<Set<string>>(new Set())
  const [projektFilter, setProjektFilter] = useState<Set<string>>(new Set())
  const [didInitFilter, setDidInitFilter] = useState(false)
  const [showOfferCalcs, setShowOfferCalcs] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; label: string } | null>(null)
  const [listMsg, setListMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['fee-calc-masters'],
    queryFn:  () => fetchFeeCalcMasters(),
  })
  const allRows = data?.data ?? []

  // Löschen war hier bisher gar nicht möglich — verwaiste Kalkulationen
  // (z. B. aus abgebrochenen Wizard-Läufen) ließen sich nur in der DB
  // entfernen. Fehler werden ausgegeben statt verschluckt, sonst bliebe eine
  // fehlende Berechtigung unsichtbar.
  const deleteMut = useMutation({
    mutationFn: (calcId: number) => deleteFeeCalcMaster(calcId),
    onSuccess:  () => { setListMsg(null); void refetch() },
    onError:    (e: unknown) => setListMsg({ text: `Löschen fehlgeschlagen: ${(e as Error).message}`, type: 'error' }),
  })

  // Pre-select project filter when initialProjectId is provided
  useEffect(() => {
    if (didInitFilter || !initialProjectId || allRows.length === 0) return
    const label = allRows.find(r => r.PROJECT_ID === initialProjectId)?.projectLabel
    if (label) {
      setProjektFilter(new Set([label]))
      setDidInitFilter(true)
    }
  }, [allRows, initialProjectId, didInitFilter])

  // By default hide offer-only calcs (PROJECT_ID null, OFFER_ID set); user can toggle
  const visibleRows = showOfferCalcs
    ? allRows
    : allRows.filter(r => r.PROJECT_ID != null || r.OFFER_ID == null)

  const allParas    = Array.from(new Set(visibleRows.map(r => r.ABBR).filter((s): s is string => !!s))).sort()
  const allProjekte = Array.from(new Set(visibleRows.map(r => r.projectLabel ?? r.offerLabel).filter((s): s is string => !!s))).sort()

  // Client-side search + filter
  const q = search.trim().toLowerCase()
  const filtered = visibleRows.filter(r => {
    const label = r.projectLabel ?? r.offerLabel ?? ''
    if (paraFilter.size > 0 && !(r.ABBR && paraFilter.has(r.ABBR))) return false
    if (projektFilter.size > 0 && !projektFilter.has(label)) return false
    if (!q) return true
    return (
      (r.ABBR ?? '').toLowerCase().includes(q) ||
      (r.NAME  ?? '').toLowerCase().includes(q) ||
      label.toLowerCase().includes(q)
    )
  })

  const sorted = [...filtered].sort((a, b) => {
    let va: string | number = 0
    let vb: string | number = 0
    if (sort.col === 'nameShort')    { va = a.ABBR ?? ''; vb = b.ABBR ?? '' }
    if (sort.col === 'nameLong')     { va = a.NAME  ?? ''; vb = b.NAME  ?? '' }
    if (sort.col === 'project')      { va = (a.projectLabel ?? a.offerLabel) ?? ''; vb = (b.projectLabel ?? b.offerLabel) ?? '' }
    if (sort.col === 'grundhonorar') { va = a.grundhonorar  ?? 0; vb = b.grundhonorar  ?? 0 }
    if (sort.col === 'gesamthonorar'){ va = a.gesamthonorar ?? 0; vb = b.gesamthonorar ?? 0 }
    if (typeof va === 'string') return sort.dir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va)
    return sort.dir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
  })

  function toggleSort(col: SortCol) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })
  }
  const th = (col: SortCol, label: string, className?: string) => (
    <SortTh label={label} column={col} sortKey={sort.col} dir={sort.dir} onSort={toggleSort} className={className} />
  )

  function handleDone() {
    setWizardMode(null)
    void refetch()
  }

  if (wizardMode !== null) {
    return (
      <div>
        <button type="button" className="btn-secondary hw-back" onClick={() => guarded(handleDone, [HONORAR_WIZARD_GUARD])}>
          <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" /> Zurück zur Liste
        </button>
        <HonorarWizard
          existingId={wizardMode.mode === 'edit' ? wizardMode.id : null}
          initialProjectId={initialProjectId}
          onDone={handleDone}
        />
      </div>
    )
  }

  const filterActive = !!q || paraFilter.size > 0 || projektFilter.size > 0
  const hiddenOffers = !showOfferCalcs && allRows.some(r => r.PROJECT_ID == null && r.OFFER_ID != null)

  return (
    <div>
      <div className="list-toolbar">
        <input
          type="search"
          className="list-search"
          placeholder="Suchen …"
          aria-label="Kalkulationen durchsuchen"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: '0 1 220px', minWidth: 120 }}
        />
        <FilterChip label="§" options={allParas} active={paraFilter} onChange={setParaFilter} />
        <FilterChip label="Projekt" options={allProjekte} active={projektFilter} onChange={setProjektFilter} />
        <label className="hw-toggle">
          <input type="checkbox" checked={showOfferCalcs} onChange={e => setShowOfferCalcs(e.target.checked)} />
          Angebots-Kalkulationen
        </label>
        {canEdit && (
          <button className="btn-primary btn-small hw-new" type="button" style={{ marginLeft: 'auto' }} onClick={() => setWizardMode({ mode: 'create' })}>
            <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> Neue Kalkulation
          </button>
        )}
      </div>

      {listMsg && <div style={{ marginBottom: 10 }}><Message text={listMsg.text} type={listMsg.type} /></div>}

      {isLoading && <p className="empty-note">Lade …</p>}
      {!isLoading && sorted.length === 0 && (filterActive ? (
        <p className="empty-note">Keine Kalkulation passt zu Suche und Filter.</p>
      ) : (
        <div className="empty-block">
          <p className="empty-note">Noch keine Kalkulation{initialProjectId ? ' für dieses Projekt' : ''}.</p>
          <p className="empty-block-why">
            Eine Kalkulation rechnet das Honorar nach HOAI oder AHO — aus Honorarzone, anrechenbaren Kosten und
            beauftragten Leistungsphasen — und legt die Leistungsphasen als Elemente der Projektstruktur an.
            {hiddenOffers && ' Kalkulationen, die noch an einem Angebot hängen, zeigt „Angebots-Kalkulationen".'}
          </p>
          {canEdit && (
            <button type="button" className="btn-secondary" onClick={() => setWizardMode({ mode: 'create' })}>
              <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> Erste Kalkulation anlegen
            </button>
          )}
        </div>
      ))}

      {sorted.length > 0 && (
        <div className="table-scroll">
          <table className="master-table">
            <thead>
              <tr>
                {th('nameShort', '§')}
                {th('nameLong', 'Bezeichnung')}
                {th('project', 'Projekt')}
                {th('grundhonorar', 'Grundhonorar', 'num')}
                <th scope="col" className="num">Zuschläge</th>
                {th('gesamthonorar', 'Gesamthonorar', 'num')}
                <th scope="col"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.ID}>
                  <td className="hw-abbr">{r.ABBR || '—'}</td>
                  <td>{r.NAME || '—'}</td>
                  <td>
                    {r.projectLabel
                      ? r.projectLabel
                      : r.offerLabel
                        ? <span className="hw-offer-label">Angebot {r.offerLabel}</span>
                        : '—'}
                  </td>
                  <td className="num">{money(r.grundhonorar)}</td>
                  <td className="num">{(r.zuschlaegeSum ?? 0) !== 0 ? money(r.zuschlaegeSum) : '—'}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{money(r.gesamthonorar)}</td>
                  <td>
                    <KalkulationActions
                      calc={r} canEdit={canEdit} canDelete={canDelete} deleting={deleteMut.isPending}
                      onEdit={() => setWizardMode({ mode: 'edit', id: r.ID })}
                      onDelete={() => setConfirmDelete({ id: r.ID, label: r.NAME || r.ABBR || 'Kalkulation' })}
                      onOpenProject={r.PROJECT_ID != null ? () => navigate(`/projekte?projectId=${r.PROJECT_ID}&tab=struktur`) : undefined}
                      onOpenOffer={r.OFFER_ID != null && r.PROJECT_ID == null ? () => navigate(angebotHref(r.OFFER_ID!, 'kalkulationen')) : undefined}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={confirmDelete !== null}
        title="Kalkulation löschen"
        message={`Kalkulation „${confirmDelete?.label ?? ''}" endgültig löschen? Zugehörige Leistungsphasen, Zuschläge und Besonderen Leistungen werden mitgelöscht.`}
        confirmLabel="Löschen"
        confirmClass="danger"
        onConfirm={() => { if (confirmDelete) deleteMut.mutate(confirmDelete.id); setConfirmDelete(null) }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
