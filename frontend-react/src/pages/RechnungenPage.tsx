import { useState, useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Tabs }                  from '@/components/ui/Tabs'
import { PageHeader }            from '@/components/ui/PageHeader'
import { NewInvoiceMenu }        from '@/components/rechnungen/NewInvoiceMenu'
import { useInvoiceKinds, type InvoiceKind } from '@/components/rechnungen/invoiceKinds'
import { RechnungenListe }       from '@/pages/rechnungen/RechnungenListe'
import { InvoiceWizard }         from '@/pages/rechnungen/InvoiceWizard'
import { SchlussrechnungWizard } from '@/pages/rechnungen/SchlussrechnungWizard'
import { MahnungenListe }        from '@/pages/rechnungen/MahnungenListe'
import { Sicherheitseinbehalte } from '@/pages/projekte/Sicherheitseinbehalte'
import { fetchProjectsShort }    from '@/api/projekte'
import { useFilterTabs } from '@/store/permissionsStore'
import { useLicenseFilterTabs } from '@/store/licenseStore'
import { DirtyGuardProvider } from '@/components/ui/DirtyGuard'
import { useGuardedAction } from '@/hooks/useDirtyGuard'

type ListTab = 'liste' | 'mahnungen' | 'se'
type Tab = ListTab | InvoiceKind

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

// Vorher sieben Tabs, vier davon Assistenten. Anlegen ist jetzt eine Aktion
// im Seitenkopf („+ Neue Rechnung"), die Tabs sind nur noch Ansichten.
const LIST_TABS: { id: ListTab; label: string; permissions: string[]; feature?: string }[] = [
  { id: 'liste',      label: 'Rechnungsliste',              permissions: ['invoices.view'] },
  { id: 'mahnungen',  label: 'Mahnungen',                   permissions: ['dunning.view'], feature: 'dunning.basic' },
  { id: 'se',         label: 'Sicherheitseinbehalte',       permissions: ['security_retention.view'], feature: 'invoices.security_retention' },
]
const KIND_IDS: readonly string[] = ['abschlag', 'rechnung', 'schluss', 'gutschrift']

const WIZARD_TITLE: Record<InvoiceKind, [neu: string, entwurf: string]> = {
  abschlag:   ['Neue Abschlagsrechnung',             'Abschlagsrechnung (Entwurf) bearbeiten'],
  rechnung:   ['Neue Einzelrechnung',                'Einzelrechnung (Entwurf) bearbeiten'],
  schluss:    ['Neue Teilschluss-/Schlussrechnung',  'Schlussrechnung (Entwurf) bearbeiten'],
  gutschrift: ['Neue Gutschrift',                    'Gutschrift (Entwurf) bearbeiten'],
}

/**
 * Rechnungen (UI-Pilot 2026-09).
 *
 * Der Zustand steht in der URL — `?tab=abschlag&projectId=1&draftId=501` —
 * damit Neuladen, Zurueck und Links funktionieren. Vorher loeschte die Seite
 * `?tab=` sofort nach dem Lesen, und ein Neuladen im Assistenten loeschte
 * obendrein den Entwurf.
 *
 * Bestehende Einstiege bleiben: `?tab=mahnungen` (Benachrichtigungen) und
 * `location.state` mit `projectSearch`, `backProject`, `tab`, `openMahnung`.
 */
export function RechnungenPage() {
  // Die Assistenten melden offene Eingaben beim Guard — Seitennavigation und
  // Browser-Zurueck fragen dann nach (Runde 2).
  return <DirtyGuardProvider><RechnungenSeite /></DirtyGuardProvider>
}

