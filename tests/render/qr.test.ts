import { describe, expect, it } from 'vitest'
import { qrMatrix } from '../../src/render/qr'

describe('qrMatrix', () => {
  it('returns a square matrix, 21 modules for a short string', () => {
    const m = qrMatrix('hello')
    expect(m).toHaveLength(21)
    expect(m.every((row) => row.length === 21)).toBe(true)
  })

  it('starts with a finder pattern: seven dark modules, then a light separator', () => {
    const row0 = qrMatrix('hello')[0]
    expect(row0.slice(0, 7).every(Boolean)).toBe(true)
    expect(row0[7]).toBe(false)
  })

  it('grows for longer data', () => {
    expect(qrMatrix('x'.repeat(100)).length).toBeGreaterThan(21)
  })

  it('rejects empty data', () => {
    expect(() => qrMatrix('')).toThrow(/empty/i)
  })
})
