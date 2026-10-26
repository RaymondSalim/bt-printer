import { describe, expect, it } from 'vitest'
import {
  FormError,
  parseLabelForm,
  parseNumber,
  parseReceiptForm,
  type RawLabelForm,
  type RawReceiptForm,
} from '../../src/app/forms'

const rawReceipt: RawReceiptForm = {
  storeName: 'Toko Contoh',
  address: 'Jl. Contoh No. 1\n\nJakarta',
  dateTime: '12/10/2026',
  receiptNo: 'INV-001',
  cashier: '',
  items: [
    { name: 'Nasi Goreng', qty: '2', price: '15000' },
    { name: '', qty: '', price: '' },
    { name: 'Es Teh', qty: '1', price: '5000.5' },
  ],
  taxPercent: '10',
  discount: '',
  paid: '50000',
  footer: '',
}

const rawLabel: RawLabelForm = {
  courier: 'JNE REG',
  trackingNumber: 'JNE1234567890',
  orderId: 'ORD-77',
  weightGrams: '1250',
  note: '',
  includeQr: true,
  recipient: { name: 'Budi', phone: '0812', address: 'Jl. Melati 5\nBandung' },
  sender: { name: 'Toko Contoh', phone: '', address: 'Jakarta' },
}

describe('parseNumber', () => {
  it('accepts plain integers and decimals with surrounding spaces', () => {
    expect(parseNumber('15000', 'x')).toBe(15000)
    expect(parseNumber(' 12.5 ', 'x')).toBe(12.5)
    expect(parseNumber('0', 'x')).toBe(0)
  })

  it('rejects numbers that look like thousands grouping as ambiguous', () => {
    expect(() => parseNumber('15.000', 'Price')).toThrow(FormError)
    expect(() => parseNumber('15.000', 'Price')).toThrow(/ambiguous/)
    expect(() => parseNumber('1.234.567', 'Price')).toThrow(/ambiguous/)
  })

  it('rejects commas, signs, letters and empty text', () => {
    for (const bad of ['15,000', '-5', 'abc', '', '1e3', '12.']) {
      expect(() => parseNumber(bad, 'Price')).toThrow(/not a valid number/)
    }
  })

  it('names the field in the message', () => {
    expect(() => parseNumber('x', 'Item 2 price')).toThrow(/Item 2 price/)
  })
})

describe('parseReceiptForm', () => {
  it('parses numbers, skips fully blank item rows and defaults blanks', () => {
    const data = parseReceiptForm(rawReceipt)
    expect(data.items).toEqual([
      { name: 'Nasi Goreng', qty: 2, unitPrice: 15000 },
      { name: 'Es Teh', qty: 1, unitPrice: 5000.5 },
    ])
    expect(data.taxPercent).toBe(10)
    expect(data.discount).toBe(0)
    expect(data.paid).toBe(50000)
    expect(data.addressLines).toEqual(['Jl. Contoh No. 1', '', 'Jakarta'])
  })

  it('treats blank tax as zero and blank paid as no payment', () => {
    const data = parseReceiptForm({ ...rawReceipt, taxPercent: '', paid: '' })
    expect(data.taxPercent).toBe(0)
    expect(data.paid).toBeUndefined()
  })

  it('reports a partially filled item row by its position', () => {
    const items = [{ name: 'Soto', qty: '', price: '1000' }]
    expect(() => parseReceiptForm({ ...rawReceipt, items })).toThrow(/Item 1 quantity/)
  })

  it('requires a name when only numbers are filled in', () => {
    const items = [{ name: '', qty: '1', price: '1000' }]
    expect(() => parseReceiptForm({ ...rawReceipt, items })).toThrow(/Item 1: name is required/)
  })

  it('rejects an ambiguous price', () => {
    const items = [{ name: 'Soto', qty: '1', price: '15.000' }]
    expect(() => parseReceiptForm({ ...rawReceipt, items })).toThrow(/ambiguous/)
  })
})

describe('parseLabelForm', () => {
  it('maps fields and splits addresses into lines', () => {
    const data = parseLabelForm(rawLabel)
    expect(data).toMatchObject({
      courier: 'JNE REG',
      trackingNumber: 'JNE1234567890',
      orderId: 'ORD-77',
      weightGrams: 1250,
      includeQr: true,
    })
    expect(data.recipient).toEqual({ name: 'Budi', phone: '0812', addressLines: ['Jl. Melati 5', 'Bandung'] })
    expect(data.sender.addressLines).toEqual(['Jakarta'])
  })

  it('leaves weight undefined when blank and rejects a bad weight', () => {
    expect(parseLabelForm({ ...rawLabel, weightGrams: '' }).weightGrams).toBeUndefined()
    expect(() => parseLabelForm({ ...rawLabel, weightGrams: '1,5' })).toThrow(/Weight/)
  })

  it('passes includeQr through', () => {
    expect(parseLabelForm({ ...rawLabel, includeQr: false }).includeQr).toBe(false)
  })
})
