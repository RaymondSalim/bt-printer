import { afterEach, describe, expect, it, vi } from 'vitest'
import { preflight, printImage, resyncPrinter, type PrintLink } from '../../src/app/print'
import type { RgbaImage } from '../../src/encode/raster'

afterEach(() => vi.useRealTimers())

const noSleep = async () => {}
const OK = [0x16, 0x12, 0x12, 0x12]
const blank = (width = 576, height = 2): RgbaImage => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
})

function fakeLink(replies: number[] | null, failWrite = false) {
  const writes: number[][] = []
  const listeners = new Set<(d: Uint8Array) => void>()
  let next = 0
  const link: PrintLink = {
    async write(data) {
      if (failWrite) throw new Error('not connected')
      writes.push([...data])
      const isStatus = data.length === 3 && data[0] === 0x10 && data[1] === 0x04
      if (isStatus && replies) {
        const value = replies[next++]
        queueMicrotask(() => listeners.forEach((l) => l(Uint8Array.of(value))))
      }
    },
    onNotify(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
  return { link, writes }
}

describe('preflight', () => {
  it('returns no warnings when everything is ready', async () => {
    expect(await preflight(fakeLink(OK).link)).toEqual([])
  })

  it('lists every problem in a fixed order', async () => {
    const warnings = await preflight(fakeLink([0x1e, 0x16, 0x32, 0x72]).link)
    expect(warnings).toEqual([
      'The printer reports it is offline.',
      'The printer cover is open.',
      'The printer reports it is out of paper.',
      'The printer reports an error.',
    ])
  })
})

describe('printImage', () => {
  it('prints without asking when there are no warnings', async () => {
    const { link, writes } = fakeLink(OK)
    const confirmWarnings = vi.fn(async () => true)
    const progress: Array<[number, number]> = []
    const outcome = await printImage(link, blank(), {
      confirmWarnings,
      sleep: noSleep,
      onProgress: (sent, total) => progress.push([sent, total]),
    })
    expect(outcome).toBe('printed')
    expect(confirmWarnings).not.toHaveBeenCalled()
    expect(writes.slice(0, 4).map((w) => w[2])).toEqual([1, 2, 3, 4])
    expect(writes[4]).toEqual([0x1b, 0x40])
    expect(writes.some((w) => w[0] === 0x1b && w[1] === 0x64)).toBe(false)
    const last = progress[progress.length - 1]
    expect(last[0]).toBe(last[1])
  })

  it('sends no print bytes when the user declines the warnings', async () => {
    const { link, writes } = fakeLink([0x16, 0x16, 0x12, 0x12])
    const confirmWarnings = vi.fn(async () => false)
    const outcome = await printImage(link, blank(), { confirmWarnings, sleep: noSleep })
    expect(outcome).toBe('cancelled')
    expect(confirmWarnings).toHaveBeenCalledTimes(1)
    expect(confirmWarnings).toHaveBeenCalledWith(['The printer cover is open.'])
    expect(writes).toHaveLength(4)
    expect(writes.every((w) => w[0] === 0x10 && w[1] === 0x04)).toBe(true)
  })

  it('prints when the user accepts the warnings', async () => {
    const { link, writes } = fakeLink([0x16, 0x16, 0x12, 0x12])
    const outcome = await printImage(link, blank(), {
      confirmWarnings: async () => true,
      sleep: noSleep,
    })
    expect(outcome).toBe('printed')
    expect(writes[4]).toEqual([0x1b, 0x40])
  })

  it('turns a silent printer into a warning instead of hanging', async () => {
    vi.useFakeTimers()
    const { link, writes } = fakeLink(null)
    const confirmWarnings = vi.fn(async () => false)
    const run = printImage(link, blank(), { confirmWarnings, sleep: noSleep })
    await vi.advanceTimersByTimeAsync(1500)
    await expect(run).resolves.toBe('cancelled')
    expect(confirmWarnings).toHaveBeenCalledWith(['The printer did not answer the status check.'])
    expect(writes).toHaveLength(1)
  })

  it('rejects an invalid image before touching the printer', async () => {
    const { link, writes } = fakeLink(OK)
    await expect(
      printImage(link, blank(100), { confirmWarnings: async () => true, sleep: noSleep }),
    ).rejects.toThrow(/576/)
    expect(writes).toHaveLength(0)
  })

  it('propagates a status failure that is not a timeout without asking', async () => {
    const { link } = fakeLink(OK, true)
    const confirmWarnings = vi.fn(async () => true)
    await expect(printImage(link, blank(), { confirmWarnings, sleep: noSleep })).rejects.toThrow(
      'not connected',
    )
    expect(confirmWarnings).not.toHaveBeenCalled()
  })

  it('honors the requested feed length', async () => {
    const { link, writes } = fakeLink(OK)
    await printImage(link, blank(), { confirmWarnings: async () => true, sleep: noSleep, feedLines: 9 })
    expect(writes[writes.length - 1]).toEqual([0x1b, 0x64, 9])
  })
})

describe('resyncPrinter', () => {
  it('finishes any half-received band with zero bytes and then resets the printer', async () => {
    const { link, writes } = fakeLink(null)
    await resyncPrinter(link, noSleep)
    const zeros = writes.slice(0, -1)
    expect(zeros.every((w) => w.length <= 237 && w.every((b) => b === 0))).toBe(true)
    expect(zeros.reduce((n, w) => n + w.length, 0)).toBeGreaterThanOrEqual(8 + 32 * 72)
    expect(writes[writes.length - 1]).toEqual([0x1b, 0x40])
  })
})

describe('printImage resync', () => {
  it('sends the resync before the status check when asked', async () => {
    const { link, writes } = fakeLink(OK)
    await printImage(link, blank(), {
      confirmWarnings: async () => true,
      sleep: noSleep,
      resyncFirst: true,
    })
    expect(writes[0].every((b) => b === 0)).toBe(true)
    const firstStatus = writes.findIndex((w) => w[0] === 0x10 && w[1] === 0x04)
    const lastResync = writes.findIndex((w) => w[0] === 0x1b && w[1] === 0x40)
    expect(lastResync).toBeGreaterThan(0)
    expect(lastResync).toBeLessThan(firstStatus)
  })

  it('does not resync by default', async () => {
    const { link, writes } = fakeLink(OK)
    await printImage(link, blank(), { confirmWarnings: async () => true, sleep: noSleep })
    expect(writes[0]).toEqual([0x10, 0x04, 1])
  })
})
