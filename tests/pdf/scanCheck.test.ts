import { describe, expect, it } from 'vitest'
import { compareScan, readCodes, scanCheck } from '../../src/pdf/scanCheck'
import { layoutDocument } from '../../src/render/layout'
import { rasterize } from '../helpers/rasterize'

const measure = (text: string, size: number) => text.length * size * 0.5

describe('compareScan', () => {
  it('lists expected codes that were not found', () => {
    expect(compareScan(['A', 'B'], ['B'])).toEqual({ found: ['B'], missing: ['A'] })
  })

  it('collapses duplicate decodes and reports nothing missing when all are found', () => {
    expect(compareScan(['A'], ['A', 'A'])).toEqual({ found: ['A'], missing: [] })
  })

  it('reports everything missing when nothing was decoded', () => {
    expect(compareScan(['A', 'B'], [])).toEqual({ found: [], missing: ['A', 'B'] })
  })
})

describe('readCodes and scanCheck', () => {
  const layout = layoutDocument(
    {
      blocks: [
        { type: 'barcode', data: '260101TESTAA01' },
        { type: 'qr', data: 'SPXID000000000001' },
      ],
    },
    measure,
  )

  it('reads back a Code 128 barcode and a QR code drawn by the layout engine', async () => {
    const result = await scanCheck(rasterize(layout), ['260101TESTAA01', 'SPXID000000000001'])
    expect(result.missing).toEqual([])
    expect(result.found.sort()).toEqual(['260101TESTAA01', 'SPXID000000000001'])
  })

  it('reads the same codes in reference mode', async () => {
    expect((await readCodes(rasterize(layout), 'reference')).sort()).toEqual([
      '260101TESTAA01',
      'SPXID000000000001',
    ])
  })

  it('reports an expected code that is not in the image', async () => {
    const result = await scanCheck(rasterize(layout), ['260101TESTAA01', 'NOT-THERE'])
    expect(result.missing).toEqual(['NOT-THERE'])
  })

  it('finds nothing in a blank image', async () => {
    const blank = layoutDocument({ blocks: [{ type: 'spacer', height: 100 }] }, measure)
    expect(await scanCheck(rasterize(blank), ['ABC12345'])).toEqual({
      found: [],
      missing: ['ABC12345'],
    })
  })
})
