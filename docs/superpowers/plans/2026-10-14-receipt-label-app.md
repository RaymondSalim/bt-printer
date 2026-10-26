# Receipt and Shipping Label App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working browser app where the owner fills in a receipt or shipping label form, sees an exact 1-bit preview, and prints it on the Putian POS 802.

**Architecture:** A pure layout engine turns a document model (text, columns, rules, QR, Code 128) into positioned items, using an injected text measurer so it is unit-testable without a canvas. A thin canvas layer draws those items at 576 pixels wide, and the existing `encode` and `printer` modules send the result. Templates build document models from validated data, pure form parsers turn raw input strings into that data, and a vanilla TypeScript UI wires it together.

**Tech Stack:** Vite, TypeScript (strict), Vitest, `qrcode` (QR module matrix). No UI framework, no backend.

**Spec:** `docs/superpowers/specs/2026-10-12-bt-printer-web-app-design.md`. Printer facts: `docs/printer-findings.md`. Builds on `docs/superpowers/plans/2026-10-12-foundation-and-spike.md` (modules `encode`, `printer/send`, `printer/status`, `printer/webBluetooth`, `util/exclusive` already exist).

**Scope note:** This plan covers spec milestones 2 and 3 (render, receipt form and preview, shipping label with QR and Code 128, continuous paper). PDF import, CSV batch printing and sticker (gapped) mode are separate later plans. The sticker option appears in the UI as disabled. Hardware tuning from the foundation plan is finished: the send defaults are 237-byte chunks, 10 ms apart, with 32-row bands and a 90 ms pause after each band, and `buildPrintJob` appends 96 blank rows so the end of every print clears the tear bar (see `docs/printer-findings.md`). The pre-print status check only warns and never blocks.

## Global Constraints

- Print width is 576 dots (72 bytes per row); content width is 576 minus 12 dots of margin on each side, which is 552.
- Code 128 uses character set B only (printable ASCII, codes 32 to 126); anything else must be rejected with a clear error.
- Default currency is IDR formatted with `Intl.NumberFormat('id-ID')` and zero fraction digits; other currencies use two fraction digits.
- Money is rounded to the currency's fraction digits at every computed step, so displayed lines always add up to the displayed total.
- Static Vite + TypeScript SPA, vanilla TS, no UI framework, no backend; package manager is npm; tests use Vitest in a Node environment, so DOM and canvas code is limited to thin layers verified by typecheck, build and a browser smoke check.
- New dependencies are limited to `qrcode` and `@types/qrcode`.
- Web Bluetooth works in Chrome and Edge only, and only on HTTPS or localhost.
- Commit messages must not mention any AI tool and must not carry attribution trailers.
- Code comments describe current behavior or invariants, never the editing history.

## Review Focus

- A single unbroken word longer than a line (a long tracking number, URL or address token) must wrap by characters, never overflow the page or loop forever.
- A tracking number with characters outside Code 128 set B, or too long to fit 552 dots, must fail with a clear error instead of printing a wrong or clipped barcode.
- Money arithmetic with fractional prices, rounding tax, a discount larger than the subtotal, NaN or negative input must give consistent totals or a clear error, never silently wrong amounts. A typed "15.000" must not silently become 15.
- An empty document, blank fields and blank address lines must not crash the encoder (which rejects zero-row images) and must not print empty lines.
- Declining the status-warning prompt must send no print bytes at all, and a silent printer must produce a warning, not a hang.

---

### Task 1: Text wrapping and layout core

**Files:**
- Create: `src/render/types.ts`, `src/render/text.ts`, `src/render/layout.ts`
- Test: `tests/render/text.test.ts`, `tests/render/layout.test.ts`

**Interfaces:**
- Consumes: `PRINT_WIDTH_DOTS` from `src/encode/raster.ts`.
- Produces:
  - `src/render/types.ts`: `type Align = 'left' | 'center' | 'right'`; `type Block` (this task: `text`, `columns`, `rule`, `spacer`); `interface DocumentModel { blocks: Block[]; marginX?: number; marginY?: number }`
  - `src/render/text.ts`: `DEFAULT_FONT_SIZE = 24`, `LINE_HEIGHT_RATIO = 1.25`, `FONT_FAMILY`, `type Measure = (text: string, size: number, bold: boolean) => number`, `fontString(size, bold): string`, `wrapText(text, maxWidth, measure: (text: string) => number): string[]`
  - `src/render/layout.ts`: `DEFAULT_MARGIN_X = 12`, `DEFAULT_MARGIN_Y = 8`, `COLUMN_GAP = 12`, `type LayoutItem` (this task: `text` and `rect` kinds), `interface Layout { width: number; height: number; items: LayoutItem[] }`, `layoutDocument(doc: DocumentModel, measure: Measure): Layout`

Line height is `ceil(size * 1.25)`. A rule adds 6 dots of padding above and below its thickness (default 2). `columns` puts `left` at the left margin (wrapping if needed) and `right` right-aligned on the first line.

- [ ] **Step 1: Write the failing tests**

Create `tests/render/text.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { fontString, wrapText } from '../../src/render/text'

const tenPerChar = (t: string) => Array.from(t).length * 10

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(wrapText('hello', 100, tenPerChar)).toEqual(['hello'])
  })

  it('wraps at word boundaries', () => {
    expect(wrapText('hello world foo', 110, tenPerChar)).toEqual(['hello world', 'foo'])
  })

  it('collapses repeated spaces', () => {
    expect(wrapText('a   b', 100, tenPerChar)).toEqual(['a b'])
  })

  it('breaks a word longer than the line by characters', () => {
    expect(wrapText('ABCDEFGHIJKLMNOP', 50, tenPerChar)).toEqual(['ABCDE', 'FGHIJ', 'KLMNO', 'P'])
  })

  it('moves a long word that follows shorter text onto its own lines', () => {
    expect(wrapText('ab ABCDEFGHIJ', 50, tenPerChar)).toEqual(['ab', 'ABCDE', 'FGHIJ'])
  })

  it('keeps explicit newlines and blank lines', () => {
    expect(wrapText('a\n\nb', 100, tenPerChar)).toEqual(['a', '', 'b'])
  })

  it('returns one empty line for empty text', () => {
    expect(wrapText('', 100, tenPerChar)).toEqual([''])
  })

  it('puts a glyph wider than the line on its own line instead of looping', () => {
    const wide = (t: string) => Array.from(t).length * 100
    expect(wrapText('abc', 50, wide)).toEqual(['a', 'b', 'c'])
  })

  it('does not split surrogate pairs', () => {
    expect(wrapText('😀😀😀', 20, tenPerChar)).toEqual(['😀😀', '😀'])
  })
})

describe('fontString', () => {
  it('builds a CSS font shorthand', () => {
    expect(fontString(24, false)).toBe('24px Arial, Helvetica, sans-serif')
    expect(fontString(30, true)).toBe('bold 30px Arial, Helvetica, sans-serif')
  })
})
```

Create `tests/render/layout.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { layoutDocument } from '../../src/render/layout'
import type { DocumentModel } from '../../src/render/types'

// 12 dots per character at size 24, which gives 46 characters per 552-dot line.
const measure = (text: string, size: number) => Array.from(text).length * size * 0.5

const layout = (doc: DocumentModel) => layoutDocument(doc, measure)

describe('layoutDocument', () => {
  it('gives an empty document the two vertical margins as its height', () => {
    expect(layout({ blocks: [] })).toEqual({ width: 576, height: 16, items: [] })
  })

  it('places a default text block at the margins', () => {
    const result = layout({ blocks: [{ type: 'text', text: 'Hello' }] })
    expect(result.items).toEqual([
      { kind: 'text', text: 'Hello', x: 12, y: 8, size: 24, bold: false, align: 'left' },
    ])
    expect(result.height).toBe(46)
  })

  it('anchors center and right text at the page center and right margin', () => {
    const result = layout({
      blocks: [
        { type: 'text', text: 'c', align: 'center' },
        { type: 'text', text: 'r', align: 'right' },
      ],
    })
    expect(result.items.map((i) => (i.kind === 'text' ? [i.x, i.y] : null))).toEqual([
      [288, 8],
      [564, 38],
    ])
  })

  it('passes size and bold through and rounds the line height up', () => {
    const result = layout({ blocks: [{ type: 'text', text: 'Big', size: 25, bold: true }] })
    expect(result.items[0]).toMatchObject({ size: 25, bold: true })
    expect(result.height).toBe(8 + 32 + 8)
  })

  it('wraps a long unbroken word by characters', () => {
    const result = layout({ blocks: [{ type: 'text', text: 'a'.repeat(60) }] })
    const lines = result.items.map((i) => (i.kind === 'text' ? [i.text.length, i.y] : null))
    expect(lines).toEqual([
      [46, 8],
      [14, 38],
    ])
    expect(result.height).toBe(76)
  })

  it('advances for a blank line without emitting an item', () => {
    const result = layout({ blocks: [{ type: 'text', text: 'a\n\nb' }] })
    expect(result.items.map((i) => (i.kind === 'text' ? i.y : null))).toEqual([8, 68])
    expect(result.height).toBe(106)
  })

  it('puts the right column at the right margin on the first line', () => {
    const result = layout({ blocks: [{ type: 'columns', left: 'Nasi Goreng', right: 'Rp 15.000' }] })
    expect(result.items).toEqual([
      { kind: 'text', text: 'Nasi Goreng', x: 12, y: 8, size: 24, bold: false, align: 'left' },
      { kind: 'text', text: 'Rp 15.000', x: 564, y: 8, size: 24, bold: false, align: 'right' },
    ])
    expect(result.height).toBe(46)
  })

  it('wraps the left column around the right column', () => {
    const result = layout({ blocks: [{ type: 'columns', left: 'a'.repeat(100), right: '9' }] })
    const left = result.items.filter((i) => i.kind === 'text' && i.align === 'left')
    expect(left.map((i) => (i.kind === 'text' ? [i.text.length, i.y] : null))).toEqual([
      [44, 8],
      [44, 38],
      [12, 68],
    ])
    const right = result.items.filter((i) => i.kind === 'text' && i.align === 'right')
    expect(right).toHaveLength(1)
    expect(result.height).toBe(106)
  })

  it('draws a rule with padding on both sides', () => {
    const result = layout({ blocks: [{ type: 'rule' }] })
    expect(result.items).toEqual([{ kind: 'rect', x: 12, y: 14, width: 552, height: 2 }])
    expect(result.height).toBe(30)
  })

  it('honors a custom rule thickness', () => {
    const result = layout({ blocks: [{ type: 'rule', thickness: 4 }] })
    expect(result.items[0]).toMatchObject({ kind: 'rect', height: 4 })
  })

  it('adds spacer height and rejects a negative spacer', () => {
    expect(layout({ blocks: [{ type: 'spacer', height: 20 }] }).height).toBe(36)
    expect(() => layout({ blocks: [{ type: 'spacer', height: -1 }] })).toThrow(/spacer/)
  })

  it('honors custom margins', () => {
    const result = layout({ blocks: [{ type: 'text', text: 'x' }], marginX: 20, marginY: 10 })
    expect(result.items[0]).toMatchObject({ x: 20, y: 10 })
    expect(result.height).toBe(10 + 30 + 10)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/render`
Expected: FAIL, modules `../../src/render/text` and `../../src/render/layout` cannot be resolved.

