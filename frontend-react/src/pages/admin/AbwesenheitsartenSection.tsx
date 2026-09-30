import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Plus, Check } from 'lucide-react'
import { ActionBar } from '@/components/ui/ActionBar'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { FormSection } from '@/components/ui/FormSection'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message } from '@/components/ui/Message'
import { Modal } from '@/components/ui/Modal'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useToast } from '@/store/toastStore'
import { usePermission } from '@/store/permissionsStore'
import {
  fetchAbsenceTypes, createAbsenceType, updateAbsenceType, deleteAbsenceType,
  fetchAbsenceSettings, putAbsenceSettings,
  type AbsenceType, type AbsenceTypePayload,
} from '@/api/abwesenheit'

/**
 * Einstellungen → Stammdaten → Abwesenheitsarten (UI-Pilot Runde 12).
 *
 * Vorher: der Verfall des Urlaubsübertrags hatte einen eigenen
 * Speichern-Knopf mitten auf der Seite, und ein Effekt setzte die Eingabe
 * bei jedem Nachladen zurück. Die Arten standen in einer 12-px-Tabelle,
 * deren Häkchen für Screenreader stumm waren; was die Kennzeichen bedeuten,
 * stand nur im `title` (am Handy unerreichbar). Eine neue Art startete mit
 * der Farbe `var(--accent)` — für ein Farbfeld kein Wert, der Wähler zeigte
 * Schwarz.
 */

interface FormState {
  name:              string
  color:             string
  counts_as_worked:  boolean
  reduces_vacation:  boolean
  requires_approval: boolean
  is_paid:           boolean
  active:            boolean
}

/** Vorgabefarbe einer neuen Art — gespeicherter Wert, kein Token (Okabe-Ito-Blau). */
const DEFAULT_COLOR = '#0072b2'

function emptyForm(): FormState {
  return { name: '', color: DEFAULT_COLOR, counts_as_worked: true, reduces_vacation: false, requires_approval: true, is_paid: true, active: true }
}
function toForm(t: AbsenceType): FormState {
  return {
    name: t.NAME, color: /^#[0-9a-f]{6}$/i.test(t.COLOR ?? '') ? t.COLOR! : DEFAULT_COLOR,
    counts_as_worked: t.COUNTS_AS_WORKED, reduces_vacation: t.REDUCES_VACATION,
    requires_approval: t.REQUIRES_APPROVAL, is_paid: t.IS_PAID, active: t.ACTIVE !== 0,
  }
}

const FLAGS: { key: 'counts_as_worked' | 'reduces_vacation' | 'requires_approval' | 'is_paid'; col: keyof AbsenceType; label: string; hint: string }[] = [
  { key: 'counts_as_worked',  col: 'COUNTS_AS_WORKED',  label: 'Zählt als gearbeitet', hint: 'Der Tag gilt im Zeitkonto als erfüllt — z. B. Urlaub, Krankheit.' },
  { key: 'reduces_vacation',  col: 'REDUCES_VACATION',  label: 'Zehrt vom Urlaub',     hint: 'Die Arbeitstage gehen vom Urlaubsanspruch ab — in der Regel nur beim Urlaub.' },
  { key: 'requires_approval', col: 'REQUIRES_APPROVAL', label: 'Freigabepflichtig',    hint: 'Ein Antrag zählt erst, wenn er genehmigt ist.' },
  { key: 'is_paid',           col: 'IS_PAID',           label: 'Bezahlt',              hint: 'Kennzeichen für Auswertungen.' },
]

function Flag({ on }: { on: boolean }) {
  return on
    ? <><Check size={15} strokeWidth={2.25} className="st-flag-on" aria-hidden="true" /><span className="sr-only">ja</span></>
    : <><span className="st-flag-off" aria-hidden="true">—</span><span className="sr-only">nein</span></>
}

export function AbwesenheitsartenSection() {
  // Die Aktionsleiste gehört ans Seitenende, nicht zwischen die Abschnitte —
  // der Verfall liefert Abschnitt und Leiste getrennt.
  const verfall = useVerfall()
  return (
    <div className="ws-form">
      {verfall.section}
      <AbsenceTypesList />
      {verfall.bar}
    </div>
  )
}

