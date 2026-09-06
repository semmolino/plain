import { describe, it, expect } from 'vitest'
import { SERIES, SERIES_ROLE, seriesColor, type SeriesRole } from './chartTheme'

/**
 * Der Farbsatz hat sechs Plaetze fuer sieben Kennzahlen — zwei Paare teilen
 * sich je eine Farbe. Das ist zulaessig, solange die geteilten Kennzahlen NIE
 * im selben Diagramm stehen. Genau das haelt dieser Test fest: Wer eine Reihe
 * zu einem Diagramm hinzufuegt oder eine Rolle umhaengt, faellt hier auf, statt
 * erst in der Oberflaeche, wo zwei Linien plotzlich gleich aussehen.
 */
const CHARTS: Record<string, SeriesRole[]> = {
  'Projektverlauf (Dashboard, Projektliste, Einzelprojekt)':
    ['honorar', 'leistung', 'kosten', 'fakturiert', 'bezahlt'],
  'Trends — Fakturierung und Ergebnis': ['fakturiert', 'kosten', 'db'],
  'Trends — Auftragsbestand':           ['backlog'],
  'Trends — Stunden':                   ['stunden', 'kosten'],
  'Trends — Zahlungseingang':           ['fakturiert', 'bezahlt'],
  'Leistungsphasen':                    ['honorar', 'leistung', 'kosten'],
}

describe('Serienfarben', () => {
  it.each(Object.entries(CHARTS))('%s: jede Reihe hat eine eigene Farbe', (_name, roles) => {
    const used = roles.map(seriesColor)
    expect(new Set(used).size).toBe(roles.length)
  })

  // Der Satz ist Okabe-Ito ohne Gelb (1.1:1 auf Weiss) und ohne Schwarz (das
  // ist die Achsenfarbe). Eine siebte Farbe frei Hand zerstoert den Abstand
  // bei Rot-Gruen-Schwaeche — deshalb steht die Zahl hier fest.
  it('hat genau sechs Farben, alle als Hex', () => {
    expect(SERIES).toHaveLength(6)
    for (const c of SERIES) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })

  // Chart.js zeichnet auf ein <canvas>: dort ist `var(--token)` kein
  // Farbwert, sondern Schwarz. Genau daran sind die Verlaufsdiagramme
  // einmal gestorben.
  it('gibt nie eine CSS-Variable zurueck', () => {
    for (const role of Object.keys(SERIES_ROLE) as SeriesRole[]) {
      expect(seriesColor(role)).not.toContain('var(')
    }
  })

  it('zeigt auf einen vorhandenen Platz', () => {
    for (const i of Object.values(SERIES_ROLE)) {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(SERIES.length)
    }
  })
})
