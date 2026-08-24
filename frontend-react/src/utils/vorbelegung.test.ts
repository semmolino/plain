import { describe, it, expect } from 'vitest'
import { addDaysIso, presetId, nextPersonnelNumber, salutationForGender } from './vorbelegung'

// Stammdaten wie sie im Produkt stehen.
const GENDERS = [
  { ID: 1, GENDER: 'männlich' },
  { ID: 2, GENDER: 'weiblich' },
  { ID: 3, GENDER: 'divers' },
]
const SALUTATIONS = [
  { ID: 1, SALUTATION: 'Sehr geehrter Herr' },
  { ID: 2, SALUTATION: 'Sehr geehrte Frau' },
  { ID: 3, SALUTATION: 'Sehr geehrte/r' },
]

describe('addDaysIso', () => {
  it('rechnet in Kalendertagen, nicht Werktagen', () => {
    // 2026-08-24 ist ein Montag — +14 landet auf dem Montag darauf.
    expect(addDaysIso('2026-08-24', 14)).toBe('2026-09-07')
  })

  it('läuft über Monats- und Jahresgrenzen', () => {
    expect(addDaysIso('2026-12-28', 14)).toBe('2027-01-11')
    expect(addDaysIso('2028-02-20', 10)).toBe('2028-03-01') // Schaltjahr
  })

  it('verschiebt das Datum nicht über die Zeitzone', () => {
    // Der frühere toISOString()-Weg lieferte hier östlich von Greenwich den Vortag.
    expect(addDaysIso('2026-08-24', 0)).toBe('2026-08-24')
  })

  it('liefert "" ohne verwertbares Datum', () => {
    expect(addDaysIso('', 14)).toBe('')
    expect(addDaysIso('kein Datum', 14)).toBe('')
  })
})

describe('presetId', () => {
  const list = [{ ID: 1 }, { ID: 2 }]

  it('nimmt die Vorbelegung, wenn es den Eintrag noch gibt', () => {
    expect(presetId(list, '2')).toBe('2')
  })

  it('verwirft eine Vorbelegung auf einen gelöschten Eintrag', () => {
    expect(presetId(list, '9')).toBe('')
  })

  it('kommt mit fehlender Vorbelegung klar', () => {
    expect(presetId(list, null)).toBe('')
    expect(presetId(list, undefined)).toBe('')
    expect(presetId(list, '')).toBe('')
  })
})

describe('nextPersonnelNumber', () => {
  it('zählt die höchste Nummer hoch', () => {
    expect(nextPersonnelNumber(['1', '7', '3'])).toBe('8')
  })

  it('behält Präfix und Nullauffüllung bei', () => {
    expect(nextPersonnelNumber(['MA-007', 'MA-003'])).toBe('MA-008')
    expect(nextPersonnelNumber(['0009'])).toBe('0010')
  })

  it('wächst über die Breite hinaus statt abzuschneiden', () => {
    expect(nextPersonnelNumber(['099'])).toBe('100')
  })

  it('beginnt bei 1, wenn keine Nummer verwertbar ist', () => {
    expect(nextPersonnelNumber([])).toBe('1')
    expect(nextPersonnelNumber([null, undefined, '', 'extern'])).toBe('1')
  })

  it('überspringt unlesbare Einträge statt aufzugeben', () => {
    expect(nextPersonnelNumber(['extern', '  12  ', null])).toBe('13')
  })
})

describe('salutationForGender', () => {
  it('ordnet männlich/weiblich der passenden Anrede zu', () => {
    expect(salutationForGender(1, GENDERS, SALUTATIONS)).toBe('1')
    expect(salutationForGender(2, GENDERS, SALUTATIONS)).toBe('2')
  })

  it('nimmt für divers die neutrale Anrede', () => {
    expect(salutationForGender(3, GENDERS, SALUTATIONS)).toBe('3')
  })

  it('liefert "" ohne Geschlecht oder ohne passende Anrede', () => {
    expect(salutationForGender('', GENDERS, SALUTATIONS)).toBe('')
    expect(salutationForGender(1, GENDERS, [{ ID: 2, SALUTATION: 'Sehr geehrte Frau' }])).toBe('')
  })
})
