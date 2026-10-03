import { describe, expect, test } from 'vitest'
import type { LphFact, LphLeistungsbild, LphProject } from '@/api/reports'
import {
  activeFilterCount, aggregateLph, applyLphFilters, emptyLphFilters, hoursShareExceeds,
  lphColumns, lphFilterOptions, lphKpis,
} from './lphMatrixCalc'

const project = (id: number, extra: Partial<LphProject> = {}): LphProject => ({
  PROJECT_ID: id, ABBR: `P-${id}`, NAME: `Projekt ${id}`,
  STATUS: 'laufend', TYPE: null, DEPARTMENT: null, MANAGER: null, CLIENT: null, GROUP_NAME: null,
  ...extra,
})
const fact = (PROJECT_ID: number, LB: string, PHASE: string, h: number, e: number, hours: number, c: number, ZONE = 'III'): LphFact =>
  ({ PROJECT_ID, LB, ZONE, PHASE, HONORAR_NET: h, EARNED_VALUE_NET: e, HOURS_TOTAL: hours, COST_TOTAL: c })

const LB: LphLeistungsbild[] = [
  { key: 'Bebauungsplan', label: 'Bebauungsplan', phases: [
    { key: 'LPH 3', name: 'Plan zur Beschlussfassung', hoaiPercent: 10, sort: 3 },
  ] },
  { key: 'Gebäude', label: 'Gebäude', phases: [
    { key: 'LPH 2', name: 'Vorplanung', hoaiPercent: 7, sort: 2 },
    { key: 'LPH 3', name: 'Entwurfsplanung', hoaiPercent: 15, sort: 3 },
  ] },
  { key: 'Geotechnik', label: 'Geotechnik', phases: [
    { key: 'TL a', name: 'Grundlagenermittlung und Erkundungskonzept', hoaiPercent: 15, sort: 1001 },
  ] },
]

const PROJECTS = [
  project(1, { STATUS: 'abgeschlossen', MANAGER: 'AB' }),
  project(2, { STATUS: 'laufend', MANAGER: 'CD' }),
  project(3, { STATUS: 'laufend', MANAGER: 'AB', CLIENT: 'Stadt' }),
]
const FACTS = [
  fact(1, 'Gebäude', 'LPH 2', 10_000, 10_000, 100, 8_000),
  fact(1, 'Gebäude', 'LPH 3', 30_000, 30_000, 300, 36_000),
  fact(2, 'Gebäude', 'LPH 3', 20_000, 10_000, 100, 6_000, 'IV'),
  fact(2, 'Geotechnik', 'TL a', 5_000, 5_000, 20, 1_000, ''),
  fact(3, 'Bebauungsplan', 'LPH 3', 8_000, 4_000, 50, 2_000),
]

describe('lphKpis', () => {
  test('Quoten aus Summen, Prognosen mit Mindestgrößen', () => {
    const k = lphKpis({ HONORAR_NET: 20_000, EARNED_VALUE_NET: 10_000, HOURS_TOTAL: 100, COST_TOTAL: 6_000 })
    expect(k.LEISTUNGSSTAND_PERCENT).toBe(50)
    expect(k.KOSTENQUOTE).toBeCloseTo(0.6)
    expect(k.DB).toBe(4_000)
    // Honorar − Honorar / CPI = 20.000 − 20.000 × 0,6
    expect(k.DB_PROGNOSE).toBe(8_000)
    expect(k.LEISTUNG_JE_STUNDE).toBe(100)
    expect(k.KOSTEN_JE_STUNDE).toBe(60)
    // 100 h bei 50 % → noch 100 h
    expect(k.RESTSTUNDEN).toBe(100)
  })

  test('keine Hochrechnung unter 10 % Leistungsstand, fertige Phase hat 0 Reststunden', () => {
    expect(lphKpis({ HONORAR_NET: 10_000, EARNED_VALUE_NET: 500, HOURS_TOTAL: 40, COST_TOTAL: 3_000 }).RESTSTUNDEN).toBeNull()
    expect(lphKpis({ HONORAR_NET: 10_000, EARNED_VALUE_NET: 10_000, HOURS_TOTAL: 40, COST_TOTAL: 3_000 }).RESTSTUNDEN).toBe(0)
  })

  test('ohne Stunden kein Stundensatz, zu klein keine DB-Prognose', () => {
    const k = lphKpis({ HONORAR_NET: 300, EARNED_VALUE_NET: 300, HOURS_TOTAL: 0, COST_TOTAL: 0 })
    expect(k.LEISTUNG_JE_STUNDE).toBeNull()
    expect(k.DB_PROGNOSE).toBeNull()
    expect(k.KOSTENQUOTE).toBe(0)
  })
})

