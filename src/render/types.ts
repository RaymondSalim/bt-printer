export type Align = 'left' | 'center' | 'right'

export type Block =
  | { type: 'text'; text: string; size?: number; bold?: boolean; align?: Align }
  | { type: 'columns'; left: string; right: string; size?: number; bold?: boolean }
  | { type: 'rule'; thickness?: number }
  | { type: 'spacer'; height: number }
  | { type: 'qr'; data: string; size?: number; align?: Align }
  | { type: 'barcode'; data: string; height?: number; moduleWidth?: number; align?: Align }

export interface DocumentModel {
  blocks: Block[]
  marginX?: number
  marginY?: number
}
