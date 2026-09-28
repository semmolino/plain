/**
 * Summen einer Rechnung im letzten Schritt der Assistenten (UI-Pilot Runde 2).
 *
 * Vorher stand dieselbe Rechnung dreimal je Assistent — in der Anzeige, beim
 * Buchen und beim „Entwurf speichern" —, also neunmal im Produkt, und die
 * Kopien waren nicht gleich: die Einzelrechnung nahm beim Buchen Nachlaesse
 * auch dann, wenn „Nachlässe angeben" abgewaehlt war. Jetzt eine Stelle.
 *
 * Rechenweg (wie auf dem PDF): Netto → Nachlass I → Nachlass II auf den Rest
 * → Skonto auf den Rest → zzgl. MwSt. → Brutto; davon ggf. der
 * Sicherheitseinbehalt (auf Brutto oder Netto). Jeder Schritt wird auf Cent
 * gerundet, bevor der naechste darauf rechnet.
 */

export interface TotalsInput {
  /** Netto vor Abzuegen (Vorschlag des Servers: Leistung + Buchungen + Nebenkosten) */
  base:         number
  vatPct:       number
  discounts:    boolean
  d1Pct:        string
  d2Pct:        string
  skonto:       boolean
  cashDiscPct:  string
  cashDiscDays: string
  se:           boolean
  sePct:        string
  seBasis:      'BRUTTO' | 'NETTO'
}

export const r2 = (n: number) => Math.round(n * 100) / 100
const num = (s: string) => (Number(String(s).replace(',', '.')) || 0)

export function computeTotals(i: TotalsInput) {
  const base   = i.base
  const vatPct = Number(i.vatPct) || 0
  const d1 = i.discounts ? num(i.d1Pct) : 0
  const d2 = i.discounts ? num(i.d2Pct) : 0
  const d1Amt = r2(base * d1 / 100)
  const d2Amt = r2((base - d1Amt) * d2 / 100)
  const totalDisc = r2(d1Amt + d2Amt)
  const cdPct  = i.skonto ? num(i.cashDiscPct) : 0
  const cdDays = i.skonto ? num(i.cashDiscDays) : 0
  const cdAmt  = r2((base - totalDisc) * cdPct / 100)
  const netAfter   = r2(base - totalDisc - cdAmt)
  const taxAfter   = r2(netAfter * vatPct / 100)
  const grossAfter = r2(netAfter + taxAfter)
  const sePctNum   = i.se ? num(i.sePct) : 0
  const seBasisAmt = i.se ? (i.seBasis === 'BRUTTO' ? grossAfter : netAfter) : 0
  const seAmt      = r2(seBasisAmt * sePctNum / 100)
  const payable    = r2(grossAfter - seAmt)
  return { base, vatPct, d1, d2, d1Amt, d2Amt, totalDisc, cdPct, cdDays, cdAmt, netAfter, taxAfter, grossAfter, sePctNum, seBasisAmt, seAmt, payable }
}

export type Totals = ReturnType<typeof computeTotals>

/** Nutzlast fuer PATCH (Nachlaesse, Skonto, SE) — dieselbe fuer Speichern, PDF, XML und Buchen. */
export function discountBody(t: Totals, i: Pick<TotalsInput, 'discounts' | 'skonto' | 'se' | 'seBasis'> & { d1Reason: string; d2Reason: string }) {
  return {
    discount_1_percent:    i.discounts ? t.d1 : 0,
    discount_1_reason:     i.discounts ? (i.d1Reason.trim() || null) : null,
    discount_2_percent:    i.discounts ? t.d2 : 0,
    discount_2_reason:     i.discounts ? (i.d2Reason.trim() || null) : null,
    total_discounts:       i.discounts ? t.totalDisc : 0,
    cash_discount_percent: i.skonto ? t.cdPct : 0,
    cash_discount_days:    i.skonto ? t.cdDays : 0,
    cash_discount_amount:  i.skonto ? t.cdAmt : 0,
    se_percent:            i.se ? t.sePctNum : null,
    se_basis:              i.se ? i.seBasis : null,
    se_basis_amt:          i.se ? t.seBasisAmt : null,
    se_amount:             i.se ? t.seAmt : null,
  }
}
