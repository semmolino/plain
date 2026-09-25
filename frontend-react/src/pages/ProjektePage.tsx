import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Tabs }           from '@/components/ui/Tabs'
import { PageHeader }     from '@/components/ui/PageHeader'
import { DirtyGuardProvider } from '@/components/ui/DirtyGuard'
import { useGuardedAction } from '@/hooks/useDirtyGuard'
import { ProjekteListe }  from '@/pages/projekte/ProjekteListe'
import { HonorarTab }     from '@/pages/projekte/HonorarWizard'
import { ProjektStruktur } from '@/pages/projekte/ProjektStruktur'
import { Buchungen }      from '@/pages/projekte/Buchungen'
import { Leistungsstand } from '@/pages/projekte/Leistungsstand'
import { LeistungsstandRunde } from '@/pages/projekte/leistungsstand/LeistungsstandRunde'
import { Vertraege }      from '@/pages/projekte/Vertraege'
import { Mitarbeiter }    from '@/pages/projekte/Mitarbeiter'
import { Budget }          from '@/pages/projekte/Budget'
import { NachtraegeListe } from '@/pages/nachtraege/NachtraegeListe'
import { ProjektHeader }  from '@/pages/projekte/ProjektHeader'
import { ProjektTabs, type ProjektTabDef } from '@/pages/projekte/ProjektTabs'
import {
  resolveProjektView, serializeProjektView, SELECTED_PID_KEY,
  type ProjektTab, type ListTab, type ProjektView,
} from '@/pages/projekte/projektUrlState'
import { useFilterTabs, usePermissionsStore } from '@/store/permissionsStore'
import { useLicenseFilterTabs } from '@/store/licenseStore'

// Reihenfolge = Reihenfolge der Reiter. `group` trennt taegliche Arbeit von
// Einrichtung (siehe ProjektTabs).
const WORKSPACE_TABS: (ProjektTabDef & { permissions: string[]; feature?: string })[] = [
  { id: 'struktur',       label: 'Struktur',        group: 'arbeit',      permissions: ['projects.structure.view'] },
  { id: 'leistungsstand', label: 'Leistungsstände', group: 'arbeit',      permissions: ['projects.performance.view'] },
  { id: 'buchungen',      label: 'Buchungen',       group: 'arbeit',      permissions: ['projects.bookings.view'] },
  { id: 'nachtraege',     label: 'Nachträge',       group: 'arbeit',      permissions: ['nachtraege.view'], feature: 'nachtraege.management' },
  { id: 'vertraege',      label: 'Verträge',        group: 'einrichtung', permissions: ['projects.contracts.view'], feature: 'projects.contracts' },
  { id: 'honorar',        label: 'Kalkulationen',   group: 'einrichtung', permissions: ['projects.calculations.view'], feature: 'hoai.calculator' },
  { id: 'mitarbeiter',    label: 'Preislisten',     group: 'einrichtung', permissions: ['projects.hourly_rates.view'], feature: 'projects.hourly_rates' },
  { id: 'budget',         label: 'Interne Budgets', group: 'einrichtung', permissions: ['projects.budget.view'], feature: 'projects.budgets' },
]

const LIST_TABS: { id: ListTab; label: string; permissions: string[]; feature?: string }[] = [
  { id: 'liste',            label: 'Projektliste',    permissions: ['projects.view'] },
  { id: 'leistungsstaende', label: 'Leistungsstände', permissions: ['projects.performance.view'] },
  { id: 'honorar',          label: 'Kalkulationen',   permissions: ['projects.calculations.view'], feature: 'hoai.calculator' },
]