- [ ] **Step 3: Implement types, text and layout**

Create `src/render/types.ts`:
```ts
export type Align = 'left' | 'center' | 'right'

export type Block =
  | { type: 'text'; text: string; size?: number; bold?: boolean; align?: Align }
  | { type: 'columns'; left: string; right: string; size?: number; bold?: boolean }
  | { type: 'rule'; thickness?: number }
  | { type: 'spacer'; height: number }

export interface DocumentModel {
  blocks: Block[]
  marginX?: number
  marginY?: number
}
```

Create `src/render/text.ts`:
```ts
export const DEFAULT_FONT_SIZE = 24
export const LINE_HEIGHT_RATIO = 1.25
export const FONT_FAMILY = 'Arial, Helvetica, sans-serif'

export type Measure = (text: string, size: number, bold: boolean) => number

export function fontString(size: number, bold: boolean): string {
  return `${bold ? 'bold ' : ''}${size}px ${FONT_FAMILY}`
}

// Greedy word wrap. A word wider than the line is split by code point, and a
// single code point wider than the line still gets its own line, so the loop
// always makes progress.
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((w) => w !== '')
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`
      if (measure(candidate) <= maxWidth) {
        current = candidate
        continue
      }
      if (current !== '') {
        lines.push(current)
        current = ''
      }
      if (measure(word) <= maxWidth) {
        current = word
        continue
      }
      let chunk = ''
      for (const ch of Array.from(word)) {
        if (chunk !== '' && measure(chunk + ch) > maxWidth) {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk += ch
        }
      }
      current = chunk
    }
    lines.push(current)
  }
  return lines
}
```

Create `src/render/layout.ts`:
```ts
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
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run tests/render && npm run typecheck`
Expected: all render tests PASS, typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/render/types.ts src/render/text.ts src/render/layout.ts tests/render/text.test.ts tests/render/layout.test.ts
git commit -m "feat: add text wrapping and layout engine"
```

---

### Task 2: Code 128 and QR in the layout

**Files:**
- Create: `src/render/code128.ts`, `src/render/qr.ts`
- Modify: `src/render/types.ts`, `src/render/layout.ts`
- Test: `tests/render/code128.test.ts`, `tests/render/qr.test.ts`, and new cases in `tests/render/layout.test.ts`

**Interfaces:**
- Consumes: `layoutDocument`, `LayoutItem`, `DEFAULT_MARGIN_X` (Task 1).
- Produces:
  - `src/render/code128.ts`: `CODE128_PATTERNS: readonly string[]` (107 module strings, index 106 is the stop pattern), `code128Values(text: string): number[]` (start code, data values, checksum), `encodeCode128B(text: string): string` (string of `'1'` and `'0'` modules including the stop pattern)
  - `src/render/qr.ts`: `qrMatrix(data: string): boolean[][]`
  - `Block` additions: `{ type: 'qr'; data: string; size?: number; align?: Align }` and `{ type: 'barcode'; data: string; height?: number; moduleWidth?: number; align?: Align }`
  - `LayoutItem` additions: `{ kind: 'modules'; x: number; y: number; moduleSize: number; matrix: boolean[][] }` and `{ kind: 'bars'; x: number; y: number; moduleWidth: number; height: number; modules: string }`

QR defaults: target size 192 dots including a 4-module quiet zone, minimum 2 dots per module, centered. Barcode defaults: height 80 plus a 6-dot gap below, module width 2 reduced to fit, 10-module quiet zones, centered. The pattern table below comes from the MIT-licensed JsBarcode project (`src/barcodes/CODE128/constants.js`).

- [ ] **Step 1: Install the QR dependency**

Run:
```bash
npm install qrcode
npm install -D @types/qrcode
```
Expected: both install with no vulnerabilities reported.

- [ ] **Step 2: Write the failing tests**

Create `tests/render/code128.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CODE128_PATTERNS, code128Values, encodeCode128B } from '../../src/render/code128'

const START_B = '11010010000'
const STOP = '1100011101011'

describe('code128', () => {
  it('has 107 patterns with the stop pattern last', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    expect(CODE128_PATTERNS[104]).toBe(START_B)
    expect(CODE128_PATTERNS[106]).toBe(STOP)
  })

  it('computes the start code, data values and checksum', () => {
    expect(code128Values('A')).toEqual([104, 33, 34])
  })

  it('encodes a known string exactly', () => {
    expect(encodeCode128B('Hi 123')).toBe(
      '11010010000110001010001000011010011011001100100111001101100111001011001011100100011101101100011101011',
    )
  })

  it('starts with the Start B pattern, ends with the stop pattern, and has 11*(n+2)+13 modules', () => {
    const modules = encodeCode128B('TRACK123456')
    expect(modules.startsWith(START_B)).toBe(true)
    expect(modules.endsWith(STOP)).toBe(true)
    expect(modules).toHaveLength(11 * (11 + 2) + 13)
  })

  it('rejects empty text', () => {
    expect(() => encodeCode128B('')).toThrow(/empty/i)
  })

  it('rejects characters outside printable ASCII and names the position', () => {
    expect(() => encodeCode128B('ABÉ')).toThrow(/position 2/)
    expect(() => encodeCode128B('a\tb')).toThrow(/position 1/)
  })
})
```

Create `tests/render/qr.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { qrMatrix } from '../../src/render/qr'

describe('qrMatrix', () => {
  it('returns a square matrix, 21 modules for a short string', () => {
    const m = qrMatrix('hello')
    expect(m).toHaveLength(21)
    expect(m.every((row) => row.length === 21)).toBe(true)
  })

  it('starts with a finder pattern: seven dark modules, then a light separator', () => {
    const row0 = qrMatrix('hello')[0]
    expect(row0.slice(0, 7).every(Boolean)).toBe(true)
    expect(row0[7]).toBe(false)
  })

  it('grows for longer data', () => {
    expect(qrMatrix('x'.repeat(100)).length).toBeGreaterThan(21)
  })

  it('rejects empty data', () => {
    expect(() => qrMatrix('')).toThrow(/empty/i)
  })
})
```

Append to `tests/render/layout.test.ts` inside the file, as a new `describe` block after the existing one:
```ts
describe('layoutDocument codes', () => {
  it('centers a QR code with a quiet zone and an integer module size', () => {
    const result = layout({ blocks: [{ type: 'qr', data: 'hello' }] })
    const item = result.items[0]
    expect(item).toMatchObject({ kind: 'modules', moduleSize: 6, x: 225, y: 32 })
    expect(item.kind === 'modules' && item.matrix.length).toBe(21)
    expect(result.height).toBe(8 + 174 + 8)
  })

  it('aligns a QR code left or right', () => {
    const left = layout({ blocks: [{ type: 'qr', data: 'hello', align: 'left' }] }).items[0]
    const right = layout({ blocks: [{ type: 'qr', data: 'hello', align: 'right' }] }).items[0]
    expect(left).toMatchObject({ x: 36 })
    expect(right).toMatchObject({ x: 414 })
  })

  it('honors a smaller QR size and clamps one wider than the content', () => {
    expect(layout({ blocks: [{ type: 'qr', data: 'hello', size: 100 }] }).height).toBe(8 + 87 + 8)
    expect(layout({ blocks: [{ type: 'qr', data: 'hello', size: 1000 }] }).height).toBe(8 + 551 + 8)
  })

  it('rejects QR data that cannot be drawn at two dots per module', () => {
    expect(() => layout({ blocks: [{ type: 'qr', data: 'x'.repeat(2000) }] })).toThrow(/QR/)
  })

  it('centers a Code 128 barcode with quiet zones at module width 2', () => {
    const result = layout({ blocks: [{ type: 'barcode', data: 'TRACK123456' }] })
    expect(result.items[0]).toMatchObject({
      kind: 'bars',
      moduleWidth: 2,
      height: 80,
      x: 132,
      y: 8,
    })
    expect(result.height).toBe(102)
  })

  it('shrinks the module width to fit a longer barcode', () => {
    const result = layout({ blocks: [{ type: 'barcode', data: 'A'.repeat(30) }] })
    expect(result.items[0]).toMatchObject({ kind: 'bars', moduleWidth: 1, x: 105 })
  })

  it('honors an explicit module width and height when they fit', () => {
    const result = layout({
      blocks: [{ type: 'barcode', data: 'TRACK123456', moduleWidth: 3, height: 50 }],
    })
    expect(result.items[0]).toMatchObject({ moduleWidth: 3, height: 50 })
  })

  it('rejects a barcode that cannot fit even at one dot per module', () => {
    expect(() => layout({ blocks: [{ type: 'barcode', data: 'A'.repeat(60) }] })).toThrow(/Barcode/)
  })

  it('rejects barcode text outside Code 128 set B', () => {
    expect(() => layout({ blocks: [{ type: 'barcode', data: 'café' }] })).toThrow(/position 3/)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/render`
Expected: FAIL, modules `code128` and `qr` cannot be resolved, and the new layout cases fail on unknown block types.

- [ ] **Step 4: Implement Code 128 and QR**

Create `src/render/code128.ts`:
```ts
// Code 128 symbol patterns, 107 entries: 103 data symbols, three start symbols
// (103 to 105) and the stop symbol (106, thirteen modules). Table values from
// JsBarcode (MIT licence), src/barcodes/CODE128/constants.js.
export const CODE128_PATTERNS: readonly string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000',
  '10010001100', '10001001100', '10011001000', '10011000100',
  '10001100100', '11001001000', '11001000100', '11000100100',
  '10110011100', '10011011100', '10011001110', '10111001100',
  '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110',
  '11101001100', '11100101100', '11100100110', '11101100100',
  '11100110100', '11100110010', '11011011000', '11011000110',
  '11000110110', '10100011000', '10001011000', '10001000110',
  '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110',
  '10001101110', '10111011000', '10111000110', '10001110110',
  '11101110110', '11010001110', '11000101110', '11011101000',
  '11011100010', '11011101110', '11101011000', '11101000110',
  '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000',
  '10100001100', '10010110000', '10010000110', '10000101100',
  '10000100110', '10110010000', '10110000100', '10011010000',
  '10011000010', '10000110100', '10000110010', '11000010010',
  '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100',
  '10011110100', '10011110010', '11110100100', '11110010100',
  '11110010010', '11011011110', '11011110110', '11110110110',
  '10101111000', '10100011110', '10001011110', '10111101000',
  '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100',
  '11010010000', '11010011100', '1100011101011',
]

const START_B = 104
const STOP = 106
const MODULO = 103

export function code128Values(text: string): number[] {
  if (text === '') throw new Error('Code 128 text is empty')
  const values: number[] = [START_B]
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 32 || code > 126) {
      throw new Error(
        `Code 128 supports printable ASCII only; character at position ${i} (code ${code}) is not allowed`,
      )
    }
    values.push(code - 32)
  }
  let sum = START_B
  for (let i = 1; i < values.length; i++) sum += values[i] * i
  values.push(sum % MODULO)
  return values
}

export function encodeCode128B(text: string): string {
  return code128Values(text).map((v) => CODE128_PATTERNS[v]).join('') + CODE128_PATTERNS[STOP]
}
```

Create `src/render/qr.ts`:
```ts
import QRCode from 'qrcode'

export function qrMatrix(data: string): boolean[][] {
  if (data === '') throw new Error('QR data is empty')
  const qr = QRCode.create(data, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  return Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, col) => Boolean(qr.modules.get(row, col))),
  )
}
```

