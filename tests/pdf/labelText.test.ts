import { describe, expect, it } from 'vitest'
import {
  findOrderNumber,
  itemTop,
  itemsInRect,
  productTableTop,
  type TextItem,
} from '../../src/pdf/labelText'

const PAGE_H = 595
const item = (str: string, x: number, baseline: number, height = 8): TextItem => ({
  str,
  transform: [1, 0, 0, 1, x, baseline],
  width: 10,
  height,
})

describe('itemTop', () => {
  it('converts the PDF baseline to a top edge in page space', () => {
    expect(itemTop(item('x', 0, 252, 7.5), PAGE_H)).toBe(335.5)
  })
})

describe('itemsInRect', () => {
  it('keeps only items whose origin lies inside the rectangle', () => {
    const left = item('left', 100, 300)
    const right = item('right', 600, 300)
    const rect = { x: 0, y: 0, width: 415, height: 595 }
    expect(itemsInRect([left, right], rect, PAGE_H)).toEqual([left])
  })
})

describe('findOrderNumber', () => {
  it('reads the number after "No. Pesanan:"', () => {
    expect(findOrderNumber([item('No. Pesanan: 260101TESTAA01', 9, 270)])).toBe('260101TESTAA01')
  })

  it('accepts the variant without a space after the dot', () => {
    expect(findOrderNumber([item('No.Pesanan: 260101TESTBB02', 12, 300)])).toBe('260101TESTBB02')
  })

  it('falls back to the "Pesan: (...)" line', () => {
    expect(findOrderNumber([item('Pesan: (260101TESTCC03)', 5, 215)])).toBe('260101TESTCC03')
  })

  it('prefers the labelled number over the fallback', () => {
    const items = [item('Pesan: (WRONG)', 5, 215), item('No. Pesanan: RIGHT123', 9, 270)]
    expect(findOrderNumber(items)).toBe('RIGHT123')
  })

  it('returns null when neither form is present', () => {
    expect(findOrderNumber([item('Berat: 500 gr', 9, 300)])).toBeNull()
  })
})

describe('productTableTop', () => {
  it('returns the top edge of the "Nama Produk" header', () => {
    expect(productTableTop([item('Nama Produk', 43, 252, 7.5)], PAGE_H)).toBe(335.5)
  })

  it('returns null when the header is absent', () => {
    expect(productTableTop([item('Berat', 9, 300)], PAGE_H)).toBeNull()
  })
})
