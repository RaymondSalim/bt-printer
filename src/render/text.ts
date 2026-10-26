export const DEFAULT_FONT_SIZE = 24
export const LINE_HEIGHT_RATIO = 1.25
export const FONT_FAMILY = 'Arial, Helvetica, sans-serif'

export type Measure = (text: string, size: number, bold: boolean) => number

export function fontString(size: number, bold: boolean): string {
  return `${bold ? 'bold ' : ''}${size}px ${FONT_FAMILY}`
}

// Greedy word wrap. A word wider than the line is split by code point, and a
// single code point wider than the line still gets its own line, so the loop
// always makes progress.
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((w) => w !== '')
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`
      if (measure(candidate) <= maxWidth) {
        current = candidate
        continue
      }
      if (current !== '') {
        lines.push(current)
        current = ''
      }
      if (measure(word) <= maxWidth) {
        current = word
        continue
      }
      let chunk = ''
      for (const ch of Array.from(word)) {
        if (chunk !== '' && measure(chunk + ch) > maxWidth) {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk += ch
        }
      }
      current = chunk
    }
    lines.push(current)
  }
  return lines
}
