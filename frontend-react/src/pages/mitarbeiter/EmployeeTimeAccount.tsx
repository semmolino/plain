import { Fragment, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ChevronDown, Pencil, Lock, AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { useConfirm } from '@/hooks/useConfirm'
import { usePermission } from '@/store/permissionsStore'
import { useFeature } from '@/store/licenseStore'
import { useToast } from '@/store/toastStore'
import { fetchMonthBalance, fetchRunningBalance, fetchMonthCloseStatus, closeMonth, reopenMonth, type MonthBalance, type RunningMonth, type DayBooking } from '@/api/mitarbeiter'
import { updateBuchung, deleteBuchung, type UpdateBuchungPayload } from '@/api/projekte'
import { fmtH, fmtBalance, fmtDateShort } from '@/pages/mitarbeiter/mitarbeiterFormat'
import { SegmentNav } from '@/pages/mitarbeiter/SegmentNav'

/**
 * Zeitkonto eines Mitarbeiters: Monat mit Tagen und Buchungen, Verlauf über
 * die Monate (Mitarbeiterseite und Stundencontrolling).
 *
 * Runde 10, vorher:
 * - Der Buchungsdialog rechnete aus Start/Ende „1,5" in ein Zahlenfeld —
 *   das zeigte dann nichts an, und „Speichern" schrieb 0 Stunden.
 * - Er setzte beim Ändern die abrechenbaren Stunden gleich den internen und
 *   warf so eine bewusst gekürzte Abrechnungsmenge weg.
 * - Löschen ging ohne Rückfrage, und beides stand auch Nutzern ohne Recht
 *   offen (der Server lehnte dann ab).
 * - „Monat abschließen" stand für jeden da, ohne Recht und ohne Rückfrage.
 */

const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const MONTH_NAMES   = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

const toMin = (t: string) => { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m }
const hoursText = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')
const parseHours = (v: string): number | null => {
  const t = v.trim()
  if (!t) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

function Balance({ n }: { n: number }) {
  return <span className={n < 0 ? 'ma-balance-neg' : 'ma-balance'}>{fmtBalance(n)}</span>
}

export function EmployeeTimeAccount({ empId }: { empId: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const canEditBooking   = usePermission('projects.bookings.edit')
  const canDeleteBooking = usePermission('projects.bookings.delete')
  const canCloseMonths   = usePermission('employees.month_close.edit') && useFeature('employees.month_close')
  const [year,     setYear]     = useState(new Date().getFullYear())
  const [month,    setMonth]    = useState(new Date().getMonth() + 1)
  const [viewMode, setViewMode] = useState<'month' | 'running'>('month')
  const [closeLoading, setCloseLoading] = useState(false)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())
  const [edit, setEdit] = useState<{ b: DayBooking; siblings: DayBooking[]; start: string; finish: string; qty: string; desc: string } | null>(null)
  const [tried, setTried] = useState(false)

  function openEditBooking(b: DayBooking, sameDay: DayBooking[]) {
    setTried(false)
    setEdit({
      b, siblings: sameDay.filter(x => x.id !== b.id),
      start: (b.time_start ?? '').slice(0, 5), finish: (b.time_finish ?? '').slice(0, 5),
      qty: hoursText(b.hours ?? 0), desc: b.description ?? '',
    })
  }
  // Start/Ende rechnen die Stunden mit — als Text mit Komma, das Feld ist
  // ein Textfeld (ein Zahlenfeld ließ „1,5" nicht zu und zeigte leer).
  function setTime(k: 'start' | 'finish', v: string) {
    setEdit(e => {
      if (!e) return e
      const next = { ...e, [k]: v }
      if (next.start && next.finish && toMin(next.finish) > toMin(next.start)) {
        next.qty = hoursText((toMin(next.finish) - toMin(next.start)) / 60)
      }
      return next
    })
  }

  // Überschneidung mit anderen Buchungen desselben Tages.
  function detectOverlaps(start: string, finish: string, siblings: DayBooking[]): DayBooking[] {
    if (!start || !finish) return []
    const a1 = toMin(start), a2 = toMin(finish)
    if (a2 <= a1) return []
    return siblings.filter(x => {
      if (!x.time_start || !x.time_finish) return false
      const b1 = toMin(x.time_start), b2 = toMin(x.time_finish)
      return a1 < b2 && b1 < a2
    })
  }

  const qty = edit ? parseHours(edit.qty) : null
  const timeBackwards = !!edit && !!edit.start && !!edit.finish && toMin(edit.finish) <= toMin(edit.start)
  const qtyInvalid = qty == null || Number.isNaN(qty) || qty < 0 || qty > 24
  const overlaps = edit ? detectOverlaps(edit.start, edit.finish, edit.siblings) : []

  const invalidateBalances = () => {
    void qc.invalidateQueries({ queryKey: ['emp-balance-month'] })
    void qc.invalidateQueries({ queryKey: ['emp-balance-running'] })
    void qc.invalidateQueries({ queryKey: ['emp-report-list'] })
  }

  const patchBookingMut = useMutation({
    mutationFn: async () => {
      if (!edit || qty == null || Number.isNaN(qty)) return
      const b = edit.b
      // Nur, was sich geändert hat — sonst setzte der Server Felder zurück,
      // die hier gar nicht zu sehen sind.
      const body: UpdateBuchungPayload = {}
      if (edit.start !== (b.time_start ?? '').slice(0, 5))   body.TIME_START  = edit.start ? `${edit.start}:00` : ''
      if (edit.finish !== (b.time_finish ?? '').slice(0, 5)) body.TIME_FINISH = edit.finish ? `${edit.finish}:00` : ''
      if (Math.abs(qty - (b.hours ?? 0)) > 1e-9) {
        body.QUANTITY_INT = qty
        // Abrechenbare Stunden nur mitziehen, solange sie den internen
        // entsprachen — eine bewusst andere Menge bleibt stehen.
        if (b.hours_ext == null || Math.abs(b.hours_ext - (b.hours ?? 0)) < 1e-9) body.QUANTITY_EXT = qty
      }
      if (edit.desc !== (b.description ?? '')) body.POSTING_DESCRIPTION = edit.desc
      if (!Object.keys(body).length) return
      await updateBuchung(b.id, body)
    },
    onSuccess: () => { toast.success('Buchung aktualisiert'); setEdit(null); invalidateBalances() },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteBookingMut = useMutation({
    mutationFn: (id: number) => deleteBuchung(id),
    onSuccess: () => { toast.success('Buchung gelöscht'); setEdit(null); invalidateBalances() },
    onError: (e: Error) => toast.error(e.message),
  })

  async function removeBooking() {
    if (!edit) return
    const b = edit.b
    const ok = await confirm({
      title: 'Buchung löschen?',
      message: `${fmtH(b.hours)} auf ${b.project}${b.structure ? ` / ${b.structure}` : ''} werden gelöscht. Zeitkonto, Projektkosten und Honorar rechnen danach ohne sie.`,
      confirmLabel: 'Löschen',
    })
    if (ok) deleteBookingMut.mutate(b.id)
  }

  function saveBooking() {
    setTried(true)
    if (qtyInvalid || timeBackwards || overlaps.length) return
    patchBookingMut.mutate()
  }

  function toggleDay(date: string) {
    setExpandedDays(prev => {
      const s = new Set(prev)
      if (s.has(date)) s.delete(date); else s.add(date)
      return s
    })
  }

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else             setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else               setMonth(m => m + 1)
  }

  const { data: monthRes, isLoading: loadingMonth } = useQuery({
    queryKey: ['emp-balance-month', empId, year, month],
    queryFn:  () => fetchMonthBalance(empId, year, month),
    enabled:  viewMode === 'month',
  })
  const { data: runningRes, isLoading: loadingRunning } = useQuery({
    queryKey: ['emp-balance-running', empId],
    queryFn:  () => fetchRunningBalance(empId),
    enabled:  viewMode === 'running',
  })
  const { data: closeStatusRes, refetch: refetchClose } = useQuery({
    queryKey: ['month-close-status', empId, year, month],
    queryFn:  () => fetchMonthCloseStatus(empId, year, month),
  })

  const monthData: MonthBalance | undefined = monthRes?.data
  const runningData = runningRes?.data
  const isClosed = closeStatusRes?.data != null
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`
  const canTouch = (b: DayBooking) => !b.billed && !isClosed && (canEditBooking || canDeleteBooking)

  async function toggleMonthClose() {
    const ok = await confirm(isClosed
      ? { title: `${monthLabel} wieder öffnen?`, message: 'Buchungen in diesem Monat lassen sich danach wieder ändern und löschen.', confirmLabel: 'Öffnen', confirmClass: 'btn-primary' }
      : { title: `${monthLabel} abschließen?`, message: 'Buchungen in diesem Monat lassen sich danach nicht mehr ändern, löschen oder neu anlegen — bis jemand den Monat wieder öffnet.', confirmLabel: 'Abschließen', confirmClass: 'btn-primary' })
    if (!ok) return
    setCloseLoading(true)
    try {
      if (isClosed) await reopenMonth(empId, year, month)
      else          await closeMonth(empId, year, month)
      await refetchClose()
      void qc.invalidateQueries({ queryKey: ['month-close-overview'] })
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setCloseLoading(false)
    }
  }

  return (
    <div>
      <div className="ta-toolbar">
        {viewMode === 'month' && (
          <div className="ta-month-nav">
            <button type="button" className="btn-secondary btn-small ent-year-btn" onClick={prevMonth} aria-label="Vormonat">
              <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className="ta-month" aria-live="polite">{monthLabel}</span>
            <button type="button" className="btn-secondary btn-small ent-year-btn" onClick={nextMonth} aria-label="Folgemonat">
              <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
        <SegmentNav
          items={[{ id: 'month', label: 'Monat' }, { id: 'running', label: 'Verlauf' }]}
          active={viewMode}
          onChange={setViewMode}
          style={{ marginBottom: 0 }}
        />
      </div>

      {viewMode === 'month' && (
        <>
          {loadingMonth && <p className="empty-note">Lädt …</p>}
          {monthData && (
            <>
              <div className="ws-tiles ta-tiles">
                <div className="ws-tile"><span className="ws-tile-label">Soll</span><span className="ws-tile-value">{fmtH(monthData.required)}</span></div>
                <div className="ws-tile"><span className="ws-tile-label">Ist</span><span className="ws-tile-value">{fmtH(monthData.actual)}</span></div>
                <div className="ws-tile">
                  <span className="ws-tile-label">Saldo</span>
                  <span className="ws-tile-value"><Balance n={monthData.balance} /></span>
                </div>
                <div className="ws-tile">
                  <span className="ws-tile-label">Monatsabschluss</span>
                  <span className="ws-tile-state">
                    {isClosed
                      ? <><Lock size={15} strokeWidth={2} aria-hidden="true" />abgeschlossen</>
                      : <>offen</>}
                  </span>
                  {canCloseMonths && (
                    <button type="button" className={`${isClosed ? 'btn-secondary' : 'btn-primary'} btn-small ws-tile-btn`} disabled={closeLoading} onClick={() => void toggleMonthClose()}>
                      {closeLoading ? 'Speichert …' : isClosed ? 'Wieder öffnen' : 'Monat abschließen'}
                    </button>
                  )}
                </div>
              </div>

              {!monthData.days.length && (
                <div className="empty-block">
                  <p className="empty-note">Für {monthLabel} ist kein Arbeitszeitmodell zugeordnet.</p>
                  <p className="empty-block-why">Ohne Modell gibt es keine Soll-Stunden und damit keinen Saldo. Zugeordnet wird es im Reiter „Arbeitszeit" des Mitarbeiters.</p>
                </div>
              )}
              {monthData.days.length > 0 && (
                <div className="table-scroll">
                  <table className="master-table ta-table">
                    <thead>
                      <tr>
                        <th scope="col" className="ta-col-toggle"><span className="sr-only">Buchungen</span></th>
                        <th scope="col">Datum</th>
                        <th scope="col">Tag</th>
                        <th scope="col" className="num">Soll</th>
                        <th scope="col" className="num">Ist</th>
                        <th scope="col" className="num">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthData.days.map(d => {
                        const isWeekend  = d.weekday === 0 || d.weekday === 6
                        const isExpanded = expandedDays.has(d.date)
                        const hasBookings = d.bookings && d.bookings.length > 0
                        return (
                          <Fragment key={d.date}>
                            <tr className={isWeekend ? 'ta-weekend' : undefined}>
                              <td className="ta-col-toggle">
                                {hasBookings && (
                                  <button type="button" className="ta-toggle" onClick={() => toggleDay(d.date)}
                                    aria-expanded={isExpanded} aria-label={`${isExpanded ? 'Buchungen ausblenden' : 'Buchungen anzeigen'}: ${fmtDateShort(d.date)}`}>
                                    {isExpanded
                                      ? <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
                                      : <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />}
                                  </button>
                                )}
                              </td>
                              <td className="cell-nowrap">
                                {fmtDateShort(d.date)}
                                {d.isHoliday && <span className="ta-holiday">Feiertag</span>}
                              </td>
                              <td className="ma-none">{WEEKDAY_SHORT[d.weekday]}</td>
                              <td className="num">{d.required > 0 ? fmtH(d.required) : <span className="ma-none">—</span>}</td>
                              <td className="num">
                                {d.actual > 0 ? fmtH(d.actual) : <span className="ma-none">—</span>}
                                {d.absence && (
                                  <span className="ta-absence" title={`${d.absence.name} — als Soll gutgeschrieben`}>
                                    {d.absence.name}{d.absence.fraction === 0.5 ? ' (halber Tag)' : ''}
                                  </span>
                                )}
                              </td>
                              <td className="num">{d.required > 0 ? <Balance n={d.balance} /> : <span className="ma-none">—</span>}</td>
                            </tr>
                            {isExpanded && (d.bookings as DayBooking[]).map(b => {
                              const touch = canTouch(b)
                              return (
                                <tr key={`bk-${b.id}`} className={`ta-booking${touch ? ' clickable-row' : ''}`}
                                  onClick={touch ? () => openEditBooking(b, d.bookings as DayBooking[]) : undefined}>
                                  <td className="ta-col-toggle">
                                    {touch ? (
                                      <button type="button" className="ta-toggle" aria-label={`Buchung ${b.project} bearbeiten`}
                                        onClick={e => { e.stopPropagation(); openEditBooking(b, d.bookings as DayBooking[]) }}>
                                        <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
                                      </button>
                                    ) : (b.billed || isClosed) && (
                                      <span className="ta-lock" title={b.billed ? 'Abgerechnet — Korrektur über Storno oder Gutschrift' : 'Monat abgeschlossen'}>
                                        <Lock size={12} strokeWidth={2} aria-hidden="true" />
                                        <span className="sr-only">{b.billed ? 'abgerechnet' : 'Monat abgeschlossen'}</span>
                                      </span>
                                    )}
                                  </td>
                                  <td colSpan={2} className="ta-booking-main">
                                    {b.time_start && b.time_finish && (
                                      <span className="ma-none ta-booking-time">{b.time_start.slice(0, 5)}–{b.time_finish.slice(0, 5)}</span>
                                    )}
                                    {b.project}{b.structure ? ` / ${b.structure}` : ''}
                                  </td>
                                  <td colSpan={2} className="ta-booking-desc">{b.description}</td>
                                  <td className="num">{fmtH(b.hours)}</td>
                                </tr>
                              )
                            })}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {viewMode === 'running' && (
        <>
          {loadingRunning && <p className="empty-note">Lädt …</p>}
          {runningData && runningData.months.length === 0 && (
            <div className="empty-block">
              <p className="empty-note">Noch kein Verlauf.</p>
              <p className="empty-block-why">Der Verlauf entsteht, sobald ein Arbeitszeitmodell zugeordnet ist — ab dessen Beginn rechnet das Zeitkonto Monat für Monat Soll gegen Ist.</p>
            </div>
          )}
          {runningData && runningData.months.length > 0 && (
            <>
              <p className="ta-total">Gesamtsaldo: <Balance n={runningData.totalBalance} /></p>
              <div className="table-scroll">
                <table className="master-table ta-table">
                  <thead>
                    <tr>
                      <th scope="col">Monat</th>
                      <th scope="col" className="num">Soll</th>
                      <th scope="col" className="num">Ist</th>
                      <th scope="col" className="num">Saldo</th>
                      <th scope="col" className="num">Laufender Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runningData.months.map((rm: RunningMonth) => (
                      <tr key={`${rm.year}-${rm.month}`}>
                        <td>{MONTH_NAMES[rm.month - 1]} {rm.year}</td>
                        <td className="num">{fmtH(rm.required)}</td>
                        <td className="num">{fmtH(rm.actual)}</td>
                        <td className="num"><Balance n={rm.balance} /></td>
                        <td className="num"><strong><Balance n={rm.cumulative} /></strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <Modal open={edit !== null} onClose={() => setEdit(null)} title="Buchung bearbeiten">
        {edit && (
          <div className="ta-edit">
            <p className="ta-edit-context">
              {fmtDateShort(monthData?.days.find(d => (d.bookings as DayBooking[]).some(x => x.id === edit.b.id))?.date ?? '') || null}
              {' · '}{edit.b.project}{edit.b.structure ? ` / ${edit.b.structure}` : ''}
            </p>
            <fieldset className="ta-edit-fields" disabled={!canEditBooking || patchBookingMut.isPending}>
              <legend className="sr-only">Buchung</legend>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="ta-start">Start</label>
                  <input id="ta-start" type="time" value={edit.start} onChange={e => setTime('start', e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="ta-finish">Ende</label>
                  <input id="ta-finish" type="time" value={edit.finish} onChange={e => setTime('finish', e.target.value)}
                    aria-invalid={tried && timeBackwards ? true : undefined} />
                </div>
                <div className="form-group">
                  <label htmlFor="ta-qty">Stunden</label>
                  <input id="ta-qty" type="text" inputMode="decimal" value={edit.qty}
                    onChange={e => setEdit(x => x && ({ ...x, qty: e.target.value }))}
                    aria-invalid={tried && qtyInvalid ? true : undefined} />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="ta-desc">Beschreibung</label>
                <input id="ta-desc" type="text" value={edit.desc} onChange={e => setEdit(x => x && ({ ...x, desc: e.target.value }))} />
              </div>
            </fieldset>
            {tried && (qtyInvalid || timeBackwards) && (
              <p className="ta-conflict" role="alert">
                {timeBackwards ? 'Das Ende liegt vor dem Start.' : 'Bitte Stunden zwischen 0 und 24 angeben, z. B. 1,5.'}
              </p>
            )}
            {overlaps.length > 0 ? (
              <div className="ta-conflict" role="alert">
                <strong>Zeitliche Überschneidung</strong> mit {overlaps.length === 1 ? '1 Buchung' : `${overlaps.length} Buchungen`} desselben Tages:
                <ul>
                  {overlaps.map(o => (
                    <li key={o.id}>{o.time_start?.slice(0, 5)}–{o.time_finish?.slice(0, 5)} · {o.project}{o.structure ? ` / ${o.structure}` : ''}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="ta-note">
                <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
                Änderungen wirken auf Zeitkonto, Projektkosten und die Arbeitszeitprüfung.
                {edit.b.hours_ext != null && Math.abs(edit.b.hours_ext - edit.b.hours) > 1e-9 && ` Abrechenbar sind ${fmtH(edit.b.hours_ext)} — das bleibt so.`}
              </p>
            )}
            <DialogFooter
              secondary={canDeleteBooking ? (
                <button type="button" className="btn-secondary btn-danger-text" disabled={deleteBookingMut.isPending} onClick={() => void removeBooking()}>
                  {deleteBookingMut.isPending ? 'Löscht …' : 'Löschen'}
                </button>
              ) : undefined}
            >
              <button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Abbrechen</button>
              {canEditBooking && (
                <button type="button" className="btn-primary" disabled={patchBookingMut.isPending || overlaps.length > 0} onClick={saveBooking}>
                  {patchBookingMut.isPending ? 'Speichert …' : 'Speichern'}
                </button>
              )}
            </DialogFooter>
          </div>
        )}
      </Modal>
      {confirmDialog}
    </div>
  )
}
