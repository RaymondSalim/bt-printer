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
