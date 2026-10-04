import { chunkDocument } from './document-chunks.ts';

Deno.test('Chunking preserves page order, empty-page gaps and exact source offsets', () => {
  const pages = [
    { page: 1, text: 'Erster Absatz.\n\n'.repeat(300) },
    { page: 2, text: '  \n ' },
    { page: 3, text: 'Letzte Seite.' },
  ];
  const chunks = chunkDocument('ignored for PDF', pages);
  if (chunks.length < 3 || chunks.at(-1)?.page_number !== 3) throw new Error('Lost pages');
  for (const [i, c] of chunks.entries()) {
    const page = pages[c.page_number! - 1];
    if (
      c.chunk_index !== i ||
      c.content.length > 1800 ||
      !c.content.trim() ||
      c.content !== page.text.slice(c.metadata.start, c.metadata.end)
    )
      throw new Error('Lost reference');
  }
  const firstPage = chunks.filter((c) => c.page_number === 1);
  for (let i = 1; i < firstPage.length; i++) {
    if (firstPage[i].metadata.start >= firstPage[i - 1].metadata.end)
      throw new Error('Missing overlap');
  }
});
Deno.test(
  'TXT, Unicode, long words and empty documents remain bounded without losing content',
  () => {
    for (const text of ['', ' \n\t', 'abc', '🙂界'.repeat(6000), 'x'.repeat(20000)]) {
      const chunks = chunkDocument(text, null);
      let end = 0;
      for (const c of chunks) {
        if (
          c.page_number !== null ||
          !c.content.isWellFormed() ||
          c.content.length > 1800 ||
          c.metadata.start > end
        )
          throw new Error('Broken text');
        end = c.metadata.end;
      }
      if (text.trim() && end !== text.length) throw new Error('Truncated document');
    }
  },
);

Deno.test(
  'Short adjacent blocks merge only within original pages and retain every block id and exact offsets',
  () => {
    const pages = [1, 3].map((page) => ({
      page,
      text: 'Heading\n\nFirst sentence.\n\nSecond sentence.\n\nx^2',
      extraction: {
        version: 'visual-blocks-v1',
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        configuration: { revision: 'pipeline-v2' },
        warnings: [],
        usage: { input: null, output: null, thinking: null },
      },
      blocks: [
        { id: 'a', kind: 'heading' as const, start: 0, end: 7 },
        { id: 'b', kind: 'text' as const, start: 9, end: 24 },
        { id: 'c', kind: 'text' as const, start: 26, end: 42 },
        { id: 'd', kind: 'formula' as const, start: 44, end: 47 },
      ],
    }));
    // Use mechanically derived offsets for fixture prose; assertions below compare source slices.
    for (const p of pages) {
      let start = 0;
      p.blocks.forEach((b, i) => {
        b.start = start;
        b.end = start + p.text.split('\n\n')[i].length;
        start = b.end + 2;
      });
    }
    const legacy = chunkDocument(
      '',
      pages.map((p) => ({
        ...p,
        extraction: { ...p.extraction, configuration: { revision: 'legacy' } },
      })),
    );
    const merged = chunkDocument('', pages);
    if (
      legacy.length !== 8 ||
      merged.length !== 4 ||
      merged.filter((c) => c.content.length < 30).length >=
        legacy.filter((c) => c.content.length < 30).length
    )
      throw new Error('Tiny chunks not reduced');
    for (const c of merged) {
      const p = pages.find((p) => p.page === c.page_number)!;
      if (c.content !== p.text.slice(c.metadata.start, c.metadata.end))
        throw new Error('Offsets changed');
      if (c.metadata.block_kind === 'heading' && c.metadata.block_ids?.join(',') !== 'a,b,c')
        throw new Error('Block provenance lost');
    }
  },
);
