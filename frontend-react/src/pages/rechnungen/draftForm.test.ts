import { describe, it, expect } from 'vitest'
import { draftFormFromRow, abbrNameLabel } from './draftForm'

describe('draftFormFromRow', () => {
  it('übernimmt Rechnungsdaten und E-Rechnungsfelder', () => {
    const f = draftFormFromRow({
      INVOICE_DATE: '2026-09-20T00:00:00', DUE_DATE: '2026-10-20', BILLING_PERIOD_START: '2026-08-01',
      COMMENT: 'Zahlungsplan', BUYER_REFERENCE: '04011000-12345-34', BUYER_ORDER_REFERENCE: 'BE-1',
      PAYMENT_MEANS_ID: 2, VAT_CATEGORY: 'AE', DISCOUNT_1_PERCENT: 3, CASH_DISCOUNT_DAYS: 14,
      SE_PERCENT: 5, SE_BASIS: 'NETTO',
    }, 'INVOICE_DATE')
    expect(f).toMatchObject({
      date: '2026-09-20', dueDate: '2026-10-20', bpStart: '2026-08-01', bpFinish: '',
      comment: 'Zahlungsplan', buyerRef: '04011000-12345-34', orderRef: 'BE-1', accountingRef: '',
      paymentMeansId: '2', vatCategory: 'AE', d1Pct: '3', d2Pct: '', cashDiscDays: '14',
      sePct: '5', seBasis: 'NETTO',
    })
  })

  it('leere Zeile ergibt Standardwerte, kein Einbehalt', () => {
    const f = draftFormFromRow({}, 'ADVANCE_INVOICE_DATE')
    expect(f.date).toBeNull()
    expect(f.vatCategory).toBe('S')
    expect(f.sePct).toBeNull()
    expect(f.paymentMeansId).toBeNull()
  })

  it('Beschriftung aus Kürzel und Name', () => {
    expect(abbrNameLabel({ ABBR: 'P-1', NAME: 'Kita' })).toBe('P-1 – Kita')
    expect(abbrNameLabel(null)).toBe('')
  })
})
