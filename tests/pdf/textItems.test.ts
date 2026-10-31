import { describe, expect, it } from 'vitest'
import { collectTextItems } from '../../src/pdf/textItems'

const item = (str: string) => ({ str, transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1 })

// Only getReader() exists, as on browsers whose streams cannot be iterated with for-await.
function readerOnly(chunks: Array<{ items: unknown[] }>) {
  let next = 0
  return {
    getReader: () => ({
      read: async () =>
        next < chunks.length
          ? { done: false as const, value: chunks[next++] }
          : { done: true as const, value: undefined },
    }),
  }
}

describe('collectTextItems', () => {
  it('collects items from every chunk in order', async () => {
    const stream = readerOnly([{ items: [item('a'), item('b')] }, { items: [item('c')] }])
    expect((await collectTextItems(stream)).map((i) => i.str)).toEqual(['a', 'b', 'c'])
  })

  it('skips marked-content entries that carry no text', async () => {
    const marker = { type: 'beginMarkedContent', id: 'x' }
    const stream = readerOnly([{ items: [item('a'), marker, item('b')] }])
    expect((await collectTextItems(stream)).map((i) => i.str)).toEqual(['a', 'b'])
  })

  it('returns an empty list for an empty stream', async () => {
    expect(await collectTextItems(readerOnly([]))).toEqual([])
  })

  it('reads a real ReadableStream too', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ items: [item('x')] })
        controller.enqueue({ items: [item('y')] })
        controller.close()
      },
    })
    expect((await collectTextItems(stream)).map((i) => i.str)).toEqual(['x', 'y'])
  })
})
