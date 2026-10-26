import { describe, expect, it } from 'vitest'
import { layoutDocument } from '../../src/render/layout'
import type { DocumentModel } from '../../src/render/types'

// 12 dots per character at size 24, which gives 46 characters per 552-dot line.
const measure = (text: string, size: number) => Array.from(text).length * size * 0.5

const layout = (doc: DocumentModel) => layoutDocument(doc, measure)

describe('layoutDocument', () => {
  it('gives an empty document the two vertical margins as its height', () => {
    expect(layout({ blocks: [] })).toEqual({ width: 576, height: 16, items: [] })
  })

  it('places a default text block at the margins', () => {
    const result = layout({ blocks: [{ type: 'text', text: 'Hello' }] })
    expect(result.items).toEqual([
      { kind: 'text', text: 'Hello', x: 12, y: 8, size: 24, bold: false, align: 'left' },
    ])
    expect(result.height).toBe(46)
  })

  it('anchors center and right text at the page center and right margin', () => {
    const result = layout({
      blocks: [
        { type: 'text', text: 'c', align: 'center' },
        { type: 'text', text: 'r', align: 'right' },
      ],
    })
    expect(result.items.map((i) => (i.kind === 'text' ? [i.x, i.y] : null))).toEqual([
      [288, 8],
      [564, 38],
    ])
  })

  it('passes size and bold through and rounds the line height up', () => {
    const result = layout({ blocks: [{ type: 'text', text: 'Big', size: 25, bold: true }] })
    expect(result.items[0]).toMatchObject({ size: 25, bold: true })
    expect(result.height).toBe(8 + 32 + 8)
  })

  it('wraps a long unbroken word by characters', () => {
    const result = layout({ blocks: [{ type: 'text', text: 'a'.repeat(60) }] })
    const lines = result.items.map((i) => (i.kind === 'text' ? [i.text.length, i.y] : null))
    expect(lines).toEqual([
      [46, 8],
      [14, 38],
    ])
    expect(result.height).toBe(76)
  })

  it('advances for a blank line without emitting an item', () => {
    const result = layout({ blocks: [{ type: 'text', text: 'a\n\nb' }] })
    expect(result.items.map((i) => (i.kind === 'text' ? i.y : null))).toEqual([8, 68])
    expect(result.height).toBe(106)
  })

  it('puts the right column at the right margin on the first line', () => {
    const result = layout({ blocks: [{ type: 'columns', left: 'Nasi Goreng', right: 'Rp 15.000' }] })
    expect(result.items).toEqual([
      { kind: 'text', text: 'Nasi Goreng', x: 12, y: 8, size: 24, bold: false, align: 'left' },
      { kind: 'text', text: 'Rp 15.000', x: 564, y: 8, size: 24, bold: false, align: 'right' },
    ])
    expect(result.height).toBe(46)
  })

  it('wraps the left column around the right column', () => {
    const result = layout({ blocks: [{ type: 'columns', left: 'a'.repeat(100), right: '9' }] })
    const left = result.items.filter((i) => i.kind === 'text' && i.align === 'left')
    expect(left.map((i) => (i.kind === 'text' ? [i.text.length, i.y] : null))).toEqual([
      [44, 8],
      [44, 38],
      [12, 68],
    ])
    const right = result.items.filter((i) => i.kind === 'text' && i.align === 'right')
    expect(right).toHaveLength(1)
    expect(result.height).toBe(106)
  })

  it('draws a rule with padding on both sides', () => {
    const result = layout({ blocks: [{ type: 'rule' }] })
    expect(result.items).toEqual([{ kind: 'rect', x: 12, y: 14, width: 552, height: 2 }])
    expect(result.height).toBe(30)
  })

  it('honors a custom rule thickness', () => {
    const result = layout({ blocks: [{ type: 'rule', thickness: 4 }] })
    expect(result.items[0]).toMatchObject({ kind: 'rect', height: 4 })
  })

  it('adds spacer height and rejects a negative spacer', () => {
    expect(layout({ blocks: [{ type: 'spacer', height: 20 }] }).height).toBe(36)
    expect(() => layout({ blocks: [{ type: 'spacer', height: -1 }] })).toThrow(/spacer/)
  })

  it('honors custom margins', () => {
    const result = layout({ blocks: [{ type: 'text', text: 'x' }], marginX: 20, marginY: 10 })
    expect(result.items[0]).toMatchObject({ x: 20, y: 10 })
    expect(result.height).toBe(10 + 30 + 10)
  })
})
