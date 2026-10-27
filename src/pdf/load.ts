import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { contentBounds, dotsPerPoint, splitSlots, type GrayImage, type Rect } from './geometry'
import {
  findOrderNumber,
  itemsInRect,
  productTableTop,
  type TextItem,
} from './labelText'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PdfDocument = pdfjs.PDFDocumentProxy
type PdfPage = pdfjs.PDFPageProxy

export const LABEL_WIDTH_DOTS = 552
const DETECT_SCALE = 2
const BACKGROUND_THRESHOLD = 200

export interface LabelSource {
  pageNumber: number
  slotIndex: number
  slotCount: number
  bounds: Rect
  tableTop: number | null
  orderNumber: string | null
}

export function openPdf(data: ArrayBuffer): Promise<PdfDocument> {
  return pdfjs.getDocument({ data: new Uint8Array(data) }).promise
}

// Renders `region` (in page points) so that one point covers `scale` pixels.
async function renderRegion(page: PdfPage, region: Rect, scale: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(region.width * scale))
  canvas.height = Math.max(1, Math.round(region.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is not available')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const viewport = page.getViewport({
    scale,
    offsetX: -region.x * scale,
    offsetY: -region.y * scale,
  })
  await page.render({ canvas, viewport }).promise
  return canvas
}

function toGray(canvas: HTMLCanvasElement): GrayImage {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  const gray = new Uint8ClampedArray(canvas.width * canvas.height)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000
  }
  return { width: canvas.width, height: canvas.height, data: gray }
}

export async function extractLabels(pdf: PdfDocument): Promise<LabelSource[]> {
  const labels: LabelSource[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const text = await page.getTextContent()
    const items: TextItem[] = text.items.flatMap((item) => ('str' in item ? [item] : []))
    const slots = splitSlots(base.width, base.height)
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex]
      const found = contentBounds(
        toGray(await renderRegion(page, slot, DETECT_SCALE)),
        BACKGROUND_THRESHOLD,
      )
      if (!found) continue
      const slotItems = itemsInRect(items, slot, base.height)
      labels.push({
        pageNumber,
        slotIndex,
        slotCount: slots.length,
        bounds: {
          x: slot.x + found.x / DETECT_SCALE,
          y: slot.y + found.y / DETECT_SCALE,
          width: found.width / DETECT_SCALE,
          height: found.height / DETECT_SCALE,
        },
        tableTop: productTableTop(slotItems, base.height),
        orderNumber: findOrderNumber(slotItems),
      })
    }
  }
  return labels
}

export async function renderLabel(
  pdf: PdfDocument,
  source: LabelSource,
  opts: { includeProducts: boolean },
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(source.pageNumber)
  let region = source.bounds
  const cut = source.tableTop
  if (!opts.includeProducts && cut !== null && cut > region.y && cut < region.y + region.height) {
    region = { ...region, height: cut - region.y }
  }
  return renderRegion(page, region, dotsPerPoint(region.width, LABEL_WIDTH_DOTS))
}
