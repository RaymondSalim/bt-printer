import { monoPreview } from '../encode/raster'
import { PrintInterruptedError } from '../printer/send'
import { WebBluetoothPrinter } from '../printer/webBluetooth'
import { renderDocument } from '../render/render'
import { buildLabel } from '../templates/label'
import { buildReceipt } from '../templates/receipt'
import { exclusive } from '../util/exclusive'
import { parseLabelForm, parseReceiptForm } from './forms'
import { createLabelForm } from './labelForm'
import { printImage } from './print'
import { createReceiptForm } from './receiptForm'

type Mode = 'receipt' | 'label'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function createApp(root: HTMLElement): void {
  const printer = new WebBluetoothPrinter()
  const forms = { receipt: createReceiptForm(), label: createLabelForm() }
  let mode: Mode = 'receipt'
  let current: HTMLCanvasElement | null = null
  let abort: AbortController | null = null
  let busy = false

  root.innerHTML = `
    <header>
      <h1>bt-printer</h1>
      <nav>
        <button data-mode="receipt">Receipt</button>
        <button data-mode="label">Shipping label</button>
      </nav>
    </header>
    <div class="cols">
      <section id="form"></section>
      <section class="side">
        <div class="panel">
          <button id="connect">Connect printer</button>
          <span id="conn">Not connected</span>
          <label>Paper
            <select id="paper">
              <option value="continuous">Continuous roll</option>
              <option value="sticker" disabled>Sticker roll (not supported yet)</option>
            </select>
          </label>
        </div>
        <div class="preview">
          <canvas id="preview" width="576" height="16"></canvas>
          <p id="error" role="alert"></p>
        </div>
        <div class="panel">
          <button id="print" disabled>Print</button>
          <button id="cancel" disabled>Cancel</button>
          <progress id="progress" value="0" max="1"></progress>
          <pre id="log"></pre>
        </div>
      </section>
    </div>
  `
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const formHost = q('#form')
  const preview = q<HTMLCanvasElement>('#preview')
  const errorEl = q('#error')
  const connectBtn = q<HTMLButtonElement>('#connect')
  const connEl = q('#conn')
  const printBtn = q<HTMLButtonElement>('#print')
  const cancelBtn = q<HTMLButtonElement>('#cancel')
  const progress = q<HTMLProgressElement>('#progress')
  const logEl = q('#log')

  const log = (text: string) => {
    logEl.textContent += `${new Date().toLocaleTimeString()}  ${text}\n`
    logEl.scrollTop = logEl.scrollHeight
  }

  function updateButtons(): void {
    connEl.textContent = printer.connected ? 'Connected' : 'Not connected'
    connectBtn.textContent = printer.connected ? 'Disconnect' : 'Connect printer'
    connectBtn.disabled = busy
    printBtn.disabled = busy || !printer.connected || current === null
    cancelBtn.disabled = !busy || abort === null
  }

  function refresh(): void {
    try {
      const doc =
        mode === 'receipt'
          ? buildReceipt(parseReceiptForm(forms.receipt.read()))
          : buildLabel(parseLabelForm(forms.label.read()))
      const canvas = renderDocument(doc)
      const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
      preview.width = canvas.width
      preview.height = canvas.height
      preview
        .getContext('2d')!
        .putImageData(new ImageData(monoPreview(img), img.width, img.height), 0, 0)
      current = canvas
      errorEl.textContent = ''
    } catch (err) {
      current = null
      errorEl.textContent = message(err)
    }
    updateButtons()
  }

  function setMode(next: Mode): void {
    mode = next
    formHost.replaceChildren(forms[next].element)
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === next)
    })
    refresh()
  }

  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.mode as Mode))
  })
  forms.receipt.onChange(refresh)
  forms.label.onChange(refresh)
  printer.onDisconnected(() => {
    log('Printer disconnected')
    updateButtons()
  })

  const onBusy = () => log('Busy: wait for the current operation to finish')

  const toggleConnection = exclusive(async () => {
    if (printer.connected) {
      printer.disconnect()
      log('Disconnected')
      updateButtons()
      return
    }
    busy = true
    updateButtons()
    try {
      await printer.connect()
      log('Connected')
    } catch (err) {
      log(`Connect failed: ${message(err)}`)
    } finally {
      busy = false
      updateButtons()
    }
  }, onBusy)
  connectBtn.addEventListener('click', () => void toggleConnection())

  const doPrint = exclusive(async () => {
    if (!current) return
    const canvas = current
    const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
    abort = new AbortController()
    busy = true
    progress.value = 0
    updateButtons()
    try {
      const outcome = await printImage(printer, img, {
        confirmWarnings: async (warnings) =>
          window.confirm(`${warnings.join('\n')}\n\nPrint anyway?`),
        onProgress: (sent, total) => {
          progress.max = total
          progress.value = sent
        },
        signal: abort.signal,
      })
      log(outcome === 'printed' ? 'Printed' : 'Cancelled before printing')
    } catch (err) {
      if (err instanceof PrintInterruptedError) {
        log(`Print ${err.reason} after ${err.bytesSent} of ${err.totalBytes} bytes; cause: ${String(err.cause)}`)
      } else {
        log(`Print failed: ${message(err)}`)
      }
    } finally {
      abort = null
      busy = false
      updateButtons()
    }
  }, onBusy)
  printBtn.addEventListener('click', () => void doPrint())
  cancelBtn.addEventListener('click', () => {
    abort?.abort()
    log('Cancelling after the current band')
  })

  setMode('receipt')
}
