import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { FormSection } from '@/components/ui/FormSection'
import { AmountInput } from '@/components/ui/AmountInput'
import { Message } from '@/components/ui/Message'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { usePermission } from '@/store/permissionsStore'
import { useFeature } from '@/store/licenseStore'
import { useToast } from '@/store/toastStore'
import { nextPersonnelNumber } from '@/utils/vorbelegung'
import {
  createEmployee, createEmployeeWorkModel, createEmployeeCpRate, fetchEmployeeGenders,
  type Employee,
} from '@/api/mitarbeiter'
import { fetchDepartments, fetchWorkingTimeModels } from '@/api/stammdaten'
import { missingEmployeeFields } from './MitarbeiterStammdaten'
import { mitarbeiterHref } from './mitarbeiterUrl'
import { todayLocal } from './mitarbeiterFormat'

/**
 * Neuer Mitarbeiter (UI-Pilot Runde 10).
 *
 * Vorher: ein Dialog in einer Spalte, in dem der Kostensatz Pflicht war —
 * auch in Tarifen ohne Kostensätze und für Nutzer ohne Gehaltsrecht, deren
 * Anlage dann am Ende mit „Fehlende Berechtigung" scheiterte. Schlug nach
 * dem Anlegen das Modell oder der Satz fehl, blieb der Dialog offen; ein
 * zweites „Speichern" endete mit „Kürzel wird bereits verwendet", obwohl der
 * Mitarbeiter längst da war. „Gültig ab" musste man zweimal selbst tippen.
 *
 * Jetzt: Kostensatz nur, wenn Tarif und Recht ihn zulassen, und dann
 * freiwillig; „Gültig ab" folgt dem Eintritt. Nach dem Anlegen öffnet sich
 * der Mitarbeiter — was dabei nicht geklappt hat, sagt eine Meldung, und es
 * lässt sich dort im passenden Reiter nachholen.
 */

interface NewForm {
  abbr: string; title: string; first_name: string; last_name: string; gender_id: string
  email: string; phone: string; mobile: string
  personnel_number: string; department_id: string; entry_date: string
  model_id: string; model_from: string; cost_rate: string; rate_from: string
}

export function MitarbeiterAnlegenDialog({ open, onClose, employees }: { open: boolean; onClose: () => void; employees: Employee[] }) {
  if (!open) return null
  return <AnlegenInner onClose={onClose} employees={employees} />
}

