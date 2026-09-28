import { describe, it, expect } from 'vitest'
import { parsePct, pctInput, buildRows, rowState, summarize, deDate, monthLabel } from './leistungsstandCalc'
import type { LeistungsstandNode } from '@/api/projekte'

const node = (o: Partial<LeistungsstandNode> & { STRUCTURE_ID: number }): LeistungsstandNode => ({
  ABBR: `E${o.STRUCTURE_ID}`, NAME: '', FATHER_ID: null, BILLING_TYPE_ID: 1, REVENUE: 0, EXTRAS: 0,
  REVENUE_COMPLETION_PERCENT: 0, IS_LEAF: true, PREV_REVENUE_COMPLETION_PERCENT: null,
  PREV_EXTRAS_COMPLETION_PERCENT: null, PREV_AT: null, ...o,
} as unknown as LeistungsstandNode)

describe('parsePct', () => {
  it('liest Komma, Punkt und Prozentzeichen', () => {
    expect(parsePct('45')).toEqual({ ok: true, value: 45 })
    expect(parsePct('45,5')).toEqual({ ok: true, value: 45.5 })
    expect(parsePct(' 45.25 % ')).toEqual({ ok: true, value: 45.25 })
    expect(parsePct('0')).toEqual({ ok: true, value: 0 })
  })
  it('weist Leeres, Unlesbares und ausserhalb 0–100 ab', () => {
    expect(parsePct('')).toMatchObject({ ok: false })
    expect(parsePct('abc')).toMatchObject({ ok: false })
    expect(parsePct('101')).toMatchObject({ ok: false, error: 'Nur 0 bis 100 %' })
    expect(parsePct('-1')).toMatchObject({ ok: false })
  })
  it('pctInput formatiert fuer das Eingabefeld', () => {
    expect(pctInput(45.5)).toBe('45,5')
    expect(pctInput(100)).toBe('100')
    expect(pctInput(null)).toBe('')
  })
})

describe('buildRows / rowState', () => {
  const nodes = [
    node({ STRUCTURE_ID: 1, IS_LEAF: false, ABBR: 'LP' }),
    node({ STRUCTURE_ID: 2, FATHER_ID: 1, REVENUE: 10_000, EXTRAS: 500, REVENUE_COMPLETION_PERCENT: 40, ADVANCE_INVOICED: 3_000, PREV_AS_OF: '2026-08-31' }),
    node({ STRUCTURE_ID: 3, FATHER_ID: 1, BILLING_TYPE_ID: 2, REVENUE: 2_000 }),
    node({ STRUCTURE_ID: 4, FATHER_ID: 1, REVENUE: 5_000, REVENUE_COMPLETION_PERCENT: 10, PREV_AS_OF: '2026-10-02' }),
  ]

  it('markiert eingebbare, Nachweis- und gesperrte Elemente', () => {
    const rows = buildRows(nodes, '2026-09-30')
    expect(rows.map(r => [r.node.STRUCTURE_ID, r.depth, r.editable, r.nachweis, r.lockedAfter])).toEqual([
      [1, 0, false, false, null],
      [2, 1, true, false, null],
      [3, 1, false, true, null],
      [4, 1, true, false, '2026-10-02'],
    ])
    expect(rows[1].fee).toBe(10_500)
    expect(rows[1].billed).toBe(3_000)
  })

  it('rechnet Δ € auf das Honorar inkl. Nebenkosten', () => {
    const r = buildRows(nodes, '2026-09-30')[1]
    expect(rowState(r, '60')).toMatchObject({ next: 60, changed: true, delta: 2_100, warnings: [] })
    expect(rowState(r, '40')).toMatchObject({ changed: false, delta: 0 })
    expect(rowState(r, undefined)).toMatchObject({ changed: false, next: 40 })
  })

  it('warnt bei Rückgang und unter dem schon Abgerechneten', () => {
    const r = buildRows(nodes, '2026-09-30')[1]
    const st = rowState(r, '20')
    expect(st.warnings.map(w => w.kind)).toEqual(['decrease', 'belowBilled'])
    // 28,57 % von 10.500 € = 3.000 € → noch keine Warnung (1 € Toleranz)
    expect(rowState(r, '28,57').warnings.map(w => w.kind)).toEqual(['decrease'])
  })

  it('Fehler im Feld zählt nicht als Änderung', () => {
    const r = buildRows(nodes, '2026-09-30')[1]
    expect(rowState(r, '120')).toMatchObject({ error: 'Nur 0 bis 100 %', changed: false })
  })

  it('summarize sammelt nur gültige Änderungen und überspringt gesperrte', () => {
    const rows = buildRows(nodes, '2026-09-30')
    const s = summarize(rows, { 2: '50', 4: '30' })
    expect(s).toMatchObject({ changed: 1, errors: 0, delta: 1_050 })
    expect(s.updates).toEqual([{ structure_id: 2, revenue_completion_percent: 50 }])
    expect(summarize(rows, { 2: 'x' })).toMatchObject({ changed: 0, errors: 1 })
  })
})

describe('Datum', () => {
  it('deDate und monthLabel', () => {
    expect(deDate('2026-09-30')).toBe('30.09.2026')
    expect(deDate('2026-09-30T10:00:00Z')).toBe('30.09.2026')
    expect(monthLabel('2026-09-30')).toBe('September 2026')
  })
})
