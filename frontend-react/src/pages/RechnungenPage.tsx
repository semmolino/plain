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
  const navState     = location.state as { projectSearch?: string; backProject?: { id: number; name: string } } | null

  // Honour ?tab=mahnungen (or other tab) from query string (e.g. notification links)
  const tabFromUrl   = searchParams.get('tab') as Tab | null

  const [tab,         setTab]         = useState<Tab>(tabFromUrl ?? 'liste')
  const [editDraft,   setEditDraft]   = useState<{ draft: DraftResume; type: Tab } | null>(null)
  const [initSearch,  setInitSearch]  = useState<string | undefined>(navState?.projectSearch)
  const [backProject, setBackProject] = useState<{ id: number; name: string } | undefined>(navState?.backProject ?? undefined)

  useEffect(() => {
    if (location.state) {
      navigate('/rechnungen', { replace: true, state: null })
    }
    // Clear the ?tab param from URL once applied
    if (tabFromUrl) {
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div className="master-page">
      <h1 className="master-title">Rechnungen</h1>
      <Tabs tabs={TABS} active={tab} onChange={handleTabChange} />
      <div className="master-tab-content">
        {tab === 'liste'     && <RechnungenListe onEditDraft={handleEditDraft} initialSearch={initSearch} backProject={backProject} onClearBack={() => { setInitSearch(undefined); setBackProject(undefined) }} />}
        {tab === 'abschlag'  && <AbschlagWizard initialDraft={resumeFor('abschlag')} />}
        {tab === 'rechnung'  && <RechnungWizard initialDraft={resumeFor('rechnung')} />}
        {tab === 'schluss'   && <SchlussrechnungWizard initialDraft={resumeFor('schluss')} />}
        {tab === 'mahnungen' && <MahnungenListe />}
      </div>
    </div>
  )
}
