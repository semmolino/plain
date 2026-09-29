import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Info } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useToast } from '@/store/toastStore'
import {
  fetchAbsenceTypes, fetchAbsencePreview, createAbsence, updateAbsence,
  type Absence, type AbsencePreview,
} from '@/api/abwesenheit'
import { fmtAbsenceRange, fmtDays, fmtDayNum } from './absenceFormat'

/**
 * Antrag stellen, bearbeiten oder für jemanden erfassen — ein Dialog für
 * „Meine Anträge" und die Mitarbeiterseite (UI-Pilot Runde 11).
 *
 * Vorher waren das zwei Kopien eines Formularkastens mitten in der Liste,
 * mit Beschriftungen ohne Bezug zum Feld. Was ein Antrag kostet, sah man erst
 * nach dem Einreichen — und dass er sich mit einem schon genehmigten Urlaub
 * überschneidet (und doppelt vom Resturlaub abgeht), gar nicht. Die Vorschau
 * rechnet am Server wie das Speichern: Arbeitszeitmodell, Feiertage, je Jahr.
 */

export type AbsenceDialogMode = 'request' | 'record'

interface Props {
  open:        boolean
  onClose:     () => void
  /** `request`: eigener Antrag. `record`: Erfassung für `employeeId` (direkt genehmigt). */
  mode:        AbsenceDialogMode
  employeeId?: number
  employeeLabel?: string
  /** Bearbeiten eines offenen Antrags. */
  absence?:    Absence | null
}

interface Form { type: string; from: string; to: string; half: boolean; note: string }
const EMPTY: Form = { type: '', from: '', to: '', half: false, note: '' }
const fromAbsence = (a: Absence): Form => ({
  type: String(a.ABSENCE_TYPE_ID), from: a.DATE_FROM, to: a.DATE_TO !== a.DATE_FROM ? a.DATE_TO : '',
  half: a.HALF_DAY, note: a.NOTE ?? '',
})

export function AbsenceDialog(props: Props) {
  if (!props.open) return null
  return <AbsenceDialogBody {...props} />
}

