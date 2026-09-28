import { describe, it, expect } from 'vitest'
import type { OfferStructureNode } from '@/api/angebote'
import {
  aggregateOffer, offerRootTotals, offerLeafBasis, offerLeafFee, offerRowChanges, hoursRate,
} from './offerStrukturCalc'

/**
 * Charakterisierung: Die Summen der Angebotsstruktur standen bis Runde 2 als
 * eigene Kopie in AngeboteStruktur.tsx. `legacy` unten ist diese Kopie,
 * unveraendert aus dem Stand vor dem Umbau (main) uebernommen — die neue,
 * mit der Projektstruktur geteilte Rechnung muss fuer jede Testlage dasselbe
 * liefern. Danach feste Werte, damit die Regel auch ohne die Kopie lesbar ist.
 */

const n = (o: Partial<OfferStructureNode> & { ID: number }): OfferStructureNode => ({
  ABBR: `E${o.ID}`, NAME: '', OFFER_ID: 1, FATHER_ID: null, BILLING_TYPE_ID: 1, SORT_ORDER: 0,
  REVENUE_BASIS: null, REVENUE: 0, EXTRAS: 0, EXTRAS_PERCENT: 0, SURCHARGES_TOTAL: 0,
  QUANTITY: null, HOURLY_RATE: null, ROLE_ABBR: null, ROLE_NAME: null, ROLE_ID: null, TENANT_ID: 1,
  SURCHARGE_1_LABEL: null, SURCHARGE_1_PCT: null, SURCHARGE_1_EUR: null, SURCHARGE_1_CUMUL: true,
  SURCHARGE_2_LABEL: null, SURCHARGE_2_PCT: null, SURCHARGE_2_EUR: null, SURCHARGE_2_CUMUL: true,
  SURCHARGE_3_LABEL: null, SURCHARGE_3_PCT: null, SURCHARGE_3_EUR: null, SURCHARGE_3_CUMUL: true,
  ...o,
})

// ── Stand vor Runde 3 (AngeboteStruktur.tsx, main) ──────────────────────────
function legacy(structure: OfferStructureNode[], offerSurcharges: number) {
  const childrenOf = new Map<string, string[]>()
  for (const n of structure) {
    if (n.FATHER_ID != null) {
      const fid = String(n.FATHER_ID)
      const arr = childrenOf.get(fid) ?? []
      arr.push(String(n.ID))
      childrenOf.set(fid, arr)
    }
  }
  const nodeMap = new Map(structure.map(n => [String(n.ID), n]))
  const cache = new Map<string, { surcharges: number; revenueBasis: number; extras: number }>()
  function agg(id: string): { surcharges: number; revenueBasis: number; extras: number } {
    if (cache.has(id)) return cache.get(id)!
    const children = childrenOf.get(id) ?? []
    if (children.length === 0) {
      const node = nodeMap.get(id)!
      const rb = node?.REVENUE_BASIS != null
        ? Number(node.REVENUE_BASIS)
        : Math.max(0, Number(node?.REVENUE ?? 0) - Number(node?.SURCHARGES_TOTAL ?? 0))
      const r = { surcharges: Number(node?.SURCHARGES_TOTAL ?? 0), revenueBasis: rb, extras: Number(node?.EXTRAS ?? 0) }
      cache.set(id, r); return r
    }
    let surcharges = 0, revenueBasis = 0, extras = 0
    for (const cid of children) { const c = agg(cid); surcharges += c.surcharges; revenueBasis += c.revenueBasis; extras += c.extras }
    const ownNode       = nodeMap.get(id)
    const ownSurcharges = Number(ownNode?.SURCHARGES_TOTAL ?? 0)
    const ownNk         = Number(ownNode?.EXTRAS_PERCENT ?? 0)
    surcharges += ownSurcharges
    extras = Math.round((extras + ownSurcharges * ownNk / 100) * 100) / 100
    cache.set(id, { surcharges, revenueBasis, extras }); return { surcharges, revenueBasis, extras }
  }
  for (const n of structure) agg(String(n.ID))
  const parentIds = new Set(structure.filter(n => n.FATHER_ID != null).map(n => String(n.FATHER_ID)))
  const rootRevenueBasis = structure.filter(n => n.FATHER_ID == null).reduce((s, n) => {
    const isP = parentIds.has(String(n.ID))
    return s + (isP ? (cache.get(String(n.ID))?.revenueBasis ?? 0) : (n.REVENUE_BASIS != null ? Number(n.REVENUE_BASIS) : Number(n.REVENUE ?? 0)))
  }, 0)
  const structureSurcharges = structure.reduce((s, n) => s + Number(n.SURCHARGES_TOTAL ?? 0), 0)
  const rootStructureRevenueSum = structure.filter(n => n.FATHER_ID == null).reduce((s, n) => s + Number(n.REVENUE ?? 0), 0)
  const rootExtras = structure.filter(n => n.FATHER_ID == null).reduce((s, n) => {
    const isP = parentIds.has(String(n.ID))
    return s + (isP ? (cache.get(String(n.ID))?.extras ?? 0) : Number(n.EXTRAS ?? 0))
  }, 0)
  return {
    aggMap: cache,
    rootRevenue: rootRevenueBasis,
    rootSurcharges: structureSurcharges + offerSurcharges,
    rootStructureRevenueSum,
    rootRevenueFinal: rootStructureRevenueSum + offerSurcharges,
    rootExtras,
  }
}

