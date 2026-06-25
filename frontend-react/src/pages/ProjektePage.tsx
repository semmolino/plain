import { useState, useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery }       from '@tanstack/react-query'
import { Tabs }           from '@/components/ui/Tabs'
import { ProjekteListe }  from '@/pages/projekte/ProjekteListe'
import { ProjekteAnlegen } from '@/pages/projekte/ProjekteAnlegen'
import { HonorarTab }     from '@/pages/projekte/HonorarWizard'
import { ProjektStruktur } from '@/pages/projekte/ProjektStruktur'
import { Buchungen }      from '@/pages/projekte/Buchungen'
import { Leistungsstand } from '@/pages/projekte/Leistungsstand'
import { Vertraege }      from '@/pages/projekte/Vertraege'
import { Mitarbeiter }    from '@/pages/projekte/Mitarbeiter'
import { Budget }          from '@/pages/projekte/Budget'
import { fetchProjectReportHeader } from '@/api/reports'
import { useFilterTabs } from '@/store/permissionsStore'
import { useLicenseFilterTabs } from '@/store/licenseStore'

type Tab = 'liste' | 'anlegen' | 'struktur' | 'leistungsstand' | 'buchungen' | 'budget' | 'mitarbeiter' | 'honorar' | 'vertraege'

const TABS: { id: Tab; label: string; permissions: string[]; feature?: string }[] = [
  { id: 'liste',           label: 'Liste',           permissions: ['projects.view'] },
  { id: 'anlegen',         label: 'Anlegen',         permissions: ['projects.create'] },
  { id: 'struktur',        label: 'Projektstruktur', permissions: ['projects.structure.view'] },
  { id: 'leistungsstand',  label: 'Leistungsstände', permissions: ['projects.performance.view'] },
  { id: 'buchungen',       label: 'Buchungen',       permissions: ['projects.bookings.view'] },
  { id: 'budget',          label: 'Interne Budgets', permissions: ['projects.budget.view'], feature: 'projects.budgets' },
  { id: 'mitarbeiter',     label: 'Preislisten',     permissions: ['projects.hourly_rates.view'], feature: 'projects.hourly_rates' },
  { id: 'honorar',         label: 'Kalkulationen',   permissions: ['projects.calculations.view'], feature: 'hoai.calculator' },
  { id: 'vertraege',       label: 'Verträge',        permissions: ['projects.contracts.view'], feature: 'projects.contracts' },
]

const VALID_TABS: Tab[] = ['liste','anlegen','struktur','leistungsstand','buchungen','budget','mitarbeiter','honorar','vertraege']
function parseTab(s: string | null): Tab | null {
  return s && (VALID_TABS as string[]).includes(s) ? (s as Tab) : null
}

export function ProjektePage() {
  const location = useLocation()
  const navigate  = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Query-Parameter haben Vorrang vor location.state (notification deep links
  // funktionieren so out of the box: /projekte?tab=leistungsstand&projectId=42)
  const tabFromUrl   = parseTab(searchParams.get('tab'))
  const pidFromUrl   = (() => {
    const raw = searchParams.get('projectId')
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) ? n : null
  })()

  const [tab, setTab] = useState<Tab>(() => {
    if (tabFromUrl) return tabFromUrl
    const s = location.state as { tab?: Tab } | null
    return s?.tab ?? 'liste'
  })
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(() => {
    if (pidFromUrl != null) return pidFromUrl
    const s = location.state as { projectId?: number } | null
    if (s?.projectId) return s.projectId
    const saved = localStorage.getItem('projekte-selected-pid')
    return saved ? Number(saved) : undefined
  })

  function persistProjectId(id: number | undefined) {
    setSelectedProjectId(id)
    if (id != null) localStorage.setItem('projekte-selected-pid', String(id))
    else localStorage.removeItem('projekte-selected-pid')
  }

  // Apply navigation state (handles both initial mount and subsequent same-route navigations)
  useEffect(() => {
    const state = location.state as { tab?: Tab; projectId?: number } | null
    if (!state) return
    if (state.tab) setTab(state.tab)
    if (state.projectId != null) persistProjectId(state.projectId)
    navigate('/projekte', { replace: true, state: null })
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // URL-Query-Parameter anwenden — sowohl beim Mount als auch wenn der
  // Nutzer schon auf /projekte ist und ueber eine Notification ein
  // weiteres Mal hierher navigiert (URL aendert sich, Komponente bleibt
  // gemountet). Danach URL bereinigen, damit nachfolgende Tab-Wechsel
  // nicht gegen die alte URL kaempfen.
  useEffect(() => {
    if (!tabFromUrl && pidFromUrl == null) return
    if (tabFromUrl) setTab(tabFromUrl)
    if (pidFromUrl != null) persistProjectId(pidFromUrl)
    setSearchParams({}, { replace: true })
  }, [tabFromUrl, pidFromUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: projectHeader } = useQuery({
    queryKey: ['project-header-name', selectedProjectId],
    queryFn:  () => fetchProjectReportHeader(selectedProjectId!),
    enabled:  selectedProjectId != null && tab !== 'liste',
  })

  function openProject(id: number) {
    persistProjectId(id)
    setTab('struktur')
  }

  function onProjectChange(id: number | null) {
    persistProjectId(id ?? undefined)
  }

  const visibleTabs = useLicenseFilterTabs(useFilterTabs(TABS))

  return (
    <div className="master-page">
      <h1 className="master-title">Projekte</h1>
      <Tabs
        tabs={visibleTabs}
        active={tab}
        onChange={id => setTab(id as Tab)}
      />
      {selectedProjectId && tab !== 'liste' && (
        <div className="project-context-strip">
          <button className="project-context-back" onClick={() => { setTab('liste'); persistProjectId(undefined) }}>
            ← Alle Projekte
          </button>
          <span className="project-context-name">
            {projectHeader?.data?.NAME_SHORT ?? `#${selectedProjectId}`}
          </span>
        </div>
      )}
      <div className="master-tab-content">
        {tab === 'liste'          && <ProjekteListe onSelectProject={openProject} />}
        {tab === 'anlegen'        && <ProjekteAnlegen onProjectCreated={id => { persistProjectId(id); setTab('struktur') }} />}
        {tab === 'honorar'        && <HonorarTab initialProjectId={selectedProjectId} />}
        {tab === 'struktur'       && <ProjektStruktur initialProjectId={selectedProjectId} onProjectChange={onProjectChange} />}
        {tab === 'buchungen'      && <Buchungen initialProjectId={selectedProjectId} onProjectChange={onProjectChange} />}
        {tab === 'leistungsstand' && <Leistungsstand initialProjectId={selectedProjectId} onProjectChange={onProjectChange} />}
        {tab === 'vertraege'      && <Vertraege      initialProjectId={selectedProjectId} onProjectChange={onProjectChange} />}
        {tab === 'budget'         && <Budget         initialProjectId={selectedProjectId} onProjectChange={onProjectChange} />}
        {tab === 'mitarbeiter'    && <Mitarbeiter    initialProjectId={selectedProjectId} onProjectChange={onProjectChange} />}
      </div>
    </div>
  )
}