function AbsenceDialogBody({ onClose, mode, employeeId, employeeLabel, absence }: Props) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const initial = absence ? fromAbsence(absence) : EMPTY
  const [f, setF] = useState<Form>(initial)
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data: typesRes } = useQuery({ queryKey: ['absence-types'], queryFn: fetchAbsenceTypes })
  const types = (typesRes?.data ?? []).filter(t => t.ACTIVE || String(t.ID) === f.type)

  const to = f.to || f.from
  const singleDay = !!f.from && to === f.from
  // Halber Tag gilt nur an einem Tag — beim Verlängern zählt das Häkchen nicht mehr.
  const half = f.half && singleDay
  const iso = /^\d{4}-\d{2}-\d{2}$/
  const datesOk = iso.test(f.from) && iso.test(to) && to >= f.from
  const missing = [...(!f.type ? ['Art'] : []), ...(!f.from ? ['Von'] : [])]
  const orderBad = !!f.from && !!f.to && f.to < f.from
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const bad = (k: string) => (tried && missing.includes(k) ? true : undefined)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF(x => ({ ...x, [k]: v })); setErr(null) }

  const previewParams = datesOk && f.type ? {
    employee_id: mode === 'record' ? employeeId : undefined,
    absence_type_id: Number(f.type), date_from: f.from, date_to: to, half_day: half,
    exclude_id: absence?.ID,
  } : null
  const { data: previewRes, isFetching: previewLoading, error: previewErr } = useQuery({
    queryKey: ['absence-preview', previewParams],
    queryFn: () => fetchAbsencePreview(previewParams!),
    enabled: previewParams != null,
    staleTime: 30_000,
  })
  const preview = previewParams ? previewRes?.data : undefined

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { absence_type_id: Number(f.type), date_from: f.from, date_to: to, half_day: half, note: f.note.trim() }
      if (absence) await updateAbsence(absence.ID, payload)
      else await createAbsence(mode === 'record' ? { ...payload, employee_id: employeeId } : payload)
    },
    onSuccess: () => {
      toast.success(absence ? 'Antrag geändert.' : mode === 'record' ? 'Abwesenheit eingetragen.'
        : preview?.requires_approval === false ? 'Abwesenheit eingetragen.' : 'Antrag eingereicht.')
      for (const k of ['my-absences', 'my-vacation-balance', 'absences-inbox', 'absences', 'vacation-balance', 'absences-calendar', 'absences-overlap', 'absence-preview']) {
        void qc.invalidateQueries({ queryKey: [k] })
      }
      onClose()
    },
    onError: (e: Error) => setErr(e.message),
  })

  function save() {
    if (saveMut.isPending) return
    setTried(true)
    if (missing.length) { setErr(`Bitte noch angeben: ${missing.join(', ')}.`); return }
    if (orderBad) { setErr('„Bis" liegt vor „Von".'); return }
    saveMut.mutate()
  }

  async function requestClose() {
    if (saveMut.isPending) return
    if (dirty && !(await confirm({ title: 'Eingaben verwerfen?', message: absence ? 'Der Antrag bleibt, wie er war.' : 'Es wird nichts beantragt.', confirmLabel: 'Verwerfen' }))) return
    onClose()
  }

  useCtrlS(save, true)

  const title = absence ? 'Antrag bearbeiten' : mode === 'record' ? `Abwesenheit erfassen${employeeLabel ? ` – ${employeeLabel}` : ''}` : 'Abwesenheit beantragen'
  const primary = saveMut.isPending ? 'Speichert …'
    : absence ? 'Änderungen speichern'
    : mode === 'record' || preview?.requires_approval === false ? 'Eintragen' : 'Antrag einreichen'
  const id = (k: string) => `absd-${k}`

  return (
    <>
      <Modal open onClose={() => void requestClose()} title={title}>
        <div className="abs-dialog">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor={id('type')}>Art *</label>
              <select id={id('type')} value={f.type} onChange={e => set('type', e.target.value)} aria-invalid={bad('Art')}>
                <option value="">Bitte wählen …</option>
                {types.map(t => <option key={t.ID} value={t.ID}>{t.NAME}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor={id('from')}>Von *</label>
              <input id={id('from')} type="date" value={f.from} onChange={e => set('from', e.target.value)} aria-invalid={bad('Von')} />
            </div>
            <div className="form-group">
              <label htmlFor={id('to')}>Bis</label>
              <input id={id('to')} type="date" value={f.to} min={f.from || undefined} onChange={e => set('to', e.target.value)}
                aria-invalid={tried && orderBad ? true : undefined} aria-describedby={id('to-hint')} />
              <span id={id('to-hint')} className="abs-field-hint">leer = ein Tag</span>
            </div>
          </div>
          <label className={`abs-check${singleDay ? '' : ' abs-check--off'}`}>
            <input type="checkbox" checked={half} disabled={!singleDay} onChange={e => set('half', e.target.checked)} />
            Halber Tag{!singleDay && f.from ? ' (nur bei einem Tag)' : ''}
          </label>
          <div className="form-group">
            <label htmlFor={id('note')}>Notiz</label>
            <textarea id={id('note')} rows={2} value={f.note} onChange={e => set('note', e.target.value)} placeholder="optional, z. B. Vertretung" />
          </div>

          <PreviewBox preview={preview} loading={previewLoading && !preview} error={previewErr as Error | null}
            ready={previewParams != null} mode={mode} editing={!!absence} />

          {err && <p className="abs-error" role="alert">{err}</p>}
        </div>
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={() => void requestClose()}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={saveMut.isPending} onClick={save}>{primary}</button>
        </DialogFooter>
      </Modal>
      {confirmDialog}
    </>
  )
}

function PreviewBox({ preview, loading, error, ready, mode, editing }: {
  preview: AbsencePreview | undefined; loading: boolean; error: Error | null; ready: boolean; mode: AbsenceDialogMode; editing: boolean
}) {
  if (!ready) return <p className="abs-preview abs-preview--idle">Art und Zeitraum wählen — dann steht hier, wie viele Arbeitstage das sind.</p>
  if (error) return <p className="abs-preview abs-preview--idle">Die Tage lassen sich gerade nicht berechnen ({error.message}). Speichern geht trotzdem.</p>
  if (loading || !preview) return <p className="abs-preview abs-preview--idle" aria-busy="true">Rechnet …</p>
  const multiYear = preview.by_year.length > 1
  return (
    <div className="abs-preview" aria-live="polite">
      <p className="abs-preview-main">
        <strong>{fmtDays(preview.days).replace(/Tag(e)?$/, m => (m === 'Tag' ? 'Arbeitstag' : 'Arbeitstage'))}</strong>
        {multiYear && <> · {preview.by_year.map(y => `${y.year}: ${fmtDayNum(y.days)}`).join(', ')}</>}
        <span className="abs-preview-sub"> nach Arbeitszeitmodell, ohne Feiertage</span>
      </p>
      {preview.days === 0 && (
        <p className="abs-preview-warn"><AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />Im Zeitraum liegt kein Arbeitstag — Wochenende, Feiertag oder laut Arbeitszeitmodell frei.</p>
      )}
      {preview.balance?.map(b => (
        <p key={b.year} className="abs-preview-line">
          Resturlaub {b.year} danach: <strong className={b.after < 0 ? 'abs-neg' : undefined}>{b.after < 0 ? `−${fmtDayNum(-b.after)}` : fmtDayNum(b.after)} Tage</strong>
          <span className="abs-preview-sub"> ({fmtDayNum(b.remaining)} übrig{b.pending ? `, ${fmtDayNum(b.pending)} schon beantragt` : ''})</span>
        </p>
      ))}
      {preview.overlaps.length > 0 && (
        <div className="abs-preview-warn">
          <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
          <span>
            Überschneidet sich mit {preview.overlaps.map(o => `${o.TYPE_NAME ?? 'Abwesenheit'} ${fmtAbsenceRange(o)} (${o.STATUS === 'APPROVED' ? 'genehmigt' : 'beantragt'})`).join(', ')}.
            {preview.reduces_vacation && ' Überschneidende Tage zählen doppelt.'}
          </span>
        </div>
      )}
      {!editing && (
        <p className="abs-preview-note">
          <Info size={14} strokeWidth={2} aria-hidden="true" />
          {mode === 'record' ? 'Wird direkt als genehmigt eingetragen.'
            : preview.requires_approval === false ? 'Diese Art braucht keine Genehmigung — sie wird direkt eingetragen.'
            : 'Geht zur Genehmigung; Sie werden benachrichtigt, sobald entschieden ist.'}
        </p>
      )}
    </div>
  )
}
