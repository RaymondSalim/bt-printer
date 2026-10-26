import { describe, expect, it } from 'vitest'
import { fontString, wrapText } from '../../src/render/text'

const tenPerChar = (t: string) => Array.from(t).length * 10

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(wrapText('hello', 100, tenPerChar)).toEqual(['hello'])
  })

  it('wraps at word boundaries', () => {
    expect(wrapText('hello world foo', 110, tenPerChar)).toEqual(['hello world', 'foo'])
  })

  it('collapses repeated spaces', () => {
    expect(wrapText('a   b', 100, tenPerChar)).toEqual(['a b'])
  })

  it('breaks a word longer than the line by characters', () => {
    expect(wrapText('ABCDEFGHIJKLMNOP', 50, tenPerChar)).toEqual(['ABCDE', 'FGHIJ', 'KLMNO', 'P'])
  })

  it('moves a long word that follows shorter text onto its own lines', () => {
    expect(wrapText('ab ABCDEFGHIJ', 50, tenPerChar)).toEqual(['ab', 'ABCDE', 'FGHIJ'])
  })

  it('keeps explicit newlines and blank lines', () => {
    expect(wrapText('a\n\nb', 100, tenPerChar)).toEqual(['a', '', 'b'])
  })

  it('returns one empty line for empty text', () => {
    expect(wrapText('', 100, tenPerChar)).toEqual([''])
  })

  it('puts a glyph wider than the line on its own line instead of looping', () => {
    const wide = (t: string) => Array.from(t).length * 100
    expect(wrapText('abc', 50, wide)).toEqual(['a', 'b', 'c'])
  })

  it('does not split surrogate pairs', () => {
    expect(wrapText('😀😀😀', 20, tenPerChar)).toEqual(['😀😀', '😀'])
  })
})

describe('fontString', () => {
  it('builds a CSS font shorthand', () => {
    expect(fontString(24, false)).toBe('24px Arial, Helvetica, sans-serif')
    expect(fontString(30, true)).toBe('bold 30px Arial, Helvetica, sans-serif')
  })
})
