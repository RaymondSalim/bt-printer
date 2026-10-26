import { drawLayout } from './draw'
import { layoutDocument } from './layout'
import { fontString } from './text'
import type { DocumentModel } from './types'

export function renderDocument(doc: DocumentModel): HTMLCanvasElement {
  const scratch = document.createElement('canvas').getContext('2d')
  if (!scratch) throw new Error('2D canvas is not available')
  const layout = layoutDocument(doc, (text, size, bold) => {
    scratch.font = fontString(size, bold)
    return scratch.measureText(text).width
  })

  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is not available')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  drawLayout(ctx, layout)
  return canvas
}
