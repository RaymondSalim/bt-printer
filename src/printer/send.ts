export interface ByteSink {
  write(data: Uint8Array): Promise<void>
}

export const SEND_DEFAULTS = { chunkSize: 200, delayMs: 30, partPauseMs: 0 }

export interface SendOptions {
  chunkSize?: number
  delayMs?: number
  partPauseMs?: number
  onProgress?: (sent: number, total: number) => void
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
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

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface Step {
  chunk: Uint8Array
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
        endsPart: offset + chunkSize >= part.length,
      })
    }
  }
  const total = steps.reduce((sum, s) => sum + s.chunk.length, 0)

  let sent = 0
  for (let i = 0; i < steps.length; i++) {
    if (opts.signal?.aborted) {
      throw new PrintInterruptedError('aborted', sent, total, opts.signal.reason)
    }
    try {
      await sink.write(steps[i].chunk)
    } catch (cause) {
      throw new PrintInterruptedError('write-failed', sent, total, cause)
    }
    sent += steps[i].chunk.length
    opts.onProgress?.(sent, total)

    if (i < steps.length - 1) {
      await sleep(delayMs)
      if (steps[i].endsPart && partPauseMs > 0) await sleep(partPauseMs)
    }
  }
}
