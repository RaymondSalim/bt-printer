import { describe, expect, it } from 'vitest'
import { drawLayout, type DrawContext } from '../../src/render/draw'
import type { Layout } from '../../src/render/layout'

function fakeCtx() {
  const calls: unknown[][] = []
  const ctx: DrawContext = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillText: (...args) => {
      calls.push(['fillText', ...args, ctx.font, ctx.textAlign])
    },
    fillRect: (...args) => {
      calls.push(['fillRect', ...args])
    },
  }
  return { ctx, calls }
}

const layoutOf = (items: Layout['items']): Layout => ({ width: 576, height: 100, items })

describe('drawLayout', () => {
  it('draws in black from the top of each text line', () => {
    const { ctx } = fakeCtx()
    drawLayout(ctx, layoutOf([]))
    expect(ctx.fillStyle).toBe('#000')
    expect(ctx.textBaseline).toBe('top')
  })

  it('draws text with its font, alignment and position', () => {
    const { ctx, calls } = fakeCtx()
    drawLayout(
      ctx,
      layoutOf([{ kind: 'text', text: 'Hi', x: 288, y: 8, size: 30, bold: true, align: 'center' }]),
    )
    expect(calls).toEqual([
      ['fillText', 'Hi', 288, 8, 'bold 30px Arial, Helvetica, sans-serif', 'center'],
    ])
  })

  it('draws rects as given', () => {
    const { ctx, calls } = fakeCtx()
    drawLayout(ctx, layoutOf([{ kind: 'rect', x: 12, y: 14, width: 552, height: 2 }]))
    expect(calls).toEqual([['fillRect', 12, 14, 552, 2]])
  })

  it('draws one square per dark QR module', () => {
    const { ctx, calls } = fakeCtx()
    drawLayout(
      ctx,
      layoutOf([
        {
          kind: 'modules',
          x: 10,
          y: 20,
          moduleSize: 3,
          matrix: [
            [true, false],
            [false, true],
          ],
        },
      ]),
    )
    expect(calls).toEqual([
      ['fillRect', 10, 20, 3, 3],
      ['fillRect', 13, 23, 3, 3],
    ])
  })

  it('merges adjacent barcode modules into one bar per run', () => {
    const { ctx, calls } = fakeCtx()
    drawLayout(
      ctx,
      layoutOf([{ kind: 'bars', x: 100, y: 5, moduleWidth: 2, height: 10, modules: '1101' }]),
    )
    expect(calls).toEqual([
      ['fillRect', 100, 5, 4, 10],
      ['fillRect', 106, 5, 2, 10],
    ])
  })
})
