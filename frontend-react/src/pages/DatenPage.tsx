import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs }                        from '@/components/ui/Tabs'
import { ProjektlisteTab }             from '@/pages/daten/ProjektlisteTab'
import { EinzelprojektTab }            from '@/pages/daten/EinzelprojektTab'
import { UnternehmenskennzahlenTab }   from '@/pages/daten/UnternehmenskennzahlenTab'
import { TrendsTab }                   from '@/pages/daten/TrendsTab'
import { LeistungsphasenMatrixTab }    from '@/pages/daten/LeistungsphasenMatrixTab'
import { TeilfertigeLeistungenTab }    from '@/pages/daten/TeilfertigeLeistungenTab'
import { useLicenseFilterTabs }        from '@/store/licenseStore'
import { useFilterTabs }               from '@/store/permissionsStore'

type Tab = 'projektliste' | 'einzelprojekt' | 'leistungsphasen' | 'teilfertig' | 'kennzahlen' | 'trends'

const TABS: { id: Tab; label: string; feature?: string; permissions?: string[] }[] = [
  { id: 'projektliste',    label: 'Alle Projekte'          },
  { id: 'einzelprojekt',   label: 'Projekt'                },
  { id: 'leistungsphasen', label: 'Leistungsphasen',        feature: 'reports.advanced' },
  { id: 'teilfertig',      label: 'Teilfertige Leistungen', feature: 'reports.advanced', permissions: ['reports.wip.view'] },
  { id: 'kennzahlen',      label: 'Unternehmenskennzahlen', feature: 'reports.advanced' },
  { id: 'trends',          label: 'Trends',                 feature: 'reports.advanced' },
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
      <Tabs tabs={useLicenseFilterTabs(useFilterTabs(TABS))} active={tab} onChange={handleTabChange} />
      <div className="master-tab-content">
        {tab === 'projektliste'    && <ProjektlisteTab />}
        {tab === 'einzelprojekt'   && <EinzelprojektTab initialProjectId={initProjId} />}
        {tab === 'leistungsphasen' && <LeistungsphasenMatrixTab />}
        {tab === 'teilfertig'      && <TeilfertigeLeistungenTab />}
        {tab === 'kennzahlen'      && <UnternehmenskennzahlenTab />}
        {tab === 'trends'          && <TrendsTab />}
      </div>
    </div>
  )
}
