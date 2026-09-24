import type { StructureNode, patchStructureNode } from '@/api/projekte'

/**
 * Rechenlogik der Projektstruktur (UI-Pilot Runde 2) — aus ProjektStruktur.tsx
 * unveraendert herausgezogen, damit sie getestet werden kann
 * (strukturCalc.test.ts haelt das Verhalten fest) und die Angebotsstruktur
 * (AngeboteStruktur.tsx, bisher eine Kopie) sie spaeter uebernehmen kann.
 */

export type PatchBody = Parameters<typeof patchStructureNode>[1]

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
  const r2 = (n: number) => Math.round(n * 100) / 100
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
 * Summen von unten nach oben: Nebenkosten, Zuschlaege und Honorar-Basis
 * (Summe der Blatt-REVENUE_BASIS). Vater-NK = Summe der Kinder-NK + eigene
 * Zuschlaege × eigene NK % — NK wirken also auch auf die Zuschlaege.
 */
export function aggregateStructure(structure: StructureNode[]): Map<string, Agg> {
  const childrenOf = new Map<string, string[]>()
  for (const n of structure) {
    if (n.FATHER_ID != null) {
      const fid = String(n.FATHER_ID)
      const arr = childrenOf.get(fid) ?? []
      arr.push(String(n.STRUCTURE_ID))
      childrenOf.set(fid, arr)
    }
  }
  const nodeMap = new Map(structure.map(n => [String(n.STRUCTURE_ID), n]))
  const r2 = (n: number) => Math.round(n * 100) / 100
  const cache = new Map<string, Agg>()
  function agg(id: string): { extras: number; surcharges: number; revenueBasis: number } {
    if (cache.has(id)) return cache.get(id)!
    const children = childrenOf.get(id) ?? []
    if (children.length === 0) {
      const n = nodeMap.get(id)!
      // Bei Nachweis ist die Basis die Summe der Buchungen (TEC_SP_TOT_SUM).
      // REVENUE_BASIS pflegt dort nur patchStructure — bei importierten und
      // bei frisch gebuchten Zeilen steht es nicht drin, und REVENUE traegt
      // bereits die Zuschlaege, gehoert also nicht in eine Basis.
      const revenueBasis = Number(n?.BILLING_TYPE_ID) === 2
        ? (n?.TEC_SP_TOT_SUM ?? 0)
        : (n?.REVENUE_BASIS ?? n?.REVENUE ?? 0)
      const r = { extras: n?.EXTRAS ?? 0, surcharges: n?.SURCHARGES_TOTAL ?? 0, revenueBasis }
      cache.set(id, r); return r
    }
    let extras = 0, surcharges = 0, revenueBasis = 0
    for (const cid of children) { const c = agg(cid); extras += c.extras; surcharges += c.surcharges; revenueBasis += c.revenueBasis }
    const ownNode = nodeMap.get(id)
    const ownSurcharges = ownNode?.SURCHARGES_TOTAL ?? 0
    const ownNk         = Number(ownNode?.EXTRAS_PERCENT ?? 0)
    surcharges += ownSurcharges  // parent's own surcharges on top
    extras = r2(extras + ownSurcharges * ownNk / 100)  // NK applies to own surcharges too
    cache.set(id, { extras, surcharges, revenueBasis }); return { extras, surcharges, revenueBasis }
  }
  for (const n of structure) agg(String(n.STRUCTURE_ID))
  return cache
}

/** Summen der Projektzeile („Projekt gesamt"). */
export function rootTotals(structure: StructureNode[], aggMap: Map<string, Agg>, projectSurchargesTotal: number) {
  const parentIds = new Set(structure.filter(n => n.FATHER_ID != null).map(n => String(n.FATHER_ID)))
  const roots = structure.filter(n => n.FATHER_ID == null)
  // rootRevenue = pure sum of leaf REVENUE_BASIS values (before any surcharges at any level)
  const rootRevenue = roots.reduce((s, n) => {
    const isP = parentIds.has(String(n.STRUCTURE_ID))
    return s + (isP ? (aggMap.get(String(n.STRUCTURE_ID))?.revenueBasis ?? 0) : (n.REVENUE_BASIS ?? n.REVENUE ?? 0))
  }, 0)
  // Sum surcharges from structure subtree + project-level (root) surcharges
  const structureSurcharges = roots.reduce((s, n) => s + (aggMap.get(String(n.STRUCTURE_ID))?.surcharges ?? 0), 0)
  const rootSurcharges = structureSurcharges + projectSurchargesTotal
  const rootStructureRevenueSum = roots.reduce((s, n) => s + (n.REVENUE ?? 0), 0)
  const rootRevenueFinal = rootStructureRevenueSum + projectSurchargesTotal
  const rootExtras = roots.reduce((s, n) => s + (aggMap.get(String(n.STRUCTURE_ID))?.extras ?? 0), 0)
  // Gesamt-Spalte: Summe aus Honorar + Zuschläge (REVENUE) + Nebenkosten (EXTRAS).
  const rootGesamt = rootRevenueFinal + rootExtras
  return { rootRevenue, rootSurcharges, rootStructureRevenueSum, rootRevenueFinal, rootExtras, rootGesamt }
}
