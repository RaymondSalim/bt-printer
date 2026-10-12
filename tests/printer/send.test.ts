import { describe, expect, it } from 'vitest'
import { PrintInterruptedError, sendBytes, type ByteSink } from '../../src/printer/send'

function recordingSink(failOnWrite?: number) {
  const writes: Uint8Array[] = []
  const sink: ByteSink = {
    async write(data) {
      if (failOnWrite !== undefined && writes.length + 1 === failOnWrite) {
        throw new Error('gatt write failed')
      }
      writes.push(data)
    },
  }
  return { sink, writes }
}

const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill)
const noSleep = async () => {}

describe('sendBytes', () => {
  it('splits a part into chunks of at most chunkSize', async () => {
    const { sink, writes } = recordingSink()
    await sendBytes(sink, [bytes(450)], { chunkSize: 200, sleep: noSleep })
    expect(writes.map((w) => w.length)).toEqual([200, 200, 50])
  })

  it('does not emit an empty chunk when the part is an exact multiple of chunkSize', async () => {
    const { sink, writes } = recordingSink()
    await sendBytes(sink, [bytes(400)], { chunkSize: 200, sleep: noSleep })
    expect(writes.map((w) => w.length)).toEqual([200, 200])
  })

  it('never merges chunks across parts and keeps order', async () => {
    const { sink, writes } = recordingSink()
    await sendBytes(sink, [bytes(150, 1), bytes(150, 2)], { chunkSize: 200, sleep: noSleep })
    expect(writes.map((w) => [w.length, w[0]])).toEqual([[150, 1], [150, 2]])
  })

  it('writes nothing for an empty job', async () => {
    const { sink, writes } = recordingSink()
    await sendBytes(sink, [], { sleep: noSleep })
    expect(writes).toHaveLength(0)
  })

  it('reports cumulative progress after every write', async () => {
    const { sink } = recordingSink()
    const seen: Array<[number, number]> = []
    await sendBytes(sink, [bytes(450)], {
      chunkSize: 200,
      sleep: noSleep,
      onProgress: (sent, total) => seen.push([sent, total]),
    })
    expect(seen).toEqual([[200, 450], [400, 450], [450, 450]])
  })

  it('sleeps between writes but not after the last one', async () => {
    const { sink } = recordingSink()
    const delays: number[] = []
    await sendBytes(sink, [bytes(450)], {
      chunkSize: 200,
      delayMs: 30,
      sleep: async (ms) => {
        delays.push(ms)
      },
    })
    expect(delays).toEqual([30, 30])
  })

  it('adds partPauseMs after each part except the last', async () => {
    const { sink } = recordingSink()
    const delays: number[] = []
    await sendBytes(sink, [bytes(100), bytes(100), bytes(100)], {
      chunkSize: 200,
      delayMs: 0,
      partPauseMs: 50,
      sleep: async (ms) => {
        delays.push(ms)
      },
    })
    expect(delays.filter((d) => d === 50)).toHaveLength(2)
  })

  it('stops and reports bytes sent when aborted', async () => {
    const { sink, writes } = recordingSink()
    const controller = new AbortController()
    const run = sendBytes(sink, [bytes(600)], {
      chunkSize: 200,
      sleep: noSleep,
      signal: controller.signal,
      onProgress: (sent) => {
        if (sent === 200) controller.abort()
      },
    })
    await expect(run).rejects.toMatchObject({
      name: 'PrintInterruptedError',
      reason: 'aborted',
      bytesSent: 200,
      totalBytes: 600,
    })
    expect(writes).toHaveLength(1)
  })

  it('stops and reports bytes sent when a write fails', async () => {
    const { sink, writes } = recordingSink(2)
    const run = sendBytes(sink, [bytes(600)], { chunkSize: 200, sleep: noSleep })
    const err = await run.catch((e) => e)
    expect(err).toBeInstanceOf(PrintInterruptedError)
    expect(err).toMatchObject({ reason: 'write-failed', bytesSent: 200, totalBytes: 600 })
    expect((err.cause as Error).message).toBe('gatt write failed')
    expect(writes).toHaveLength(1)
  })

  it('rejects an invalid chunk size', async () => {
    const { sink } = recordingSink()
    await expect(sendBytes(sink, [bytes(10)], { chunkSize: 0 })).rejects.toThrow(RangeError)
  })

  it('hands the sink a copy so later changes to the source do not alter a pending write', async () => {
    const { sink, writes } = recordingSink()
    const part = bytes(10, 7)
    await sendBytes(sink, [part], { sleep: noSleep })
    part.fill(0)
    expect(writes[0][0]).toBe(7)
  })
})
