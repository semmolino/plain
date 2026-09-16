import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { negativeStyle, negativeOr, fmtEur, fmtEur0, money, money0, moneyOr, NO_VALUE } from './money'

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

describe('fmtEur', () => {
  it('formatiert deutsch mit zwei Nachkommastellen', () => {
    expect(fmtEur(1234.5)).toBe('1.234,50\u00a0€')
    expect(fmtEur(-1234.5)).toBe('-1.234,50\u00a0€')
  })

  it('rundet nicht auf ganze Euro', () => {
    expect(fmtEur(0.005)).toBe('0,01\u00a0€')
  })

  // "Kein Wert" ist nicht "0 €" — eine 0 waere eine Behauptung.
  it('gibt den Platzhalter fuer fehlende und unlesbare Werte', () => {
    for (const v of [null, undefined, NaN, Infinity]) expect(fmtEur(v)).toBe(NO_VALUE)
    expect(fmtEur(0)).not.toBe(NO_VALUE)
  })
})

describe('fmtEur0', () => {
  it('formatiert ohne Nachkommastellen', () => {
    expect(fmtEur0(1234.5)).toBe('1.235\u00a0€')
  })

  it('gibt den Platzhalter fuer fehlende Werte', () => {
    expect(fmtEur0(null)).toBe(NO_VALUE)
  })
})

describe('money / money0 / moneyOr', () => {
  // Diese Tests gibt es, weil eine Suchen-und-Ersetzen-Aktion money() einmal
  // auf sich selbst zeigen liess. `tsc` hat das durchgelassen — der
  // Rueckgabetyp war annotiert, die Rekursion also typkorrekt. Erst beim
  // Rendern waere der Stapel uebergelaufen.
  const html = (n: React.ReactNode) => renderToStaticMarkup(<>{n}</>)

  it('rendert den Betrag, ohne sich aufzuhaengen', () => {
    expect(html(money(1234.5))).toContain('1.234,50')
    expect(html(money0(1234.5))).toContain('1.235')
    expect(html(moneyOr(1234.5, 'var(--accent)'))).toContain('1.234,50')
  })

  it('faerbt negative Betraege rot', () => {
    expect(html(money(-5))).toContain('var(--kpi-critical)')
    expect(html(money(5))).not.toContain('var(--kpi-critical)')
  })

  it('laesst die Grundfarbe stehen, solange der Wert nicht negativ ist', () => {
    expect(html(moneyOr(5, 'var(--accent)'))).toContain('var(--accent)')
    expect(html(moneyOr(-5, 'var(--accent)'))).toContain('var(--kpi-critical)')
  })

  it('zeigt den Platzhalter statt einer erfundenen 0', () => {
    expect(html(money(null))).toContain(NO_VALUE)
  })
})
