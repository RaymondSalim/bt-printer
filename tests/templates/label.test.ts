import { describe, expect, it } from 'vitest'
import type { Block } from '../../src/render/types'
import { buildLabel, type LabelData } from '../../src/templates/label'

const base: LabelData = {
  courier: 'JNE REG',
  trackingNumber: 'JNE1234567890',
  orderId: 'ORD-77',
  weightGrams: 1250,
  note: 'Fragile',
  includeQr: true,
  recipient: {
    name: 'Budi Santoso',
    phone: '0812-0000-1111',
    addressLines: ['Jl. Melati 5 RT 02/03', 'Bandung 40111'],
  },
  sender: {
    name: 'Toko Contoh',
    phone: '021-555-0100',
    addressLines: ['Jl. Contoh No. 1', 'Jakarta 10110'],
  },
}

const types = (blocks: Block[]) => blocks.map((b) => b.type)
const columns = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.type === 'columns' ? [[b.left, b.right]] : []))

describe('buildLabel', () => {
  it('puts the courier title first, then the tracking barcode and number', () => {
    const blocks = buildLabel(base).blocks
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'JNE REG', bold: true, align: 'center' })
    expect(blocks[1]).toEqual({
      type: 'barcode',
      data: 'JNE1234567890',
      height: 90,
      align: 'center',
    })
    expect(blocks[2]).toMatchObject({ type: 'text', text: 'JNE1234567890', bold: true })
  })

  it('starts with the barcode when there is no courier', () => {
    expect(buildLabel({ ...base, courier: undefined }).blocks[0].type).toBe('barcode')
  })

  it('shows the recipient prominently and the sender smaller', () => {
    const blocks = buildLabel(base).blocks
    const find = (text: string) =>
      blocks.find((b) => b.type === 'text' && b.text === text) as Extract<Block, { type: 'text' }>
    expect(find('Budi Santoso')).toMatchObject({ size: 34, bold: true })
    expect(find('Jl. Melati 5 RT 02/03')).toMatchObject({ size: 28 })
    expect(find('Toko Contoh')).toMatchObject({ size: 24, bold: true })
    expect(find('Jl. Contoh No. 1')).toMatchObject({ size: 22 })
  })

  it('shows order id and weight rows', () => {
    expect(columns(buildLabel(base).blocks)).toEqual([
      ['Order', 'ORD-77'],
      ['Weight', '1.25 kg'],
    ])
  })

  it('omits order, weight and phone rows when not given', () => {
    const blocks = buildLabel({
      ...base,
      orderId: undefined,
      weightGrams: undefined,
      recipient: { ...base.recipient, phone: ' ' },
    }).blocks
    expect(columns(blocks)).toEqual([])
    expect(blocks.some((b) => b.type === 'text' && b.text === '0812-0000-1111')).toBe(false)
  })

  it('adds a QR code of the tracking number by default and omits it when disabled', () => {
    const withQr = buildLabel({ ...base, includeQr: undefined }).blocks
    expect(withQr.find((b) => b.type === 'qr')).toEqual({
      type: 'qr',
      data: 'JNE1234567890',
      size: 160,
      align: 'center',
    })
    expect(types(buildLabel({ ...base, includeQr: false }).blocks)).not.toContain('qr')
  })

  it('includes the note when given and ends with a tear-off spacer', () => {
    const blocks = buildLabel(base).blocks
    expect(blocks.some((b) => b.type === 'text' && b.text === 'Fragile')).toBe(true)
    expect(blocks[blocks.length - 1]).toEqual({ type: 'spacer', height: 24 })
  })

  it('trims the tracking number', () => {
    expect(buildLabel({ ...base, trackingNumber: '  ABC123  ' }).blocks[1]).toMatchObject({
      data: 'ABC123',
    })
  })

  it.each([
    ['blank tracking number', { trackingNumber: '  ' }, /tracking/i],
    ['non-ASCII tracking number', { trackingNumber: 'ÄBC123' }, /tracking/i],
    ['tab in tracking number', { trackingNumber: 'AB\tC' }, /tracking/i],
    ['blank recipient name', { recipient: { name: ' ', addressLines: ['x'] } }, /recipient name/i],
    ['no recipient address', { recipient: { name: 'B', addressLines: ['', ' '] } }, /recipient address/i],
    ['blank sender name', { sender: { name: '', addressLines: [] } }, /sender name/i],
    ['zero weight', { weightGrams: 0 }, /weight/i],
    ['NaN weight', { weightGrams: NaN }, /weight/i],
  ])('rejects %s', (_label, patch, message) => {
    expect(() => buildLabel({ ...base, ...patch })).toThrow(message)
  })
})
