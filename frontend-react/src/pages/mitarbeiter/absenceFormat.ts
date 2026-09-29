import type { Absence, ClarificationEntry } from '@/api/abwesenheit'

// Formate und Regeln der Abwesenheiten (UI-Pilot Runde 11) — ohne JSX,
// damit die Bausteine in absenceUi.tsx reine Komponenten bleiben.

/** 5 → „5 Tage", 1 → „1 Tag", 0,5 → „½ Tag", 15,5 → „15,5 Tage". */
export function fmtDays(n: number): string {
  if (n === 0.5) return '½ Tag'
  return `${String(Math.round(n * 100) / 100).replace('.', ',')} ${n === 1 ? 'Tag' : 'Tage'}`
}
/** Zahl ohne Einheit mit Komma (Kacheln, Tabellen). */
export const fmtDayNum = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')

const dm  = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`
const dmy = (d: string) => `${dm(d)}${d.slice(0, 4)}`

/** „12.10.–16.10.2026", „28.12.2026–01.01.2027", „24.09.2026, halber Tag". */
export function fmtAbsenceRange(a: { DATE_FROM: string; DATE_TO: string; HALF_DAY?: boolean }): string {
  if (a.DATE_FROM === a.DATE_TO) return `${dmy(a.DATE_FROM)}${a.HALF_DAY ? ', halber Tag' : ''}`
  if (a.DATE_FROM.slice(0, 4) === a.DATE_TO.slice(0, 4)) return `${dm(a.DATE_FROM)}–${dmy(a.DATE_TO)}`
  return `${dmy(a.DATE_FROM)}–${dmy(a.DATE_TO)}`
}

export const employeeName = (a: Absence) =>
  [a.EMPLOYEE_FIRST_NAME, a.EMPLOYEE_LAST_NAME].filter(Boolean).join(' ') || a.EMPLOYEE_SHORT_NAME || '—'

export const logOf = (a: Absence): ClarificationEntry[] => (Array.isArray(a.CLARIFICATION_LOG) ? a.CLARIFICATION_LOG : [])

/** Steht eine Rückfrage offen, auf die der Antragsteller antworten sollte? */
export function needsReply(a: Absence): boolean {
  const log = logOf(a)
  if (log.length > 0) return log[log.length - 1].role === 'approver'
  return !!a.DECISION_NOTE // Alt-Daten: es gibt eine Rückfrage, aber noch keinen Log
}
