import { describe, expect, it } from 'vitest'
import { orderStripDocument } from '../../src/pdf/orderStrip'

describe('orderStripDocument', () => {
  it('builds a centred barcode plus caption for a normal order number', () => {
    expect(orderStripDocument('260101TESTAA01')).toEqual({
      marginY: 4,
      blocks: [
        { type: 'barcode', data: '260101TESTAA01', height: 64, align: 'center' },
        { type: 'text', text: 'Pesanan 260101TESTAA01', size: 22, align: 'center' },
      ],
    })
  })

  it('accepts the longest order number that fits at two dots per bar', () => {
    expect(orderStripDocument('A'.repeat(20))).not.toBeNull()
  })

  it('returns null when the order number is too long to draw at two dots per bar', () => {
    expect(orderStripDocument('A'.repeat(21))).toBeNull()
  })

  it('returns null for a missing or empty order number', () => {
    expect(orderStripDocument(null)).toBeNull()
    expect(orderStripDocument('')).toBeNull()
  })

  it('returns null when the order number is not printable ASCII', () => {
    expect(orderStripDocument('PESANAN-É')).toBeNull()
  })
})