describe('Filter', () => {
  test('Auswahlwerte aus den Daten, leer zuletzt', () => {
    const o = lphFilterOptions(PROJECTS, FACTS)
    expect(o.lb).toEqual(['Bebauungsplan', 'Gebäude', 'Geotechnik'])
    expect(o.zone).toEqual(['III', 'IV', ''])
    expect(o.leitung).toEqual(['AB', 'CD'])
  })

  test('Leistungsbild filtert Phasen, nicht ganze Projekte', () => {
    const f = { ...emptyLphFilters(), lb: new Set(['Gebäude']) }
    const r = applyLphFilters(PROJECTS, FACTS, f)
    expect(r.projects.map(p => p.PROJECT_ID)).toEqual([1, 2])
    // Projekt 2 behält nur seine Gebäude-Phase, die Geotechnik fällt heraus
    expect(r.facts.filter(x => x.PROJECT_ID === 2).map(x => x.PHASE)).toEqual(['LPH 3'])
    expect(activeFilterCount(f)).toBe(1)
  })

  test('Projektmerkmale und Suche', () => {
    const f = { ...emptyLphFilters(), leitung: new Set(['AB']), status: new Set(['laufend']) }
    expect(applyLphFilters(PROJECTS, FACTS, f).projects.map(p => p.PROJECT_ID)).toEqual([3])
    expect(applyLphFilters(PROJECTS, FACTS, emptyLphFilters(), 'projekt 2').projects.map(p => p.PROJECT_ID)).toEqual([2])
  })

  test('leerer Wert ist wählbar („ohne")', () => {
    const f = { ...emptyLphFilters(), zone: new Set(['']) }
    expect(applyLphFilters(PROJECTS, FACTS, f).facts.map(x => x.PHASE)).toEqual(['TL a'])
  })
})

describe('Spalten', () => {
  test('LPH nach Nummer, Teilleistungen danach; gemischte Bedeutung im Tooltip', () => {
    const cols = lphColumns(FACTS, LB)
    expect(cols.map(c => c.key)).toEqual(['LPH 2', 'LPH 3', 'TL a'])
    const lph3 = cols.find(c => c.key === 'LPH 3')!
    expect(lph3.name).toBeNull()
    expect(lph3.title).toContain('Gebäude: Entwurfsplanung')
    expect(lph3.title).toContain('Bebauungsplan: Plan zur Beschlussfassung')
    expect(lph3.hoaiPercent).toBeNull()
  })

  test('Bedeutung nur aus Paaren der Auswahl', () => {
    // Der Bebauungsplan steht nur mit LPH 2 in der Auswahl, nicht mit LPH 3 —
    // die Spalte LPH 3 sagt dann nichts über den Bebauungsplan.
    const facts = [fact(1, 'Gebäude', 'LPH 3', 1, 1, 1, 1), fact(3, 'Bebauungsplan', 'LPH 2', 1, 1, 1, 1)]
    const lbs: LphLeistungsbild[] = [
      { ...LB[0], phases: [...LB[0].phases, { key: 'LPH 2', name: 'Entwurf zur öffentlichen Auslegung', hoaiPercent: 30, sort: 2 }] },
      LB[1],
    ]
    const lph3 = lphColumns(facts, lbs).find(c => c.key === 'LPH 3')!
    expect(lph3.name).toBe('Entwurfsplanung')
    expect(lph3.title).not.toContain('Bebauungsplan')
  })

  test('ein Leistungsbild: Name und HOAI-Gewichtung', () => {
    const cols = lphColumns(FACTS.filter(f => f.LB === 'Gebäude'), LB)
    expect(cols.map(c => [c.key, c.name, c.hoaiPercent])).toEqual([
      ['LPH 2', 'Vorplanung', 7],
      ['LPH 3', 'Entwurfsplanung', 15],
    ])
  })
})

describe('aggregateLph', () => {
  test('Zeilen, Phasen und Summen aus denselben Fakten', () => {
    const facts = FACTS.filter(f => f.LB === 'Gebäude')
    const cols = lphColumns(facts, LB)
    const v = aggregateLph(PROJECTS, facts, cols)
    expect(v.rows.map(r => r.project.PROJECT_ID)).toEqual([1, 2])
    expect(v.rows[0].total.HONORAR_NET).toBe(40_000)

    const lph3 = v.byPhase.find(p => p.key === 'LPH 3')!
    expect(lph3.PROJECT_COUNT).toBe(2)
    // Σ Kosten / Σ Leistung, nicht das Mittel der Projektquoten (1,2 und 0,6)
    expect(lph3.KOSTENQUOTE).toBeCloseTo(42_000 / 40_000)
    expect(lph3.HOURS_SHARE).toBe(80)        // 400 von 500 h
    expect(lph3.HONORAR_SHARE).toBe(83.33)   // 50.000 von 60.000 €
    expect(v.totals?.HONORAR_NET).toBe(60_000)
  })

  test('Stundenanteil deutlich über Honoraranteil fällt auf', () => {
    expect(hoursShareExceeds({ HOURS_SHARE: 30, HONORAR_SHARE: 25 })).toBe(true)
    expect(hoursShareExceeds({ HOURS_SHARE: 29, HONORAR_SHARE: 25 })).toBe(false)
    expect(hoursShareExceeds({ HOURS_SHARE: null, HONORAR_SHARE: 25 })).toBe(false)
  })

  test('nichts ausgewählt: keine Summe', () => {
    expect(aggregateLph(PROJECTS, [], []).totals).toBeNull()
  })
})
