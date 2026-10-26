import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BAND_ROWS,
  DEFAULT_TAIL_ROWS,
  PRINT_WIDTH_DOTS,
  ROW_BYTES,
  buildPrintJob,
  monoPreview,
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

  it('places each source row in the band and offset it belongs to', () => {
    const marked = [5, 129, 299]
    const img = makeImage(300, (x, y) => (marked.includes(y) && x === 0 ? BLACK : WHITE))
    const bands = rasterBands(img, { bandRows: 128 })
    const firstByteOfRow = (band: Uint8Array, row: number) => band[8 + row * ROW_BYTES]
    const blackRows = bands.flatMap((band, b) =>
      Array.from({ length: band.length > 8 ? (band.length - 8) / ROW_BYTES : 0 }, (_, r) => r)
        .filter((r) => firstByteOfRow(band, r) === 0x80)
        .map((r) => b * 128 + r),
    )
    expect(blackRows).toEqual(marked)
  })

  it('splits the row count across yL and yH for heights above 255', () => {
    const [band] = rasterBands(makeImage(300, () => BLACK), { bandRows: 300 })
    expect(band[6]).toBe(300 & 0xff)
    expect(band[7]).toBe(1)
  })
})

const rowsOf = (bands: Uint8Array[]) => bands.reduce((sum, b) => sum + (b[6] | (b[7] << 8)), 0)

describe('buildPrintJob', () => {
  it('pins the hardware-verified band size and tail clearance', () => {
    expect(DEFAULT_BAND_ROWS).toBe(32)
    expect(DEFAULT_TAIL_ROWS).toBe(96)
  })

  it('starts with ESC @ and ends with raster, with no feed command by default', () => {
    const job = buildPrintJob(makeImage(2, () => BLACK))
    expect([...job[0]]).toEqual([0x1b, 0x40])
    expect(job.slice(1).every((p) => p[0] === 0x1d && p[1] === 0x76)).toBe(true)
  })

  it('appends blank rows after the image so its end clears the tear bar', () => {
    const job = buildPrintJob(makeImage(2, () => BLACK))
    const bands = job.slice(1)
    expect(rowsOf(bands)).toBe(2 + DEFAULT_TAIL_ROWS)
    expect(bands).toHaveLength(Math.ceil((2 + DEFAULT_TAIL_ROWS) / DEFAULT_BAND_ROWS))
    const first = bands[0]
    expect(first.slice(8, 8 + 2 * ROW_BYTES).every((b) => b === 0xff)).toBe(true)
    expect(first.slice(8 + 2 * ROW_BYTES).every((b) => b === 0)).toBe(true)
    expect(bands.slice(1).every((b) => b.slice(8).every((v) => v === 0))).toBe(true)
  })

  it('honors a custom tail length, including none', () => {
    const img = makeImage(5, () => BLACK)
    expect(rowsOf(buildPrintJob(img, { tailRows: 0 }).slice(1))).toBe(5)
    expect(rowsOf(buildPrintJob(img, { tailRows: 10 }).slice(1))).toBe(15)
  })

  it('rejects an invalid tail length', () => {
    const img = makeImage(1, () => BLACK)
    expect(() => buildPrintJob(img, { tailRows: -1 })).toThrow(/tail/i)
    expect(() => buildPrintJob(img, { tailRows: 1.5 })).toThrow(/tail/i)
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

describe('monoPreview', () => {
  it('maps black pixels to opaque black and everything else to opaque white', () => {
    const img = makeImage(1, (x) =>
      x === 0 ? BLACK : x === 1 ? [200, 200, 200, 255] : [0, 0, 0, 0],
    )
    const out = monoPreview(img)
    expect(out.length).toBe(img.data.length)
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 255])
    expect([...out.slice(4, 8)]).toEqual([255, 255, 255, 255])
    expect([...out.slice(8, 12)]).toEqual([255, 255, 255, 255])
  })

  it('uses the same threshold rule as the encoder', () => {
    const gray = (v: number) => makeImage(1, () => [v, v, v, 255])
    expect(monoPreview(gray(127))[0]).toBe(0)
    expect(monoPreview(gray(128))[0]).toBe(255)
    expect(monoPreview(gray(200), 220)[0]).toBe(0)
  })

  it('agrees with the encoder on every pixel of a mixed image', () => {
    let seed = 12345
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    const img = makeImage(3, () => [next() % 256, next() % 256, next() % 256, 255 - (next() % 3) * 100])
    const preview = monoPreview(img)
    const [band] = rasterBands(img, { bandRows: 3 })
    for (let y = 0; y < 3; y++) {
      for (let xb = 0; xb < ROW_BYTES; xb++) {
        let expected = 0
        for (let bit = 0; bit < 8; bit++) {
          const i = (y * PRINT_WIDTH_DOTS + xb * 8 + bit) * 4
          if (preview[i] === 0) expected |= 0x80 >> bit
        }
        expect(band[8 + y * ROW_BYTES + xb]).toBe(expected)
      }
    }
  })
})
