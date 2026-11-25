export interface TextChunk {
  /** 1-based page the chunk comes from. */
  page: number;
  /** 0-based position of the chunk within the document. */
  index: number;
  text: string;
}

export interface ChunkOptions {
  /** Target chunk length in characters. */
  size: number;
  /** Characters shared between consecutive chunks of the same page. */
  overlap: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { size: 1200, overlap: 200 };

/**
 * Splits each page into overlapping chunks so citations can point at a page.
 * Chunks never span pages. Breaks prefer whitespace near the target size so
 * words are not cut in half.
 */
export function chunkPages(
  pages: string[],
  { size, overlap }: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): TextChunk[] {
  if (size <= 0 || overlap < 0 || overlap >= size) {
    throw new Error('chunk size must be positive and larger than the overlap');
  }
  const chunks: TextChunk[] = [];
  pages.forEach((raw, pageIndex) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + size, text.length);
      if (end < text.length) {
        // Back off to the last space in the final 20% of the window, if any.
        const space = text.lastIndexOf(' ', end);
        if (space > start + size * 0.8) end = space;
      }
      const piece = text.slice(start, end).trim();
      if (piece)
        chunks.push({ page: pageIndex + 1, index: chunks.length, text: piece });
      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  });
  return chunks;
}
