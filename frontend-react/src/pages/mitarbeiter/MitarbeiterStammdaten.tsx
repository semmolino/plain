import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useConfirm } from '@/hooks/useConfirm'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/store/permissionsStore'
import { useAuthStore } from '@/store/authStore'
import { fetchEmployeeGenders, updateEmployee, type Employee, type UpdateEmployeePayload } from '@/api/mitarbeiter'
import { fetchDepartments } from '@/api/stammdaten'
import { ActionBar } from '@/components/ui/ActionBar'
import { FormSection } from '@/components/ui/FormSection'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message } from '@/components/ui/Message'

/**
 * Reiter „Stammdaten" der Mitarbeiterseite (UI-Pilot Runde 10).
 *
 * Vorher: ein Dialog mit einer langen Spalte, der nach dem Speichern von
 * selbst zuging und beim Schließen nicht nachfragte. Er schickte immer alle
 * Felder — wer nur die Abteilung änderte, überschrieb nebenbei, was ein
 * Kollege zwischendurch am selben Mitarbeiter geändert hatte.
 *
 * Jetzt im Muster von Projekt- und Angebotsdaten: Eingaben liegen über dem
 * geladenen Stand, die Aktionsleiste zählt sie, gesendet werden nur die
 * geänderten Felder. Die E-Mail eines anderen Kontos ist gesperrt, solange
 * das Recht „Passwörter setzen" fehlt — über sie läuft „Passwort vergessen".
 */

interface MaForm {
  abbr: string; title: string; first_name: string; last_name: string
  gender_id: string; birth_date: string
  mail: string; phone: string; mobile: string
  personnel_number: string; department_id: string; supervisor_id: string
  entry_date: string; exit_date: string; active: string
  dashboard_role: string; notes: string
}
type MaField = keyof MaForm

const FIELDS: MaField[] = [
  'abbr', 'title', 'first_name', 'last_name', 'gender_id', 'birth_date',
  'mail', 'phone', 'mobile', 'personnel_number', 'department_id', 'supervisor_id',
  'entry_date', 'exit_date', 'active', 'dashboard_role', 'notes',
]

export const DASHBOARD_ROLES: { value: string; label: string }[] = [
  { value: 'geschaeftsleitung', label: 'Geschäftsleitung' },
  { value: 'controller',        label: 'Controller / Buchhaltung' },
  { value: 'bereichsleiter',    label: 'Projektleiter' },
  { value: 'mitarbeiter',       label: 'Mitarbeiter' },
]

const s = (v: string | number | null | undefined) => (v == null ? '' : String(v))
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : '')

function formFrom(e: Employee): MaForm {
  return {
    abbr: s(e.ABBR), title: s(e.TITLE), first_name: s(e.FIRST_NAME), last_name: s(e.LAST_NAME),
    gender_id: s(e.GENDER_ID), birth_date: day(e.BIRTH_DATE),
    mail: s(e.MAIL), phone: s(e.PHONE), mobile: s(e.MOBILE),
    personnel_number: s(e.PERSONNEL_NUMBER), department_id: s(e.DEPARTMENT_ID), supervisor_id: s(e.SUPERVISOR_ID),
    entry_date: day(e.ENTRY_DATE), exit_date: day(e.EXIT_DATE), active: e.ACTIVE === 2 ? '2' : '1',
    dashboard_role: s(e.DASHBOARD_ROLE), notes: s(e.NOTES),
  }
}

export function missingEmployeeFields(f: Pick<MaForm, 'abbr' | 'first_name' | 'last_name' | 'gender_id'>): string[] {
  const m: string[] = []
  if (!f.abbr.trim())       m.push('Kürzel')
  if (!f.first_name.trim()) m.push('Vorname')
  if (!f.last_name.trim())  m.push('Nachname')
  if (!f.gender_id)         m.push('Geschlecht')
  return m
}

/** Nur die geänderten Felder, in der Form, die der Server erwartet. */
function changedPayload(form: MaForm, saved: MaForm): Partial<UpdateEmployeePayload> {
  const out: Record<string, unknown> = {}
  for (const k of FIELDS) {
    if (form[k] === saved[k]) continue
    const v = form[k]
    switch (k) {
      case 'gender_id':      out[k] = Number(v); break
      case 'active':         out[k] = Number(v); break
      case 'department_id':
      case 'supervisor_id':  out[k] = v ? Number(v) : null; break
      case 'birth_date':
      case 'entry_date':
      case 'exit_date':
      case 'dashboard_role': out[k] = v || null; break
      default:               out[k] = v
    }
  }
  return out as Partial<UpdateEmployeePayload>
}

