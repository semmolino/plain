import { buildStructureTree, flattenTree } from '@/utils/treeUtils'
import type { LeistungsstandNode, StructureNode } from '@/api/projekte'

/**
 * Rechenlogik der Leistungsstand-Eingabe (UI-Pilot Runde 2) — ohne React,
 * damit sie getestet werden kann. Genutzt vom Projekt-Reiter und von der
 * Monatsrunde; beide zeigen dieselbe Tabelle.
 */

export type PctParse = { ok: true; value: number } | { ok: false; error: string }

/** „45", „45,5", „45.5 %" → Zahl; leer, unlesbar oder ausserhalb 0–100 → Fehler. */
export function parsePct(raw: string): PctParse {
  const t = raw.replace(/\s|%/g, '').replace(',', '.')
  if (t === '') return { ok: false, error: 'Wert fehlt' }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, error: 'Keine Zahl' }
  const n = Number(t)
  if (n < 0 || n > 100) return { ok: false, error: 'Nur 0 bis 100 %' }
  return { ok: true, value: Math.round(n * 100) / 100 }
}

const FMT_PCT_IN = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, useGrouping: false })
/** 45.5 → „45,5" (Eingabefeld). */
export const pctInput = (n: number | null | undefined) => (n == null ? '' : FMT_PCT_IN.format(n))

export interface LsRow {
  node:      LeistungsstandNode
  depth:     number
  /** Blatt mit Pauschal-Abrechnung — hier gibt man den Stand ein. */
  editable:  boolean
  /** Nachweis-Blatt: steht immer auf 100 %. */
  nachweis:  boolean
  /** Honorar inkl. Nebenkosten */
  fee:       number
  /** heutiger Stand in % */
  current:   number
  /** schon abgerechnet (netto) */
  billed:    number
  /** Stichtag des letzten Standes liegt nach dem gewaehlten → hier nicht pflegbar */
  lockedAfter: string | null
}

export function buildRows(nodes: LeistungsstandNode[], asOf: string): LsRow[] {
  const flat = flattenTree(buildStructureTree(nodes as unknown as StructureNode[]))
  return flat.map(({ node, depth }) => {
    const n = node as unknown as LeistungsstandNode
    const nachweis = n.IS_LEAF && Number(n.BILLING_TYPE_ID) === 2
    const prevAsOf = n.PREV_AS_OF ? String(n.PREV_AS_OF).slice(0, 10) : null
    return {
      node: n,
      depth,
      editable: n.IS_LEAF && !nachweis,
      nachweis,
      fee: Number(n.REVENUE ?? 0) + Number(n.EXTRAS ?? 0),
      current: Number(n.REVENUE_COMPLETION_PERCENT ?? 0),
      billed: Number(n.ADVANCE_INVOICED ?? 0) + Number(n.INVOICED ?? 0),
      lockedAfter: n.IS_LEAF && !nachweis && prevAsOf && prevAsOf > asOf ? prevAsOf : null,
    }
  })
}

export type LsWarning =
  | { kind: 'decrease'; from: number }
  | { kind: 'belowBilled'; billed: number; value: number }

export interface LsRowState {
  /** eingegebener Wert gueltig? (sonst `error`) */
  error:    string | null
  /** neuer Stand in % (bei Fehler: der bisherige) */
  next:     number
  changed:  boolean
  /** Wertaenderung in € */
  delta:    number
  warnings: LsWarning[]
}

export function rowState(row: LsRow, raw: string | undefined): LsRowState {
  if (!row.editable || raw === undefined) {
    return { error: null, next: row.nachweis ? 100 : row.current, changed: false, delta: 0, warnings: [] }
  }
  const p = parsePct(raw)
  if (!p.ok) return { error: p.error, next: row.current, changed: false, delta: 0, warnings: [] }
  const next    = p.value
  const changed = Math.abs(next - row.current) >= 0.005
  const delta   = Math.round(((next - row.current) / 100) * row.fee * 100) / 100
  const warnings: LsWarning[] = []
  if (changed && next < row.current) warnings.push({ kind: 'decrease', from: row.current })
  const value = Math.round((next / 100) * row.fee * 100) / 100
  // 1 € Toleranz: Rundung zwischen Prozent und Betrag soll keinen Alarm geben.
  if (row.billed > 0 && value + 1 < row.billed) warnings.push({ kind: 'belowBilled', billed: row.billed, value })
  return { error: null, next, changed, delta, warnings }
}

/** Summe ueber alle Zeilen: Aenderungen, Fehler, Wertaenderung. */
export function summarize(rows: LsRow[], vals: Record<number, string>) {
  let changed = 0, errors = 0, delta = 0, warnings = 0
  const updates: { structure_id: number; revenue_completion_percent: number }[] = []
  for (const r of rows) {
    if (!r.editable || r.lockedAfter) continue
    const st = rowState(r, vals[r.node.STRUCTURE_ID])
    if (st.error) { errors++; continue }
    if (st.changed) {
      changed++
      delta += st.delta
      updates.push({ structure_id: r.node.STRUCTURE_ID, revenue_completion_percent: st.next })
    }
    if (st.warnings.length) warnings++
  }
  return { changed, errors, warnings, delta: Math.round(delta * 100) / 100, updates }
}

/** „2026-09-30" → „30.09.2026" */
export function deDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = String(iso).slice(0, 10)
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
}

/** „2026-09-30" → „September 2026" */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 15))
}
