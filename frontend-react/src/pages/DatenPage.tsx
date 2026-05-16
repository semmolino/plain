import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs }             from '@/components/ui/Tabs'
import { ProjektlisteTab }  from '@/pages/daten/ProjektlisteTab'
import { EinzelprojektTab } from '@/pages/daten/EinzelprojektTab'

type Tab = 'projektliste' | 'einzelprojekt'

const TABS: { id: Tab; label: string }[] = [
  { id: 'projektliste',  label: 'Alle Projekte' },
  { id: 'einzelprojekt', label: 'Projekt'        },
]

export function DatenPage() {
  const location  = useLocation()
  const navigate  = useNavigate()
  const navState  = location.state as { tab?: Tab; projectId?: number } | null

  const [tab,        setTab]        = useState<Tab>(navState?.tab ?? 'projektliste')
  const [initProjId, setInitProjId] = useState<number | undefined>(navState?.projectId)

  useEffect(() => {
    if (location.state) {
      navigate('/daten', { replace: true, state: null })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleTabChange(id: string) {
    setTab(id as Tab)
    if (id !== 'einzelprojekt') setInitProjId(undefined)
  }

  return (
    <div className="master-page">
      <h1 className="master-title">Projektdaten</h1>
      <Tabs tabs={TABS} active={tab} onChange={handleTabChange} />
      <div className="master-tab-content">
        {tab === 'projektliste'  && <ProjektlisteTab />}
        {tab === 'einzelprojekt' && <EinzelprojektTab initialProjectId={initProjId} />}
      </div>
    </div>
  )
}
