import type { VatCategory } from '@/api/rechnungen'

/**
 * Formularwerte eines Rechnungsentwurfs aus der gespeicherten Zeile
 * (INVOICE oder ADVANCE_INVOICE), fuer das Fortsetzen in allen Assistenten.
 *
 * Warum eine eigene Stelle: Fortgesetzt wurde bis Runde 2 aus der Zeile der
 * Rechnungsliste, und die kannte nur Projekt, Vertrag, Nachlaesse und Skonto.
 * Der erste Klick auf „Weiter" schickte dann das heutige Datum und leere
 * E-Rechnungsfelder zurueck — Leitweg-ID, Bestellnummer, Kostenstelle und
 * Zahlungsart waren weg, ohne dass es jemand sah.
 */
export interface DraftFormValues {
  date:          string | null
  dueDate:       string | null
  bpStart:       string
  bpFinish:      string
  comment:       string
  buyerRef:      string
  orderRef:      string
  accountingRef: string
  remittance:    string
  paymentMeansId: string | null
  vatCategory:   VatCategory
  vatExemptCode: string
  vatExemptText: string
  d1Pct:         string
  d2Pct:         string
  d1Reason:      string
  d2Reason:      string
  cashDiscPct:   string
  cashDiscDays:  string
  /** null = kein Sicherheitseinbehalt gespeichert */
  sePct:         string | null
  seBasis:       'BRUTTO' | 'NETTO'
}

const day = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : null)
const str = (v: unknown) => (v == null ? '' : String(v))
const pos = (v: unknown) => (Number(v) > 0 ? String(Number(v)) : '')

export function draftFormFromRow(row: Record<string, unknown>, dateKey: 'INVOICE_DATE' | 'ADVANCE_INVOICE_DATE'): DraftFormValues {
  const cat = row.VAT_CATEGORY
  return {
    date:           day(row[dateKey]),
    dueDate:        day(row.DUE_DATE),
    bpStart:        day(row.BILLING_PERIOD_START) ?? '',
    bpFinish:       day(row.BILLING_PERIOD_FINISH) ?? '',
    comment:        str(row.COMMENT),
    buyerRef:       str(row.BUYER_REFERENCE),
    orderRef:       str(row.BUYER_ORDER_REFERENCE),
    accountingRef:  str(row.BUYER_ACCOUNTING_REFERENCE),
    remittance:     str(row.REMITTANCE_INFORMATION),
    paymentMeansId: row.PAYMENT_MEANS_ID != null ? String(row.PAYMENT_MEANS_ID) : null,
    vatCategory:    (typeof cat === 'string' && cat ? cat : 'S') as VatCategory,
    vatExemptCode:  str(row.VAT_EXEMPTION_REASON_CODE),
    vatExemptText:  str(row.VAT_EXEMPTION_REASON_TEXT),
    d1Pct:          pos(row.DISCOUNT_1_PERCENT),
    d2Pct:          pos(row.DISCOUNT_2_PERCENT),
    d1Reason:       str(row.DISCOUNT_1_REASON),
    d2Reason:       str(row.DISCOUNT_2_REASON),
    cashDiscPct:    pos(row.CASH_DISCOUNT_PERCENT),
    cashDiscDays:   pos(row.CASH_DISCOUNT_DAYS),
    sePct:          row.SE_PERCENT != null ? String(row.SE_PERCENT) : null,
    seBasis:        row.SE_BASIS === 'NETTO' ? 'NETTO' : 'BRUTTO',
  }
}

/** „P-2024-001 – Neubau …" aus { ABBR, NAME } */
export function abbrNameLabel(x?: { ABBR?: string | null; NAME?: string | null } | null): string {
  return x ? [x.ABBR, x.NAME].filter(Boolean).join(' – ') : ''
}
