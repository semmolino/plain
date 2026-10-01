import { describe, it, expect, beforeEach } from 'vitest'
import type { TecEntry } from '@/api/rechnungen'
import {
  filterBookings, billable, initialSelection, withZeros, triState, toggleRows, summarize,
  outsidePeriod, idsOf, loadPrefs, savePref, sortBookings, sortKeyOr, PREFS_KEY, type BookingFilters,
} from './buchungsauswahl'

function b(ID: number, date: string, amount: number, over: Partial<TecEntry> = {}): TecEntry {
  return {
    ID, BOOKING_DATE: date, EMPLOYEE_SHORT_NAME: 'SM', POSTING_DESCRIPTION: `Buchung ${ID}`,
    HOURLY_RATE_TOTAL: amount, HOURS: amount ? amount / 100 : 1, STRUCTURE_ID: 1, STRUCTURE_LABEL: 'LP2 – Vorplanung',
    ASSIGNED: false, ...over,
  }
}

const list = [
  b(1, '2026-08-20', 100),
  b(2, '2026-09-10', 0),
  b(3, '2026-10-02', 250, { EMPLOYEE_SHORT_NAME: 'AB', STRUCTURE_LABEL: 'LP3 – Entwurf' }),
  b(4, '2026-10-03', 0, { HOURS: null }),
]

const none: BookingFilters = {
  search: '', dateFrom: '', dateTo: '', employees: new Set(), structures: new Set(),
  hideZero: false, since: null, period: null,
}
const ids = (rows: TecEntry[]) => rows.map(t => t.ID)

describe('filterBookings', () => {
  it('ohne Filter alles', () => {
    expect(ids(filterBookings(list, none))).toEqual([1, 2, 3, 4])
  })
  it('„Seit letzter Rechnung" zeigt nur Buchungen nach dem Stichtag', () => {
    expect(ids(filterBookings(list, { ...none, since: '2026-09-10' }))).toEqual([3, 4])
  })
  it('„Im Leistungszeitraum" schließt beide Grenzen ein, eine offene Grenze gilt nicht', () => {
    expect(ids(filterBookings(list, { ...none, period: { start: '2026-09-10', end: '2026-10-02' } }))).toEqual([2, 3])
    expect(ids(filterBookings(list, { ...none, period: { start: '', end: '2026-09-10' } }))).toEqual([1, 2])
  })
  it('Leistung, Mitarbeiter, 0-Beträge und Suche (auch über die Leistung)', () => {
    expect(ids(filterBookings(list, { ...none, structures: new Set(['LP3 – Entwurf']) }))).toEqual([3])
    expect(ids(filterBookings(list, { ...none, employees: new Set(['SM']) }))).toEqual([1, 2, 4])
    expect(ids(filterBookings(list, { ...none, hideZero: true }))).toEqual([1, 3])
    expect(ids(filterBookings(list, { ...none, search: 'entwurf' }))).toEqual([3])
  })
  it('eine Buchung ohne Datum fällt bei jedem Datumsfilter heraus', () => {
    const ohne = [b(9, '', 50, { BOOKING_DATE: null })]
    expect(filterBookings(ohne, { ...none, since: '2026-01-01' })).toEqual([])
    expect(filterBookings(ohne, { ...none, dateTo: '2026-12-31' })).toEqual([])
  })
})

describe('Sammelaktionen mit „0-Beträge mitabrechnen"', () => {
  it('Alle wählt 0-Beträge nur, wenn sie mitabgerechnet werden', () => {
    expect(ids(billable(list, true))).toEqual([1, 2, 3, 4])
    expect(ids(billable(list, false))).toEqual([1, 3])
  })

  it('Vorauswahl: Zuordnung des Entwurfs, sonst alles Abrechenbare', () => {
    expect([...initialSelection(list, false)]).toEqual([1, 3])
    const fortgesetzt = list.map(t => ({ ...t, ASSIGNED: t.ID === 2 }))
    expect([...initialSelection(fortgesetzt, false)]).toEqual([2])
  })

  it('0-Beträge in einem Rutsch an und ab — der Rest bleibt', () => {
    expect([...withZeros(new Set([1]), list, true)].sort()).toEqual([1, 2, 4])
    expect([...withZeros(new Set([1, 2, 3, 4]), list, false)].sort()).toEqual([1, 3])
  })

  it('Häkchen gilt als voll, wenn alles Abrechenbare gewählt ist', () => {
    expect(triState(list, new Set([1, 3]), false)).toBe('all')
    expect(triState(list, new Set([1, 3]), true)).toBe('some')
    expect(triState(list, new Set(), true)).toBe('none')
  })

  it('Kopf-Häkchen: ergänzt die sichtbaren, ohne Ausgeblendetes anzufassen', () => {
    const sichtbar = list.filter(t => t.ID >= 3)
    expect([...toggleRows(new Set([1]), sichtbar, false)].sort()).toEqual([1, 3])
    expect([...toggleRows(new Set([1, 3]), sichtbar, false)]).toEqual([1])
  })

  it('Kopf-Häkchen nimmt auch einzeln angehakte 0-Beträge heraus', () => {
    const nurNull = list.filter(t => t.ID === 2 || t.ID === 4)
    expect([...toggleRows(new Set([2]), nurNull, false)]).toEqual([])
  })

  it('Nur sichtbare: genau die sichtbaren Abrechenbaren', () => {
    const sichtbar = filterBookings(list, { ...none, since: '2026-09-10' })
    expect([...idsOf(billable(sichtbar, false))]).toEqual([3])
  })
})

