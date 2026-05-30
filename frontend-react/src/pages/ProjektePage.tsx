import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs }           from '@/components/ui/Tabs'
import { ProjekteListe }  from '@/pages/projekte/ProjekteListe'
import { ProjekteAnlegen } from '@/pages/projekte/ProjekteAnlegen'
import { HonorarTab }     from '@/pages/projekte/HonorarWizard'
import { ProjektStruktur } from '@/pages/projekte/ProjektStruktur'
import { Buchungen }      from '@/pages/projekte/Buchungen'
import { Leistungsstand } from '@/pages/projekte/Leistungsstand'
import { Vertraege }      from '@/pages/projekte/Vertraege'
import { Mitarbeiter }    from '@/pages/projekte/Mitarbeiter'

type Tab = 'liste' | 'anlegen' | 'honorar' | 'struktur' | 'buchungen' | 'leistungsstand' | 'vertraege' | 'mitarbeiter'

const TABS: { id: Tab; label: string }[] = [
  { id: 'liste',           label: 'Liste' },
  { id: 'anlegen',         label: 'Anlegen' },
  { id: 'honorar',         label: 'Honorar (HOAI)' },
  { id: 'struktur',        label: 'Struktur' },
  { id: 'buchungen',       label: 'Buchungen' },
  { id: 'leistungsstand',  label: 'Leistungsstände' },
  { id: 'vertraege',       label: 'Verträge' },
  { id: 'mitarbeiter',     label: 'Mitarbeiter' },
]

export function ProjektePage() {
  const location = useLocation()
  const navigate  = useNavigate()
  const navState  = location.state as { tab?: Tab; projectId?: number } | null

  const [tab, setTab] = useState<Tab>(navState?.tab ?? 'liste')
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(navState?.projectId)

  // Clear navigation state so back/forward doesn't re-apply it
  useEffect(() => {
    if (location.state) {
      navigate('/projekte', { replace: true, state: null })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openProject(id: number) {
    setSelectedProjectId(id)
    setTab('struktur')
  }

  function onProjectChange(id: number | null) {
    setSelectedProjectId(id ?? undefined)
  }

  return (
    <div className="master-page">
      <h1 className="master-title">Projekte</h1>
      <Tabs
        tabs={TABS}
        active={tab}
        onChange={id => setTab(id as Tab)}
      />
      <div className="master-tab-content">
        {tab === 'liste'          && <ProjekteListe onSelectProject={openProject} />}
        {tab === 'anlegen'        && <ProjekteAnlegen />}
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