- [ ] **Step 5: Extend the types and layout**

In `src/render/types.ts`, add to the `Block` union:
```ts
  | { type: 'qr'; data: string; size?: number; align?: Align }
  | { type: 'barcode'; data: string; height?: number; moduleWidth?: number; align?: Align }
```

In `src/render/layout.ts`, add imports after the existing ones:
```ts
import { encodeCode128B } from './code128'
import { qrMatrix } from './qr'
```
Add constants after `DEFAULT_RULE_THICKNESS`:
```ts
const DEFAULT_QR_SIZE = 192
const QR_QUIET_MODULES = 4
const MIN_QR_MODULE = 2
const DEFAULT_BARCODE_HEIGHT = 80
const DEFAULT_BARCODE_MODULE = 2
const BARCODE_QUIET_MODULES = 10
const BARCODE_GAP = 6
```
Add to the `LayoutItem` union:
```ts
  | { kind: 'modules'; x: number; y: number; moduleSize: number; matrix: boolean[][] }
  | { kind: 'bars'; x: number; y: number; moduleWidth: number; height: number; modules: string }
```
Add this helper inside `layoutDocument`, after `anchorX`:
```ts
  const alignedX = (align: Align, total: number): number =>
    align === 'center'
      ? Math.floor((width - total) / 2)
      : align === 'right'
        ? width - marginX - total
        : marginX
```
Add these cases before `default:` in the `switch`:
```ts
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
        if (moduleWidth < 1) {
          throw new Error(
            `Barcode for ${block.data.length} characters needs ${cells} dots but only ${contentWidth} are available`,
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
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: every test PASSES (the earlier 38 plus the new ones), typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/render tests/render
git commit -m "feat: add Code 128 and QR blocks to the layout engine"
```

---

### Task 3: Canvas drawing and the 1-bit preview

**Files:**
- Create: `src/render/draw.ts`, `src/render/render.ts`
- Modify: `src/encode/raster.ts` (add `monoPreview`)
- Test: `tests/render/draw.test.ts`, new cases in `tests/encode/raster.test.ts`

**Interfaces:**
- Consumes: `Layout`, `LayoutItem` (Tasks 1 and 2), `fontString` (Task 1), `layoutDocument` (Task 1), `isBlack` logic already inside `src/encode/raster.ts`.
- Produces:
  - `src/render/draw.ts`: `interface DrawContext` (the subset of `CanvasRenderingContext2D` used: `fillStyle`, `font`, `textAlign`, `textBaseline`, `fillText`, `fillRect`), `drawLayout(ctx: DrawContext, layout: Layout): void`
  - `src/render/render.ts`: `renderDocument(doc: DocumentModel): HTMLCanvasElement` (browser only; a 576-pixel-wide canvas with an opaque white background)
  - `src/encode/raster.ts`: `monoPreview(img: RgbaImage, threshold?: number): Uint8ClampedArray<ArrayBuffer>` returning opaque black or white RGBA pixels using exactly the same decision as the encoder

`renderDocument` measures text on a scratch canvas first, because resizing a canvas clears its state, then creates the final canvas at the measured height. It has no unit test (it needs a real canvas); `drawLayout` is covered through a recording fake context, and `renderDocument` is checked by typecheck, build and the browser smoke check in Task 7.

- [ ] **Step 1: Write the failing tests**

Create `tests/render/draw.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { drawLayout, type DrawContext } from '../../src/render/draw'
import type { Layout } from '../../src/render/layout'

function fakeCtx() {
  const calls: unknown[][] = []
  const ctx: DrawContext = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillText: (...args) => {
      calls.push(['fillText', ...args, ctx.font, ctx.textAlign])
    },
    fillRect: (...args) => {
      calls.push(['fillRect', ...args])
    },
  }
  return { ctx, calls }
}

const layoutOf = (items: Layout['items']): Layout => ({ width: 576, height: 100, items })

describe('drawLayout', () => {
  it('draws in black from the top of each text line', () => {
    const { ctx } = fakeCtx()
    drawLayout(ctx, layoutOf([]))
    expect(ctx.fillStyle).toBe('#000')
    expect(ctx.textBaseline).toBe('top')
  })

  it('draws text with its font, alignment and position', () => {
    const { ctx, calls } = fakeCtx()
    drawLayout(
      ctx,
      layoutOf([{ kind: 'text', text: 'Hi', x: 288, y: 8, size: 30, bold: true, align: 'center' }]),
    )
    expect(calls).toEqual([
      ['fillText', 'Hi', 288, 8, 'bold 30px Arial, Helvetica, sans-serif', 'center'],
    ])
  })

  it('draws rects as given', () => {
    const { ctx, calls } = fakeCtx()
    drawLayout(ctx, layoutOf([{ kind: 'rect', x: 12, y: 14, width: 552, height: 2 }]))
    expect(calls).toEqual([['fillRect', 12, 14, 552, 2]])
  })

  it('draws one square per dark QR module', () => {
    const { ctx, calls } = fakeCtx()
    drawLayout(
      ctx,
      layoutOf([
        {
          kind: 'modules',
          x: 10,
          y: 20,
          moduleSize: 3,
          matrix: [
            [true, false],
            [false, true],
          ],
        },
      ]),
    )
    expect(calls).toEqual([
      ['fillRect', 10, 20, 3, 3],
      ['fillRect', 13, 23, 3, 3],
    ])
  })

  it('merges adjacent barcode modules into one bar per run', () => {
    const { ctx, calls } = fakeCtx()
    drawLayout(
      ctx,
      layoutOf([{ kind: 'bars', x: 100, y: 5, moduleWidth: 2, height: 10, modules: '1101' }]),
    )
    expect(calls).toEqual([
      ['fillRect', 100, 5, 4, 10],
      ['fillRect', 106, 5, 2, 10],
    ])
  })
})
```

Append to `tests/encode/raster.test.ts` (and add `monoPreview` to its existing import list from `'../../src/encode/raster'`):
```ts
describe('monoPreview', () => {
  it('maps black pixels to opaque black and everything else to opaque white', () => {
    const img = makeImage(1, (x) =>
      x === 0 ? BLACK : x === 1 ? [200, 200, 200, 255] : [0, 0, 0, 0],
    )
    const out = monoPreview(img)
    expect(out.length).toBe(img.data.length)
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 255])
    expect([...out.slice(4, 8)]).toEqual([255, 255, 255, 255])
    expect([...out.slice(8, 12)]).toEqual([255, 255, 255, 255])
  })

  it('uses the same threshold rule as the encoder', () => {
    const gray = (v: number) => makeImage(1, () => [v, v, v, 255])
    expect(monoPreview(gray(127))[0]).toBe(0)
    expect(monoPreview(gray(128))[0]).toBe(255)
    expect(monoPreview(gray(200), 220)[0]).toBe(0)
  })

  it('agrees with the encoder on every pixel of a mixed image', () => {
    let seed = 12345
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    const img = makeImage(3, () => [next() % 256, next() % 256, next() % 256, 255 - (next() % 3) * 100])
    const preview = monoPreview(img)
    const [band] = rasterBands(img, { bandRows: 3 })
    for (let y = 0; y < 3; y++) {
      for (let xb = 0; xb < ROW_BYTES; xb++) {
        let expected = 0
        for (let bit = 0; bit < 8; bit++) {
          const i = (y * PRINT_WIDTH_DOTS + xb * 8 + bit) * 4
          if (preview[i] === 0) expected |= 0x80 >> bit
        }
        expect(band[8 + y * ROW_BYTES + xb]).toBe(expected)
      }
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/render/draw.test.ts tests/encode/raster.test.ts`
Expected: FAIL, `../../src/render/draw` cannot be resolved and `monoPreview` is not exported.

- [ ] **Step 3: Implement `monoPreview`**

In `src/encode/raster.ts`, add after the `rasterBands` function:
```ts
// Opaque black and white RGBA pixels using the same decision as the encoder,
// so what the preview shows is what gets printed.
export function monoPreview(
  img: RgbaImage,
  threshold: number = DEFAULT_THRESHOLD,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(img.data.length)
  for (let i = 0; i < img.data.length; i += 4) {
    const value = isBlack(img.data, i, threshold) ? 0 : 255
    out[i] = value
    out[i + 1] = value
    out[i + 2] = value
    out[i + 3] = 255
  }
  return out
}
```

- [ ] **Step 4: Implement drawing and rendering**

Create `src/render/draw.ts`:
```ts
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
```

Create `src/render/render.ts`:
```ts
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
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck exits 0. If `new Uint8ClampedArray(...)` does not satisfy the declared `Uint8ClampedArray<ArrayBuffer>` return type, keep the signature and construct with `new Uint8ClampedArray(new ArrayBuffer(img.data.length))`.

- [ ] **Step 6: Commit**

```bash
git add src/render/draw.ts src/render/render.ts src/encode/raster.ts tests/render/draw.test.ts tests/encode/raster.test.ts
git commit -m "feat: add canvas drawing and 1-bit preview"
```

---

### Task 4: Money and the receipt template

**Files:**
- Create: `src/templates/money.ts`, `src/templates/lines.ts`, `src/templates/receipt.ts`
- Test: `tests/templates/money.test.ts`, `tests/templates/receipt.test.ts`

**Interfaces:**
- Consumes: `Block`, `DocumentModel` (Tasks 1 and 2).
- Produces:
  - `src/templates/money.ts`: `currencyDigits(currency: string): number` (0 for IDR, otherwise 2), `roundMoney(amount: number, currency: string): number`, `formatMoney(amount: number, currency?: string, locale?: string): string` (default currency `'IDR'`; locale `id-ID` for IDR, otherwise `en-US`)
  - `src/templates/lines.ts`: `cleanLines(lines: string[]): string[]` (trims and drops blank entries)
  - `src/templates/receipt.ts`: `interface ReceiptItem { name: string; qty: number; unitPrice: number }`, `interface ReceiptData { storeName: string; addressLines: string[]; dateTime?: string; receiptNo?: string; cashier?: string; items: ReceiptItem[]; taxPercent: number; discount: number; paid?: number; footer?: string; currency?: string }`, `interface ReceiptTotals { subtotal; discount; tax; total: number; paid?: number; change?: number }`, `receiptTotals(data: ReceiptData): ReceiptTotals`, `buildReceipt(data: ReceiptData): DocumentModel`

Totals rule: each line total is `qty * unitPrice` rounded to the currency's digits; the subtotal sums the rounded line totals; the discount must not exceed the subtotal; tax is `(subtotal - discount) * taxPercent / 100` rounded; total is taxable plus tax; `change` is `paid - total` (negative means a balance is due).

- [ ] **Step 1: Write the failing tests**

Create `tests/templates/money.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { currencyDigits, formatMoney, roundMoney } from '../../src/templates/money'

const norm = (s: string) => s.replace(/\u00a0/g, ' ')

