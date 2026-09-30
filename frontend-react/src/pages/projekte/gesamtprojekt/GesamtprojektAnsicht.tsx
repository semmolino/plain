import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Layers, Trash2, Users } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { RowMenu } from '@/components/ui/RowMenu'
import { HelpHint } from '@/components/ui/HelpHint'
import { KpiValue } from '@/components/ui/KpiValue'
import { Disclosure } from '@/components/ui/Disclosure'
import { Message } from '@/components/ui/Message'
import { ActionBar } from '@/components/ui/ActionBar'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { FormSection } from '@/components/ui/FormSection'
import { Can } from '@/components/ui/Can'
import { ListLoading } from '@/components/ui/Skeleton'
import { ApiRequestError } from '@/api/client'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { useTenantDefaults } from '@/hooks/useTenantDefaults'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import { useChartDefaults } from '@/theme/useChartDefaults'
import { costRatioLevel, readCpiThresholds } from '@/utils/kpiLevel'
import { fmtEur0, money, money0, moneyOr, negativeOr, NO_VALUE } from '@/utils/money'
import { rowClickHandler } from '@/utils/rowClick'
import { searchAddressesApi } from '@/api/stammdaten'
import { fetchProjectListFull, fetchProjectManagers, type Project } from '@/api/projekte'
import { fetchGroupSummary, type GroupSummaryMeta, type GroupTotals, type ProjectListRow } from '@/api/reports'
import {
  deleteProjectGroup, fetchProjectGroup, updateProjectGroup,
  type ProjectGroupDetail,
} from '@/api/gesamtprojekte'
import { ProjectsTimeline } from '@/pages/daten/ProjektlisteTab'
import type { GroupTab } from '@/pages/projekte/projektUrlState'
import { ProjekteZuordnenDialog } from './ProjekteZuordnenDialog'
import { NOW_FILTER, useInvalidateGroups } from './gesamtprojektUi'

const FMT_PCT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const fmtPct  = (v: number | null | undefined) => v == null ? NO_VALUE : `${FMT_PCT.format(v)} %`

const TABS: { id: GroupTab; label: string }[] = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'daten',      label: 'Daten' },
]

/**
 * Ein Gesamtprojekt: Kopf mit den Summen, Reiter „Übersicht" (Projekte,
 * Summenzeile, Verlauf) und „Daten" (Name, Kürzel, Auftraggeber, Notizen).
 *
 * Kennzahlen kommen aus `/reports/groups/:id/summary` und brauchen
 * `reports.view`. Ohne das Recht entfällt die Leiste, statt Nullen zu zeigen
 * (wie im Projektkopf).
 */
export function GesamtprojektAnsicht({ groupId, tab, onTab, onBack, onOpenProject }: {
  groupId:       number
  tab:           GroupTab
  onTab:         (tab: GroupTab) => void
  onBack:        () => void
  onOpenProject: (id: number) => void
}) {
  const canReports = usePermission('reports.view')
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-group', groupId],
    queryFn:  () => fetchProjectGroup(groupId),
    retry:    false,
  })
  const { data: summaryData } = useQuery({
    queryKey: ['report-group', groupId, NOW_FILTER],
    queryFn:  () => fetchGroupSummary(groupId, NOW_FILTER),
    enabled:  canReports && !!data,
    retry:    false,
    staleTime: 60_000,
  })

  if (isLoading) return <div className="master-page pw-root"><p className="ls-empty">Lädt …</p></div>
  const group = data?.data
  if (!group) {
    const notFound = error instanceof ApiRequestError && error.status === 404
    return (
      <div className="master-page pw-root">
        <PageHeader title="Gesamtprojekt" back={{ label: 'Gesamtprojekte', onClick: onBack }} />
        <Message type="error" text={notFound ? 'Dieses Gesamtprojekt gibt es nicht (mehr).' : 'Das Gesamtprojekt konnte nicht geladen werden.'} />
      </div>
    )
  }

  const summary = summaryData?.data
  const meta    = summaryData?.meta

  return (
    <div className="master-page pw-root">
      <GesamtprojektKopf group={group} totals={summary?.totals} meta={meta} onBack={onBack} />
      <Tabs tabs={TABS} active={tab} onChange={id => onTab(id as GroupTab)} />
      <div className="master-tab-content">
        {tab === 'uebersicht' && (
          <Uebersicht group={group} reportRows={summary?.members} totals={summary?.totals} onOpenProject={onOpenProject} />
        )}
        {tab === 'daten' && <GesamtprojektDaten key={group.ID} group={group} />}
      </div>
    </div>
  )
}

