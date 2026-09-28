import type { StructureNode, patchStructureNode } from '@/api/projekte'

/**
 * Rechenlogik der Projektstruktur (UI-Pilot Runde 2) — aus ProjektStruktur.tsx
 * unveraendert herausgezogen, damit sie getestet werden kann
 * (strukturCalc.test.ts haelt das Verhalten fest) und die Angebotsstruktur
 * (AngeboteStruktur.tsx, bisher eine Kopie) sie teilt. Seit Runde 3 liegt
 * hier der gemeinsame Kern (aggregateTree, treeRootTotals); was nur das
 * Angebot betrifft, steht in pages/angebote/struktur/offerStrukturCalc.ts.
 */

export type PatchBody = Parameters<typeof patchStructureNode>[1]

const num = (v: unknown) => Number(v ?? 0) || 0
const r2  = (n: number) => Math.round(n * 100) / 100

export type SurchargeEdit = {
  s1Label: string; s1Pct: string; s1Cumul: boolean
  s2Label: string; s2Pct: string; s2Cumul: boolean
  s3Label: string; s3Pct: string; s3Cumul: boolean
}

/** Offene Aenderungen an einem Element — nur, was angefasst wurde. */
export type RowEdit = {
  nameShort?: string; nameLong?: string; billingTypeId?: string
  nk?: string; budget?: string; internal?: boolean
  surcharge?: SurchargeEdit
}

export function surchargeDefault(node: object | null): SurchargeEdit {
  const n = (node ?? {}) as Record<string, unknown>
  const lab = (k: string) => (n[k] as string | null | undefined) ?? ''
  const pct = (k: string) => n[k] != null ? String(n[k]) : ''
  const cum = (k: string) => (n[k] as boolean | undefined) ?? true
  return {
    s1Label: lab('SURCHARGE_1_LABEL'), s1Pct: pct('SURCHARGE_1_PCT'), s1Cumul: cum('SURCHARGE_1_CUMUL'),
    s2Label: lab('SURCHARGE_2_LABEL'), s2Pct: pct('SURCHARGE_2_PCT'), s2Cumul: cum('SURCHARGE_2_CUMUL'),
    s3Label: lab('SURCHARGE_3_LABEL'), s3Pct: pct('SURCHARGE_3_PCT'), s3Cumul: cum('SURCHARGE_3_CUMUL'),
  }
}

export function sameSurcharge(a: SurchargeEdit, b: SurchargeEdit) {
  return (['s1', 's2', 's3'] as const).every(k =>
    a[`${k}Label`] === b[`${k}Label`] && Number(a[`${k}Pct`] || 0) === Number(b[`${k}Pct`] || 0) && a[`${k}Cumul`] === b[`${k}Cumul`])
}

export function surchargeBody(s: SurchargeEdit) {
  return {
    SURCHARGE_1_LABEL: s.s1Label || null, SURCHARGE_1_PCT: s.s1Pct !== '' ? Number(s.s1Pct) : null, SURCHARGE_1_CUMUL: s.s1Cumul,
    SURCHARGE_2_LABEL: s.s2Label || null, SURCHARGE_2_PCT: s.s2Pct !== '' ? Number(s.s2Pct) : null, SURCHARGE_2_CUMUL: s.s2Cumul,
    SURCHARGE_3_LABEL: s.s3Label || null, SURCHARGE_3_PCT: s.s3Pct !== '' ? Number(s.s3Pct) : null, SURCHARGE_3_CUMUL: s.s3Cumul,
  }
}

export function computeSurcharges(base: number, s: SurchargeEdit) {
  const s1Active = !!s.s1Label && s.s1Pct !== '' && Number(s.s1Pct) !== 0
  const s1Eur    = s1Active ? r2(base * Number(s.s1Pct) / 100) : 0
  const s1Sub    = base + s1Eur
  const s2Base   = s.s2Cumul ? s1Sub : base
  const s2Active = !!s.s2Label && s.s2Pct !== '' && Number(s.s2Pct) !== 0
  const s2Eur    = s2Active ? r2(s2Base * Number(s.s2Pct) / 100) : 0
  const s2Sub    = s1Sub + s2Eur
  const s3Base   = s.s3Cumul ? s2Sub : base
  const s3Active = !!s.s3Label && s.s3Pct !== '' && Number(s.s3Pct) !== 0
  const s3Eur    = s3Active ? r2(s3Base * Number(s.s3Pct) / 100) : 0
  return { s1Eur, s2Eur, s3Eur, total: r2(s1Eur + s2Eur + s3Eur) }
}

