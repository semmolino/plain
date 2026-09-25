import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, BarChart3, Receipt } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { RowMenu } from '@/components/ui/RowMenu'
import { HelpHint } from '@/components/ui/HelpHint'
import { KpiValue } from '@/components/ui/KpiValue'
import { Disclosure } from '@/components/ui/Disclosure'
import { Modal } from '@/components/ui/Modal'
import { ProjectPicker } from '@/components/projekte/ProjectPicker'
import { NewInvoiceMenu } from '@/components/rechnungen/NewInvoiceMenu'
import type { InvoiceKind } from '@/components/rechnungen/invoiceKinds'
import { fetchProjectListFull, fetchProjectsShort } from '@/api/projekte'
import { fetchProjectReportHeader } from '@/api/reports'
import { usePermission } from '@/store/permissionsStore'
import { useTenantDefaults } from '@/hooks/useTenantDefaults'
import { costRatioLevel, readCpiThresholds } from '@/utils/kpiLevel'
import { money0, NO_VALUE } from '@/utils/money'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useTrackRecent } from '@/hooks/useTrackRecent'

const FMT_PCT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const fmtPct  = (v: number | null | undefined) => v == null ? NO_VALUE : `${FMT_PCT.format(v)} %`

/**
 * Kopf des Projekt-Arbeitsbereichs (UI-Pilot 2026-09).
 *
 * Ersetzt drei Leisten, die vorher uebereinander standen: die Kontextleiste
 * („← Alle Projekte" + Suchfeld), je Tab eine Sprungleiste („Rechnungen →",
 * „Projekt-Report →", „HOAI →") und darueber die Tab-Reihe mit „Liste" als
 * erstem Tab. Wer in einem Projekt arbeitete, sah nirgends Status,
 * Auftraggeber oder den Stand der Abrechnung — das steht jetzt hier.
 *
 * Kennzahlen kommen aus dem Projekt-Report und brauchen `reports.view`.
 * Ohne das Recht (oder bei 403) entfaellt die Leiste, statt Nullen zu zeigen.
 */
