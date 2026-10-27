# Shopee PDF Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop a Shopee shipping-label PDF into the app and print each label on the 72 mm printer: trimmed, scaled to fit, with a scannable order barcode added, and a scan check on the final 1-bit image.

**Architecture:** Pure helpers find label slots on the page, read the order number, resi number and product-table position from the PDF text layer, and plan the extra order barcode. A thin pdf.js layer renders each label region at exactly the printable width. A third app tab lists the labels with thumbnails, options and a print queue. An optional barcode decoder (zxing-wasm) verifies that the tracking barcode and order barcode still decode from the final 1-bit image.

**Tech Stack:** Vite, TypeScript (strict), Vitest, `pdfjs-dist` (PDF rendering and text layer), `zxing-wasm` (reader only, barcode check). Builds on the existing `render`, `encode`, `printer` and `app` modules.

**Spec:** `docs/superpowers/specs/2026-10-12-bt-printer-web-app-design.md` (milestone 4). Samples and measurements: `docs/printer-findings.md`, section "Shopee shipping label PDFs".

**Scope note:** This plan covers PDF import for Shopee labels only. CSV batch printing and sticker (gapped) mode are separate later plans. The three sample PDFs the owner supplied are A4 landscape with the label in the left half and a dashed cut line at the centre. They contain buyer names and addresses, so they must never be committed or copied into docs; the browser smoke check copies them into `.playwright-mcp/` (excluded from git) only.

## Global Constraints

- Print width is 576 dots; a label is rendered exactly 552 dots wide and centred, which leaves 12 dots of margin on each side.
- Landscape pages (width at least 1.2 times height) hold two label slots separated by a 6-point gap on each side of the centre; other pages hold one slot. A slot with no dark content is skipped.
- The order barcode is a fresh Code 128 (set B) drawn by the app at two dots per bar or wider; it is skipped, with a visible note, when the order number is missing, not printable ASCII, or too long to fit.
- Text-layer findings come from pdf.js text items; label pixels come from rendering the PDF region directly at the target scale, never from resampling a rendered image.
- Barcode verification decodes the thresholded final image with zxing-wasm in strict mode (no try-harder, rotate, invert or downscale).
- New dependencies are limited to `pdfjs-dist` and `zxing-wasm`.
- PDFs are user data: they are read in the browser only, never uploaded, never written to the repository.
- Commit messages must not mention any AI tool and must not carry attribution trailers.
- Code comments describe current behavior or invariants, never the editing history.

## Review Focus

- A landscape page with one label must yield one label, not two; a fully blank page must yield no labels and a clear message, not an error.
- A PDF whose text does not match Shopee's wording (another courier layout, scanned image) must still import and print: no order number means no extra barcode and no product-table crop, and toggles must not crash.
- An order number that cannot be drawn as a Code 128 barcode at two dots or more must skip the extra barcode with a visible note instead of failing the whole label.
- A corrupt, non-PDF or password-protected file must show an error and leave the app usable; selecting a new file must discard results from the previous one.
- Printing several selected labels must go one at a time, stop on cancel or failure, and keep the resync-after-failed-write behavior.

---

### Task 1: Page geometry and text-layer helpers

**Files:**
- Create: `src/pdf/geometry.ts`, `src/pdf/labelText.ts`
- Test: `tests/pdf/geometry.test.ts`, `tests/pdf/labelText.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/pdf/geometry.ts`: `interface Rect { x: number; y: number; width: number; height: number }`; `interface GrayImage { width: number; height: number; data: Uint8ClampedArray }` (one byte per pixel); `SLOT_GAP_PT = 6`; `splitSlots(pageWidth: number, pageHeight: number): Rect[]`; `contentBounds(img: GrayImage, threshold?: number): Rect | null` (pixel rectangle around every pixel darker than `threshold`, default 200; `null` when none); `dotsPerPoint(widthPt: number, targetDots: number): number`
  - `src/pdf/labelText.ts`: `interface TextItem { str: string; transform: number[]; width: number; height: number }`; `itemTop(item, pageHeight): number`; `itemsInRect(items, rect, pageHeight): TextItem[]`; `findOrderNumber(items): string | null`; `findResiNumber(items, pageHeight): string | null`; `productTableTop(items, pageHeight): number | null`

pdf.js text items use PDF space (origin bottom-left, `transform[4]` is x and `transform[5]` the baseline y). `itemTop` converts to page space (origin top-left): `pageHeight - transform[5] - height`. Order numbers appear as `No. Pesanan: <code>` or `No.Pesanan: <code>`, with `Pesan: (<code>)` as a fallback. The resi appears either in one item (`No. Resi: CM0195...`) or as a label item followed by a separate code item just below it. The product table starts at the item `Nama Produk`.

- [ ] **Step 1: Write the failing tests**

