import { useState } from 'react'
import { Tabs }             from '@/components/ui/Tabs'
import { ProjektlisteTab }  from '@/pages/daten/ProjektlisteTab'
import { EinzelprojektTab } from '@/pages/daten/EinzelprojektTab'

type Tab = 'projektliste' | 'einzelprojekt'

const TABS: { id: Tab; label: string }[] = [
  { id: 'projektliste',  label: 'Alle Projekte'  },
  { id: 'einzelprojekt', label: 'Einzelprojekt'  },
]

export function DatenPage() {
  const [tab, setTab] = useState<Tab>('projektliste')

  return (
    <div className="master-page">
      <h1 className="master-title">Projektdaten</h1>
      <Tabs tabs={TABS} active={tab} onChange={id => setTab(id as Tab)} />
      <div className="master-tab-content">
        {tab === 'projektliste'  && <ProjektlisteTab />}
        {tab === 'einzelprojekt' && <EinzelprojektTab />}
      </div>
    </div>
  )
}
