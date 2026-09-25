import { describe, it, expect } from 'vitest'
import { resolveProjektView, serializeProjektView } from './projektUrlState'

const p = (qs: string) => new URLSearchParams(qs)

describe('resolveProjektView', () => {
  it('Monatsrunde: ?tab=leistungsstaende ist eine Listen-Ansicht, auch mit Projekt', () => {
    expect(resolveProjektView(p('tab=leistungsstaende'), null, 4)).toEqual({
      view: { view: 'list', listTab: 'leistungsstaende', pendingTab: null }, canonical: null,
    })
    expect(resolveProjektView(p('tab=leistungsstaende&projectId=4'), null, null).canonical).toBe('tab=leistungsstaende')
  })

  // Alte Sammel-Erinnerungen — die liegen noch in den Benachrichtigungen.
  it('alter Erinnerungs-Link ?tab=leistungsstand&filter=mine fuehrt in die Monatsrunde', () => {
    const r = resolveProjektView(p('tab=leistungsstand&filter=mine'), null, 7)
    expect(r.view).toEqual({ view: 'list', listTab: 'leistungsstaende', pendingTab: null })
    expect(r.canonical).toBe('tab=leistungsstaende')
  })

  it('ohne Parameter: Projektliste, URL bleibt', () => {
    expect(resolveProjektView(p(''), null, null)).toEqual({ view: { view: 'list', listTab: 'liste', pendingTab: null }, canonical: null })
  })

  it('Projekt und Tab aus der URL: Arbeitsbereich, URL bleibt', () => {
    const r = resolveProjektView(p('projectId=12&tab=buchungen'), null, null)
    expect(r.view).toEqual({ view: 'workspace', projectId: 12, tab: 'buchungen' })
    expect(r.canonical).toBeNull()
  })

  // Vorher landete ?projectId=12 ohne Tab auf der Liste.
  it('Projekt ohne Tab: Struktur, URL wird ergaenzt', () => {
    const r = resolveProjektView(p('projectId=12'), null, null)
    expect(r.view).toEqual({ view: 'workspace', projectId: 12, tab: 'struktur' })
    expect(r.canonical).toBe('projectId=12&tab=struktur')
  })

  it('Navigations-State wird in die URL uebersetzt', () => {
    const r = resolveProjektView(p(''), { tab: 'leistungsstand', projectId: 7 }, null)
    expect(r.view).toEqual({ view: 'workspace', projectId: 7, tab: 'leistungsstand' })
    expect(r.canonical).toBe('projectId=7&tab=leistungsstand')
  })

  it('State nur mit Projekt (Adressdetail): Struktur', () => {
    expect(resolveProjektView(p(''), { projectId: 3 }, null).view).toEqual({ view: 'workspace', projectId: 3, tab: 'struktur' })
  })

  // Benachrichtigung „Stunden buchen" verlinkt /projekte?tab=buchungen ohne Projekt.
  it('Tab ohne Projekt nimmt das zuletzt geoeffnete Projekt', () => {
    const r = resolveProjektView(p('tab=buchungen'), null, 4)
    expect(r.view).toEqual({ view: 'workspace', projectId: 4, tab: 'buchungen' })
    expect(r.canonical).toBe('projectId=4&tab=buchungen')
  })

  it('Tab ohne Projekt und ohne gemerktes Projekt: Liste mit Hinweis', () => {
    const r = resolveProjektView(p('tab=leistungsstand'), null, null)
    expect(r.view).toEqual({ view: 'list', listTab: 'liste', pendingTab: 'leistungsstand' })
  })

  it('Kalkulationen ohne Projekt bleiben auf Listenebene', () => {
    expect(resolveProjektView(p('tab=honorar'), null, 9).view).toEqual({ view: 'list', listTab: 'honorar', pendingTab: null })
  })

  it('unbekannter Tab faellt auf Struktur', () => {
    expect(resolveProjektView(p('projectId=5&tab=gibtsnicht'), null, null).view).toEqual({ view: 'workspace', projectId: 5, tab: 'struktur' })
  })

  it('ungueltige Projekt-ID wird ignoriert', () => {
    expect(resolveProjektView(p('projectId=abc'), null, null).view.view).toBe('list')
  })
})

describe('serializeProjektView', () => {
  it('schreibt projectId vor tab', () => {
    expect(serializeProjektView({ view: 'workspace', projectId: 1, tab: 'struktur' })).toBe('projectId=1&tab=struktur')
    expect(serializeProjektView({ view: 'list', listTab: 'liste', pendingTab: null })).toBe('')
  })
})
