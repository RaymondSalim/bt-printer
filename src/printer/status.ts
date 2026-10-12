export interface StatusIo {
  write(data: Uint8Array): Promise<void>
  onNotify(cb: (data: Uint8Array) => void): () => void
}

export interface PrinterStatus {
  online: boolean
  coverClosed: boolean
  paperPresent: boolean
  error: boolean
  raw: [number, number, number, number]
}

export class PrinterNotRespondingError extends Error {
  constructor(query: number, timeoutMs: number) {
    super(`Printer did not answer status query ${query} within ${timeoutMs} ms`)
    this.name = 'PrinterNotRespondingError'
  }
}

// Bit meanings follow the Epson ESC/POS DLE EOT table. Only the all-clear
// replies (0x16, 0x12, 0x12, 0x12) have been observed on the Putian 802.
export function decodeStatus(raw: readonly [number, number, number, number]): PrinterStatus {
  const [b1, b2, b3, b4] = raw
  return {
    online: (b1 & 0x08) === 0,
    coverClosed: (b2 & 0x04) === 0,
    paperPresent: (b4 & 0x60) === 0,
    error: (b3 & 0x6c) !== 0,
    raw: [b1, b2, b3, b4],
  }
}

function query(io: StatusIo, n: number, timeoutMs: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let off: () => void = () => {}
    const timer = setTimeout(() => {
      off()
      reject(new PrinterNotRespondingError(n, timeoutMs))
    }, timeoutMs)
    off = io.onNotify((data) => {
      if (data.length === 0) return
      clearTimeout(timer)
      off()
      resolve(data[0])
    })
    io.write(Uint8Array.of(0x10, 0x04, n)).catch((err) => {
      clearTimeout(timer)
      off()
      reject(err)
    })
  })
}

export async function readStatus(io: StatusIo, timeoutMs = 1500): Promise<PrinterStatus> {
  const b1 = await query(io, 1, timeoutMs)
  const b2 = await query(io, 2, timeoutMs)
  const b3 = await query(io, 3, timeoutMs)
  const b4 = await query(io, 4, timeoutMs)
  return decodeStatus([b1, b2, b3, b4])
}
