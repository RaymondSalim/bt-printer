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
