import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Tabs }                 from '@/components/ui/Tabs'
import { Modal }                from '@/components/ui/Modal'
import { AngeboteListe }        from '@/pages/angebote/AngeboteListe'
import { AngeboteAnlegen }      from '@/pages/angebote/AngeboteAnlegen'
import { AngeboteStammdaten }   from '@/pages/angebote/AngeboteStammdaten'
import { AngeboteStruktur }     from '@/pages/angebote/AngeboteStruktur'
import { AngeboteHoai }         from '@/pages/angebote/AngeboteHoai'
import { fetchOffer }           from '@/api/angebote'
import { useFilterTabs }        from '@/store/permissionsStore'

type Tab = 'liste' | 'anlegen' | 'struktur' | 'hoai'

const TABS: { id: Tab; label: string; permissions: string[] }[] = [
  { id: 'liste',      label: 'Angebotsliste',   permissions: ['offers.view'] },
  { id: 'anlegen',    label: 'Anlegen',         permissions: ['offers.create'] },
  { id: 'struktur',   label: 'Angebotsstruktur',permissions: ['offers.edit'] },
  { id: 'hoai',       label: 'HOAI',            permissions: ['projects.calculations.view'] },
]

const STORAGE_KEY = 'angebote-selected-oid'

export function AngebotePage() {
  const location = useLocation()
  const navigate  = useNavigate()

  const [tab, setTab] = useState<Tab>(() => {
    const s = location.state as { tab?: Tab } | null
    return s?.tab ?? 'liste'
  })

  const [selectedOfferId, setSelectedOfferId] = useState<number | undefined>(() => {
    const s = location.state as { offerId?: number } | null
    if (s?.offerId) return s.offerId
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? Number(saved) : undefined
  })

  function persistOfferId(id: number | undefined) {
    setSelectedOfferId(id)
    if (id != null) localStorage.setItem(STORAGE_KEY, String(id))
    else localStorage.removeItem(STORAGE_KEY)
  }

  useEffect(() => {
    const state = location.state as { tab?: Tab; offerId?: number } | null
    if (!state) return
    if (state.tab)              setTab(state.tab)
    if (state.offerId != null)  persistOfferId(state.offerId)
    navigate('/angebote', { replace: true, state: null })
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: offerData } = useQuery({
    queryKey: ['offer', selectedOfferId],
    queryFn:  () => fetchOffer(selectedOfferId!),
    enabled:  selectedOfferId != null && tab !== 'liste',
  })

  function openOffer(id: number) {
    persistOfferId(id)
    setTab('struktur')
  }

  function onOfferChange(id: number | null) {
    persistOfferId(id ?? undefined)
  }

  const offerName = offerData?.data?.NAME_SHORT ?? (selectedOfferId ? `#${selectedOfferId}` : '')

  const [editStammdatenId, setEditStammdatenId] = useState<number | null>(null)

  return (
    <div className="master-page">
      <h1 className="master-title">Angebote</h1>
      <Tabs tabs={useFilterTabs(TABS)} active={tab} onChange={id => setTab(id as Tab)} />

      {selectedOfferId && tab !== 'liste' && (
        <div className="project-context-strip">
          <button className="project-context-back" onClick={() => { setTab('liste'); persistOfferId(undefined) }}>
            ← Angebotsliste
          </button>
          <span className="project-context-name">{offerName}</span>
        </div>
      )}

      <div className="master-tab-content">
        {tab === 'liste'      && <AngeboteListe onSelectOffer={openOffer} onEditStammdaten={id => setEditStammdatenId(id)} />}
        {tab === 'anlegen'    && <AngeboteAnlegen onOfferCreated={id => { persistOfferId(id); setTab('struktur') }} />}
        {tab === 'struktur'   && <AngeboteStruktur   initialOfferId={selectedOfferId} onOfferChange={onOfferChange} />}
        {tab === 'hoai'       && <AngeboteHoai       initialOfferId={selectedOfferId} />}
      </div>

      <Modal open={editStammdatenId !== null} onClose={() => setEditStammdatenId(null)} title="Angebot bearbeiten" className="modal-xl">
        {editStammdatenId !== null && <AngeboteStammdaten initialOfferId={editStammdatenId} />}
      </Modal>
    </div>
  )
}
