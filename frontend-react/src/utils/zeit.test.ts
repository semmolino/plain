import { describe, it, expect } from 'vitest'
import { localIsoDate, addDaysIso, previousWorkday, hoursBetween, parseHours, fmtHours } from './zeit'

describe('localIsoDate', () => {
  // 00:30 Ortszeit ist heute, auch wenn UTC noch gestern ist.
  it('nimmt das lokale Datum, nicht das UTC-Datum', () => {
    expect(localIsoDate(new Date(2026, 8, 24, 0, 30))).toBe('2026-09-24')
  })
})

describe('addDaysIso / previousWorkday', () => {
  it('rechnet ueber Monatsgrenzen', () => {
    expect(addDaysIso('2026-10-01', -1)).toBe('2026-09-30')
  })
  it('Montag → Freitag, Donnerstag → Mittwoch', () => {
    expect(previousWorkday('2026-09-28')).toBe('2026-09-25')
    expect(previousWorkday('2026-09-24')).toBe('2026-09-23')
  })
})

describe('hoursBetween', () => {
  it('rechnet Viertelstunden', () => {
    expect(hoursBetween('08:15', '12:45')).toBe(4.5)
  })
  it('Bis vor Von und fehlende Werte ergeben null', () => {
    expect(hoursBetween('12:00', '08:00')).toBeNull()
    expect(hoursBetween('', '08:00')).toBeNull()
  })
})

describe('parseHours / fmtHours', () => {
  it('liest Komma und Punkt', () => {
    expect(parseHours('1,5')).toBe(1.5)
    expect(parseHours('2.25')).toBe(2.25)
    expect(parseHours('')).toBeNull()
  })
  it('schreibt deutsch', () => {
    expect(fmtHours(1.5)).toBe('1,5')
  })
})
