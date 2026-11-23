export interface ByteSink {
  write(data: Uint8Array): Promise<void>
}

// Measured on the Putian 802: faster pacing loses data on dense content because
// the printer drops bytes once its small input buffer is full. This pacing
// (with 32-row bands) printed 1200 rows of near-solid black intact.
export const SEND_DEFAULTS = { chunkSize: 237, delayMs: 10, partPauseMs: 90 }

export interface SendOptions {
  chunkSize?: number
  delayMs?: number
  partPauseMs?: number
  onProgress?: (sent: number, total: number) => void
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  onRateLimited?: (waitMs: number) => void
}

export class PrintInterruptedError extends Error {
  constructor(
    readonly reason: 'aborted' | 'write-failed',
    readonly bytesSent: number,
    readonly totalBytes: number,
    cause?: unknown,
  ) {
    super(
      `Print ${reason === 'aborted' ? 'aborted' : 'failed'} after ${bytesSent} of ${totalBytes} bytes`,
      { cause },
    )
    this.name = 'PrintInterruptedError'
  }
}

// Some browsers' Bluetooth layers (for example the iOS Safari extension Beacio) refuse writes
// once too many arrive in a short time. The refused write never reached the printer, so it is
// safe to wait and send the same chunk again.
const RATE_LIMIT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000]
const MIN_EXTRA_DELAY_MS = 40
const MAX_EXTRA_DELAY_MS = 320

export function isRateLimitError(err: unknown): boolean {
  const message = typeof err === 'object' && err !== null && 'message' in err ? String(err.message) : ''
  return /rate limit|too many (ble )?requests/i.test(message)
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface Step {
  chunk: Uint8Array
  startsPart: boolean
  endsPart: boolean
}

export async function sendBytes(
  sink: ByteSink,
  parts: Uint8Array[],
  opts: SendOptions = {},
): Promise<void> {
  const chunkSize = opts.chunkSize ?? SEND_DEFAULTS.chunkSize
  const delayMs = opts.delayMs ?? SEND_DEFAULTS.delayMs
  const partPauseMs = opts.partPauseMs ?? SEND_DEFAULTS.partPauseMs
  const sleep = opts.sleep ?? defaultSleep
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`)
  }

  const steps: Step[] = []
  for (const part of parts) {
    for (let offset = 0; offset < part.length; offset += chunkSize) {
      steps.push({
        chunk: part.slice(offset, offset + chunkSize),
        startsPart: offset === 0,
        endsPart: offset + chunkSize >= part.length,
      })
    }
  }
  const total = steps.reduce((sum, s) => sum + s.chunk.length, 0)

  let sent = 0
  // Grows each time the browser throttles us and stays for the rest of the job.
  let extraDelayMs = 0
  for (let i = 0; i < steps.length; i++) {
    // An abort is honored only between parts. Stopping inside a raster band would
    // leave the printer waiting for the rest of that command and swallow the next job.
    if (steps[i].startsPart && opts.signal?.aborted) {
      throw new PrintInterruptedError('aborted', sent, total, opts.signal.reason)
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await sink.write(steps[i].chunk)
        break
      } catch (cause) {
        if (!isRateLimitError(cause) || attempt >= RATE_LIMIT_BACKOFF_MS.length) {
          throw new PrintInterruptedError('write-failed', sent, total, cause)
        }
        const waitMs = RATE_LIMIT_BACKOFF_MS[attempt]
        extraDelayMs = Math.min(Math.max(extraDelayMs * 2, MIN_EXTRA_DELAY_MS), MAX_EXTRA_DELAY_MS)
        opts.onRateLimited?.(waitMs)
        await sleep(waitMs)
      }
    }
    sent += steps[i].chunk.length
    opts.onProgress?.(sent, total)

    if (i < steps.length - 1) {
      await sleep(delayMs + extraDelayMs)
      if (steps[i].endsPart && partPauseMs > 0) await sleep(partPauseMs)
    }
  }
}
