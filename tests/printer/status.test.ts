import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PrinterNotRespondingError,
  decodeStatus,
  readStatus,
  type StatusIo,
} from '../../src/printer/status'

afterEach(() => vi.useRealTimers())

function fakeIo(replies: number[] | null) {
  const written: number[][] = []
  const listeners = new Set<(d: Uint8Array) => void>()
  let next = 0
  const io: StatusIo = {
    async write(data) {
      written.push([...data])
      if (replies) {
        const value = replies[next++]
        queueMicrotask(() => listeners.forEach((l) => l(Uint8Array.of(value))))
      }
    },
    onNotify(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
  return { io, written, listeners }
}

describe('decodeStatus', () => {
  it('reads the observed all-clear replies as ready', () => {
    expect(decodeStatus([0x16, 0x12, 0x12, 0x12])).toEqual({
      online: true,
      coverClosed: true,
      paperPresent: true,
      error: false,
      raw: [0x16, 0x12, 0x12, 0x12],
    })
  })

  it('detects an open cover', () => {
    expect(decodeStatus([0x16, 0x16, 0x12, 0x12]).coverClosed).toBe(false)
  })

  it('detects an offline printer', () => {
    expect(decodeStatus([0x1e, 0x12, 0x12, 0x12]).online).toBe(false)
  })

  it('detects paper end but not a near-end warning', () => {
    expect(decodeStatus([0x16, 0x12, 0x12, 0x72]).paperPresent).toBe(false)
    expect(decodeStatus([0x16, 0x12, 0x12, 0x1e]).paperPresent).toBe(true)
  })

  it('detects an error flag', () => {
    expect(decodeStatus([0x16, 0x12, 0x32, 0x12]).error).toBe(true)
  })
})

describe('readStatus', () => {
  it('queries DLE EOT 1 to 4 in order and decodes the replies', async () => {
    const { io, written } = fakeIo([0x16, 0x12, 0x12, 0x12])
    const status = await readStatus(io)
    expect(written).toEqual([
      [0x10, 0x04, 1],
      [0x10, 0x04, 2],
      [0x10, 0x04, 3],
      [0x10, 0x04, 4],
    ])
    expect(status.online && status.coverClosed && status.paperPresent && !status.error).toBe(true)
  })

  it('rejects with PrinterNotRespondingError when the printer is silent and unsubscribes', async () => {
    vi.useFakeTimers()
    const { io, listeners } = fakeIo(null)
    const run = readStatus(io, 1000)
    const assertion = expect(run).rejects.toBeInstanceOf(PrinterNotRespondingError)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(listeners.size).toBe(0)
  })

  it('ignores empty notifications while waiting for a reply', async () => {
    const listeners = new Set<(d: Uint8Array) => void>()
    const replies = [0x16, 0x12, 0x12, 0x12]
    let next = 0
    const io: StatusIo = {
      async write() {
        const value = replies[next++]
        queueMicrotask(() => {
          listeners.forEach((l) => l(new Uint8Array(0)))
          listeners.forEach((l) => l(Uint8Array.of(value)))
        })
      },
      onNotify(cb) {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    }
    expect((await readStatus(io)).raw).toEqual([0x16, 0x12, 0x12, 0x12])
  })

  it('propagates a write failure and unsubscribes', async () => {
    const listeners = new Set<(d: Uint8Array) => void>()
    const io: StatusIo = {
      async write() {
        throw new Error('not connected')
      },
      onNotify(cb) {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    }
    await expect(readStatus(io)).rejects.toThrow('not connected')
    expect(listeners.size).toBe(0)
  })
})
