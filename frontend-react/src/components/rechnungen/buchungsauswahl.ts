import type { TecEntry } from '@/api/rechnungen'
import { compareRows } from '@/utils/sortRows'

/**
 * Auswahl-Logik der Buchungstabelle in den Rechnungsassistenten
 * (`BuchungsauswahlTable.tsx`) — ohne React, damit sie prüfbar ist.
 *
 * Abgerechnet wird, was **sichtbar und angehakt** ist. Blendet ein Filter eine
 * angehakte Buchung aus, fällt sie aus der Auswahl und wird „geparkt"; zeigt
 * ihn der Filter wieder, kommt sie angehakt zurück (`applyVisibility`). So
 * zerstört Suchen keine Auswahl, und trotzdem landet nichts auf der Rechnung,
 * was man nicht sieht. Vorher waren Filter nur eine Ansicht, und „Im
 * Leistungszeitraum" rechnete die ausgeblendeten Buchungen mit ab.
 *
 * „0-Beträge mitabrechnen" ist eine Vorliebe, keine Ansicht: sie gilt für
 * jede Sammelaktion (Alle, Kopf-Häkchen, Vorauswahl). Einzeln
 * anhaken lässt sich eine 0-€-Buchung trotzdem.
 */

export const isZeroBooking = (t: TecEntry) => (t.HOURLY_RATE_TOTAL ?? 0) === 0

const day = (t: TecEntry) => (t.BOOKING_DATE ? t.BOOKING_DATE.slice(0, 10) : '')

export interface Period { start: string; end: string }

export interface BookingFilters {
  search:     string
  dateFrom:   string
  dateTo:     string
  employees:  Set<string>
  structures: Set<string>
  hideZero:   boolean
  /** „Seit letzter Rechnung": nur Buchungen nach diesem Tag — null = aus */
  since:      string | null
  /** „Im Leistungszeitraum" — null = aus */
  period:     Period | null
}

export function inPeriod(d: string, p: Period): boolean {
  return !!d && (!p.start || d >= p.start) && (!p.end || d <= p.end)
}

