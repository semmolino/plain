import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, X, Plus, BellOff, Bell } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { fetchActiveEmployees } from '@/api/projekte'
import {
  fetchBudgetOverview,
  createBudgetRule,
  updateBudgetRule,
  deleteBudgetRule,
  setProjectMute,
  type BudgetWarningRule,
} from '@/api/budgetWarnings'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s); if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
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

export function Budget({ initialProjectId }: Props) {
  const [pid, setPid] = useState<number | null>(initialProjectId ?? null)
  const [editingRule, setEditingRule] = useState<BudgetWarningRule | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<RuleDraft>({
    threshold_pct: '75',
    structure_id:  '',
    notify_pm:     true,
    notify_booker: true,
    notify_cc:     [],
    muted:         false,
  })

  // Projektauswahl kommt zentral aus dem Seitenkopf (ProjectPicker).
  useEffect(() => { setPid(initialProjectId ?? null) }, [initialProjectId])

  const qc = useQueryClient()
  const { data: empData }      = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const { data: ovData, isLoading } = useQuery({
    queryKey: ['budget-overview', pid],
    queryFn:  () => fetchBudgetOverview(pid!),
    enabled:  pid !== null,
  })

  const employees = empData?.data ?? []
  const overview = ovData?.data ?? null

  function invalidate() { qc.invalidateQueries({ queryKey: ['budget-overview', pid] }) }

  const createMut = useMutation({
    mutationFn: (b: RuleDraft) => createBudgetRule(pid!, {
      threshold_pct: Number(b.threshold_pct),
      structure_id:  b.structure_id ? Number(b.structure_id) : null,
      notify_pm:     b.notify_pm,
      notify_booker: b.notify_booker,
      notify_cc:     b.notify_cc,
      muted:         b.muted,
    }),
    onSuccess: () => { invalidate(); setCreating(false); resetDraft() },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, b }: { id: number; b: RuleDraft }) => updateBudgetRule(id, {
      threshold_pct: Number(b.threshold_pct),
      notify_pm:     b.notify_pm,
      notify_booker: b.notify_booker,
      notify_cc:     b.notify_cc,
      muted:         b.muted,
    }),
    onSuccess: () => { invalidate(); setEditingRule(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteBudgetRule(id),
    onSuccess:  () => invalidate(),
  })

  const muteMut = useMutation({
    mutationFn: (m: boolean) => setProjectMute(pid!, m),
    onSuccess:  () => invalidate(),
  })

  function resetDraft() {
    setDraft({ threshold_pct: '75', structure_id: '', notify_pm: true, notify_booker: true, notify_cc: [], muted: false })
  }

  function openEdit(rule: BudgetWarningRule) {
    setDraft({
      threshold_pct: String(rule.THRESHOLD_PCT),
      structure_id:  rule.STRUCTURE_ID != null ? String(rule.STRUCTURE_ID) : '',
      notify_pm:     rule.NOTIFY_PM,
      notify_booker: rule.NOTIFY_BOOKER,
      notify_cc:     Array.isArray(rule.NOTIFY_CC) ? rule.NOTIFY_CC : [],
      muted:         rule.MUTED,
    })
    setEditingRule(rule)
  }

  // Map structure_id → label (kurz)
  const structureLabel = useMemo(() => {
    const m = new Map<number, string>()
    if (overview?.structures) for (const s of overview.structures) m.set(s.ID, `#${s.ID}`)
    return m
  }, [overview])

  // Verbrauch & Budget pro Regel ermitteln (für die Anzeige in der Tabelle)
  function calcForRule(rule: BudgetWarningRule): { budget: number; verbrauch: number; pctActual: number; limitEur: number } {
    if (!overview) return { budget: 0, verbrauch: 0, pctActual: 0, limitEur: 0 }
    let budget = 0, verbrauch = 0
    if (rule.STRUCTURE_ID) {
      const s = overview.structures.find(x => x.ID === rule.STRUCTURE_ID)
      if (s) { budget = s.budget; verbrauch = s.verbrauch }
    } else {
      budget = overview.projectAggregate.budget
      verbrauch = overview.projectAggregate.verbrauch
    }
    const pctActual = budget > 0 ? (verbrauch / budget) * 100 : 0
    const limitEur = budget * rule.THRESHOLD_PCT / 100
    return { budget, verbrauch, pctActual, limitEur }
  }

  return (
    <div className="ls-wrap">
      {!pid && <p className="ls-empty">Bitte oben ein Projekt auswählen.</p>}
      {pid && isLoading && <p className="ls-empty">Lade …</p>}

      {pid && !isLoading && overview && (
        <>
          {/* KPI Kacheln */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200, padding: '14px 16px', background: 'rgba(17, 24, 39, 0.04)', border: '1px solid rgba(17, 24, 39, 0.10)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#374151', fontWeight: 600, marginBottom: 4 }}>HONORAR + ZUSCHLÄGE</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{fmtEur(overview.projectAggregate.budget)}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>ohne Nebenkosten</div>
            </div>
            <div style={{ flex: 1, minWidth: 200, padding: '14px 16px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#92400e', fontWeight: 600, marginBottom: 4 }}>VERBRAUCHT</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#78350f' }}>{fmtEur(overview.projectAggregate.verbrauch)}</div>
              <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>
                {overview.projectAggregate.budget > 0
                  ? `${(overview.projectAggregate.verbrauch / overview.projectAggregate.budget * 100).toFixed(1).replace('.', ',')} %`
                  : '—'}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200, padding: '14px 16px', background: overview.project.BUDGET_WARNINGS_MUTED ? 'rgba(156, 163, 175, 0.10)' : 'rgba(34, 197, 94, 0.08)', border: overview.project.BUDGET_WARNINGS_MUTED ? '1px solid rgba(156, 163, 175, 0.30)' : '1px solid rgba(34, 197, 94, 0.25)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: overview.project.BUDGET_WARNINGS_MUTED ? '#4b5563' : '#166534', fontWeight: 600, marginBottom: 4 }}>STATUS</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: overview.project.BUDGET_WARNINGS_MUTED ? '#374151' : '#14532d', marginBottom: 6 }}>
                {overview.project.BUDGET_WARNINGS_MUTED ? 'Stumm geschaltet' : 'Aktiv'}
              </div>
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={() => muteMut.mutate(!overview.project.BUDGET_WARNINGS_MUTED)}
                disabled={muteMut.isPending}
              >
                {overview.project.BUDGET_WARNINGS_MUTED
                  ? <><Bell size={13} strokeWidth={2} /> Stummschaltung aufheben</>
                  : <><BellOff size={13} strokeWidth={2} /> Projekt stumm schalten</>}
              </button>
            </div>
          </div>

          {/* Regeln-Tabelle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Schwellwert-Regeln</h3>
            <button className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => { resetDraft(); setCreating(true) }}>
              <Plus size={14} strokeWidth={2} /> Neue Regel
            </button>
          </div>

          {overview.rules.length === 0 && (
            <p className="ls-empty">Noch keine Regeln definiert.</p>
          )}

          {overview.rules.length > 0 && (
            <div className="table-scroll">
              <table className="ls-table">
                <thead>
                  <tr>
                    <th className="ls-th">Scope</th>
                    <th className="ls-th ls-col-num">Schwelle %</th>
                    <th className="ls-th ls-col-num">Schwelle €</th>
                    <th className="ls-th ls-col-num">Verbraucht</th>
                    <th className="ls-th ls-col-num">Verbraucht %</th>
                    <th className="ls-th">Empfänger</th>
                    <th className="ls-th">Status</th>
                    <th className="ls-th" style={{ width: 100 }}>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.rules.map(r => {
                    const calc = calcForRule(r)
                    const reached = calc.verbrauch >= calc.limitEur && calc.limitEur > 0
                    return (
                      <tr key={r.ID} className="ls-row">
                        <td className="ls-td">
                          {r.STRUCTURE_ID
                            ? <span>Struktur {structureLabel.get(r.STRUCTURE_ID) ?? r.STRUCTURE_ID}</span>
                            : <strong>Projekt-Ebene</strong>}
                        </td>
                        <td className="ls-td ls-col-num">{Number(r.THRESHOLD_PCT).toFixed(0)} %</td>
                        <td className="ls-td ls-col-num">{fmtEur(calc.limitEur)}</td>
                        <td className="ls-td ls-col-num">{fmtEur(calc.verbrauch)}</td>
                        <td className="ls-td ls-col-num" style={{ color: reached ? '#b91c1c' : undefined, fontWeight: reached ? 600 : undefined }}>
                          {calc.pctActual.toFixed(1).replace('.', ',')} %
                        </td>
                        <td className="ls-td" style={{ fontSize: 12 }}>
                          {[
                            r.NOTIFY_PM     && 'PL',
                            r.NOTIFY_BOOKER && 'Booker',
                            (r.NOTIFY_CC?.length ?? 0) > 0 && `+${r.NOTIFY_CC!.length} CC`,
                          ].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="ls-td">
                          {r.MUTED
                            ? <span style={{ color: '#9ca3af', fontSize: 12 }}>stumm</span>
                            : reached
                              ? <span style={{ color: '#b91c1c', fontSize: 12, fontWeight: 600 }}>überschritten</span>
                              : <span style={{ color: '#16a34a', fontSize: 12 }}>aktiv</span>}
                        </td>
                        <td className="ls-td">
                          <button className="row-action-btn" title="Bearbeiten" onClick={() => openEdit(r)}>
                            <Pencil size={14} strokeWidth={2} />
                          </button>
                          <button className="row-action-btn" title="Löschen" onClick={() => {
                            if (window.confirm(`Regel bei ${Number(r.THRESHOLD_PCT).toFixed(0)} % wirklich löschen?`)) deleteMut.mutate(r.ID)
                          }}>
                            <X size={12} strokeWidth={2.5} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Fired-History */}
          {overview.fired.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Letzte Auslösungen</h3>
              <div className="table-scroll">
                <table className="ls-table">
                  <thead>
                    <tr>
                      <th className="ls-th">Zeit</th>
                      <th className="ls-th">Regel</th>
                      <th className="ls-th ls-col-num">Budget</th>
                      <th className="ls-th ls-col-num">Verbraucht</th>
                      <th className="ls-th">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.fired.map(f => {
                      const rule = overview.rules.find(r => r.ID === f.RULE_ID)
                      const label = rule
                        ? rule.STRUCTURE_ID
                          ? `Struktur ${structureLabel.get(rule.STRUCTURE_ID) ?? rule.STRUCTURE_ID} @ ${Number(rule.THRESHOLD_PCT).toFixed(0)} %`
                          : `Projekt @ ${Number(rule.THRESHOLD_PCT).toFixed(0)} %`
                        : `#${f.RULE_ID}`
                      return (
                        <tr key={f.ID} className="ls-row">
                          <td className="ls-td">{fmtDate(f.FIRED_AT)}</td>
                          <td className="ls-td">{label}</td>
                          <td className="ls-td ls-col-num">{fmtEur(f.BUDGET_EUR)}</td>
                          <td className="ls-td ls-col-num">{fmtEur(f.ACTUAL_EUR)}</td>
                          <td className="ls-td">{f.RESET_AT ? <span style={{ color: '#6b7280', fontSize: 12 }}>zurückgesetzt {fmtDate(f.RESET_AT)}</span> : <span style={{ color: '#b91c1c', fontSize: 12, fontWeight: 600 }}>offen</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create / Edit Modal */}
      <Modal open={creating || editingRule != null} onClose={() => { setCreating(false); setEditingRule(null) }}
        title={creating ? 'Neue Schwellwert-Regel' : 'Regel bearbeiten'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 360 }}>
          {creating && (
            <div className="form-group">
              <label>Scope</label>
              <select value={draft.structure_id} onChange={e => setDraft(d => ({ ...d, structure_id: e.target.value }))}>
                <option value="">Projekt-Ebene</option>
                {overview?.structures.map(s => (
                  <option key={s.ID} value={s.ID}>Struktur #{s.ID} (Budget {fmtEur(s.budget)})</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Schwelle (%)</label>
            <input type="number" min={0.1} max={500} step={0.1}
              value={draft.threshold_pct}
              onChange={e => setDraft(d => ({ ...d, threshold_pct: e.target.value }))} />
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={draft.notify_pm}
                onChange={e => setDraft(d => ({ ...d, notify_pm: e.target.checked }))} />
              <span>Projektleiter benachrichtigen</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
              <input type="checkbox" checked={draft.notify_booker}
                onChange={e => setDraft(d => ({ ...d, notify_booker: e.target.checked }))} />
              <span>Verursachende Mitarbeiter benachrichtigen</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
              <input type="checkbox" checked={draft.muted}
                onChange={e => setDraft(d => ({ ...d, muted: e.target.checked }))} />
              <span>Regel stumm schalten</span>
            </label>
          </div>
          <div className="form-group">
            <label>CC-Empfänger (optional)</label>
            <select multiple value={draft.notify_cc.map(String)}
              onChange={e => {
                const sel = Array.from(e.target.selectedOptions).map(o => Number(o.value))
                setDraft(d => ({ ...d, notify_cc: sel }))
              }}
              style={{ minHeight: 100 }}>
              {employees.map(emp => (
                <option key={emp.ID} value={emp.ID}>{emp.SHORT_NAME}</option>
              ))}
            </select>
            <p className="admin-section-hint">Strg-/Cmd-Klick für Mehrfachauswahl</p>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn-secondary" onClick={() => { setCreating(false); setEditingRule(null) }}>
              Abbrechen
            </button>
            <button className="btn-primary"
              disabled={createMut.isPending || updateMut.isPending}
              onClick={() => {
                if (editingRule) updateMut.mutate({ id: editingRule.ID, b: draft })
                else             createMut.mutate(draft)
              }}>
              Speichern
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
