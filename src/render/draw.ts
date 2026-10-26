import type { Layout } from './layout'
import { fontString } from './text'

export interface DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  fillText(text: string, x: number, y: number): void
  fillRect(x: number, y: number, width: number, height: number): void
}

export function drawLayout(ctx: DrawContext, layout: Layout): void {
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'top'
  for (const item of layout.items) {
    switch (item.kind) {
      case 'text':
        ctx.font = fontString(item.size, item.bold)
        ctx.textAlign = item.align
        ctx.fillText(item.text, item.x, item.y)
        break
      case 'rect':
        ctx.fillRect(item.x, item.y, item.width, item.height)
        break
      case 'modules':
        item.matrix.forEach((row, r) => {
          row.forEach((dark, c) => {
            if (dark) {
              ctx.fillRect(
                item.x + c * item.moduleSize,
                item.y + r * item.moduleSize,
                item.moduleSize,
                item.moduleSize,
              )
            }
          })
        })
        break
      case 'bars': {
        let i = 0
        while (i < item.modules.length) {
          if (item.modules[i] !== '1') {
            i++
            continue
          }
          let j = i
          while (j < item.modules.length && item.modules[j] === '1') j++
          ctx.fillRect(item.x + i * item.moduleWidth, item.y, (j - i) * item.moduleWidth, item.height)
          i = j
        }
        break
      }
    }
  }
}
