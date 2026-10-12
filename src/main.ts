import { buildPrintJob } from './encode/raster'
import { PrintInterruptedError, SEND_DEFAULTS, sendBytes } from './printer/send'
import { readStatus } from './printer/status'
import { WebBluetoothPrinter } from './printer/webBluetooth'
import { drawLongPattern, drawRuler } from './spike/patterns'

const printer = new WebBluetoothPrinter()
const app = document.getElementById('app')!
app.innerHTML = `
  <h1>bt-printer spike</h1>
  <p>
    <button id="connect">Connect</button>
    <button id="status">Status</button>
    <button id="ruler">Print ruler</button>
  </p>
  <p>
    rows <input id="rows" type="number" value="300" min="1" style="width:5em">
    chunk delay ms <input id="delay" type="number" value="${SEND_DEFAULTS.delayMs}" min="0" style="width:4em">
    band pause ms <input id="pause" type="number" value="${SEND_DEFAULTS.partPauseMs}" min="0" style="width:4em">
    <button id="long">Print long pattern</button>
  </p>
  <pre id="log" style="background:#eee;padding:8px;min-height:8em"></pre>
`

const log = (msg: string) => {
  const el = document.getElementById('log')!
  el.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`
}
const num = (id: string) => Number((document.getElementById(id) as HTMLInputElement).value)

async function run(label: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    if (err instanceof PrintInterruptedError) {
      log(`${label} FAILED: ${err.message} (${err.reason})`)
    } else {
      log(`${label} FAILED: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function printCanvas(canvas: HTMLCanvasElement, delayMs: number, partPauseMs: number) {
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const job = buildPrintJob(img)
  const total = job.reduce((n, p) => n + p.length, 0)
  log(`sending ${total} bytes in ${job.length} parts (delay ${delayMs} ms, band pause ${partPauseMs} ms)`)
  const started = performance.now()
  await sendBytes(printer, job, { delayMs, partPauseMs })
  const secs = (performance.now() - started) / 1000
  log(`sent in ${secs.toFixed(1)} s, ${(total / 1024 / secs).toFixed(1)} KiB/s`)
}

document.getElementById('connect')!.addEventListener('click', () =>
  run('connect', async () => {
    await printer.connect()
    log('connected')
  }),
)
document.getElementById('status')!.addEventListener('click', () =>
  run('status', async () => {
    const s = await readStatus(printer)
    log(`status ${JSON.stringify(s)}`)
  }),
)
document.getElementById('ruler')!.addEventListener('click', () =>
  run('ruler', () => printCanvas(drawRuler(), SEND_DEFAULTS.delayMs, SEND_DEFAULTS.partPauseMs)),
)
document.getElementById('long')!.addEventListener('click', () =>
  run('long', () => printCanvas(drawLongPattern(num('rows')), num('delay'), num('pause'))),
)