export function MitarbeiterStammdaten({ employee, employees }: { employee: Employee; employees: Employee[] }) {
  // Neuer Zustand je Mitarbeiter — offene Eingaben gehören zu genau einem.
  return <StammdatenFormular key={employee.ID} employee={employee} employees={employees} />
}

function StammdatenFormular({ employee, employees }: { employee: Employee; employees: Employee[] }) {
  const qc = useQueryClient()
  const canEdit = usePermission('employees.edit')
  const canSetAccess = usePermission('employees.password.set')
  const ownId = useAuthStore(st => st.employeeId)
  const isSelf = ownId != null && Number(ownId) === employee.ID
  const mailLocked = !isSelf && !canSetAccess
  const [confirm, confirmDialog] = useConfirm()
  const [edits, setEdits] = useState<Partial<MaForm>>({})
  const [pending, setPending] = useState(false)
  const [tried, setTried] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: genData }  = useQuery({ queryKey: ['emp-genders'], queryFn: fetchEmployeeGenders })
  const { data: deptData } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const genders = genData?.data ?? []
  const departments = deptData?.data ?? []

  const saved = useMemo(() => formFrom(employee), [employee])
  const form: MaForm = { ...saved, ...edits }
  const changed = FIELDS.filter(k => form[k] !== saved[k]).length
  const dirty = changed > 0
  const missing = missingEmployeeFields(form)
  const exitBeforeEntry = !!form.entry_date && !!form.exit_date && form.exit_date < form.entry_date
  const problems = exitBeforeEntry ? [...missing, 'Austritt'] : missing
  const bad = (label: string) => (tried && problems.includes(label) ? true : undefined)

  // Der Mitarbeiter selbst steht nicht zur Wahl — niemand ist sein eigener
  // Vorgesetzter (das prüft seit Runde 10 auch der Server).
  const supervisors = useMemo(() => employees
    .filter(m => m.ID !== employee.ID && (m.ACTIVE !== 2 || String(m.ID) === form.supervisor_id))
    .sort((a, b) => (a.ABBR || '').localeCompare(b.ABBR || '', 'de')), [employees, employee.ID, form.supervisor_id])

  const set = (k: MaField, v: string) => { setEdits(e => ({ ...e, [k]: v })); setMsg(null) }

  async function save() {
    setTried(true)
    if (missing.length || exitBeforeEntry) {
      const text = missing.length
        ? `Bitte noch angeben: ${missing.join(', ')}.`
        : 'Der Austritt liegt vor dem Eintritt.'
      setMsg({ type: 'error', text })
      throw new Error(text)
    }
    setPending(true)
    setMsg(null)
    try {
      await updateEmployee(employee.ID, changedPayload(form, saved))
      // Erst den neuen Stand holen, dann die Eingaben verwerfen — sonst
      // stünde kurz der alte Wert im Feld.
      await qc.invalidateQueries({ queryKey: ['employees'] })
      void qc.invalidateQueries({ queryKey: ['license-usage'] })
      void qc.invalidateQueries({ queryKey: ['employee-access', employee.ID] })
      setEdits({})
      setTried(false)
      setMsg({ type: 'success', text: 'Stammdaten gespeichert.' })
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
      message: `${changed === 1 ? '1 Änderung geht' : `${changed} Änderungen gehen`} verloren. Der Mitarbeiter bleibt, wie er gespeichert ist.`,
      confirmLabel: 'Verwerfen',
    })
    if (ok) { setEdits({}); setMsg(null); setTried(false) }
  }

  useRegisterDirty('mitarbeiter-stammdaten', { dirty, label: 'Stammdaten', count: changed, save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, canEdit)

  const status = pending ? 'Speichert …'
    : dirty ? `${changed} ${changed === 1 ? 'Feld' : 'Felder'} geändert`
    : 'Keine Änderungen'
  const id = (k: string) => `ma-${k}`
  const text = (k: MaField, label: string, extra: Record<string, unknown> = {}) => (
    <div className="form-group">
      <label htmlFor={id(k)}>{label}</label>
      <input id={id(k)} type="text" value={form[k]} onChange={e => set(k, e.target.value)} {...extra} />
    </div>
  )
  const date = (k: MaField, label: string, invalid?: boolean) => (
    <div className="form-group">
      <label htmlFor={id(k)}>{label}</label>
      <input id={id(k)} type="date" value={form[k]} onChange={e => set(k, e.target.value)} aria-invalid={invalid} />
    </div>
  )

  return (
    <div className="ws-form">
      {!canEdit && (
        <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Mitarbeiter bearbeiten".</p>
      )}

      <fieldset className="ws-form-fields" disabled={!canEdit || pending}>
        <legend className="sr-only">Stammdaten</legend>

        <FormSection title="Person">
          {text('abbr', 'Kürzel *', { 'aria-invalid': bad('Kürzel'), autoComplete: 'off' })}
          {text('title', 'Titel', { placeholder: 'z. B. Dipl.-Ing.' })}
          {text('first_name', 'Vorname *', { 'aria-invalid': bad('Vorname') })}
          {text('last_name', 'Nachname *', { 'aria-invalid': bad('Nachname') })}
          <div className="form-group">
            <label htmlFor={id('gender')}>Geschlecht *</label>
            <select id={id('gender')} value={form.gender_id} onChange={e => set('gender_id', e.target.value)} aria-invalid={bad('Geschlecht')}>
              <option value="">Bitte wählen …</option>
              {genders.map(g => <option key={g.ID} value={g.ID}>{g.GENDER}</option>)}
            </select>
          </div>
          {date('birth_date', 'Geburtstag')}
        </FormSection>

        <FormSection title="Kontakt">
          <div className="form-group">
            <label htmlFor={id('mail')}>E-Mail</label>
            <input id={id('mail')} type="email" value={form.mail} onChange={e => set('mail', e.target.value)}
              disabled={mailLocked} aria-describedby={id('mail-hint')} autoComplete="off" />
            <p id={id('mail-hint')} className="form-field-hint">
              {mailLocked
                ? 'Ändern darf sie nur, wer Zugänge verwaltet (Recht „Passwörter setzen") — über diese Adresse läuft „Passwort vergessen".'
                : 'Anmeldename und Adresse für „Passwort vergessen".'}
            </p>
          </div>
          {text('phone', 'Telefon', { type: 'tel', inputMode: 'tel' })}
          {text('mobile', 'Mobil', { type: 'tel', inputMode: 'tel' })}
        </FormSection>

        <FormSection title="Beschäftigung">
          {text('personnel_number', 'Personalnummer', { inputMode: 'numeric' })}
          <div className="form-group">
            <label htmlFor={id('dept')}>Abteilung</label>
            <select id={id('dept')} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
              <option value="">— keine —</option>
              {departments.map(d => <option key={d.ID} value={d.ID}>{d.ABBR}</option>)}
            </select>
          </div>
          {date('entry_date', 'Eintritt')}
          {date('exit_date', 'Austritt', bad('Austritt'))}
          <div className="form-group">
            <label htmlFor={id('sup')} className="ws-label-help">Vorgesetzter <HelpHint id="mitarbeiter.vorgesetzter" size={13} /></label>
            <select id={id('sup')} value={form.supervisor_id} onChange={e => set('supervisor_id', e.target.value)}>
              <option value="">— keiner —</option>
              {supervisors.map(m => <option key={m.ID} value={m.ID}>{m.ABBR} · {m.FIRST_NAME} {m.LAST_NAME}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={id('active')} className="ws-label-help">Status <HelpHint id="mitarbeiter.status" size={13} /></label>
            <select id={id('active')} value={form.active} onChange={e => set('active', e.target.value)} disabled={isSelf}>
              <option value="1">Aktiv</option>
              <option value="2">Inaktiv</option>
            </select>
            {isSelf && <p className="form-field-hint">Das eigene Konto lässt sich nicht deaktivieren.</p>}
          </div>
        </FormSection>

        <FormSection title="Übersicht und Notiz">
          <div className="form-group">
            <label htmlFor={id('dash')} className="ws-label-help">Dashboard-Rolle <HelpHint id="mitarbeiter.dashboard_rolle" size={13} /></label>
            <select id={id('dash')} value={form.dashboard_role} onChange={e => set('dashboard_role', e.target.value)}>
              <option value="">— Standard —</option>
              {DASHBOARD_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="form-group form-section-wide">
            <label htmlFor={id('notes')}>Notiz</label>
            <textarea id={id('notes')} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
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