// ── Kopf ────────────────────────────────────────────────────────────────────

function GesamtprojektKopf({ group, totals, meta, onBack }: {
  group:  ProjectGroupDetail
  totals: GroupTotals | undefined
  meta:   GroupSummaryMeta | undefined
  onBack: () => void
}) {
  const narrow = useIsNarrow()
  const toast = useToast()
  const invalidate = useInvalidateGroups()
  const canEdit = usePermission('projects.edit')
  const cpiT = readCpiThresholds(useTenantDefaults())
  const [confirm, confirmDialog] = useConfirm()

  async function remove() {
    const n = group.PROJECT_COUNT
    const ok = await confirm({
      title: 'Gesamtprojekt löschen?',
      message: n
        ? `„${group.NAME}" wird gelöscht. ${n === 1 ? 'Das Projekt bleibt' : `Die ${n} Projekte bleiben`} erhalten und ${n === 1 ? 'verliert' : 'verlieren'} nur die Zuordnung.`
        : `„${group.NAME}" wird gelöscht.`,
      confirmLabel: 'Löschen',
    })
    if (!ok) return
    try {
      await deleteProjectGroup(group.ID)
      await invalidate()
      toast.success(`Gesamtprojekt „${group.NAME}" gelöscht.`)
      onBack()
    } catch (e) {
      toast.error((e as Error)?.message || 'Löschen fehlgeschlagen')
    }
  }

  const kpis = totals ? [
    { key: 'honorar', label: 'Honorar',          value: money0(totals.BUDGET_TOTAL_NET), help: 'report.gesamtprojekt' as const },
    { key: 'ls',      label: 'Leistungsstand',   value: fmtPct(totals.LEISTUNGSSTAND_PERCENT), help: 'report.leistungsstand' as const },
    { key: 'billed',  label: 'Abgerechnet',      value: money0(totals.BILLED_NET_TOTAL) },
    { key: 'open',    label: 'Noch abzurechnen', value: money0(totals.OPEN_NET_TOTAL), help: 'report.abrechenbar' as const },
    ...(totals.COST_RATIO != null ? [{
      key: 'kq', label: 'Kostenquote', help: 'report.kostenquote' as const,
      value: <KpiValue level={costRatioLevel(totals.COST_RATIO, cpiT)}>{fmtPct(totals.COST_RATIO * 100)}</KpiValue>,
    }] : []),
  ] : []

  const kpiItem = (k: typeof kpis[number]) => (
    <div key={k.key} className="pw-kpi">
      <dt>{k.label}{k.help && <HelpHint id={k.help} size={12} />}</dt>
      <dd>{k.value}</dd>
    </div>
  )
  const partial = meta && meta.members_visible < meta.members_total

  return (
    <>
      <PageHeader
        className="pw-header"
        back={{ label: 'Gesamtprojekte', onClick: onBack }}
        eyebrow={<>
          {group.ABBR && <span>{group.ABBR}</span>}
          <span className="status-pill"><Layers size={11} strokeWidth={2} aria-hidden="true" /> Gesamtprojekt</span>
        </>}
        title={group.NAME}
        meta={<>
          {group.ADDRESS_NAME && <span><span className="page-header-meta-label">Auftraggeber</span>{group.ADDRESS_NAME}</span>}
          {group.MANAGER_NAME && <span><span className="page-header-meta-label">Gesamtverantwortung</span>{group.MANAGER_NAME}</span>}
          <span>{group.PROJECT_COUNT === 1 ? '1 Projekt' : `${group.PROJECT_COUNT} Projekte`}</span>
        </>}
        actions={canEdit ? (
          <RowMenu label="Weitere Aktionen zum Gesamtprojekt" triggerClassName="btn-secondary pw-more-btn">
            <button type="button" role="menuitem" className="row-menu-item danger" onClick={() => void remove()}>
              <Trash2 size={13} strokeWidth={1.75} style={{ marginRight: 8 }} aria-hidden="true" />Gesamtprojekt löschen
            </button>
          </RowMenu>
        ) : undefined}
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
        {partial && (
          <p className="pg-scope-note">
            Summen über {meta.members_visible} von {meta.members_total} Projekten — die übrigen liegen außerhalb
            deines Reporting-Bereichs und sind nicht enthalten.
            <HelpHint id="report.gesamtprojekt" size={12} />
          </p>
        )}
      </PageHeader>
      {confirmDialog}
    </>
  )
}

// ── Reiter Übersicht ────────────────────────────────────────────────────────

