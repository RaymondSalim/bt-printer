import type { TextItem } from './labelText'

interface TextChunk {
  items: unknown[]
}

interface ChunkReader {
  read(): Promise<{ done: boolean; value?: TextChunk }>
}

// Reads the stream through getReader() rather than for-await: pdf.js's own getTextContent
// iterates the stream asynchronously, which Safari versions without async-iterable
// streams cannot run.
export async function collectTextItems(stream: {
  getReader(): ChunkReader
}): Promise<TextItem[]> {
  const reader = stream.getReader()
  const items: TextItem[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done || !value) break
    for (const item of value.items) {
      if (typeof item === 'object' && item !== null && 'str' in item) items.push(item as TextItem)
    }
  }
  return items
}