function savedPid(): number | null {
  const raw = localStorage.getItem(SELECTED_PID_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

export function ProjektePage() {
  return (
    <DirtyGuardProvider>
      <ProjektePageInner />
    </DirtyGuardProvider>
  )
}

function ProjektePageInner() {
  const location  = useLocation()
  const navigate  = useNavigate()
  const [params]  = useSearchParams()
  const guarded   = useGuardedAction()
  const permsLoaded = usePermissionsStore(s => s.loaded)

  const navState = location.state as { tab?: string; projectId?: number; search?: string } | null
  const { view, canonical } = resolveProjektView(params, navState, savedPid())
  // Suchbegriff aus Mahnungen („Projekt zu dieser Mahnung") — einmal lesen.
  const [initialSearch] = useState(() => navState?.search)

  const workspaceTabs = useLicenseFilterTabs(useFilterTabs(WORKSPACE_TABS))
  const listTabs      = useLicenseFilterTabs(useFilterTabs(LIST_TABS))

  function go(v: ProjektView, replace = false) {
    const qs = serializeProjektView(v)
    navigate({ pathname: '/projekte', search: qs ? `?${qs}` : '' }, { replace, state: null })
  }

  // URL auf ihre kanonische Form bringen (State → URL, Tab ergaenzen).
  // `replace`: das ist eine Korrektur, kein Schritt, den Zurueck rueckgaengig
  // machen sollte.
  useEffect(() => {
    if (canonical === null) return
    navigate({ pathname: '/projekte', search: canonical ? `?${canonical}` : '' }, { replace: true, state: null })
  }, [canonical]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ein Tab, den der Nutzer nicht sehen darf (oder den die Lizenz nicht
  // enthaelt), faellt auf den ersten erlaubten zurueck — erst wenn die Rechte
  // geladen sind, sonst wuerde jeder Deep-Link beim Laden umgeschrieben.
  const tabAllowed = view.view !== 'workspace' || workspaceTabs.some(t => t.id === view.tab)
  useEffect(() => {
    if (!permsLoaded || view.view !== 'workspace' || tabAllowed || !workspaceTabs.length) return
    go({ ...view, tab: workspaceTabs[0].id }, true)
  }, [permsLoaded, tabAllowed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Zuletzt geoeffnetes Projekt merken — fuer Links, die nur einen Tab nennen.
  const workspacePid = view.view === 'workspace' ? view.projectId : null
  useEffect(() => {
    if (workspacePid != null) localStorage.setItem(SELECTED_PID_KEY, String(workspacePid))
  }, [workspacePid])

  const pendingLabel = useMemo(() => {
    if (view.view !== 'list' || !view.pendingTab) return null
    return WORKSPACE_TABS.find(t => t.id === view.pendingTab)?.label ?? null
  }, [view])

  if (view.view === 'list') {
    const openProject = (id: number) => go({ view: 'workspace', projectId: id, tab: view.pendingTab ?? 'struktur' })
    return (
      <div className="master-page pw-list">
        <PageHeader title="Projekte" />
        {listTabs.length > 1 && (
          <Tabs tabs={listTabs} active={view.listTab} onChange={id => guarded(() => go({ view: 'list', listTab: id as ListTab, pendingTab: null }))} />
        )}
        {pendingLabel && (
          <p className="pw-pending-hint">Wähle ein Projekt, um „{pendingLabel}" zu öffnen.</p>
        )}
        <div className="master-tab-content">
          {view.listTab === 'liste'   && <ProjekteListe onSelectProject={openProject} onProjectCreated={id => go({ view: 'workspace', projectId: id, tab: 'struktur' })} initialSearch={initialSearch} />}
          {view.listTab === 'honorar' && <HonorarTab />}
          {view.listTab === 'leistungsstaende' && <LeistungsstandRunde />}
        </div>
      </div>
    )
  }

  const pid = view.projectId
  const setTab   = (tab: ProjektTab)  => { if (tab !== view.tab) guarded(() => go({ view: 'workspace', projectId: pid, tab })) }
  const toList   = ()                 => guarded(() => go({ view: 'list', listTab: 'liste', pendingTab: null }))
  const switchTo = (id: number)       => guarded(() => go({ view: 'workspace', projectId: id, tab: view.tab }))

  return (
    <div className="master-page pw-root">
      <ProjektHeader projectId={pid} onBack={toList} onSwitch={switchTo} />
      <ProjektTabs tabs={workspaceTabs} active={view.tab} onChange={setTab} />
      <div className="master-tab-content">
        {view.tab === 'struktur'       && <ProjektStruktur initialProjectId={pid} />}
        {view.tab === 'buchungen'      && <Buchungen       initialProjectId={pid} />}
        {view.tab === 'leistungsstand' && <Leistungsstand  initialProjectId={pid} />}
        {view.tab === 'vertraege'      && <Vertraege       initialProjectId={pid} />}
        {view.tab === 'budget'         && <Budget          initialProjectId={pid} />}
        {view.tab === 'mitarbeiter'    && <Mitarbeiter     initialProjectId={pid} />}
        {view.tab === 'honorar'        && <HonorarTab      initialProjectId={pid} />}
        {view.tab === 'nachtraege'     && <NachtraegeListe projectId={pid} />}
      </div>
    </div>
  )
}