function Uebersicht({ group, reportRows, totals, onOpenProject }: {
  group:         ProjectGroupDetail
  reportRows:    ProjectListRow[] | undefined
  totals:        GroupTotals | undefined
  onOpenProject: (id: number) => void
}) {
  useChartDefaults()
  const narrow = useIsNarrow()
  const canReports = usePermission('reports.view')
  const [assigning, setAssigning] = useState(false)
  const { data: listData, isLoading: listLoading } = useQuery({ queryKey: ['projects-full'], queryFn: fetchProjectListFull })

  // Stammdaten der Projekte aus der Projektliste (Status, Leitung, Auftraggeber),
  // Beträge aus dem Report — dort fehlen Projekte außerhalb des Scopes.
  const members: Project[] = useMemo(() => {
    const all = listData?.data ?? []
    return all
      .filter(p => p.PROJECT_GROUP_ID === group.ID)
      .sort((a, b) => a.ABBR.localeCompare(b.ABBR, 'de', { numeric: true }))
  }, [listData, group.ID])
  const report = useMemo(() => new Map((reportRows ?? []).map(r => [r.PROJECT_ID, r])), [reportRows])
  const showMoney = canReports && !!reportRows
  const visibleIds = useMemo(() => (reportRows ?? []).map(r => r.PROJECT_ID).sort((a, b) => a - b), [reportRows])

  const cell = (r: ProjectListRow | undefined, render: (r: ProjectListRow) => React.ReactNode, cls = 'num') =>
    <td className={cls}>{r ? render(r) : <span className="pg-muted" title="Außerhalb deines Reporting-Bereichs">—</span>}</td>

  return (
    <div className="pg-overview">
      <div className="list-toolbar">
        <h2 className="pg-section-title">Projekte</h2>
        <Can permission="projects.edit">
          <button type="button" className="btn-secondary btn-small pl-toolbar-actions pg-icon-btn" onClick={() => setAssigning(true)}>
            <Users size={13} strokeWidth={2} aria-hidden="true" />Projekte zuordnen
          </button>
        </Can>
      </div>

      {/* Solange die Projektliste lädt, ist „keine Projekte" nicht wahr —
          vorher blitzte der Leerzustand samt zweitem „Zuordnen"-Knopf auf. */}
      {listLoading ? (
        <ListLoading columns={4} />
      ) : members.length === 0 ? (
        <div className="empty-block">
          <p className="empty-note">Noch keine Projekte in diesem Gesamtprojekt.</p>
          <p className="empty-block-why">
            Ordne die Einzelverträge zu, die zu diesem Vorhaben gehören. Summen, Leistungsstand und Verlauf
            entstehen daraus — Verträge und Rechnungen bleiben bei den Projekten.
          </p>
          <Can permission="projects.edit">
            <button type="button" className="btn-primary" onClick={() => setAssigning(true)}>Projekte zuordnen</button>
          </Can>
        </div>
      ) : narrow ? (
        // Handy: Liste statt Tabelle (Muster „Kalkulation am Handy", .km-*) —
        // die Tabelle schnitt dort die Beträge ab.
        <>
          <ul className="km-list">
            {members.map(p => {
              const r = report.get(p.ID)
              return (
                <li key={p.ID}>
                  <button type="button" className="km-row" onClick={() => onOpenProject(p.ID)}>
                    <span className="km-main">
                      <span className="km-title">{p.ABBR} · {p.NAME}</span>
                      <span className="km-sub">
                        {[p.STATUS_NAME, showMoney && (r ? `Lst. ${fmtPct(r.LEISTUNGSSTAND_PERCENT)}` : 'außerhalb deines Reporting-Bereichs')]
                          .filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {showMoney && r && <span className="km-value">{money0(r.BUDGET_TOTAL_NET)}</span>}
                    <ChevronRight size={16} strokeWidth={2} className="km-chev" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
          {showMoney && totals && members.length > 1 && (
            <dl className="km-total">
              <div><dt>Honorar ({totals.PROJECT_COUNT})</dt><dd>{money0(totals.BUDGET_TOTAL_NET)}</dd></div>
              <div><dt>Leistungsstand</dt><dd>{fmtPct(totals.LEISTUNGSSTAND_PERCENT)}</dd></div>
              <div><dt>Abgerechnet</dt><dd>{money0(totals.BILLED_NET_TOTAL)}</dd></div>
              <div><dt>Abrechenbar</dt><dd style={negativeOr(totals.OPEN_NET_TOTAL, 'var(--accent)')}>{fmtEur0(totals.OPEN_NET_TOTAL)}</dd></div>
            </dl>
          )}
        </>
      ) : (
        <div className="list-section">
          <table className="master-table master-table--einzeilig">
            <thead>
              <tr>
                <th scope="col">Kürzel</th>
                <th scope="col">Name</th>
                <th scope="col" className="pg-col-wide">Status</th>
                <th scope="col" className="pg-col-wide">Auftraggeber</th>
                {showMoney && <>
                  <th scope="col" className="num">Honorar</th>
                  <th scope="col" className="num">Lst. %</th>
                  <th scope="col" className="num pg-col-wide">Abgerechnet</th>
                  <th scope="col" className="num pg-col-wide">Abrechenbar <HelpHint id="report.abrechenbar" align="right" size={12} /></th>
                </>}
              </tr>
            </thead>
            <tbody>
              {members.map(p => {
                const r = report.get(p.ID)
                return (
                  <tr key={p.ID} className="clickable-row" onClick={rowClickHandler(() => onOpenProject(p.ID))}>
                    <td className="cell-id">
                      <button type="button" className="link-btn" onClick={() => onOpenProject(p.ID)}>{p.ABBR}</button>
                    </td>
                    <td><span className="cell-clamp" title={p.NAME}>{p.NAME}</span></td>
                    <td className="pg-col-wide">{p.STATUS_NAME || '—'}</td>
                    <td className="pg-col-wide"><span className="cell-clamp" title={p.ADDRESS_NAME}>{p.ADDRESS_NAME || '—'}</span></td>
                    {showMoney && <>
                      {cell(r, x => money(x.BUDGET_TOTAL_NET))}
                      {cell(r, x => fmtPct(x.LEISTUNGSSTAND_PERCENT))}
                      {cell(r, x => money(x.BILLED_NET_TOTAL), 'num pg-col-wide')}
                      {cell(r, x => moneyOr(x.OPEN_NET_TOTAL, 'var(--accent)'), 'num pg-col-wide')}
                    </>}
                  </tr>
                )
              })}
            </tbody>
            {showMoney && totals && members.length > 1 && (
              <tfoot>
                <tr className="sum-row">
                  <td colSpan={2}><strong>Summe ({totals.PROJECT_COUNT})</strong></td>
                  <td className="pg-col-wide" />
                  <td className="pg-col-wide" />
                  <td className="num"><strong>{money(totals.BUDGET_TOTAL_NET)}</strong></td>
                  <td className="num"><strong>{fmtPct(totals.LEISTUNGSSTAND_PERCENT)}</strong></td>
                  <td className="num pg-col-wide"><strong>{money(totals.BILLED_NET_TOTAL)}</strong></td>
                  <td className="num pg-col-wide"><strong>{moneyOr(totals.OPEN_NET_TOTAL, 'var(--accent)')}</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {showMoney && visibleIds.length > 0 && (
        <ProjectsTimeline filter={NOW_FILTER} filterReady projectIds={visibleIds} title="Verlauf des Gesamtprojekts" />
      )}

      <ProjekteZuordnenDialog group={group} open={assigning} onClose={() => setAssigning(false)} />
    </div>
  )
}

// ── Reiter Daten ────────────────────────────────────────────────────────────

interface DatenForm {
  name:      string
  abbr:      string
  addressId: number | null
  addrText:  string
  managerId: string
  notes:     string
}

/** Was als Änderung zählt — `addrText` ist nur die Anzeige zu `addressId`. */
const FIELDS: (keyof DatenForm)[] = ['name', 'abbr', 'addressId', 'managerId', 'notes']

function formFrom(g: ProjectGroupDetail): DatenForm {
  return {
    name:      g.NAME ?? '',
    abbr:      g.ABBR ?? '',
    addressId: g.ADDRESS_ID ?? null,
    addrText:  g.ADDRESS_NAME ?? '',
    managerId: g.MANAGER_ID != null ? String(g.MANAGER_ID) : '',
    notes:     g.NOTES ?? '',
  }
}

function GesamtprojektDaten({ group }: { group: ProjectGroupDetail }) {
  const canEdit = usePermission('projects.edit')
  const invalidate = useInvalidateGroups()
  const [confirm, confirmDialog] = useConfirm()
  const [edits, setEdits] = useState<Partial<DatenForm>>({})
  const [pending, setPending] = useState(false)
  const [tried, setTried] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const { data: mgrData } = useQuery({ queryKey: ['project-managers'], queryFn: fetchProjectManagers })

  const saved = useMemo(() => formFrom(group), [group])
  const form: DatenForm = { ...saved, ...edits }
  const changed = FIELDS.filter(k => form[k] !== saved[k]).length
  const dirty = changed > 0
  const nameMissing = !form.name.trim()

  const set = <K extends keyof DatenForm>(k: K, v: DatenForm[K]) => { setEdits(e => ({ ...e, [k]: v })); setMsg(null) }

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return (res.data ?? []).map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  async function save() {
    setTried(true)
    if (nameMissing) {
      const text = 'Bitte einen Namen angeben.'
      setMsg({ type: 'error', text })
      throw new Error(text)
    }
    setPending(true)
    setMsg(null)
    try {
      await updateProjectGroup(group.ID, {
        name:       form.name.trim(),
        abbr:       form.abbr.trim() || null,
        address_id: form.addressId,
        manager_id: form.managerId ? Number(form.managerId) : null,
        notes:      form.notes.trim() || null,
      })
      await invalidate()
      setEdits({})
      setTried(false)
      setMsg({ type: 'success', text: 'Gesamtprojekt gespeichert.' })
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error)?.message || 'Speichern fehlgeschlagen' })
      throw e
    } finally {
      setPending(false)
    }
  }

  async function discard() {
    const ok = await confirm({
      title: 'Änderungen verwerfen?',
      message: `${changed === 1 ? '1 Änderung geht' : `${changed} Änderungen gehen`} verloren.`,
      confirmLabel: 'Verwerfen',
    })
    if (ok) { setEdits({}); setMsg(null); setTried(false) }
  }

  useRegisterDirty('gesamtprojekt-daten', { dirty, label: 'Gesamtprojekt', count: changed, save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, canEdit)

  const status = pending ? 'Speichert …'
    : dirty ? `${changed} ${changed === 1 ? 'Feld' : 'Felder'} geändert`
    : 'Keine Änderungen'

  return (
    <div className="ws-form">
      {!canEdit && (
        <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Projekte bearbeiten".</p>
      )}
      <fieldset className="ws-form-fields" disabled={!canEdit || pending}>
        <legend className="sr-only">Daten des Gesamtprojekts</legend>
        <FormSection title="Gesamtprojekt" hint="Die Klammer um die Projekte eines Vorhabens. Verträge und Rechnungen stehen bei den Projekten.">
          <div className="form-group">
            <label htmlFor="gp-name">Name*</label>
            <input id="gp-name" type="text" value={form.name} maxLength={200}
              aria-invalid={(tried && nameMissing) || undefined}
              onChange={e => set('name', e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="gp-abbr">Kürzel</label>
            <input id="gp-abbr" type="text" value={form.abbr} maxLength={60} onChange={e => set('abbr', e.target.value)} />
          </div>
          <Autocomplete
            label="Auftraggeber"
            htmlId="gp-address"
            value={form.addrText}
            onChange={text => { if (text) set('addrText', text); else setEdits(e => ({ ...e, addrText: '', addressId: null })) }}
            onSelect={(id, label) => setEdits(e => ({ ...e, addressId: Number(id), addrText: label }))}
            search={searchAddresses}
            placeholder="Adresse suchen …"
          />
          <div className="form-group">
            <label htmlFor="gp-manager">Gesamtverantwortung</label>
            <select id="gp-manager" value={form.managerId} onChange={e => set('managerId', e.target.value)}>
              <option value="">— niemand festgelegt —</option>
              {(mgrData?.data ?? []).map(m => <option key={m.ID} value={m.ID}>{m.ABBR}</option>)}
            </select>
          </div>
        </FormSection>
        <FormSection title="Notizen" layout="block">
          <label htmlFor="gp-notes" className="sr-only">Notizen</label>
          <textarea id="gp-notes" rows={6} value={form.notes} maxLength={4000} className="pg-notes"
            placeholder="z. B. Stufen, Beauftragungsstand, Absprachen mit dem Bauherrn …"
            onChange={e => set('notes', e.target.value)} />
        </FormSection>
      </fieldset>

      <Message type={msg?.type ?? 'info'} text={msg?.text ?? null} />

      {canEdit && (
        <ActionBar
          dirty={dirty}
          quiet={!dirty && !pending}
          status={status}
          secondary={dirty ? <button type="button" className="btn-secondary" onClick={() => void discard()} disabled={pending}>Verwerfen</button> : undefined}
        >
          <button type="button" className="btn-primary" onClick={() => void save().catch(() => {})} disabled={!dirty || pending}>
            {pending ? 'Speichert …' : 'Speichern'}
          </button>
        </ActionBar>
      )}
      {confirmDialog}
    </div>
  )
}
