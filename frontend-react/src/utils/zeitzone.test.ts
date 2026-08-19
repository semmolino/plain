import { describe, it, expect } from 'vitest'
import { bueroZuGeraet, geraetZuBuero, versatzZuBuero, bueroHinweis } from './zeitzone'

// Der Testlauf sitzt in einer festen Zone (vitest erbt die des Rechners).
// Statt daran zu drehen, wird gegen die Zone GERECHNET, die der Test selbst
// vorfindet — so ist die Aussage überall dieselbe.
const referenz = new Date('2026-08-19T12:00:00Z')
const eigeneZone = Intl.DateTimeFormat().resolvedOptions().timeZone

describe('Umrechnung Büro- ↔ Gerätezeit', () => {
  it('lässt die Uhrzeit unverändert, wenn Büro und Gerät dieselbe Zone haben', () => {
    expect(versatzZuBuero(eigeneZone, referenz)).toBe(0)
    expect(bueroZuGeraet('16:00', eigeneZone, referenz)).toBe('16:00')
    expect(geraetZuBuero('16:00', eigeneZone, referenz)).toBe('16:00')
  })

  it('blendet den Bürohinweis aus, solange beide Zonen gleich gehen', () => {
    expect(bueroHinweis('16:00', eigeneZone, referenz)).toBeNull()
  })

  it('rechnet hin und zurück ohne Verlust', () => {
    for (const zone of ['Europe/Berlin', 'Europe/London', 'America/New_York', 'Asia/Tokyo']) {
      for (const zeit of ['00:00', '08:30', '16:00', '23:45']) {
        expect(geraetZuBuero(bueroZuGeraet(zeit, zone, referenz), zone, referenz)).toBe(zeit)
      }
    }
  })

  it('bleibt beim Tagesüberlauf innerhalb von 24 Stunden', () => {
    for (const zone of ['Asia/Tokyo', 'America/Los_Angeles']) {
      const umgerechnet = bueroZuGeraet('23:30', zone, referenz)
      expect(umgerechnet).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    }
  })

  it('verschiebt um genau den Zonenunterschied', () => {
    // Berlin ist im August UTC+2, London UTC+1 — genau eine Stunde Abstand.
    const berlin = versatzZuBuero('Europe/Berlin', referenz)
    const london = versatzZuBuero('Europe/London', referenz)
    expect(london - berlin).toBe(60)
  })

  it('lässt ungültige Eingaben unverändert statt zu raten', () => {
    expect(bueroZuGeraet('', 'Europe/Berlin', referenz)).toBe('')
    expect(bueroZuGeraet('quatsch', 'Europe/Berlin', referenz)).toBe('quatsch')
  })

  it('rechnet ohne bekannte Bürozone gar nicht um', () => {
    expect(bueroZuGeraet('16:00', null, referenz)).toBe('16:00')
    expect(bueroHinweis('16:00', null, referenz)).toBeNull()
  })
})
