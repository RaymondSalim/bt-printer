import { composeLabel } from '../pdf/compose'
import {
  closePdf,
  extractLabels,
  openPdf,
  renderLabel,
  renderLabelReference,
  type LabelSource,
  type PdfDocument,
} from '../pdf/load'
import { orderStripDocument } from '../pdf/orderStrip'
import { readCodes, scanCheck } from '../pdf/scanCheck'
import { setupZXing } from '../pdf/zxingSetup'
import { renderDocument } from '../render/render'
import { awaitStable } from '../util/awaitStable'
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
  scan: HTMLElement
  canvas: HTMLCanvasElement | null
  reference: Promise<string[]> | null
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Browser or library incompatibilities surface as these error types; their first stack frames
// say where, which is the only clue on a device without a console.
const ENVIRONMENT_ERRORS = new Set(['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'])
const errorLocation = (err: unknown): string => {
  if (!(err instanceof Error) || !ENVIRONMENT_ERRORS.has(err.name) || !err.stack) return ''
  const frames = err.stack
    .split('\n')
    .slice(0, 2)
    .map((line) => line.trim().slice(-100))
  return ` [${frames.join(' | ')}]`
}
const imageOf = (canvas: HTMLCanvasElement) =>
  canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)

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
  const orderMode = el('select', {}, [
    el('option', { value: 'auto', textContent: 'Automatic (only when needed)' }),
    el('option', { value: 'always', textContent: 'Always' }),
    el('option', { value: 'never', textContent: 'Never' }),
  ])
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
    const scan = el('p', { className: 'scan' })
    const row = el('div', { className: 'entry' }, [el('label', {}, [include, title]), thumb, note, scan])
    const entry: Entry = { source, row, include, thumb, note, scan, canvas: null, reference: null }
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
    doc: PdfDocument,
  ): Promise<{ canvas: HTMLCanvasElement; notes: string[] }> {
    const notes: string[] = []
    const label = await renderLabel(doc, entry.source, { includeProducts: includeProducts.checked })
    const order = entry.source.orderNumber
    const stripDoc = order ? orderStripDocument(order) : null
    const mode = orderMode.value
    let withStrip = false
    if (mode !== 'never') {
      if (!order) {
        notes.push('No order number found in the PDF text, so no order barcode was added.')
      } else if (!stripDoc) {
        notes.push(`Order number ${order} cannot be drawn as a Code 128 barcode at this width.`)
      } else if (mode === 'always') {
        withStrip = true
      } else {
        try {
          await setupZXing()
          const { missing } = await scanCheck(imageOf(composeLabel(label, null)), [order])
          withStrip = missing.length > 0
          if (!withStrip) {
            notes.push(`The label's own barcode already reads ${order}, so no extra barcode was added.`)
          }
        } catch {
          withStrip = true
        }
      }
    }
    return { canvas: composeLabel(label, withStrip && stripDoc ? renderDocument(stripDoc) : null), notes }
  }

  async function checkScan(entry: Entry, canvas: HTMLCanvasElement, doc: PdfDocument): Promise<void> {
    entry.scan.className = 'scan'
    entry.scan.textContent = 'Checking barcodes...'
    try {
      await setupZXing()
      entry.reference ??= renderLabelReference(doc, entry.source).then((reference) =>
        readCodes(imageOf(reference), 'reference'),
      )
      const expected = [...new Set(await entry.reference)]
      if (expected.length === 0) {
        entry.scan.textContent = 'Scan check skipped: no barcode could be read from the original PDF.'
        return
      }
      const { missing } = await scanCheck(imageOf(canvas), expected)
      if (missing.length === 0) {
        entry.scan.textContent = `Scan check passed: ${expected.join(', ')} readable in the printed image.`
      } else {
        entry.scan.className = 'scan fail'
        entry.scan.textContent = `Scan check FAILED: could not read ${missing.join(', ')} in the printed image.`
      }
    } catch (err) {
      entry.scan.textContent = `Scan check unavailable: ${message(err)}`
    }
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
          await checkScan(entry, canvas, target)
          if (mine !== generation) return
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
    const previous = pdf
    pdf = null
    if (previous) void closePdf(previous)
    entries = []
    previewIndex = 0
    list.replaceChildren()
    const file = fileInput.files?.[0]
    // Clearing the input lets the same filename be chosen again, which would not fire a change event otherwise.
    fileInput.value = ''
    if (!file) {
      statusEl.textContent = 'Choose a Shopee shipping label PDF.'
      notify()
      return
    }
    statusEl.textContent = `Reading ${file.name}...`
    notify()
    try {
      const opened = await openPdf(await file.arrayBuffer())
      let sources: LabelSource[]
      try {
        sources = await extractLabels(opened)
      } catch (err) {
        void closePdf(opened)
        throw err
      }
      if (token !== fileToken) {
        void closePdf(opened)
        return
      }
      pdf = opened
      entries = sources.map(makeEntry)
      list.replaceChildren(...entries.map((entry) => entry.row))
      markPreview()
      statusEl.textContent =
        sources.length === 0
          ? 'No labels found: the pages look blank.'
          : `${sources.length} label${sources.length === 1 ? '' : 's'} found in ${file.name}.`
      notify()
      await renderAll()
    } catch (err) {
      if (token !== fileToken) return
      statusEl.textContent = `Could not read the PDF: ${message(err)}${errorLocation(err)}`
      notify()
    }
  })
  includeProducts.addEventListener('change', () => void renderAll())
  orderMode.addEventListener('change', () => void renderAll())

  const element = el('div', { className: 'form' })
  element.append(
    field('PDF file', fileInput),
    field('Include product list', includeProducts),
    field('Order barcode', orderMode),
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
      await awaitStable(() => rendering)
      return entries.flatMap((e) => (e.include.checked && e.canvas ? [e.canvas] : []))
    },
  }
}
