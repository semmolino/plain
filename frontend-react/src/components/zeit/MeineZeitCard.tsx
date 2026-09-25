import { useMemo, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ClockPlus, Coffee, Lock, Pencil, Repeat, Trash2, ClipboardCheck } from 'lucide-react'
import { fetchMine, type MyBooking } from '@/api/eigeneZeit'
import { fetchMonthBalance, type DayBalance } from '@/api/mitarbeiter'
import { deleteBuchung } from '@/api/projekte'
import { useCanBook } from '@/hooks/useBooking'
import { useConfirm } from '@/hooks/useConfirm'
import { HelpHint } from '@/components/ui/HelpHint'
import { useQuickBooking } from '@/store/quickBookingStore'
import { useTimerStore } from '@/store/timerStore'
import { useToast } from '@/store/toastStore'
import { localIsoDate, addDaysIso, mondayOf, isoWeek, fmtHours, fmtDayShort } from '@/utils/zeit'
import { EditBookingDialog } from '@/components/zeit/EditBookingDialog'

/**
 * „Meine Zeit" — die eigene Woche auf einen Blick (UI-Pilot 2026-09, Runde 2).
 *
 * Vorher zeigte die Mitarbeiter-Ansicht zwei Nur-Lese-Tabellen („Buchungen
 * heute", „Letzte Buchungen dieses Monats"). Wer eine Buchung korrigieren
 * wollte, musste ins Projekt, in den Reiter Buchungen und dort die eigene
 * Zeile unter allen anderen suchen — mit „Eigene Zeit buchen" ging das gar
 * nicht, der Reiter braucht `projects.view`.
 *
 * Jetzt: Wochenleiste Mo–Fr mit Ist und Soll je Tag, darunter die Buchungen
 * des gewaehlten Tages mit „Nochmal buchen", Aendern und Loeschen. Gesperrte
 * Buchungen (abgerechnet, Monat abgeschlossen) sagen, warum — statt einen
 * Knopf anzubieten, der dann mit 409 scheitert.
 *
 * Daten: GET /buchungen/mine (nur eigene, ohne Betraege) und der eigene
 * Monatssaldo (Soll aus dem Arbeitszeitmodell, Ist inkl. Abwesenheiten).
 */
export function MeineZeitCard({ employeeId }: { employeeId: number | null }) {
  const { canBook } = useCanBook()
  return canBook && employeeId != null ? <MeineZeitInner employeeId={employeeId} /> : null
}

const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function monthsOf(from: string, to: string): Array<[number, number]> {
  const a: [number, number] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
  const b: [number, number] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))]
  return a[0] === b[0] && a[1] === b[1] ? [a] : [a, b]
}

