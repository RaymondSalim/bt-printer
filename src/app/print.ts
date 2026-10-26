import { DEFAULT_BAND_ROWS, ROW_BYTES, buildPrintJob, type RgbaImage } from '../encode/raster'
import { sendBytes, type ByteSink } from '../printer/send'
import { PrinterNotRespondingError, readStatus, type StatusIo } from '../printer/status'

export type PrintLink = ByteSink & StatusIo
export type PrintOutcome = 'printed' | 'cancelled'

export interface PrintOptions {
  confirmWarnings(warnings: string[]): Promise<boolean>
  onProgress?(sent: number, total: number): void
  signal?: AbortSignal
  feedLines?: number
  resyncFirst?: boolean
  sleep?(ms: number): Promise<void>
}

// A band's worth of zero bytes completes any raster command the printer is still
// waiting on after an interrupted job (NUL outside a command is ignored), and
// ESC @ then resets it.
const RESYNC_PAD_BYTES = 8 + DEFAULT_BAND_ROWS * ROW_BYTES + 64

export async function resyncPrinter(sink: ByteSink, sleep?: (ms: number) => Promise<void>): Promise<void> {
  await sendBytes(sink, [new Uint8Array(RESYNC_PAD_BYTES), Uint8Array.of(0x1b, 0x40)], { sleep })
}

// Status bit decoding has only been observed for the all-clear case on this
// printer, so every finding here is a warning the user can override.
export async function preflight(io: StatusIo): Promise<string[]> {
  let status
  try {
    status = await readStatus(io)
  } catch (err) {
    if (err instanceof PrinterNotRespondingError) {
      return ['The printer did not answer the status check.']
    }
    throw err
  }
  const warnings: string[] = []
  if (!status.online) warnings.push('The printer reports it is offline.')
  if (!status.coverClosed) warnings.push('The printer cover is open.')
  if (!status.paperPresent) warnings.push('The printer reports it is out of paper.')
  if (status.error) warnings.push('The printer reports an error.')
  return warnings
}

export async function printImage(
  link: PrintLink,
  img: RgbaImage,
  opts: PrintOptions,
): Promise<PrintOutcome> {
  const job = buildPrintJob(img, { feedLines: opts.feedLines })
  if (opts.resyncFirst) await resyncPrinter(link, opts.sleep)
  const warnings = await preflight(link)
  if (warnings.length > 0 && !(await opts.confirmWarnings(warnings))) return 'cancelled'
  await sendBytes(link, job, {
    onProgress: opts.onProgress,
    signal: opts.signal,
    sleep: opts.sleep,
  })
  return 'printed'
}
