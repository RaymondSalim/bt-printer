import { describe, expect, it } from 'vitest'
import { CODE128_PATTERNS, code128Values, encodeCode128B } from '../../src/render/code128'

const START_B = '11010010000'
const STOP = '1100011101011'

describe('code128', () => {
  it('has 107 patterns with the stop pattern last', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    expect(CODE128_PATTERNS[104]).toBe(START_B)
    expect(CODE128_PATTERNS[106]).toBe(STOP)
  })

  it('computes the start code, data values and checksum', () => {
    expect(code128Values('A')).toEqual([104, 33, 34])
  })

  it('encodes a known string exactly', () => {
    expect(encodeCode128B('Hi 123')).toBe(
      '11010010000110001010001000011010011011001100100111001101100111001011001011100100011101101100011101011',
    )
  })

  it('starts with the Start B pattern, ends with the stop pattern, and has 11*(n+2)+13 modules', () => {
    const modules = encodeCode128B('TRACK123456')
    expect(modules.startsWith(START_B)).toBe(true)
    expect(modules.endsWith(STOP)).toBe(true)
    expect(modules).toHaveLength(11 * (11 + 2) + 13)
  })

  it('rejects empty text', () => {
    expect(() => encodeCode128B('')).toThrow(/empty/i)
  })

  it('rejects characters outside printable ASCII and names the position', () => {
    expect(() => encodeCode128B('ABÉ')).toThrow(/position 2/)
    expect(() => encodeCode128B('a\tb')).toThrow(/position 1/)
  })
})
