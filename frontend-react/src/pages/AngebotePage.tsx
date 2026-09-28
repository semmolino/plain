import { useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Tabs }                 from '@/components/ui/Tabs'
import { PageHeader }           from '@/components/ui/PageHeader'
import { AngeboteListe }        from '@/pages/angebote/AngeboteListe'
import { AngeboteStammdaten }   from '@/pages/angebote/AngeboteStammdaten'
import { AngeboteStruktur }     from '@/pages/angebote/AngeboteStruktur'
import { AngeboteHoai }         from '@/pages/angebote/AngeboteHoai'
import { AngebotHeader }        from '@/pages/angebote/AngebotHeader'
import {
  resolveAngebotView, serializeAngebotView,
  type AngebotTab, type AngebotView,
} from '@/pages/angebote/angebotUrlState'
import { useFilterTabs, usePermissionsStore } from '@/store/permissionsStore'
import { useLicenseFilterTabs } from '@/store/licenseStore'
import { DirtyGuardProvider }   from '@/components/ui/DirtyGuard'
import { useGuardedAction }     from '@/hooks/useDirtyGuard'

// Reiter des Arbeitsbereichs. Rechte wie bisher: die Struktur und die
// Angebotsdaten brauchten schon als Modul-Reiter bzw. Dialog offers.edit.
const WORKSPACE_TABS: { id: AngebotTab; label: string; permissions: string[]; feature?: string }[] = [
  { id: 'struktur',      label: 'Struktur',       permissions: ['offers.edit'] },
  { id: 'kalkulationen', label: 'Kalkulationen',  permissions: ['projects.calculations.view'], feature: 'hoai.calculator' },
  { id: 'daten',         label: 'Angebotsdaten',  permissions: ['offers.edit'] },
]

/**
 * Angebote als Arbeitsbereich (UI-Pilot, nach Runde 3) — wie die Projekte:
 * die Liste ist die Startseite, ein Angebot oeffnet sich mit eigenem Kopf
 * und Reitern, der Zustand steht in der URL (angebotUrlState.ts).
 *
 * Vorher waren „Angebotsliste", „Angebotsstruktur" und „Kalkulationen"
 * gleichrangige Modul-Reiter; welches Angebot die Struktur zeigte, stand im
 * localStorage, und die Angebotsdaten bearbeitete man in einem Dialog ueber
 * der Liste.
 */
export function AngebotePage() {
  // Die Angebotsstruktur meldet offene Eingaben beim Guard — Reiter- und
  // Angebotswechsel, Seitennavigation und Browser-Zurueck fragen dann nach.
  return <DirtyGuardProvider><AngeboteSeite /></DirtyGuardProvider>
}

function AngeboteSeite() {
  const guarded  = useGuardedAction()
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const permsLoaded = usePermissionsStore(s => s.loaded)

  const navState = location.state as { tab?: string; offerId?: number } | null
  const { view, canonical } = resolveAngebotView(params, navState)
  const tabs = useLicenseFilterTabs(useFilterTabs(WORKSPACE_TABS))

  function go(v: AngebotView, replace = false) {
    const qs = serializeAngebotView(v)
    navigate({ pathname: '/angebote', search: qs ? `?${qs}` : '' }, { replace, state: null })
  }

  // URL auf ihre kanonische Form bringen (State → URL) — als Korrektur, nicht
  // als neuer Schritt im Verlauf.
  useEffect(() => {
    if (canonical === null) return
    navigate({ pathname: '/angebote', search: canonical ? `?${canonical}` : '' }, { replace: true, state: null })
  }, [canonical]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ein nicht erlaubter Reiter faellt auf den ersten erlaubten zurueck — erst
  // wenn die Rechte geladen sind, sonst wuerde jeder Link beim Laden umgebogen.
  const tabAllowed = view.view !== 'workspace' || tabs.some(t => t.id === view.tab)
  useEffect(() => {
    if (!permsLoaded || view.view !== 'workspace' || tabAllowed || !tabs.length) return
    go({ ...view, tab: tabs[0].id }, true)
  }, [permsLoaded, tabAllowed]) // eslint-disable-line react-hooks/exhaustive-deps

  if (view.view === 'list') {
    const open = (id: number, tab: AngebotTab = 'struktur') => go({ view: 'workspace', offerId: id, tab })
    return (
      <div className="master-page">
        <PageHeader title="Angebote" srTitle />
        <div className="master-tab-content">
          <AngeboteListe
            onSelectOffer={id => open(id)}
            onEditStammdaten={id => open(id, 'daten')}
            onOfferCreated={id => open(id)}
          />
        </div>
      </div>
    )
  }

  const oid = view.offerId
  const setTab   = (tab: AngebotTab) => { if (tab !== view.tab) guarded(() => go({ view: 'workspace', offerId: oid, tab })) }
  const toList   = () => guarded(() => go({ view: 'list' }))
  const switchTo = (id: number) => guarded(() => go({ view: 'workspace', offerId: id, tab: view.tab }))

  return (
    <div className="master-page pw-root">
      <AngebotHeader offerId={oid} onBack={toList} onSwitch={switchTo}
        onEditData={() => setTab('daten')} onDeleted={() => go({ view: 'list' }, true)} />
      {tabs.length > 1 && <Tabs tabs={tabs} active={view.tab} onChange={id => setTab(id as AngebotTab)} />}
      <div className="master-tab-content">
        {view.tab === 'struktur'      && <AngeboteStruktur initialOfferId={oid} />}
        {view.tab === 'kalkulationen' && <AngeboteHoai initialOfferId={oid} />}
        {view.tab === 'daten'         && <AngeboteStammdaten key={oid} initialOfferId={oid} hideActions />}
      </div>
    </div>
  )
}