Create `tests/pdf/geometry.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { contentBounds, dotsPerPoint, splitSlots, type GrayImage } from '../../src/pdf/geometry'

function gray(width: number, height: number, paint: (x: number, y: number) => number): GrayImage {
  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = paint(x, y)
  return { width, height, data }
}

describe('splitSlots', () => {
  it('splits a landscape page into two slots either side of the cut line', () => {
    expect(splitSlots(842, 595)).toEqual([
      { x: 0, y: 0, width: 415, height: 595 },
      { x: 427, y: 0, width: 415, height: 595 },
    ])
  })

  it('keeps a portrait page as one slot', () => {
    expect(splitSlots(595, 842)).toEqual([{ x: 0, y: 0, width: 595, height: 842 }])
  })

  it('keeps a near-square page as one slot', () => {
    expect(splitSlots(600, 600)).toEqual([{ x: 0, y: 0, width: 600, height: 600 }])
  })
})

describe('contentBounds', () => {
  it('returns null for a blank image', () => {
    expect(contentBounds(gray(10, 6, () => 255))).toBeNull()
  })

  it('finds a single dark pixel', () => {
    const img = gray(10, 6, (x, y) => (x === 3 && y === 2 ? 0 : 255))
    expect(contentBounds(img)).toEqual({ x: 3, y: 2, width: 1, height: 1 })
  })

  it('wraps every dark pixel in one rectangle', () => {
    const img = gray(12, 8, (x, y) => ((x === 2 && y === 1) || (x === 5 && y === 3) ? 100 : 255))
    expect(contentBounds(img)).toEqual({ x: 2, y: 1, width: 4, height: 3 })
  })

  it('treats pixels at or above the threshold as background', () => {
    expect(contentBounds(gray(4, 4, () => 200))).toBeNull()
    expect(contentBounds(gray(4, 4, () => 199))).toEqual({ x: 0, y: 0, width: 4, height: 4 })
  })

  it('honors a custom threshold', () => {
    expect(contentBounds(gray(4, 4, () => 150), 100)).toBeNull()
  })
})

describe('dotsPerPoint', () => {
  it('divides the target width by the width in points', () => {
    expect(dotsPerPoint(276, 552)).toBe(2)
  })

  it('rejects a non-positive width', () => {
    expect(() => dotsPerPoint(0, 552)).toThrow(RangeError)
    expect(() => dotsPerPoint(-5, 552)).toThrow(RangeError)
  })
})
```

Create `tests/pdf/labelText.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  findOrderNumber,
  findResiNumber,
  itemTop,
  itemsInRect,
  productTableTop,
  type TextItem,
} from '../../src/pdf/labelText'

const PAGE_H = 595
const item = (str: string, x: number, baseline: number, height = 8): TextItem => ({
  str,
  transform: [1, 0, 0, 1, x, baseline],
  width: 10,
  height,
})

describe('itemTop', () => {
  it('converts the PDF baseline to a top edge in page space', () => {
    expect(itemTop(item('x', 0, 252, 7.5), PAGE_H)).toBe(335.5)
  })
})

describe('itemsInRect', () => {
  it('keeps only items whose origin lies inside the rectangle', () => {
    const left = item('left', 100, 300)
    const right = item('right', 600, 300)
    const rect = { x: 0, y: 0, width: 415, height: 595 }
    expect(itemsInRect([left, right], rect, PAGE_H)).toEqual([left])
  })
})

describe('findOrderNumber', () => {
  it('reads the number after "No. Pesanan:"', () => {
    expect(findOrderNumber([item('No. Pesanan: 260101TESTAA01', 9, 270)])).toBe('260101TESTAA01')
  })

  it('accepts the variant without a space after the dot', () => {
    expect(findOrderNumber([item('No.Pesanan: 260101TESTBB02', 12, 300)])).toBe('260101TESTBB02')
  })

  it('falls back to the "Pesan: (...)" line', () => {
    expect(findOrderNumber([item('Pesan: (260101TESTCC03)', 5, 215)])).toBe('260101TESTCC03')
  })

  it('prefers the labelled number over the fallback', () => {
    const items = [item('Pesan: (WRONG)', 5, 215), item('No. Pesanan: RIGHT123', 9, 270)]
    expect(findOrderNumber(items)).toBe('RIGHT123')
  })

  it('returns null when neither form is present', () => {
    expect(findOrderNumber([item('Berat: 500 gr', 9, 300)])).toBeNull()
  })
})

describe('findResiNumber', () => {
  it('reads a resi that is in the same text item as its label', () => {
    expect(findResiNumber([item('No. Resi: CM00000000001', 207, 540, 12.7)], PAGE_H)).toBe(
      'CM00000000001',
    )
  })

  it('reads a resi in a separate item just below the label and ignores repeated copies elsewhere', () => {
    const items = [
      item('No. Resi:', 313, 526, 10.5),
      item('SPXID000000000001', 285, 515.5, 10.5),
      item('SPXID000000000001', 412, 541.5, 10.5),
      item('SPXID000000000001', 412, 443.5, 10.5),
    ]
    expect(findResiNumber(items, PAGE_H)).toBe('SPXID000000000001')
  })

  it('returns null when the label has no code near it', () => {
    expect(findResiNumber([item('No. Resi:', 313, 526, 10.5)], PAGE_H)).toBeNull()
  })

  it('returns null when there is no resi label at all', () => {
    expect(findResiNumber([item('Berat: 500 gr', 9, 300)], PAGE_H)).toBeNull()
  })
})

describe('productTableTop', () => {
  it('returns the top edge of the "Nama Produk" header', () => {
    expect(productTableTop([item('Nama Produk', 43, 252, 7.5)], PAGE_H)).toBe(335.5)
  })

  it('returns null when the header is absent', () => {
    expect(productTableTop([item('Berat', 9, 300)], PAGE_H)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/pdf`
Expected: FAIL, modules `../../src/pdf/geometry` and `../../src/pdf/labelText` cannot be resolved.

- [ ] **Step 3: Implement geometry**

Create `src/pdf/geometry.ts`:
```ts
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface GrayImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export const SLOT_GAP_PT = 6

// Landscape pages carry two labels side by side with a cut line at the centre;
// any other page carries one.
export function splitSlots(pageWidth: number, pageHeight: number): Rect[] {
  if (pageWidth >= pageHeight * 1.2) {
    const half = pageWidth / 2
    const width = half - SLOT_GAP_PT
    return [
      { x: 0, y: 0, width, height: pageHeight },
      { x: half + SLOT_GAP_PT, y: 0, width, height: pageHeight },
    ]
  }
  return [{ x: 0, y: 0, width: pageWidth, height: pageHeight }]
}

export function contentBounds(img: GrayImage, threshold = 200): Rect | null {
  let minX = img.width
  let minY = img.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[y * img.width + x] < threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

export function dotsPerPoint(widthPt: number, targetDots: number): number {
  if (!(widthPt > 0)) throw new RangeError(`widthPt must be positive, got ${widthPt}`)
  return targetDots / widthPt
}
```

