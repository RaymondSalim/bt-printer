import { describe, expect, it, vi } from 'vitest'
import { exclusive } from '../../src/util/exclusive'

function deferred() {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('exclusive', () => {
  it('ignores a call made while another is running and reports busy', async () => {
    const gate = deferred()
    const fn = vi.fn(() => gate.promise)
    const onBusy = vi.fn()
    const guarded = exclusive(fn, onBusy)

    const first = guarded()
    await guarded()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(onBusy).toHaveBeenCalledTimes(1)

    gate.resolve()
    await first
  })

  it('accepts a new call after the previous one finishes', async () => {
    const fn = vi.fn(async () => {})
    const guarded = exclusive(fn)
    await guarded()
    await guarded()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('releases the guard when the call rejects and passes the rejection through', async () => {
    const fn = vi.fn<() => Promise<void>>()
    fn.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined)
    const guarded = exclusive(fn)
    await expect(guarded()).rejects.toThrow('boom')
    await guarded()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('forwards arguments', async () => {
    const fn = vi.fn(async (_a: string, _b: number) => {})
    await exclusive(fn)('x', 2)
    expect(fn).toHaveBeenCalledWith('x', 2)
  })
})
