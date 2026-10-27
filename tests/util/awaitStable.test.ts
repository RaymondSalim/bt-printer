import { describe, expect, it } from 'vitest'
import { awaitStable } from '../../src/util/awaitStable'

describe('awaitStable', () => {
  it('returns once the promise it is given is the one that stays current', async () => {
    const done = Promise.resolve()
    let calls = 0
    await awaitStable(() => {
      calls++
      return done
    })
    expect(calls).toBeGreaterThanOrEqual(1)
  })

  it('keeps waiting when the current promise is replaced while it waits', async () => {
    let second = false
    const secondPromise = new Promise<void>((resolve) =>
      setTimeout(() => {
        second = true
        resolve()
      }, 40),
    )
    let current: Promise<void> = new Promise<void>((resolve) =>
      setTimeout(() => {
        current = secondPromise
        resolve()
      }, 10),
    )
    await awaitStable(() => current)
    expect(second).toBe(true)
  })
})