- [ ] **Step 4: Implement the text helpers**

Create `src/pdf/labelText.ts`:
```ts
import type { Rect } from './geometry'

export interface TextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

// pdf.js places text in PDF space (origin bottom-left, y is the baseline); this
// returns the top edge in page space (origin top-left).
export function itemTop(item: TextItem, pageHeight: number): number {
  return pageHeight - item.transform[5] - item.height
}

export function itemsInRect(items: TextItem[], rect: Rect, pageHeight: number): TextItem[] {
  return items.filter((item) => {
    const x = item.transform[4]
    const top = itemTop(item, pageHeight)
    return x >= rect.x && x < rect.x + rect.width && top >= rect.y && top < rect.y + rect.height
  })
}

const ORDER = /No\.?\s*Pesanan\s*:?\s*([A-Za-z0-9]+)/i
const ORDER_FALLBACK = /Pesan\s*:\s*\(([A-Za-z0-9]+)\)/i

export function findOrderNumber(items: TextItem[]): string | null {
  for (const item of items) {
    const match = ORDER.exec(item.str)
    if (match) return match[1]
  }
  for (const item of items) {
    const match = ORDER_FALLBACK.exec(item.str)
    if (match) return match[1]
  }
  return null
}

const RESI = /No\.?\s*Resi\s*:?\s*([A-Za-z0-9]+)/i
const RESI_LABEL = /^\s*No\.?\s*Resi\s*:?\s*$/i
const CODE = /^[A-Za-z0-9]{8,}$/

// Some layouts put the code in its own item below the "No. Resi:" label, and
// repeat it elsewhere on the page; only a code just below the label counts.
export function findResiNumber(items: TextItem[], pageHeight: number): string | null {
  for (const item of items) {
    const match = RESI.exec(item.str)
    if (match) return match[1]
  }
  const label = items.find((item) => RESI_LABEL.test(item.str))
  if (!label) return null
  const labelTop = itemTop(label, pageHeight)
  let best: { text: string; distance: number } | null = null
  for (const item of items) {
    const text = item.str.trim()
    if (!CODE.test(text)) continue
    const dy = itemTop(item, pageHeight) - labelTop
    const dx = Math.abs(item.transform[4] - label.transform[4])
    if (dy < 0 || dy > 25 || dx > 120) continue
    const distance = dy + dx
    if (!best || distance < best.distance) best = { text, distance }
  }
  return best?.text ?? null
}

export function productTableTop(items: TextItem[], pageHeight: number): number | null {
  const header = items.find((item) => /^\s*Nama Produk\s*$/i.test(item.str))
  return header ? itemTop(header, pageHeight) : null
}
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/pdf tests/pdf
git commit -m "feat: add page slot geometry and label text-layer helpers"
```

---

### Task 2: Order barcode strip

**Files:**
- Create: `src/pdf/orderStrip.ts`
- Test: `tests/pdf/orderStrip.test.ts`

**Interfaces:**
- Consumes: `DocumentModel` (`src/render/types.ts`), `layoutDocument` (`src/render/layout.ts`).
- Produces (from `src/pdf/orderStrip.ts`): `orderStripDocument(order: string | null): DocumentModel | null`, a document with a centred Code 128 barcode of the order number (height 64) and a caption `Pesanan <order>` (size 22), or `null` when the order number is missing or cannot be drawn.

The strip is validated by laying it out with an approximate text measurer: layout rejects barcodes that need bars thinner than two dots or are not printable ASCII, and that rejection is what makes this function return `null`. The 552-dot content width allows order numbers up to 20 characters.

- [ ] **Step 1: Write the failing tests**

Create `tests/pdf/orderStrip.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { orderStripDocument } from '../../src/pdf/orderStrip'

describe('orderStripDocument', () => {
  it('builds a centred barcode plus caption for a normal order number', () => {
    expect(orderStripDocument('260101TESTAA01')).toEqual({
      marginY: 4,
      blocks: [
        { type: 'barcode', data: '260101TESTAA01', height: 64, align: 'center' },
        { type: 'text', text: 'Pesanan 260101TESTAA01', size: 22, align: 'center' },
      ],
    })
  })

  it('accepts the longest order number that fits at two dots per bar', () => {
    expect(orderStripDocument('A'.repeat(20))).not.toBeNull()
  })

  it('returns null when the order number is too long to draw at two dots per bar', () => {
    expect(orderStripDocument('A'.repeat(21))).toBeNull()
  })

  it('returns null for a missing or empty order number', () => {
    expect(orderStripDocument(null)).toBeNull()
    expect(orderStripDocument('')).toBeNull()
  })

  it('returns null when the order number is not printable ASCII', () => {
    expect(orderStripDocument('PESANAN-É')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/pdf/orderStrip.test.ts`
Expected: FAIL, `../../src/pdf/orderStrip` cannot be resolved.

- [ ] **Step 3: Implement the strip**

Create `src/pdf/orderStrip.ts`:
```ts
import { layoutDocument } from '../render/layout'
import type { DocumentModel } from '../render/types'

// Shopee's own order barcode is too small to scan once the label is scaled to the
// printer width, so a fresh one is drawn at a width the printer can reproduce.
export function orderStripDocument(order: string | null): DocumentModel | null {
  if (!order) return null
  const doc: DocumentModel = {
    marginY: 4,
    blocks: [
      { type: 'barcode', data: order, height: 64, align: 'center' },
      { type: 'text', text: `Pesanan ${order}`, size: 22, align: 'center' },
    ],
  }
  try {
    // Layout throws for text outside Code 128 set B or a barcode that needs bars
    // thinner than two dots; the measurer only has to be roughly right for the caption.
    layoutDocument(doc, (text, size) => text.length * size * 0.5)
  } catch {
    return null
  }
  return doc
}
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/pdf/orderStrip.ts tests/pdf/orderStrip.test.ts
git commit -m "feat: add the order barcode strip for imported labels"
```

