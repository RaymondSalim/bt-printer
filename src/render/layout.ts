import { PRINT_WIDTH_DOTS } from '../encode/raster'
import { DEFAULT_FONT_SIZE, LINE_HEIGHT_RATIO, wrapText, type Measure } from './text'
import type { Align, DocumentModel } from './types'

export const DEFAULT_MARGIN_X = 12
export const DEFAULT_MARGIN_Y = 8
export const COLUMN_GAP = 12
const RULE_PADDING = 6
const DEFAULT_RULE_THICKNESS = 2

export type LayoutItem =
  | { kind: 'text'; text: string; x: number; y: number; size: number; bold: boolean; align: Align }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }

export interface Layout {
  width: number
  height: number
  items: LayoutItem[]
}

function assertNever(value: never): never {
  throw new Error(`Unknown block: ${JSON.stringify(value)}`)
}

export function layoutDocument(doc: DocumentModel, measure: Measure): Layout {
  const width = PRINT_WIDTH_DOTS
  const marginX = doc.marginX ?? DEFAULT_MARGIN_X
  const marginY = doc.marginY ?? DEFAULT_MARGIN_Y
  const contentWidth = width - 2 * marginX
  const items: LayoutItem[] = []
  let y = marginY

  const anchorX = (align: Align): number =>
    align === 'center' ? width / 2 : align === 'right' ? width - marginX : marginX

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'text': {
        const size = block.size ?? DEFAULT_FONT_SIZE
        const bold = block.bold ?? false
        const align = block.align ?? 'left'
        const lineHeight = Math.ceil(size * LINE_HEIGHT_RATIO)
        for (const line of wrapText(block.text, contentWidth, (t) => measure(t, size, bold))) {
          if (line !== '') items.push({ kind: 'text', text: line, x: anchorX(align), y, size, bold, align })
          y += lineHeight
        }
        break
      }
      case 'columns': {
        const size = block.size ?? DEFAULT_FONT_SIZE
        const bold = block.bold ?? false
        const lineHeight = Math.ceil(size * LINE_HEIGHT_RATIO)
        const rightWidth = block.right === '' ? 0 : Math.ceil(measure(block.right, size, bold))
        const leftMax = Math.max(
          contentWidth - rightWidth - (rightWidth > 0 ? COLUMN_GAP : 0),
          Math.floor(contentWidth / 3),
        )
        const leftLines = wrapText(block.left, leftMax, (t) => measure(t, size, bold))
        leftLines.forEach((line, i) => {
          if (line !== '') {
            items.push({ kind: 'text', text: line, x: marginX, y: y + i * lineHeight, size, bold, align: 'left' })
          }
        })
        if (block.right !== '') {
          items.push({ kind: 'text', text: block.right, x: width - marginX, y, size, bold, align: 'right' })
        }
        y += lineHeight * leftLines.length
        break
      }
      case 'rule': {
        const thickness = block.thickness ?? DEFAULT_RULE_THICKNESS
        y += RULE_PADDING
        items.push({ kind: 'rect', x: marginX, y, width: contentWidth, height: thickness })
        y += thickness + RULE_PADDING
        break
      }
      case 'spacer': {
        if (!(block.height >= 0)) {
          throw new RangeError(`spacer height must be zero or more, got ${block.height}`)
        }
        y += block.height
        break
      }
      default:
        assertNever(block)
    }
  }

  return { width, height: Math.ceil(y + marginY), items }
}
