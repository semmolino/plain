import { describe, it, expect } from 'vitest'
import {
  surchargeDefault, sameSurcharge, surchargeBody, computeSurcharges, rowChanges,
  aggregateStructure, rootTotals, type SurchargeEdit,
} from './strukturCalc'
import type { StructureNode } from '@/api/projekte'

/**
 * Charakterisierung: haelt fest, was die Projektstruktur HEUTE rechnet —
 * geschrieben vor dem Umbau der Tabelle, damit der Umbau nichts verschiebt.
 * Werte bewusst mit krummen Betraegen, Nachweis-Blaettern (BT=2) und
 * Zuschlaegen auf Vater-Ebene.
 */

const n = (o: Partial<StructureNode> & { STRUCTURE_ID: number }): StructureNode => ({
  ABBR: `E${o.STRUCTURE_ID}`, NAME: '', FATHER_ID: null, BILLING_TYPE_ID: 1,
  REVENUE: 0, EXTRAS: 0, EXTRAS_PERCENT: 0, SURCHARGES_TOTAL: 0, ...o,
} as unknown as StructureNode)

const noSur: SurchargeEdit = {
  s1Label: '', s1Pct: '', s1Cumul: true, s2Label: '', s2Pct: '', s2Cumul: true, s3Label: '', s3Pct: '', s3Cumul: true,
}

describe('Zuschläge', () => {
  it('surchargeDefault liest die Felder, Kumulation standardmäßig an', () => {
    expect(surchargeDefault(null)).toEqual(noSur)
    expect(surchargeDefault({ SURCHARGE_1_LABEL: 'Umbau', SURCHARGE_1_PCT: 20, SURCHARGE_2_CUMUL: false })).toMatchObject({
      s1Label: 'Umbau', s1Pct: '20', s1Cumul: true, s2Cumul: false,
    })
  })

  it('computeSurcharges: kumuliert auf die Zwischensumme, sonst auf die Basis', () => {
    const s = { ...noSur, s1Label: 'Umbau', s1Pct: '20', s2Label: 'Nachlass', s2Pct: '-3', s3Label: 'Eil', s3Pct: '10', s3Cumul: false }
    // 1000 → +200 → 1200 × -3 % = -36 → 1164; Eil nicht kumuliert: 1000 × 10 % = 100
    expect(computeSurcharges(1000, s)).toEqual({ s1Eur: 200, s2Eur: -36, s3Eur: 100, total: 264 })
  })

  it('computeSurcharges: ohne Bezeichnung oder mit 0 % kein Zuschlag, Rundung auf Cent', () => {
    expect(computeSurcharges(1000, { ...noSur, s1Pct: '20' }).total).toBe(0)
    expect(computeSurcharges(1000, { ...noSur, s1Label: 'X', s1Pct: '0' }).total).toBe(0)
    expect(computeSurcharges(333.33, { ...noSur, s1Label: 'X', s1Pct: '7' }).s1Eur).toBe(23.33)
  })

  it('sameSurcharge vergleicht Prozent als Zahl', () => {
    expect(sameSurcharge({ ...noSur, s1Label: 'A', s1Pct: '5' }, { ...noSur, s1Label: 'A', s1Pct: '5.0' })).toBe(true)
    expect(sameSurcharge({ ...noSur, s1Label: 'A', s1Pct: '' }, { ...noSur, s1Label: 'A', s1Pct: '0' })).toBe(true)
    expect(sameSurcharge({ ...noSur, s1Cumul: false }, noSur)).toBe(false)
  })

  it('surchargeBody: leere Felder werden null', () => {
    expect(surchargeBody({ ...noSur, s1Label: 'A', s1Pct: '5' })).toMatchObject({
      SURCHARGE_1_LABEL: 'A', SURCHARGE_1_PCT: 5, SURCHARGE_2_LABEL: null, SURCHARGE_2_PCT: null, SURCHARGE_3_CUMUL: true,
    })
  })
})

