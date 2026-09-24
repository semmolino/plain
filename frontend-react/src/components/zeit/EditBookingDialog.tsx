import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { updateBuchung, type UpdateBuchungPayload } from '@/api/projekte'
import type { MyBooking } from '@/api/eigeneZeit'
import { useBookableStructure } from '@/hooks/useBooking'
import { parentStructureIds, structurePaths } from '@/utils/treeUtils'
import { localIsoDate, addDaysIso, hoursBetween, parseHours, fmtHours } from '@/utils/zeit'

/**
 * Eigene Buchung aendern — aus „Meine Zeit" (UI-Pilot 2026-09, Runde 2).
 *
 * Nur, was man an einer eigenen Buchung legitim korrigiert: Tag, Uhrzeit,
 * Dauer, Beschreibung und die Leistung im selben Projekt. Projekt und
 * Mitarbeiter wechseln ist Umbuchen (eigenes Recht, eigener Weg), Saetze
 * setzt der Server. Mit „Eigene Zeit buchen" filtert der Server die Nutzlast
 * ohnehin genau auf diese Felder (controllers/buchungen.js).
 */
export function EditBookingDialog({ booking, onClose, onSaved }: {
  booking: MyBooking
  onClose: () => void
  onSaved: () => void
}) {
  const today = localIsoDate()
  const [date,        setDate]        = useState(booking.BOOKING_DATE)
  const [timeStart,   setTimeStart]   = useState(booking.TIME_START?.slice(0, 5) ?? '')
  const [timeFinish,  setTimeFinish]  = useState(booking.TIME_FINISH?.slice(0, 5) ?? '')
  const [hours,       setHours]       = useState(fmtHours(booking.QUANTITY_INT))
  const [description, setDescription] = useState(booking.POSTING_DESCRIPTION)
  const [structureId, setStructureId] = useState<number | null>(booking.STRUCTURE_ID)
  const [error,       setError]       = useState<string | null>(null)
  const [saving,      setSaving]      = useState(false)

  const { data: structData } = useBookableStructure(booking.PROJECT_ID)
  const structure = useMemo(() => structData?.data ?? [], [structData])
  const paths     = useMemo(() => structurePaths(structure), [structure])
  const leaves    = useMemo(() => {
    const parents = parentStructureIds(structure)
    return structure.filter(n => !parents.has(n.STRUCTURE_ID))
  }, [structure])

  function setTimes(start: string, finish: string) {
    setTimeStart(start); setTimeFinish(finish)
    const h = hoursBetween(start, finish)
    if (h != null) setHours(fmtHours(h))
  }

  const hoursNum = parseHours(hours)
  const timesBad = !!timeStart && !!timeFinish && hoursBetween(timeStart, timeFinish) == null

  async function save() {
    setError(null)
    if (!date)                               { setError('Gib ein Datum an.'); return }
    if (timesBad)                            { setError('„Bis" liegt vor „Von".'); return }
    if (hoursNum == null || hoursNum <= 0)   { setError('Gib eine Dauer größer 0 an.'); return }
    if (!description.trim())                 { setError('Beschreibe kurz, was du gemacht hast.'); return }

    const body: UpdateBuchungPayload = {}
    if (date !== booking.BOOKING_DATE) body.BOOKING_DATE = date
    if (timeStart  !== (booking.TIME_START?.slice(0, 5) ?? ''))  body.TIME_START  = timeStart ? `${timeStart}:00` : ''
    if (timeFinish !== (booking.TIME_FINISH?.slice(0, 5) ?? '')) body.TIME_FINISH = timeFinish ? `${timeFinish}:00` : ''
    if (hoursNum !== booking.QUANTITY_INT) {
      body.QUANTITY_INT = hoursNum
      // Abrechnungsstunden folgen, wenn sie bisher gleich waren — sonst
      // hat jemand bewusst weniger berechnet, und das bleibt so.
      if (booking.EXT_FOLLOWS) body.QUANTITY_EXT = hoursNum
    }
    if (description.trim() !== booking.POSTING_DESCRIPTION) body.POSTING_DESCRIPTION = description.trim()
    if (structureId != null && structureId !== booking.STRUCTURE_ID) body.STRUCTURE_ID = structureId
    if (!Object.keys(body).length) { onClose(); return }

    setSaving(true)
    try {
      await updateBuchung(booking.ID, body)
      onSaved()
    } catch (e) {
      setError((e as Error)?.message || 'Speichern fehlgeschlagen')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Buchung ändern" className="qb-dialog">
      <div className="qb-form" onKeyDown={e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); void save() }
      }}>
        <p className="mz-edit-project">
          <strong>{booking.PROJECT?.ABBR}</strong> {booking.PROJECT?.NAME}
        </p>
        <div className="form-group">
          <label htmlFor="eb-leaf">Leistung</label>
          <select id="eb-leaf" value={structureId ?? ''} onChange={e => setStructureId(e.target.value ? Number(e.target.value) : null)}>
            {!leaves.some(l => l.STRUCTURE_ID === structureId) && structureId != null && (
              <option value={structureId}>{booking.STRUCTURE?.ABBR}{booking.STRUCTURE?.NAME ? `: ${booking.STRUCTURE.NAME}` : ''}</option>
            )}
            {leaves.map(l => <option key={l.STRUCTURE_ID} value={l.STRUCTURE_ID}>{paths.get(l.STRUCTURE_ID) ?? l.ABBR}</option>)}
          </select>
          <p className="form-field-hint">Ein anderes Projekt ist Umbuchen — das geht im Projekt unter Buchungen.</p>
        </div>
        <div className="form-group">
          <label htmlFor="eb-date">Datum</label>
          <input id="eb-date" type="date" value={date} max={addDaysIso(today, 31)} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="qb-times">
          <div className="form-group">
            <label htmlFor="eb-von">Von</label>
            <input id="eb-von" type="time" value={timeStart} onChange={e => setTimes(e.target.value, timeFinish)} />
          </div>
          <div className="form-group">
            <label htmlFor="eb-bis">Bis</label>
            <input id="eb-bis" type="time" value={timeFinish} onChange={e => setTimes(timeStart, e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="eb-hours">Dauer (Stunden)</label>
          <input id="eb-hours" className="qb-hours" type="text" inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="eb-desc">Beschreibung</label>
          <textarea id="eb-desc" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <Message text={error} type="error" />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Speichert …' : 'Speichern'}
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}
