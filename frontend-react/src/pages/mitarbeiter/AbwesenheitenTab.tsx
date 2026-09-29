import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import { ListLoading } from '@/components/ui/Skeleton'
import { useGuardedAction } from '@/hooks/useDirtyGuard'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { usePermission } from '@/store/permissionsStore'
import { useAuthStore } from '@/store/authStore'
import { fetchAbsences, type Absence, type AbsenceStatus } from '@/api/abwesenheit'
import type { Employee } from '@/api/mitarbeiter'
import { SegmentNav } from './SegmentNav'
import { MeineAbwesenheiten } from './MeineAbwesenheiten'
import { UrlaubsanspruecheEditor } from './UrlaubsanspruecheEditor'
import { ClarifyAbsenceDialog, RejectAbsenceDialog } from './AbsenceDecision'
import { useAbsenceDecision } from './useAbsenceDecision'
import { AbsenceType, ClarificationThread } from './absenceUi'
import { employeeName, fmtAbsenceRange, fmtDays } from './absenceFormat'
import { localIso } from './mitarbeiterFormat'

/**
 * Reiter „Abwesenheiten" im Modul Mitarbeiter (UI-Pilot Runde 11): Anträge,
 * Kalender, eigene Anträge, Urlaubsansprüche.
 *
 * Der Unterreiter steht in der URL (`?tab=abwesenheiten&sub=…`); ein Link
 * aus einer Benachrichtigung (`&absence=…`) hebt den Antrag hervor.
 */

export type AbsSub = 'inbox' | 'calendar' | 'my' | 'entitlements'
const ABS_SUBS: AbsSub[] = ['inbox', 'calendar', 'my', 'entitlements']
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

export function AbwesenheitenTab({ employees }: { employees: Employee[] }) {
  const [params, setParams] = useSearchParams()
  const guarded = useGuardedAction()
  const canView    = usePermission('absence.view')
  const canRequest = usePermission('absence.request')
  const canManage  = usePermission('absence.manage')
  const linkedAbsence = Number(params.get('absence')) || null

  const { data: inboxRes, isLoading: inboxLoading } = useQuery({
    queryKey: ['absences-inbox'],
    queryFn:  () => fetchAbsences({ status: 'REQUESTED' }),
    enabled:  canView,
  })
  const inbox = inboxRes?.data ?? []

  const items: { id: AbsSub; label: string }[] = [
    ...(canView    ? [{ id: 'inbox' as AbsSub, label: `Anträge${inbox.length ? ` (${inbox.length})` : ''}` }, { id: 'calendar' as AbsSub, label: 'Kalender' }] : []),
    ...(canRequest ? [{ id: 'my' as AbsSub, label: 'Meine Anträge' }] : []),
    ...(canManage  ? [{ id: 'entitlements' as AbsSub, label: 'Urlaubsansprüche' }] : []),
  ]
  const raw = params.get('sub') as AbsSub | null
  const sub: AbsSub = raw && ABS_SUBS.includes(raw) && items.some(i => i.id === raw) ? raw : (items[0]?.id ?? 'my')

  function changeSub(next: AbsSub) {
    guarded(() => {
      const p = new URLSearchParams(params)
      p.set('sub', next)
      // Der Deep-Link ist abgearbeitet, sobald man den Bereich wechselt —
      // sonst hebt jede Rückkehr den alten Antrag erneut hervor.
      p.delete('absence')
      setParams(p, { replace: true })
    })
  }

  if (!items.length) return <p className="empty-note">Für Abwesenheiten fehlt das Recht „Abwesenheiten ansehen" oder „Abwesenheit beantragen".</p>

  return (
    <div>
      <SegmentNav items={items} active={sub} onChange={changeSub} />
      {sub === 'inbox' && <AbsenceInbox inbox={inbox} loading={inboxLoading} linkedAbsence={linkedAbsence} />}
      {sub === 'calendar' && <AbsenceCalendar employees={employees} />}
      {sub === 'my' && <MeineAbwesenheiten focusAbsenceId={linkedAbsence} />}
      {sub === 'entitlements' && <UrlaubsanspruecheEditor employees={employees} />}
    </div>
  )
}

// ── Anträge (Genehmigungs-Postfach) ──────────────────────────────────────────

