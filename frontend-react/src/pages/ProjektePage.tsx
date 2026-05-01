import { useState } from 'react'
import { Tabs }           from '@/components/ui/Tabs'
import { ProjekteListe }  from '@/pages/projekte/ProjekteListe'
import { ProjekteAnlegen } from '@/pages/projekte/ProjekteAnlegen'
import { HonorarWizard }  from '@/pages/projekte/HonorarWizard'
import { ProjektStruktur } from '@/pages/projekte/ProjektStruktur'
import { Buchungen }      from '@/pages/projekte/Buchungen'
import { Leistungsstand } from '@/pages/projekte/Leistungsstand'
import { Vertraege }      from '@/pages/projekte/Vertraege'

type Tab = 'liste' | 'anlegen' | 'honorar' | 'struktur' | 'buchungen' | 'leistungsstand' | 'vertraege'

const TABS: { id: Tab; label: string }[] = [
  { id: 'liste',           label: 'Liste' },
  { id: 'anlegen',         label: 'Anlegen' },
  { id: 'honorar',         label: 'Honorar (HOAI)' },
  { id: 'struktur',        label: 'Struktur' },
  { id: 'buchungen',       label: 'Buchungen' },
  { id: 'leistungsstand',  label: 'Leistungsstände' },
  { id: 'vertraege',       label: 'Verträge' },
]

export function ProjektePage() {
  const [tab, setTab] = useState<Tab>('liste')
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(undefined)

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
        {tab === 'honorar'        && <HonorarWizard />}
        {tab === 'struktur'       && <ProjektStruktur initialProjectId={selectedProjectId} />}
        {tab === 'buchungen'      && <Buchungen initialProjectId={selectedProjectId} onProjectChange={onProjectChange} />}
        {tab === 'leistungsstand' && <Leistungsstand initialProjectId={selectedProjectId} onProjectChange={onProjectChange} />}
        {tab === 'vertraege'      && <Vertraege      initialProjectId={selectedProjectId} onProjectChange={onProjectChange} />}
      </div>
    </div>
  )
}
