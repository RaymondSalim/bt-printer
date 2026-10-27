import { PRINT_WIDTH_DOTS } from '../encode/raster'

const MARGIN = 8

export function composeLabel(
  label: HTMLCanvasElement,
  strip: HTMLCanvasElement | null,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = PRINT_WIDTH_DOTS
  canvas.height = MARGIN + label.height + (strip ? strip.height : 0) + MARGIN
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is not available')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(label, Math.floor((PRINT_WIDTH_DOTS - label.width) / 2), MARGIN)
  if (strip) ctx.drawImage(strip, 0, MARGIN + label.height)
  return canvas
}
