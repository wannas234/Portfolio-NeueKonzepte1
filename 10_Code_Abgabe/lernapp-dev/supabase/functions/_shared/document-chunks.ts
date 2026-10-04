import type { DocumentPage } from './document-structure.ts';

export interface Chunk {
  chunk_index: number;
  content: string;
  page_number: number | null;
  metadata: {
    start: number;
    end: number;
    chunker: string;
    block_id?: string;
    block_kind?: string;
    block_ids?: string[];
  };
}

/** Preserve canonical source offsets; table rows already include their headers. */
export function chunkDocument(text: string, pages: DocumentPage[] | null): Chunk[] {
  if (!pages?.some((p) => p.blocks)) return chunkPlainDocument(text, pages);
  const chunks: Chunk[] = [];
  for (const page of pages) {
    if (!page.blocks) {
      chunks.push(...chunkPlainDocument(page.text, [page]));
      continue;
    }
    let previousEnd = 0;
    for (const block of page.blocks) {
      if (
        !Number.isInteger(block.start) ||
        !Number.isInteger(block.end) ||
        block.start < previousEnd ||
        block.end <= block.start ||
        block.end > page.text.length ||
        page.text.slice(previousEnd, block.start).trim()
      )
        throw new Error('INVALID_INDEXING_INPUT');
      previousEnd = block.end;
      const ranges: [number, number][] = [];
      if (block.kind === 'table') {
        if (!block.row_ends?.length || block.row_ends.at(-1) !== block.end)
          throw new Error('INVALID_INDEXING_INPUT');
        let start = block.start;
        let end = start;
        for (const rowEnd of block.row_ends) {
          if (!Number.isInteger(rowEnd) || rowEnd <= end || rowEnd > block.end)
            throw new Error('INVALID_INDEXING_INPUT');
          if (rowEnd - start > 1800) {
            if (end === start) throw new Error('INVALID_INDEXING_INPUT');
            ranges.push([start, end]);
            start = end + 1;
          }
          if (rowEnd - start > 1800) throw new Error('INVALID_INDEXING_INPUT');
          end = rowEnd;
        }
        ranges.push([start, end]);
      } else if (block.kind === 'formula') {
        // Never silently cut an oversized formula; leave an actionable index error.
        if (block.end - block.start > 1800) throw new Error('INVALID_INDEXING_INPUT');
        ranges.push([block.start, block.end]);
      } else {
        for (const c of chunkPlainDocument(page.text.slice(block.start, block.end), null))
          ranges.push([block.start + c.metadata.start, block.start + c.metadata.end]);
      }
      for (const [start, end] of ranges)
        chunks.push({
          chunk_index: 0,
          page_number: page.page,
          content: page.text.slice(start, end),
          metadata: {
            start,
            end,
            chunker: 'blocks-v1',
            block_id: block.id,
            block_kind: block.kind,
          },
        });
    }
    if (page.text.slice(previousEnd).trim()) throw new Error('INVALID_INDEXING_INPUT');
  }
  if (chunks.length > 10000) throw new Error('INVALID_INDEXING_INPUT');
  const merged: Chunk[] = [];
  for (const chunk of chunks) {
    const previous = merged.at(-1);
    const page = pages.find((p) => p.page === chunk.page_number);
    const canMerge =
      page?.extraction?.configuration?.revision === 'pipeline-v2' &&
      previous &&
      previous.page_number === chunk.page_number &&
      ['text', 'heading', 'list'].includes(previous.metadata.block_kind ?? '') &&
      ['text', 'heading', 'list'].includes(chunk.metadata.block_kind ?? '') &&
      chunk.metadata.start >= previous.metadata.end &&
      !page.text.slice(previous.metadata.end, chunk.metadata.start).trim() &&
      chunk.metadata.end - previous.metadata.start <= 1800;
    if (canMerge) {
      previous.metadata.block_ids ??= [previous.metadata.block_id!];
      previous.metadata.block_ids.push(chunk.metadata.block_id!);
      previous.metadata.end = chunk.metadata.end;
      previous.metadata.chunker = 'blocks-v2';
      previous.content = page.text.slice(previous.metadata.start, previous.metadata.end);
      delete previous.metadata.block_id;
    } else merged.push(chunk);
  }
  return merged.map((c, chunk_index) => ({ ...c, chunk_index }));
}

// UTF-16 offsets within the original page (TXT: full text). At most 1800
// code units / 5400 UTF-8 bytes, safely below the embedding token limit.
function chunkPlainDocument(text: string, pages: { page: number; text: string }[] | null): Chunk[] {
  const chunks: Chunk[] = [];
  for (const page of pages ?? [{ page: null, text }]) {
    const source = page.text;
    let start = 0;
    while (start < source.length) {
      while (start < source.length && /\s/.test(source[start])) start++;
      if (start === source.length) break;
      let end = Math.min(start + 1800, source.length);
      if (end < source.length) {
        const window = source.slice(start, end);
        // Prefer paragraphs, then sentence endings, then whitespace.
        for (const boundary of [/\n\s*\n/g, /[.!?。！？]\s+/g, /\s+/g]) {
          const matches = [...window.matchAll(boundary)];
          const last = matches.at(-1);
          const split = last ? last.index! + last[0].length : 0;
          if (split >= 900) {
            end = start + split;
            break;
          }
        }
        if (/^[\uDC00-\uDFFF]$/.test(source[end])) end--;
      }
      const content = source.slice(start, end).trimEnd();
      chunks.push({
        chunk_index: chunks.length,
        content,
        page_number: page.page,
        metadata: { start, end: start + content.length, chunker: 'characters-v1' },
      });
      if (chunks.length > 10000) throw new Error('INVALID_INDEXING_INPUT');
      if (end === source.length) break;
      let next = end - 200;
      // Move overlap to a word boundary when possible; always make progress.
      const space = source.slice(next, end).search(/\s/);
      if (space >= 0) next += space + 1;
      if (/^[\uDC00-\uDFFF]$/.test(source[next])) next++;
      start = Math.max(start + 1, next);
    }
  }
  return chunks;
}
