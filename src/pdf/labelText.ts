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

export function productTableTop(items: TextItem[], pageHeight: number): number | null {
  const header = items.find((item) => /^\s*Nama Produk\s*$/i.test(item.str))
  return header ? itemTop(header, pageHeight) : null
}
