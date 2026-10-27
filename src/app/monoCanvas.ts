import { monoPreview } from '../encode/raster'

// Draws `source` onto `target` as the black-and-white image the printer will receive.
export function drawMonoPreview(source: HTMLCanvasElement, target: HTMLCanvasElement): void {
  const img = source.getContext('2d')!.getImageData(0, 0, source.width, source.height)
  target.width = source.width
  target.height = source.height
  target.getContext('2d')!.putImageData(new ImageData(monoPreview(img), img.width, img.height), 0, 0)
}