describe('rowChanges', () => {
  const node = n({ STRUCTURE_ID: 1, ABBR: 'LP2', NAME: 'Vorplanung', REVENUE: 1200, REVENUE_BASIS: 1000, EXTRAS_PERCENT: 5, IS_INTERNAL: false,
    SURCHARGE_1_LABEL: 'Umbau', SURCHARGE_1_PCT: 20 } as Partial<StructureNode> & { STRUCTURE_ID: number })

  it('leer ohne Bearbeitung und bei Rücksetzen auf den alten Wert', () => {
    expect(rowChanges(node, undefined)).toEqual({})
    expect(rowChanges(node, { nameShort: 'LP2', budget: '1000', nk: '5', internal: false })).toEqual({})
  })

  it('Honorar wird gegen die Basis vor Zuschlägen verglichen, nicht gegen REVENUE', () => {
    expect(rowChanges(node, { budget: '1200' })).toEqual({ REVENUE: 1200 })
    expect(rowChanges(node, { budget: '1000' })).toEqual({})
  })

  it('leeres Honorar- oder NK-Feld ist keine Änderung', () => {
    expect(rowChanges(node, { budget: '', nk: '' })).toEqual({})
  })

  it('sammelt alle geänderten Felder', () => {
    expect(rowChanges(node, { nameShort: 'LP2a', nameLong: 'Vorentwurf', billingTypeId: '2', nk: '7', internal: true })).toEqual({
      ABBR: 'LP2a', NAME: 'Vorentwurf', BILLING_TYPE_ID: 2, EXTRAS_PERCENT: 7, IS_INTERNAL: true,
    })
  })

  it('Zuschläge nur, wenn sie sich wirklich unterscheiden', () => {
    const same = surchargeDefault(node)
    expect(rowChanges(node, { surcharge: same })).toEqual({})
    expect(rowChanges(node, { surcharge: { ...same, s1Pct: '25' } })).toMatchObject({ SURCHARGE_1_PCT: 25, SURCHARGE_1_LABEL: 'Umbau' })
  })
})

describe('aggregateStructure / rootTotals', () => {
  //  LPH (Vater, eigener Zuschlag 50 €, NK 5 %)
  //   ├ LP1  Basis 1000, REVENUE 1000, NK 50
  //   └ LP5  (Vater)
  //       ├ LP5.1 Basis 2000, Zuschlag 400 → REVENUE 2400, NK 120
  //       └ NA    Nachweis, Buchungen 777,77 → REVENUE 777,77
  //  BL (Blatt ohne Vater) Basis 300
  const s = [
    n({ STRUCTURE_ID: 1, ABBR: 'LPH', EXTRAS_PERCENT: 5, SURCHARGES_TOTAL: 50, REVENUE: 4227.77 }),
    n({ STRUCTURE_ID: 2, FATHER_ID: 1, REVENUE: 1000, REVENUE_BASIS: 1000, EXTRAS: 50, EXTRAS_PERCENT: 5 } as Partial<StructureNode> & { STRUCTURE_ID: number }),
    n({ STRUCTURE_ID: 3, FATHER_ID: 1, REVENUE: 3177.77 }),
    n({ STRUCTURE_ID: 4, FATHER_ID: 3, REVENUE: 2400, REVENUE_BASIS: 2000, EXTRAS: 120, EXTRAS_PERCENT: 5, SURCHARGES_TOTAL: 400 } as Partial<StructureNode> & { STRUCTURE_ID: number }),
    n({ STRUCTURE_ID: 5, FATHER_ID: 3, BILLING_TYPE_ID: 2, REVENUE: 777.77, REVENUE_BASIS: 999, TEC_SP_TOT_SUM: 777.77 } as Partial<StructureNode> & { STRUCTURE_ID: number }),
    n({ STRUCTURE_ID: 6, REVENUE: 300, REVENUE_BASIS: 300 } as Partial<StructureNode> & { STRUCTURE_ID: number }),
  ]
  const agg = aggregateStructure(s)

  it('Blatt: Nachweis nimmt die Buchungssumme als Basis, nicht REVENUE_BASIS', () => {
    expect(agg.get('5')).toEqual({ extras: 0, surcharges: 0, revenueBasis: 777.77 })
    expect(agg.get('4')).toEqual({ extras: 120, surcharges: 400, revenueBasis: 2000 })
  })

  it('Vater: summiert Kinder, eigene Zuschläge zählen mit und tragen eigene NK', () => {
    expect(agg.get('3')).toEqual({ extras: 120, surcharges: 400, revenueBasis: 2777.77 })
    // 50 + 120 + 50 € × 5 % = 172,50
    expect(agg.get('1')).toEqual({ extras: 172.5, surcharges: 450, revenueBasis: 3777.77 })
  })

  it('Projektzeile: Basis, Zuschläge inkl. Projektzuschlag, Gesamt', () => {
    const t = rootTotals(s, agg, 100)
    expect(t.rootRevenue).toBeCloseTo(4077.77, 2)          // 3777,77 + 300
    expect(t.rootSurcharges).toBe(550)                     // 450 + 0 + 100
    expect(t.rootStructureRevenueSum).toBeCloseTo(4527.77, 2)
    expect(t.rootRevenueFinal).toBeCloseTo(4627.77, 2)
    expect(t.rootExtras).toBe(172.5)
    expect(t.rootGesamt).toBeCloseTo(4800.27, 2)
  })
})
