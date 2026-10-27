import { prepareZXingModule } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

let ready: Promise<unknown> | null = null

// By default the decoder fetches its wasm file from a CDN; serve the bundled copy instead.
export function setupZXing(): Promise<unknown> {
  ready ??= Promise.resolve(
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
      },
      fireImmediately: true,
    }),
  )
  return ready
}
