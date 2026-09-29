import type { FeeCalcMaster, FeePhaseRow, FeeCalcSurcharge, FeeCalcBl, BlAmountType } from '@/api/fee'

/**
 * Rechnung des Kalkulationsassistenten (HOAI) — herausgelöst in Runde 8,
 * damit Tabelle (Desktop) und Blatt je Zeile (Handy) dieselben Funktionen
 * nehmen. Vorher standen sie in HonorarWizard.tsx; am Verhalten ist nichts
 * geändert.
 */

export const KX_OPTIONS = ['K0', 'K1', 'K2', 'K3', 'K4'] as const
export type KX = typeof KX_OPTIONS[number]

// ── Helpers ───────────────────────────────────────────────────────────────────

export function fmtN(v: number | null | undefined) {
  if (v == null) return ''
  return String(v)
}

/** Auf 2 Nachkommastellen runden (fmt2). */
export function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Geldbetrag mit deutschem Komma und 2 Nachkommastellen, ohne €-Zeichen. */
export function fmtMoney2(v: number | null | undefined) {
  if (v == null) return ''
  return r2(Number(v)).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Prozentwert mit deutschem Komma, ohne Float-Rauschen. */
export function fmtPct(v: number | null | undefined) {
  if (v == null) return ''
  return (Math.round(Number(v) * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

export function toNum(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}


export function revenueByKx(row: FeeCalcMaster, kx: KX): number | null {
  const map: Record<KX, number | null> = {
    K0: row.REVENUE_K0, K1: row.REVENUE_K1, K2: row.REVENUE_K2,
    K3: row.REVENUE_K3, K4: row.REVENUE_K4,
  }
  return map[kx]
}

export function phaseRevenue(base: number | null, pct: number | null): number | null {
  if (base == null || pct == null) return null
  return r2((pct * base) / 100)
}

/** Compute effective base and amount for each surcharge row, honouring LPH filter + calc mode + BL filter */
export function computeSurchargeEffects(
  phases: FeePhaseRow[],
  surcharges: FeeCalcSurcharge[],
  blItems: FeeCalcBl[] = [],
  blComputedAmounts: number[] = [],
): { effectiveBase: number; amount: number }[] {
  const results: { effectiveBase: number; amount: number }[] = []
  let runningTotal = 0
  for (const r of surcharges) {
    const selectedIds: number[] = r.LPH_FILTER
      ? (JSON.parse(r.LPH_FILTER) as number[])
      : phases.map(p => p.ID)
    const phaseBase = phases
      .filter(p => selectedIds.includes(p.ID))
      .reduce((s, p) => s + (p.PHASE_REVENUE ?? 0), 0)
    let blContrib = 0
    if (r.BL_FILTER) {
      try {
        const selectedBlIds = JSON.parse(r.BL_FILTER) as number[]
        blContrib = blItems.reduce((s, b, i) => {
          return (b.ID != null && selectedBlIds.includes(b.ID)) ? s + (blComputedAmounts[i] ?? 0) : s
        }, 0)
      } catch { /* ignore parse error */ }
    }
    const base = phaseBase + blContrib
    const effectiveBase = r.CALC_MODE === 'cumulative' ? base + runningTotal : base
    const amount = ((r.PERCENT ?? 0) / 100) * effectiveBase
    results.push({ effectiveBase, amount })
    runningTotal += amount
  }
  return results
}

export const BL_AMOUNT_TYPE_LABELS: Record<BlAmountType, string> = {
  fixed:            'Pauschalbetrag €',
  pct_lph:          '% auf LPH-Honorar',
  pct_basis:        '% auf Basis-Honorar (Kx)',
  pct_grundhonorar: '% auf Grundhonorar (Summe LPH)',
  pct_gesamthonorar:'% auf Gesamthonorar inkl. Zuschläge',
  pct_baukosten:    '% auf Baukosten (Kx)',
}

export function constructionCostByKx(row: FeeCalcMaster, kx: KX): number | null {
  const map: Record<KX, number | null> = {
    K0: row.CONSTRUCTION_COSTS_K0, K1: row.CONSTRUCTION_COSTS_K1,
    K2: row.CONSTRUCTION_COSTS_K2, K3: row.CONSTRUCTION_COSTS_K3,
    K4: row.CONSTRUCTION_COSTS_K4,
  }
  return map[kx]
}

export function computeBlItemAmount(
  bl: FeeCalcBl,
  phases: FeePhaseRow[],
  calcMaster: FeeCalcMaster | null,
  grundhonorar: number,
  surchargeTotal: number,
): number {
  const pct = (Number(bl.PERCENT ?? 0) || 0) / 100
  switch (bl.AMOUNT_TYPE) {
    case 'pct_lph': {
      const phase = phases.find(p => p.ID === bl.LPH_PHASE_ID)
      return pct * (phase?.PHASE_REVENUE ?? 0)
    }
    case 'pct_basis': {
      if (!calcMaster || !bl.KX_REF) return 0
      return pct * (revenueByKx(calcMaster, bl.KX_REF as KX) ?? 0)
    }
    case 'pct_grundhonorar':
      return pct * grundhonorar
    case 'pct_gesamthonorar':
      return pct * (grundhonorar + surchargeTotal)
    case 'pct_baukosten': {
      if (!calcMaster || !bl.KX_REF) return 0
      return pct * (constructionCostByKx(calcMaster, bl.KX_REF as KX) ?? 0)
    }
    default:
      return Number(bl.AMOUNT) || 0
  }
}