// Honorarangebot mit HOAI-Phasen (Pauschal), einem Vater mit eigenem
// Zuschlag und einem Aufwand-Block (Stunden × Satz).
const typical: OfferStructureNode[] = [
  n({ ID: 10, ABBR: 'LP',  FATHER_ID: null, REVENUE_BASIS: 30000, REVENUE: 33600, EXTRAS_PERCENT: 5, EXTRAS: 1680,
      SURCHARGES_TOTAL: 3000, SURCHARGE_1_LABEL: 'Umbau', SURCHARGE_1_PCT: 10 }),
  n({ ID: 11, ABBR: 'LP2', FATHER_ID: 10, REVENUE_BASIS: 10000, REVENUE: 10000, EXTRAS_PERCENT: 5, EXTRAS: 500 }),
  n({ ID: 12, ABBR: 'LP3', FATHER_ID: 10, REVENUE_BASIS: 20000, REVENUE: 20600, EXTRAS_PERCENT: 5, EXTRAS: 1030,
      SURCHARGES_TOTAL: 600, SURCHARGE_1_LABEL: 'Eil', SURCHARGE_1_PCT: 3 }),
  n({ ID: 20, ABBR: 'BL',  FATHER_ID: null, BILLING_TYPE_ID: 2, REVENUE_BASIS: 1900, REVENUE: 1900, EXTRAS_PERCENT: 0, EXTRAS: 0 }),
  n({ ID: 21, ABBR: 'BL1', FATHER_ID: 20, BILLING_TYPE_ID: 2, QUANTITY: 12, HOURLY_RATE: 95, REVENUE_BASIS: 1140, REVENUE: 1140, ROLE_ABBR: 'PL' }),
  n({ ID: 22, ABBR: 'BL2', FATHER_ID: 20, BILLING_TYPE_ID: 2, QUANTITY: 10, HOURLY_RATE: 76, REVENUE_BASIS: 760,  REVENUE: 760 }),
  n({ ID: 30, ABBR: 'X',   FATHER_ID: null, REVENUE_BASIS: null, REVENUE: 1234.56, EXTRAS_PERCENT: 7, EXTRAS: 86.42 }),
]

// Altbestand: REVENUE_BASIS fehlt, REVENUE traegt schon die Zuschlaege.
const legacyRows: OfferStructureNode[] = [
  n({ ID: 1, FATHER_ID: null, REVENUE: 1100, SURCHARGES_TOTAL: 100, EXTRAS: 55, EXTRAS_PERCENT: 5 }),
  n({ ID: 2, FATHER_ID: null, REVENUE: 50,   SURCHARGES_TOTAL: 80 }),       // Basis kann nicht negativ werden
  n({ ID: 3, FATHER_ID: 1,    REVENUE: 400,  SURCHARGES_TOTAL: 0, EXTRAS: 20 }),
]

describe('Angebotsstruktur: Summen wie vor dem Umbau', () => {
  for (const [label, rows, offerSur] of [
    ['typisches Angebot', typical, 0],
    ['mit Angebotszuschlag', typical, 1717.28],
    ['Altbestand ohne REVENUE_BASIS', legacyRows, 0],
    ['leer', [], 0],
  ] as const) {
    it(label, () => {
      const old = legacy([...rows], offerSur)
      const agg = aggregateOffer([...rows])
      for (const [id, v] of old.aggMap) expect(agg.get(id), `Element ${id}`).toEqual(v)
      const t = offerRootTotals([...rows], agg, offerSur)
      expect(t.rootRevenue).toBeCloseTo(old.rootRevenue, 6)
      expect(t.rootSurcharges).toBeCloseTo(old.rootSurcharges, 6)
      expect(t.rootStructureRevenueSum).toBeCloseTo(old.rootStructureRevenueSum, 6)
      expect(t.rootRevenueFinal).toBeCloseTo(old.rootRevenueFinal, 6)
      expect(t.rootExtras).toBeCloseTo(old.rootExtras, 6)
    })
  }
})

