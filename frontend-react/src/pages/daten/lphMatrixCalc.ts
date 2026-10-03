/**
 * LPH-Controlling: filtern und verdichten.
 *
 * Der Server liefert Rohsummen je Projekt × Leistungsbild × Honorarzone ×
 * Phase (`services/lphControlling.js`). Hier entstehen daraus Matrix,
 * Phasen-Aggregat und Summen — und zwar IMMER aus den Summen der gewählten
 * Auswahl. Eine Kostenquote über drei Projekte ist Σ Kosten / Σ Leistung,
 * nicht das Mittel dreier Quoten (gleiche Regel wie `aggregateKpis` beim
 * Gesamtprojekt).
 *
 * Bewusst ohne React-Bezug, geprüft in `lphMatrixCalc.test.ts`.
 */
import type { LphFact, LphLeistungsbild, LphProject } from '@/api/reports'
import { computeEvm } from '@/utils/projectForecasting'

const round2 = (n: number) => Math.round(n * 100) / 100

// ── Filter ──────────────────────────────────────────────────────────────────

/** Filterdimensionen. Leistungsbild und Zone hängen an der Phase, der Rest am Projekt. */
export type LphDim = 'lb' | 'zone' | 'status' | 'typ' | 'abteilung' | 'leitung' | 'auftraggeber'

export const LPH_DIMS: readonly LphDim[] = ['lb', 'zone', 'status', 'typ', 'abteilung', 'leitung', 'auftraggeber']

/** Leere Menge = alle (wie bei jedem FilterChip). */
export type LphFilters = Record<LphDim, Set<string>>

export const emptyLphFilters = (): LphFilters =>
  Object.fromEntries(LPH_DIMS.map(d => [d, new Set<string>()])) as LphFilters

const PROJECT_DIM: Record<Exclude<LphDim, 'lb' | 'zone'>, (p: LphProject) => string | null> = {
  status:       p => p.STATUS,
  typ:          p => p.TYPE,
  abteilung:    p => p.DEPARTMENT,
  leitung:      p => p.MANAGER,
  auftraggeber: p => p.CLIENT,
}

const dimValue = (dim: LphDim, f: LphFact, p: LphProject | undefined): string => {
  if (dim === 'lb')   return f.LB
  if (dim === 'zone') return f.ZONE
  return (p ? PROJECT_DIM[dim](p) : null) ?? ''
}

/** Auswahlwerte je Dimension — aus den geladenen Daten, nie aus festen Listen. */
export function lphFilterOptions(projects: LphProject[], facts: LphFact[]): Record<LphDim, string[]> {
  const byId = new Map(projects.map(p => [p.PROJECT_ID, p]))
  const sets = Object.fromEntries(LPH_DIMS.map(d => [d, new Set<string>()])) as Record<LphDim, Set<string>>
  for (const f of facts) {
    const p = byId.get(f.PROJECT_ID)
    for (const d of LPH_DIMS) sets[d].add(dimValue(d, f, p))
  }
  const sorted = (s: Set<string>) =>
    [...s].sort((a, b) => (a === '') !== (b === '') ? (a === '' ? 1 : -1) : a.localeCompare(b, 'de', { numeric: true }))
  return Object.fromEntries(LPH_DIMS.map(d => [d, sorted(sets[d])])) as Record<LphDim, string[]>
}

/** Wie viele Filter gerade greifen (für „Filter zurücksetzen"). */
export const activeFilterCount = (f: LphFilters) => LPH_DIMS.filter(d => f[d].size > 0).length

/**
 * Fakten nach Filtern und Suche. Ein Projekt fällt nur heraus, wenn keine
 * seiner Phasen übrig bleibt — wer „Gebäude" wählt, sieht vom Projekt mit
 * Gebäude und Freianlagen nur die Gebäude-Phasen.
 */
export function applyLphFilters(
  projects: LphProject[], facts: LphFact[], filters: LphFilters, search = '',
): { projects: LphProject[]; facts: LphFact[] } {
  const q = search.trim().toLowerCase()
  const byId = new Map(projects.map(p => [p.PROJECT_ID, p]))
  const keep = facts.filter(f => {
    const p = byId.get(f.PROJECT_ID)
    if (!p) return false
    if (q && !`${p.ABBR} ${p.NAME ?? ''}`.toLowerCase().includes(q)) return false
    return LPH_DIMS.every(d => filters[d].size === 0 || filters[d].has(dimValue(d, f, p)))
  })
  const ids = new Set(keep.map(f => f.PROJECT_ID))
  return { projects: projects.filter(p => ids.has(p.PROJECT_ID)), facts: keep }
}

// ── Kennzahlen ──────────────────────────────────────────────────────────────

export interface LphSums {
  HONORAR_NET:      number
  EARNED_VALUE_NET: number
  HOURS_TOTAL:      number
  COST_TOTAL:       number
}

