import { describe, it, expect } from 'vitest'
import { computeTotals, discountBody, type TotalsInput } from './invoiceTotals'

const base: TotalsInput = {
  base: 10_000, vatPct: 19, discounts: false, d1Pct: '', d2Pct: '', skonto: false, cashDiscPct: '', cashDiscDays: '',
  se: false, sePct: '', seBasis: 'BRUTTO',
}

describe('computeTotals', () => {
  it('ohne Abzüge: Netto, MwSt, Brutto', () => {
    expect(computeTotals(base)).toMatchObject({ netAfter: 10_000, taxAfter: 1_900, grossAfter: 11_900, payable: 11_900, totalDisc: 0, cdAmt: 0, seAmt: 0 })
  })

  it('Nachlass II rechnet auf den Rest, Skonto auf den Rest nach Nachlässen', () => {
    const t = computeTotals({ ...base, discounts: true, d1Pct: '3', d2Pct: '2', skonto: true, cashDiscPct: '2', cashDiscDays: '14' })
    // 10.000 − 300 = 9.700; −194 = 9.506; Skonto 2 % = 190,12 → 9.315,88
    expect(t).toMatchObject({ d1Amt: 300, d2Amt: 194, totalDisc: 494, cdAmt: 190.12, cdDays: 14, netAfter: 9315.88 })
    expect(t.taxAfter).toBe(1770.02)
    expect(t.grossAfter).toBe(11085.9)
  })

  it('abgewählte Abschnitte zählen nicht, auch wenn Werte darin stehen', () => {
    const t = computeTotals({ ...base, discounts: false, d1Pct: '10', skonto: false, cashDiscPct: '3', se: false, sePct: '5' })
    expect(t).toMatchObject({ totalDisc: 0, cdAmt: 0, seAmt: 0, grossAfter: 11_900 })
  })

  it('Sicherheitseinbehalt vom Brutto oder Netto', () => {
    expect(computeTotals({ ...base, se: true, sePct: '5', seBasis: 'BRUTTO' })).toMatchObject({ seBasisAmt: 11_900, seAmt: 595, payable: 11_305 })
    expect(computeTotals({ ...base, se: true, sePct: '5', seBasis: 'NETTO' })).toMatchObject({ seBasisAmt: 10_000, seAmt: 500, payable: 11_400 })
  })

  it('Komma als Dezimaltrenner, Rundung auf Cent je Schritt', () => {
    const t = computeTotals({ ...base, base: 333.33, discounts: true, d1Pct: '2,5' })
    expect(t.d1Amt).toBe(8.33)
    expect(t.netAfter).toBe(325)
  })
})

describe('discountBody', () => {
  it('schickt null/0 für abgewählte Abschnitte', () => {
    const i = { ...base, discounts: false, skonto: true, cashDiscPct: '2', cashDiscDays: '10', se: false }
    const b = discountBody(computeTotals(i), { ...i, d1Reason: 'x', d2Reason: '' })
    expect(b).toMatchObject({
      discount_1_percent: 0, discount_1_reason: null, total_discounts: 0,
      cash_discount_percent: 2, cash_discount_days: 10, cash_discount_amount: 200,
      se_percent: null, se_basis: null, se_amount: null,
    })
  })
  it('leere Bezeichnung wird null', () => {
    const i = { ...base, discounts: true, d1Pct: '3' }
    expect(discountBody(computeTotals(i), { ...i, d1Reason: '  ', d2Reason: '' }).discount_1_reason).toBeNull()
  })
})