/** Was wuerde fuer dieses Element gespeichert? Leer = nichts geaendert. */
export function rowChanges(node: StructureNode, e: RowEdit | undefined): PatchBody {
  const b: PatchBody = {}
  if (!e) return b
  if (e.nameShort     !== undefined && e.nameShort !== (node.ABBR ?? '')) b.ABBR = e.nameShort
  if (e.nameLong      !== undefined && e.nameLong  !== (node.NAME ?? ''))  b.NAME = e.nameLong
  if (e.billingTypeId !== undefined && e.billingTypeId !== String(node.BILLING_TYPE_ID ?? '')) b.BILLING_TYPE_ID = Number(e.billingTypeId)
  if (e.nk     !== undefined && e.nk     !== '' && Number(e.nk) !== Number(node.EXTRAS_PERCENT ?? 0)) b.EXTRAS_PERCENT = Number(e.nk)
  // Verglichen wird mit dem ANGEZEIGTEN Wert (Honorar vor Zuschlaegen). Der
  // fruehere Vergleich gegen REVENUE markierte jede Zeile mit Zuschlag schon
  // nach blossem Anklicken als geaendert.
  if (e.budget !== undefined && e.budget !== '' && Number(e.budget) !== Number(node.REVENUE_BASIS ?? node.REVENUE ?? 0)) b.REVENUE = Number(e.budget)
  if (e.internal !== undefined && e.internal !== !!node.IS_INTERNAL) b.IS_INTERNAL = e.internal
  if (e.surcharge && !sameSurcharge(e.surcharge, surchargeDefault(node))) Object.assign(b, surchargeBody(e.surcharge))
  return b
}

export interface Agg { extras: number; surcharges: number; revenueBasis: number }

/**
 * Was Projekt- und Angebotsstruktur zum Rechnen brauchen. Beide Tabellen
 * haben dieselben Spalten, nur der Schluessel heisst anders (STRUCTURE_ID
 * bzw. ID) und das Blatt nimmt seine Honorar-Basis aus einer anderen Quelle.
 */
export interface CalcNode {
  FATHER_ID:         number | string | null
  REVENUE?:          number | null
  REVENUE_BASIS?:    number | null
  EXTRAS?:           number | null
  EXTRAS_PERCENT?:   number | null
  SURCHARGES_TOTAL?: number | null
}

/**
 * Summen von unten nach oben: Nebenkosten, Zuschlaege und Honorar-Basis
 * (Summe der Blatt-Basen). Vater-NK = Summe der Kinder-NK + eigene
 * Zuschlaege × eigene NK % — NK wirken also auch auf die Zuschlaege.
 */
export function aggregateTree<T extends CalcNode>(nodes: T[], idOf: (n: T) => number, leafBasis: (n: T) => number): Map<string, Agg> {
  const childrenOf = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.FATHER_ID != null) {
      const fid = String(n.FATHER_ID)
      const arr = childrenOf.get(fid) ?? []
      arr.push(String(idOf(n)))
      childrenOf.set(fid, arr)
    }
  }
  const nodeMap = new Map(nodes.map(n => [String(idOf(n)), n]))
  const cache = new Map<string, Agg>()
  function agg(id: string): Agg {
    if (cache.has(id)) return cache.get(id)!
    const children = childrenOf.get(id) ?? []
    const own = nodeMap.get(id)
    if (children.length === 0) {
      const r = { extras: num(own?.EXTRAS), surcharges: num(own?.SURCHARGES_TOTAL), revenueBasis: own ? leafBasis(own) : 0 }
      cache.set(id, r); return r
    }
    let extras = 0, surcharges = 0, revenueBasis = 0
    for (const cid of children) { const c = agg(cid); extras += c.extras; surcharges += c.surcharges; revenueBasis += c.revenueBasis }
    const ownSurcharges = num(own?.SURCHARGES_TOTAL)
    surcharges += ownSurcharges                                // Zuschlaege des Vaters kommen obendrauf
    extras = r2(extras + ownSurcharges * num(own?.EXTRAS_PERCENT) / 100)  // NK gelten auch fuer sie
    const r = { extras, surcharges, revenueBasis }
    cache.set(id, r); return r
  }
  for (const n of nodes) agg(String(idOf(n)))
  return cache
}

