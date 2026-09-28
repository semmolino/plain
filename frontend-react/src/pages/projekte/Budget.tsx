import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Plus, BellOff, Bell } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { FormSection } from '@/components/ui/FormSection'
import { HelpHint } from '@/components/ui/HelpHint'
import { KpiValue } from '@/components/ui/KpiValue'
import { Message } from '@/components/ui/Message'
import { fetchActiveEmployees, type ActiveEmployee } from '@/api/projekte'
import {
  fetchBudgetOverview,
  createBudgetRule,
  updateBudgetRule,
  deleteBudgetRule,
  setProjectMute,
  type BudgetWarningRule,
  type BudgetWarningOverview,
  type BudgetWarningStructureAgg,
} from '@/api/budgetWarnings'
import { useConfirm } from '@/hooks/useConfirm'
import { usePermission } from '@/store/permissionsStore'
import { fmtEur, money, NO_VALUE } from '@/utils/money'
import { fmtHours } from '@/utils/zeit'
import { budgetShareLevel, lowestRulePct } from '@/utils/kpiLevel'

const FMT_PCT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const fmtPct = (v: number | null) => (v == null ? NO_VALUE : `${FMT_PCT.format(v)} %`)

const fmtDate = (s: string | null | undefined) => {
  if (!s) return NO_VALUE
  const d = new Date(s); if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

/** Anteil verbraucht in %; ohne Budget nicht bewertbar. */
const share = (verbrauch: number, budget: number) => (budget > 0 ? (verbrauch / budget) * 100 : null)

const FMT_THRESHOLD = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/**
 * Verbrauchter Anteil mit Ampel (utils/kpiLevel → budgetShareLevel):
 * „beobachten" ab der niedrigsten Warnregel des Projekts, „Handlungsbedarf"
 * ab 100 %. Farbe nie allein — KpiValue trägt Symbol und Klartext.
 */
function ShareValue({ pct, watchPct, suffix = '' }: { pct: number | null; watchPct: number | null; suffix?: string }) {
  const level = budgetShareLevel(pct, watchPct)
  const txt = `${fmtPct(pct)}${suffix}`
  if (level === 'critical') return <KpiValue level="critical" reason={`Verbrauch ${fmtPct(pct)} des Budgets`}>{txt}</KpiValue>
  if (level === 'watch') {
    return <KpiValue level="watch" reason={`Verbrauch ${fmtPct(pct)} — ab ${FMT_THRESHOLD.format(watchPct!)} % meldet die erste Warnregel`}>{txt}</KpiValue>
  }
  return <span className="bud-share-pct">{txt}</span>
}

interface Props {
  initialProjectId?: number
}

interface RuleDraft {
  threshold_pct:  string
  structure_id:   string  // '' = Projekt-Ebene
  notify_pm:      boolean
  notify_booker:  boolean
  notify_cc:      number[]
  muted:          boolean
}

const emptyDraft = (): RuleDraft => ({ threshold_pct: '75', structure_id: '', notify_pm: true, notify_booker: true, notify_cc: [], muted: false })

/** Elemente in Baumreihenfolge mit Tiefe — wie in der Struktur. */
function inTreeOrder(structures: BudgetWarningStructureAgg[]) {
  const kids = new Map<number | null, BudgetWarningStructureAgg[]>()
  const ids = new Set(structures.map(s => s.ID))
  for (const s of structures) {
    const f = s.FATHER_ID != null && ids.has(s.FATHER_ID) ? s.FATHER_ID : null
    kids.set(f, [...(kids.get(f) ?? []), s])
  }
  const out: { node: BudgetWarningStructureAgg; depth: number }[] = []
  const walk = (father: number | null, depth: number) => {
    const list = [...(kids.get(father) ?? [])].sort((a, b) => (a.SORT_ORDER ?? a.ID) - (b.SORT_ORDER ?? b.ID) || a.ID - b.ID)
    for (const n of list) { out.push({ node: n, depth }); walk(n.ID, depth + 1) }
  }
  walk(null, 0)
  return out
}

const elementLabel = (s: BudgetWarningStructureAgg | undefined, id: number) =>
  s ? [s.ABBR, s.NAME].filter(Boolean).join(' · ') || `Element ${id}` : `Element ${id}`

// Zeigt, wen diese Regel benachrichtigen würde. Dieselbe Zusammenstellung wie
// im Backend (services/budgetWarnings.js → notifyBudgetWarning): PL, Auslöser
// und die Personenliste werden zu EINER Empfängermenge vereinigt.
//
// Ohne die Vorschau war der Dialog nicht zu durchschauen: „CC-Empfänger" klang
// nach einem Zusatz, obwohl es die einzige Stelle für eine feste Person ist —
// und wer alle drei Felder leer lässt, benachrichtigt niemanden, ohne dass es
// irgendwo stand.
function EmpfaengerVorschau({ draft, employees, projectManagerId }: {
  draft:            RuleDraft
  employees:        ActiveEmployee[]
  projectManagerId: number | null
}) {
  const teile: string[] = []

  if (draft.notify_pm) {
    const pl = employees.find(e => e.ID === projectManagerId)
    teile.push(pl ? `Projektleiter (${pl.ABBR})`
                  : 'Projektleiter (für dieses Projekt nicht gesetzt)')
  }
  if (draft.notify_booker) teile.push('wer die auslösende Buchung erfasst hat')
  for (const id of draft.notify_cc) {
    const emp = employees.find(e => e.ID === id)
    if (emp) teile.push(emp.ABBR)
  }

  // Ein gesetzter PL-Haken ohne hinterlegten PL zählt nicht als Empfänger.
  const erreichtNiemanden =
    (!draft.notify_pm || !employees.some(e => e.ID === projectManagerId)) &&
    !draft.notify_booker &&
    draft.notify_cc.length === 0

  if (draft.muted) {
    return <div className="bud-preview bud-preview--muted">Regel ist stumm geschaltet — es wird niemand benachrichtigt.</div>
  }
  if (erreichtNiemanden) {
    return (
      <div className="bud-preview bud-preview--warn">
        <strong>Niemand ausgewählt.</strong> Diese Regel überwacht das Budget, benachrichtigt
        aber niemanden.
      </div>
    )
  }
  return <div className="bud-preview"><strong>Empfänger:</strong> {teile.join(', ')}</div>
}

export function Budget({ initialProjectId }: Props) {
  if (initialProjectId == null) return <p className="ls-empty">Bitte oben ein Projekt auswählen.</p>
  // Neuer Zustand je Projekt — ein offener Regel-Dialog gehört zu genau einem.
  return <BudgetProjekt key={initialProjectId} pid={initialProjectId} />
}

function BudgetProjekt({ pid }: { pid: number }) {
  const qc = useQueryClient()
  // Anlegen, Ändern, Löschen und Stummschalten prüft das Backend mit
  // projects.budget.edit (routes/budgetWarnings.js). Die Knöpfe standen vorher
  // für jeden da, der den Reiter sehen durfte.
  const canEdit = usePermission('projects.budget.edit')
  const [confirm, confirmDialog] = useConfirm()
  const [dialog, setDialog] = useState<{ rule: BudgetWarningRule | null } | null>(null)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: ovData, isLoading, isError } = useQuery({
    queryKey: ['budget-overview', pid],
    queryFn:  () => fetchBudgetOverview(pid),
  })
  const overview = ovData?.data ?? null

  function invalidate() { void qc.invalidateQueries({ queryKey: ['budget-overview', pid] }) }

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteBudgetRule(id),
    onSuccess:  () => { invalidate(); setMsg({ text: 'Warnregel gelöscht.', type: 'success' }) },
    onError:    (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const muteMut = useMutation({
    mutationFn: (m: boolean) => setProjectMute(pid, m),
    onSuccess:  () => invalidate(),
    onError:    (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  if (isLoading) return <p className="ls-empty">Lädt …</p>
  if (isError || !overview) return <Message type="error" text="Das Budget konnte nicht geladen werden." />

  const agg = overview.projectAggregate
  const pct = share(agg.verbrauch, agg.budget)
  const watchPct = lowestRulePct(overview.rules)
  const muted = overview.project.BUDGET_WARNINGS_MUTED
  const planLeaves = overview.structures.filter(s => s.leaf && s.plan === 'all')
  const planHours = planLeaves.reduce((a, s) => a + Number(s.planHours ?? 0), 0)
  const bookedHours = planLeaves.reduce((a, s) => a + Number(s.bookedHours ?? 0), 0)

  async function removeRule(r: BudgetWarningRule) {
    const ok = await confirm({
      title: 'Warnregel löschen',
      message: `Die Warnregel bei ${Number(r.THRESHOLD_PCT).toFixed(0)} % wird gelöscht. Bei dieser Schwelle wird dann nicht mehr gewarnt.`,
      confirmLabel: 'Löschen',
    })
    if (ok) deleteMut.mutate(r.ID)
  }

  return (
    <div className="ws-form">
      <div className="bud-kpis">
        <div className="bud-kpi">
          <div className="bud-kpi-label">Budget</div>
          <div className="bud-kpi-value">{money(agg.budget)}</div>
          <div className="bud-kpi-sub">Honorar und Zuschläge, ohne Nebenkosten{planLeaves.length > 0 ? ' · teils nach Plan' : ''}</div>
        </div>
        <div className="bud-kpi">
          <div className="bud-kpi-label">Verbraucht</div>
          <div className="bud-kpi-value">{money(agg.verbrauch)}</div>
          <div className="bud-kpi-sub">
            {pct != null ? <ShareValue pct={pct} watchPct={watchPct} suffix=" des Budgets" /> : 'Kein Budget hinterlegt'}
          </div>
        </div>
        {planLeaves.length > 0 && (
          <div className="bud-kpi">
            <div className="bud-kpi-label">Stunden nach Plan</div>
            <div className="bud-kpi-value">{fmtHours(bookedHours)} <span className="bud-kpi-unit">von {fmtHours(planHours)} h</span></div>
            <div className="bud-kpi-sub">{planLeaves.length === 1 ? '1 Element' : `${planLeaves.length} Elemente`} nach Aufwand mit Plan</div>
          </div>
        )}
        <div className="bud-kpi">
          <div className="bud-kpi-label">Warnungen</div>
          <div className="bud-kpi-value bud-kpi-state">
            {muted ? <BellOff size={16} strokeWidth={2} aria-hidden="true" /> : <Bell size={16} strokeWidth={2} aria-hidden="true" />}
            {muted ? 'stumm geschaltet' : 'aktiv'}
          </div>
          {canEdit && (
            <button type="button" className="btn-small bud-kpi-btn" onClick={() => muteMut.mutate(!muted)} disabled={muteMut.isPending}>
              {muted ? 'Wieder benachrichtigen' : 'Projekt stumm schalten'}
            </button>
          )}
        </div>
      </div>

      <Message type={msg?.type ?? 'info'} text={msg?.text ?? null} />

      <BudgetJeElement overview={overview} watchPct={watchPct} />

      <FormSection
        title="Warnregeln"
        help="projects.budget.rules"
        layout="block"
        actions={canEdit && overview.rules.length > 0 ? (
          <button type="button" className="btn-small prl-btn" onClick={() => { setMsg(null); setDialog({ rule: null }) }}>
            <Plus size={13} strokeWidth={2} aria-hidden="true" /> Neue Regel
          </button>
        ) : undefined}
      >
        {overview.rules.length === 0 ? (
          <div className="empty-block">
            <p className="empty-note">Für dieses Projekt gibt es noch keine Warnregel.</p>
            <p className="empty-block-why">
              Eine Regel meldet sich, sobald der Verbrauch einen Anteil des Budgets erreicht — zum Beispiel bei
              75 %, solange noch Zeit zum Gegensteuern ist.
            </p>
            {canEdit && (
              <button type="button" className="btn-small prl-btn" onClick={() => { setMsg(null); setDialog({ rule: null }) }}>
                <Plus size={13} strokeWidth={2} aria-hidden="true" /> Erste Regel anlegen
              </button>
            )}
          </div>
        ) : (
          <RegelTabelle overview={overview} canEdit={canEdit} onEdit={r => { setMsg(null); setDialog({ rule: r }) }} onDelete={r => void removeRule(r)} />
        )}
      </FormSection>

      {overview.fired.length > 0 && <Meldungen overview={overview} />}

      {dialog && (
        <RegelDialog
          pid={pid}
          overview={overview}
          rule={dialog.rule}
          onClose={() => setDialog(null)}
          onSaved={text => { setDialog(null); invalidate(); setMsg({ text, type: 'success' }) }}
        />
      )}
      {confirmDialog}
    </div>
  )
}

// ── Budget je Element ──────────────────────────────────────────────────────────

function BudgetJeElement({ overview, watchPct }: { overview: BudgetWarningOverview; watchPct: number | null }) {
  const rows = useMemo(() => inTreeOrder(overview.structures), [overview.structures])
  const hasPlan = overview.structures.some(s => s.plan && s.plan !== 'none')

  return (
    <FormSection title="Budget je Element" help="projects.budget.elements" layout="block"
      hint={hasPlan ? 'Elemente nach Aufwand mit Plan rechnen mit dem Plan als Budget und dem gebuchten Honorar als Verbrauch.' : undefined}>
      {rows.length === 0 ? (
        <div className="empty-block">
          <p className="empty-note">Dieses Projekt hat noch keine Struktur.</p>
          <p className="empty-block-why">Budget und Verbrauch entstehen je Element der Struktur — aus Honorar und Zuschlägen und den gebuchten Stunden.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="ls-table bud-table">
            <thead>
              <tr>
                <th scope="col" className="ls-th">Element</th>
                <th scope="col" className="ls-th ls-col-num">Budget</th>
                <th scope="col" className="ls-th ls-col-num">Verbraucht</th>
                <th scope="col" className="ls-th bud-col-share">Anteil</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ node: s, depth }) => {
                const p = share(s.verbrauch, s.budget)
                const level = budgetShareLevel(p, watchPct)
                const isPlan = s.leaf && s.plan === 'all'
                return (
                  <tr key={s.ID} className={`ls-row${s.leaf ? '' : ' bud-row-parent'}`}>
                    <td className="ls-td">
                      <div className="bud-el" style={{ paddingLeft: depth * 16 }}>
                        <span className="bud-el-abbr">{s.ABBR || `#${s.ID}`}</span>
                        {s.NAME && <span className="bud-el-name">{s.NAME}</span>}
                      </div>
                      {isPlan && (
                        <div className="prl-sub" style={{ paddingLeft: depth * 16 }}>
                          nach Plan · {fmtHours(s.bookedHours ?? 0)} von {s.planHours != null ? `${fmtHours(s.planHours)} h` : NO_VALUE} gebucht
                        </div>
                      )}
                      {!s.leaf && s.plan === 'some' && <div className="prl-sub" style={{ paddingLeft: depth * 16 }}>teils nach Plan</div>}
                    </td>
                    <td className="ls-td ls-col-num">{money(s.budget)}</td>
                    <td className="ls-td ls-col-num">{money(s.verbrauch)}</td>
                    <td className="ls-td bud-col-share">
                      <div className="bud-share">
                        <span className="bud-bar" aria-hidden="true">
                          <span className={`bud-bar-fill${level === 'critical' ? ' bud-bar-fill--over' : level === 'watch' ? ' bud-bar-fill--watch' : ''}`} style={{ width: `${Math.min(100, p ?? 0)}%` }} />
                        </span>
                        <ShareValue pct={p} watchPct={watchPct} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </FormSection>
  )
}

// ── Warnregeln ─────────────────────────────────────────────────────────────────

function RegelTabelle({ overview, canEdit, onEdit, onDelete }: {
  overview: BudgetWarningOverview
  canEdit:  boolean
  onEdit:   (r: BudgetWarningRule) => void
  onDelete: (r: BudgetWarningRule) => void
}) {
  const byId = new Map(overview.structures.map(s => [s.ID, s]))
  return (
    <div className="table-scroll">
      <table className="ls-table bud-table">
        <thead>
          <tr>
            <th scope="col" className="ls-th">Gilt für</th>
            <th scope="col" className="ls-th ls-col-num">Schwelle</th>
            <th scope="col" className="ls-th ls-col-num">Stand</th>
            <th scope="col" className="ls-th">Empfänger</th>
            <th scope="col" className="ls-th">Status</th>
            {canEdit && <th scope="col" className="ls-th prl-col-actions"><span className="sr-only">Aktionen</span></th>}
          </tr>
        </thead>
        <tbody>
          {overview.rules.map(r => {
            const s = r.STRUCTURE_ID ? byId.get(r.STRUCTURE_ID) : undefined
            const budget = r.STRUCTURE_ID ? s?.budget ?? 0 : overview.projectAggregate.budget
            const verbrauch = r.STRUCTURE_ID ? s?.verbrauch ?? 0 : overview.projectAggregate.verbrauch
            const limitEur = budget * Number(r.THRESHOLD_PCT) / 100
            const reached = limitEur > 0 && verbrauch >= limitEur
            const label = r.STRUCTURE_ID ? elementLabel(s, r.STRUCTURE_ID) : 'ganzes Projekt'
            const pctTxt = `${Number(r.THRESHOLD_PCT).toFixed(0)} %`
            return (
              <tr key={r.ID} className="ls-row">
                <td className="ls-td">
                  <div className={r.STRUCTURE_ID ? 'prl-name' : 'prl-name bud-scope-project'}>{label}</div>
                  {s?.plan === 'all' && <div className="prl-sub">nach Plan</div>}
                  {s?.plan === 'some' && <div className="prl-sub">teils nach Plan</div>}
                </td>
                <td className="ls-td ls-col-num">
                  <div>{pctTxt}</div>
                  <div className="prl-sub">{fmtEur(limitEur)}</div>
                </td>
                <td className="ls-td ls-col-num">
                  <div>{fmtPct(share(verbrauch, budget))}</div>
                  <div className="prl-sub">{fmtEur(verbrauch)}</div>
                </td>
                <td className="ls-td bud-recipients">
                  {[
                    r.NOTIFY_PM     && 'Projektleiter',
                    r.NOTIFY_BOOKER && 'Verursacher',
                    (r.NOTIFY_CC?.length ?? 0) > 0 && `${r.NOTIFY_CC!.length} Person${r.NOTIFY_CC!.length === 1 ? '' : 'en'}`,
                  ].filter(Boolean).join(' · ') || 'niemand'}
                </td>
                <td className="ls-td">
                  {r.MUTED
                    ? <span className="bud-state-muted">stumm</span>
                    : reached
                      ? <KpiValue level="critical" reason={`Verbrauch hat ${pctTxt} erreicht`}>erreicht</KpiValue>
                      : <span className="bud-state">aktiv</span>}
                </td>
                {canEdit && (
                  <td className="ls-td prl-col-actions">
                    <div className="doc-actions">
                      <button type="button" className="row-action-btn" title="Bearbeiten" aria-label={`Regel ${pctTxt} für ${label} bearbeiten`} onClick={() => onEdit(r)}>
                        <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <button type="button" className="row-action-btn row-action-btn--danger" title="Löschen" aria-label={`Regel ${pctTxt} für ${label} löschen`} onClick={() => onDelete(r)}>
                        <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Meldungen({ overview }: { overview: BudgetWarningOverview }) {
  const byId = new Map(overview.structures.map(s => [s.ID, s]))
  return (
    <FormSection title="Letzte Meldungen" layout="block">
      <div className="table-scroll">
        <table className="ls-table bud-table">
          <thead>
            <tr>
              <th scope="col" className="ls-th">Zeit</th>
              <th scope="col" className="ls-th">Regel</th>
              <th scope="col" className="ls-th ls-col-num">Budget</th>
              <th scope="col" className="ls-th ls-col-num">Verbraucht</th>
              <th scope="col" className="ls-th">Status</th>
            </tr>
          </thead>
          <tbody>
            {overview.fired.map(f => {
              const rule = overview.rules.find(r => r.ID === f.RULE_ID)
              const label = rule
                ? `${rule.STRUCTURE_ID ? elementLabel(byId.get(rule.STRUCTURE_ID), rule.STRUCTURE_ID) : 'ganzes Projekt'} · ${Number(rule.THRESHOLD_PCT).toFixed(0)} %`
                : `Regel ${f.RULE_ID}`
              return (
                <tr key={f.ID} className="ls-row">
                  <td className="ls-td">{fmtDate(f.FIRED_AT)}</td>
                  <td className="ls-td">{label}</td>
                  <td className="ls-td ls-col-num">{money(f.BUDGET_EUR)}</td>
                  <td className="ls-td ls-col-num">{money(f.ACTUAL_EUR)}</td>
                  <td className="ls-td">
                    {f.RESET_AT
                      ? <span className="bud-state-muted">zurückgesetzt {fmtDate(f.RESET_AT)}</span>
                      : <KpiValue level="critical" reason="Verbrauch liegt noch über der Schwelle">offen</KpiValue>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </FormSection>
  )
}

function RegelDialog({ pid, overview, rule, onClose, onSaved }: {
  pid:      number
  overview: BudgetWarningOverview
  rule:     BudgetWarningRule | null
  onClose:  () => void
  onSaved:  (text: string) => void
}) {
  const isNew = rule == null
  const [draft, setDraft] = useState<RuleDraft>(() => rule ? {
    threshold_pct: String(rule.THRESHOLD_PCT),
    structure_id:  rule.STRUCTURE_ID != null ? String(rule.STRUCTURE_ID) : '',
    notify_pm:     rule.NOTIFY_PM,
    notify_booker: rule.NOTIFY_BOOKER,
    notify_cc:     Array.isArray(rule.NOTIFY_CC) ? rule.NOTIFY_CC : [],
    muted:         rule.MUTED,
  } : emptyDraft())
  const [msg, setMsg] = useState<string | null>(null)
  const { data: empData } = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const employees = empData?.data ?? []
  const elements = useMemo(() => inTreeOrder(overview.structures), [overview.structures])

  const mut = useMutation({
    mutationFn: () => {
      const common = {
        threshold_pct: Number(draft.threshold_pct),
        notify_pm:     draft.notify_pm,
        notify_booker: draft.notify_booker,
        notify_cc:     draft.notify_cc,
        muted:         draft.muted,
      }
      return isNew
        ? createBudgetRule(pid, { ...common, structure_id: draft.structure_id ? Number(draft.structure_id) : null })
        : updateBudgetRule(rule.ID, common)
    },
    onSuccess: () => onSaved(isNew ? 'Warnregel angelegt.' : 'Warnregel gespeichert.'),
    onError:   (e: Error) => setMsg(e.message),
  })

  function submit() {
    const n = Number(draft.threshold_pct)
    if (!Number.isFinite(n) || n <= 0 || n > 500) { setMsg('Die Schwelle muss über 0 und höchstens 500 % sein.'); return }
    setMsg(null); mut.mutate()
  }

  const toggleCc = (id: number, on: boolean) =>
    setDraft(d => ({ ...d, notify_cc: on ? [...d.notify_cc, id] : d.notify_cc.filter(x => x !== id) }))

  const scopeLabel = rule?.STRUCTURE_ID
    ? elementLabel(overview.structures.find(s => s.ID === rule.STRUCTURE_ID), rule.STRUCTURE_ID)
    : 'ganzes Projekt'

  return (
    <Modal open onClose={onClose} title={isNew ? 'Neue Warnregel' : 'Warnregel bearbeiten'}>
      <div className="master-form bud-dialog">
        {isNew ? (
          <div className="form-group">
            <label htmlFor="bud-scope">Gilt für</label>
            <select id="bud-scope" value={draft.structure_id} onChange={e => setDraft(d => ({ ...d, structure_id: e.target.value }))}>
              <option value="">Ganzes Projekt (Budget {fmtEur(overview.projectAggregate.budget)})</option>
              {elements.map(({ node: s, depth }) => (
                <option key={s.ID} value={s.ID}>
                  {`${'  '.repeat(depth)}${elementLabel(s, s.ID)} (Budget ${fmtEur(s.budget)})`}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="form-field-hint bud-dialog-scope">Gilt für: <strong>{scopeLabel}</strong></p>
        )}
        <div className="form-group">
          <label htmlFor="bud-threshold">Schwelle (% des Budgets)</label>
          <input id="bud-threshold" type="number" inputMode="decimal" min={0.1} max={500} step={0.1} data-autofocus
            value={draft.threshold_pct} onChange={e => setDraft(d => ({ ...d, threshold_pct: e.target.value }))} />
        </div>

        <fieldset className="ws-radio-group">
          <legend className="ws-legend-help">Wer wird benachrichtigt? <HelpHint id="notifications.budget.recipients" size={13} /></legend>
          <label className="ws-check">
            <input type="checkbox" checked={draft.notify_pm} onChange={e => setDraft(d => ({ ...d, notify_pm: e.target.checked }))} />
            <span>Projektleiter</span>
          </label>
          <label className="ws-check">
            <input type="checkbox" checked={draft.notify_booker} onChange={e => setDraft(d => ({ ...d, notify_booker: e.target.checked }))} />
            <span>Wer die auslösende Buchung erfasst hat</span>
          </label>
        </fieldset>

        {/* Hieß „CC-Empfänger (optional)" und war eine Mehrfachauswahl mit
            Strg-Klick. Es ist die einzige Stelle, an der sich eine feste Person
            eintragen lässt — wer PL und Verursacher abwählt, benachrichtigt
            genau diese Personen. */}
        <fieldset className="ws-radio-group">
          <legend>Weitere Personen</legend>
          <div className="bud-people">
            {employees.map(emp => (
              <label key={emp.ID} className="ws-check">
                <input type="checkbox" checked={draft.notify_cc.includes(emp.ID)} onChange={e => toggleCc(emp.ID, e.target.checked)} />
                <span>{`${emp.ABBR}${emp.FIRST_NAME || emp.LAST_NAME ? ` · ${emp.FIRST_NAME ?? ''} ${emp.LAST_NAME ?? ''}`.trimEnd() : ''}`}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <EmpfaengerVorschau draft={draft} employees={employees} projectManagerId={overview.project.PROJECT_MANAGER_ID ?? null} />

        <label className="ws-check">
          <input type="checkbox" checked={draft.muted} onChange={e => setDraft(d => ({ ...d, muted: e.target.checked }))} />
          <span>Regel stumm schalten (Überwachung läuft weiter, keine Benachrichtigung)</span>
        </label>

        <Message text={msg} type="error" />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={mut.isPending} onClick={submit}>
            {mut.isPending ? 'Speichert …' : isNew ? 'Anlegen' : 'Speichern'}
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}
