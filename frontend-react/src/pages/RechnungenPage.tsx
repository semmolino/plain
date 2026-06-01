import { useState, useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Tabs }                  from '@/components/ui/Tabs'
import { RechnungenListe }       from '@/pages/rechnungen/RechnungenListe'
import { AbschlagWizard }        from '@/pages/rechnungen/AbschlagWizard'
import { RechnungWizard }        from '@/pages/rechnungen/RechnungWizard'
import { SchlussrechnungWizard } from '@/pages/rechnungen/SchlussrechnungWizard'
import { MahnungenListe }        from '@/pages/rechnungen/MahnungenListe'

type Tab = 'liste' | 'abschlag' | 'rechnung' | 'schluss' | 'mahnungen'

export interface DraftResume {
  id:            number
  projectId:     number | null
  contractId:    number | null
  projectLabel:  string
  contractLabel: string
  d1Pct:         number
  d2Pct:         number
  d1Reason:      string | null
  d2Reason:      string | null
  cashDiscPct:   number
  cashDiscDays:  number
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'liste',     label: 'Rechnungsliste' },
  { id: 'abschlag',  label: 'Abschlagsrechnung' },
  { id: 'rechnung',  label: 'Rechnung' },
  { id: 'schluss',   label: 'Teilschluss-/Schlussrechnung' },
  { id: 'mahnungen', label: 'Mahnungen' },
]

export function RechnungenPage() {
  const location     = useLocation()
  const navigate     = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const navState     = location.state as {
    projectSearch?: string
    backProject?: { id: number; name: string }
    tab?: Tab
    openMahnung?: { sourceType: string; sourceId: number }
  } | null

  // Honour ?tab=mahnungen (or other tab) from query string (e.g. notification links)
  const tabFromUrl   = searchParams.get('tab') as Tab | null

  const initialTab = navState?.tab ?? tabFromUrl ?? 'liste'
  const [tab,         setTab]         = useState<Tab>(initialTab)
  const [editDraft,   setEditDraft]   = useState<{ draft: DraftResume; type: Tab } | null>(null)
  const [initSearch,  setInitSearch]  = useState<string | undefined>(navState?.projectSearch)
  const [backProject, setBackProject] = useState<{ id: number; name: string } | undefined>(navState?.backProject ?? undefined)
  const [openMahnung, setOpenMahnung] = useState<{ sourceType: string; sourceId: number } | null>(navState?.openMahnung ?? null)

  // Initial mount: clear location.state and apply initial URL tab
  useEffect(() => {
    if (location.state) {
      navigate('/rechnungen', { replace: true, state: null })
    }
    if (tabFromUrl) {
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // React to URL tab changes when already mounted (e.g. notification links clicked while on this page)
  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== tab) {
      setTab(tabFromUrl)
      setSearchParams({}, { replace: true })
    }
  }, [tabFromUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // React to navigation-state tab changes (e.g. from dashboard suggestions)
  useEffect(() => {
    if (!navState) return
    if (navState.tab && navState.tab !== tab) setTab(navState.tab)
    if (navState.openMahnung) setOpenMahnung(navState.openMahnung)
  }, [location.state]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleEditDraft(d: { id: number; projectId: number | null; contractId: number | null; projectLabel: string; contractLabel: string; wizardType: 'abschlag' | 'rechnung' | 'schluss'; d1Pct: number; d2Pct: number; d1Reason: string | null; d2Reason: string | null; cashDiscPct: number; cashDiscDays: number }) {
    const draft: DraftResume = { id: d.id, projectId: d.projectId, contractId: d.contractId, projectLabel: d.projectLabel, contractLabel: d.contractLabel, d1Pct: d.d1Pct, d2Pct: d.d2Pct, d1Reason: d.d1Reason, d2Reason: d.d2Reason, cashDiscPct: d.cashDiscPct, cashDiscDays: d.cashDiscDays }
    const type = d.wizardType as Tab
    setEditDraft({ draft, type })
    setTab(type)
  }

  function handleTabChange(id: string) {
    setTab(id as Tab)
    setEditDraft(null)
  }

  const resumeFor = (t: Tab) =>
    editDraft?.type === t ? editDraft.draft : undefined

  const wizardTabs: Tab[] = ['abschlag', 'rechnung', 'schluss']
  const showContext = wizardTabs.includes(tab) && editDraft != null

  return (
    <div className="master-page">
      <h1 className="master-title">Rechnungen</h1>
      <Tabs tabs={TABS} active={tab} onChange={handleTabChange} />
      {showContext && (
        <div className="project-context-strip">
          <button className="project-context-back" onClick={() => handleTabChange('liste')}>← Rechnungsliste</button>
          <span className="project-context-name">{editDraft!.draft.projectLabel}{editDraft!.draft.contractLabel ? ` / ${editDraft!.draft.contractLabel}` : ''}</span>
        </div>
      )}
      <div className="master-tab-content">
        {tab === 'liste'     && <RechnungenListe onEditDraft={handleEditDraft} initialSearch={initSearch} backProject={backProject} onClearBack={() => { setInitSearch(undefined); setBackProject(undefined) }} />}
        {tab === 'abschlag'  && <AbschlagWizard initialDraft={resumeFor('abschlag')} />}
        {tab === 'rechnung'  && <RechnungWizard initialDraft={resumeFor('rechnung')} />}
        {tab === 'schluss'   && <SchlussrechnungWizard initialDraft={resumeFor('schluss')} />}
        {tab === 'mahnungen' && <MahnungenListe openMahnung={openMahnung} />}
      </div>
    </div>
  )
}
