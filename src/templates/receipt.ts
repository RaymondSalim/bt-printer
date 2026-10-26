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