describe('money', () => {
  it('uses zero fraction digits for IDR and two otherwise', () => {
    expect(currencyDigits('IDR')).toBe(0)
    expect(currencyDigits('USD')).toBe(2)
  })

  it('rounds to the currency digits and removes float noise', () => {
    expect(roundMoney(0.30000000000000004, 'USD')).toBe(0.3)
    expect(roundMoney(333.3, 'IDR')).toBe(333)
    expect(roundMoney(333.5, 'IDR')).toBe(334)
  })

  it('formats rupiah with dot grouping and no decimals', () => {
    expect(norm(formatMoney(15000))).toBe('Rp 15.000')
    expect(norm(formatMoney(1234567))).toBe('Rp 1.234.567')
    expect(norm(formatMoney(-500))).toBe('-Rp 500')
  })

  it('formats other currencies with two decimals', () => {
    expect(norm(formatMoney(12.5, 'USD'))).toBe('$12.50')
  })
})
```

Create `tests/templates/receipt.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { Block } from '../../src/render/types'
import { buildReceipt, receiptTotals, type ReceiptData } from '../../src/templates/receipt'

const norm = (s: string) => s.replace(/\u00a0/g, ' ')
const rows = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.type === 'columns' ? [[norm(b.left), norm(b.right)]] : []))

const base: ReceiptData = {
  storeName: 'Toko Contoh',
  addressLines: ['Jl. Contoh No. 1', 'Jakarta'],
  dateTime: '12/10/2026 21:30',
  receiptNo: 'INV-001',
  cashier: 'Rani',
  items: [
    { name: 'Nasi Goreng', qty: 2, unitPrice: 15000 },
    { name: 'Es Teh', qty: 1, unitPrice: 5000 },
  ],
  taxPercent: 10,
  discount: 0,
  paid: 50000,
  footer: 'Terima kasih',
}

describe('receiptTotals', () => {
  it('adds up lines, tax, total and change', () => {
    expect(receiptTotals(base)).toEqual({
      subtotal: 35000,
      discount: 0,
      tax: 3500,
      total: 38500,
      paid: 50000,
      change: 11500,
    })
  })

  it('applies tax after the discount', () => {
    const t = receiptTotals({ ...base, discount: 5000 })
    expect(t).toMatchObject({ subtotal: 35000, discount: 5000, tax: 3000, total: 33000 })
  })

  it('rounds rupiah tax to whole rupiah so the total stays consistent', () => {
    const t = receiptTotals({
      ...base,
      items: [{ name: 'x', qty: 1, unitPrice: 3333 }],
      paid: undefined,
    })
    expect(t).toMatchObject({ subtotal: 3333, tax: 333, total: 3666 })
  })

  it('does not accumulate float error in fractional currencies', () => {
    const t = receiptTotals({
      ...base,
      currency: 'USD',
      items: [{ name: 'x', qty: 3, unitPrice: 0.1 }],
      taxPercent: 0,
      paid: undefined,
    })
    expect(t.subtotal).toBe(0.3)
    expect(t.total).toBe(0.3)
  })

  it('reports a negative change when paid is less than the total', () => {
    expect(receiptTotals({ ...base, paid: 20000 }).change).toBe(-18500)
  })

  it('has no paid or change when paid is omitted', () => {
    const t = receiptTotals({ ...base, paid: undefined })
    expect(t.paid).toBeUndefined()
    expect(t.change).toBeUndefined()
  })

  it.each([
    ['no items', { items: [] }, /at least one item/],
    ['blank item name', { items: [{ name: ' ', qty: 1, unitPrice: 1 }] }, /Item 1.*name/],
    ['zero quantity', { items: [{ name: 'a', qty: 0, unitPrice: 1 }] }, /Item 1.*quantity/],
    ['NaN price', { items: [{ name: 'a', qty: 1, unitPrice: NaN }] }, /Item 1.*price/],
    ['negative price', { items: [{ name: 'a', qty: 1, unitPrice: -1 }] }, /Item 1.*price/],
    ['tax above 100', { taxPercent: 101 }, /tax/i],
    ['negative tax', { taxPercent: -1 }, /tax/i],
    ['negative discount', { discount: -1 }, /discount/i],
    ['discount above subtotal', { discount: 35001 }, /discount/i],
    ['negative paid', { paid: -1 }, /paid/i],
  ])('rejects %s', (_label, patch, message) => {
    expect(() => receiptTotals({ ...base, ...patch })).toThrow(message)
  })
})