export function ProjektHeader({ projectId, onBack, onSwitch }: {
  projectId: number
  onBack:    () => void
  onSwitch:  (id: number) => void
}) {
  const navigate    = useNavigate()
  const narrow      = useIsNarrow()
  const canReports  = usePermission('reports.view')
  const cpiT        = readCpiThresholds(useTenantDefaults())

  const { data: fullData }  = useQuery({ queryKey: ['projects-full'],  queryFn: fetchProjectListFull, staleTime: 60_000 })
  const { data: shortData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: headerData, isError: headerError } = useQuery({
    queryKey: ['report-header', projectId, { mode: 'now' }],
    queryFn:  () => fetchProjectReportHeader(projectId, { mode: 'now' }),
    enabled:  canReports,
    retry:    false,
    staleTime: 60_000,
  })

  const full    = fullData?.data.find(p => p.ID === projectId)
  const short   = shortData?.data.find(p => p.ID === projectId)
  const abbr    = full?.ABBR ?? short?.ABBR ?? ''
  const name    = full?.NAME ?? short?.NAME ?? ''
  const header  = canReports && !headerError ? headerData?.data : undefined

  useTrackRecent('project', projectId, abbr ? [abbr, name].filter(Boolean).join(' · ') : null)

  // Projekt wechseln: der Name selbst ist der Umschalter (Runde 2). Vorher
  // sass daneben ein 32-px-Symbol, das kaum jemand als Umschalter erkannte.
  const [switching, setSwitching] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!switching || narrow) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setSwitching(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setSwitching(false)
      btnRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [switching, narrow])

  // Strg+K (Mac: ⌘K) oeffnet den Umschalter von ueberall im Arbeitsbereich —
  // nicht hinter einem offenen Dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      setSwitching(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function pickProject(id: number) {
    setSwitching(false)
    if (id !== projectId) onSwitch(id)
  }
  const picker = (inline: boolean) => (
    <ProjectPicker
      projects={shortData?.data ?? []}
      selectedId={projectId}
      autoFocus
      startEmpty
      inline={inline}
      placeholder="Projekt suchen …"
      onSelect={pickProject}
      onGoToList={() => { setSwitching(false); onBack() }}
    />
  )

  function openInvoice(kind: InvoiceKind) {
    navigate(`/rechnungen?tab=${kind}&projectId=${projectId}`)
  }
  const toInvoices = () => navigate('/rechnungen', { state: { projectSearch: name || abbr, backProject: { id: projectId, name: abbr } } })
  const toReport   = () => navigate('/daten', { state: { tab: 'einzelprojekt', projectId } })

  const kpis = header ? [
    { key: 'honorar', label: 'Honorar',          value: money0(header.BUDGET_TOTAL_NET) },
    { key: 'ls',      label: 'Leistungsstand',   value: fmtPct(header.LEISTUNGSSTAND_PERCENT), help: 'report.leistungsstand' as const },
    { key: 'billed',  label: 'Abgerechnet',      value: money0(header.BILLED_NET_TOTAL) },
    { key: 'open',    label: 'Noch abzurechnen', value: money0(header.OPEN_NET_TOTAL), help: 'report.abrechenbar' as const },
    ...(header.COST_RATIO != null ? [{
      key: 'kq', label: 'Kostenquote', help: 'report.kostenquote' as const,
      value: <KpiValue level={costRatioLevel(header.COST_RATIO, cpiT)}>{fmtPct(header.COST_RATIO * 100)}</KpiValue>,
    }] : []),
  ] : []

  const kpiItem = (k: typeof kpis[number]) => (
    <div key={k.key} className="pw-kpi">
      <dt>{k.label}{k.help && <HelpHint id={k.help} size={12} />}</dt>
      <dd>{k.value}</dd>
    </div>
  )

  return (
    <PageHeader
      className="pw-header"
      back={{ label: 'Projekte', onClick: onBack }}
      eyebrow={<>
        <span>{abbr}</span>
        {full?.STATUS_NAME && <span className="status-pill">{full.STATUS_NAME}</span>}
        {full?.IS_INTERNAL && <span className="status-pill">Intern</span>}
      </>}
      title={
        <button ref={btnRef} type="button" className="pw-title-btn"
          aria-haspopup="dialog" aria-expanded={switching}
          title={`${name || abbr} – Projekt wechseln (Strg+K)`}
          onClick={() => setSwitching(s => !s)}>
          <span className="pw-title-text">{name || abbr}</span>
          <ChevronDown size={20} strokeWidth={2.25} className="pw-title-chev" aria-hidden="true" />
          <span className="sr-only">, Projekt wechseln</span>
        </button>
      }
      titleAddon={switching && !narrow ? (
        <div className="pw-switch-pop" ref={popRef} role="dialog" aria-label="Projekt wechseln">
          {picker(false)}
          <p className="pw-switch-hint">Pfeiltasten wählen · Enter öffnet · Esc schließt</p>
        </div>
      ) : undefined}
      meta={full && (<>
        {full.ADDRESS_NAME && <span><span className="page-header-meta-label">Auftraggeber</span>{full.ADDRESS_NAME}</span>}
        {full.MANAGER_NAME && <span><span className="page-header-meta-label">Projektleitung</span>{full.MANAGER_NAME}</span>}
        {full.TYPE_NAME && !narrow && <span><span className="page-header-meta-label">Typ</span>{full.TYPE_NAME}</span>}
      </>)}
      actions={<>
        {!narrow && <NewInvoiceMenu label="Rechnung erstellen" onPick={openInvoice} />}
        <RowMenu label="Weitere Aktionen zum Projekt" triggerClassName="btn-secondary pw-more-btn">
          <button type="button" role="menuitem" className="row-menu-item" onClick={toInvoices}>
            <Receipt size={13} strokeWidth={1.75} style={{ marginRight: 8 }} aria-hidden="true" />Rechnungen zu diesem Projekt
          </button>
          {canReports && (
            <button type="button" role="menuitem" className="row-menu-item" onClick={toReport}>
              <BarChart3 size={13} strokeWidth={1.75} style={{ marginRight: 8 }} aria-hidden="true" />Projekt-Report
            </button>
          )}
          {narrow && (
            <>
              <button type="button" role="menuitem" className="row-menu-item" onClick={() => openInvoice('abschlag')}>Abschlagsrechnung erstellen</button>
              <button type="button" role="menuitem" className="row-menu-item" onClick={() => openInvoice('rechnung')}>Einzelrechnung erstellen</button>
            </>
          )}
        </RowMenu>
      </>}
    >
      {kpis.length > 0 && (narrow ? (
        <>
          <dl className="pw-kpis">{kpis.slice(0, 2).map(kpiItem)}</dl>
          {kpis.length > 2 && (
            <Disclosure title="Alle Kennzahlen" className="pw-kpis-more">
              <dl className="pw-kpis">{kpis.slice(2).map(kpiItem)}</dl>
            </Disclosure>
          )}
        </>
      ) : (
        <dl className="pw-kpis">{kpis.map(kpiItem)}</dl>
      ))}
      {/* Handy: Suche und Liste als eigenes Blatt, 44-px-Zeilen */}
      {narrow && (
        <Modal open={switching} onClose={() => setSwitching(false)} title="Projekt wechseln" className="pw-switch-sheet">
          {picker(true)}
        </Modal>
      )}
    </PageHeader>
  )
}
