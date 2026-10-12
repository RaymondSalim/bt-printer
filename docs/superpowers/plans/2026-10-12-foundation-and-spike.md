# Foundation and Browser Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print a browser canvas on the Putian POS 802 over Web Bluetooth, with a tested encoder, tested transport and status check, and measured limits for long jobs.

**Architecture:** Pure, unit-tested modules (`encode`, `sendBytes`, `readStatus`) sit behind small interfaces. One thin Web Bluetooth adapter implements those interfaces and is verified on hardware through a spike page. The spike's measurements set the default chunk delay and band size for later plans.

**Tech Stack:** Vite, TypeScript (strict), Vitest, npm, `@types/web-bluetooth`. No UI framework, no backend.

**Spec:** `docs/superpowers/specs/2026-10-12-bt-printer-web-app-design.md`. Hardware facts: `docs/printer-findings.md`.

**Scope note:** This plan covers spec milestones 0 and 1. The spike is built on the milestone 1 modules because printing needs them anyway, so the plan order is encode, transport, status, adapter and spike. Milestones 2 to 6 (render, receipt, label, PDF, CSV, sticker mode) each get their own plan after this one.

## Global Constraints

- Print width is 576 dots, which is 72 bytes per raster row; raster starts at the paper's left edge.
- Raster command is `GS v 0` (`1D 76 30 00 xL xH yL yH`), sent in bands of about 128 rows.
- BLE service `0000ff00-0000-1000-8000-00805f9b34fb`, write characteristic `0000ff02-0000-1000-8000-00805f9b34fb`, notify characteristic `0000ff01-0000-1000-8000-00805f9b34fb`.
- Writes use write-with-response in chunks of 200 bytes; MTU is 240.
- Web Bluetooth works in Chrome and Edge only, and only on HTTPS or localhost.
- Static Vite + TypeScript app, vanilla TS, no UI framework, no backend; package manager is npm; tests use Vitest.
- Commit messages must not mention any AI tool and must not carry attribution trailers.
- Code comments describe current behavior or invariants, never the editing history.

## Review Focus

- A canvas that was never filled with white has transparent-black pixels; they must print white, not as a solid black slab.
- Images taller than 255 rows need the row count split correctly across `yL` and `yH`, and the last band must be shorter when rows do not divide evenly.
- A printer that is asleep or silent must make the status check fail with a timeout error, not hang forever.
- A write failure or abort mid-job must stop further writes and report how many bytes were already sent.
- Odd payloads must behave: a zero-row image, a wrong-width canvas, and a payload that is an exact multiple of the chunk size.

---

### Task 1: Scaffold and raster encoder

**Files:**
- Create: `package.json` (via `npm init`), `tsconfig.json`, `vite.config.ts`, `.gitignore`, `index.html`, `src/main.ts`
- Create: `src/encode/raster.ts`
- Test: `tests/encode/raster.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (from `src/encode/raster.ts`):
  - `PRINT_WIDTH_DOTS = 576`, `ROW_BYTES = 72`, `DEFAULT_BAND_ROWS = 128`, `DEFAULT_THRESHOLD = 128`
  - `interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }` (a browser `ImageData` satisfies it)
  - `interface RasterOptions { threshold?: number; bandRows?: number }`
  - `rasterBands(img: RgbaImage, opts?: RasterOptions): Uint8Array[]`, one `GS v 0` command per band
  - `interface JobOptions extends RasterOptions { feedLines?: number }`
  - `buildPrintJob(img: RgbaImage, opts?: JobOptions): Uint8Array[]`, returning `[ESC @, ...bands, ESC d n]`

- [ ] **Step 1: Scaffold the project**

Run:
```bash
npm init -y
npm pkg set name=bt-printer private=true type=module
npm pkg set scripts.dev=vite scripts.build="tsc --noEmit && vite build" scripts.test="vitest run" scripts.typecheck="tsc --noEmit"
npm install -D typescript vite vitest @types/web-bluetooth
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["web-bluetooth", "vite/client"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

Create `vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
})
```

Create `.gitignore`:
```
node_modules
dist
.DS_Store
```

Create `index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bt-printer</title>
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Create `src/main.ts`:
```ts
const app = document.getElementById('app')
if (app) app.textContent = 'bt-printer'
```

- [ ] **Step 2: Write the failing tests**

Create `tests/encode/raster.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  PRINT_WIDTH_DOTS,
  ROW_BYTES,
  buildPrintJob,
  rasterBands,
  type RgbaImage,
} from '../../src/encode/raster'