describe('buildReceipt', () => {
  it('starts with the store name in large bold centered text', () => {
    expect(buildReceipt(base).blocks[0]).toEqual({
      type: 'text',
      text: 'Toko Contoh',
      size: 34,
      bold: true,
      align: 'center',
    })
  })

  it('lists items, totals, payment and change as two-column rows', () => {
    expect(rows(buildReceipt(base).blocks)).toEqual([
      ['Date', '12/10/2026 21:30'],
      ['No', 'INV-001'],
      ['Cashier', 'Rani'],
      ['2 x Rp 15.000', 'Rp 30.000'],
      ['1 x Rp 5.000', 'Rp 5.000'],
      ['Subtotal', 'Rp 35.000'],
      ['Tax 10%', 'Rp 3.500'],
      ['TOTAL', 'Rp 38.500'],
      ['Paid', 'Rp 50.000'],
      ['Change', 'Rp 11.500'],
    ])
  })

  it('shows a discount row only when there is a discount', () => {
    expect(rows(buildReceipt(base).blocks).some(([l]) => l === 'Discount')).toBe(false)
    expect(rows(buildReceipt({ ...base, discount: 5000 }).blocks)).toContainEqual([
      'Discount',
      '-Rp 5.000',
    ])
  })

  it('labels a shortfall as a balance due', () => {
    const r = rows(buildReceipt({ ...base, paid: 20000 }).blocks)
    expect(r).toContainEqual(['Balance due', 'Rp 18.500'])
    expect(r.some(([l]) => l === 'Change')).toBe(false)
  })

  it('omits payment rows and tax rows when not applicable', () => {
    const r = rows(buildReceipt({ ...base, paid: undefined, taxPercent: 0 }).blocks)
    expect(r.map(([l]) => l)).not.toContain('Paid')
    expect(r.map(([l]) => l)).not.toContain('Change')
    expect(r.some(([l]) => l.startsWith('Tax'))).toBe(false)
  })

  it('omits date, number and cashier rows when blank', () => {
    const r = rows(
      buildReceipt({ ...base, dateTime: undefined, receiptNo: ' ', cashier: '' }).blocks,
    )
    expect(r.map(([l]) => l)).not.toContain('Date')
    expect(r.map(([l]) => l)).not.toContain('No')
    expect(r.map(([l]) => l)).not.toContain('Cashier')
  })

  it('drops blank address lines', () => {
    const blocks = buildReceipt({ ...base, addressLines: ['', '  ', 'Jakarta'] }).blocks
    const address = blocks.filter((b) => b.type === 'text' && b.size === 22)
    expect(address).toHaveLength(1)
  })

  it('ends with the footer and a tear-off spacer', () => {
    const blocks = buildReceipt(base).blocks
    expect(blocks[blocks.length - 2]).toMatchObject({ type: 'text', text: 'Terima kasih' })
    expect(blocks[blocks.length - 1]).toEqual({ type: 'spacer', height: 24 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/templates`
Expected: FAIL, modules under `src/templates` cannot be resolved.

- [ ] **Step 3: Implement money, lines and the receipt template**

Create `src/templates/money.ts`:
```ts
export function currencyDigits(currency: string): number {
  return currency === 'IDR' ? 0 : 2
}

export function roundMoney(amount: number, currency: string): number {
  const factor = 10 ** currencyDigits(currency)
  return Math.round((amount + Number.EPSILON) * factor) / factor
}

export function formatMoney(amount: number, currency = 'IDR', locale?: string): string {
  const digits = currencyDigits(currency)
  return new Intl.NumberFormat(locale ?? (currency === 'IDR' ? 'id-ID' : 'en-US'), {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount)
}
```

Create `src/templates/lines.ts`:
```ts
export function cleanLines(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter((line) => line !== '')
}
```

Create `src/templates/receipt.ts`:
```ts
import type { Block, DocumentModel } from '../render/types'
import { cleanLines } from './lines'
import { formatMoney, roundMoney } from './money'

export interface ReceiptItem {
  name: string
  qty: number
  unitPrice: number
}

export interface ReceiptData {
  storeName: string
  addressLines: string[]
  dateTime?: string
  receiptNo?: string
  cashier?: string
  items: ReceiptItem[]
  taxPercent: number
  discount: number
  paid?: number
  footer?: string
  currency?: string
}

export interface ReceiptTotals {
  subtotal: number
  discount: number
  tax: number
  total: number
  paid?: number
  change?: number
}

function validate(data: ReceiptData): void {
  if (data.items.length === 0) throw new Error('Receipt needs at least one item')
  data.items.forEach((item, i) => {
    const n = i + 1
    if (item.name.trim() === '') throw new Error(`Item ${n}: name is required`)
    if (!Number.isFinite(item.qty) || item.qty <= 0) {
      throw new Error(`Item ${n}: quantity must be greater than zero`)
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw new Error(`Item ${n}: price must be zero or more`)
    }
  })
  if (!Number.isFinite(data.taxPercent) || data.taxPercent < 0 || data.taxPercent > 100) {
    throw new Error('Tax percent must be between 0 and 100')
  }
  if (!Number.isFinite(data.discount) || data.discount < 0) {
    throw new Error('Discount must be zero or more')
  }
  if (data.paid !== undefined && (!Number.isFinite(data.paid) || data.paid < 0)) {
    throw new Error('Paid amount must be zero or more')
  }
}

export function receiptTotals(data: ReceiptData): ReceiptTotals {
  validate(data)
  const currency = data.currency ?? 'IDR'
  const round = (n: number) => roundMoney(n, currency)
  const subtotal = round(
    data.items.reduce((sum, item) => sum + round(item.qty * item.unitPrice), 0),
  )
  const discount = round(data.discount)
  if (discount > subtotal) throw new Error('Discount cannot exceed the subtotal')
  const taxable = round(subtotal - discount)
  const tax = round((taxable * data.taxPercent) / 100)
  const total = round(taxable + tax)
  if (data.paid === undefined) return { subtotal, discount, tax, total }
  const paid = round(data.paid)
  return { subtotal, discount, tax, total, paid, change: round(paid - total) }
}

export function buildReceipt(data: ReceiptData): DocumentModel {
  const totals = receiptTotals(data)
  const currency = data.currency ?? 'IDR'
  const fmt = (n: number) => formatMoney(n, currency)
  const blocks: Block[] = []

  blocks.push({ type: 'text', text: data.storeName.trim(), size: 34, bold: true, align: 'center' })
  for (const line of cleanLines(data.addressLines)) {
    blocks.push({ type: 'text', text: line, size: 22, align: 'center' })
  }
  blocks.push({ type: 'rule' })

  const meta: Array<[string, string | undefined]> = [
    ['Date', data.dateTime],
    ['No', data.receiptNo],
    ['Cashier', data.cashier],
  ]
  let hasMeta = false
  for (const [label, value] of meta) {
    const trimmed = value?.trim()
    if (trimmed) {
      blocks.push({ type: 'columns', left: label, right: trimmed })
      hasMeta = true
    }
  }
  if (hasMeta) blocks.push({ type: 'rule' })

  for (const item of data.items) {
    const lineTotal = roundMoney(item.qty * item.unitPrice, currency)
    blocks.push({ type: 'text', text: item.name.trim() })
    blocks.push({
      type: 'columns',
      left: `${item.qty} x ${fmt(item.unitPrice)}`,
      right: fmt(lineTotal),
    })
  }
  blocks.push({ type: 'rule' })

  blocks.push({ type: 'columns', left: 'Subtotal', right: fmt(totals.subtotal) })
  if (totals.discount > 0) {
    blocks.push({ type: 'columns', left: 'Discount', right: `-${fmt(totals.discount)}` })
  }
  if (totals.tax > 0) {
    blocks.push({ type: 'columns', left: `Tax ${data.taxPercent}%`, right: fmt(totals.tax) })
  }
  blocks.push({ type: 'columns', left: 'TOTAL', right: fmt(totals.total), size: 30, bold: true })

  if (totals.paid !== undefined && totals.change !== undefined) {
    blocks.push({ type: 'columns', left: 'Paid', right: fmt(totals.paid) })
    blocks.push(
      totals.change >= 0
        ? { type: 'columns', left: 'Change', right: fmt(totals.change) }
        : { type: 'columns', left: 'Balance due', right: fmt(-totals.change) },
    )
  }

  const footer = data.footer?.trim()
  if (footer) {
    blocks.push({ type: 'rule' })
    blocks.push({ type: 'text', text: footer, align: 'center' })
  }
  blocks.push({ type: 'spacer', height: 24 })
  return { blocks }
}
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/templates tests/templates
git commit -m "feat: add money helpers and receipt template"
```

---

### Task 5: Shipping label template

**Files:**
- Create: `src/templates/label.ts`
- Test: `tests/templates/label.test.ts`

**Interfaces:**
- Consumes: `Block`, `DocumentModel` (Tasks 1 and 2), `cleanLines` (Task 4).
- Produces (from `src/templates/label.ts`): `interface Party { name: string; phone?: string; addressLines: string[] }`, `interface LabelData { courier?: string; trackingNumber: string; orderId?: string; weightGrams?: number; note?: string; includeQr?: boolean; recipient: Party; sender: Party }`, `buildLabel(data: LabelData): DocumentModel`

Layout order: courier title, Code 128 barcode of the tracking number (height 90), the tracking number as text, rule, TO block (recipient name bold 34, phone 26, address 28), rule, FROM block (sender name bold 24, phone, address 22), rule, order id and weight rows, note, then a QR code of the tracking number (size 160, omitted when `includeQr === false`) and a tear-off spacer.

- [ ] **Step 1: Write the failing tests**

Create `tests/templates/label.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { Block } from '../../src/render/types'
import { buildLabel, type LabelData } from '../../src/templates/label'

const base: LabelData = {
  courier: 'JNE REG',
  trackingNumber: 'JNE1234567890',
  orderId: 'ORD-77',
  weightGrams: 1250,
  note: 'Fragile',
  includeQr: true,
  recipient: {
    name: 'Budi Santoso',
    phone: '0812-0000-1111',
    addressLines: ['Jl. Melati 5 RT 02/03', 'Bandung 40111'],
  },
  sender: {
    name: 'Toko Contoh',
    phone: '021-555-0100',
    addressLines: ['Jl. Contoh No. 1', 'Jakarta 10110'],
  },
}

const types = (blocks: Block[]) => blocks.map((b) => b.type)
const columns = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.type === 'columns' ? [[b.left, b.right]] : []))

describe('buildLabel', () => {
  it('puts the courier title first, then the tracking barcode and number', () => {
    const blocks = buildLabel(base).blocks
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'JNE REG', bold: true, align: 'center' })
    expect(blocks[1]).toEqual({
      type: 'barcode',
      data: 'JNE1234567890',
      height: 90,
      align: 'center',
    })
    expect(blocks[2]).toMatchObject({ type: 'text', text: 'JNE1234567890', bold: true })
  })

  it('starts with the barcode when there is no courier', () => {
    expect(buildLabel({ ...base, courier: undefined }).blocks[0].type).toBe('barcode')
  })

  it('shows the recipient prominently and the sender smaller', () => {
    const blocks = buildLabel(base).blocks
    const find = (text: string) =>
      blocks.find((b) => b.type === 'text' && b.text === text) as Extract<Block, { type: 'text' }>
    expect(find('Budi Santoso')).toMatchObject({ size: 34, bold: true })
    expect(find('Jl. Melati 5 RT 02/03')).toMatchObject({ size: 28 })
    expect(find('Toko Contoh')).toMatchObject({ size: 24, bold: true })
    expect(find('Jl. Contoh No. 1')).toMatchObject({ size: 22 })
  })

  it('shows order id and weight rows', () => {
    expect(columns(buildLabel(base).blocks)).toEqual([
      ['Order', 'ORD-77'],
      ['Weight', '1.25 kg'],
    ])
  })

  it('omits order, weight and phone rows when not given', () => {
    const blocks = buildLabel({
      ...base,
      orderId: undefined,
      weightGrams: undefined,
      recipient: { ...base.recipient, phone: ' ' },
    }).blocks
    expect(columns(blocks)).toEqual([])
    expect(blocks.some((b) => b.type === 'text' && b.text === '0812-0000-1111')).toBe(false)
  })

  it('adds a QR code of the tracking number by default and omits it when disabled', () => {
    const withQr = buildLabel({ ...base, includeQr: undefined }).blocks
    expect(withQr.find((b) => b.type === 'qr')).toEqual({
      type: 'qr',
      data: 'JNE1234567890',
      size: 160,
      align: 'center',
    })
    expect(types(buildLabel({ ...base, includeQr: false }).blocks)).not.toContain('qr')
  })

  it('includes the note when given and ends with a tear-off spacer', () => {
    const blocks = buildLabel(base).blocks
    expect(blocks.some((b) => b.type === 'text' && b.text === 'Fragile')).toBe(true)
    expect(blocks[blocks.length - 1]).toEqual({ type: 'spacer', height: 24 })
  })

  it('trims the tracking number', () => {
    expect(buildLabel({ ...base, trackingNumber: '  ABC123  ' }).blocks[1]).toMatchObject({
      data: 'ABC123',
    })
  })

  it.each([
    ['blank tracking number', { trackingNumber: '  ' }, /tracking/i],
    ['non-ASCII tracking number', { trackingNumber: 'ÄBC123' }, /tracking/i],
    ['tab in tracking number', { trackingNumber: 'AB\tC' }, /tracking/i],
    ['blank recipient name', { recipient: { name: ' ', addressLines: ['x'] } }, /recipient name/i],
    ['no recipient address', { recipient: { name: 'B', addressLines: ['', ' '] } }, /recipient address/i],
    ['blank sender name', { sender: { name: '', addressLines: [] } }, /sender name/i],
    ['zero weight', { weightGrams: 0 }, /weight/i],
    ['NaN weight', { weightGrams: NaN }, /weight/i],
  ])('rejects %s', (_label, patch, message) => {
    expect(() => buildLabel({ ...base, ...patch })).toThrow(message)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/templates/label.test.ts`
Expected: FAIL, `../../src/templates/label` cannot be resolved.

- [ ] **Step 3: Implement the label template**

Create `src/templates/label.ts`:
```ts
import type { Block, DocumentModel } from '../render/types'
import { cleanLines } from './lines'

export interface Party {
  name: string
  phone?: string
  addressLines: string[]
}

export interface LabelData {
  courier?: string
  trackingNumber: string
  orderId?: string
  weightGrams?: number
  note?: string
  includeQr?: boolean
  recipient: Party
  sender: Party
}

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/

function partyBlocks(
  party: Party,
  nameSize: number,
  phoneSize: number,
  addressSize: number,
): Block[] {
  const blocks: Block[] = [{ type: 'text', text: party.name.trim(), size: nameSize, bold: true }]
  const phone = party.phone?.trim()
  if (phone) blocks.push({ type: 'text', text: phone, size: phoneSize })
  for (const line of cleanLines(party.addressLines)) {
    blocks.push({ type: 'text', text: line, size: addressSize })
  }
  return blocks
}

export function buildLabel(data: LabelData): DocumentModel {
  const tracking = data.trackingNumber.trim()
  if (tracking === '') throw new Error('Tracking number is required')
  if (!PRINTABLE_ASCII.test(tracking)) {
    throw new Error('Tracking number may contain printable ASCII characters only')
  }
  if (data.recipient.name.trim() === '') throw new Error('Recipient name is required')
  if (cleanLines(data.recipient.addressLines).length === 0) {
    throw new Error('Recipient address is required')
  }
  if (data.sender.name.trim() === '') throw new Error('Sender name is required')
  if (data.weightGrams !== undefined && (!Number.isFinite(data.weightGrams) || data.weightGrams <= 0)) {
    throw new Error('Weight must be greater than zero')
  }

  const blocks: Block[] = []
  const courier = data.courier?.trim()
  if (courier) blocks.push({ type: 'text', text: courier, size: 30, bold: true, align: 'center' })
  blocks.push({ type: 'barcode', data: tracking, height: 90, align: 'center' })
  blocks.push({ type: 'text', text: tracking, size: 24, bold: true, align: 'center' })
  blocks.push({ type: 'rule' })

  blocks.push({ type: 'text', text: 'TO', size: 20 })
  blocks.push(...partyBlocks(data.recipient, 34, 26, 28))
  blocks.push({ type: 'rule' })

  blocks.push({ type: 'text', text: 'FROM', size: 20 })
  blocks.push(...partyBlocks(data.sender, 24, 22, 22))
  blocks.push({ type: 'rule' })

  const orderId = data.orderId?.trim()
  if (orderId) blocks.push({ type: 'columns', left: 'Order', right: orderId })
  if (data.weightGrams !== undefined) {
    blocks.push({ type: 'columns', left: 'Weight', right: `${(data.weightGrams / 1000).toFixed(2)} kg` })
  }
  const note = data.note?.trim()
  if (note) blocks.push({ type: 'text', text: note, size: 22 })

  if (data.includeQr !== false) {
    blocks.push({ type: 'qr', data: tracking, size: 160, align: 'center' })
  }
  blocks.push({ type: 'spacer', height: 24 })
  return { blocks }
}
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/templates/label.ts tests/templates/label.test.ts
git commit -m "feat: add shipping label template"
```

---

### Task 6: Form parsing and the advisory print flow

**Files:**
- Create: `src/app/forms.ts`, `src/app/print.ts`
- Test: `tests/app/forms.test.ts`, `tests/app/print.test.ts`

**Interfaces:**
- Consumes: `ReceiptData` (Task 4), `LabelData`, `Party` (Task 5), `RgbaImage`, `buildPrintJob` (foundation plan, `src/encode/raster.ts`), `ByteSink`, `sendBytes`, `SEND_DEFAULTS` (`src/printer/send.ts`), `StatusIo`, `readStatus`, `PrinterNotRespondingError` (`src/printer/status.ts`).
- Produces:
  - `src/app/forms.ts`: `class FormError extends Error`; `interface RawReceiptForm { storeName; address; dateTime; receiptNo; cashier: string; items: Array<{ name: string; qty: string; price: string }>; taxPercent; discount; paid; footer: string }`; `interface RawParty { name; phone; address: string }`; `interface RawLabelForm { courier; trackingNumber; orderId; weightGrams; note: string; includeQr: boolean; recipient: RawParty; sender: RawParty }`; `parseNumber(text: string, field: string): number`; `parseReceiptForm(raw: RawReceiptForm): ReceiptData`; `parseLabelForm(raw: RawLabelForm): LabelData`
  - `src/app/print.ts`: `type PrintLink = ByteSink & StatusIo`; `type PrintOutcome = 'printed' | 'cancelled'`; `interface PrintOptions { confirmWarnings(warnings: string[]): Promise<boolean>; onProgress?(sent: number, total: number): void; signal?: AbortSignal; feedLines?: number; sleep?(ms: number): Promise<void> }`; `preflight(io: StatusIo): Promise<string[]>`; `printImage(link: PrintLink, img: RgbaImage, opts: PrintOptions): Promise<PrintOutcome>`

Number parsing accepts digits with an optional decimal point and nothing else. A value that looks like thousands grouping (`15.000`, `1.234.567`) is rejected as ambiguous, because it would otherwise silently print as 15 or 1.234. Blank tax and discount default to 0 and blank paid means no payment rows. Item rows that are completely blank are ignored; a partially filled row is an error naming its position.

`printImage` builds the print job first (so a bad image fails before touching the printer), then runs `preflight`. Warnings are advisory: if there are any, `confirmWarnings` decides, and declining sends no print bytes. A printer that does not answer the status query yields one warning rather than an error; any other status failure (for example not connected) propagates.

- [ ] **Step 1: Write the failing tests**

Create `tests/app/forms.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  FormError,
  parseLabelForm,
  parseNumber,
  parseReceiptForm,
  type RawLabelForm,
  type RawReceiptForm,
} from '../../src/app/forms'

const rawReceipt: RawReceiptForm = {
  storeName: 'Toko Contoh',
  address: 'Jl. Contoh No. 1\n\nJakarta',
  dateTime: '12/10/2026',
  receiptNo: 'INV-001',
  cashier: '',
  items: [
    { name: 'Nasi Goreng', qty: '2', price: '15000' },
    { name: '', qty: '', price: '' },
    { name: 'Es Teh', qty: '1', price: '5000.5' },
  ],
  taxPercent: '10',
  discount: '',
  paid: '50000',
  footer: '',
}

const rawLabel: RawLabelForm = {
  courier: 'JNE REG',
  trackingNumber: 'JNE1234567890',
  orderId: 'ORD-77',
  weightGrams: '1250',
  note: '',
  includeQr: true,
  recipient: { name: 'Budi', phone: '0812', address: 'Jl. Melati 5\nBandung' },
  sender: { name: 'Toko Contoh', phone: '', address: 'Jakarta' },
}

describe('parseNumber', () => {
  it('accepts plain integers and decimals with surrounding spaces', () => {
    expect(parseNumber('15000', 'x')).toBe(15000)
    expect(parseNumber(' 12.5 ', 'x')).toBe(12.5)
    expect(parseNumber('0', 'x')).toBe(0)
  })

  it('rejects numbers that look like thousands grouping as ambiguous', () => {
    expect(() => parseNumber('15.000', 'Price')).toThrow(FormError)
    expect(() => parseNumber('15.000', 'Price')).toThrow(/ambiguous/)
    expect(() => parseNumber('1.234.567', 'Price')).toThrow(/ambiguous/)
  })

  it('rejects commas, signs, letters and empty text', () => {
    for (const bad of ['15,000', '-5', 'abc', '', '1e3', '12.']) {
      expect(() => parseNumber(bad, 'Price')).toThrow(/not a valid number/)
    }
  })

  it('names the field in the message', () => {
    expect(() => parseNumber('x', 'Item 2 price')).toThrow(/Item 2 price/)
  })
})

describe('parseReceiptForm', () => {
  it('parses numbers, skips fully blank item rows and defaults blanks', () => {
    const data = parseReceiptForm(rawReceipt)
    expect(data.items).toEqual([
      { name: 'Nasi Goreng', qty: 2, unitPrice: 15000 },
      { name: 'Es Teh', qty: 1, unitPrice: 5000.5 },
    ])
    expect(data.taxPercent).toBe(10)
    expect(data.discount).toBe(0)
    expect(data.paid).toBe(50000)
    expect(data.addressLines).toEqual(['Jl. Contoh No. 1', '', 'Jakarta'])
  })

  it('treats blank tax as zero and blank paid as no payment', () => {
    const data = parseReceiptForm({ ...rawReceipt, taxPercent: '', paid: '' })
    expect(data.taxPercent).toBe(0)
    expect(data.paid).toBeUndefined()
  })

  it('reports a partially filled item row by its position', () => {
    const items = [{ name: 'Soto', qty: '', price: '1000' }]
    expect(() => parseReceiptForm({ ...rawReceipt, items })).toThrow(/Item 1 quantity/)
  })

  it('requires a name when only numbers are filled in', () => {
    const items = [{ name: '', qty: '1', price: '1000' }]
    expect(() => parseReceiptForm({ ...rawReceipt, items })).toThrow(/Item 1: name is required/)
  })

  it('rejects an ambiguous price', () => {
    const items = [{ name: 'Soto', qty: '1', price: '15.000' }]
    expect(() => parseReceiptForm({ ...rawReceipt, items })).toThrow(/ambiguous/)
  })
})

describe('parseLabelForm', () => {
  it('maps fields and splits addresses into lines', () => {
    const data = parseLabelForm(rawLabel)
    expect(data).toMatchObject({
      courier: 'JNE REG',
      trackingNumber: 'JNE1234567890',
      orderId: 'ORD-77',
      weightGrams: 1250,
      includeQr: true,
    })
    expect(data.recipient).toEqual({ name: 'Budi', phone: '0812', addressLines: ['Jl. Melati 5', 'Bandung'] })
    expect(data.sender.addressLines).toEqual(['Jakarta'])
  })

  it('leaves weight undefined when blank and rejects a bad weight', () => {
    expect(parseLabelForm({ ...rawLabel, weightGrams: '' }).weightGrams).toBeUndefined()
    expect(() => parseLabelForm({ ...rawLabel, weightGrams: '1,5' })).toThrow(/Weight/)
  })

  it('passes includeQr through', () => {
    expect(parseLabelForm({ ...rawLabel, includeQr: false }).includeQr).toBe(false)
  })
})
```

Create `tests/app/print.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { preflight, printImage, type PrintLink } from '../../src/app/print'
import type { RgbaImage } from '../../src/encode/raster'

afterEach(() => vi.useRealTimers())

const noSleep = async () => {}
const OK = [0x16, 0x12, 0x12, 0x12]
const blank = (width = 576, height = 2): RgbaImage => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
})

function fakeLink(replies: number[] | null, failWrite = false) {
  const writes: number[][] = []
  const listeners = new Set<(d: Uint8Array) => void>()
  let next = 0
  const link: PrintLink = {
    async write(data) {
      if (failWrite) throw new Error('not connected')
      writes.push([...data])
      const isStatus = data.length === 3 && data[0] === 0x10 && data[1] === 0x04
      if (isStatus && replies) {
        const value = replies[next++]
        queueMicrotask(() => listeners.forEach((l) => l(Uint8Array.of(value))))
      }
    },
    onNotify(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
  return { link, writes }
}

describe('preflight', () => {
  it('returns no warnings when everything is ready', async () => {
    expect(await preflight(fakeLink(OK).link)).toEqual([])
  })

  it('lists every problem in a fixed order', async () => {
    const warnings = await preflight(fakeLink([0x1e, 0x16, 0x32, 0x72]).link)
    expect(warnings).toEqual([
      'The printer reports it is offline.',
      'The printer cover is open.',
      'The printer reports it is out of paper.',
      'The printer reports an error.',
    ])
  })
})

describe('printImage', () => {
  it('prints without asking when there are no warnings', async () => {
    const { link, writes } = fakeLink(OK)
    const confirmWarnings = vi.fn(async () => true)
    const progress: Array<[number, number]> = []
    const outcome = await printImage(link, blank(), {
      confirmWarnings,
      sleep: noSleep,
      onProgress: (sent, total) => progress.push([sent, total]),
    })
    expect(outcome).toBe('printed')
    expect(confirmWarnings).not.toHaveBeenCalled()
    expect(writes.slice(0, 4).map((w) => w[2])).toEqual([1, 2, 3, 4])
    expect(writes[4]).toEqual([0x1b, 0x40])
    expect(writes.some((w) => w[0] === 0x1b && w[1] === 0x64)).toBe(false)
    const last = progress[progress.length - 1]
    expect(last[0]).toBe(last[1])
  })

  it('sends no print bytes when the user declines the warnings', async () => {
    const { link, writes } = fakeLink([0x16, 0x16, 0x12, 0x12])
    const confirmWarnings = vi.fn(async () => false)
    const outcome = await printImage(link, blank(), { confirmWarnings, sleep: noSleep })
    expect(outcome).toBe('cancelled')
    expect(confirmWarnings).toHaveBeenCalledTimes(1)
    expect(confirmWarnings).toHaveBeenCalledWith(['The printer cover is open.'])
    expect(writes).toHaveLength(4)
    expect(writes.every((w) => w[0] === 0x10 && w[1] === 0x04)).toBe(true)
  })

  it('prints when the user accepts the warnings', async () => {
    const { link, writes } = fakeLink([0x16, 0x16, 0x12, 0x12])
    const outcome = await printImage(link, blank(), {
      confirmWarnings: async () => true,
      sleep: noSleep,
    })
    expect(outcome).toBe('printed')
    expect(writes[4]).toEqual([0x1b, 0x40])
  })

  it('turns a silent printer into a warning instead of hanging', async () => {
    vi.useFakeTimers()
    const { link, writes } = fakeLink(null)
    const confirmWarnings = vi.fn(async () => false)
    const run = printImage(link, blank(), { confirmWarnings, sleep: noSleep })
    await vi.advanceTimersByTimeAsync(1500)
    await expect(run).resolves.toBe('cancelled')
    expect(confirmWarnings).toHaveBeenCalledWith(['The printer did not answer the status check.'])
    expect(writes).toHaveLength(1)
  })

  it('rejects an invalid image before touching the printer', async () => {
    const { link, writes } = fakeLink(OK)
    await expect(
      printImage(link, blank(100), { confirmWarnings: async () => true, sleep: noSleep }),
    ).rejects.toThrow(/576/)
    expect(writes).toHaveLength(0)
  })

  it('propagates a status failure that is not a timeout without asking', async () => {
    const { link } = fakeLink(OK, true)
    const confirmWarnings = vi.fn(async () => true)
    await expect(printImage(link, blank(), { confirmWarnings, sleep: noSleep })).rejects.toThrow(
      'not connected',
    )
    expect(confirmWarnings).not.toHaveBeenCalled()
  })

  it('honors the requested feed length', async () => {
    const { link, writes } = fakeLink(OK)
    await printImage(link, blank(), { confirmWarnings: async () => true, sleep: noSleep, feedLines: 9 })
    expect(writes[writes.length - 1]).toEqual([0x1b, 0x64, 9])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/app`
Expected: FAIL, `../../src/app/forms` and `../../src/app/print` cannot be resolved.

- [ ] **Step 3: Implement form parsing**

Create `src/app/forms.ts`:
```ts
import type { LabelData, Party } from '../templates/label'
import type { ReceiptData, ReceiptItem } from '../templates/receipt'

export class FormError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormError'
  }
}

export interface RawReceiptForm {
  storeName: string
  address: string
  dateTime: string
  receiptNo: string
  cashier: string
  items: Array<{ name: string; qty: string; price: string }>
  taxPercent: string
  discount: string
  paid: string
  footer: string
}

export interface RawParty {
  name: string
  phone: string
  address: string
}

export interface RawLabelForm {
  courier: string
  trackingNumber: string
  orderId: string
  weightGrams: string
  note: string
  includeQr: boolean
  recipient: RawParty
  sender: RawParty
}

const PLAIN_NUMBER = /^\d+(\.\d+)?$/
// "15.000" is thousands grouping in Indonesian but 15 in plain notation; both
// readings are plausible, so it is rejected rather than guessed.
const LOOKS_GROUPED = /^\d{1,3}(\.\d{3})+$/

export function parseNumber(text: string, field: string): number {
  const value = text.trim()
  if (LOOKS_GROUPED.test(value)) {
    throw new FormError(
      `${field}: "${value}" is ambiguous (thousands separator or decimal point). Type ${value.replace(/\./g, '')} for a whole number, or use fewer decimals.`,
    )
  }
  if (!PLAIN_NUMBER.test(value)) {
    throw new FormError(
      `${field}: "${value}" is not a valid number; use digits and an optional decimal point`,
    )
  }
  return Number(value)
}

function optionalNumber(text: string, field: string, fallback: number): number {
  return text.trim() === '' ? fallback : parseNumber(text, field)
}

export function parseReceiptForm(raw: RawReceiptForm): ReceiptData {
  const items: ReceiptItem[] = []
  raw.items.forEach((row, i) => {
    const name = row.name.trim()
    if (name === '' && row.qty.trim() === '' && row.price.trim() === '') return
    const n = i + 1
    if (name === '') throw new FormError(`Item ${n}: name is required`)
    items.push({
      name,
      qty: parseNumber(row.qty, `Item ${n} quantity`),
      unitPrice: parseNumber(row.price, `Item ${n} price`),
    })
  })
  return {
    storeName: raw.storeName,
    addressLines: raw.address.split('\n'),
    dateTime: raw.dateTime,
    receiptNo: raw.receiptNo,
    cashier: raw.cashier,
    items,
    taxPercent: optionalNumber(raw.taxPercent, 'Tax percent', 0),
    discount: optionalNumber(raw.discount, 'Discount', 0),
    paid: raw.paid.trim() === '' ? undefined : parseNumber(raw.paid, 'Paid'),
    footer: raw.footer,
  }
}

function toParty(raw: { name: string; phone: string; address: string }): Party {
  return { name: raw.name, phone: raw.phone, addressLines: raw.address.split('\n') }
}

export function parseLabelForm(raw: RawLabelForm): LabelData {
  return {
    courier: raw.courier,
    trackingNumber: raw.trackingNumber,
    orderId: raw.orderId,
    weightGrams: raw.weightGrams.trim() === '' ? undefined : parseNumber(raw.weightGrams, 'Weight'),
    note: raw.note,
    includeQr: raw.includeQr,
    recipient: toParty(raw.recipient),
    sender: toParty(raw.sender),
  }
}
```

- [ ] **Step 4: Implement the print flow**

Create `src/app/print.ts`:
```ts
import { buildPrintJob, type RgbaImage } from '../encode/raster'
import { sendBytes, type ByteSink } from '../printer/send'
import { PrinterNotRespondingError, readStatus, type StatusIo } from '../printer/status'

export type PrintLink = ByteSink & StatusIo
export type PrintOutcome = 'printed' | 'cancelled'

export interface PrintOptions {
  confirmWarnings(warnings: string[]): Promise<boolean>
  onProgress?(sent: number, total: number): void
  signal?: AbortSignal
  feedLines?: number
  sleep?(ms: number): Promise<void>
}

// Status bit decoding has only been observed for the all-clear case on this
// printer, so every finding here is a warning the user can override.
export async function preflight(io: StatusIo): Promise<string[]> {
  let status
  try {
    status = await readStatus(io)
  } catch (err) {
    if (err instanceof PrinterNotRespondingError) {
      return ['The printer did not answer the status check.']
    }
    throw err
  }
  const warnings: string[] = []
  if (!status.online) warnings.push('The printer reports it is offline.')
  if (!status.coverClosed) warnings.push('The printer cover is open.')
  if (!status.paperPresent) warnings.push('The printer reports it is out of paper.')
  if (status.error) warnings.push('The printer reports an error.')
  return warnings
}

export async function printImage(
  link: PrintLink,
  img: RgbaImage,
  opts: PrintOptions,
): Promise<PrintOutcome> {
  const job = buildPrintJob(img, { feedLines: opts.feedLines })
  const warnings = await preflight(link)
  if (warnings.length > 0 && !(await opts.confirmWarnings(warnings))) return 'cancelled'
  await sendBytes(link, job, {
    onProgress: opts.onProgress,
    signal: opts.signal,
    sleep: opts.sleep,
  })
  return 'printed'
}
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/forms.ts src/app/print.ts tests/app
git commit -m "feat: add form parsing and advisory print flow"
```

---

### Task 7: The app UI and browser smoke check

**Files:**
- Create: `src/app/dom.ts`, `src/app/receiptForm.ts`, `src/app/labelForm.ts`, `src/app/app.ts`, `src/app/style.css`, `spike.html`
- Modify: `src/main.ts` (becomes the app entry; the spike moves), `src/printer/webBluetooth.ts` (disconnect handling), `vite.config.ts` (two pages)
- Move: `src/main.ts` to `src/spike/main.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 6, plus `exclusive` (`src/util/exclusive.ts`), `WebBluetoothPrinter`, `PrintInterruptedError`.
- Produces: `createApp(root: HTMLElement): void` in `src/app/app.ts`; `interface FormView<T> { element: HTMLElement; read(): T; onChange(cb: () => void): void }` in `src/app/dom.ts`; `createReceiptForm(now?: Date): FormView<RawReceiptForm>`; `createLabelForm(): FormView<RawLabelForm>`; `WebBluetoothPrinter.onDisconnected(cb: () => void): () => void`.

The DOM layer has no unit tests (Vitest runs in Node). It is verified by typecheck, a production build, and the browser smoke check in Step 8. Printing itself needs the real printer and is left for the owner.

The UI keeps the last good preview off the screen when the form is invalid: on any parse or template error the preview shows the error text and Print is disabled, so a stale document can never be printed. The preview is the 1-bit result (`monoPreview`), not the anti-aliased canvas. Paper offers "Continuous roll" and a disabled "Sticker roll (not supported yet)" option.

- [ ] **Step 1: Move the spike out of the way**

Run:
```bash
git mv src/main.ts src/spike/main.ts
sed -i.bak \
  -e "s#from './encode/#from '../encode/#" \
  -e "s#from './printer/#from '../printer/#" \
  -e "s#from './spike/patterns'#from './patterns'#" \
  -e "s#from './util/#from '../util/#" \
  src/spike/main.ts && rm src/spike/main.ts.bak
grep -n "^import" src/spike/main.ts
```
Expected: every import path resolves (`../encode/raster`, `../printer/send`, `../printer/status`, `../printer/webBluetooth`, `./patterns`, `../util/exclusive`).

Create `spike.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bt-printer spike</title>
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="/src/spike/main.ts"></script>
  </body>
</html>
```

Replace `vite.config.ts` with:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: 'index.html', spike: 'spike.html' },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
})
```
If `npm run build` later rejects `rollupOptions`, rename it to `rolldownOptions`.

- [ ] **Step 2: Make the Bluetooth adapter report disconnects and clean up**

Replace `src/printer/webBluetooth.ts` with:
```ts
import type { ByteSink } from './send'
import type { StatusIo } from './status'

export const PRINTER_NAME = 'RPP02N'
export const SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb'
export const WRITE_CHAR_UUID = '0000ff02-0000-1000-8000-00805f9b34fb'
export const NOTIFY_CHAR_UUID = '0000ff01-0000-1000-8000-00805f9b34fb'

export class WebBluetoothPrinter implements ByteSink, StatusIo {
  private device?: BluetoothDevice
  private writeChar?: BluetoothRemoteGATTCharacteristic
  private notifyChar?: BluetoothRemoteGATTCharacteristic
  private readonly listeners = new Set<(data: Uint8Array) => void>()
  private readonly disconnectListeners = new Set<() => void>()

  get connected(): boolean {
    return this.device?.gatt?.connected === true
  }

  async connect(): Promise<void> {
    if (!('bluetooth' in navigator)) {
      throw new Error('Web Bluetooth is not available. Use Chrome or Edge over HTTPS or localhost.')
    }
    this.teardown()
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: PRINTER_NAME }],
      optionalServices: [SERVICE_UUID],
    })
    if (!device.gatt) throw new Error('The selected device has no GATT server')
    device.addEventListener('gattserverdisconnected', this.handleDisconnected)
    this.device = device
    try {
      const server = await device.gatt.connect()
      const service = await server.getPrimaryService(SERVICE_UUID)
      this.writeChar = await service.getCharacteristic(WRITE_CHAR_UUID)
      this.notifyChar = await service.getCharacteristic(NOTIFY_CHAR_UUID)
      this.notifyChar.addEventListener('characteristicvaluechanged', this.handleNotify)
      await this.notifyChar.startNotifications()
    } catch (err) {
      this.teardown()
      throw err
    }
  }

  disconnect(): void {
    this.teardown()
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writeChar || !this.connected) throw new Error('Printer is not connected')
    await this.writeChar.writeValueWithResponse(data.slice())
  }

  onNotify(cb: (data: Uint8Array) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onDisconnected(cb: () => void): () => void {
    this.disconnectListeners.add(cb)
    return () => this.disconnectListeners.delete(cb)
  }

  private teardown(): void {
    this.notifyChar?.removeEventListener('characteristicvaluechanged', this.handleNotify)
    this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnected)
    this.device?.gatt?.disconnect()
    this.writeChar = undefined
    this.notifyChar = undefined
    this.device = undefined
  }

  private readonly handleDisconnected = (): void => {
    this.writeChar = undefined
    this.notifyChar = undefined
    this.disconnectListeners.forEach((cb) => cb())
  }

  private readonly handleNotify = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value
    if (!value) return
    const copy = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
    this.listeners.forEach((cb) => cb(copy))
  }
}
```

- [ ] **Step 3: Write the DOM helpers and the two forms**

Create `src/app/dom.ts`:
```ts
export interface FormView<T> {
  element: HTMLElement
  read(): T
  onChange(cb: () => void): void
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  node.append(...children)
  return node
}