export interface LphCell extends LphSums {
  /** Leistung / Honorar in % */
  LEISTUNGSSTAND_PERCENT: number | null
  /** Kosten / Leistung (Anteil, nicht %) — wie COST_RATIO der Projektliste */
  KOSTENQUOTE:            number | null
  /** Leistung − Kosten */
  DB:                     number
  /**
   * Deckungsbeitrag bei Fertigstellung, wenn die Phase so weiterläuft wie
   * bisher: Honorar − Honorar / CPI (`computeEvm`, dieselben Mindestgrößen
   * wie in Projektliste und Einzelprojekt). null = zu klein für eine Prognose.
   */
  DB_PROGNOSE:            number | null
  /** Leistung je gebuchter Stunde (erzielter Stundensatz) */
  LEISTUNG_JE_STUNDE:     number | null
  /** Kosten je gebuchter Stunde — die Messlatte für den erzielten Stundensatz */
  KOSTEN_JE_STUNDE:       number | null
  /** Reststunden bis Fertigstellung bei gleichbleibendem Aufwand je Leistung */
  RESTSTUNDEN:            number | null
}

const emptySums = (): LphSums => ({ HONORAR_NET: 0, EARNED_VALUE_NET: 0, HOURS_TOTAL: 0, COST_TOTAL: 0 })

const addInto = (acc: LphSums, s: LphSums) => {
  acc.HONORAR_NET      += s.HONORAR_NET
  acc.EARNED_VALUE_NET += s.EARNED_VALUE_NET
  acc.HOURS_TOTAL      += s.HOURS_TOTAL
  acc.COST_TOTAL       += s.COST_TOTAL
}

/**
 * Unter diesem Leistungsstand ist eine Hochrechnung der Stunden Raten: bei
 * 2 % Leistung und 10 h stünden 490 Reststunden da. Gleiche Vorsicht wie die
 * Mindestgrößen in `computeEvm`.
 */
export const RESTSTUNDEN_MIN_LST = 10

export function lphKpis(s: LphSums): LphCell {
  const honorar = round2(s.HONORAR_NET)
  const earned  = round2(s.EARNED_VALUE_NET)
  const cost    = round2(s.COST_TOTAL)
  const hours   = round2(s.HOURS_TOTAL)
  const lst     = honorar > 0 ? round2((earned / honorar) * 100) : null
  const { vac } = computeEvm({ BUDGET_TOTAL_NET: honorar, LEISTUNGSSTAND_VALUE: earned, COST_TOTAL: cost })
  const rest = lst != null && lst >= RESTSTUNDEN_MIN_LST && lst < 100 && hours > 0
    ? round2(hours / (lst / 100) - hours)
    : lst != null && lst >= 100 ? 0 : null
  return {
    HONORAR_NET: honorar, EARNED_VALUE_NET: earned, HOURS_TOTAL: hours, COST_TOTAL: cost,
    LEISTUNGSSTAND_PERCENT: lst,
    KOSTENQUOTE:        earned > 0 ? cost / earned : null,
    DB:                 round2(earned - cost),
    DB_PROGNOSE:        vac == null ? null : round2(vac),
    LEISTUNG_JE_STUNDE: hours > 0 ? round2(earned / hours) : null,
    KOSTEN_JE_STUNDE:   hours > 0 ? round2(cost / hours) : null,
    RESTSTUNDEN:        rest,
  }
}

// ── Spalten ─────────────────────────────────────────────────────────────────

export interface LphColumn {
  key:   string
  sort:  number
  /** Katalogname, wenn die Spalte in allen gewählten Leistungsbildern dasselbe heißt */
  name:  string | null
  /** Tooltip: was die Spalte je Leistungsbild bedeutet */
  title: string
  /** HOAI-Gewichtung, wenn genau ein Leistungsbild in der Auswahl ist */
  hoaiPercent: number | null
}

/**
 * Spalten der Auswahl. Stehen mehrere Leistungsbilder darin, nennt der
 * Tooltip je Leistungsbild, was die Spalte dort heißt — „LPH 3" ist eben
 * nicht überall die Entwurfsplanung.
 */
