/**
 * Vergleichsfunktion für sortierbare Listen.
 *
 * Warum nicht einfach `String(a[key]).localeCompare(...)`: Zahlenspalten
 * sortieren als Text falsch (9.000 € stünde vor 10.000 €), und leere Werte
 * würden beim Umdrehen der Richtung die eigentlich gesuchten Spitzenwerte
 * verdrängen. Datumsfelder liegen im ISO-Format vor und sortieren als Text
 * korrekt — sie brauchen keine Sonderbehandlung.
 */
export function compareRows<T extends object>(
  a: T,
  b: T,
  key: keyof T,
  dir: 'asc' | 'desc',
  numericKeys: readonly (keyof T)[] = [],
): number {
  const sign = dir === 'asc' ? 1 : -1

  if (numericKeys.includes(key)) {
    const av = a[key] as unknown as number | null | undefined
    const bv = b[key] as unknown as number | null | undefined
    // Leerwerte immer ans Ende — in beiden Richtungen.
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return (av - bv) * sign
  }

  const av = String(a[key] ?? '')
  const bv = String(b[key] ?? '')
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  return av.localeCompare(bv, 'de', { sensitivity: 'base', numeric: true }) * sign
}