export function field(label: string, control: HTMLElement): HTMLLabelElement {
  return el('label', { className: 'field' }, [el('span', { textContent: label }), control])
}

export function textInput(value = '', placeholder = ''): HTMLInputElement {
  return el('input', { type: 'text', value, placeholder })
}

export function textArea(value = '', rows = 3): HTMLTextAreaElement {
  return el('textarea', { value, rows })
}
```

Create `src/app/receiptForm.ts`:
```ts
import { el, field, textArea, textInput, type FormView } from './dom'
import type { RawReceiptForm } from './forms'

export function createReceiptForm(now: Date = new Date()): FormView<RawReceiptForm> {
  const listeners: Array<() => void> = []
  const notify = () => listeners.forEach((cb) => cb())

  const storeName = textInput('Toko Contoh')
  const address = textArea('Jl. Contoh No. 1\nJakarta', 2)
  const dateTime = textInput(now.toLocaleString('id-ID'))
  const receiptNo = textInput('INV-001')
  const cashier = textInput('')
  const taxPercent = textInput('0')
  const discount = textInput('0')
  const paid = textInput('')
  const footer = textInput('Terima kasih')

  const rows = el('div', { className: 'items' })
  function addRow(name = '', qty = '1', price = ''): void {
    const row = el('div', { className: 'item-row' })
    const nameInput = textInput(name, 'Item')
    const qtyInput = textInput(qty, 'Qty')
    const priceInput = textInput(price, 'Price')
    nameInput.dataset.col = 'name'
    qtyInput.dataset.col = 'qty'
    priceInput.dataset.col = 'price'
    const remove = el('button', { type: 'button', textContent: 'Remove' })
    remove.addEventListener('click', () => {
      row.remove()
      notify()
    })
    row.append(nameInput, qtyInput, priceInput, remove)
    rows.append(row)
  }
  addRow('Nasi Goreng', '2', '15000')
  addRow('Es Teh', '1', '5000')

  const add = el('button', { type: 'button', textContent: 'Add item' })
  add.addEventListener('click', () => {
    addRow()
    notify()
  })

  const element = el('div', { className: 'form' })
  element.append(
    field('Store name', storeName),
    field('Address (one line per row)', address),
    field('Date / time', dateTime),
    field('Receipt no.', receiptNo),
    field('Cashier', cashier),
    el('h3', { textContent: 'Items' }),
    rows,
    add,
    field('Tax %', taxPercent),
    field('Discount', discount),
    field('Paid', paid),
    field('Footer', footer),
  )
  element.addEventListener('input', notify)

  const cell = (row: HTMLElement, col: string) =>
    row.querySelector<HTMLInputElement>(`[data-col="${col}"]`)!.value

  return {
    element,
    onChange: (cb) => {
      listeners.push(cb)
    },
    read: () => ({
      storeName: storeName.value,
      address: address.value,
      dateTime: dateTime.value,
      receiptNo: receiptNo.value,
      cashier: cashier.value,
      items: Array.from(rows.querySelectorAll<HTMLElement>('.item-row')).map((row) => ({
        name: cell(row, 'name'),
        qty: cell(row, 'qty'),
        price: cell(row, 'price'),
      })),
      taxPercent: taxPercent.value,
      discount: discount.value,
      paid: paid.value,
      footer: footer.value,
    }),
  }
}
```

Create `src/app/labelForm.ts`:
```ts
import { el, field, textArea, textInput, type FormView } from './dom'
import type { RawLabelForm, RawParty } from './forms'

