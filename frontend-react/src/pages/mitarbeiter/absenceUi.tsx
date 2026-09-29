import { AlertTriangle } from 'lucide-react'
import { HelpHint } from '@/components/ui/HelpHint'
import type { Absence, AbsenceStatus, VacationBalance } from '@/api/abwesenheit'
import { fmtDayNum, fmtDays, logOf } from './absenceFormat'

/**
 * Gemeinsame Bausteine der Abwesenheiten (UI-Pilot Runde 11).
 *
 * Status, Zeitraum, Tage und Verlauf standen vorher in drei Dateien je
 * eigen — mit Inline-Farben, „(½)" statt „halber Tag", „15.5 T" statt
 * „15,5 Tage" und einem grünen Resturlaub, der nichts bewertet.
 */

const STATUS_LABEL: Record<AbsenceStatus, string> = {
  REQUESTED: 'Beantragt',
  APPROVED:  'Genehmigt',
  REJECTED:  'Abgelehnt',
  CANCELLED: 'Storniert',
}

export function AbsenceStatusBadge({ status }: { status: AbsenceStatus }) {
  return <span className={`abs-status abs-status--${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>
}

export function AbsenceType({ a }: { a: Pick<Absence, 'TYPE_NAME' | 'TYPE_COLOR'> }) {
  return (
    <span className="abs-type">
      {/* Die Farbe ist ein gespeicherter Wert der Abwesenheitsart, kein Token. */}
      <span className="abs-type-dot" style={{ background: a.TYPE_COLOR || 'var(--text-4)' }} aria-hidden="true" />
      {a.TYPE_NAME || '—'}
    </span>
  )
}

/**
 * Rückfragen, Antworten und die Begründung einer Entscheidung.
 *
 * `DECISION_NOTE` heißt je nach Stand etwas anderes: bei einem offenen
 * Antrag die letzte Rückfrage, nach der Entscheidung deren Begründung. Vorher
 * stand vor einer Ablehnungsbegründung „Rückfrage:".
 */
export function ClarificationThread({ a }: { a: Absence }) {
  const log = logOf(a)
  const decided = a.STATUS === 'APPROVED' || a.STATUS === 'REJECTED'
  const legacyQuestion = !decided && log.length === 0 && a.DECISION_NOTE
  const reason = decided && a.DECISION_NOTE ? a.DECISION_NOTE : null
  if (!log.length && !legacyQuestion && !reason) return null
  return (
    <ul className="abs-thread">
      {log.map((e, i) => (
        <li key={i}>
          <span className={e.role === 'approver' ? 'abs-thread-who abs-thread-who--approver' : 'abs-thread-who'}>
            {e.role === 'approver' ? 'Rückfrage' : 'Antwort'}:
          </span>{' '}
          <span className="abs-thread-text">{e.text}</span>
        </li>
      ))}
      {legacyQuestion && (
        <li><span className="abs-thread-who abs-thread-who--approver">Rückfrage:</span> <span className="abs-thread-text">{a.DECISION_NOTE}</span></li>
      )}
      {reason && (
        <li><span className="abs-thread-who">{a.STATUS === 'REJECTED' ? 'Begründung' : 'Anmerkung'}:</span> <span className="abs-thread-text">{reason}</span></li>
      )}
    </ul>
  )
}

/**
 * Urlaubssaldo als Kacheln. Negativ ist Konvention („rote Zahlen"), keine
 * Bewertung — ein Resturlaub im Plus wird deshalb nicht grün.
 */
export function VacationTiles({ bal, year }: { bal: VacationBalance | undefined; year: number }) {
  const v = (n: number | undefined) => (bal ? fmtDayNum(n ?? 0) : '…')
  return (
    <>
      <div className="ws-tiles abs-tiles" aria-label={`Urlaub ${year}`} role="group">
        <div className="ws-tile">
          <span className="ws-tile-label">Anspruch {year}</span>
          <span className="ws-tile-value">{v(bal?.entitled)} <span className="ws-tile-unit">Tage</span></span>
        </div>
        <div className="ws-tile">
          <span className="ws-tile-label">Übertrag aus {year - 1}</span>
          <span className="ws-tile-value">{v(bal?.carryover)} <span className="ws-tile-unit">Tage</span></span>
          {bal?.carryoverExpires && <span className="ws-tile-sub">verfällt am {bal.carryoverExpiryLabel ?? '31.03.'}</span>}
        </div>
        <div className="ws-tile">
          <span className="ws-tile-label">Genommen</span>
          <span className="ws-tile-value">{v(bal?.taken)} <span className="ws-tile-unit">Tage</span></span>
          {!!bal?.pending && <span className="ws-tile-sub">dazu {fmtDays(bal.pending)} beantragt</span>}
        </div>
        {!!bal?.forfeited && (
          <div className="ws-tile">
            <span className="ws-tile-label">Verfallen</span>
            <span className="ws-tile-value">{v(bal.forfeited)} <span className="ws-tile-unit">Tage</span></span>
          </div>
        )}
        <div className="ws-tile">
          <span className="ws-tile-label">Resturlaub<HelpHint id="absence.vacation_balance" /></span>
          <span className={`ws-tile-value${bal && bal.remaining < 0 ? ' abs-neg' : ''}`}>
            {bal ? (bal.remaining < 0 ? `−${fmtDayNum(-bal.remaining)}` : fmtDayNum(bal.remaining)) : '…'} <span className="ws-tile-unit">Tage</span>
          </span>
          {!!bal?.pending && <span className="ws-tile-sub">nach Genehmigung {fmtDayNum(Math.round((bal.remaining - bal.pending) * 100) / 100)}</span>}
        </div>
      </div>
      {!!bal?.atRisk && bal.atRisk > 0 && (
        <p className="ta-note abs-at-risk">
          <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
          {fmtDays(bal.atRisk)} Übertrag verfallen am {bal.carryoverExpiryLabel ?? '31.03.'}, wenn sie bis dahin nicht genommen sind.
        </p>
      )}
    </>
  )
}
