/** Stunden „1,50 h" und Salden „+1,50 h" / „−1,50 h" (Mitarbeiter-Modul). */
export function fmtH(n: number) {
  return n.toFixed(2).replace('.', ',') + ' h'
}
export function fmtBalance(n: number) {
  const s = Math.abs(n).toFixed(2).replace('.', ',') + ' h'
  return n >= 0 ? `+${s}` : `−${s}`
}

export function fmtDateShort(d: string) {
  return new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Datum in Ortszeit (YYYY-MM-DD) — toISOString() lag zwischen 0 und 2 Uhr einen Tag zurück. */
export function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const todayLocal = (): string => localIso(new Date())

// ID des aktuell gueltigen Eintrags (juengstes VALID_FROM <= heute) aus einer
// datierten Historie (Kostensatz / Arbeitszeitmodell).
export function latestValidId<T extends { ID: number; VALID_FROM: string }>(items: T[], today: string): number | null {
  const valid = items.filter(i => i.VALID_FROM <= today)
  if (!valid.length) return null
  return valid.reduce((a, b) => (a.VALID_FROM >= b.VALID_FROM ? a : b)).ID
}
