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
