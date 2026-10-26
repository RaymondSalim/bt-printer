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
