export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface GrayImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export const SLOT_GAP_PT = 6

// Landscape pages carry two labels side by side with a cut line at the centre;
// any other page carries one.
export function splitSlots(pageWidth: number, pageHeight: number): Rect[] {
  if (pageWidth >= pageHeight * 1.2) {
    const half = pageWidth / 2
    const width = half - SLOT_GAP_PT
    return [
      { x: 0, y: 0, width, height: pageHeight },
      { x: half + SLOT_GAP_PT, y: 0, width, height: pageHeight },
    ]
  }
  return [{ x: 0, y: 0, width: pageWidth, height: pageHeight }]
}

export function contentBounds(img: GrayImage, threshold = 200): Rect | null {
  let minX = img.width
  let minY = img.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[y * img.width + x] < threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

export function dotsPerPoint(widthPt: number, targetDots: number): number {
  if (!(widthPt > 0)) throw new RangeError(`widthPt must be positive, got ${widthPt}`)
  return targetDots / widthPt
}
