import { deflateSync } from 'node:zlib';
import { extractDocument, ExtractionError, MAX_DOCUMENT_BYTES } from './document-extraction.ts';
import { pdfFixture } from './testing/pdf.ts';

Deno.test('PDF preserves original page numbers, text and blank pages', async () => {
  const result = await extractDocument(
    pdfFixture(['First page', '', 'Third page']),
    'application/pdf',
  );
  if (
    JSON.stringify(result.pages) !==
    JSON.stringify([
      { page: 1, text: 'First page' },
      { page: 2, text: '' },
      { page: 3, text: 'Third page' },
    ])
  )
    throw new Error(JSON.stringify(result));
  if (result.text !== 'First page\n\n\n\nThird page') throw new Error('Wrong merged text');
});
Deno.test('Blank PDF and UTF-8 text retain honest results without fabricated pages', async () => {
  const blank = await extractDocument(pdfFixture(['']), 'application/pdf');
  if (blank.pages?.length !== 1 || blank.text !== '') throw new Error('Blank page lost');
  const result = await extractDocument(new TextEncoder().encode('Grüße\n世界'), 'text/plain');
  if (result.pages !== null || result.text !== 'Grüße\n世界') throw new Error('TXT changed');
});
Deno.test('Malformed, oversized and unsupported documents fail explicitly', async () => {
  for (const [bytes, mime, code] of [
    [new TextEncoder().encode('%PDF-1.7\ngarbage\n%%EOF'), 'application/pdf', 'INVALID_DOCUMENT'],
    [pdfFixture(Array(101).fill('page')), 'application/pdf', 'INVALID_DOCUMENT'],
    [new Uint8Array(MAX_DOCUMENT_BYTES + 1), 'text/plain', 'INVALID_DOCUMENT'],
    [new Uint8Array([255]), 'text/plain', 'INVALID_DOCUMENT'],
    [new Uint8Array([65, 0]), 'text/plain', 'INVALID_DOCUMENT'],
    [new Uint8Array([1]), 'application/zip', 'UNSUPPORTED_FORMAT'],
  ] as const) {
    try {
      await extractDocument(bytes, mime);
      throw new Error('Invalid input accepted');
    } catch (error) {
      if (!(error instanceof ExtractionError) || error.code !== code) throw error;
    }
  }
});

Deno.test('Compressed PDF content streams are extracted per page', async () => {
  const result = await extractDocument(
    pdfFixture(['Compressed first', 'Compressed second'], deflateSync),
    'application/pdf',
  );
  if (
    result.pages?.[0].text !== 'Compressed first' ||
    result.pages?.[1].text !== 'Compressed second'
  )
    throw new Error(JSON.stringify(result));
});