---

### Task 3: PDF import in the app

**Files:**
- Create: `src/pdf/load.ts`, `src/pdf/compose.ts`, `src/app/monoCanvas.ts`, `src/app/importView.ts`
- Modify: `src/app/app.ts` (full replacement below), `src/app/style.css` (append)

**Interfaces:**
- Consumes: Task 1 (`splitSlots`, `contentBounds`, `dotsPerPoint`, `Rect`, `GrayImage`, `TextItem`, `itemsInRect`, `findOrderNumber`, `findResiNumber`, `productTableTop`), Task 2 (`orderStripDocument`), existing `renderDocument`, `monoPreview`, `printImage`, `exclusive`, `el`, `field`, `FormView`.
- Produces:
  - `src/pdf/load.ts`: `type PdfDocument`; `LABEL_WIDTH_DOTS = 552`; `interface LabelSource { pageNumber: number; slotIndex: number; slotCount: number; bounds: Rect; tableTop: number | null; orderNumber: string | null; resiNumber: string | null }` (`bounds` is the trimmed label area in page points); `openPdf(data: ArrayBuffer): Promise<PdfDocument>`; `extractLabels(pdf): Promise<LabelSource[]>`; `renderLabel(pdf, source, opts: { includeProducts: boolean }): Promise<HTMLCanvasElement>` (a canvas exactly 552 dots wide)
  - `src/pdf/compose.ts`: `composeLabel(label: HTMLCanvasElement, strip: HTMLCanvasElement | null): HTMLCanvasElement` (a 576-dot-wide canvas: the label centred with an 8-dot margin, the strip stacked under it)
  - `src/app/monoCanvas.ts`: `drawMonoPreview(source: HTMLCanvasElement, target: HTMLCanvasElement): void`
  - `src/app/importView.ts`: `interface ImportView { element: HTMLElement; onChange(cb: () => void): void; previewCanvas(): HTMLCanvasElement | null; selectedCount(): number; renderSelected(): Promise<HTMLCanvasElement[]> }`; `createImportView(): ImportView`

This task is browser-only (pdf.js and canvas), so it has no unit tests; its checks are typecheck, a production build and the browser smoke check in Step 8, which uses the real sample PDFs. Slots are found by rendering each slot region at 2 pixels per point, taking the bounds of everything darker than 200, and converting back to points; text-layer items are matched to a slot by their origin. The product table is cut off by clipping the region at the top edge of the `Nama Produk` header. The import tab keeps one preview in the main preview pane (click a thumbnail to choose which) and prints every ticked label one after another.

- [ ] **Step 1: Install pdf.js**

Run:
```bash
npm install pdfjs-dist
```
Expected: installs with no vulnerabilities reported.

- [ ] **Step 2: Write the PDF loading and rendering module**

Create `src/pdf/load.ts`:
```ts
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { contentBounds, dotsPerPoint, splitSlots, type GrayImage, type Rect } from './geometry'
import {
  findOrderNumber,
  findResiNumber,
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
  resiNumber: string | null
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
        resiNumber: findResiNumber(slotItems, base.height),
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
```

Create `src/pdf/compose.ts`:
```ts
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
```

- [ ] **Step 3: Write the mono preview helper**

Create `src/app/monoCanvas.ts`:
```ts
import { monoPreview } from '../encode/raster'

// Draws `source` onto `target` as the black-and-white image the printer will receive.
export function drawMonoPreview(source: HTMLCanvasElement, target: HTMLCanvasElement): void {
  const img = source.getContext('2d')!.getImageData(0, 0, source.width, source.height)
  target.width = source.width
  target.height = source.height
  target.getContext('2d')!.putImageData(new ImageData(monoPreview(img), img.width, img.height), 0, 0)
}
```

- [ ] **Step 4: Write the import view**

