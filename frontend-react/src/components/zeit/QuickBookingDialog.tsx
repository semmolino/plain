import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { Disclosure } from '@/components/ui/Disclosure'
import { TextSnippetBar } from '@/components/ui/TextSnippetBar'
import {
  fetchActiveEmployees, fetchEmployee2ProjectPreset, createBuchung,
} from '@/api/projekte'
import { useCanBook } from '@/hooks/useBooking'
import { LeafFields } from '@/components/zeit/LeafChoice'
import { useLeafChoice } from '@/components/zeit/useLeafChoice'
import { localIsoDate, addDaysIso, previousWorkday, hoursBetween, parseHours, fmtHours } from '@/utils/zeit'
import { useQuickBooking, type QuickBookingPrefill } from '@/store/quickBookingStore'
import { useAuthStore } from '@/store/authStore'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import { useIsNarrow } from '@/hooks/useIsNarrow'

const DURATION_CHIPS = [0.5, 1, 2, 4, 8]

/**
 * „Zeit buchen" — ein Dialog fuer Stundenbuchungen, erreichbar von ueberall
 * (UI-Pilot 2026-09).
 *
 * Vorher ging eine Stundenbuchung nur ueber Projekte → Reiter Buchungen →
 * Projekt waehlen → „+ Stundenbuchung" → neun Felder, darunter ein
 * Pflicht-Stundensatz, der bei fehlendem Recht ausgeblendet und damit
 * unerfuellbar war. Die Stunden wurden nicht aus Von/Bis berechnet, und
 * „Speichern" stand links neben „Abbrechen".
 *
 * Jetzt: „Zuletzt gebucht" setzt Projekt und Leistung mit einem Tipp, Datum
 * und Dauer gehen ueber Chips, Von/Bis rechnet die Dauer aus. Was selten
 * gebraucht wird (abweichende Abrechnungsstunden, Stundensatz, anderer
 * Mitarbeiter), liegt hinter „Weitere Angaben". Kosten- und Stundensatz
 * setzt der Server ohnehin selbst (Kostensatz-Verlauf, Preisliste).
 */
export function QuickBookingDialog() {
  const { isOpen, prefill, close } = useQuickBooking()
  if (!isOpen) return null
  return <QuickBookingForm key={JSON.stringify(prefill)} prefill={prefill} onClose={close} />
}

