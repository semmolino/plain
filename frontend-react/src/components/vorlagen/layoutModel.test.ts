import { describe, it, expect } from 'vitest'
import type { CategoryInfo } from '@/api/documentTemplates'
import { effectiveLayout, toOverride, moveEntry, updateEntry, addText, removeEntry, differs, chainOf, templateLevels } from './layoutModel'

const cat: CategoryInfo = {
  key: 'invoice_rechnung', label: 'Rechnung', parent: null, textType: 'invoice_rechnung',
  defaults: { hidden: [], payment: 'auto' },
  body: [
    { key: 'letterhead', label: 'Briefkopf', locked: true, fixed: true, modes: null },
    { key: 'reference', label: 'Bezugszeile', locked: false, fixed: false, modes: null },
    { key: 'title', label: 'Titel', locked: true, fixed: false, modes: null },
    { key: 'salutation', label: 'Anrede', locked: false, fixed: false, modes: null },
    { key: 'amounts', label: 'Beträge', locked: true, fixed: false, modes: null },
    { key: 'payment', label: 'Zahlungshinweis', locked: false, fixed: false, modes: ['auto', 'always', 'never'] },
  ],
  appendices: [],
}
const keys = (s: ReturnType<typeof effectiveLayout>) => s.entries.map(e => e.key)

describe('effectiveLayout', () => {
  it('ohne Ebenen: Registry', () => {
    expect(keys(effectiveLayout(cat, []))).toEqual(['letterhead', 'reference', 'title', 'salutation', 'amounts', 'payment'])
  })
  it('Ebenen wie am Server: Ungenanntes hinten, Briefkopf vorn, Pflicht nicht ausblendbar', () => {
    const s = effectiveLayout(cat, [{ order: ['amounts', 'letterhead'], hidden: ['amounts', 'salutation'] }])
    expect(keys(s)).toEqual(['letterhead', 'amounts', 'reference', 'title', 'salutation', 'payment'])
    expect(s.entries.find(e => e.key === 'amounts')!.hidden).toBe(false)
    expect(s.entries.find(e => e.key === 'salutation')!.hidden).toBe(true)
  })
  it('spätere Ebene ersetzt hidden; Texte und Zahlungshinweis gehen mit', () => {
    const s = effectiveLayout(cat, [
      { hidden: ['salutation'], payment: 'never' },
      { hidden: [], order: ['letterhead', 'text:ab12'], texts: { 'text:ab12': 'Hinweis' } },
    ])
    expect(s.entries.find(e => e.key === 'salutation')!.hidden).toBe(false)
    expect(s.payment).toBe('never')
    expect(s.entries[1]).toMatchObject({ key: 'text:ab12', kind: 'text', text: 'Hinweis' })
  })
  it('Kategorie-Standard (Mahnung: Anrede aus, Zahlungshinweis immer)', () => {
    const s = effectiveLayout({ ...cat, defaults: { hidden: ['salutation'], payment: 'always' } }, [])
    expect(s.entries.find(e => e.key === 'salutation')!.hidden).toBe(true)
    expect(s.payment).toBe('always')
  })
})

describe('Bearbeiten', () => {
  const base = effectiveLayout(cat, [])
  it('verschieben, nie vor den Briefkopf', () => {
    expect(keys(moveEntry(base, 4, 1))).toEqual(['letterhead', 'amounts', 'reference', 'title', 'salutation', 'payment'])
    expect(moveEntry(base, 2, 0)).toBe(base)
    expect(moveEntry(base, 0, 3)).toBe(base)
  })
  it('Pflichtbaustein bleibt sichtbar, Briefkopf ohne Seitenumbruch', () => {
    expect(updateEntry(base, 'amounts', { hidden: true }).entries.find(e => e.key === 'amounts')!.hidden).toBe(false)
    expect(updateEntry(base, 'letterhead', { pageBreak: true }).entries[0].pageBreak).toBe(false)
  })
  it('Textblock einfügen, bearbeiten, entfernen — nur Textblöcke lassen sich entfernen', () => {
    const { state, key } = addText(base, 'Neu', 'title')
    expect(state.entries[3]).toMatchObject({ key, kind: 'text', text: 'Neu' })
    expect(removeEntry(state, key).entries).toHaveLength(base.entries.length)
    expect(removeEntry(base, 'reference').entries).toHaveLength(base.entries.length)
  })
  it('toOverride überlebt die Rundreise', () => {
    const { state } = addText(updateEntry(base, 'salutation', { hidden: true, pageBreak: true }), 'X')
    const o = toOverride(state)
    expect(o.hidden).toEqual(['salutation'])
    expect(o.pageBreaks).toEqual(['salutation'])
    expect(keys(effectiveLayout(cat, [o]))).toEqual(keys(state))
    expect(differs(state, base)).toBe(true)
    expect(differs(base, effectiveLayout(cat, []))).toBe(false)
  })
  it('mit base nur die Abweichung — darunter Geändertes kommt weiter an', () => {
    const own = toOverride(updateEntry(base, 'salutation', { hidden: true }), base)
    expect(own).toEqual({ hidden: ['salutation'] })
    // Firmenvorlage ändert später die Reihenfolge: die Ebene erbt sie
    const later = effectiveLayout(cat, [{ order: ['letterhead', 'title', 'reference'] }, own])
    expect(keys(later).slice(0, 3)).toEqual(['letterhead', 'title', 'reference'])
    expect(later.entries.find(e => e.key === 'salutation')!.hidden).toBe(true)
  })
})

describe('Vererbung der Firmenvorlage', () => {
  const korrektur: CategoryInfo = { ...cat, key: 'invoice_korrektur', parent: 'invoice_rechnung', defaults: { hidden: [], payment: 'never' } }
  const teil: CategoryInfo = { ...cat, key: 'invoice_teilschluss', parent: 'invoice_schluss' }
  const schluss: CategoryInfo = { ...cat, key: 'invoice_schluss' }
  const all = [cat, korrektur, teil, schluss]
  it('Kette eigene zuerst', () => {
    expect(chainOf(all, 'invoice_teilschluss').map(c => c.key)).toEqual(['invoice_teilschluss', 'invoice_schluss'])
  })
  it('Korrektur erbt den Aufbau der Rechnung, nicht deren Zahlungshinweis', () => {
    const body = { invoice_rechnung: { hidden: ['reference'], payment: 'always' as const } }
    const s = effectiveLayout(korrektur, templateLevels(all, 'invoice_korrektur', body))
    expect(s.entries.find(e => e.key === 'reference')!.hidden).toBe(true)
    expect(s.payment).toBe('never')
  })
  it('ohne eigene Ebene: nur die Vorfahren', () => {
    const body = { invoice_schluss: { hidden: ['reference'] }, invoice_teilschluss: { hidden: [] } }
    expect(templateLevels(all, 'invoice_teilschluss', body, false)).toEqual([{ hidden: ['reference'] }])
    expect(templateLevels(all, 'invoice_teilschluss', body)).toHaveLength(2)
  })
})
