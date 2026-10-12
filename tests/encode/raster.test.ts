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
