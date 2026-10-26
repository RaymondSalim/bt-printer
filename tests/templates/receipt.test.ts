import { describe, expect, it } from 'vitest'
import type { Block } from '../../src/render/types'
import { buildReceipt, receiptTotals, type ReceiptData } from '../../src/templates/receipt'

const norm = (s: string) => s.replace(/\u00a0/g, ' ')
const rows = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.type === 'columns' ? [[norm(b.left), norm(b.right)]] : []))

const base: ReceiptData = {
  storeName: 'Toko Contoh',
  addressLines: ['Jl. Contoh No. 1', 'Jakarta'],
  dateTime: '12/10/2026 21:30',
  receiptNo: 'INV-001',
  cashier: 'Rani',
  items: [
    { name: 'Nasi Goreng', qty: 2, unitPrice: 15000 },
    { name: 'Es Teh', qty: 1, unitPrice: 5000 },
  ],
  taxPercent: 10,
  discount: 0,
  paid: 50000,
  footer: 'Terima kasih',
}

describe('receiptTotals', () => {
  it('adds up lines, tax, total and change', () => {
    expect(receiptTotals(base)).toEqual({
      subtotal: 35000,
      discount: 0,
      tax: 3500,
      total: 38500,
      paid: 50000,
      change: 11500,
    })
  })

  it('applies tax after the discount', () => {
    const t = receiptTotals({ ...base, discount: 5000 })
    expect(t).toMatchObject({ subtotal: 35000, discount: 5000, tax: 3000, total: 33000 })
  })

  it('rounds rupiah tax to whole rupiah so the total stays consistent', () => {
    const t = receiptTotals({
      ...base,
      items: [{ name: 'x', qty: 1, unitPrice: 3333 }],
      paid: undefined,
    })
    expect(t).toMatchObject({ subtotal: 3333, tax: 333, total: 3666 })
  })

  it('does not accumulate float error in fractional currencies', () => {
    const t = receiptTotals({
      ...base,
      currency: 'USD',
      items: [{ name: 'x', qty: 3, unitPrice: 0.1 }],
      taxPercent: 0,
      paid: undefined,
    })
    expect(t.subtotal).toBe(0.3)
    expect(t.total).toBe(0.3)
  })

  it('reports a negative change when paid is less than the total', () => {
    expect(receiptTotals({ ...base, paid: 20000 }).change).toBe(-18500)
  })

  it('has no paid or change when paid is omitted', () => {
    const t = receiptTotals({ ...base, paid: undefined })
    expect(t.paid).toBeUndefined()
    expect(t.change).toBeUndefined()
  })

  it.each([
    ['no items', { items: [] }, /at least one item/],
    ['blank item name', { items: [{ name: ' ', qty: 1, unitPrice: 1 }] }, /Item 1.*name/],
    ['zero quantity', { items: [{ name: 'a', qty: 0, unitPrice: 1 }] }, /Item 1.*quantity/],
    ['NaN price', { items: [{ name: 'a', qty: 1, unitPrice: NaN }] }, /Item 1.*price/],
    ['negative price', { items: [{ name: 'a', qty: 1, unitPrice: -1 }] }, /Item 1.*price/],
    ['tax above 100', { taxPercent: 101 }, /tax/i],
    ['negative tax', { taxPercent: -1 }, /tax/i],
    ['negative discount', { discount: -1 }, /discount/i],
    ['discount above subtotal', { discount: 35001 }, /discount/i],
    ['negative paid', { paid: -1 }, /paid/i],
  ])('rejects %s', (_label, patch, message) => {
    expect(() => receiptTotals({ ...base, ...patch })).toThrow(message)
  })
})

describe('buildReceipt', () => {
  it('starts with the store name in large bold centered text', () => {
    expect(buildReceipt(base).blocks[0]).toEqual({
      type: 'text',
      text: 'Toko Contoh',
      size: 34,
      bold: true,
      align: 'center',
    })
  })

  it('lists items, totals, payment and change as two-column rows', () => {
    expect(rows(buildReceipt(base).blocks)).toEqual([
      ['Date', '12/10/2026 21:30'],
      ['No', 'INV-001'],
      ['Cashier', 'Rani'],
      ['2 x Rp 15.000', 'Rp 30.000'],
      ['1 x Rp 5.000', 'Rp 5.000'],
      ['Subtotal', 'Rp 35.000'],
      ['Tax 10%', 'Rp 3.500'],
      ['TOTAL', 'Rp 38.500'],
      ['Paid', 'Rp 50.000'],
      ['Change', 'Rp 11.500'],
    ])
  })

  it('shows a discount row only when there is a discount', () => {
    expect(rows(buildReceipt(base).blocks).some(([l]) => l === 'Discount')).toBe(false)
    expect(rows(buildReceipt({ ...base, discount: 5000 }).blocks)).toContainEqual([
      'Discount',
      '-Rp 5.000',
    ])
  })

  it('labels a shortfall as a balance due', () => {
    const r = rows(buildReceipt({ ...base, paid: 20000 }).blocks)
    expect(r).toContainEqual(['Balance due', 'Rp 18.500'])
    expect(r.some(([l]) => l === 'Change')).toBe(false)
  })

  it('omits payment rows and tax rows when not applicable', () => {
    const r = rows(buildReceipt({ ...base, paid: undefined, taxPercent: 0 }).blocks)
    expect(r.map(([l]) => l)).not.toContain('Paid')
    expect(r.map(([l]) => l)).not.toContain('Change')
    expect(r.some(([l]) => l.startsWith('Tax'))).toBe(false)
  })

  it('omits date, number and cashier rows when blank', () => {
    const r = rows(
      buildReceipt({ ...base, dateTime: undefined, receiptNo: ' ', cashier: '' }).blocks,
    )
    expect(r.map(([l]) => l)).not.toContain('Date')
    expect(r.map(([l]) => l)).not.toContain('No')
    expect(r.map(([l]) => l)).not.toContain('Cashier')
  })

  it('drops blank address lines', () => {
    const blocks = buildReceipt({ ...base, addressLines: ['', '  ', 'Jakarta'] }).blocks
    const address = blocks.filter((b) => b.type === 'text' && b.size === 22)
    expect(address).toHaveLength(1)
  })

  it('ends with the footer and a tear-off spacer', () => {
    const blocks = buildReceipt(base).blocks
    expect(blocks[blocks.length - 2]).toMatchObject({ type: 'text', text: 'Terima kasih' })
    expect(blocks[blocks.length - 1]).toEqual({ type: 'spacer', height: 24 })
  })
})
