import { useState } from 'react'
import { Tabs }               from '@/components/ui/Tabs'
import { AngeboteListe }      from '@/pages/angebote/AngeboteListe'
import { AngeboteAnlegen }    from '@/pages/angebote/AngeboteAnlegen'
import { AngeboteBearbeiten } from '@/pages/angebote/AngeboteBearbeiten'

type Tab = 'liste' | 'anlegen' | 'bearbeiten'

const TABS: { id: Tab; label: string }[] = [
  { id: 'liste',       label: 'Angebotsliste'  },
  { id: 'anlegen',     label: 'Anlegen'        },
  { id: 'bearbeiten',  label: 'Bearbeiten'     },
]

export function AngebotePage() {
  const [tab, setTab]             = useState<Tab>('liste')
  const [selectedOfferId, setSelectedOfferId] = useState<number | undefined>(undefined)
  const [selectedOfferName, setSelectedOfferName] = useState<string>('')

  function openOffer(id: number, name: string) {
    setSelectedOfferId(id)
    setSelectedOfferName(name)
    setTab('bearbeiten')
  }

  return (
    <div className="master-page">
      <h1 className="master-title">Angebote</h1>
      <Tabs tabs={TABS} active={tab} onChange={id => setTab(id as Tab)} />
      {tab === 'bearbeiten' && selectedOfferId && (
        <div className="project-context-strip">
          <button className="project-context-back" onClick={() => setTab('liste')}>← Angebotsliste</button>
          <span className="project-context-name">{selectedOfferName || `Angebot #${selectedOfferId}`}</span>
        </div>
      )}
      <div className="master-tab-content">
        {tab === 'liste'      && <AngeboteListe onSelectOffer={openOffer} />}
        {tab === 'anlegen'    && <AngeboteAnlegen />}
        {tab === 'bearbeiten' && <AngeboteBearbeiten initialOfferId={selectedOfferId} />}
      </div>
    </div>
  )
}
