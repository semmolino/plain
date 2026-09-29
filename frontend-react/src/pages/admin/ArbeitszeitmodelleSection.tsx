import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { FormSection } from '@/components/ui/FormSection'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message } from '@/components/ui/Message'
import { Modal } from '@/components/ui/Modal'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import {
  fetchWorkingTimeModels, createWorkingTimeModel, updateWorkingTimeModel, deleteWorkingTimeModel,
  fetchCountryStates,
  type WorkingTimeModel, type WorkingTimeModelPayload, type CountryState,
} from '@/api/stammdaten'
import { fetchBreakRules } from '@/api/arbzg'

/**
 * Einstellungen → Stammdaten → Arbeitszeitmodelle (UI-Pilot Runde 12).
 *
 * Vorher Teil der langen Stammdatenseite: ein Formularkasten, der sich unter
 * der Tabelle aufklappte, Beschriftungen ohne Bezug zum Feld, „✎" und „×"
 * als Knöpfe, Löschen ohne Rückfrage und `type="number"`, das „7,5" nicht
 * nahm. Am Handy lief die 11-spaltige Tabelle aus dem Bild. Der Server nahm
 * jedes Soll an, auch −8 oder 30 Stunden (jetzt geprüft,
 * `services/workingTimeModels.js`).
 */

const DAYS = [
  ['mon', 'MON', 'Mo', 'Montag'], ['tue', 'TUE', 'Di', 'Dienstag'], ['wed', 'WED', 'Mi', 'Mittwoch'],
  ['thu', 'THU', 'Do', 'Donnerstag'], ['fri', 'FRI', 'Fr', 'Freitag'], ['sat', 'SAT', 'Sa', 'Samstag'], ['sun', 'SUN', 'So', 'Sonntag'],
] as const
type DayKey = typeof DAYS[number][0]

const COUNTRIES = [{ code: 'DE', label: 'Deutschland' }, { code: 'AT', label: 'Österreich' }, { code: 'CH', label: 'Schweiz' }]

const TEMPLATES: { label: string; days: Record<DayKey, number> }[] = [
  { label: 'Vollzeit 40 h (Mo–Fr)', days: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 } },
  { label: 'Teilzeit 30 h (Mo–Fr)', days: { mon: 6, tue: 6, wed: 6, thu: 6, fri: 6, sat: 0, sun: 0 } },
  { label: 'Teilzeit 20 h (Mo–Fr)', days: { mon: 4, tue: 4, wed: 4, thu: 4, fri: 4, sat: 0, sun: 0 } },
  { label: '4-Tage 32 h (Mo–Do)',   days: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 0, sat: 0, sun: 0 } },
]

const fmtH = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')
const weekHours = (m: WorkingTimeModel) => DAYS.reduce((s, [, col]) => s + (Number(m[col]) || 0), 0)

/** „Mo–Fr je 8 h" statt sieben Zahlen — für die Handy-Karte. */
function daySummary(m: WorkingTimeModel): string {
  const h = DAYS.map(([, col]) => Number(m[col]) || 0)
  const [mo, di, mi, dO, fr, sa, so] = h
  if (sa === 0 && so === 0 && mo > 0 && [di, mi, dO, fr].every(x => x === mo)) return `Mo–Fr je ${fmtH(mo)} h`
  const parts = DAYS.map(([, , short], i) => (h[i] > 0 ? `${short} ${fmtH(h[i])}` : null)).filter(Boolean)
  return parts.length ? `${parts.join(' · ')} h` : 'kein Soll'
}

export function ArbeitszeitmodelleSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const narrow = useIsNarrow()
  const canEdit = usePermission('settings.work_time.edit')
  const [confirm, confirmDialog] = useConfirm()
  const [dialog, setDialog] = useState<{ model: WorkingTimeModel | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({ queryKey: ['working-time-models'], queryFn: fetchWorkingTimeModels })
  const { data: statesRes } = useQuery({ queryKey: ['country-states'], queryFn: fetchCountryStates })
  const models = data?.data ?? []
  const states: Record<string, CountryState[]> = statesRes?.data ?? {}

  const place = (m: WorkingTimeModel) => {
    const country = COUNTRIES.find(c => c.code === m.COUNTRY_CODE)?.label ?? m.COUNTRY_CODE
    if (!m.STATE_CODE) return country
    return states[m.COUNTRY_CODE]?.find(s => s.code === m.STATE_CODE)?.label ?? m.STATE_CODE
  }

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteWorkingTimeModel(id),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['working-time-models'] }); toast.success('Arbeitszeitmodell gelöscht.') },
    onError: (e: Error) => setErr(e.message),
  })
  async function askDelete(m: WorkingTimeModel) {
    setErr(null)
    const ok = await confirm({
      title: 'Arbeitszeitmodell löschen?',
      message: `„${m.NAME}“ wird gelöscht. Ist es noch jemandem zugeordnet, bleibt es stehen, und Sie sehen, wem.`,
      confirmLabel: 'Löschen',
    })
    if (ok) deleteMut.mutate(m.ID)
  }

  const actions = (m: WorkingTimeModel) => canEdit && (
    <span className="st-row-actions">
      <button type="button" className="row-action-btn" onClick={() => { setErr(null); setDialog({ model: m }) }}
        aria-label={`${m.NAME} bearbeiten`} title="Bearbeiten">
        <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button type="button" className="row-action-btn row-action-btn--danger" onClick={() => void askDelete(m)}
        disabled={deleteMut.isPending} aria-label={`${m.NAME} löschen`} title="Löschen">
        <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </span>
  )
  const sub = (m: WorkingTimeModel) => [place(m), m.MODEL_TYPE === 'TRUST' ? 'Vertrauensarbeitszeit' : null, m.IS_MINOR_PROFILE ? 'U18' : null]
    .filter(Boolean).join(' · ')

  let body: ReactNode
  if (isLoading) body = <p className="empty-note">Lädt …</p>
  else if (isError) body = <Message type="error" text="Die Arbeitszeitmodelle konnten nicht geladen werden." />
  else if (models.length === 0) body = (
    <p className="st-empty">
      {canEdit ? 'Noch keine Modelle. Legen Sie z. B. „Vollzeit 40 h“ an und ordnen Sie es auf der Mitarbeiterseite zu — ohne Modell rechnen Zeitkonto und Urlaub mit Mo–Fr.'
        : 'Noch keine Modelle.'}
    </p>
  )
  else if (narrow) body = (
    <ul className="st-cards" aria-label="Arbeitszeitmodelle">
      {models.map(m => (
        <li key={m.ID} className="st-card">
          <div className="st-card-main">
            <span className="st-type-name">{m.NAME}</span>
            <span className="st-card-sub">{daySummary(m)} · {fmtH(weekHours(m))} h/Woche</span>
            <span className="st-card-sub">{sub(m)}</span>
          </div>
          {actions(m)}
        </li>
      ))}
    </ul>
  )
  else body = (
    <div className="table-scroll st-table-wrap">
      <table className="master-table st-table">
        <thead>
          <tr>
            <th scope="col">Modell</th>
            {DAYS.map(([k, , short, long]) => <th key={k} scope="col" className="num"><abbr title={long}>{short}</abbr></th>)}
            <th scope="col" className="num">Woche</th>
            {canEdit && <th scope="col"><span className="sr-only">Aktionen</span></th>}
          </tr>
        </thead>
        <tbody>
          {models.map(m => (
            <tr key={m.ID}>
              <th scope="row">
                <span className="st-type-name">{m.NAME}</span>
                <span className="st-role-name">{sub(m)}</span>
              </th>
              {DAYS.map(([k, col]) => {
                const h = Number(m[col]) || 0
                return <td key={k} className={`num${h === 0 ? ' st-zero' : ''}`}>{fmtH(h)}</td>
              })}
              <td className="num st-week">{fmtH(weekHours(m))} h</td>
              {canEdit && <td className="st-row-actions-cell">{actions(m)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <FormSection
      title="Arbeitszeitmodelle" help="settings.arbeitszeitmodelle" layout="block" className="st-section"
      hint="Soll-Stunden je Wochentag — daraus rechnen Zeitkonto, Urlaubstage und Monatsabschluss."
      actions={canEdit ? (
        <button type="button" className="btn-primary st-btn" onClick={() => { setErr(null); setDialog({ model: null }) }}>
          <Plus size={14} strokeWidth={2} aria-hidden="true" />Neues Modell
        </button>
      ) : undefined}
    >
      <Message type="error" text={err} />
      {body}
      {!canEdit && <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Arbeitszeit-Einstellungen“.</p>}
      {dialog && <ModellDialog model={dialog.model} states={states} onClose={() => setDialog(null)} />}
      {confirmDialog}
    </FormSection>
  )
}

interface WtmForm {
  name: string; country: string; state: string
  days: Record<DayKey, string>
  modelType: 'FIXED' | 'TRUST'; breakRule: string; maxDaily: string; minRest: string; minor: boolean
}

function formFrom(m: WorkingTimeModel | null): WtmForm {
  const days = {} as Record<DayKey, string>
  for (const [k, col] of DAYS) days[k] = m ? fmtH(Number(m[col]) || 0) : '0'
  return {
    name: m?.NAME ?? '', country: m?.COUNTRY_CODE ?? 'DE', state: m?.STATE_CODE ?? '', days,
    modelType: m?.MODEL_TYPE ?? 'FIXED', breakRule: m?.BREAK_RULE_ID != null ? String(m.BREAK_RULE_ID) : '',
    maxDaily: fmtH(m?.MAX_DAILY_HOURS ?? 10), minRest: fmtH(m?.MIN_REST_HOURS ?? 11), minor: !!m?.IS_MINOR_PROFILE,
  }
}

const num = (s: string) => Number(s.trim().replace(',', '.'))
const hoursOk = (s: string, min: number) => s.trim() === '' || (/^\d+([.,]\d{1,2})?$/.test(s.trim()) && num(s) >= min && num(s) <= 24)

function ModellDialog({ model, states, onClose }: { model: WorkingTimeModel | null; states: Record<string, CountryState[]>; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const initial = useMemo(() => formFrom(model), [model])
  const [f, setF] = useState<WtmForm>(initial)
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)

  const { data: brRes } = useQuery({ queryKey: ['break-rules'], queryFn: fetchBreakRules })
  const breakRules = brRes?.data ?? []
  const stateOptions = (states[f.country] ?? []).filter(s => s.code !== null)

  const badDays = DAYS.filter(([k]) => !hoursOk(f.days[k], 0)).map(([, , , long]) => long)
  const week = DAYS.reduce((s, [k]) => s + (hoursOk(f.days[k], 0) ? num(f.days[k] || '0') : 0), 0)
  const problems = [
    ...(!f.name.trim() ? ['Bitte einen Namen angeben.'] : []),
    ...(badDays.length ? [`Stunden je Tag zwischen 0 und 24 (${badDays.join(', ')}).`] : []),
    ...(!hoursOk(f.maxDaily, 1) ? ['Max. Tagesarbeit: 1 bis 24 Stunden.'] : []),
    ...(!hoursOk(f.minRest, 1) ? ['Mindest-Ruhezeit: 1 bis 24 Stunden.'] : []),
  ]

  const set = <K extends keyof WtmForm>(k: K, v: WtmForm[K]) => { setF(x => ({ ...x, [k]: v })); setErr(null) }
  const setDay = (k: DayKey, v: string) => { setF(x => ({ ...x, days: { ...x.days, [k]: v } })); setErr(null) }

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: WorkingTimeModelPayload = {
        name: f.name.trim(), country_code: f.country, state_code: f.state || null,
        mon: num(f.days.mon || '0'), tue: num(f.days.tue || '0'), wed: num(f.days.wed || '0'), thu: num(f.days.thu || '0'),
        fri: num(f.days.fri || '0'), sat: num(f.days.sat || '0'), sun: num(f.days.sun || '0'),
        model_type: f.modelType, break_rule_id: f.breakRule ? Number(f.breakRule) : null,
        max_daily_hours: f.maxDaily.trim() ? num(f.maxDaily) : 10,
        min_rest_hours:  f.minRest.trim() ? num(f.minRest) : 11,
        is_minor_profile: f.minor,
      }
      if (model) await updateWorkingTimeModel(model.ID, payload)
      else await createWorkingTimeModel(payload)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['working-time-models'] })
      toast.success(model ? `„${f.name.trim()}“ gespeichert.` : `„${f.name.trim()}“ angelegt.`)
      onClose()
    },
    onError: (e: Error) => setErr(e.message),
  })

  function save() {
    if (saveMut.isPending) return
    setTried(true)
    if (problems.length) { setErr(problems.join(' ')); return }
    setErr(null)
    saveMut.mutate()
  }
  async function requestClose() {
    if (saveMut.isPending) return
    if (dirty && !(await confirm({ title: 'Eingaben verwerfen?', message: model ? 'Das Modell bleibt, wie es war.' : 'Es wird kein Modell angelegt.', confirmLabel: 'Verwerfen' }))) return
    onClose()
  }
  useCtrlS(save, true)

  return (
    <>
      <Modal open onClose={() => void requestClose()} title={model ? `${model.NAME} bearbeiten` : 'Neues Arbeitszeitmodell'}>
        <div className="st-dialog">
          {!model && (
            <div className="st-templates" role="group" aria-label="Vorlagen">
              <span className="st-templates-label">Vorlage:</span>
              {TEMPLATES.map(t => (
                <button key={t.label} type="button" className="btn-small"
                  onClick={() => setF(x => ({ ...x, days: Object.fromEntries(DAYS.map(([k]) => [k, fmtH(t.days[k])])) as Record<DayKey, string> }))}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="wtm-name">Name*</label>
              <input id="wtm-name" type="text" value={f.name} maxLength={100} autoComplete="off" placeholder="z. B. Vollzeit BY"
                aria-invalid={tried && !f.name.trim() ? true : undefined} onChange={e => set('name', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="wtm-country">Land*</label>
              <select id="wtm-country" value={f.country} onChange={e => setF(x => ({ ...x, country: e.target.value, state: '' }))}>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="wtm-state">Bundesland</label>
              <select id="wtm-state" value={f.state} onChange={e => set('state', e.target.value)} disabled={!stateOptions.length}
                aria-describedby="wtm-state-hint">
                <option value="">— gesamtes Land —</option>
                {stateOptions.map(s => <option key={s.code!} value={s.code!}>{s.label}</option>)}
              </select>
              <p id="wtm-state-hint" className="form-field-hint">Bestimmt die Feiertage.</p>
            </div>
          </div>

          <fieldset className="st-days">
            <legend>Soll-Stunden je Tag <span className="st-days-sum">· {fmtH(week)} h/Woche</span></legend>
            <div className="st-days-grid">
              {DAYS.map(([k, , short, long]) => (
                <div key={k} className="st-day">
                  <label htmlFor={`wtm-${k}`}><abbr title={long}>{short}</abbr></label>
                  <input id={`wtm-${k}`} type="text" inputMode="decimal" autoComplete="off" value={f.days[k]}
                    aria-label={`${long}, Stunden`} aria-invalid={tried && !hoursOk(f.days[k], 0) ? true : undefined}
                    onChange={e => setDay(k, e.target.value)} onFocus={e => e.target.select()} />
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset className="st-arbzg">
            <legend className="ws-label-help">Arbeitszeitgesetz<HelpHint id="arbzg.break_rule" size={13} /></legend>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="wtm-type">Modelltyp</label>
                <select id="wtm-type" value={f.modelType} onChange={e => set('modelType', e.target.value === 'TRUST' ? 'TRUST' : 'FIXED')}>
                  <option value="FIXED">Fest — das Soll wird angezeigt</option>
                  <option value="TRUST">Vertrauensarbeitszeit — ohne Soll-Anzeige</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="wtm-break">Pausenregel</label>
                <select id="wtm-break" value={f.breakRule} onChange={e => set('breakRule', e.target.value)}>
                  <option value="">— Standard des Büros —</option>
                  {breakRules.map(br => (
                    <option key={br.ID} value={br.ID}>
                      {br.NAME} (ab {fmtH(br.T1_HOURS)} h {br.T1_BREAK_MIN} min, ab {fmtH(br.T2_HOURS)} h {br.T2_BREAK_MIN} min)
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="wtm-max">Max. Tagesarbeit (h)</label>
                <input id="wtm-max" type="text" inputMode="decimal" autoComplete="off" value={f.maxDaily} placeholder="10"
                  aria-invalid={tried && !hoursOk(f.maxDaily, 1) ? true : undefined} onChange={e => set('maxDaily', e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="wtm-rest">Mindest-Ruhezeit (h)</label>
                <input id="wtm-rest" type="text" inputMode="decimal" autoComplete="off" value={f.minRest} placeholder="11"
                  aria-invalid={tried && !hoursOk(f.minRest, 1) ? true : undefined} onChange={e => set('minRest', e.target.value)} />
              </div>
            </div>
            <label className="ws-check">
              <input type="checkbox" checked={f.minor} onChange={e => set('minor', e.target.checked)} />
              <span>Jugendarbeitsschutz (unter 18): höchstens 8 h am Tag, 12 h Ruhezeit</span>
            </label>
          </fieldset>
          <Message type="error" text={err} />
        </div>
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={() => void requestClose()}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={save} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Speichert …' : model ? 'Speichern' : 'Anlegen'}
          </button>
        </DialogFooter>
      </Modal>
      {confirmDialog}
    </>
  )
}
