import { describe, it, expect } from 'vitest'
import { parseAmount } from './amount'

describe('parseAmount', () => {
  it('liest deutsche Schreibweise', () => {
    expect(parseAmount('1.284.006,90')).toBe(1284006.9)
    expect(parseAmount('80250,43')).toBe(80250.43)
  })
  it('liest Maschinenform', () => {
    expect(parseAmount('80250.43')).toBe(80250.43)
    expect(parseAmount('295000')).toBe(295000)
  })
  it('leer und unlesbar ergibt null', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('  ')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })
})