export function lphColumns(facts: LphFact[], leistungsbilder: LphLeistungsbild[]): LphColumn[] {
  const lbs = new Set(facts.map(f => f.LB))
  const keys = new Set(facts.map(f => f.PHASE))
  // Nur Paare, die in der Auswahl vorkommen: hat kein gewähltes Projekt
  // Freianlagen-LPH 1, sagt die Spalte LPH 1 auch nichts über Freianlagen.
  const pairs = new Set(facts.map(f => `${f.LB}|${f.PHASE}`))
  const info = new Map<string, { sort: number; names: { lb: string; name: string | null; pct: number | null }[] }>()
  for (const lb of leistungsbilder) {
    if (!lbs.has(lb.key)) continue
    for (const ph of lb.phases) {
      if (!pairs.has(`${lb.key}|${ph.key}`)) continue
      const e = info.get(ph.key) ?? { sort: ph.sort, names: [] }
      e.sort = Math.min(e.sort, ph.sort)
      e.names.push({ lb: lb.label, name: ph.name, pct: ph.hoaiPercent })
      info.set(ph.key, e)
    }
  }
  return [...keys]
    .map(key => {
      const e = info.get(key)
      const names = e?.names ?? []
      const distinct = new Set(names.map(n => n.name ?? ''))
      const single = names.length === 1 ? names[0] : null
      const title = names.length <= 1
        ? [key, single?.name].filter(Boolean).join(' — ')
        : [key, ...names.map(n => `${n.lb}: ${n.name ?? '—'}`)].join('\n')
      return {
        key,
        sort: e?.sort ?? Number.MAX_SAFE_INTEGER,
        name: distinct.size === 1 ? (names[0]?.name ?? null) : null,
        title,
        hoaiPercent: lbs.size === 1 && single ? single.pct : null,
      }
    })
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key, 'de', { numeric: true }))
}

// ── Verdichtung ─────────────────────────────────────────────────────────────

export interface LphRow {
  project: LphProject
  cells:   Record<string, LphCell>
  total:   LphCell
}

export interface LphPhaseAggregate extends LphCell {
  key:           string
  /** Projekte mit Werten in dieser Phase — wie belastbar der Vergleich ist */
  PROJECT_COUNT: number
  HOURS_SHARE:   number | null
  HONORAR_SHARE: number | null
}

export interface LphMatrixView {
  rows:    LphRow[]
  byPhase: LphPhaseAggregate[]
  totals:  LphCell | null
}

export function aggregateLph(projects: LphProject[], facts: LphFact[], columns: LphColumn[]): LphMatrixView {
  const perProject = new Map<number, Map<string, LphSums>>()
  const perPhase   = new Map<string, LphSums>()
  const phaseProjects = new Map<string, Set<number>>()
  for (const f of facts) {
    if (!perProject.has(f.PROJECT_ID)) perProject.set(f.PROJECT_ID, new Map())
    const pm = perProject.get(f.PROJECT_ID)!
    if (!pm.has(f.PHASE)) pm.set(f.PHASE, emptySums())
    addInto(pm.get(f.PHASE)!, f)
    if (!perPhase.has(f.PHASE)) perPhase.set(f.PHASE, emptySums())
    addInto(perPhase.get(f.PHASE)!, f)
    if (!phaseProjects.has(f.PHASE)) phaseProjects.set(f.PHASE, new Set())
    phaseProjects.get(f.PHASE)!.add(f.PROJECT_ID)
  }

  const rows: LphRow[] = projects
    .filter(p => perProject.has(p.PROJECT_ID))
    .map(p => {
      const pm = perProject.get(p.PROJECT_ID)!
      const cells: Record<string, LphCell> = {}
      const tot = emptySums()
      for (const [key, s] of pm) { cells[key] = lphKpis(s); addInto(tot, s) }
      return { project: p, cells, total: lphKpis(tot) }
    })

  const grand = emptySums()
  for (const s of perPhase.values()) addInto(grand, s)

  const byPhase: LphPhaseAggregate[] = columns
    .filter(c => perPhase.has(c.key))
    .map(c => {
      const s = perPhase.get(c.key)!
      return {
        key: c.key,
        ...lphKpis(s),
        PROJECT_COUNT: phaseProjects.get(c.key)?.size ?? 0,
        // Anteil an Stunden vs. Anteil am Honorar der Auswahl — weichen sie
        // stark ab, ist die Phase gemessen an ihrer Gewichtung zu teuer.
        HOURS_SHARE:   grand.HOURS_TOTAL > 0 ? round2((s.HOURS_TOTAL / grand.HOURS_TOTAL) * 100) : null,
        HONORAR_SHARE: grand.HONORAR_NET > 0 ? round2((s.HONORAR_NET / grand.HONORAR_NET) * 100) : null,
      }
    })

  return { rows, byPhase, totals: rows.length ? lphKpis(grand) : null }
}

/**
 * Ab welchem Abstand „Stundenanteil über Honoraranteil" als auffällig gilt
 * (Prozentpunkte). Bisheriger Wert der Matrix.
 */
export const HOURS_SHARE_GAP = 5

export const hoursShareExceeds = (a: Pick<LphPhaseAggregate, 'HOURS_SHARE' | 'HONORAR_SHARE'>) =>
  a.HOURS_SHARE != null && a.HONORAR_SHARE != null && a.HOURS_SHARE - a.HONORAR_SHARE >= HOURS_SHARE_GAP
