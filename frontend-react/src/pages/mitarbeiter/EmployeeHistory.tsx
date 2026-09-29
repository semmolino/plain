import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { useConfirm } from '@/hooks/useConfirm'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/store/permissionsStore'
import { useFeature } from '@/store/licenseStore'
import {
  fetchEmployeeWorkModels, createEmployeeWorkModel, updateEmployeeWorkModel, deleteEmployeeWorkModel,
  fetchEmployeeCpRates, createEmployeeCpRate, updateEmployeeCpRate, deleteEmployeeCpRate,
  type Employee, type WorkTimeModel,
} from '@/api/mitarbeiter'
import { fetchWorkingTimeModels } from '@/api/stammdaten'
import { AmountInput } from '@/components/ui/AmountInput'
import { FormSection } from '@/components/ui/FormSection'
import { Message } from '@/components/ui/Message'
import type { HelpId } from '@/help/helpContent'
import { fmtEur } from '@/utils/money'
import { fmtDateShort, latestValidId, todayLocal } from './mitarbeiterFormat'

/**
 * Datierte Verläufe der Mitarbeiterseite: Arbeitszeitmodell und Kostensatz
 * (UI-Pilot Runde 10).
 *
 * Vorher: zwei nahezu gleiche Tabellen im Dialog, Knöpfe „✎ × ✓ ✗" in 11px
 * ohne Beschriftung, Löschen ohne Rückfrage, das Datum als „2026-01-01" und
 * der Satz als „58.40 €/h". Beim Kostensatz ließ das Zahlenfeld „58,40" nicht
 * zu — der Wert kam als leere Eingabe an. Jetzt eine gemeinsame Tabelle mit
 * deutscher Schreibweise, Rückfrage beim Löschen und Warnung beim Verlassen,
 * solange ein angefangener Eintrag nicht gespeichert ist.
 */

interface HistRow { ID: number; VALID_FROM: string; value: string; display: ReactNode }

function HistBadge({ kind }: { kind: 'current' | 'planned' }) {
  return <span className={`ma-hist-badge ma-hist-badge--${kind}`}>{kind === 'current' ? 'gilt heute' : 'geplant'}</span>
}