function AnlegenInner({ onClose, employees }: { onClose: () => void; employees: Employee[] }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const canRate = useFeature('employees.salary') && usePermission('employees.salary.edit')
  const [initial] = useState<NewForm>(() => {
    const today = todayLocal()
    return {
      abbr: '', title: '', first_name: '', last_name: '', gender_id: '',
      email: '', phone: '', mobile: '',
      personnel_number: nextPersonnelNumber(employees.map(e => e.PERSONNEL_NUMBER)), department_id: '', entry_date: today,
      model_id: '', model_from: '', cost_rate: '', rate_from: '',
    }
  })
  const [f, setF] = useState<NewForm>(initial)
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const { data: genData }  = useQuery({ queryKey: ['emp-genders'], queryFn: fetchEmployeeGenders })
  const { data: deptData } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const { data: wtmData }  = useQuery({ queryKey: ['working-time-models'], queryFn: fetchWorkingTimeModels })
  const genders = genData?.data ?? []
  const departments = deptData?.data ?? []
  const models = wtmData?.data ?? []

  // „Gültig ab" folgt dem Eintritt, bis man es selbst setzt.
  const modelFrom = f.model_from || f.entry_date
  const rateFrom  = f.rate_from || f.entry_date
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const missing = [
    ...missingEmployeeFields(f),
    ...(models.length && !f.model_id ? ['Arbeitszeitmodell'] : []),
    ...(f.model_id && !modelFrom ? ['Modell gültig ab'] : []),
    ...(f.cost_rate !== '' && !rateFrom ? ['Kostensatz gültig ab'] : []),
  ]
  const bad = (label: string) => (tried && missing.includes(label) ? true : undefined)
  const set = (k: keyof NewForm, v: string) => { setF(x => ({ ...x, [k]: v })); setErr(null) }

  async function requestClose() {
    if (pending) return
    if (dirty && !(await confirm({ title: 'Eingaben verwerfen?', message: 'Der Mitarbeiter wird nicht angelegt.', confirmLabel: 'Verwerfen' }))) return
    onClose()
  }

  async function save() {
    if (pending) return
    setTried(true)
    if (missing.length) { setErr(`Bitte noch angeben: ${missing.join(', ')}.`); return }
    setPending(true)
    setErr(null)
    let res: Awaited<ReturnType<typeof createEmployee>>
    try {
      res = await createEmployee({
        abbr: f.abbr, title: f.title, first_name: f.first_name, last_name: f.last_name,
        gender_id: Number(f.gender_id), email: f.email, phone: f.phone, mobile: f.mobile,
        personnel_number: f.personnel_number, department_id: f.department_id ? Number(f.department_id) : null,
        entry_date: f.entry_date || null,
      })
    } catch (e) {
      setErr((e as Error)?.message || 'Anlegen fehlgeschlagen')
      setPending(false)
      return
    }

    // Ab hier gibt es den Mitarbeiter. Was jetzt scheitert, darf den Dialog
    // nicht offen halten — sonst legt ein zweiter Versuch ihn doppelt an.
    const id = res.data.ID
    const later: string[] = []
    if (f.model_id) {
      try { await createEmployeeWorkModel(id, { model_id: Number(f.model_id), valid_from: modelFrom }) }
      catch (e) { later.push(`Arbeitszeitmodell nicht gespeichert (${(e as Error)?.message || 'Fehler'}) — im Reiter „Arbeitszeit" nachholen.`) }
    }
    if (canRate && f.cost_rate !== '') {
      try { await createEmployeeCpRate(id, { cost_rate: Number(f.cost_rate), valid_from: rateFrom }) }
      catch (e) { later.push(`Kostensatz nicht gespeichert (${(e as Error)?.message || 'Fehler'}) — im Reiter „Kostensatz" nachholen.`) }
    }
    void qc.invalidateQueries({ queryKey: ['employees'] })
    void qc.invalidateQueries({ queryKey: ['license-usage'] })

    const name = `${f.first_name.trim()} ${f.last_name.trim()}`
    toast.success(res.invite?.sent ? `${name} angelegt — Einladung an ${f.email.trim()} gesendet.` : `${name} angelegt.`)
    if (f.email.trim() && !res.invite?.sent) {
      later.push(`Einladung nicht versendet: ${res.invite?.reason ?? 'unbekannter Grund'} Anmelden kann sich ${f.first_name.trim()} erst nach einer Einladung — im Reiter „Zugang" erneut senden.`)
    }
    for (const t of later) toast.error(t)
    setPending(false)
    onClose()
    navigate(mitarbeiterHref(id))
  }

  useCtrlS(() => void save(), true)

  const id = (k: string) => `man-${k}`
  const text = (k: keyof NewForm, label: string, extra: Record<string, unknown> = {}) => (
    <div className="form-group">
      <label htmlFor={id(k)}>{label}</label>
      <input id={id(k)} type="text" value={f[k]} onChange={e => set(k, e.target.value)} {...extra} />
    </div>
  )

  return (
    <>
      <Modal open onClose={() => void requestClose()} title="Neuer Mitarbeiter" className="modal-wide">
        <div className="ad-create-body">
          <FormSection title="Person">
            {text('abbr', 'Kürzel *', { 'aria-invalid': bad('Kürzel'), autoComplete: 'off', placeholder: 'z. B. TK' })}
            {text('title', 'Titel')}
            {text('first_name', 'Vorname *', { 'aria-invalid': bad('Vorname') })}
            {text('last_name', 'Nachname *', { 'aria-invalid': bad('Nachname') })}
            <div className="form-group">
              <label htmlFor={id('gender')}>Geschlecht *</label>
              <select id={id('gender')} value={f.gender_id} onChange={e => set('gender_id', e.target.value)} aria-invalid={bad('Geschlecht')}>
                <option value="">Bitte wählen …</option>
                {genders.map(g => <option key={g.ID} value={g.ID}>{g.GENDER}</option>)}
              </select>
            </div>
          </FormSection>

          <FormSection title="Kontakt">
            <div className="form-group form-section-wide">
              <label htmlFor={id('email')}>E-Mail</label>
              <input id={id('email')} type="email" value={f.email} onChange={e => set('email', e.target.value)} autoComplete="off" aria-describedby={id('email-hint')} />
              <p id={id('email-hint')} className="form-field-hint ma-invite-hint">
                <KeyRound size={13} strokeWidth={2} aria-hidden="true" />
                Kein Passwort nötig: an diese Adresse geht eine Einladung, mit der der Mitarbeiter sein Passwort selbst festlegt. Ohne Adresse ist noch keine Anmeldung möglich.
              </p>
            </div>
            {text('phone', 'Telefon', { type: 'tel', inputMode: 'tel' })}
            {text('mobile', 'Mobil', { type: 'tel', inputMode: 'tel' })}
          </FormSection>

          <FormSection title="Beschäftigung">
            {text('personnel_number', 'Personalnummer', { inputMode: 'numeric' })}
            <div className="form-group">
              <label htmlFor={id('dept')}>Abteilung</label>
              <select id={id('dept')} value={f.department_id} onChange={e => set('department_id', e.target.value)}>
                <option value="">— keine —</option>
                {departments.map(d => <option key={d.ID} value={d.ID}>{d.ABBR}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor={id('entry')}>Eintritt</label>
              <input id={id('entry')} type="date" value={f.entry_date} onChange={e => set('entry_date', e.target.value)} />
            </div>
          </FormSection>

          <FormSection title={canRate ? 'Arbeitszeit und Kostensatz' : 'Arbeitszeit'}
            hint={'„Gültig ab" folgt dem Eintritt, solange du es nicht selbst änderst.'}>
            <div className="form-group">
              <label htmlFor={id('model')}>Arbeitszeitmodell{models.length ? ' *' : ''}</label>
              <select id={id('model')} value={f.model_id} onChange={e => set('model_id', e.target.value)} aria-invalid={bad('Arbeitszeitmodell')}>
                <option value="">{models.length ? 'Bitte wählen …' : 'Noch kein Modell angelegt'}</option>
                {models.map(m => <option key={m.ID} value={m.ID}>{m.NAME}</option>)}
              </select>
              {!models.length && <p className="form-field-hint">Modelle entstehen unter Einstellungen → Arbeitszeit. Bis dahin hat der Mitarbeiter keine Soll-Stunden.</p>}
            </div>
            <div className="form-group">
              <label htmlFor={id('model-from')}>Modell gültig ab</label>
              <input id={id('model-from')} type="date" value={modelFrom} onChange={e => set('model_from', e.target.value)} aria-invalid={bad('Modell gültig ab')} />
            </div>
            {canRate && (
              <>
                <div className="form-group">
                  <label htmlFor={id('rate')}>Kostensatz (€/h)</label>
                  <AmountInput id={id('rate')} value={f.cost_rate} onChange={v => set('cost_rate', v)} placeholder="z. B. 58,40" aria-describedby={id('rate-hint')} />
                  <p id={id('rate-hint')} className="form-field-hint">Freiwillig — ohne Satz bleiben die Stunden in der Kostenauswertung unbewertet.</p>
                </div>
                <div className="form-group">
                  <label htmlFor={id('rate-from')}>Kostensatz gültig ab</label>
                  <input id={id('rate-from')} type="date" value={rateFrom} onChange={e => set('rate_from', e.target.value)} aria-invalid={bad('Kostensatz gültig ab')} />
                </div>
              </>
            )}
          </FormSection>

          <Message type="error" text={err} />
          <DialogFooter>
            <button type="button" className="btn-secondary" onClick={() => void requestClose()} disabled={pending}>Abbrechen</button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={pending}>
              {pending ? 'Legt an …' : 'Anlegen'}
            </button>
          </DialogFooter>
        </div>
      </Modal>
      {confirmDialog}
    </>
  )
}