function AbsenceTypesList() {
  const qc = useQueryClient()
  const toast = useToast()
  const narrow = useIsNarrow()
  const canManage = usePermission('absence.manage')
  const [confirm, confirmDialog] = useConfirm()
  const [dialog, setDialog] = useState<{ type: AbsenceType | null } | null>(null)

  const { data, isLoading, isError } = useQuery({ queryKey: ['absence-types'], queryFn: fetchAbsenceTypes })
  const rows = data?.data ?? []

  const delMut = useMutation({
    mutationFn: deleteAbsenceType,
    onSuccess: (r, _id) => {
      void qc.invalidateQueries({ queryKey: ['absence-types'] })
      toast.success(r?.deactivated ? 'Die Art wird noch verwendet und ist jetzt deaktiviert.' : 'Abwesenheitsart gelöscht.')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function askDelete(t: AbsenceType) {
    const ok = await confirm({
      title: 'Abwesenheitsart löschen?',
      message: `„${t.NAME}“ wird gelöscht. Ist sie schon verwendet, wird sie stattdessen deaktiviert — bestehende Einträge behalten sie.`,
      confirmLabel: 'Löschen',
    })
    if (ok) delMut.mutate(t.ID)
  }

  const actions = (t: AbsenceType) => canManage && (
    <span className="st-row-actions">
      <button type="button" className="row-action-btn" onClick={() => setDialog({ type: t })}
        aria-label={`${t.NAME} bearbeiten`} title="Bearbeiten">
        <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button type="button" className="row-action-btn row-action-btn--danger" onClick={() => void askDelete(t)}
        disabled={delMut.isPending} aria-label={`${t.NAME} löschen`} title="Löschen">
        <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </span>
  )
  const name = (t: AbsenceType) => (
    <span className="abs-type">
      {/* Die Farbe ist ein gespeicherter Wert der Art, kein Token. */}
      <span className="abs-type-dot" style={{ background: t.COLOR || 'var(--text-4)' }} aria-hidden="true" />
      <span className="st-type-name">{t.NAME}</span>
      {t.ACTIVE === 0 && <span className="st-badge">inaktiv</span>}
    </span>
  )

  let body: ReactNode
  if (isLoading) body = <p className="empty-note">Lädt …</p>
  else if (isError) body = <Message type="error" text="Die Abwesenheitsarten konnten nicht geladen werden." />
  else if (rows.length === 0) body = (
    <p className="st-empty">
      {canManage ? 'Noch keine Abwesenheitsarten. Legen Sie mit „Neue Art“ z. B. „Urlaub“ und „Krankheit“ an — erst dann lassen sich Abwesenheiten beantragen.'
        : 'Noch keine Abwesenheitsarten.'}
    </p>
  )
  else if (narrow) body = (
    <ul className="st-cards" aria-label="Abwesenheitsarten">
      {rows.map(t => (
        <li key={t.ID} className={`st-card${t.ACTIVE === 0 ? ' st-card--inactive' : ''}`}>
          <div className="st-card-main">
            {name(t)}
            <span className="st-card-sub">{FLAGS.filter(f => !!t[f.col]).map(f => f.label).join(' · ') || 'keine Kennzeichen'}</span>
          </div>
          {actions(t)}
        </li>
      ))}
    </ul>
  )
  else body = (
    <div className="table-scroll st-table-wrap">
      <table className="master-table st-table">
        <thead>
          <tr>
            <th scope="col">Art</th>
            {FLAGS.map(f => <th key={f.key} scope="col" className="st-flag-col">{f.label}</th>)}
            {canManage && <th scope="col"><span className="sr-only">Aktionen</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.ID} className={t.ACTIVE === 0 ? 'st-row--inactive' : undefined}>
              <th scope="row">{name(t)}</th>
              {FLAGS.map(f => <td key={f.key} className="st-flag-col"><Flag on={!!t[f.col]} /></td>)}
              {canManage && <td className="st-row-actions-cell">{actions(t)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <FormSection
      title="Abwesenheitsarten" help="settings.abwesenheitsarten" layout="block" className="st-section"
      hint="Wozu man abwesend sein kann — und was das fürs Zeitkonto und den Urlaub heißt."
      actions={canManage ? (
        <button type="button" className="btn-primary st-btn" onClick={() => setDialog({ type: null })}>
          <Plus size={14} strokeWidth={2} aria-hidden="true" />Neue Art
        </button>
      ) : undefined}
    >
      {body}
      {!canManage && <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Abwesenheiten verwalten“.</p>}
      {dialog && <AbwesenheitsartDialog existing={dialog.type} taken={rows} onClose={() => setDialog(null)} />}
      {confirmDialog}
    </FormSection>
  )
}

// ── Verfall des Resturlaub-Übertrags (mandantenweit) ──────────────────────────

interface Verfall { expires: boolean; mm: string; dd: string }
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function useVerfall(): { section: ReactNode; bar: ReactNode } {
  const qc = useQueryClient()
  const toast = useToast()
  const canManage = usePermission('absence.manage')
  const [confirm, confirmDialog] = useConfirm()
  const { data, isLoading } = useQuery({ queryKey: ['absence-settings'], queryFn: fetchAbsenceSettings })
  const [edits, setEdits] = useState<Partial<Verfall>>({})
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const saved = useMemo<Verfall>(() => {
    const [m, d] = (data?.data?.carryoverExpiryDate || '03-31').split('-')
    return { expires: !!data?.data?.carryoverExpires, mm: m || '03', dd: d || '31' }
  }, [data])
  const f: Verfall = { ...saved, ...edits }
  const maxDay = DAYS_IN[Number(f.mm) - 1] ?? 31
  const dd = Number(f.dd) > maxDay ? String(maxDay).padStart(2, '0') : f.dd
  const changed = (f.expires !== saved.expires ? 1 : 0) + (f.expires && (f.mm !== saved.mm || dd !== saved.dd) ? 1 : 0)
  const dirty = changed > 0

  async function save() {
    if (!dirty || pending) return
    setPending(true); setErr(null)
    try {
      await putAbsenceSettings({ carryoverExpires: f.expires, carryoverExpiryDate: `${f.mm}-${dd}` })
      await qc.invalidateQueries({ queryKey: ['absence-settings'] })
      void qc.invalidateQueries({ queryKey: ['vacation-balance'] })
      void qc.invalidateQueries({ queryKey: ['my-vacation-balance'] })
      setEdits({})
      toast.success('Verfall des Urlaubsübertrags gespeichert.')
    } catch (e) {
      setErr((e as Error)?.message || 'Speichern fehlgeschlagen')
      throw e
    } finally {
      setPending(false)
    }
  }
  async function discard() {
    if (await confirm({ title: 'Änderung verwerfen?', message: 'Der Verfall bleibt, wie er gespeichert ist.', confirmLabel: 'Verwerfen' })) {
      setEdits({}); setErr(null)
    }
  }

  useRegisterDirty('abwesenheit-verfall', { dirty, label: 'Urlaubsübertrag', count: changed, save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, canManage)

  const section = (
    <>
      <FormSection title="Urlaubsübertrag und Verfall" help="absence.carryover_expiry"
        hint="Ob nicht genommener Übertrag aus dem Vorjahr zu einem Stichtag verfällt. Aus: er wird unbegrenzt vorgetragen.">
        {isLoading ? <p className="empty-note form-section-wide">Lädt …</p> : (
          <fieldset className="ws-form-fields form-section-wide st-verfall" disabled={!canManage || pending}>
            <legend className="sr-only">Verfall des Urlaubsübertrags</legend>
            <label className="ws-check">
              <input type="checkbox" checked={f.expires} onChange={e => { setEdits(x => ({ ...x, expires: e.target.checked })); setErr(null) }} />
              <span>Übertrag verfällt zum Stichtag</span>
            </label>
            {f.expires && (
              <div className="st-date" role="group" aria-labelledby="vf-date-label">
                <span id="vf-date-label" className="st-date-label">Stichtag (jedes Jahr)</span>
                <label className="sr-only" htmlFor="vf-day">Tag</label>
                <select id="vf-day" value={dd} onChange={e => setEdits(x => ({ ...x, dd: e.target.value }))}>
                  {Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, '0')).map(d => <option key={d} value={d}>{Number(d)}.</option>)}
                </select>
                <label className="sr-only" htmlFor="vf-month">Monat</label>
                <select id="vf-month" value={f.mm} onChange={e => setEdits(x => ({ ...x, mm: e.target.value }))}>
                  {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
                </select>
                <span className="st-date-note">Vorgabe: 31. März</span>
              </div>
            )}
          </fieldset>
        )}
        {!canManage && <p className="ws-form-readonly form-section-wide">Nur Lesen — zum Ändern fehlt das Recht „Abwesenheiten verwalten“.</p>}
        <Message type="error" text={err} />
      </FormSection>
      {confirmDialog}
    </>
  )
  const bar = canManage && (
        <ActionBar
          dirty={dirty} quiet={!dirty && !pending}
          status={pending ? 'Speichert …' : dirty ? 'Verfall geändert' : 'Keine Änderungen'}
          secondary={dirty ? <button type="button" className="btn-secondary" onClick={() => void discard()} disabled={pending}>Verwerfen</button> : undefined}
        >
          <button type="button" className="btn-primary" onClick={() => void save().catch(() => {})} disabled={!dirty || pending}>
            {pending ? 'Speichert …' : 'Speichern'}
          </button>
        </ActionBar>
  )
  return { section, bar }
}

function AbwesenheitsartDialog({ existing, taken, onClose }: { existing: AbsenceType | null; taken: AbsenceType[]; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const isCreate = existing == null
  const initial = useMemo(() => (existing ? toForm(existing) : emptyForm()), [existing])
  const [form, setForm] = useState<FormState>(initial)
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const name = form.name.trim()
  const duplicate = !!name && taken.some(t => t.ID !== existing?.ID && t.NAME.trim().toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setForm(f => ({ ...f, [k]: v })); setErr(null) }

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: AbsenceTypePayload = {
        name,
        color:             form.color,
        counts_as_worked:  form.counts_as_worked,
        reduces_vacation:  form.reduces_vacation,
        requires_approval: form.requires_approval,
        is_paid:           form.is_paid,
        active:            form.active ? 1 : 0,
      }
      if (isCreate) await createAbsenceType(payload)
      else          await updateAbsenceType(existing.ID, payload)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['absence-types'] })
      toast.success(isCreate ? `„${name}“ angelegt.` : `„${name}“ gespeichert.`)
      onClose()
    },
    onError: (e: Error) => setErr(e.message),
  })

  function handleSave() {
    if (saveMut.isPending) return
    setTried(true)
    if (!name)     { setErr('Bitte einen Namen angeben.'); return }
    if (duplicate) { setErr(`Die Art „${name}“ gibt es schon.`); return }
    setErr(null); saveMut.mutate()
  }
  async function requestClose() {
    if (saveMut.isPending) return
    if (dirty && !(await confirm({ title: 'Eingaben verwerfen?', message: isCreate ? 'Es wird keine Art angelegt.' : 'Die Art bleibt, wie sie war.', confirmLabel: 'Verwerfen' }))) return
    onClose()
  }
  useCtrlS(handleSave, true)

  return (
    <>
      <Modal open onClose={() => void requestClose()} title={isCreate ? 'Neue Abwesenheitsart' : `${existing.NAME} bearbeiten`}>
        <div className="st-dialog">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="at-name">Name*</label>
              <input id="at-name" type="text" value={form.name} maxLength={80} autoComplete="off" placeholder="z. B. Urlaub"
                aria-invalid={tried && (!name || duplicate) ? true : undefined} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="form-group st-field-color">
              <label htmlFor="at-color">Farbe</label>
              <input id="at-color" type="color" value={form.color} onChange={e => set('color', e.target.value)} />
            </div>
          </div>
          <fieldset className="st-flags">
            <legend className="ws-label-help">Wirkung<HelpHint id="settings.abwesenheitsarten" size={13} /></legend>
            {FLAGS.map(f => (
              <div key={f.key} className="st-flag">
                <label className="ws-check">
                  <input type="checkbox" checked={form[f.key]} aria-describedby={`at-${f.key}-hint`} onChange={e => set(f.key, e.target.checked)} />
                  <span>{f.label}</span>
                </label>
                <p id={`at-${f.key}-hint`} className="form-field-hint st-flag-hint">{f.hint}</p>
              </div>
            ))}
            <div className="st-flag">
              <label className="ws-check">
                <input type="checkbox" checked={form.active} aria-describedby="at-active-hint" onChange={e => set('active', e.target.checked)} />
                <span>Aktiv</span>
              </label>
              <p id="at-active-hint" className="form-field-hint st-flag-hint">Nur aktive Arten stehen bei neuen Anträgen zur Wahl.</p>
            </div>
          </fieldset>
          <Message type="error" text={err} />
        </div>
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={() => void requestClose()}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Speichert …' : isCreate ? 'Anlegen' : 'Speichern'}
          </button>
        </DialogFooter>
      </Modal>
      {confirmDialog}
    </>
  )
}