type Pixel = [number, number, number, number]

function makeImage(
  height: number,
  pixel: (x: number, y: number) => Pixel,
  width = PRINT_WIDTH_DOTS,
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(pixel(x, y), (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

const BLACK: Pixel = [0, 0, 0, 255]
const WHITE: Pixel = [255, 255, 255, 255]

describe('rasterBands', () => {
  it('rejects an image that is not 576 pixels wide', () => {
    const img = makeImage(2, () => BLACK, 100)
    expect(() => rasterBands(img)).toThrow(/576/)
  })

  it('rejects an image with no rows', () => {
    const img = makeImage(0, () => BLACK)
    expect(() => rasterBands(img)).toThrow(/no rows/)
  })

  it('encodes an all-black image with the GS v 0 header and 0xFF data', () => {
    const [band] = rasterBands(makeImage(2, () => BLACK))
    expect([...band.slice(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, ROW_BYTES, 0x00, 2, 0x00])
    expect(band.length).toBe(8 + 2 * ROW_BYTES)
    expect(band.slice(8).every((b) => b === 0xff)).toBe(true)
  })

  it('encodes an all-white image as zero bytes', () => {
    const [band] = rasterBands(makeImage(1, () => WHITE))
    expect(band.slice(8).every((b) => b === 0)).toBe(true)
  })

  it('treats transparent pixels as white', () => {
    const [band] = rasterBands(makeImage(1, () => [0, 0, 0, 0]))
    expect(band.slice(8).every((b) => b === 0)).toBe(true)
  })

  it('packs the leftmost pixel into the most significant bit', () => {
    const only = (px: number) => makeImage(1, (x) => (x === px ? BLACK : WHITE))
    expect(rasterBands(only(0))[0][8]).toBe(0x80)
    expect(rasterBands(only(7))[0][8]).toBe(0x01)
    expect(rasterBands(only(8))[0][9]).toBe(0x80)
  })

  it('prints a pixel only when its luminance is below the threshold', () => {
    const gray = (v: number) => makeImage(1, () => [v, v, v, 255])
    expect(rasterBands(gray(127))[0][8]).toBe(0xff)
    expect(rasterBands(gray(128))[0][8]).toBe(0x00)
    expect(rasterBands(gray(200), { threshold: 220 })[0][8]).toBe(0xff)
  })

  it('splits tall images into bands with a shorter final band', () => {
    const bands = rasterBands(makeImage(300, () => BLACK), { bandRows: 128 })
    expect(bands.map((b) => b[6] | (b[7] << 8))).toEqual([128, 128, 44])
    expect(bands.map((b) => b.length)).toEqual([
      8 + 128 * ROW_BYTES,
      8 + 128 * ROW_BYTES,
      8 + 44 * ROW_BYTES,
    ])
  })

  it('splits the row count across yL and yH for heights above 255', () => {
    const [band] = rasterBands(makeImage(300, () => BLACK), { bandRows: 300 })
    expect(band[6]).toBe(300 & 0xff)
    expect(band[7]).toBe(1)
  })
})

describe('buildPrintJob', () => {
  it('wraps the bands in ESC @ and a trailing feed', () => {
    const job = buildPrintJob(makeImage(2, () => BLACK))
    expect([...job[0]]).toEqual([0x1b, 0x40])
    expect(job).toHaveLength(3)
    expect([...job[2]]).toEqual([0x1b, 0x64, 4])
  })

  it('uses the requested feed length', () => {
    const job = buildPrintJob(makeImage(1, () => BLACK), { feedLines: 9 })
    expect([...job[job.length - 1]]).toEqual([0x1b, 0x64, 9])
  })

  it('rejects a feed length outside 0 to 255', () => {
    const img = makeImage(1, () => BLACK)
    expect(() => buildPrintJob(img, { feedLines: 256 })).toThrow(/feed/i)
    expect(() => buildPrintJob(img, { feedLines: -1 })).toThrow(/feed/i)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/encode/raster.test.ts`
Expected: FAIL, the module `../../src/encode/raster` cannot be resolved.

- [ ] **Step 4: Implement the encoder**

Create `src/encode/raster.ts`:
```ts
export const PRINT_WIDTH_DOTS = 576
export const ROW_BYTES = PRINT_WIDTH_DOTS / 8
export const DEFAULT_BAND_ROWS = 128
export const DEFAULT_THRESHOLD = 128

export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface RasterOptions {
  threshold?: number
  bandRows?: number
}

export interface JobOptions extends RasterOptions {
  feedLines?: number
}

// Alpha is composited onto white, so a transparent pixel always prints as paper.
// Luminance is rounded to an integer so a pixel exactly at the threshold does
// not flip on floating-point error.
function isBlack(data: Uint8ClampedArray, i: number, threshold: number): boolean {
  const alpha = data[i + 3] / 255
  const luminance = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
  return 255 - (255 - luminance) * alpha < threshold
}

export function rasterBands(img: RgbaImage, opts: RasterOptions = {}): Uint8Array[] {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const bandRows = opts.bandRows ?? DEFAULT_BAND_ROWS
  if (img.width !== PRINT_WIDTH_DOTS) {
    throw new Error(`Image must be ${PRINT_WIDTH_DOTS} pixels wide, got ${img.width}`)
  }
  if (img.height < 1) throw new Error('Image has no rows to print')
  if (!Number.isInteger(bandRows) || bandRows < 1 || bandRows > 0xffff) {
    throw new Error(`bandRows must be an integer from 1 to 65535, got ${bandRows}`)
  }

  const bands: Uint8Array[] = []
  for (let top = 0; top < img.height; top += bandRows) {
    const rows = Math.min(bandRows, img.height - top)
    const out = new Uint8Array(8 + rows * ROW_BYTES)
    out.set([0x1d, 0x76, 0x30, 0x00, ROW_BYTES & 0xff, ROW_BYTES >> 8, rows & 0xff, rows >> 8])
    let o = 8
    for (let y = top; y < top + rows; y++) {
      for (let xb = 0; xb < ROW_BYTES; xb++) {
        let v = 0
        for (let bit = 0; bit < 8; bit++) {
          const i = (y * img.width + xb * 8 + bit) * 4
          if (isBlack(img.data, i, threshold)) v |= 0x80 >> bit
        }
        out[o++] = v
      }
    }
    bands.push(out)
  }
  return bands
}

export function buildPrintJob(img: RgbaImage, opts: JobOptions = {}): Uint8Array[] {
  const feedLines = opts.feedLines ?? 4
  if (!Number.isInteger(feedLines) || feedLines < 0 || feedLines > 255) {
    throw new Error(`feedLines must be an integer from 0 to 255, got ${feedLines}`)
  }
  return [Uint8Array.of(0x1b, 0x40), ...rasterBands(img, opts), Uint8Array.of(0x1b, 0x64, feedLines)]
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run tests/encode/raster.test.ts && npm run typecheck`
Expected: all tests PASS, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts .gitignore index.html src/main.ts src/encode/raster.ts tests/encode/raster.test.ts
git commit -m "feat: scaffold app and add raster encoder"
```

---

### Task 2: Chunked transport

**Files:**
- Create: `src/printer/send.ts`
- Test: `tests/printer/send.test.ts`

**Interfaces:**
- Consumes: nothing (it takes `Uint8Array[]`, which is what `buildPrintJob` returns).
- Produces (from `src/printer/send.ts`):
  - `interface ByteSink { write(data: Uint8Array): Promise<void> }`
  - `SEND_DEFAULTS = { chunkSize: 200, delayMs: 30, partPauseMs: 0 }`
  - `interface SendOptions { chunkSize?: number; delayMs?: number; partPauseMs?: number; onProgress?: (sent: number, total: number) => void; signal?: AbortSignal; sleep?: (ms: number) => Promise<void> }`
  - `class PrintInterruptedError extends Error` with `reason: 'aborted' | 'write-failed'`, `bytesSent: number`, `totalBytes: number`
  - `sendBytes(sink: ByteSink, parts: Uint8Array[], opts?: SendOptions): Promise<void>`

Each part (one band) is chunked on its own, so a chunk never straddles two parts. The delay runs between consecutive writes and never after the last one. `partPauseMs` is an extra pause after the last chunk of each part except the final part.

- [ ] **Step 1: Write the failing tests**

Create `tests/printer/send.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/printer/send.test.ts`
Expected: FAIL, module `../../src/printer/send` cannot be resolved.

- [ ] **Step 3: Implement the transport**

Create `src/printer/send.ts`:
```ts
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
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run tests/printer/send.test.ts && npm run typecheck`
Expected: all tests PASS, typecheck exits 0.

If the abort test fails because the check happens only before the next write: confirm `onProgress` fires before the loop's next iteration, which the implementation guarantees; the abort is observed at the top of the next iteration.

- [ ] **Step 5: Commit**

```bash
git add src/printer/send.ts tests/printer/send.test.ts
git commit -m "feat: add chunked transport with abort and failure reporting"
```

---

### Task 3: Status query

**Files:**
- Create: `src/printer/status.ts`
- Test: `tests/printer/status.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (from `src/printer/status.ts`):
  - `interface StatusIo { write(data: Uint8Array): Promise<void>; onNotify(cb: (data: Uint8Array) => void): () => void }` (returns an unsubscribe function)
  - `interface PrinterStatus { online: boolean; coverClosed: boolean; paperPresent: boolean; error: boolean; raw: [number, number, number, number] }`
  - `class PrinterNotRespondingError extends Error`
  - `decodeStatus(raw: readonly [number, number, number, number]): PrinterStatus`
  - `readStatus(io: StatusIo, timeoutMs?: number): Promise<PrinterStatus>` (default timeout 1500 ms)

- [ ] **Step 1: Write the failing tests**

Create `tests/printer/status.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/printer/status.test.ts`
Expected: FAIL, module `../../src/printer/status` cannot be resolved.

- [ ] **Step 3: Implement the status module**

Create `src/printer/status.ts`:
```ts
export interface StatusIo {
  write(data: Uint8Array): Promise<void>
  onNotify(cb: (data: Uint8Array) => void): () => void
}

export interface PrinterStatus {
  online: boolean
  coverClosed: boolean
  paperPresent: boolean
  error: boolean
  raw: [number, number, number, number]
}

export class PrinterNotRespondingError extends Error {
  constructor(query: number, timeoutMs: number) {
    super(`Printer did not answer status query ${query} within ${timeoutMs} ms`)
    this.name = 'PrinterNotRespondingError'
  }
}

// Bit meanings follow the Epson ESC/POS DLE EOT table. Only the all-clear
// replies (0x16, 0x12, 0x12, 0x12) have been observed on the Putian 802.
export function decodeStatus(raw: readonly [number, number, number, number]): PrinterStatus {
  const [b1, b2, b3, b4] = raw
  return {
    online: (b1 & 0x08) === 0,
    coverClosed: (b2 & 0x04) === 0,
    paperPresent: (b4 & 0x60) === 0,
    error: (b3 & 0x6c) !== 0,
    raw: [b1, b2, b3, b4],
  }
}

function query(io: StatusIo, n: number, timeoutMs: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let off: () => void = () => {}
    const timer = setTimeout(() => {
      off()
      reject(new PrinterNotRespondingError(n, timeoutMs))
    }, timeoutMs)
    off = io.onNotify((data) => {
      if (data.length === 0) return
      clearTimeout(timer)
      off()
      resolve(data[0])
    })
    io.write(Uint8Array.of(0x10, 0x04, n)).catch((err) => {
      clearTimeout(timer)
      off()
      reject(err)
    })
  })
}

export async function readStatus(io: StatusIo, timeoutMs = 1500): Promise<PrinterStatus> {
  const b1 = await query(io, 1, timeoutMs)
  const b2 = await query(io, 2, timeoutMs)
  const b3 = await query(io, 3, timeoutMs)
  const b4 = await query(io, 4, timeoutMs)
  return decodeStatus([b1, b2, b3, b4])
}
```

- [ ] **Step 4: Run all tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: every test PASSES, typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/printer/status.ts tests/printer/status.test.ts
git commit -m "feat: add printer status query and decoder"
```

---

### Task 4: Web Bluetooth adapter and hardware spike

**Files:**
- Create: `src/printer/webBluetooth.ts`
- Create: `src/spike/patterns.ts`
- Modify: `src/main.ts` (replace the placeholder with the spike UI)
- Modify: `docs/printer-findings.md` (record measured limits)
- Modify: `src/printer/send.ts` and `src/encode/raster.ts` (update defaults only if the spike shows different safe values)

**Interfaces:**
- Consumes: `ByteSink` and `sendBytes` and `SEND_DEFAULTS` (Task 2), `StatusIo` and `readStatus` (Task 3), `buildPrintJob` and `PRINT_WIDTH_DOTS` (Task 1).
- Produces (from `src/printer/webBluetooth.ts`):
  - constants `PRINTER_NAME = 'RPP02N'`, `SERVICE_UUID`, `WRITE_CHAR_UUID`, `NOTIFY_CHAR_UUID`
  - `class WebBluetoothPrinter implements ByteSink, StatusIo` with `connect(): Promise<void>`, `disconnect(): void`, `get connected(): boolean`, `write(data)`, `onNotify(cb)`
- Produces (from `src/spike/patterns.ts`): `drawRuler(): HTMLCanvasElement` and `drawLongPattern(rows: number): HTMLCanvasElement`, both 576 pixels wide with an opaque white background.

This task cannot be unit-tested because it needs the real printer. Its verification is typecheck plus the manual checklist in Steps 5 to 7. Charge the printer first: low battery made it drop off BLE during earlier testing.

- [ ] **Step 1: Write the adapter**

Create `src/printer/webBluetooth.ts`:
```ts
import type { ByteSink } from './send'
import type { StatusIo } from './status'

export const PRINTER_NAME = 'RPP02N'
export const SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb'
export const WRITE_CHAR_UUID = '0000ff02-0000-1000-8000-00805f9b34fb'
export const NOTIFY_CHAR_UUID = '0000ff01-0000-1000-8000-00805f9b34fb'

export class WebBluetoothPrinter implements ByteSink, StatusIo {
  private device?: BluetoothDevice
  private writeChar?: BluetoothRemoteGATTCharacteristic
  private notifyChar?: BluetoothRemoteGATTCharacteristic
  private readonly listeners = new Set<(data: Uint8Array) => void>()

  get connected(): boolean {
    return this.device?.gatt?.connected === true
  }

  async connect(): Promise<void> {
    if (!('bluetooth' in navigator)) {
      throw new Error('Web Bluetooth is not available. Use Chrome or Edge over HTTPS or localhost.')
    }
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: PRINTER_NAME }],
      optionalServices: [SERVICE_UUID],
    })
    if (!device.gatt) throw new Error('The selected device has no GATT server')
    const server = await device.gatt.connect()
    const service = await server.getPrimaryService(SERVICE_UUID)
    this.writeChar = await service.getCharacteristic(WRITE_CHAR_UUID)
    this.notifyChar = await service.getCharacteristic(NOTIFY_CHAR_UUID)
    this.notifyChar.addEventListener('characteristicvaluechanged', this.handleNotify)
    await this.notifyChar.startNotifications()
    this.device = device
  }

  disconnect(): void {
    this.notifyChar?.removeEventListener('characteristicvaluechanged', this.handleNotify)
    this.device?.gatt?.disconnect()
    this.writeChar = undefined
    this.notifyChar = undefined
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writeChar || !this.connected) throw new Error('Printer is not connected')
    await this.writeChar.writeValueWithResponse(data)
  }

  onNotify(cb: (data: Uint8Array) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private readonly handleNotify = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value
    if (!value) return
    const copy = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
    this.listeners.forEach((cb) => cb(copy))
  }
}
```

- [ ] **Step 2: Write the test patterns**

Create `src/spike/patterns.ts`:
```ts
import { PRINT_WIDTH_DOTS } from '../encode/raster'

function whiteCanvas(height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = PRINT_WIDTH_DOTS
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is not available')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000'
  ctx.strokeStyle = '#000'
  return { canvas, ctx }
}

// Millimetre ruler: 8 dots per millimetre, a label every 8 mm, bars on both edges.
export function drawRuler(): HTMLCanvasElement {
  const { canvas, ctx } = whiteCanvas(64)
  ctx.fillRect(0, 0, 3, 64)
  ctx.fillRect(PRINT_WIDTH_DOTS - 3, 0, 3, 64)
  ctx.font = 'bold 14px monospace'
  ctx.textBaseline = 'top'
  for (let x = 0; x <= PRINT_WIDTH_DOTS; x += 32) {
    const long = x % 64 === 0
    const px = Math.min(x, PRINT_WIDTH_DOTS - 1)
    ctx.fillRect(px, 64 - (long ? 26 : 12), 1, long ? 26 : 12)
    if (long) {
      const label = String(x / 8)
      const w = ctx.measureText(label).width
      ctx.fillText(label, Math.min(Math.max(px - w / 2, 4), PRINT_WIDTH_DOTS - w - 4), 2)
    }
  }
  return canvas
}

// A frame with a row-number label every 50 rows and a diagonal. Dropped or
// reordered data shows up as missing labels or a broken diagonal.
export function drawLongPattern(rows: number): HTMLCanvasElement {
  const { canvas, ctx } = whiteCanvas(rows)
  ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, PRINT_WIDTH_DOTS - 3, rows - 3)
  ctx.font = 'bold 18px monospace'
  ctx.textBaseline = 'top'
  for (let y = 10; y < rows - 20; y += 50) {
    ctx.fillText(`row ${String(y).padStart(5, '0')}`, 12, y)
    ctx.fillRect(PRINT_WIDTH_DOTS - 80, y, 60, 4)
  }
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(3, 3)
  ctx.lineTo(PRINT_WIDTH_DOTS - 3, rows - 3)
  ctx.stroke()
  return canvas
}
```

- [ ] **Step 3: Write the spike UI**

Replace `src/main.ts` with:
```ts
import { buildPrintJob } from './encode/raster'
import { PrintInterruptedError, SEND_DEFAULTS, sendBytes } from './printer/send'
import { readStatus } from './printer/status'
import { WebBluetoothPrinter } from './printer/webBluetooth'
import { drawLongPattern, drawRuler } from './spike/patterns'

const printer = new WebBluetoothPrinter()
const app = document.getElementById('app')!
app.innerHTML = `
  <h1>bt-printer spike</h1>
  <p>
    <button id="connect">Connect</button>
    <button id="status">Status</button>
    <button id="ruler">Print ruler</button>
  </p>
  <p>
    rows <input id="rows" type="number" value="300" min="1" style="width:5em">
    chunk delay ms <input id="delay" type="number" value="${SEND_DEFAULTS.delayMs}" min="0" style="width:4em">
    band pause ms <input id="pause" type="number" value="${SEND_DEFAULTS.partPauseMs}" min="0" style="width:4em">
    <button id="long">Print long pattern</button>
  </p>
  <pre id="log" style="background:#eee;padding:8px;min-height:8em"></pre>
`

const log = (msg: string) => {
  const el = document.getElementById('log')!
  el.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`
}
const num = (id: string) => Number((document.getElementById(id) as HTMLInputElement).value)

async function run(label: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    if (err instanceof PrintInterruptedError) {
      log(`${label} FAILED: ${err.message} (${err.reason})`)
    } else {
      log(`${label} FAILED: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function printCanvas(canvas: HTMLCanvasElement, delayMs: number, partPauseMs: number) {
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const job = buildPrintJob(img)
  const total = job.reduce((n, p) => n + p.length, 0)
  log(`sending ${total} bytes in ${job.length} parts (delay ${delayMs} ms, band pause ${partPauseMs} ms)`)
  const started = performance.now()
  await sendBytes(printer, job, { delayMs, partPauseMs })
  const secs = (performance.now() - started) / 1000
  log(`sent in ${secs.toFixed(1)} s, ${(total / 1024 / secs).toFixed(1)} KiB/s`)
}

document.getElementById('connect')!.addEventListener('click', () =>
  run('connect', async () => {
    await printer.connect()
    log('connected')
  }),
)
document.getElementById('status')!.addEventListener('click', () =>
  run('status', async () => {
    const s = await readStatus(printer)
    log(`status ${JSON.stringify(s)}`)
  }),
)
document.getElementById('ruler')!.addEventListener('click', () =>
  run('ruler', () => printCanvas(drawRuler(), SEND_DEFAULTS.delayMs, SEND_DEFAULTS.partPauseMs)),
)
document.getElementById('long')!.addEventListener('click', () =>
  run('long', () => printCanvas(drawLongPattern(num('rows')), num('delay'), num('pause'))),
)
```

- [ ] **Step 4: Typecheck and run the unit tests**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; all unit tests PASS.

If `writeValueWithResponse(data)` fails to typecheck because a `Uint8Array<ArrayBufferLike>` is not a `BufferSource`, change the call to `writeValueWithResponse(data.slice())`, since `slice()` returns a `Uint8Array<ArrayBuffer>`.

- [ ] **Step 5: Hardware check, basics**

Run `npm run dev`, open the printed `http://localhost:5173` in Chrome (not Safari). Make sure no other app or script holds the printer connection. Then:
1. Click Connect, pick `RPP02N` in the chooser. Expect the log line `connected`.
2. Click Status. Expect `online`, `coverClosed` and `paperPresent` true and `error` false, with `raw` equal to `[22,18,18,18]`.
3. Click Print ruler. Expect the same result as the earlier ruler: black bars at both paper edges and a 72 label at the right. If it is shifted or clipped, stop and report before continuing.

- [ ] **Step 6: Hardware check, long jobs and throughput**

With defaults (delay 30, band pause 0), print the long pattern at 300, 600, 1200 and 2400 rows. For each run, note the logged time and KiB/s, and check the slip: every `row NNNNN` label present in order, an unbroken diagonal, and the frame closed at the bottom. Then lower the chunk delay to 10 and then 0 at 1200 rows, and try a band pause of 50 ms if data goes missing. Record the smallest delay and pause that print 2400 rows cleanly twice in a row. Also record whether Chrome asks you to pick the printer again after a page reload.

- [ ] **Step 7: Record the results and set defaults**

Add a section `## Browser spike results` to `docs/printer-findings.md` listing: the Chrome version, the status reply, ruler result, per-row-count time and throughput, the largest row count printed cleanly, the delay and pause that were clean, any failures with their symptoms, and whether re-pairing was needed after reload. If the clean values differ from `SEND_DEFAULTS` (200 bytes, 30 ms, 0 ms) in `src/printer/send.ts` or `DEFAULT_BAND_ROWS` (128) in `src/encode/raster.ts`, update those constants. Add an assertion for any changed default to the existing tests only if a test reads the constant directly; otherwise no test change is needed.

- [ ] **Step 8: Run everything and commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/printer/webBluetooth.ts src/spike/patterns.ts src/main.ts docs/printer-findings.md src/printer/send.ts src/encode/raster.ts
git commit -m "feat: add Web Bluetooth adapter and hardware spike with measured limits"
```

---

## Self-review

**Spec coverage.** Milestone 1 (`encode`, `printer`, tests, fake device) is Tasks 1 to 3, with the fake sink and fake status IO inside the tests. Milestone 0 (browser canvas printed over Web Bluetooth, long image, throughput, buffer limits) is Task 4 Steps 5 to 7. The spec's reconnect question is covered by the re-pairing note in Step 6. Not in this plan by design: `render`, templates, forms, PDF and CSV import, sticker mode, dithering, and the pre-print paper and cover check (the check function exists in Task 3; wiring it into the print flow belongs to the plan that builds the print UI).

**Placeholders.** None; every code step has complete code and every run step has a command and expected result.

**Type consistency.** `RgbaImage`, `rasterBands`, `buildPrintJob`, `ByteSink`, `SEND_DEFAULTS`, `sendBytes`, `PrintInterruptedError`, `StatusIo`, `readStatus` and `WebBluetoothPrinter` use the same names and signatures wherever they appear. `ImageData` from the canvas satisfies `RgbaImage` structurally.
