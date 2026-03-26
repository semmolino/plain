import { useState } from 'react'
import { Tabs }                  from '@/components/ui/Tabs'
import { RechnungenListe }       from '@/pages/rechnungen/RechnungenListe'
import { AbschlagWizard }        from '@/pages/rechnungen/AbschlagWizard'
import { RechnungWizard }        from '@/pages/rechnungen/RechnungWizard'
import { SchlussrechnungWizard } from '@/pages/rechnungen/SchlussrechnungWizard'

type Tab = 'liste' | 'abschlag' | 'rechnung' | 'schluss'

const TABS: { id: Tab; label: string }[] = [
  { id: 'liste',    label: 'Liste' },
  { id: 'abschlag', label: 'Abschlagsrechnung' },
  { id: 'rechnung', label: 'Rechnung' },
  { id: 'schluss',  label: 'Schlussrechnung' },
]

export function RechnungenPage() {
  const [tab, setTab] = useState<Tab>('liste')

  return (
    <div className="master-page">
      <h1 className="master-title">Rechnungen</h1>
      <Tabs tabs={TABS} active={tab} onChange={id => setTab(id as Tab)} />
      <div className="master-tab-content">
        {tab === 'liste'    && <RechnungenListe />}
        {tab === 'abschlag' && <AbschlagWizard />}
        {tab === 'rechnung' && <RechnungWizard />}
        {tab === 'schluss'  && <SchlussrechnungWizard />}
      </div>
    </div>
  )
}