/**
 * Summen der Gesamtzeile („Projekt gesamt" / „Angebot gesamt").
 * Wurzel ist, was die Baumansicht oben zeigt: kein Vater, oder einer, den es
 * nicht mehr gibt (buildStructureTree haengt solche Waisen an die Wurzel).
 */
export function treeRootTotals<T extends CalcNode>(nodes: T[], idOf: (n: T) => number, aggMap: Map<string, Agg>, levelSurchargesTotal: number) {
  const ids = new Set(nodes.map(n => String(idOf(n))))
  const parentIds = new Set(nodes.filter(n => n.FATHER_ID != null).map(n => String(n.FATHER_ID)))
  const roots = nodes.filter(n => n.FATHER_ID == null || !ids.has(String(n.FATHER_ID)))
  const aggOf = (n: T) => aggMap.get(String(idOf(n)))
  // Honorar = reine Summe der Basen, vor allen Zuschlaegen auf jeder Ebene
  const rootRevenue = roots.reduce((s, n) =>
    s + (parentIds.has(String(idOf(n))) ? (aggOf(n)?.revenueBasis ?? 0) : num(n.REVENUE_BASIS ?? n.REVENUE)), 0)
  const structureSurcharges     = roots.reduce((s, n) => s + (aggOf(n)?.surcharges ?? 0), 0)
  const rootSurcharges          = structureSurcharges + levelSurchargesTotal
  const rootStructureRevenueSum = roots.reduce((s, n) => s + num(n.REVENUE), 0)
  const rootRevenueFinal        = rootStructureRevenueSum + levelSurchargesTotal
  const rootExtras              = roots.reduce((s, n) => s + (aggOf(n)?.extras ?? 0), 0)
  // Gesamt-Spalte: Honorar + Zuschlaege (REVENUE) + Nebenkosten (EXTRAS)
  const rootGesamt = rootRevenueFinal + rootExtras
  return { rootRevenue, rootSurcharges, rootStructureRevenueSum, rootRevenueFinal, rootExtras, rootGesamt }
}

// ── Projektstruktur ──────────────────────────────────────────────────────────

/**
 * Blatt-Basis der Projektstruktur. Bei Nachweis ist das die Summe der
 * Buchungen (TEC_SP_TOT_SUM). REVENUE_BASIS pflegt dort nur patchStructure —
 * bei importierten und bei frisch gebuchten Zeilen steht es nicht drin, und
 * REVENUE traegt bereits die Zuschlaege, gehoert also nicht in eine Basis.
 */
export function projectLeafBasis(n: StructureNode): number {
  return Number(n.BILLING_TYPE_ID) === 2 ? num(n.TEC_SP_TOT_SUM) : num(n.REVENUE_BASIS ?? n.REVENUE)
}

export function aggregateStructure(structure: StructureNode[]): Map<string, Agg> {
  return aggregateTree(structure, n => n.STRUCTURE_ID, projectLeafBasis)
}

/** Summen der Projektzeile („Projekt gesamt"). */
export function rootTotals(structure: StructureNode[], aggMap: Map<string, Agg>, projectSurchargesTotal: number) {
  return treeRootTotals(structure, n => n.STRUCTURE_ID, aggMap, projectSurchargesTotal)
}

/**
 * Plan eines Elements nach Aufwand (Runde 5) gegen das Gebuchte — fuer die
 * Anzeige in Tabelle und Blatt. null = kein Plan.
 */
export function planStatus(n: StructureNode) {
  if (Number(n.BILLING_TYPE_ID) !== 2 || n.PLAN_REVENUE == null) return null
  const plan   = Number(n.PLAN_REVENUE) || 0
  const booked = Number(n.TEC_SP_TOT_SUM ?? 0) || 0
  return {
    plan, booked,
    hours: n.PLAN_HOURS != null ? Number(n.PLAN_HOURS) : null,
    pct:   plan > 0 ? Math.round(booked / plan * 100) : null,
    over:  plan > 0 && booked > plan,
  }
}
