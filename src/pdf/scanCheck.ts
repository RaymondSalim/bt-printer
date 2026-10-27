import { readBarcodes } from 'zxing-wasm/reader'
import { monoPreview, type RgbaImage } from '../encode/raster'

const FORMATS = ['Code128', 'QRCode'] as Array<'Code128' | 'QRCode'>

// Strict decoding stands in for a basic handheld scanner: no extra effort,
// rotation, inversion or downscaling.
const STRICT = {
  tryHarder: false,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: false,
  formats: FORMATS,
  maxNumberOfSymbols: 8,
}
const THOROUGH = {
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  formats: FORMATS,
  maxNumberOfSymbols: 8,
}

export interface ScanResult {
  found: string[]
  missing: string[]
}

export function compareScan(expected: string[], found: string[]): ScanResult {
  return {
    found: [...new Set(found)],
    missing: expected.filter((text) => !found.includes(text)),
  }
}

// `printed` reads the image as the printer will reproduce it (1 bit, strict decoder);
// `reference` reads a sharp render of the original with every decoder effort enabled.
export async function readCodes(img: RgbaImage, mode: 'printed' | 'reference'): Promise<string[]> {
  const input = mode === 'printed' ? { width: img.width, height: img.height, data: monoPreview(img) } : img
  // The decoder only reads width, height and data, so a plain object stands in
  // for the browser ImageData type that Node does not have.
  const results = await readBarcodes(input as unknown as ImageData, mode === 'printed' ? STRICT : THOROUGH)
  return results.map((result) => result.text)
}

export async function scanCheck(img: RgbaImage, expected: string[]): Promise<ScanResult> {
  return compareScan(expected, await readCodes(img, 'printed'))
}
