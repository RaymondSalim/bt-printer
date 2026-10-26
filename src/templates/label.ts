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
