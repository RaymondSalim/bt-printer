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
