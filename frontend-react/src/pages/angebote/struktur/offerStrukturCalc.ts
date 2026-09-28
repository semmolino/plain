import type { EffortLine, OfferStructureNode, UpdateStructureNodePayload, UpdateOfferSurchargesPayload } from '@/api/angebote'
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
 *  - Aufwand in Zeilen (Runde 5): ein Element traegt beliebig viele Zeilen
 *    Rolle · Stunden · Satz. „Stunden × Satz" in der Tabelle ist die erste
 *    Zeile; das Aufwands-Panel zeigt alle. Gepuffert wird immer die ganze
 *    Liste (`lines`), gesendet als `effort_lines`.
 */

export type OfferPutBody = UpdateStructureNodePayload & Partial<UpdateOfferSurchargesPayload>

/** Eine Aufwandszeile, wie sie in den Eingabefeldern steht. */
export type EffortLineEdit = {
  roleId: string; roleAbbr: string; roleName: string; hours: string; rate: string
}

/** Offene Aenderungen an einem Angebotselement — nur, was angefasst wurde. */
export type OfferRowEdit = {
  nameShort?: string; nameLong?: string; billingTypeId?: string
  nk?: string; budget?: string
  lines?: EffortLineEdit[]
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

export const emptyLine = (): EffortLineEdit => ({ roleId: '', roleAbbr: '', roleName: '', hours: '', rate: '' })

/**
 * Gespeicherte Zeilen eines Elements. Altbestand ohne EFFORT_LINES mit
 * Stunden, Satz oder Rolle ist eine Zeile — wie im Server (effortLines.js).
 */
export function nodeLines(n: OfferStructureNode): EffortLineEdit[] {
  const toEdit = (l: EffortLine): EffortLineEdit => ({
    roleId: l.role_id != null ? String(l.role_id) : '', roleAbbr: l.role_abbr ?? '', roleName: l.role_name ?? '',
    hours: String(l.hours ?? 0), rate: String(l.rate ?? 0),
  })
  if (Array.isArray(n.EFFORT_LINES) && n.EFFORT_LINES.length) return n.EFFORT_LINES.map(toEdit)
  if (num(n.QUANTITY) === 0 && num(n.HOURLY_RATE) === 0 && n.ROLE_ID == null) return []
  return [toEdit({ role_id: n.ROLE_ID, role_abbr: n.ROLE_ABBR, role_name: n.ROLE_NAME, hours: num(n.QUANTITY), rate: num(n.HOURLY_RATE) })]
}

/** Angezeigte Zeilen — mit offenen Eingaben. */
export function effectiveLines(n: OfferStructureNode, e: OfferRowEdit | undefined): EffortLineEdit[] {
  return e?.lines ?? nodeLines(n)
}

export const lineFee    = (l: EffortLineEdit) => r2(num(l.hours) * num(l.rate))
export const linesFee   = (ls: EffortLineEdit[]) => r2(ls.reduce((s, l) => s + lineFee(l), 0))
export const linesHours = (ls: EffortLineEdit[]) => r2(ls.reduce((s, l) => s + num(l.hours), 0))

/** Stunden/Satz der ersten Zeile — fuer „Stunden × Satz" direkt in der Tabelle. */
export function hoursRate(node: OfferStructureNode, e: OfferRowEdit | undefined) {
  const first = effectiveLines(node, e)[0]
  return { hours: first?.hours ?? '0', rate: first?.rate ?? '0' }
}

/** Neue Zeilenliste nach einer Eingabe in „Stunden × Satz" (erste Zeile). */
export function withFirstLine(node: OfferStructureNode, e: OfferRowEdit | undefined, patch: Partial<EffortLineEdit>): EffortLineEdit[] {
  const ls = effectiveLines(node, e)
  return ls.length ? [{ ...ls[0], ...patch }, ...ls.slice(1)] : [{ ...emptyLine(), hours: '0', rate: '0', ...patch }]
}

/** Was an den Server geht — leere Zeilen fallen weg, wie dort. */
export function serializeLines(ls: EffortLineEdit[]): EffortLine[] {
  return ls
    .map(l => ({
      role_id:   l.roleId ? Number(l.roleId) : null,
      role_abbr: l.roleAbbr.trim() || null,
      role_name: l.roleName.trim() || null,
      hours:     r2(num(l.hours)),
      rate:      r2(num(l.rate)),
    }))
    .filter(l => l.role_id != null || l.role_abbr || l.role_name || l.hours !== 0 || l.rate !== 0)
}

/** Kurzbeschriftung der Rollen eines Elements (Kennzeichen neben dem Namen). */
export function rolesLabel(ls: EffortLineEdit[]): string {
  const abbrs = ls.map(l => l.roleAbbr).filter(Boolean)
  if (ls.length <= 1) return abbrs[0] ?? ''
  return ls.length <= 3 && abbrs.length === ls.length ? abbrs.join(' · ') : `${ls.length} Rollen`
}

/**
 * Honorar eines Blatts vor Zuschlaegen, so wie es nach dem Speichern waere:
 * Aufwand = Stunden × Satz, sonst der eingegebene Betrag. Die Zuschlaege
 * rechnen auf diese Basis — die Vorschau im Zuschlags-Panel soll nicht auf
 * dem alten Honorar stehen bleiben, waehrend daneben schon das neue steht.
 */
export function offerLeafFee(node: OfferStructureNode, e: OfferRowEdit | undefined): number {
  const bt = e?.billingTypeId ?? String(node.BILLING_TYPE_ID ?? '')
  if (isHourlyBt(bt)) return linesFee(effectiveLines(node, e))
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
    if (e.lines !== undefined) {
      const next = serializeLines(e.lines)
      if (JSON.stringify(next) !== JSON.stringify(serializeLines(nodeLines(node)))) b.effort_lines = next
    }
  } else if (e.budget !== undefined && e.budget !== '' && Number(e.budget) !== num(node.REVENUE_BASIS ?? node.REVENUE)) {
    b.revenue = Number(e.budget)
  }
  if (e.surcharge && !sameSurcharge(e.surcharge, surchargeDefault(node))) Object.assign(b, surchargeBody(e.surcharge))
  return b
}
