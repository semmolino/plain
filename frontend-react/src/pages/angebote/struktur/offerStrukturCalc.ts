import type { OfferStructureNode, UpdateStructureNodePayload, UpdateOfferSurchargesPayload } from '@/api/angebote'
import {
  aggregateTree, treeRootTotals, sameSurcharge, surchargeBody, surchargeDefault,
  type Agg, type SurchargeEdit,
} from '@/pages/projekte/struktur/strukturCalc'

/**
 * Rechenlogik der Angebotsstruktur (UI-Pilot Runde 3).
 *
 * Bis Runde 2 stand in AngeboteStruktur.tsx eine eigene Kopie der
 * Summenlogik der Projektstruktur. Jetzt teilen sich beide den Kern aus
 * strukturCalc.ts; hier steht nur, was beim Angebot anders ist:
 *  - Blatt-Basis: REVENUE_BASIS, sonst REVENUE ohne Zuschlaege. Es gibt keine
 *    Buchungen — ein Aufwand-Blatt (BT 2) ist geschaetzt: Stunden × Satz,
 *    das Backend legt das Produkt in REVENUE_BASIS ab.
 *  - Der Speicher-Endpunkt nimmt kleingeschriebene Felder und die
 *    SURCHARGE_*-Felder im selben PUT; ein geaendertes Element ist also
 *    genau ein Aufruf.
 */

export type OfferPutBody = UpdateStructureNodePayload & Partial<UpdateOfferSurchargesPayload>

/** Offene Aenderungen an einem Angebotselement — nur, was angefasst wurde. */
export type OfferRowEdit = {
  nameShort?: string; nameLong?: string; billingTypeId?: string
  nk?: string; budget?: string; hours?: string; rate?: string
  surcharge?: SurchargeEdit
}

const num = (v: unknown) => Number(v ?? 0) || 0
const r2  = (n: number) => Math.round(n * 100) / 100

export const isHourlyBt = (bt: unknown) => Number(bt) === 2

export function offerLeafBasis(n: OfferStructureNode): number {
  return n.REVENUE_BASIS != null ? num(n.REVENUE_BASIS) : Math.max(0, num(n.REVENUE) - num(n.SURCHARGES_TOTAL))
}

export function aggregateOffer(structure: OfferStructureNode[]): Map<string, Agg> {
  return aggregateTree(structure, n => n.ID, offerLeafBasis)
}

/** Summen der Angebotszeile („Angebot gesamt"). */
export function offerRootTotals(structure: OfferStructureNode[], aggMap: Map<string, Agg>, offerSurchargesTotal: number) {
  return treeRootTotals(structure, n => n.ID, aggMap, offerSurchargesTotal)
}

/** Angezeigte Stunden/Satz eines Aufwand-Blatts — mit offenen Eingaben. */
export function hoursRate(node: OfferStructureNode, e: OfferRowEdit | undefined) {
  return {
    hours: e?.hours ?? String(node.QUANTITY ?? 0),
    rate:  e?.rate  ?? String(node.HOURLY_RATE ?? 0),
  }
}

/**
 * Honorar eines Blatts vor Zuschlaegen, so wie es nach dem Speichern waere:
 * Aufwand = Stunden × Satz, sonst der eingegebene Betrag. Die Zuschlaege
 * rechnen auf diese Basis — die Vorschau im Zuschlags-Panel soll nicht auf
 * dem alten Honorar stehen bleiben, waehrend daneben schon das neue steht.
 */
export function offerLeafFee(node: OfferStructureNode, e: OfferRowEdit | undefined): number {
  const bt = e?.billingTypeId ?? String(node.BILLING_TYPE_ID ?? '')
  if (isHourlyBt(bt)) {
    const { hours, rate } = hoursRate(node, e)
    return r2(num(hours) * num(rate))
  }
  return e?.budget !== undefined && e.budget !== '' ? num(e.budget) : num(node.REVENUE_BASIS ?? node.REVENUE)
}

/** Was wuerde fuer dieses Element gespeichert? Leer = nichts geaendert. */
export function offerRowChanges(node: OfferStructureNode, e: OfferRowEdit | undefined): OfferPutBody {
  const b: OfferPutBody = {}
  if (!e) return b
  if (e.nameShort     !== undefined && e.nameShort !== (node.ABBR ?? '')) b.abbr = e.nameShort
  if (e.nameLong      !== undefined && e.nameLong  !== (node.NAME ?? '')) b.name = e.nameLong
  if (e.billingTypeId !== undefined && e.billingTypeId !== String(node.BILLING_TYPE_ID ?? '')) b.billing_type_id = Number(e.billingTypeId)
  if (e.nk !== undefined && e.nk !== '' && Number(e.nk) !== num(node.EXTRAS_PERCENT)) b.extras_percent = Number(e.nk)
  // Honorar bzw. Stunden × Satz — je nachdem, was die Zeile gerade zeigt.
  // Verglichen wird mit dem angezeigten Wert (vor Zuschlaegen), sonst gaelte
  // jede Zeile mit Zuschlag schon nach blossem Anklicken als geaendert.
  const bt = e.billingTypeId ?? String(node.BILLING_TYPE_ID ?? '')
  if (isHourlyBt(bt)) {
    if (e.hours !== undefined && e.hours !== '' && Number(e.hours) !== num(node.QUANTITY))    b.quantity    = Number(e.hours)
    if (e.rate  !== undefined && e.rate  !== '' && Number(e.rate)  !== num(node.HOURLY_RATE)) b.hourly_rate = Number(e.rate)
  } else if (e.budget !== undefined && e.budget !== '' && Number(e.budget) !== num(node.REVENUE_BASIS ?? node.REVENUE)) {
    b.revenue = Number(e.budget)
  }
  if (e.surcharge && !sameSurcharge(e.surcharge, surchargeDefault(node))) Object.assign(b, surchargeBody(e.surcharge))
  return b
}
