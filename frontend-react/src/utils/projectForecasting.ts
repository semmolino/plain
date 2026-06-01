// Earned Value Management (EVM) helpers — all purely computed from existing project fields.
// No API changes needed; automatically respects every time/category filter dimension.

export interface EvmMetrics {
  cpi:       number | null   // Earned Value / Actual Cost  (>1 = under budget)
  eac:       number | null   // Estimate At Completion      = Budget / CPI
  vac:       number | null   // Variance At Completion      = Budget − EAC  (positive = will finish under)
  etc:       number | null   // Estimate To Complete        = EAC − Actual Cost
  cpiStatus: 'good' | 'warn' | 'bad' | 'neutral'
}

/** Compute EVM metrics from any project row that has the three core fields. */
export function computeEvm(row: {
  BUDGET_TOTAL_NET?:     number | null
  LEISTUNGSSTAND_VALUE?: number | null
  COST_TOTAL?:           number | null
}): EvmMetrics {
  const budget = Number(row.BUDGET_TOTAL_NET    || 0)
  const ev     = Number(row.LEISTUNGSSTAND_VALUE || 0)
  const ac     = Number(row.COST_TOTAL          || 0)

  // Skip projects that are too small to produce meaningful metrics
  if (budget < 500 || ac < 100) {
    return { cpi: null, eac: null, vac: null, etc: null, cpiStatus: 'neutral' }
  }

  const cpi = ev > 0 ? ev / ac : null
  const eac = (cpi != null && cpi > 0.01) ? budget / cpi : null
  const vac = eac != null ? budget - eac : null
  const etc = eac != null ? eac - ac     : null

  const cpiStatus: EvmMetrics['cpiStatus'] =
    cpi == null ? 'neutral' :
    cpi >= 0.95 ? 'good'   :
    cpi >= 0.80 ? 'warn'   : 'bad'

  return { cpi, eac, vac, etc, cpiStatus }
}

/** Format CPI as "0.92" or "–" */
export function fmtCpi(cpi: number | null): string {
  return cpi == null ? '–' : cpi.toFixed(2)
}

/**
 * Given an array of cumulative cost values (one per period snapshot),
 * returns the average monthly cost burn over the last three periods.
 */
export function computeBurnRate(cumulativeCosts: number[]): number | null {
  if (cumulativeCosts.length < 2) return null
  const deltas: number[] = []
  for (let i = 1; i < cumulativeCosts.length; i++) {
    const d = cumulativeCosts[i] - cumulativeCosts[i - 1]
    if (d > 0) deltas.push(d)
  }
  if (deltas.length === 0) return null
  const recent = deltas.slice(-3)
  return recent.reduce((s, d) => s + d, 0) / recent.length
}

/** Projected months remaining given ETC and average monthly burn rate. */
export function monthsRemaining(etc: number | null, avgMonthly: number | null): number | null {
  if (etc == null || avgMonthly == null || avgMonthly <= 0 || etc <= 0) return null
  return etc / avgMonthly
}

/** Weighted-average CPI across a portfolio of projects. */
export function portfolioCpi(rows: { LEISTUNGSSTAND_VALUE?: number | null; COST_TOTAL?: number | null }[]): number | null {
  const totalEv = rows.reduce((s, r) => s + Number(r.LEISTUNGSSTAND_VALUE || 0), 0)
  const totalAc = rows.reduce((s, r) => s + Number(r.COST_TOTAL          || 0), 0)
  if (totalAc < 500) return null
  return totalEv > 0 ? totalEv / totalAc : null
}
