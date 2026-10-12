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