Create `src/app/importView.ts`:
```ts
import { composeLabel } from '../pdf/compose'
import { extractLabels, openPdf, renderLabel, type LabelSource, type PdfDocument } from '../pdf/load'
import { orderStripDocument } from '../pdf/orderStrip'
import { renderDocument } from '../render/render'
import { el, field } from './dom'
import { drawMonoPreview } from './monoCanvas'

export interface ImportView {
  element: HTMLElement
  onChange(cb: () => void): void
  previewCanvas(): HTMLCanvasElement | null
  selectedCount(): number
  renderSelected(): Promise<HTMLCanvasElement[]>
}

interface Entry {
  source: LabelSource
  row: HTMLElement
  include: HTMLInputElement
  thumb: HTMLCanvasElement
  note: HTMLElement
  canvas: HTMLCanvasElement | null
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function createImportView(): ImportView {
  const listeners: Array<() => void> = []
  const notify = () => listeners.forEach((cb) => cb())
  let pdf: PdfDocument | null = null
  let entries: Entry[] = []
  let previewIndex = 0
  let fileToken = 0
  let generation = 0
  let rendering: Promise<void> = Promise.resolve()

  const fileInput = el('input', { type: 'file', accept: 'application/pdf,.pdf' })
  const includeProducts = el('input', { type: 'checkbox', checked: true })
  const addOrderBarcode = el('input', { type: 'checkbox', checked: true })
  const statusEl = el('p', {
    className: 'import-status',
    textContent: 'Choose a Shopee shipping label PDF.',
  })
  const list = el('div', { className: 'import-list' })

  function markPreview(): void {
    entries.forEach((entry, i) => entry.row.classList.toggle('preview', i === previewIndex))
  }

  function makeEntry(source: LabelSource): Entry {
    const include = el('input', { type: 'checkbox', checked: true })
    const where = source.slotCount > 1 ? (source.slotIndex === 0 ? ', left' : ', right') : ''
    const order = source.orderNumber ? ` - order ${source.orderNumber}` : ''
    const title = el('span', { textContent: `Page ${source.pageNumber}${where}${order}` })
    const thumb = el('canvas', { className: 'thumb' })
    const note = el('p', { className: 'note' })
    const row = el('div', { className: 'entry' }, [el('label', {}, [include, title]), thumb, note])
    const entry: Entry = { source, row, include, thumb, note, canvas: null }
    include.addEventListener('change', notify)
    thumb.addEventListener('click', () => {
      previewIndex = entries.indexOf(entry)
      markPreview()
      notify()
    })
    return entry
  }

  async function build(
    entry: Entry,
    document_: PdfDocument,
  ): Promise<{ canvas: HTMLCanvasElement; notes: string[] }> {
    const notes: string[] = []
    const label = await renderLabel(document_, entry.source, {
      includeProducts: includeProducts.checked,
    })
    let strip: HTMLCanvasElement | null = null
    if (addOrderBarcode.checked) {
      const order = entry.source.orderNumber
      if (!order) {
        notes.push('No order number found in the PDF text, so no order barcode was added.')
      } else {
        const doc = orderStripDocument(order)
        if (doc) strip = renderDocument(doc)
        else notes.push(`Order number ${order} cannot be drawn as a Code 128 barcode at this width.`)
      }
    }
    return { canvas: composeLabel(label, strip), notes }
  }

  function renderAll(): Promise<void> {
    const mine = ++generation
    const target = pdf
    rendering = (async () => {
      if (!target) return
      for (const entry of entries) {
        try {
          const { canvas, notes } = await build(entry, target)
          if (mine !== generation) return
          entry.canvas = canvas
          drawMonoPreview(canvas, entry.thumb)
          entry.note.textContent = notes.join(' ')
        } catch (err) {
          if (mine !== generation) return
          entry.canvas = null
          entry.note.textContent = `Could not render this label: ${message(err)}`
        }
      }
      if (mine === generation) notify()
    })()
    return rendering
  }

  fileInput.addEventListener('change', async () => {
    const token = ++fileToken
    generation++
    pdf = null
    entries = []
    previewIndex = 0
    list.replaceChildren()
    const file = fileInput.files?.[0]
    if (!file) {
      statusEl.textContent = 'Choose a Shopee shipping label PDF.'
      notify()
      return
    }
    statusEl.textContent = `Reading ${file.name}...`
    notify()
    try {
      const opened = await openPdf(await file.arrayBuffer())
      const sources = await extractLabels(opened)
      if (token !== fileToken) return
      pdf = opened
      entries = sources.map(makeEntry)
      list.replaceChildren(...entries.map((entry) => entry.row))
      markPreview()
      statusEl.textContent =
        sources.length === 0
          ? 'No labels found: the pages look blank.'
          : `${sources.length} label${sources.length === 1 ? '' : 's'} found.`
      notify()
      await renderAll()
    } catch (err) {
      if (token !== fileToken) return
      statusEl.textContent = `Could not read the PDF: ${message(err)}`
      notify()
    }
  })
  includeProducts.addEventListener('change', () => void renderAll())
  addOrderBarcode.addEventListener('change', () => void renderAll())

  const element = el('div', { className: 'form' })
  element.append(
    field('PDF file', fileInput),
    field('Include product list', includeProducts),
    field('Add order barcode', addOrderBarcode),
    statusEl,
    list,
  )

  return {
    element,
    onChange: (cb) => {
      listeners.push(cb)
    },
    previewCanvas: () => entries[previewIndex]?.canvas ?? null,
    selectedCount: () => entries.filter((e) => e.include.checked && e.canvas !== null).length,
    renderSelected: async () => {
      await rendering
      return entries.flatMap((e) => (e.include.checked && e.canvas ? [e.canvas] : []))
    },
  }
}
```

- [ ] **Step 5: Replace the app shell**

