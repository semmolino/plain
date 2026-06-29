import { useState, useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery }       from '@tanstack/react-query'
import { Tabs }           from '@/components/ui/Tabs'
import { ProjekteListe }  from '@/pages/projekte/ProjekteListe'
import { HonorarTab }     from '@/pages/projekte/HonorarWizard'
import { ProjektStruktur } from '@/pages/projekte/ProjektStruktur'
import { Buchungen }      from '@/pages/projekte/Buchungen'
import { Leistungsstand } from '@/pages/projekte/Leistungsstand'
import { Vertraege }      from '@/pages/projekte/Vertraege'
import { Mitarbeiter }    from '@/pages/projekte/Mitarbeiter'
import { Budget }          from '@/pages/projekte/Budget'
import { ProjectPicker }  from '@/components/projekte/ProjectPicker'
import { fetchProjectsShort } from '@/api/projekte'
import { useFilterTabs } from '@/store/permissionsStore'
import { useLicenseFilterTabs } from '@/store/licenseStore'

type Tab = 'liste' | 'struktur' | 'leistungsstand' | 'buchungen' | 'budget' | 'mitarbeiter' | 'honorar' | 'vertraege'

const TABS: { id: Tab; label: string; permissions: string[]; feature?: string }[] = [
  { id: 'liste',           label: 'Liste',           permissions: ['projects.view'] },
  { id: 'struktur',        label: 'Projektstruktur', permissions: ['projects.structure.view'] },
  { id: 'leistungsstand',  label: 'Leistungsstände', permissions: ['projects.performance.view'] },
  { id: 'buchungen',       label: 'Buchungen',       permissions: ['projects.bookings.view'] },
  { id: 'budget',          label: 'Interne Budgets', permissions: ['projects.budget.view'], feature: 'projects.budgets' },
  { id: 'mitarbeiter',     label: 'Preislisten',     permissions: ['projects.hourly_rates.view'], feature: 'projects.hourly_rates' },
  { id: 'honorar',         label: 'Kalkulationen',   permissions: ['projects.calculations.view'], feature: 'hoai.calculator' },
  { id: 'vertraege',       label: 'Verträge',        permissions: ['projects.contracts.view'], feature: 'projects.contracts' },
]

const VALID_TABS: Tab[] = ['liste','struktur','leistungsstand','buchungen','budget','mitarbeiter','honorar','vertraege']
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

  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const projects = projectsData?.data ?? []

  function openProject(id: number) {
    persistProjectId(id)
    setTab('struktur')
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
      {tab !== 'liste' && tab !== 'honorar' && (
        <div className="project-context-strip">
          <button className="project-context-back" onClick={() => { setTab('liste'); persistProjectId(undefined) }}>
            ← Alle Projekte
          </button>
          <ProjectPicker
            projects={projects}
            selectedId={selectedProjectId ?? null}
            onSelect={id => persistProjectId(id)}
            onGoToList={() => setTab('liste')}
          />
        </div>
      )}
      <div className="master-tab-content">
        {tab === 'liste'          && <ProjekteListe onSelectProject={openProject} onProjectCreated={id => { persistProjectId(id); setTab('struktur') }} />}
        {tab === 'honorar'        && <HonorarTab initialProjectId={selectedProjectId} />}
        {tab === 'struktur'       && <ProjektStruktur initialProjectId={selectedProjectId} />}
        {tab === 'buchungen'      && <Buchungen initialProjectId={selectedProjectId} />}
        {tab === 'leistungsstand' && <Leistungsstand initialProjectId={selectedProjectId} />}
        {tab === 'vertraege'      && <Vertraege      initialProjectId={selectedProjectId} />}
        {tab === 'budget'         && <Budget         initialProjectId={selectedProjectId} />}
        {tab === 'mitarbeiter'    && <Mitarbeiter    initialProjectId={selectedProjectId} />}
      </div>
    </div>
  )
}