function AbsenceInbox({ inbox, loading, linkedAbsence }: { inbox: Absence[]; loading: boolean; linkedAbsence: number | null }) {
  const narrow = useIsNarrow()
  const myId = useAuthStore(s => s.employeeId)
  const canApprove = usePermission('absence.approve')
  const canManage  = usePermission('absence.manage')
  const { decide, refresh } = useAbsenceDecision()
  const [rejecting, setRejecting] = useState<Absence | null>(null)
  const [clarifying, setClarifying] = useState<Absence | null>(null)

  // Wer ist im Zeitraum eines offenen Antrags schon (genehmigt) abwesend?
  const range = useMemo(() => {
    if (!inbox.length) return null
    let f = inbox[0].DATE_FROM, t = inbox[0].DATE_TO
    for (const a of inbox) { if (a.DATE_FROM < f) f = a.DATE_FROM; if (a.DATE_TO > t) t = a.DATE_TO }
    return { from: f, to: t }
  }, [inbox])
  const { data: overlapRes } = useQuery({
    queryKey: ['absences-overlap', range?.from, range?.to],
    queryFn:  () => fetchAbsences({ from: range!.from, to: range!.to }),
    enabled:  !!range,
  })
  const pool = overlapRes?.data ?? []
  const overlapsFor = (a: Absence) => pool.filter(o =>
    o.ID !== a.ID && o.EMPLOYEE_ID !== a.EMPLOYEE_ID && o.STATUS === 'APPROVED' && o.DATE_FROM <= a.DATE_TO && o.DATE_TO >= a.DATE_FROM)

  if (loading) return <ListLoading columns={5} />
  if (!inbox.length) return (
    <div className="empty-block">
      <p className="empty-note">Keine offenen Anträge.</p>
      <p className="empty-block-why">Beantragt jemand Urlaub oder eine andere Abwesenheit, die genehmigt werden muss, erscheint der Antrag hier — mit dem Hinweis, wer im selben Zeitraum schon fehlt.</p>
    </div>
  )

  const overlapNote = (a: Absence) => {
    const ov = overlapsFor(a)
    if (!ov.length) return null
    return (
      <span className="abs-overlap" title={ov.map(o => `${o.EMPLOYEE_SHORT_NAME}: ${o.TYPE_NAME} ${fmtAbsenceRange(o)}`).join('\n')}>
        <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
        Gleichzeitig abwesend: {ov.map(o => o.EMPLOYEE_SHORT_NAME).filter(Boolean).join(', ')}
      </span>
    )
  }

  const actions = (a: Absence) => {
    if (!canApprove) return <span className="ma-none">—</span>
    // Den eigenen Antrag entscheidet jemand anderes — außer, wer Abwesenheiten verwaltet (Server: /:id/decision).
    if (a.EMPLOYEE_ID === myId && !canManage) return <span className="abs-own">Eigener Antrag — entscheidet jemand anderes</span>
    const who = a.EMPLOYEE_SHORT_NAME ?? employeeName(a)
    return (
      <div className="abs-actions">
        <button type="button" className="btn-primary btn-small" disabled={decide.isPending}
          aria-label={`Antrag von ${who} genehmigen`} onClick={() => decide.mutate({ a, decision: 'APPROVED' })}>Genehmigen</button>
        <button type="button" className="btn-secondary btn-small" disabled={decide.isPending}
          aria-label={`Antrag von ${who} ablehnen`} onClick={() => setRejecting(a)}>Ablehnen</button>
        <button type="button" className="btn-secondary btn-small" aria-label={`Rückfrage an ${who}`} onClick={() => setClarifying(a)}>Rückfrage</button>
      </div>
    )
  }

  const body = narrow ? (
    <ul className="abs-cards" aria-label="Offene Anträge">
      {inbox.map(a => (
        <li key={a.ID} className={`abs-card${a.ID === linkedAbsence ? ' abs-card--focus' : ''}`}>
          <div className="abs-card-top">
            <div className="abs-card-main">
              <span className="abs-card-range">{employeeName(a)}</span>
              <span className="abs-card-sub">{fmtAbsenceRange(a)} · <AbsenceType a={a} /> · {fmtDays(a.DAYS)}</span>
              {overlapNote(a)}
            </div>
          </div>
          {a.NOTE && <p className="abs-note">{a.NOTE}</p>}
          <ClarificationThread a={a} />
          <div className="abs-card-actions">{actions(a)}</div>
        </li>
      ))}
    </ul>
  ) : (
    <div className="table-scroll">
      <table className="master-table abs-table">
        <thead><tr>
          <th scope="col">Mitarbeiter</th>
          <th scope="col">Zeitraum</th>
          <th scope="col">Art</th>
          <th scope="col" className="num">Tage</th>
          <th scope="col">Notiz</th>
          <th scope="col"><span className="sr-only">Entscheidung</span></th>
        </tr></thead>
        <tbody>
          {inbox.map(a => (
            <tr key={a.ID} className={a.ID === linkedAbsence ? 'abs-row--focus' : undefined}>
              <td className="cell-nowrap"><strong>{a.EMPLOYEE_SHORT_NAME}</strong> {employeeName(a)}</td>
              <td>
                <span className="cell-nowrap">{fmtAbsenceRange(a)}</span>
                {overlapNote(a)}
              </td>
              <td><AbsenceType a={a} /></td>
              <td className="num">{String(a.DAYS).replace('.', ',')}</td>
              <td className="abs-note-cell">
                {a.NOTE || <span className="ma-none">—</span>}
                <ClarificationThread a={a} />
              </td>
              <td className="abs-actions-cell">{actions(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <>
      {body}
      {rejecting && (
        <RejectAbsenceDialog absence={rejecting} pending={decide.isPending} onClose={() => setRejecting(null)}
          onReject={note => decide.mutate({ a: rejecting, decision: 'REJECTED', note: note || undefined }, { onSuccess: () => setRejecting(null) })} />
      )}
      {clarifying && (
        <ClarifyAbsenceDialog absence={clarifying} onClose={() => setClarifying(null)} onDone={() => { setClarifying(null); refresh() }} />
      )}
    </>
  )
}

// ── Kalender ─────────────────────────────────────────────────────────────────

type Cell = { color: string; status: AbsenceStatus; name: string; half: boolean }

function AbsenceCalendar({ employees }: { employees: Employee[] }) {
  const now = new Date()
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const { year, month } = ym
  const pad = (n: number) => String(n).padStart(2, '0')
  const days = new Date(year, month, 0).getDate()
  const from = `${year}-${pad(month)}-01`
  const to   = `${year}-${pad(month)}-${pad(days)}`
  const today = localIso(now)

  const { data, isLoading } = useQuery({
    queryKey: ['absences-calendar', year, month],
    queryFn:  () => fetchAbsences({ from, to }),
  })
  const rows = useMemo(() => data?.data ?? [], [data])

  const byEmp = useMemo(() => {
    const m = new Map<number, Map<number, Cell>>()
    for (const a of rows) {
      if (a.STATUS === 'REJECTED' || a.STATUS === 'CANCELLED') continue
      for (const d = new Date(`${a.DATE_FROM}T00:00:00`), end = new Date(`${a.DATE_TO}T00:00:00`); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue
        if (!m.has(a.EMPLOYEE_ID)) m.set(a.EMPLOYEE_ID, new Map())
        m.get(a.EMPLOYEE_ID)!.set(d.getDate(), { color: a.TYPE_COLOR || 'var(--text-4)', status: a.STATUS, name: a.TYPE_NAME || 'Abwesenheit', half: a.HALF_DAY })
      }
    }
    return m
  }, [rows, year, month])
  const legend = useMemo(() => {
    const seen = new Map<string, string>()
    for (const a of rows) if (a.STATUS === 'APPROVED' || a.STATUS === 'REQUESTED') seen.set(a.TYPE_NAME || 'Abwesenheit', a.TYPE_COLOR || 'var(--text-4)')
    return [...seen.entries()]
  }, [rows])

  const active = employees.filter(e => e.ACTIVE !== 2)
  const dayList = Array.from({ length: days }, (_, i) => i + 1)
  const weekday = (d: number) => new Date(year, month - 1, d).getDay()
  const shift = (delta: number) => setYm(({ year: y, month: mo }) => {
    const n = mo + delta
    return n < 1 ? { year: y - 1, month: 12 } : n > 12 ? { year: y + 1, month: 1 } : { year: y, month: n }
  })
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1
  // Am Handy passt nur ein Teil des Monats ins Bild — den heutigen Tag
  // dorthin schieben, wo er zu sehen ist, statt immer beim 1. anzufangen.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scrollRef.current
    const cell = box?.querySelector<HTMLElement>('th.abs-cal-today')
    const name = box?.querySelector<HTMLElement>('th.abs-cal-name')
    if (!box || !cell || box.scrollWidth <= box.clientWidth) return
    box.scrollLeft = Math.max(0, cell.offsetLeft - (name?.offsetWidth ?? 0) - 2 * cell.offsetWidth)
  }, [isLoading, year, month, active.length])
  const absentToday = isCurrent ? active.filter(e => byEmp.get(e.ID)?.get(now.getDate())?.status === 'APPROVED').length : 0

  return (
    <div>
      <div className="ta-toolbar">
        <div className="ta-month-nav">
          <button type="button" className="btn-secondary btn-small ent-year-btn" onClick={() => shift(-1)} aria-label="Vormonat"><ChevronLeft size={15} strokeWidth={2} aria-hidden="true" /></button>
          <span className="ta-month" aria-live="polite">{MONTH_NAMES[month - 1]} {year}</span>
          <button type="button" className="btn-secondary btn-small ent-year-btn" onClick={() => shift(1)} aria-label="Folgemonat"><ChevronRight size={15} strokeWidth={2} aria-hidden="true" /></button>
        </div>
        {!isCurrent && <button type="button" className="btn-secondary btn-small" onClick={() => setYm({ year: now.getFullYear(), month: now.getMonth() + 1 })}>Heute</button>}
        {isCurrent && <span className="list-info">Heute abwesend: {absentToday} von {active.length}</span>}
      </div>

      {isLoading && <ListLoading columns={6} />}
      {!isLoading && active.length === 0 && <p className="empty-note">Keine aktiven Mitarbeiter.</p>}
      {!isLoading && active.length > 0 && (
        <div className="table-scroll abs-cal-scroll" ref={scrollRef}>
          <table className="abs-cal">
            <caption className="sr-only">Abwesenheiten {MONTH_NAMES[month - 1]} {year}</caption>
            <thead>
              <tr>
                <th scope="col" className="abs-cal-name">Mitarbeiter</th>
                {dayList.map(d => {
                  const wd = weekday(d)
                  const iso = `${year}-${pad(month)}-${pad(d)}`
                  return (
                    <th scope="col" key={d} className={`abs-cal-day${wd === 0 || wd === 6 ? ' abs-cal-we' : ''}${iso === today ? ' abs-cal-today' : ''}`}>
                      <span className="abs-cal-wd">{WEEKDAY[wd]}</span>{d}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {active.map(e => {
                const dm = byEmp.get(e.ID)
                return (
                  <tr key={e.ID}>
                    <th scope="row" className="abs-cal-name" title={`${e.FIRST_NAME} ${e.LAST_NAME}`}>{e.ABBR}</th>
                    {dayList.map(d => {
                      const c = dm?.get(d)
                      const wd = weekday(d)
                      const iso = `${year}-${pad(month)}-${pad(d)}`
                      const cls = ['abs-cal-cell', wd === 0 || wd === 6 ? 'abs-cal-we' : '', iso === today ? 'abs-cal-today' : '',
                        c ? (c.status === 'REQUESTED' ? 'abs-cal-req' : 'abs-cal-ok') : '', c?.half ? 'abs-cal-half' : ''].filter(Boolean).join(' ')
                      const label = c ? `${e.ABBR}, ${pad(d)}.${pad(month)}.: ${c.name}${c.half ? ', halber Tag' : ''}${c.status === 'REQUESTED' ? ', beantragt' : ''}` : undefined
                      return (
                        <td key={d} className={cls} title={label} aria-label={label}
                          // Farbe der Abwesenheitsart (gespeicherter Wert)
                          style={c ? ({ '--abs-c': c.color } as CSSProperties) : undefined}>
                          {c?.status === 'REQUESTED' && <span aria-hidden="true">?</span>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mc-legend abs-cal-legend">
        {legend.map(([name, color]) => (
          <span key={name}><span className="abs-type-dot" style={{ background: color }} aria-hidden="true" />{name}</span>
        ))}
        <span><span className="abs-cal-key abs-cal-key--ok" aria-hidden="true" />genehmigt</span>
        <span><span className="abs-cal-key abs-cal-key--req" aria-hidden="true">?</span>beantragt</span>
        <span><span className="abs-cal-key abs-cal-key--half" aria-hidden="true" />halber Tag</span>
      </p>
    </div>
  )
}