Replace `src/app/app.ts` with:
```ts
import { PrintInterruptedError } from '../printer/send'
import { WebBluetoothPrinter } from '../printer/webBluetooth'
import { renderDocument } from '../render/render'
import { buildLabel } from '../templates/label'
import { buildReceipt } from '../templates/receipt'
import { exclusive } from '../util/exclusive'
import { parseLabelForm, parseReceiptForm } from './forms'
import { createImportView } from './importView'
import { createLabelForm } from './labelForm'
import { drawMonoPreview } from './monoCanvas'
import { printImage } from './print'
import { createReceiptForm } from './receiptForm'

type Mode = 'receipt' | 'label' | 'import'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function createApp(root: HTMLElement): void {
  const printer = new WebBluetoothPrinter()
  const forms = {
    receipt: createReceiptForm(),
    label: createLabelForm(),
    import: createImportView(),
  }
  let mode: Mode = 'receipt'
  let current: HTMLCanvasElement | null = null
  let abort: AbortController | null = null
  let busy = false
  // A write that failed mid-band can leave the printer waiting for the rest of that band.
  let needsResync = false

  root.innerHTML = `
    <header>
      <h1>bt-printer</h1>
      <nav>
        <button data-mode="receipt">Receipt</button>
        <button data-mode="label">Shipping label</button>
        <button data-mode="import">Import PDF</button>
      </nav>
    </header>
    <div class="cols">
      <section id="form"></section>
      <section class="side">
        <div class="panel">
          <button id="connect">Connect printer</button>
          <span id="conn">Not connected</span>
          <label>Paper
            <select id="paper">
              <option value="continuous">Continuous roll</option>
              <option value="sticker" disabled>Sticker roll (not supported yet)</option>
            </select>
          </label>
        </div>
        <div class="preview">
          <canvas id="preview" width="576" height="16"></canvas>
          <p id="error" role="alert"></p>
        </div>
        <div class="panel">
          <button id="print" disabled>Print</button>
          <button id="cancel" disabled>Cancel</button>
          <progress id="progress" value="0" max="1"></progress>
          <pre id="log"></pre>
        </div>
      </section>
    </div>
  `
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const formHost = q('#form')
  const preview = q<HTMLCanvasElement>('#preview')
  const errorEl = q('#error')
  const connectBtn = q<HTMLButtonElement>('#connect')
  const connEl = q('#conn')
  const printBtn = q<HTMLButtonElement>('#print')
  const cancelBtn = q<HTMLButtonElement>('#cancel')
  const progress = q<HTMLProgressElement>('#progress')
  const logEl = q('#log')

  const log = (text: string) => {
    logEl.textContent += `${new Date().toLocaleTimeString()}  ${text}\n`
    logEl.scrollTop = logEl.scrollHeight
  }

  function updateButtons(): void {
    const ready = mode === 'import' ? forms.import.selectedCount() > 0 : current !== null
    connEl.textContent = printer.connected ? 'Connected' : 'Not connected'
    connectBtn.textContent = printer.connected ? 'Disconnect' : 'Connect printer'
    connectBtn.disabled = busy
    printBtn.disabled = busy || !printer.connected || !ready
    cancelBtn.disabled = !busy || abort === null
  }

  function refresh(): void {
    try {
      if (mode === 'import') {
        current = forms.import.previewCanvas()
        if (current) drawMonoPreview(current, preview)
        errorEl.textContent = ''
      } else {
        const doc =
          mode === 'receipt'
            ? buildReceipt(parseReceiptForm(forms.receipt.read()))
            : buildLabel(parseLabelForm(forms.label.read()))
        const canvas = renderDocument(doc)
        drawMonoPreview(canvas, preview)
        current = canvas
        errorEl.textContent = ''
      }
    } catch (err) {
      current = null
      errorEl.textContent = message(err)
    }
    updateButtons()
  }

  function setMode(next: Mode): void {
    mode = next
    formHost.replaceChildren(forms[next].element)
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === next)
    })
    refresh()
  }

  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.mode as Mode))
  })
  forms.receipt.onChange(refresh)
  forms.label.onChange(refresh)
  forms.import.onChange(refresh)
  printer.onDisconnected(() => {
    log('Printer disconnected')
    updateButtons()
  })

  const onBusy = () => log('Busy: wait for the current operation to finish')

  const toggleConnection = exclusive(async () => {
    if (printer.connected) {
      printer.disconnect()
      log('Disconnected')
      updateButtons()
      return
    }
    busy = true
    updateButtons()
    try {
      await printer.connect()
      log('Connected')
    } catch (err) {
      log(`Connect failed: ${message(err)}`)
    } finally {
      busy = false
      updateButtons()
    }
  }, onBusy)
  connectBtn.addEventListener('click', () => void toggleConnection())

  const doPrint = exclusive(async () => {
    const canvases =
      mode === 'import' ? await forms.import.renderSelected() : current ? [current] : []
    if (canvases.length === 0) return
    abort = new AbortController()
    busy = true
    progress.value = 0
    updateButtons()
    try {
      for (const [index, canvas] of canvases.entries()) {
        if (canvases.length > 1) log(`Printing label ${index + 1} of ${canvases.length}`)
        const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
        const outcome = await printImage(printer, img, {
          confirmWarnings: async (warnings) =>
            window.confirm(`${warnings.join('\n')}\n\nPrint anyway?`),
          onProgress: (sent, total) => {
            progress.max = total
            progress.value = sent
          },
          signal: abort.signal,
          resyncFirst: needsResync,
        })
        if (outcome !== 'printed') {
          log('Cancelled before printing')
          return
        }
        needsResync = false
      }
      log(canvases.length > 1 ? `Printed ${canvases.length} labels` : 'Printed')
    } catch (err) {
      if (err instanceof PrintInterruptedError) {
        if (err.reason === 'write-failed') needsResync = true
        log(`Print ${err.reason} after ${err.bytesSent} of ${err.totalBytes} bytes; cause: ${String(err.cause)}`)
      } else {
        log(`Print failed: ${message(err)}`)
      }
    } finally {
      abort = null
      busy = false
      updateButtons()
    }
  }, onBusy)
  printBtn.addEventListener('click', () => void doPrint())
  cancelBtn.addEventListener('click', () => {
    abort?.abort()
    log('Cancelling after the current band')
  })

  setMode('receipt')
}
```

Append to `src/app/style.css`:
```css
.import-list { display: grid; gap: 12px; margin-top: 8px; }
.entry { border: 1px solid #d4d4d8; border-radius: 6px; padding: 8px; }
.entry.preview { outline: 2px solid #2563eb; }
.thumb { display: block; width: 100%; max-width: 280px; height: auto; margin-top: 6px; border: 1px dashed #a1a1aa; cursor: pointer; background: #fff; }
.note, .import-status { margin: 6px 0 0; color: #52525b; }
```