function DatedHistory({ dirtyKey, title, help, hint, valueLabel, rows, loading, canEdit, readonlyNote, empty, renderInput, onAdd, onSave, onDelete, deleteMessage }: {
  dirtyKey:   string
  title:      string
  help?:      HelpId
  hint:       ReactNode
  valueLabel: string
  rows:       HistRow[]
  loading:    boolean
  canEdit:    boolean
  readonlyNote: string
  empty:      { note: string; why: string }
  renderInput: (value: string, onChange: (v: string) => void, id: string) => ReactNode
  onAdd:    (validFrom: string, value: string) => Promise<unknown>
  onSave:   (id: number, validFrom: string, value: string) => Promise<unknown>
  onDelete: (id: number) => Promise<unknown>
  deleteMessage: (row: HistRow) => string
}) {
  const [confirm, confirmDialog] = useConfirm()
  const [draft, setDraft] = useState<{ validFrom: string; value: string }>({ validFrom: todayLocal(), value: '' })
  const [editing, setEditing] = useState<{ id: number; validFrom: string; value: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const today = todayLocal()
  const currentId = latestValidId(rows, today)
  const sorted = [...rows].sort((a, b) => b.VALID_FROM.localeCompare(a.VALID_FROM))
  const editRow = editing ? rows.find(r => r.ID === editing.id) : undefined
  const editDirty = !!editing && !!editRow && (editing.validFrom !== editRow.VALID_FROM || editing.value !== editRow.value)
  const draftDirty = draft.value !== ''
  const dirty = editDirty || draftDirty

  async function run(action: () => Promise<unknown>, ok: string) {
    setPending(true)
    setMsg(null)
    try {
      await action()
      setMsg({ type: 'success', text: ok })
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error)?.message || 'Speichern fehlgeschlagen' })
      throw e
    } finally {
      setPending(false)
    }
  }

  const add = () => {
    if (!draft.validFrom || draft.value === '') {
      const text = `Bitte „Gültig ab" und „${valueLabel}" angeben.`
      setMsg({ type: 'error', text })
      return Promise.reject(new Error(text))
    }
    return run(async () => {
      await onAdd(draft.validFrom, draft.value)
      setDraft({ validFrom: today, value: '' })
    }, 'Eintrag hinzugefügt.')
  }
  const save = () => {
    if (!editing) return Promise.resolve()
    if (!editing.validFrom || editing.value === '') {
      const text = `Bitte „Gültig ab" und „${valueLabel}" angeben.`
      setMsg({ type: 'error', text })
      return Promise.reject(new Error(text))
    }
    return run(async () => { await onSave(editing.id, editing.validFrom, editing.value); setEditing(null) }, 'Eintrag gespeichert.')
  }
  async function remove(row: HistRow) {
    const ok = await confirm({ title: 'Eintrag löschen?', message: deleteMessage(row), confirmLabel: 'Löschen' })
    if (!ok) return
    await run(() => onDelete(row.ID), 'Eintrag gelöscht.').catch(() => {})
  }

  useRegisterDirty(dirtyKey, {
    dirty,
    label: title,
    count: (editDirty ? 1 : 0) + (draftDirty ? 1 : 0),
    save: async () => { if (editDirty) await save(); if (draftDirty) await add() },
  })

  return (
    <div className="ws-form">
      {!canEdit && <p className="ws-form-readonly">{readonlyNote}</p>}
      <FormSection title={title} help={help} hint={hint} layout="block">
        {loading ? <p className="empty-note">Lädt …</p> : !rows.length ? (
          <div className="empty-block">
            <p className="empty-note">{empty.note}</p>
            <p className="empty-block-why">{empty.why}</p>
          </div>
        ) : (
          <table className="master-table ma-hist-table">
            <thead>
              <tr>
                <th scope="col">Gültig ab</th>
                <th scope="col">{valueLabel}</th>
                {canEdit && <th scope="col"><span className="sr-only">Aktionen</span></th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => editing?.id === r.ID ? (
                <tr key={r.ID} className="ma-hist-editing">
                  <td>
                    <label className="sr-only" htmlFor={`${dirtyKey}-e-date`}>Gültig ab</label>
                    <input id={`${dirtyKey}-e-date`} type="date" className="inline-date-input" value={editing.validFrom}
                      onChange={e => setEditing(x => x && ({ ...x, validFrom: e.target.value }))} />
                  </td>
                  <td>{renderInput(editing.value, v => setEditing(x => x && ({ ...x, value: v })), `${dirtyKey}-e-val`)}</td>
                  <td className="ma-hist-actions">
                    <button type="button" className="btn-secondary btn-small" onClick={() => setEditing(null)} disabled={pending}>Abbrechen</button>
                    <button type="button" className="btn-primary btn-small" onClick={() => void save().catch(() => {})} disabled={pending || !editDirty}>Speichern</button>
                  </td>
                </tr>
              ) : (
                <tr key={r.ID}>
                  <td className="cell-nowrap">
                    {fmtDateShort(r.VALID_FROM)}
                    {r.ID === currentId ? <HistBadge kind="current" /> : r.VALID_FROM > today ? <HistBadge kind="planned" /> : null}
                  </td>
                  <td>{r.display}</td>
                  {canEdit && (
                    <td className="ma-hist-actions">
                      <button type="button" className="row-action-btn" title="Ändern" aria-label={`Eintrag ab ${fmtDateShort(r.VALID_FROM)} ändern`}
                        onClick={() => { setEditing({ id: r.ID, validFrom: r.VALID_FROM, value: r.value }); setMsg(null) }} disabled={pending}>
                        <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                      <button type="button" className="row-action-btn row-action-btn--danger" title="Löschen" aria-label={`Eintrag ab ${fmtDateShort(r.VALID_FROM)} löschen`}
                        onClick={() => void remove(r)} disabled={pending}>
                        <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </FormSection>

      {canEdit && (
        <FormSection title="Neuer Eintrag">
          <div className="form-group">
            <label htmlFor={`${dirtyKey}-n-date`}>Gültig ab</label>
            <input id={`${dirtyKey}-n-date`} type="date" value={draft.validFrom} onChange={e => setDraft(d => ({ ...d, validFrom: e.target.value }))} />
          </div>
          <div className="form-group">
            <label htmlFor={`${dirtyKey}-n-val`}>{valueLabel}</label>
            {renderInput(draft.value, v => setDraft(d => ({ ...d, value: v })), `${dirtyKey}-n-val`)}
          </div>
          <div className="form-section-wide ma-hist-add">
            <button type="button" className="btn-primary" onClick={() => void add().catch(() => {})} disabled={pending || !draftDirty || !draft.validFrom}>
              <Plus size={14} strokeWidth={2} aria-hidden="true" />Hinzufügen
            </button>
          </div>
        </FormSection>
      )}

      <Message type={msg?.type ?? 'info'} text={msg?.text ?? null} />
      {confirmDialog}
    </div>
  )
}

// ── Arbeitszeitmodell ───────────────────────────────────────────────────────

const WEEK: (keyof Pick<WorkTimeModel, 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'>)[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const weekHours = (m: WorkTimeModel) => WEEK.reduce((s, d) => s + Number(m[d] || 0), 0)
const hoursText = (n: number) => `${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })} h/Woche`

export function ArbeitszeitVerlauf({ employee }: { employee: Employee }) {
  const qc = useQueryClient()
  const canEdit = usePermission('employees.edit')
  const { data, isLoading } = useQuery({ queryKey: ['emp-work-models', employee.ID], queryFn: () => fetchEmployeeWorkModels(employee.ID) })
  const { data: modelData } = useQuery({ queryKey: ['working-time-models'], queryFn: fetchWorkingTimeModels })
  const models = modelData?.data ?? []
  const nameOf = (id: string) => models.find(m => String(m.ID) === id)?.NAME ?? `Modell ${id}`
  const rows: HistRow[] = (data?.data ?? []).map(w => ({
    ID: w.ID, VALID_FROM: w.VALID_FROM, value: String(w.MODEL_ID),
    display: w.model
      ? <>{w.model.NAME}<span className="ma-hist-sub"> · {hoursText(weekHours(w.model))}</span></>
      : `Modell ${w.MODEL_ID}`,
  }))
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['emp-work-models', employee.ID] }),
    qc.invalidateQueries({ queryKey: ['employees'] }),
  ])

  return (
    <DatedHistory
      dirtyKey="ma-arbeitszeit"
      title="Arbeitszeitmodell"
      hint="Das Modell bestimmt die Soll-Stunden je Tag und damit Zeitkonto und Saldo. Es gilt ab dem Datum bis zum nächsten Eintrag."
      valueLabel="Modell"
      rows={rows}
      loading={isLoading}
      canEdit={canEdit}
      readonlyNote={'Nur Lesen — zum Ändern fehlt das Recht „Mitarbeiter bearbeiten".'}
      empty={{ note: 'Noch kein Arbeitszeitmodell zugeordnet.', why: 'Ohne Modell gibt es keine Soll-Stunden: Zeitkonto und Saldo bleiben leer, und die Arbeitszeit-Prüfung kennt keine Grenzen für diesen Mitarbeiter.' }}
      renderInput={(value, onChange, id) => (
        <select id={id} value={value} onChange={e => onChange(e.target.value)}>
          <option value="">Bitte wählen …</option>
          {models.map(m => <option key={m.ID} value={m.ID}>{m.NAME} · {hoursText(weekHours(m))}</option>)}
        </select>
      )}
      onAdd={async (validFrom, value) => { await createEmployeeWorkModel(employee.ID, { model_id: Number(value), valid_from: validFrom }); await refresh() }}
      onSave={async (id, validFrom, value) => { await updateEmployeeWorkModel(employee.ID, id, { model_id: Number(value), valid_from: validFrom }); await refresh() }}
      onDelete={async id => { await deleteEmployeeWorkModel(employee.ID, id); await refresh() }}
      deleteMessage={r => `Die Zuordnung „${nameOf(r.value)}" ab ${fmtDateShort(r.VALID_FROM)} wird gelöscht. Ab diesem Tag gilt dann wieder das Modell davor — Zeitkonto und Saldo rechnen neu.`}
    />
  )
}

// ── Kostensatz ──────────────────────────────────────────────────────────────

export function KostensatzVerlauf({ employee }: { employee: Employee }) {
  const qc = useQueryClient()
  const canEdit = usePermission('employees.salary.edit')
  // Kostensätze hängen an der Lizenz-Capability „employees.salary". Fehlt
  // sie, antwortet der Server mit 402 — ohne diesen Hinweis stand dann
  // „noch kein Verlauf" da, obwohl die Sätze gespeichert sind.
  const inTariff = useFeature('employees.salary')
  const { data, isLoading } = useQuery({ queryKey: ['emp-cp-rates', employee.ID], queryFn: () => fetchEmployeeCpRates(employee.ID), enabled: inTariff })
  if (!inTariff) {
    return (
      <div className="ws-form">
        <Message type="info" text={'Kostensätze sind in deinem Tarif nicht enthalten. Bereits erfasste oder importierte Sätze bleiben gespeichert — sichtbar und bearbeitbar werden sie mit einem Tarif, der „Gehalt & Kostensätze" umfasst.'} />
      </div>
    )
  }
  const rows: HistRow[] = (data?.data ?? []).map(r => ({
    ID: r.ID, VALID_FROM: r.VALID_FROM, value: String(r.COST_RATE),
    display: <span className="ma-balance">{fmtEur(Number(r.COST_RATE))}/h</span>,
  }))
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['emp-cp-rates', employee.ID] }),
    qc.invalidateQueries({ queryKey: ['employees'] }),
  ])

  return (
    <DatedHistory
      dirtyKey="ma-kostensatz"
      title="Kostensatz"
      help="mitarbeiter.kostensatz_liste"
      hint="Was eine Stunde dieses Mitarbeiters das Büro kostet. Neue Buchungen nehmen den Satz, der an ihrem Tag gilt; schon gebuchte Stunden behalten ihren Satz."
      valueLabel="Kostensatz (€/h)"
      rows={rows}
      loading={isLoading}
      canEdit={canEdit}
      readonlyNote={'Nur Lesen — zum Ändern fehlt das Recht „Gehalt bearbeiten".'}
      empty={{ note: 'Noch kein Kostensatz erfasst.', why: 'Ohne Satz bleiben die Stunden dieses Mitarbeiters in der Kostenauswertung unbewertet — das ist etwas anderes als 0 €/h.' }}
      renderInput={(value, onChange, id) => <AmountInput id={id} value={value} onChange={onChange} placeholder="z. B. 58,40" />}
      onAdd={async (validFrom, value) => { await createEmployeeCpRate(employee.ID, { cost_rate: Number(value), valid_from: validFrom }); await refresh() }}
      onSave={async (id, validFrom, value) => { await updateEmployeeCpRate(employee.ID, id, { cost_rate: Number(value), valid_from: validFrom }); await refresh() }}
      onDelete={async id => { await deleteEmployeeCpRate(employee.ID, id); await refresh() }}
      deleteMessage={r => `Der Satz ${fmtEur(Number(r.value))}/h ab ${fmtDateShort(r.VALID_FROM)} wird gelöscht. Neue Buchungen ab diesem Tag nehmen dann den Satz davor.`}
    />
  )
}
