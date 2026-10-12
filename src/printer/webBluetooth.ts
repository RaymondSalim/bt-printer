import type { ByteSink } from './send'
import type { StatusIo } from './status'

export const PRINTER_NAME = 'RPP02N'
export const SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb'
export const WRITE_CHAR_UUID = '0000ff02-0000-1000-8000-00805f9b34fb'
export const NOTIFY_CHAR_UUID = '0000ff01-0000-1000-8000-00805f9b34fb'

export class WebBluetoothPrinter implements ByteSink, StatusIo {
  private device?: BluetoothDevice
  private writeChar?: BluetoothRemoteGATTCharacteristic
  private notifyChar?: BluetoothRemoteGATTCharacteristic
  private readonly listeners = new Set<(data: Uint8Array) => void>()

  get connected(): boolean {
    return this.device?.gatt?.connected === true
  }

  async connect(): Promise<void> {
    if (!('bluetooth' in navigator)) {
      throw new Error('Web Bluetooth is not available. Use Chrome or Edge over HTTPS or localhost.')
    }
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: PRINTER_NAME }],
      optionalServices: [SERVICE_UUID],
    })
    if (!device.gatt) throw new Error('The selected device has no GATT server')
    const server = await device.gatt.connect()
    const service = await server.getPrimaryService(SERVICE_UUID)
    this.writeChar = await service.getCharacteristic(WRITE_CHAR_UUID)
    this.notifyChar = await service.getCharacteristic(NOTIFY_CHAR_UUID)
    this.notifyChar.addEventListener('characteristicvaluechanged', this.handleNotify)
    await this.notifyChar.startNotifications()
    this.device = device
  }

  disconnect(): void {
    this.notifyChar?.removeEventListener('characteristicvaluechanged', this.handleNotify)
    this.device?.gatt?.disconnect()
    this.writeChar = undefined
    this.notifyChar = undefined
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writeChar || !this.connected) throw new Error('Printer is not connected')
    await this.writeChar.writeValueWithResponse(data.slice())
  }

  onNotify(cb: (data: Uint8Array) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private readonly handleNotify = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value
    if (!value) return
    const copy = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
    this.listeners.forEach((cb) => cb(copy))
  }
}