- [ ] **Step 6: Typecheck, test and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck exits 0, all tests PASS, build succeeds. If `page.render({ canvas, viewport })` is rejected by the types, add `canvasContext: ctx` as well. If the `?url` worker import fails to resolve, check the file name in `node_modules/pdfjs-dist/build/`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src spike.html
git commit -m "feat: import Shopee shipping label PDFs in a new app tab"
```

- [ ] **Step 8: Browser smoke check with the real sample PDFs**

Copy the three sample PDFs into the git-excluded folder so the browser tool may read them (they contain buyer details, so never `git add` them):
```bash
mkdir -p .playwright-mcp/samples
cp "/Users/rsalim/.paseo/uploads/upload_50c5dcd1-201d-4bf5-bf7d-b2a9f6a0b803/Label Pengiriman.pdf" .playwright-mcp/samples/jne.pdf
cp "/Users/rsalim/.paseo/uploads/upload_373e3161-3530-42b9-9e53-c449a8903039/Label Pengiriman (2).pdf" .playwright-mcp/samples/spx2.pdf
cp "/Users/rsalim/.paseo/uploads/upload_e9a14c4e-e116-416d-b528-688897f713ee/Label Pengiriman (1).pdf" .playwright-mcp/samples/spx1.pdf
```
Run `npm run dev -- --port 5173` in the background. With the Playwright MCP tools (load `browser_file_upload` through ToolSearch), open `http://localhost:5173`, click the "Import PDF" tab and upload each sample in turn into the file input. For each, verify with `browser_evaluate`:
1. exactly one `.entry` (the right-hand slot is empty), whose title contains the expected order number: `260101TESTAA01` for `jne.pdf`, `260101TESTBB02` for `spx2.pdf`, `260101TESTCC03` for `spx1.pdf`;
2. the preview canvas is 576 pixels wide and more than 600 pixels tall, with more than 20000 dark pixels;
3. unticking "Include product list" makes the preview shorter, and unticking "Add order barcode" makes it shorter again;
4. no entry note mentions a missing order number.
Then upload a non-PDF file (for example `docs/printer-findings.md`) and verify the status line starts with "Could not read the PDF" and the app still responds. Take a screenshot of the preview for the JNE and one SPX label and look for clipped or overlapping content.
Expected: all four checks hold for all three files. Stop the dev server afterwards.

- [ ] **Step 9: Record the result**

If Step 8 needed code changes, commit them with a message describing the fix (write a failing unit test first when the defect is in `geometry`, `labelText` or `orderStrip`). Then run `npm run typecheck && npm test && npm run build` once more.
Expected: all green.

---

### Task 4: Barcode scan check

**Files:**
- Create: `src/pdf/scanCheck.ts`, `src/pdf/zxingSetup.ts`, `tests/helpers/rasterize.ts`
- Test: `tests/pdf/scanCheck.test.ts`
- Modify: `src/app/importView.ts`, `src/app/style.css` (append)

**Interfaces:**
- Consumes: `monoPreview`, `RgbaImage` (`src/encode/raster.ts`), `Layout` (`src/render/layout.ts`), `layoutDocument`, `LabelSource.resiNumber`/`orderNumber` (Task 3).
- Produces:
  - `src/pdf/scanCheck.ts`: `interface ScanResult { found: string[]; missing: string[] }`; `compareScan(expected: string[], found: string[]): ScanResult`; `scanCheck(img: RgbaImage, expected: string[]): Promise<ScanResult>` (decodes Code 128 and QR codes from the thresholded image in strict mode)
  - `src/pdf/zxingSetup.ts`: `setupZXing(): Promise<unknown>`, browser-only; points the decoder at the bundled wasm file instead of its default CDN
  - `tests/helpers/rasterize.ts`: `rasterize(layout: Layout): RgbaImage`, drawing rects, QR modules and barcode bars on white

The check runs on the exact 1-bit image that will print, so it also confirms that the app's own order barcode and QR encoders are readable by an independent decoder. The expected codes are the resi number (when found in the PDF text) and, when the order barcode strip was added, the order number. A missing expectation never blocks printing; it is shown in red next to the label.

- [ ] **Step 1: Install the decoder**

Run:
```bash
npm install zxing-wasm
```
Expected: installs with no vulnerabilities reported.

- [ ] **Step 2: Write the failing tests**

Create `tests/helpers/rasterize.ts`:
```ts
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
```

Create `tests/pdf/scanCheck.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { compareScan, scanCheck } from '../../src/pdf/scanCheck'
import { layoutDocument } from '../../src/render/layout'
import { rasterize } from '../helpers/rasterize'

const measure = (text: string, size: number) => text.length * size * 0.5

describe('compareScan', () => {
  it('lists expected codes that were not found', () => {
    expect(compareScan(['A', 'B'], ['B'])).toEqual({ found: ['B'], missing: ['A'] })
  })

  it('collapses duplicate decodes and reports nothing missing when all are found', () => {
    expect(compareScan(['A'], ['A', 'A'])).toEqual({ found: ['A'], missing: [] })
  })

  it('reports everything missing when nothing was decoded', () => {
    expect(compareScan(['A', 'B'], [])).toEqual({ found: [], missing: ['A', 'B'] })
  })
})

describe('scanCheck', () => {
  it('reads back a Code 128 barcode and a QR code drawn by the layout engine', async () => {
    const layout = layoutDocument(
      {
        blocks: [
          { type: 'barcode', data: '260101TESTAA01' },
          { type: 'qr', data: 'SPXID000000000001' },
        ],
      },
      measure,
    )
    const result = await scanCheck(rasterize(layout), ['260101TESTAA01', 'SPXID000000000001'])
    expect(result.missing).toEqual([])
    expect(result.found.sort()).toEqual(['260101TESTAA01', 'SPXID000000000001'])
  })

  it('reports an expected code that is not in the image', async () => {
    const layout = layoutDocument({ blocks: [{ type: 'barcode', data: 'ABC12345' }] }, measure)
    const result = await scanCheck(rasterize(layout), ['ABC12345', 'NOT-THERE'])
    expect(result.missing).toEqual(['NOT-THERE'])
  })

  it('finds nothing in a blank image', async () => {
    const layout = layoutDocument({ blocks: [{ type: 'spacer', height: 100 }] }, measure)
    const result = await scanCheck(rasterize(layout), ['ABC12345'])
    expect(result).toEqual({ found: [], missing: ['ABC12345'] })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/pdf/scanCheck.test.ts`
Expected: FAIL, `../../src/pdf/scanCheck` cannot be resolved.

- [ ] **Step 4: Implement the scan check**

