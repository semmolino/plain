import { describe, it, expect } from 'vitest'
import { computeSurchargeEffects, computeBlItemAmount, phaseRevenue } from './kalkCalc'
import type { FeePhaseRow, FeeCalcSurcharge, FeeCalcBl } from '@/api/fee'

// Hält das Verhalten fest, das Tabelle (Desktop) und Blatt (Handy) teilen.
const phase = (ID: number, rev: number) => ({ ID, PHASE_REVENUE: rev }) as FeePhaseRow
const sur = (p: Partial<FeeCalcSurcharge>) => ({
  FEE_CALC_MASTER_ID: 1, FEE_SURCHARGE_ID: null, ABBR: 'Z', NAME: '', PERCENT: 10, BASE_AMOUNT: null, AMOUNT: null,
  SORT_ORDER: 0, LPH_FILTER: null, CALC_MODE: 'parallel', INCLUDE_BL: false, BL_FILTER: null, ...p,
}) as FeeCalcSurcharge
const bl = (p: Partial<FeeCalcBl>) => ({
  FEE_CALC_MASTER_ID: 1, ABBR: null, NAME: 'BL', LPH_REF: null, LPH_PHASE_ID: null,
  AMOUNT_TYPE: 'fixed', PERCENT: null, KX_REF: null, AMOUNT: 0, SORT_ORDER: 0, ...p,
}) as FeeCalcBl

describe('kalkCalc', () => {
  const phases = [phase(1, 1000), phase(2, 3000)]

  it('Phasenhonorar: Prozent auf Basis, auf Cent gerundet', () => {
    expect(phaseRevenue(262_418.4, 30)).toBe(78_725.52)
    expect(phaseRevenue(null, 30)).toBeNull()
  })

  it('Zuschlag nur auf gewählte Phasen, kumulativ auf die Zuschläge davor', () => {
    const e = computeSurchargeEffects(phases, [
      sur({ PERCENT: 10 }),
      sur({ PERCENT: 10, LPH_FILTER: JSON.stringify([2]), CALC_MODE: 'cumulative' }),
    ])
    expect(e[0]).toEqual({ effectiveBase: 4000, amount: 400 })
    // 3000 (nur Phase 2) + 400 (voller Zuschlag davor)
    expect(e[1]).toEqual({ effectiveBase: 3400, amount: 340 })
  })

  it('Zuschlag mit Besonderen Leistungen in der Basis', () => {
    const items = [bl({ ID: 9, AMOUNT: 500 })]
    const e = computeSurchargeEffects(phases, [sur({ PERCENT: 10, BL_FILTER: JSON.stringify([9]) })], items, [500])
    expect(e[0].effectiveBase).toBe(4500)
  })

  it('Besondere Leistung: Pauschal, % auf Phase, % auf Grundhonorar', () => {
    expect(computeBlItemAmount(bl({ AMOUNT: 1200 }), phases, null, 4000, 0)).toBe(1200)
    expect(computeBlItemAmount(bl({ AMOUNT_TYPE: 'pct_lph', PERCENT: 5, LPH_PHASE_ID: 2 }), phases, null, 4000, 0)).toBe(150)
    expect(computeBlItemAmount(bl({ AMOUNT_TYPE: 'pct_grundhonorar', PERCENT: 2 }), phases, null, 4000, 0)).toBe(80)
  })
})
