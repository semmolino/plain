import { describe, it, expect } from 'vitest'
import { compareRows } from './sortRows'

type Row = { name: string | null; amount: number | null; date: string | null }
const r = (name: string | null, amount: number | null, date: string | null = null): Row => ({ name, amount, date })

const sortBy = (rows: Row[], key: keyof Row, dir: 'asc' | 'desc') =>
  [...rows].sort((a, b) => compareRows(a, b, key, dir, ['amount']))

describe('compareRows — Zahlenspalten', () => {
  it('sortiert numerisch, nicht als Text', () => {
    const rows = [r('a', 9000), r('b', 10000), r('c', 900)]
    expect(sortBy(rows, 'amount', 'asc').map(x => x.amount)).toEqual([900, 9000, 10000])
  })

  it('unterscheidet Nachkommastellen korrekt', () => {
    const rows = [r('a', 1000.5), r('b', 1000.25)]
    expect(sortBy(rows, 'amount', 'asc').map(x => x.amount)).toEqual([1000.25, 1000.5])
  })

  it('haelt Leerwerte in BEIDEN Richtungen am Ende', () => {
    const rows = [r('a', null), r('b', 5), r('c', 1)]
    expect(sortBy(rows, 'amount', 'asc').map(x => x.amount)).toEqual([1, 5, null])
    expect(sortBy(rows, 'amount', 'desc').map(x => x.amount)).toEqual([5, 1, null])
  })

  it('behandelt 0 als echten Wert, nicht als leer', () => {
    const rows = [r('a', null), r('b', 0), r('c', 3)]
    expect(sortBy(rows, 'amount', 'asc').map(x => x.amount)).toEqual([0, 3, null])
  })
})

describe('compareRows — Textspalten', () => {
  it('sortiert nach deutschem Alphabet, ohne Gross-/Kleinschreibung zu werten', () => {
    const rows = [r('Ökotec', 0), r('Adler', 0), r('bauer', 0)]
    expect(sortBy(rows, 'name', 'asc').map(x => x.name)).toEqual(['Adler', 'bauer', 'Ökotec'])
  })

  it('sortiert eingebettete Nummern natuerlich (A-2 vor A-10)', () => {
    const rows = [r('A-10', 0), r('A-2', 0)]
    expect(sortBy(rows, 'name', 'asc').map(x => x.name)).toEqual(['A-2', 'A-10'])
  })

  it('haelt Leerwerte in beiden Richtungen am Ende', () => {
    const rows = [r(null, 0), r('B', 0), r('A', 0)]
    expect(sortBy(rows, 'name', 'asc').map(x => x.name)).toEqual(['A', 'B', null])
    expect(sortBy(rows, 'name', 'desc').map(x => x.name)).toEqual(['B', 'A', null])
  })
})

describe('compareRows — ISO-Datumsspalten', () => {
  it('sortiert ISO-Daten korrekt als Text', () => {
    const rows = [r('a', 0, '2026-01-09'), r('b', 0, '2025-12-31'), r('c', 0, '2026-01-10')]
    expect(sortBy(rows, 'date', 'asc').map(x => x.date)).toEqual(['2025-12-31', '2026-01-09', '2026-01-10'])
  })

  it('haelt Anträge ohne Datum am Ende', () => {
    const rows = [r('a', 0, null), r('b', 0, '2026-01-09')]
    expect(sortBy(rows, 'date', 'asc').map(x => x.date)).toEqual(['2026-01-09', null])
  })
})
