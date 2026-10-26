import { PRINT_WIDTH_DOTS } from '../encode/raster'
import { encodeCode128B } from './code128'
import { qrMatrix } from './qr'
import { DEFAULT_FONT_SIZE, LINE_HEIGHT_RATIO, wrapText, type Measure } from './text'
import type { Align, DocumentModel } from './types'

export const DEFAULT_MARGIN_X = 12
export const DEFAULT_MARGIN_Y = 8
export const COLUMN_GAP = 12
const RULE_PADDING = 6
const DEFAULT_RULE_THICKNESS = 2
const DEFAULT_QR_SIZE = 192
const QR_QUIET_MODULES = 4
const MIN_QR_MODULE = 2
const DEFAULT_BARCODE_HEIGHT = 80
const DEFAULT_BARCODE_MODULE = 2
const BARCODE_QUIET_MODULES = 10
const MIN_BARCODE_MODULE = 2
const BARCODE_GAP = 6

export type LayoutItem =
  | { kind: 'text'; text: string; x: number; y: number; size: number; bold: boolean; align: Align }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'modules'; x: number; y: number; moduleSize: number; matrix: boolean[][] }
  | { kind: 'bars'; x: number; y: number; moduleWidth: number; height: number; modules: string }

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

  const alignedX = (align: Align, total: number): number =>
    align === 'center'
      ? Math.floor((width - total) / 2)
      : align === 'right'
        ? width - marginX - total
        : marginX

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
        const lineWidth = (t: string) => measure(t, size, bold)
        // The right column is capped at two thirds of the line and wraps beyond that,
        // so long values stay on the page instead of overprinting the left label.
        const rightLines =
          block.right === '' ? [] : wrapText(block.right, Math.floor((contentWidth * 2) / 3), lineWidth)
        const rightWidth = Math.max(0, ...rightLines.map((line) => Math.ceil(lineWidth(line))))
        const leftMax = Math.max(
          contentWidth - rightWidth - (rightWidth > 0 ? COLUMN_GAP : 0),
          Math.floor(contentWidth / 3),
        )
        const leftLines = wrapText(block.left, leftMax, lineWidth)
        leftLines.forEach((line, i) => {
          if (line !== '') {
            items.push({ kind: 'text', text: line, x: marginX, y: y + i * lineHeight, size, bold, align: 'left' })
          }
        })
        rightLines.forEach((line, i) => {
          if (line !== '') {
            items.push({ kind: 'text', text: line, x: width - marginX, y: y + i * lineHeight, size, bold, align: 'right' })
          }
        })
        y += lineHeight * Math.max(leftLines.length, rightLines.length)
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
      case 'qr': {
        const matrix = qrMatrix(block.data)
        const cells = matrix.length + 2 * QR_QUIET_MODULES
        const target = Math.min(block.size ?? DEFAULT_QR_SIZE, contentWidth)
        const moduleSize = Math.floor(target / cells)
        if (moduleSize < MIN_QR_MODULE) {
          throw new Error(
            `QR code for ${block.data.length} characters needs ${cells * MIN_QR_MODULE} dots but only ${target} are available`,
          )
        }
        const total = moduleSize * cells
        const x = alignedX(block.align ?? 'center', total)
        items.push({
          kind: 'modules',
          x: x + QR_QUIET_MODULES * moduleSize,
          y: y + QR_QUIET_MODULES * moduleSize,
          moduleSize,
          matrix,
        })
        y += total
        break
      }
      case 'barcode': {
        const modules = encodeCode128B(block.data)
        const height = block.height ?? DEFAULT_BARCODE_HEIGHT
        const cells = modules.length + 2 * BARCODE_QUIET_MODULES
        let moduleWidth = block.moduleWidth ?? DEFAULT_BARCODE_MODULE
        if (cells * moduleWidth > contentWidth) moduleWidth = Math.floor(contentWidth / cells)
        // Bars thinner than two dots (0.25 mm) are unreliable to scan from a thermal head.
        if (moduleWidth < MIN_BARCODE_MODULE) {
          throw new Error(
            `Barcode for ${block.data.length} characters needs ${cells * MIN_BARCODE_MODULE} dots at two dots per bar but only ${contentWidth} are available; shorten the tracking number`,
          )
        }
        const x = alignedX(block.align ?? 'center', cells * moduleWidth)
        items.push({
          kind: 'bars',
          x: x + BARCODE_QUIET_MODULES * moduleWidth,
          y,
          moduleWidth,
          height,
          modules,
        })
        y += height + BARCODE_GAP
        break
      }
      default:
        assertNever(block)
    }
  }

  return { width, height: Math.ceil(y + marginY), items }
}
