import { describe, expect, it } from 'vitest'
import { presetContact, presetNote } from './useContactPreset'

const c = (ID: number, IS_PRIMARY?: number) => ({ ID, FIRST_NAME: 'A', LAST_NAME: `N${ID}`, IS_PRIMARY })

describe('presetContact', () => {
  it('nimmt den Hauptansprechpartner, egal an welcher Stelle', () => {
    expect(presetContact([c(1, 0), c(2, 1), c(3)])).toEqual({ id: 2, primary: true })
  })
  it('nimmt den einzigen Kontakt, auch ohne Kennzeichen', () => {
    expect(presetContact([c(7)])).toEqual({ id: 7, primary: false })
  })
  it('wählt bei mehreren ohne Hauptansprechpartner nichts', () => {
    expect(presetContact([c(1, 0), c(2, 0)])).toBeNull()
  })
  it('wählt ohne Kontakte nichts', () => {
    expect(presetContact([])).toBeNull()
  })
})

describe('presetNote', () => {
  it('erscheint nur, solange der vorbelegte Kontakt gewählt ist', () => {
    const p = { id: 2, primary: true }
    expect(presetNote(p, 2)).toMatch(/Hauptansprechpartner/)
    expect(presetNote(p, '2')).toMatch(/Hauptansprechpartner/)
    expect(presetNote(p, 3)).toBeNull()
    expect(presetNote(p, null)).toBeNull()
    expect(presetNote(null, 2)).toBeNull()
    expect(presetNote({ id: 7, primary: false }, 7)).toMatch(/einziger Kontakt/)
  })
})
