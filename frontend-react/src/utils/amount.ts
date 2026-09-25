/** „1.234,56" / „1234,56" / „1234.56" → 1234.56; leer oder unlesbar → null. */
export function parseAmount(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '')
  if (!t) return null
  // Enthaelt ein Komma, ist es das Dezimalzeichen und Punkte sind Tausender.
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(norm)
  return Number.isFinite(n) ? n : null
}
