import { describe, it, expect } from 'vitest'
import { csvEscape } from './exportData'

describe('csvEscape', () => {
  it('Formelanfänge werden entschärft', () => {
    expect(csvEscape('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(csvEscape('+49 751 123')).toBe("'+49 751 123")
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvEscape('-1+1')).toBe("'-1+1")
  })
  it('Zahlen und normaler Text bleiben', () => {
    expect(csvEscape(-38900.5)).toBe('-38900.5')
    expect(csvEscape('Stadt Musterstadt')).toBe('Stadt Musterstadt')
    expect(csvEscape('a;b')).toBe('"a;b"')
    expect(csvEscape(null)).toBe('')
  })
})
