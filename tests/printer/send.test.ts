import { describe, expect, it } from 'vitest'
import { PrintInterruptedError, SEND_DEFAULTS, sendBytes, type ByteSink } from '../../src/printer/send'

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
  it('pins the hardware-verified pacing: 237-byte chunks, 10 ms apart, 90 ms after each band', () => {
    expect(SEND_DEFAULTS).toEqual({ chunkSize: 237, delayMs: 10, partPauseMs: 90 })
  })

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

  it('finishes the part in flight when aborted, then stops at the part boundary', async () => {
    const { sink, writes } = recordingSink()
    const controller = new AbortController()
    const run = sendBytes(sink, [bytes(450), bytes(450)], {
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
      bytesSent: 450,
      totalBytes: 900,
    })
    expect(writes.map((w) => w.length)).toEqual([200, 200, 50])
  })

  it('does not start any part when already aborted', async () => {
    const { sink, writes } = recordingSink()
    const controller = new AbortController()
    controller.abort()
    await expect(
      sendBytes(sink, [bytes(100)], { sleep: noSleep, signal: controller.signal }),
    ).rejects.toMatchObject({ reason: 'aborted', bytesSent: 0, totalBytes: 100 })
    expect(writes).toHaveLength(0)
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

describe('sendBytes when the browser throttles Bluetooth requests', () => {
  const rateLimit = () =>
    Object.assign(new Error('Rate limit exceeded: too many BLE requests'), { name: 'SecurityError' })

  function throttledSink(failures: number) {
    const writes: Uint8Array[] = []
    let remaining = failures
    const sink: ByteSink = {
      async write(data) {
        if (remaining > 0) {
          remaining--
          throw rateLimit()
        }
        writes.push(data)
      },
    }
    return { sink, writes }
  }

  it('waits and retries the same chunk, writing every byte exactly once and in order', async () => {
    const { sink, writes } = throttledSink(2)
    const waits: number[] = []
    await sendBytes(sink, [bytes(450, 3)], {
      chunkSize: 200,
      delayMs: 0,
      sleep: async (ms) => {
        waits.push(ms)
      },
      onRateLimited: (ms) => waits.push(-ms),
    })
    expect(writes.map((w) => w.length)).toEqual([200, 200, 50])
    expect(writes.every((w) => w.every((b) => b === 3))).toBe(true)
    expect(waits.filter((w) => w < 0)).toEqual([-500, -1000])
  })

  it('spaces the remaining writes further apart after being throttled', async () => {
    const { sink } = throttledSink(1)
    const delays: number[] = []
    await sendBytes(sink, [bytes(600)], {
      chunkSize: 200,
      delayMs: 10,
      sleep: async (ms) => {
        delays.push(ms)
      },
    })
    expect(delays).toEqual([500, 50, 50])
  })

  it('gives up with a write-failed error once the backoff is used up', async () => {
    const { sink, writes } = throttledSink(Infinity)
    const err = await sendBytes(sink, [bytes(400)], { chunkSize: 200, sleep: noSleep }).catch((e) => e)
    expect(err).toBeInstanceOf(PrintInterruptedError)
    expect(err).toMatchObject({ reason: 'write-failed', bytesSent: 0, totalBytes: 400 })
    expect((err.cause as Error).name).toBe('SecurityError')
    expect(writes).toHaveLength(0)
  })

  it('still fails at once on an error that is not a rate limit', async () => {
    const { sink } = recordingSink(1)
    const waits: number[] = []
    await expect(
      sendBytes(sink, [bytes(400)], {
        chunkSize: 200,
        sleep: noSleep,
        onRateLimited: (ms) => waits.push(ms),
      }),
    ).rejects.toMatchObject({ reason: 'write-failed' })
    expect(waits).toEqual([])
  })
})
