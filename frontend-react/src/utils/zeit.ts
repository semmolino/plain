/**
 * Datum und Dauer fuer die Zeiterfassung (UI-Pilot 2026-09).
 *
 * `new Date().toISOString().slice(0, 10)` ist das UTC-Datum. Zwischen 0 und
 * 2 Uhr deutscher Zeit ist das noch gestern — genau dann, wenn jemand nach
 * einem langen Tag seine Stunden nachtraegt. Hier zaehlt die Uhr des Geraets.
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD in lokaler Zeit. */
export function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Datum um `days` Tage verschoben (lokal, ueber Monatsgrenzen hinweg). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return localIsoDate(new Date(y, m - 1, d + days))
}

/** Letzter Arbeitstag vor `iso` (Montag → Freitag). */
export function previousWorkday(iso: string): string {
  let cur = addDaysIso(iso, -1)
  for (let i = 0; i < 3; i++) {
    const [y, m, d] = cur.split('-').map(Number)
    const wd = new Date(y, m - 1, d).getDay()
    if (wd !== 0 && wd !== 6) return cur
    cur = addDaysIso(cur, -1)
  }
  return cur
}

/** Stunden zwischen zwei Uhrzeiten „HH:MM"; null, wenn eine fehlt oder Bis vor Von liegt. */
export function hoursBetween(start: string, finish: string): number | null {
  if (!start || !finish) return null
  const [sh, sm] = start.split(':').map(Number)
  const [fh, fm] = finish.split(':').map(Number)
  if ([sh, sm, fh, fm].some(n => !Number.isFinite(n))) return null
  const min = fh * 60 + fm - (sh * 60 + sm)
  if (min <= 0) return null
  return Math.round(min / 60 * 100) / 100
}

/** „1,5" / „1.5" / „1" → Zahl; leer oder unlesbar → null. */
export function parseHours(raw: string): number | null {
  const t = raw.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const FMT_H = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })

/** 1.5 → „1,5" */
export function fmtHours(h: number | null | undefined): string {
  return h == null ? '' : FMT_H.format(h)
}

const FMT_DAY = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })

/** „Do., 24.09." */
export function fmtDayShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return FMT_DAY.format(new Date(y, m - 1, d))
}