export function filterBookings(list: TecEntry[], f: BookingFilters): TecEntry[] {
  const q = f.search.trim().toLowerCase()
  return list.filter(t => {
    const d = day(t)
    if (f.hideZero && isZeroBooking(t)) return false
    if (f.employees.size > 0 && !(t.EMPLOYEE_SHORT_NAME && f.employees.has(t.EMPLOYEE_SHORT_NAME))) return false
    if (f.structures.size > 0 && !f.structures.has(t.STRUCTURE_LABEL ?? '')) return false
    if (f.dateFrom && !(d && d >= f.dateFrom)) return false
    if (f.dateTo   && !(d && d <= f.dateTo))   return false
    if (f.since    && !(d && d >  f.since))    return false
    if (f.period   && !inPeriod(d, f.period))  return false
    if (q) {
      const hay = `${t.POSTING_DESCRIPTION ?? ''} ${t.EMPLOYEE_SHORT_NAME ?? ''} ${t.STRUCTURE_LABEL ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// ── Sortierung über die Spaltenköpfe ─────────────────────────────────────────

export type BookingSortKey = 'BOOKING_DATE' | 'EMPLOYEE_SHORT_NAME' | 'POSTING_DESCRIPTION' | 'HOURS' | 'HOURLY_RATE' | 'HOURLY_RATE_TOTAL'
const SORT_KEYS: readonly BookingSortKey[] = ['BOOKING_DATE', 'EMPLOYEE_SHORT_NAME', 'POSTING_DESCRIPTION', 'HOURS', 'HOURLY_RATE', 'HOURLY_RATE_TOTAL']
const NUMERIC_SORT_KEYS: readonly BookingSortKey[] = ['HOURS', 'HOURLY_RATE', 'HOURLY_RATE_TOTAL']

/** Ein gespeicherter Schlüssel, den es nicht (mehr) gibt, fällt aufs Datum zurück. */
export const sortKeyOr = (k: unknown): BookingSortKey =>
  SORT_KEYS.includes(k as BookingSortKey) ? k as BookingSortKey : 'BOOKING_DATE'

/** Sortiert eine Kopie. Gleichstand ordnet das Datum — sonst sprängen gleich
 *  teure Buchungen bei jedem Klick durcheinander. Leerwerte stehen immer unten. */
export function sortBookings(rows: TecEntry[], key: BookingSortKey, dir: 'asc' | 'desc'): TecEntry[] {
  return [...rows].sort((a, b) =>
    compareRows(a, b, key, dir, NUMERIC_SORT_KEYS) || compareRows(a, b, 'BOOKING_DATE', 'asc'))
}

/** Was eine Sammelaktion wählt: 0-Beträge nur, wenn sie mitabgerechnet werden. */
export function billable(rows: TecEntry[], includeZero: boolean): TecEntry[] {
  return includeZero ? rows : rows.filter(t => !isZeroBooking(t))
}

export const idsOf = (rows: TecEntry[]) => new Set(rows.map(t => t.ID))

/** Vorauswahl: ein fortgesetzter Entwurf behält seine Zuordnung, sonst alles Abrechenbare. */
export function initialSelection(list: TecEntry[], includeZero: boolean): Set<number> {
  const assigned = list.filter(t => t.ASSIGNED)
  return idsOf(assigned.length > 0 ? assigned : billable(list, includeZero))
}

/** Alle 0-€-Buchungen in einem Rutsch an- oder abwählen. */
export function withZeros(prev: Set<number>, list: TecEntry[], include: boolean): Set<number> {
  const next = new Set(prev)
  for (const t of list) {
    if (!isZeroBooking(t)) continue
    if (include) next.add(t.ID); else next.delete(t.ID)
  }
  return next
}

/** Häkchen über einer Menge von Zeilen: an, aus oder teils. */
export type TriState = 'all' | 'some' | 'none'

export function triState(rows: TecEntry[], selected: Set<number>, includeZero: boolean): TriState {
  const target = billable(rows, includeZero)
  const any = rows.some(t => selected.has(t.ID))
  if (target.length > 0 && target.every(t => selected.has(t.ID))) return 'all'
  return any ? 'some' : 'none'
}

/**
 * Filter bestimmen mit, was abgerechnet wird: eine angehakte Buchung, die
 * nicht sichtbar ist, wandert von der Auswahl ins Parkfach; eine geparkte, die
 * wieder sichtbar ist, zurück. Buchungen außerhalb der Liste (Schlussrechnung:
 * Positionen, die gerade nicht gewählt sind) bleiben unberührt.
 * `null` heißt: nichts zu ändern.
 */
export function applyVisibility(
  list: TecEntry[], selected: Set<number>, parked: Set<number>, visible: Set<number>,
): { selected: Set<number>; parked: Set<number> } | null {
  const nextSelected = new Set(selected)
  const nextParked   = new Set(parked)
  let changed = false
  for (const t of list) {
    if (visible.has(t.ID)) {
      if (nextParked.delete(t.ID)) { nextSelected.add(t.ID); changed = true }
    } else if (nextSelected.delete(t.ID)) {
      nextParked.add(t.ID); changed = true
    }
  }
  return changed ? { selected: nextSelected, parked: nextParked } : null
}

/** Kopf-Häkchen: sichtbare Zeilen dazu- bzw. abwählen; Ausgeblendetes bleibt, wie es ist. */
export function toggleRows(prev: Set<number>, rows: TecEntry[], includeZero: boolean): Set<number> {
  const next   = new Set(prev)
  const target = billable(rows, includeZero)
  // Ist schon alles Abrechenbare gewählt (oder gibt es nichts davon), nimmt
  // der Klick die Zeilen heraus — auch einzeln angehakte 0-€-Buchungen.
  if (target.every(t => prev.has(t.ID))) rows.forEach(t => next.delete(t.ID))
  else target.forEach(t => next.add(t.ID))
  return next
}

export interface SelectionSummary {
  count:  number
  amount: number
  hours:  number
  /** angehakt, aber durch einen Filter ausgeblendet — wird NICHT abgerechnet */
  hidden: number
}

export function summarize(list: TecEntry[], selected: Set<number>, parked: Set<number>): SelectionSummary {
  let count = 0, amount = 0, hours = 0, hidden = 0
  for (const t of list) {
    if (parked.has(t.ID)) hidden++
    if (!selected.has(t.ID)) continue
    count++
    amount += t.HOURLY_RATE_TOTAL ?? 0
    hours  += t.HOURS ?? 0
  }
  const r2 = (n: number) => Math.round(n * 100) / 100
  return { count, amount: r2(amount), hours: r2(hours), hidden }
}

/** Ausgewählte Buchungen außerhalb des Leistungszeitraums der Rechnung. */
export function outsidePeriod(list: TecEntry[], selected: Set<number>, period: Period | null): TecEntry[] {
  if (!period) return []
  return list.filter(t => selected.has(t.ID) && !inPeriod(day(t), period))
}

// ── Vorlieben je Nutzer ──────────────────────────────────────────────────────
// Nur Vorlieben bleiben über Rechnungen hinweg stehen. Suche, Datum,
// Mitarbeiter und Leistung gehören zu *dieser* Rechnung: ein Datumsfilter vom
// letzten Projekt trug sich vorher still in die nächste Rechnung.

export const PREFS_KEY = 'plain:filt:tec-selection'
const LEGACY_KEYS = ['search', 'dateFrom', 'dateTo', 'emp']

export interface BookingPrefs {
  hideZero:    boolean
  includeZero: boolean
  sinceLast:   boolean
}

const PREF_DEFAULTS: BookingPrefs = { hideZero: false, includeZero: true, sinceLast: false }

export function loadPrefs(key = PREFS_KEY): BookingPrefs {
  const out = { ...PREF_DEFAULTS }
  try {
    for (const k of Object.keys(out) as (keyof BookingPrefs)[]) {
      const v = localStorage.getItem(`${key}:${k}`)
      if (v != null) out[k] = JSON.parse(v) === true
    }
    for (const k of LEGACY_KEYS) localStorage.removeItem(`${key}:${k}`)
  } catch { /* privater Modus / gesperrter Speicher: Standard */ }
  return out
}

export function savePref(key: string, name: keyof BookingPrefs, value: boolean) {
  try { localStorage.setItem(`${key}:${name}`, JSON.stringify(value)) } catch { /* Speicher voll / privater Modus */ }
}