function RechnungenSeite() {
  const guarded      = useGuardedAction()
  const location     = useLocation()
  const navigate     = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const navState     = location.state as {
    projectSearch?: string
    backProject?: { id: number; name: string }
    tab?: Tab
    openMahnung?: { sourceType: string; sourceId: number }
  } | null

  const kinds       = useInvoiceKinds()
  const listTabs    = useLicenseFilterTabs(useFilterTabs(LIST_TABS))

  const rawTab      = searchParams.get('tab') ?? 'liste'
  const urlProject  = Number(searchParams.get('projectId')) || null
  const urlDraft    = Number(searchParams.get('draftId')) || null
  const isKind      = KIND_IDS.includes(rawTab)
  const kindAllowed = isKind && kinds.some(k => k.id === rawTab)
  const wizardKind  = kindAllowed ? rawTab as InvoiceKind : null
  const listTab: ListTab = listTabs.some(t => t.id === rawTab) ? rawTab as ListTab : (listTabs[0]?.id ?? 'liste')

  const [editDraft,   setEditDraft]   = useState<{ draft: DraftResume; type: InvoiceKind } | null>(null)
  const [initSearch,  setInitSearch]  = useState<string | undefined>(navState?.projectSearch)
  const [backProject, setBackProject] = useState<{ id: number; name: string } | undefined>(navState?.backProject ?? undefined)
  const [openMahnung, setOpenMahnung] = useState<{ sourceType: string; sourceId: number } | null>(navState?.openMahnung ?? null)
  // Beschriftung zur Vorbelegung aus „Abrechenbare Projekte" — der Assistent
  // braucht sie fuers Suchfeld, die URL traegt nur die ID.
  const [prefillLabel, setPrefillLabel] = useState<{ id: number; label: string } | null>(null)
  // Entwurf, den der offene Assistent selbst angelegt hat. Er steht danach in
  // der URL, darf den Assistenten aber nicht neu starten.
  const [ownDraft, setOwnDraft] = useState<number | null>(null)
  if (!wizardKind && ownDraft !== null) setOwnDraft(null)

  const { data: shortData } = useQuery({
    queryKey: ['projects-short'], queryFn: fetchProjectsShort,
    enabled: !!urlProject && prefillLabel?.id !== urlProject,
  })
  const shortProject = shortData?.data.find(p => p.ID === urlProject)
  const projectLabel = urlProject
    ? (prefillLabel?.id === urlProject ? prefillLabel.label : shortProject ? `${shortProject.ABBR} – ${shortProject.NAME}` : undefined)
    : undefined

  // location.state einmal auswerten (auch, wenn die Seite schon offen ist)
  // und dann aus dem Verlauf nehmen — ein `tab` darin wandert in die URL.
  const [seenState, setSeenState] = useState<typeof navState>(null)
  if (navState && navState !== seenState) {
    setSeenState(navState)
    if (navState.projectSearch !== undefined) setInitSearch(navState.projectSearch)
    if (navState.backProject) setBackProject(navState.backProject)
    if (navState.openMahnung) setOpenMahnung(navState.openMahnung)
  }
  useEffect(() => {
    if (!navState) return
    const search = navState.tab && navState.tab !== 'liste' ? `?tab=${navState.tab}` : location.search
    navigate({ pathname: '/rechnungen', search }, { replace: true, state: null })
  }, [location.state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nicht erlaubte Art → zur Liste, statt einen leeren Assistenten zu zeigen.
  useEffect(() => {
    if (isKind && !kindAllowed) {
      setSearchParams({}, { replace: true })
    }
  }, [isKind, kindAllowed]) // eslint-disable-line react-hooks/exhaustive-deps

  function goList(tab: ListTab = 'liste') {
    setSearchParams(tab === 'liste' ? {} : { tab })
  }

  function goWizard(kind: InvoiceKind, opts: { projectId?: number; draftId?: number } = {}) {
    const p: Record<string, string> = { tab: kind }
    if (opts.projectId) p.projectId = String(opts.projectId)
    if (opts.draftId)   p.draftId   = String(opts.draftId)
    setSearchParams(p)
  }

  function handleEditDraft(d: { id: number; projectId: number | null; contractId: number | null; projectLabel: string; contractLabel: string; wizardType: 'abschlag' | 'rechnung' | 'schluss'; d1Pct: number; d2Pct: number; d1Reason: string | null; d2Reason: string | null; cashDiscPct: number; cashDiscDays: number }) {
    const draft: DraftResume = { id: d.id, projectId: d.projectId, contractId: d.contractId, projectLabel: d.projectLabel, contractLabel: d.contractLabel, d1Pct: d.d1Pct, d2Pct: d.d2Pct, d1Reason: d.d1Reason, d2Reason: d.d2Reason, cashDiscPct: d.cashDiscPct, cashDiscDays: d.cashDiscDays }
    setEditDraft({ draft, type: d.wizardType })
    goWizard(d.wizardType, { draftId: d.id })
  }

  function handleCreateInvoiceFromBilling(wizardType: 'abschlag' | 'rechnung' | 'schluss', projectId: number, label: string) {
    setPrefillLabel({ id: projectId, label })
    goWizard(wizardType, { projectId })
  }

  function handleDraftCreated(id: number) {
    setOwnDraft(id)
    const p = new URLSearchParams(searchParams)
    p.set('draftId', String(id))
    setSearchParams(p, { replace: true })
  }

  // ── Assistent ─────────────────────────────────────────────────────────────
  if (wizardKind) {
    // Alle Arten setzen ueber die URL fort und laden den Entwurf vom Server —
    // Neuladen und Links funktionieren (vorher nur beim Abschlag).
    const resumeId   = urlDraft && urlDraft !== ownDraft ? urlDraft : undefined
    const memDraft   = editDraft?.type === wizardKind && editDraft.draft.id === urlDraft ? editDraft.draft : undefined
    const isDraft    = !!(resumeId || memDraft)
    // Neuer Assistent nur, wenn sich Art, fortgesetzter Entwurf oder
    // Vorbelegung aendern — nicht, wenn er seinen eigenen Entwurf meldet.
    const wizardKey  = `${wizardKind}:${resumeId ?? 'neu'}:${urlProject ?? ''}`
    const prefill    = { initialProjectId: urlProject ?? undefined, initialProjectLabel: projectLabel }
    const waitLabel  = !!urlProject && !projectLabel && !isDraft && !shortData
    return (
      <div className="master-page">
        <PageHeader
          back={{ label: 'Rechnungen', onClick: () => guarded(() => goList()) }}
          title={WIZARD_TITLE[wizardKind][isDraft ? 1 : 0]}
          meta={memDraft ? <span>{memDraft.projectLabel}{memDraft.contractLabel ? ` · ${memDraft.contractLabel}` : ''}</span> : undefined}
        />
        <div className="master-tab-content">
          {waitLabel ? null : (
            <>
              {wizardKind === 'schluss' ? (
                <SchlussrechnungWizard key={wizardKey} resumeId={resumeId} {...prefill}
                  onDraftCreated={handleDraftCreated} onExit={() => goList()} />
              ) : (
                // Abschlag, Einzelrechnung und Gutschrift: ein Assistent (Runde 2)
                <InvoiceWizard key={wizardKey} kind={wizardKind} resumeId={resumeId} {...prefill}
                  onDraftCreated={handleDraftCreated} onExit={() => goList()} />
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Listen ────────────────────────────────────────────────────────────────
  return (
    <div className="master-page">
      <PageHeader
        title="Rechnungen"
        actions={<NewInvoiceMenu primary onPick={kind => goWizard(kind)} />}
      />
      {listTabs.length > 1 && <Tabs tabs={listTabs} active={listTab} onChange={id => goList(id as ListTab)} />}
      <div className="master-tab-content">
        {listTab === 'liste'     && <RechnungenListe onEditDraft={handleEditDraft} onCreateInvoiceFromBilling={handleCreateInvoiceFromBilling} initialSearch={initSearch} backProject={backProject} onClearBack={() => { setInitSearch(undefined); setBackProject(undefined) }} />}
        {listTab === 'mahnungen' && <MahnungenListe openMahnung={openMahnung} />}
        {listTab === 'se'        && <Sicherheitseinbehalte />}
      </div>
    </div>
  )
}