describe('Angebotsstruktur: feste Werte', () => {
  const agg = aggregateOffer(typical)

  it('Vater: Basis = Summe der Kinder, eigene Zuschläge obendrauf, NK auch auf sie', () => {
    // 1030 + 500 + 3000 × 5 % = 1680
    expect(agg.get('10')).toEqual({ revenueBasis: 30000, surcharges: 3600, extras: 1680 })
  })

  it('Aufwand-Block: Basis = Summe Stunden × Satz der Blätter', () => {
    expect(agg.get('20')).toEqual({ revenueBasis: 1900, surcharges: 0, extras: 0 })
  })

  it('Gesamtzeile', () => {
    const t = offerRootTotals(typical, agg, 500)
    expect(t.rootRevenue).toBeCloseTo(30000 + 1900 + 1234.56, 6)
    expect(t.rootSurcharges).toBe(4100)
    expect(t.rootRevenueFinal).toBeCloseTo(33600 + 1900 + 1234.56 + 500, 6)
    expect(t.rootExtras).toBeCloseTo(1680 + 0 + 86.42, 6)
    expect(t.rootGesamt).toBeCloseTo(t.rootRevenueFinal + t.rootExtras, 6)
  })

  it('Blatt-Basis: REVENUE_BASIS, sonst REVENUE ohne Zuschläge, nie negativ', () => {
    expect(offerLeafBasis(legacyRows[0])).toBe(1000)
    expect(offerLeafBasis(legacyRows[1])).toBe(0)
    expect(offerLeafBasis(typical[1])).toBe(10000)
  })

  it('Waise (Vater gelöscht) zählt wie in der Baumansicht zur Wurzel', () => {
    const rows = [n({ ID: 1, FATHER_ID: 99, REVENUE_BASIS: 100, REVENUE: 110, SURCHARGES_TOTAL: 10, EXTRAS: 5 })]
    const t = offerRootTotals(rows, aggregateOffer(rows), 0)
    expect(t).toMatchObject({ rootRevenue: 100, rootSurcharges: 10, rootRevenueFinal: 110, rootExtras: 5 })
  })
})

describe('offerLeafFee / hoursRate', () => {
  const bl1 = typical[4]
  it('Aufwand: Stunden × Satz, mit offenen Eingaben', () => {
    expect(offerLeafFee(bl1, undefined)).toBe(1140)
    expect(offerLeafFee(bl1, { hours: '12,5'.replace(',', '.') })).toBe(1187.5)
    expect(hoursRate(bl1, { rate: '100' })).toEqual({ hours: '12', rate: '100' })
  })
  it('Pauschal: eingegebener Betrag, sonst REVENUE_BASIS', () => {
    expect(offerLeafFee(typical[1], undefined)).toBe(10000)
    expect(offerLeafFee(typical[1], { budget: '12000' })).toBe(12000)
    expect(offerLeafFee(typical[1], { budget: '' })).toBe(10000)
  })
  it('Wechsel auf Aufwand rechnet mit Stunden × Satz', () => {
    expect(offerLeafFee(typical[1], { billingTypeId: '2', hours: '10', rate: '90' })).toBe(900)
  })
})

describe('offerRowChanges', () => {
  const lp3 = typical[2]
  const bl1 = typical[4]

  it('nichts angefasst oder nur angeklickt → leer', () => {
    expect(offerRowChanges(lp3, undefined)).toEqual({})
    // Honorar mit Zuschlag: verglichen wird mit der Basis, nicht mit REVENUE
    expect(offerRowChanges(lp3, { nameShort: 'LP3', budget: '20000', nk: '5', billingTypeId: '1' })).toEqual({})
    expect(offerRowChanges(bl1, { hours: '12', rate: '95' })).toEqual({})
  })

  it('Felder werden kleingeschrieben gesendet (Angebots-Endpunkt)', () => {
    expect(offerRowChanges(lp3, { nameShort: 'LP3a', nameLong: 'Entwurf', nk: '6', budget: '21000' }))
      .toEqual({ abbr: 'LP3a', name: 'Entwurf', extras_percent: 6, revenue: 21000 })
  })

  it('Aufwand: Stunden und Satz, kein Honorar', () => {
    expect(offerRowChanges(bl1, { hours: '14', budget: '9999' })).toEqual({ quantity: 14 })
    expect(offerRowChanges(bl1, { rate: '100' })).toEqual({ hourly_rate: 100 })
  })

  it('Pauschal: Stunden/Satz werden ignoriert', () => {
    expect(offerRowChanges(lp3, { hours: '5', rate: '5' })).toEqual({})
  })

  it('Wechsel der Abrechnungsart', () => {
    expect(offerRowChanges(lp3, { billingTypeId: '2', hours: '10', rate: '90' }))
      .toEqual({ billing_type_id: 2, quantity: 10, hourly_rate: 90 })
  })

  it('Zuschläge gehen im selben Aufruf mit (SURCHARGE_*)', () => {
    const b = offerRowChanges(lp3, { budget: '21000', surcharge: {
      s1Label: 'Eil', s1Pct: '4', s1Cumul: true, s2Label: '', s2Pct: '', s2Cumul: true, s3Label: '', s3Pct: '', s3Cumul: true,
    } })
    expect(b).toMatchObject({ revenue: 21000, SURCHARGE_1_LABEL: 'Eil', SURCHARGE_1_PCT: 4, SURCHARGE_2_LABEL: null })
  })

  it('unveränderte Zuschläge lösen nichts aus', () => {
    expect(offerRowChanges(lp3, { surcharge: {
      s1Label: 'Eil', s1Pct: '3.0', s1Cumul: true, s2Label: '', s2Pct: '', s2Cumul: true, s3Label: '', s3Pct: '', s3Cumul: true,
    } })).toEqual({})
  })
})