Create `src/pdf/scanCheck.ts`:
```ts
import { readBarcodes } from 'zxing-wasm/reader'
import { monoPreview, type RgbaImage } from '../encode/raster'

// Strict decoding stands in for a basic handheld scanner: no extra effort,
// rotation, inversion or downscaling.
const STRICT = {
  tryHarder: false,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: false,
  formats: ['Code128', 'QRCode'] as Array<'Code128' | 'QRCode'>,
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

export async function scanCheck(img: RgbaImage, expected: string[]): Promise<ScanResult> {
  const mono = { width: img.width, height: img.height, data: monoPreview(img) }
  // The decoder only reads width, height and data, so a plain object stands in
  // for the browser ImageData type that Node does not have.
  const results = await readBarcodes(mono as unknown as ImageData, STRICT)
  return compareScan(expected, results.map((result) => result.text))
}
```

Create `src/pdf/zxingSetup.ts`:
```ts
import { prepareZXingModule } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

let ready: Promise<unknown> | null = null

// By default the decoder fetches its wasm file from a CDN; serve the bundled copy instead.
export function setupZXing(): Promise<unknown> {
  ready ??= Promise.resolve(
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
      },
      fireImmediately: true,
    }),
  )
  return ready
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck exits 0. If `readBarcodes` rejects the option object type, widen it with `as const` on the format list.

- [ ] **Step 6: Show the scan result next to each label**

In `src/app/importView.ts`, add these imports after the existing ones:
```ts
import { scanCheck } from '../pdf/scanCheck'
import { setupZXing } from '../pdf/zxingSetup'
```
Add `scan: HTMLElement` to `interface Entry`, create it in `makeEntry` and include it in the row:
```ts
    const scan = el('p', { className: 'scan' })
    const row = el('div', { className: 'entry' }, [el('label', {}, [include, title]), thumb, note, scan])
    const entry: Entry = { source, row, include, thumb, note, scan, canvas: null }
```
Change `build` to also return the codes it expects, by replacing its return statement and adding an `expected` list:
```ts
    const expected = [entry.source.resiNumber, strip ? entry.source.orderNumber : null].filter(
      (value): value is string => value !== null,
    )
    return { canvas: composeLabel(label, strip), notes, expected }
```
and its return type with `{ canvas: HTMLCanvasElement; notes: string[]; expected: string[] }`. Add this helper above `renderAll`:
```ts
  async function checkScan(entry: Entry, canvas: HTMLCanvasElement, expected: string[]): Promise<void> {
    entry.scan.className = 'scan'
    if (expected.length === 0) {
      entry.scan.textContent = 'Scan check skipped: no tracking number found in the PDF text.'
      return
    }
    entry.scan.textContent = 'Checking barcodes...'
    try {
      await setupZXing()
      const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
      const { missing } = await scanCheck(img, expected)
      if (missing.length === 0) {
        entry.scan.textContent = `Scan check passed: ${expected.join(', ')} readable.`
      } else {
        entry.scan.className = 'scan fail'
        entry.scan.textContent = `Scan check FAILED: could not read ${missing.join(', ')} from the printed image.`
      }
    } catch (err) {
      entry.scan.textContent = `Scan check unavailable: ${message(err)}`
    }
  }
```
In `renderAll`, destructure `expected` from `await build(...)` and call `await checkScan(entry, canvas, expected)` right after `entry.note.textContent = notes.join(' ')`, guarded by `if (mine !== generation) return` afterwards.

Append to `src/app/style.css`:
```css
.scan { margin: 6px 0 0; color: #166534; }
.scan.fail { color: #b91c1c; font-weight: 600; }
```

- [ ] **Step 7: Typecheck, test and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck exits 0, all tests PASS, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src tests
git commit -m "feat: check that imported labels still scan after fitting"
```

- [ ] **Step 9: Browser smoke check of the scan result**

With the dev server running and the samples still in `.playwright-mcp/samples/`, upload each sample on the Import PDF tab and read the `.scan` text of its entry.
Expected: each reads `Scan check passed:` followed by its codes, which are the resi and the order number: `CM00000000001, 260101TESTAA01` for `jne.pdf`, `SPXID000000000001, 260101TESTBB02` for `spx2.pdf`, `SPXID000000000002, 260101TESTCC03` for `spx1.pdf`. Then untick "Add order barcode" and check the line drops the order number. If a tracking barcode fails the check in the browser render although the earlier poppler test passed, record that in `docs/printer-findings.md` and stop to decide before continuing, because it means pdf.js scales the embedded image differently. Remove the copied samples from `.playwright-mcp/samples/` when done, then stop the dev server.

---

## Self-review

**Spec coverage.** Milestone 4 asks for PDF import with scale, crop and rotate, a preview and a warning when scaling is too aggressive. Trim (content bounds) and scale-to-fit are Tasks 1 and 3; the product-table crop is an option in Task 3; the preview is the existing 1-bit preview pane fed from the selected entry; the scale warning is replaced by a stronger check, decoding the final 1-bit image (Task 4). Rotation is not built: the sample pages are already upright and a landscape page is treated as two side-by-side slots, so a rotate control is left for a later plan if a layout needs it. The owner's choices are honored: a scannable order barcode is drawn below each label (Task 2 and 3), the product table is kept by default with a toggle, and the A4 layout is the target while a thermal 10x15 layout would also work because the importer fits whatever width it finds.

**Placeholders.** None; every code step has complete code and every run step has a command and expected result. The two places that depend on library typing (`page.render` arguments and the `readBarcodes` options) state the concrete fallback.

**Type consistency.** `Rect`, `GrayImage`, `TextItem`, `LabelSource`, `PdfDocument`, `ImportView`, `ScanResult` and the functions `splitSlots`, `contentBounds`, `dotsPerPoint`, `findOrderNumber`, `findResiNumber`, `productTableTop`, `orderStripDocument`, `extractLabels`, `renderLabel`, `composeLabel`, `drawMonoPreview`, `scanCheck` use the same names and signatures wherever they appear. `build` gains an `expected` field in Task 4, and the Task 3 code is the base it edits.