function partyFields(title: string, party: RawParty) {
  const name = textInput(party.name)
  const phone = textInput(party.phone)
  const address = textArea(party.address, 3)
  return {
    nodes: [el('h3', { textContent: title }), field('Name', name), field('Phone', phone), field('Address (one line per row)', address)],
    read: (): RawParty => ({ name: name.value, phone: phone.value, address: address.value }),
  }
}

export function createLabelForm(): FormView<RawLabelForm> {
  const listeners: Array<() => void> = []
  const notify = () => listeners.forEach((cb) => cb())

  const courier = textInput('JNE REG')
  const trackingNumber = textInput('JNE1234567890')
  const orderId = textInput('ORD-77')
  const weightGrams = textInput('1250')
  const note = textInput('')
  const includeQr = el('input', { type: 'checkbox', checked: true })

  const recipient = partyFields('Recipient (TO)', {
    name: 'Budi Santoso',
    phone: '0812-0000-1111',
    address: 'Jl. Melati 5 RT 02/03\nBandung 40111',
  })
  const sender = partyFields('Sender (FROM)', {
    name: 'Toko Contoh',
    phone: '021-555-0100',
    address: 'Jl. Contoh No. 1\nJakarta 10110',
  })

  const element = el('div', { className: 'form' })
  element.append(
    field('Courier / service', courier),
    field('Tracking number', trackingNumber),
    field('Order id', orderId),
    field('Weight (grams)', weightGrams),
    field('Note', note),
    field('Print QR code', includeQr),
    ...recipient.nodes,
    ...sender.nodes,
  )
  element.addEventListener('input', notify)

  return {
    element,
    onChange: (cb) => {
      listeners.push(cb)
    },
    read: () => ({
      courier: courier.value,
      trackingNumber: trackingNumber.value,
      orderId: orderId.value,
      weightGrams: weightGrams.value,
      note: note.value,
      includeQr: includeQr.checked,
      recipient: recipient.read(),
      sender: sender.read(),
    }),
  }
}
```

- [ ] **Step 4: Write the app shell, styles and entry point**

Create `src/app/app.ts`:
```ts
import { monoPreview } from '../encode/raster'
import { PrintInterruptedError } from '../printer/send'
import { WebBluetoothPrinter } from '../printer/webBluetooth'
import { renderDocument } from '../render/render'
import { buildLabel } from '../templates/label'
import { buildReceipt } from '../templates/receipt'
import { exclusive } from '../util/exclusive'
import { parseLabelForm, parseReceiptForm } from './forms'
import { createLabelForm } from './labelForm'
import { printImage } from './print'
import { createReceiptForm } from './receiptForm'