function MeineZeitInner({ employeeId }: { employeeId: number }) {
  const today = localIsoDate()
  const [weekStart, setWeekStart] = useState(() => mondayOf(today))
  const [selected,  setSelected]  = useState(today)
  const [editing,   setEditing]   = useState<MyBooking | null>(null)
  const weekEnd = addDaysIso(weekStart, 6)
  const { canEditOwn, canDeleteOwn } = useCanBook()
  const openBooking = useQuickBooking(s => s.open)
  const openReview  = useTimerStore(s => s.openReview)
  const qc    = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()

  const { data: mineRes, isLoading, isError } = useQuery({
    queryKey: ['my-time', weekStart],
    queryFn:  () => fetchMine(weekStart, weekEnd),
    staleTime: 30_000,
  })
  // Soll/Ist aus dem Monatssaldo — derselbe Cache wie die Kennzahlen der
  // Uebersicht. Eine Woche kann zwei Monate beruehren.
  const balances = useQueries({
    queries: monthsOf(weekStart, weekEnd).map(([y, m]) => ({
      queryKey: ['emp-balance', employeeId, y, m],
      queryFn:  () => fetchMonthBalance(employeeId, y, m),
      staleTime: 60_000,
    })),
  })
  const dayBal = useMemo(() => {
    const map = new Map<string, DayBalance>()
    for (const b of balances) {
      const days = b.data?.data?.days
      if (Array.isArray(days)) for (const d of days) map.set(d.date, d)
    }
    return map
  }, [balances])

  const bookings = useMemo(() => mineRes?.data.bookings ?? [], [mineRes])
  const drafts   = useMemo(() => mineRes?.data.drafts ?? [], [mineRes])

  // Mo–Fr immer, Wochenende nur, wenn dort etwas gebucht ist.
  const days = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i < 7; i++) {
      const iso = addDaysIso(weekStart, i)
      const weekend = i >= 5
      if (!weekend || bookings.some(b => b.BOOKING_DATE === iso) || (dayBal.get(iso)?.required ?? 0) > 0) out.push(iso)
    }
    return out
  }, [weekStart, bookings, dayBal])

  const dayRows   = bookings.filter(b => b.BOOKING_DATE === selected)
  const dayDrafts = drafts.filter(d => d.BOOKING_DATE === selected)
  const weekIst   = days.reduce((s, d) => s + istOf(d), 0)
  const weekSoll  = days.reduce((s, d) => s + (dayBal.get(d)?.required ?? 0), 0)

  function istOf(iso: string): number {
    const bal = dayBal.get(iso)
    if (bal) return bal.actual
    return bookings.filter(b => b.BOOKING_DATE === iso && b.ENTRY_KIND !== 'BREAK').reduce((s, b) => s + b.QUANTITY_INT, 0)
  }

  function goWeek(delta: number) {
    const next = addDaysIso(weekStart, delta * 7)
    setWeekStart(next)
    setSelected(next <= today && today <= addDaysIso(next, 6) ? today : next)
  }

  function refresh() {
    for (const key of ['my-time', 'emp-balance', 'emp-running', 'buchungen', 'structure', 'workstart-status', 'my-streak']) {
      void qc.invalidateQueries({ queryKey: [key] })
    }
  }

  async function remove(b: MyBooking) {
    const ok = await confirm({
      title: 'Buchung löschen?',
      message: `${fmtHours(b.QUANTITY_INT)} h auf ${b.PROJECT?.ABBR ?? ''} / ${b.STRUCTURE?.ABBR ?? ''} am ${fmtDayShort(b.BOOKING_DATE)} werden gelöscht.`,
      confirmLabel: 'Löschen',
    })
    if (!ok) return
    try {
      await deleteBuchung(b.ID)
      toast.success('Buchung gelöscht')
      refresh()
    } catch (e) {
      toast.error((e as Error)?.message || 'Löschen fehlgeschlagen')
    }
  }

  const isThisWeek = weekStart === mondayOf(today)
  const selBal     = dayBal.get(selected)

  return (
    <section className="dash-card mz-card" aria-labelledby="mz-title">
      <div className="mz-head">
        <h2 className="dash-card-title mz-title" id="mz-title">
          Meine Zeit <HelpHint id="bookings.mine" size={13} />
        </h2>
        <div className="mz-weeknav">
          <button type="button" className="row-action-btn" onClick={() => goWeek(-1)} aria-label="Vorige Woche">
            <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
          </button>
          <span className="mz-weeklabel">
            KW {isoWeek(weekStart)}{isThisWeek ? ' · diese Woche' : ''}
          </span>
          <button type="button" className="row-action-btn" onClick={() => goWeek(1)} aria-label="Nächste Woche"
            disabled={isThisWeek}>
            <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
          </button>
          {!isThisWeek && (
            <button type="button" className="btn-secondary btn-small" onClick={() => { setWeekStart(mondayOf(today)); setSelected(today) }}>
              Heute
            </button>
          )}
        </div>
      </div>

      <div className="mz-week" role="group" aria-label={`Tage der KW ${isoWeek(weekStart)}`}>
        {days.map(d => {
          const bal  = dayBal.get(d)
          const ist  = istOf(d)
          const soll = bal?.required ?? 0
          const pct  = soll > 0 ? Math.min(100, Math.round(ist / soll * 100)) : ist > 0 ? 100 : 0
          const note = bal?.isHoliday ? 'Feiertag' : bal?.absence?.name ?? null
          const wd   = WD_SHORT[new Date(`${d}T12:00:00`).getDay()]
          return (
            <button key={d} type="button" className={`mz-day${d === today ? ' mz-day--today' : ''}`}
              aria-pressed={d === selected} onClick={() => setSelected(d)}
              aria-label={`${fmtDayShort(d)}: ${fmtHours(ist)} von ${fmtHours(soll)} Stunden${note ? `, ${note}` : ''}`}>
              <span className="mz-day-name">{wd} <span className="mz-day-date">{d.slice(8, 10)}.{d.slice(5, 7)}.</span></span>
              <span className="mz-day-hours">
                <strong>{fmtHours(ist) || '0'}</strong>
                {soll > 0 && <span className="mz-day-soll"> / {fmtHours(soll)} h</span>}
                {soll === 0 && <span className="mz-day-soll"> h</span>}
              </span>
              <span className="mz-day-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
              {note && <span className="mz-day-note">{note}</span>}
            </button>
          )
        })}
      </div>
      {weekSoll > 0 && (
        <p className="mz-weeksum">Woche: <strong>{fmtHours(weekIst)} h</strong> von {fmtHours(weekSoll)} h Soll</p>
      )}

      <div className="mz-daylist">
        <div className="mz-daylist-head">
          <h3 className="mz-daytitle">{selected === today ? 'Heute' : fmtDayShort(selected)}</h3>
          {selBal?.absence && <span className="mz-day-note">{selBal.absence.name}</span>}
        </div>

        {dayDrafts.length > 0 && (
          <div className="mz-drafts" role="status">
            <span>
              {dayDrafts.length === 1 ? '1 Eintrag der Stempeluhr wartet' : `${dayDrafts.length} Einträge der Stempeluhr warten`}
              {' '}auf Freigabe ({fmtHours(dayDrafts.filter(x => x.ENTRY_KIND !== 'BREAK').reduce((s, x) => s + x.QUANTITY_INT, 0))} h).
            </span>
            <button type="button" className="btn-secondary btn-small" onClick={() => openReview(selected === today ? undefined : selected)}>
              <ClipboardCheck size={13} strokeWidth={2} aria-hidden="true" /> Prüfen &amp; freigeben
            </button>
          </div>
        )}

        {isLoading && <p className="mz-empty">Lädt …</p>}
        {isError && <p className="mz-empty">Buchungen konnten nicht geladen werden.</p>}
        {!isLoading && !isError && dayRows.length === 0 && (
          <p className="mz-empty">
            {selected > today ? 'Dieser Tag liegt in der Zukunft.' : 'An diesem Tag ist noch nichts gebucht.'}
          </p>
        )}

        {dayRows.length > 0 && (
          <ul className="mz-list">
            {dayRows.map(b => {
              const isBreak = b.ENTRY_KIND === 'BREAK'
              const lock = b.BILLED ? 'abgerechnet' : b.CLOSED ? 'Monat abgeschlossen' : null
              const label = `${b.PROJECT?.ABBR ?? ''} ${b.STRUCTURE?.ABBR ?? ''}`.trim()
              return (
                <li key={b.ID} className={`mz-row${isBreak ? ' mz-row--break' : ''}`}>
                  <div className="mz-row-main">
                    <span className="mz-row-time">
                      {b.TIME_START ? `${b.TIME_START.slice(0, 5)}–${b.TIME_FINISH?.slice(0, 5) ?? ''}` : ''}
                    </span>
                    <span className="mz-row-task">
                      {isBreak
                        ? <><Coffee size={13} strokeWidth={2} aria-hidden="true" /> Pause</>
                        : <><strong>{b.PROJECT?.ABBR}</strong> · {b.STRUCTURE?.ABBR}{b.STRUCTURE?.NAME ? ` ${b.STRUCTURE.NAME}` : ''}</>}
                    </span>
                    <span className="mz-row-hours">{fmtHours(b.QUANTITY_INT)} h</span>
                    <span className="mz-row-actions">
                      {!isBreak && b.PROJECT_ID != null && b.STRUCTURE_ID != null && (
                        <button type="button" className="row-action-btn" title="Nochmal buchen"
                          aria-label={`${label} nochmal buchen`}
                          onClick={() => openBooking({ projectId: b.PROJECT_ID!, structureId: b.STRUCTURE_ID!, description: b.POSTING_DESCRIPTION })}>
                          <Repeat size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      )}
                      {lock ? (
                        <span className="mz-lock" title={b.BILLED ? 'Steckt in einer Rechnung – Korrektur über Storno oder Gutschrift' : 'Der Monat ist abgeschlossen'}>
                          <Lock size={12} strokeWidth={2} aria-hidden="true" /> {lock}
                        </span>
                      ) : (
                        <>
                          {canEditOwn && !isBreak && (
                            <button type="button" className="row-action-btn" title="Ändern" aria-label={`${label} ändern`}
                              onClick={() => setEditing(b)}>
                              <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                            </button>
                          )}
                          {canDeleteOwn && (
                            <button type="button" className="row-action-btn row-action-btn--danger" title="Löschen"
                              aria-label={`${isBreak ? 'Pause' : label} löschen`} onClick={() => void remove(b)}>
                              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                  {!isBreak && b.POSTING_DESCRIPTION && <div className="mz-row-desc">{b.POSTING_DESCRIPTION}</div>}
                </li>
              )
            })}
          </ul>
        )}

        {selected <= today && (
          <button type="button" className="btn-secondary mz-add" onClick={() => openBooking({ date: selected })}>
            <ClockPlus size={15} strokeWidth={2} aria-hidden="true" />
            {selected === today ? 'Zeit für heute buchen' : `Zeit für ${fmtDayShort(selected)} buchen`}
          </button>
        )}
      </div>

      {editing && (
        <EditBookingDialog booking={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />
      )}
      {confirmDialog}
    </section>
  )
}
