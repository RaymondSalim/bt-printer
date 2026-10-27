import type { RgbaImage } from '../../src/encode/raster'
import type { Layout } from '../../src/render/layout'

// Draws the non-text items of a layout onto a white RGBA image so tests can decode
// the barcodes with an independent decoder.
export function rasterize(layout: Layout): RgbaImage {
  const { width, height } = layout
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  const fill = (x0: number, y0: number, w: number, h: number) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x++) {
        const i = (y * width + x) * 4
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
      }
    }
  }
  for (const item of layout.items) {
    if (item.kind === 'rect') {
      fill(item.x, item.y, item.width, item.height)
    } else if (item.kind === 'modules') {
      item.matrix.forEach((row, r) =>
        row.forEach((dark, c) => {
          if (dark) fill(item.x + c * item.moduleSize, item.y + r * item.moduleSize, item.moduleSize, item.moduleSize)
        }),
      )
    } else if (item.kind === 'bars') {
      for (let i = 0; i < item.modules.length; i++) {
        if (item.modules[i] === '1') fill(item.x + i * item.moduleWidth, item.y, item.moduleWidth, item.height)
      }
    }
  }
  return { width, height, data }
}
