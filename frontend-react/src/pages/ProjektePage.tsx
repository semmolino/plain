import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { fetchProjectReportHeader } from '@/api/reports'

type Tab = 'liste' | 'anlegen' | 'honorar' | 'struktur' | 'buchungen' | 'leistungsstand' | 'vertraege' | 'mitarbeiter'

const TABS: { id: Tab; label: string }[] = [
  { id: 'liste',           label: 'Liste' },
  { id: 'anlegen',         label: 'Anlegen' },
  { id: 'honorar',         label: 'Honorar (HOAI)' },
  { id: 'struktur',        label: 'Projektstruktur' },
  { id: 'buchungen',       label: 'Buchungen' },
  { id: 'leistungsstand',  label: 'Leistungsstände' },
  { id: 'vertraege',       label: 'Verträge' },
  { id: 'mitarbeiter',     label: 'Mitarbeiter' },
]

export function ProjektePage() {
  const location = useLocation()
  const navigate  = useNavigate()
  const [tab, setTab] = useState<Tab>(() => {
    const s = location.state as { tab?: Tab } | null
    return s?.tab ?? 'liste'
  })
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(() => {
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

  return (
    <div className="master-page">
      <h1 className="master-title">Projekte</h1>
      <Tabs
        tabs={TABS}
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
        {tab === 'mitarbeiter'    && <Mitarbeiter    initialProjectId={selectedProjectId} onProjectChange={onProjectChange} />}
      </div>
    </div>
  )
}
