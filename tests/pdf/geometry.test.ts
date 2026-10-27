import { describe, expect, it } from 'vitest'
import {
  contentBounds,
  dotsPerPoint,
  isLabelSized,
  labelsShareCentre,
  splitSlots,
  type GrayImage,
} from '../../src/pdf/geometry'

function gray(width: number, height: number, paint: (x: number, y: number) => number): GrayImage {
  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = paint(x, y)
  return { width, height, data }
}

describe('splitSlots', () => {
  it('splits a landscape page into two slots either side of the cut line', () => {
    expect(splitSlots(842, 595)).toEqual([
      { x: 0, y: 0, width: 415, height: 595 },
      { x: 427, y: 0, width: 415, height: 595 },
    ])
  })

  it('keeps a portrait page as one slot', () => {
    expect(splitSlots(595, 842)).toEqual([{ x: 0, y: 0, width: 595, height: 842 }])
  })

  it('keeps a near-square page as one slot', () => {
    expect(splitSlots(600, 600)).toEqual([{ x: 0, y: 0, width: 600, height: 600 }])
  })
})

describe('contentBounds', () => {
  it('returns null for a blank image', () => {
    expect(contentBounds(gray(10, 6, () => 255))).toBeNull()
  })

  it('finds a single dark pixel', () => {
    const img = gray(10, 6, (x, y) => (x === 3 && y === 2 ? 0 : 255))
    expect(contentBounds(img)).toEqual({ x: 3, y: 2, width: 1, height: 1 })
  })

  it('wraps every dark pixel in one rectangle', () => {
    const img = gray(12, 8, (x, y) => ((x === 2 && y === 1) || (x === 5 && y === 3) ? 100 : 255))
    expect(contentBounds(img)).toEqual({ x: 2, y: 1, width: 4, height: 3 })
  })

  it('treats pixels at or above the threshold as background', () => {
    expect(contentBounds(gray(4, 4, () => 200))).toBeNull()
    expect(contentBounds(gray(4, 4, () => 199))).toEqual({ x: 0, y: 0, width: 4, height: 4 })
  })

  it('honors a custom threshold', () => {
    expect(contentBounds(gray(4, 4, () => 150), 100)).toBeNull()
  })
})

describe('dotsPerPoint', () => {
  it('divides the target width by the width in points', () => {
    expect(dotsPerPoint(276, 552)).toBe(2)
  })

  it('rejects a non-positive width', () => {
    expect(() => dotsPerPoint(0, 552)).toThrow(RangeError)
    expect(() => dotsPerPoint(-5, 552)).toThrow(RangeError)
  })
})

describe('isLabelSized', () => {
  it('rejects specks and thin lines and accepts a real label', () => {
    expect(isLabelSized({ x: 0, y: 0, width: 1, height: 1 })).toBe(false)
    expect(isLabelSized({ x: 0, y: 0, width: 300, height: 10 })).toBe(false)
    expect(isLabelSized({ x: 0, y: 0, width: 300, height: 400 })).toBe(true)
  })
})

describe('labelsShareCentre', () => {
  const slotWidth = 415

  it('is true when both labels run into the centre strip, so the page holds one wide label', () => {
    const left = { x: 20, y: 20, width: 395, height: 500 }
    const right = { x: 0, y: 20, width: 380, height: 500 }
    expect(labelsShareCentre(left, right, slotWidth)).toBe(true)
  })

  it('is false for two separate labels with margin before the centre', () => {
    const left = { x: 5, y: 10, width: 390, height: 500 }
    const right = { x: 12, y: 10, width: 390, height: 500 }
    expect(labelsShareCentre(left, right, slotWidth)).toBe(false)
  })

  it('is false when only one side touches the centre', () => {
    const left = { x: 20, y: 20, width: 395, height: 500 }
    const right = { x: 40, y: 20, width: 300, height: 500 }
    expect(labelsShareCentre(left, right, slotWidth)).toBe(false)
  })
})
