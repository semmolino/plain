import { describe, it, expect } from 'vitest'
import { negativeStyle, negativeOr } from './money'

describe('negativeStyle', () => {
  it('faerbt nur negative Betraege', () => {
    expect(negativeStyle(-0.01)).toEqual({ color: 'var(--kpi-critical)' })
    expect(negativeStyle(-1000)).toEqual({ color: 'var(--kpi-critical)' })
  })

  // Null ist kein Verlust. Waere die Grenze `<= 0`, waere jede leere Spalte rot.
  it('laesst null und positive Betraege ungefaerbt', () => {
    expect(negativeStyle(0)).toBeUndefined()
    expect(negativeStyle(1)).toBeUndefined()
  })

  it('laesst fehlende und unlesbare Werte ungefaerbt', () => {
    expect(negativeStyle(null)).toBeUndefined()
    expect(negativeStyle(undefined)).toBeUndefined()
    expect(negativeStyle(NaN)).toBeUndefined()
    expect(negativeStyle(-Infinity)).toBeUndefined()
  })

  // --danger heisst "Fehler / loeschen". Ein negativer Betrag ist keine
  // Fehlermeldung, sondern eine kaufmaennische Aussage.
  it('benutzt die Controlling-Farbe, nicht die UI-Fehlerfarbe', () => {
    expect(negativeStyle(-1)?.color).toBe('var(--kpi-critical)')
    expect(negativeStyle(-1)?.color).not.toContain('danger')
  })

  it('benutzt ein Token, keinen festen Farbwert', () => {
    expect(negativeStyle(-1)?.color).toMatch(/^var\(--/)
  })
})

describe('negativeOr', () => {
  // "Abrechenbar" traegt normalerweise die Akzentfarbe. Ein negativer Wert dort
  // heisst ueberzahlt — dann muss Rot die Akzentfarbe schlagen.
  it('schlaegt die vorhandene Farbe bei negativem Wert', () => {
    expect(negativeOr(-5, 'var(--accent)')).toEqual({ color: 'var(--kpi-critical)' })
  })

  it('behaelt die vorhandene Farbe sonst', () => {
    for (const v of [0, 5, null, undefined, NaN]) {
      expect(negativeOr(v, 'var(--accent)')).toEqual({ color: 'var(--accent)' })
    }
  })
})
