import { buildPrintJob, type RgbaImage } from '../encode/raster'
import { sendBytes, type ByteSink } from '../printer/send'
import { PrinterNotRespondingError, readStatus, type StatusIo } from '../printer/status'

export type PrintLink = ByteSink & StatusIo
export type PrintOutcome = 'printed' | 'cancelled'

export interface PrintOptions {
  confirmWarnings(warnings: string[]): Promise<boolean>
  onProgress?(sent: number, total: number): void
  signal?: AbortSignal
  feedLines?: number
  sleep?(ms: number): Promise<void>
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
  const warnings = await preflight(link)
  if (warnings.length > 0 && !(await opts.confirmWarnings(warnings))) return 'cancelled'
  await sendBytes(link, job, {
    onProgress: opts.onProgress,
    signal: opts.signal,
    sleep: opts.sleep,
  })
  return 'printed'
}
