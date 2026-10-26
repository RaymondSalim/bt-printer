import QRCode from 'qrcode'

export function qrMatrix(data: string): boolean[][] {
  if (data === '') throw new Error('QR data is empty')
  const qr = QRCode.create(data, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  return Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, col) => Boolean(qr.modules.get(row, col))),
  )
}