function QuickBookingForm({ prefill, onClose }: { prefill: QuickBookingPrefill; onClose: () => void }) {
  // Fuer Kollegen buchen nur mit dem vollen Buchungsrecht — mit „Eigene Zeit
  // buchen" gibt es das Mitarbeiterfeld nicht (der Server setzt die Sitzung).
  const { canBookOthers } = useCanBook()
  const allowOther = !!prefill.allowOtherEmployee && canBookOthers
  const qc     = useQueryClient()
  const toast  = useToast()
  const narrow = useIsNarrow()
  const ownId  = useAuthStore(s => s.employeeId)
  const showRevenue = usePermission('projects.bookings.revenue.view')
  const today  = localIsoDate()
  const lastWorkday = previousWorkday(today)

  const leaf = useLeafChoice({ projectId: prefill.projectId, structureId: prefill.structureId })
  const { projectId, structureId } = leaf
  const [date,        setDate]        = useState(prefill.date ?? today)
  const [timeStart,   setTimeStart]   = useState('')
  const [timeFinish,  setTimeFinish]  = useState('')
  const [hours,       setHours]       = useState('')
  const [description, setDescription] = useState(prefill.description ?? '')
  const [ext,         setExt]         = useState('')
  const [rate,        setRate]        = useState('')
  const [employeeId,  setEmployeeId]  = useState<number | null>(ownId)
  const [errors,      setErrors]      = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving,      setSaving]      = useState(false)

  const { data: empData } = useQuery({
    queryKey: ['active-employees'], queryFn: fetchActiveEmployees, enabled: !!allowOther,
  })
  // Der Satz aus der Preisliste ist nur Anzeige — der Server setzt ihn selbst.
  // Ohne Umsatzrecht wird er deshalb gar nicht erst geladen.
  const { data: preset } = useQuery({
    queryKey: ['e2p-preset', employeeId, projectId],
    queryFn:  () => fetchEmployee2ProjectPreset(employeeId!, projectId!),
    enabled:  showRevenue && employeeId != null && projectId != null,
  })

  // Stundensatz aus der Preisliste des Projekts
  const presetRate = preset?.found && preset.HOURLY_RATE != null ? preset.HOURLY_RATE : null

  function setTimes(start: string, finish: string) {
    setTimeStart(start); setTimeFinish(finish)
    const h = hoursBetween(start, finish)
    if (h != null) setHours(fmtHours(h))
  }

  const hoursNum  = parseHours(hours)
  const timesBad  = !!timeStart && !!timeFinish && hoursBetween(timeStart, timeFinish) == null
  const leafLabel = leaf.leafLabel

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (projectId == null)                       e.project = 'Wähle ein Projekt.'
    if (structureId == null)                     e.leaf    = 'Wähle eine Leistung.'
    if (!date)                                   e.date    = 'Gib ein Datum an.'
    if (timesBad)                                e.times   = '„Bis" liegt vor „Von".'
    if (hoursNum == null || hoursNum <= 0)       e.hours   = 'Gib eine Dauer größer 0 an.'
    if (!description.trim())                     e.desc    = 'Beschreibe kurz, was du gemacht hast.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit(mode: 'close' | 'again') {
    setServerError(null)
    if (!validate() || projectId == null || structureId == null || hoursNum == null) return
    const extNum = showRevenue && ext !== '' ? parseHours(ext) : null
    setSaving(true)
    try {
      await createBuchung({
        PROJECT_ID:          projectId,
        STRUCTURE_ID:        structureId,
        EMPLOYEE_ID:         employeeId ?? ownId ?? 0,
        BOOKING_DATE:        date,
        TIME_START:          timeStart  || undefined,
        TIME_FINISH:         timeFinish || undefined,
        QUANTITY_INT:        hoursNum,
        QUANTITY_EXT:        extNum ?? hoursNum,
        // Pflichtfeld am Server; die Preisliste des Projekts hat dort Vorrang.
        HOURLY_RATE:         presetRate ?? (showRevenue && rate !== '' ? parseHours(rate) ?? 0 : 0),
        POSTING_DESCRIPTION: description.trim(),
      })
    } catch (e) {
      setServerError((e as Error)?.message || 'Buchen fehlgeschlagen')
      setSaving(false)
      return
    }
    setSaving(false)
    leaf.remember()
    for (const key of ['buchungen', 'timer-drafts', 'emp-balance', 'emp-running', 'workstart-status', 'recents', 'my-streak', 'my-time']) {
      void qc.invalidateQueries({ queryKey: [key] })
    }
    void qc.invalidateQueries({ queryKey: ['structure', projectId] })
    toast.success(`${fmtHours(hoursNum)} h gebucht · ${leaf.projectAbbr(projectId)} / ${leafLabel(structureId)}`)
    if (mode === 'close') { onClose(); return }
    setTimeStart(''); setTimeFinish(''); setHours(''); setDescription(''); setExt(''); setErrors({})
  }

  const dateChips = [
    { label: 'Heute', value: today },
    { label: lastWorkday === addDaysIso(today, -1) ? 'Gestern' : 'Freitag', value: lastWorkday },
  ]

  const timesFields = (
    <div className="qb-times">
      <div className="form-group">
        <label htmlFor="qb-von">Von</label>
        <input id="qb-von" type="time" value={timeStart} onChange={e => setTimes(e.target.value, timeFinish)} />
      </div>
      <div className="form-group">
        <label htmlFor="qb-bis">Bis</label>
        <input id="qb-bis" type="time" value={timeFinish} onChange={e => setTimes(timeStart, e.target.value)}
          aria-invalid={errors.times ? true : undefined} />
      </div>
    </div>
  )

  return (
    <Modal open onClose={onClose} title="Zeit buchen" className="qb-dialog">
      <form
        className="qb-form"
        onSubmit={e => { e.preventDefault(); void submit('close') }}
        onKeyDown={e => {
          // Strg+S hier abfangen und nicht weiterreichen — sonst speichert
          // die Seite dahinter (useCtrlS am window) gleich mit.
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault(); e.stopPropagation(); void submit('close')
          }
        }}
        noValidate
      >
        <LeafFields choice={leaf} idPrefix="qb" errors={{ project: errors.project, leaf: errors.leaf }}
          onPicked={() => setErrors({})} />

        <div className="qb-row">
          <div className="form-group qb-date">
            <label htmlFor="qb-date">Datum*</label>
            <div className="qb-inline">
              {dateChips.map(c => (
                <button key={c.label} type="button" className="qb-chip" aria-pressed={date === c.value} onClick={() => setDate(c.value)}>
                  {c.label}
                </button>
              ))}
              <input id="qb-date" type="date" value={date} max={addDaysIso(today, 31)} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
        </div>

        {!narrow && timesFields}
        {narrow && (
          <Disclosure title="Uhrzeit angeben" hint={timeStart && timeFinish ? `${timeStart}–${timeFinish}` : 'optional'} defaultOpen={!!(timeStart || timeFinish)}>
            {timesFields}
          </Disclosure>
        )}
        {errors.times && <p className="form-field-error" role="alert">{errors.times}</p>}

        <div className="form-group">
          <label htmlFor="qb-hours">Dauer (Stunden)*</label>
          <div className="qb-inline">
            <input id="qb-hours" className="qb-hours" type="text" inputMode="decimal" placeholder="z. B. 1,5"
              value={hours} aria-invalid={errors.hours ? true : undefined}
              onChange={e => setHours(e.target.value)} />
            {DURATION_CHIPS.map(h => (
              <button key={h} type="button" className="qb-chip" aria-pressed={hoursNum === h}
                onClick={() => { setHours(fmtHours(h)); setTimeStart(''); setTimeFinish('') }}>
                {fmtHours(h)} h
              </button>
            ))}
          </div>
          {errors.hours && <p className="form-field-error" role="alert">{errors.hours}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="qb-desc">Beschreibung*</label>
          <textarea id="qb-desc" rows={2} value={description} aria-invalid={errors.desc ? true : undefined}
            placeholder="Was hast du gemacht?"
            onChange={e => setDescription(e.target.value)} />
          <TextSnippetBar currentText={description} onChange={setDescription} kind="WORK" />
          {errors.desc && <p className="form-field-error" role="alert">{errors.desc}</p>}
        </div>

        {(showRevenue || allowOther) && (
          <Disclosure title="Weitere Angaben" className="qb-more"
            hint={ext !== '' || (rate !== '' && presetRate == null) || (employeeId !== ownId) ? 'geändert' : undefined}>
            {allowOther && (
              <div className="form-group">
                <label htmlFor="qb-emp">Mitarbeiter</label>
                <select id="qb-emp" value={employeeId ?? ''} onChange={e => setEmployeeId(e.target.value ? Number(e.target.value) : null)}>
                  {(empData?.data ?? []).map(e => <option key={e.ID} value={e.ID}>{e.ABBR}: {e.FIRST_NAME} {e.LAST_NAME}</option>)}
                </select>
              </div>
            )}
            {showRevenue && (
              <div className="qb-times">
                <div className="form-group">
                  <label htmlFor="qb-ext">Zur Abrechnung (h)</label>
                  <input id="qb-ext" type="text" inputMode="decimal" placeholder={hours || 'wie Dauer'}
                    value={ext} onChange={e => setExt(e.target.value)} />
                  <p className="form-field-hint">Leer = wie Dauer. Weniger bei Kulanz.</p>
                </div>
                <div className="form-group">
                  <label htmlFor="qb-rate">Stundensatz (€)</label>
                  <input id="qb-rate" type="text" inputMode="decimal"
                    value={presetRate != null ? fmtHours(presetRate) : rate}
                    readOnly={presetRate != null}
                    onChange={e => setRate(e.target.value)} />
                  <p className="form-field-hint">{presetRate != null ? `Aus der Preisliste des Projekts${preset?.ROLE_ABBR ? ` (${preset.ROLE_ABBR})` : ''}.` : 'Kein Satz in der Preisliste hinterlegt.'}</p>
                </div>
              </div>
            )}
          </Disclosure>
        )}

        <Message text={serverError} type="error" />

        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="button" className="btn-secondary qb-again" onClick={() => void submit('again')} disabled={saving}>Buchen &amp; weitere</button>
          <button type="button" className="btn-primary" onClick={() => void submit('close')} disabled={saving}>
            {saving ? 'Bucht …' : 'Buchen'}
          </button>
        </DialogFooter>
      </form>
    </Modal>
  )
}