type Mode = 'receipt' | 'label'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function createApp(root: HTMLElement): void {
  const printer = new WebBluetoothPrinter()
  const forms = { receipt: createReceiptForm(), label: createLabelForm() }
  let mode: Mode = 'receipt'
  let current: HTMLCanvasElement | null = null
  let abort: AbortController | null = null
  let busy = false

  root.innerHTML = `
    <header>
      <h1>bt-printer</h1>
      <nav>
        <button data-mode="receipt">Receipt</button>
        <button data-mode="label">Shipping label</button>
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
    connEl.textContent = printer.connected ? 'Connected' : 'Not connected'
    connectBtn.textContent = printer.connected ? 'Disconnect' : 'Connect printer'
    connectBtn.disabled = busy
    printBtn.disabled = busy || !printer.connected || current === null
    cancelBtn.disabled = !busy || abort === null
  }

  function refresh(): void {
    try {
      const doc =
        mode === 'receipt'
          ? buildReceipt(parseReceiptForm(forms.receipt.read()))
          : buildLabel(parseLabelForm(forms.label.read()))
      const canvas = renderDocument(doc)
      const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
      preview.width = canvas.width
      preview.height = canvas.height
      preview
        .getContext('2d')!
        .putImageData(new ImageData(monoPreview(img), img.width, img.height), 0, 0)
      current = canvas
      errorEl.textContent = ''
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
    if (!current) return
    const canvas = current
    const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
    abort = new AbortController()
    busy = true
    progress.value = 0
    updateButtons()
    try {
      const outcome = await printImage(printer, img, {
        confirmWarnings: async (warnings) =>
          window.confirm(`${warnings.join('\n')}\n\nPrint anyway?`),
        onProgress: (sent, total) => {
          progress.max = total
          progress.value = sent
        },
        signal: abort.signal,
      })
      log(outcome === 'printed' ? 'Printed' : 'Cancelled before printing')
    } catch (err) {
      if (err instanceof PrintInterruptedError) {
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

Create `src/app/style.css`:
```css
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #f4f4f5; color: #18181b; }
header { display: flex; align-items: center; gap: 16px; padding: 8px 16px; background: #fff; border-bottom: 1px solid #d4d4d8; }
header h1 { font-size: 16px; margin: 0; }
nav button.active { font-weight: 700; text-decoration: underline; }
.cols { display: grid; grid-template-columns: minmax(280px, 420px) 1fr; gap: 16px; padding: 16px; align-items: start; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }
.form, .panel, .preview { background: #fff; border: 1px solid #d4d4d8; border-radius: 6px; padding: 12px; }
.side { display: grid; gap: 12px; }
.field { display: grid; gap: 2px; margin-bottom: 8px; }
.field input[type='text'], .field textarea { width: 100%; padding: 6px; font: inherit; }
.item-row { display: grid; grid-template-columns: 1fr 56px 90px auto; gap: 4px; margin-bottom: 4px; }
.preview canvas { display: block; width: 100%; max-width: 576px; height: auto; image-rendering: pixelated; border: 1px dashed #a1a1aa; background: #fff; }
#error { color: #b91c1c; min-height: 1.4em; margin: 8px 0 0; }
#log { background: #f4f4f5; padding: 8px; min-height: 6em; max-height: 12em; overflow: auto; margin: 8px 0 0; }
progress { width: 100%; margin-top: 8px; }
```

Write `src/main.ts`:
```ts
import './app/style.css'
import { createApp } from './app/app'

createApp(document.getElementById('app')!)
```

- [ ] **Step 5: Typecheck, test and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck exits 0, all tests PASS, build succeeds and emits both `dist/index.html` and `dist/spike.html`.

- [ ] **Step 6: Commit**

```bash
git add src spike.html vite.config.ts
git commit -m "feat: add receipt and label app UI"
```

- [ ] **Step 7: Browser smoke check**

Run `npm run dev -- --port 5173` in the background. In a browser (the Playwright MCP tools are available), open `http://localhost:5173` and verify:
1. The page title is `bt-printer`, the preview canvas is 576 pixels wide and taller than 100 pixels, and counting pixels with red channel 0 in the preview canvas gives more than 1000 (the receipt rendered).
2. Clicking "Shipping label" changes the preview height, shows no error text, and the preview contains a QR code and barcode area (dark pixel count above 3000).
3. Changing the tracking number to `ÄBC` shows the error "Tracking number may contain printable ASCII characters only" in `#error` and leaves the Print button disabled.
4. Back on the receipt tab, setting the first item price to `15.000` shows the "ambiguous" error.
5. Take a screenshot of the receipt tab and the label tab and look at them for clipped or overlapping text.

Expected: all five hold. Fix any layout defect found (add a failing unit test first when the defect is in `layout`, `text`, or a template) before continuing. Stop the dev server afterwards.

- [ ] **Step 8: Record the result and commit any fixes**

If Step 7 required changes, commit them with a message describing the fix. Then run `npm run typecheck && npm test && npm run build` once more.
Expected: all green.

---

## Self-review

**Spec coverage.** Milestone 2 (render, receipt form, preview) is Tasks 1, 3, 4, 6 and 7. Milestone 3 (shipping label with QR and CODE128, continuous paper) is Tasks 2, 5 and 7. The spec's rules are covered: the preview is the exact 1-bit canvas (`monoPreview`, Task 3, with a test tying it to the encoder); status gating is advisory and checks paper and cover (`preflight`, Task 6); a mid-job failure reports bytes sent (existing `sendBytes`, surfaced in the UI log with its cause); the chooser-cancelled, device-not-found and disconnect cases surface in the log and the adapter now reports disconnects (Task 7); Safari and non-secure contexts get the clear Web Bluetooth error from the adapter. Not in this plan by design: PDF import, CSV batch printing, sticker mode, dithering, and a persistent store for form values.

**Placeholders.** None; every code step has complete code and every run step has a command and expected result.

**Type consistency.** `Block`, `LayoutItem`, `Layout`, `DocumentModel`, `RgbaImage`, `FormView`, `RawReceiptForm`, `RawLabelForm`, `ReceiptData`, `LabelData`, `PrintLink`, `PrintOptions` and `printImage` use the same names and fields wherever they appear. `Block` gains `qr` and `barcode` in Task 2 and the layout `switch` stays exhaustive through `assertNever`. `monoPreview` returns `Uint8ClampedArray<ArrayBuffer>` so `new ImageData(...)` accepts it.