describe('sortBookings', () => {
  it('Beträge als Zahl, nicht als Text; Gleichstand nach Datum', () => {
    const rows = [b(1, '2026-09-02', 90), b(2, '2026-09-01', 1000), b(3, '2026-08-01', 90)]
    expect(ids(sortBookings(rows, 'HOURLY_RATE_TOTAL', 'asc'))).toEqual([3, 1, 2])
    expect(ids(sortBookings(rows, 'HOURLY_RATE_TOTAL', 'desc'))).toEqual([2, 3, 1])
  })
  it('Buchungen ohne Stunden (Pauschalen) stehen in beiden Richtungen unten', () => {
    // Stunden: 1 → 1 h, 2 → 1 h, 3 → 2,5 h, 4 → keine
    expect(ids(sortBookings(list, 'HOURS', 'asc'))).toEqual([1, 2, 3, 4])
    expect(ids(sortBookings(list, 'HOURS', 'desc'))).toEqual([3, 1, 2, 4])
  })
  it('Text nach deutscher Sortierung, ohne die Liste zu verändern', () => {
    const before = ids(list)
    expect(ids(sortBookings(list, 'EMPLOYEE_SHORT_NAME', 'asc'))[0]).toBe(3) // AB vor SM
    expect(ids(list)).toEqual(before)
  })
  it('unbekannter gespeicherter Schlüssel fällt aufs Datum zurück', () => {
    expect(sortKeyOr('ID')).toBe('BOOKING_DATE')
    expect(sortKeyOr('HOURS')).toBe('HOURS')
  })
})

describe('summarize / outsidePeriod', () => {
  it('zählt Betrag, Stunden und was ausgeblendet ist', () => {
    const s = summarize(list, new Set([1, 3, 4]), new Set([3, 4]))
    expect(s).toEqual({ count: 3, amount: 350, hours: 3.5, hidden: 1 })
  })
  it('Buchungen außerhalb des Leistungszeitraums', () => {
    expect(ids(outsidePeriod(list, new Set([1, 2, 3]), { start: '2026-09-01', end: '2026-09-30' }))).toEqual([1, 3])
    expect(outsidePeriod(list, new Set([1]), null)).toEqual([])
  })
})

describe('Vorlieben', () => {
  // Die Unit-Tests laufen in Node — dort gibt es keinen localStorage.
  beforeEach(() => {
    const store = new Map<string, string>()
    globalThis.localStorage = {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => { store.set(k, String(v)) },
      removeItem: k => { store.delete(k) },
      clear: () => store.clear(),
      key: i => [...store.keys()][i] ?? null,
      get length() { return store.size },
    } as Storage
  })

  it('Standard: 0-Beträge mitabrechnen, nichts ausblenden', () => {
    expect(loadPrefs()).toEqual({ hideZero: false, includeZero: true, sinceLast: false })
  })
  it('merkt sich Vorlieben und räumt alte Filter weg', () => {
    savePref(PREFS_KEY, 'includeZero', false)
    savePref(PREFS_KEY, 'sinceLast', true)
    localStorage.setItem(`${PREFS_KEY}:dateFrom`, JSON.stringify('2026-01-01'))
    expect(loadPrefs()).toEqual({ hideZero: false, includeZero: false, sinceLast: true })
    expect(localStorage.getItem(`${PREFS_KEY}:dateFrom`)).toBeNull()
  })
})
