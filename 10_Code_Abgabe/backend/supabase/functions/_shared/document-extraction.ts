import { getResolvedPDFJS } from 'unpdf';
import { validContent } from './file-validation.ts';
import { pageReasons, legacyPageReasons, pageGraphics } from './document-layout.ts';
import type { Extraction } from './document-structure.ts';
export type { Extraction } from './document-structure.ts';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_PAGES = 100;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
export class ExtractionError extends Error {
  constructor(public code: 'INVALID_DOCUMENT' | 'UNSUPPORTED_FORMAT') {
    super(code);
  }
}
export async function extractDocument(
  bytes: Uint8Array,
  mime: string,
  analyzeLayout = false,
  revision = 'pipeline-v2',
): Promise<Extraction> {
  if (!['application/pdf', 'text/plain'].includes(mime))
    throw new ExtractionError('UNSUPPORTED_FORMAT');
  if (bytes.length > MAX_DOCUMENT_BYTES || !validContent(bytes, mime))
    throw new ExtractionError('INVALID_DOCUMENT');
  if (mime === 'text/plain') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES)
      throw new ExtractionError('INVALID_DOCUMENT');
    return { text, pages: null };
  }
  const { getDocument, OPS } = await getResolvedPDFJS();
  const opNames = new Map(Object.entries(OPS).map(([name, code]) => [code, name]));
  const task = getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    useWasm: false,
    disableFontFace: true,
    stopAtErrors: true,
    verbosity: 0,
  });
  // Destroy the parser on timeout as well as success. Platform CPU/memory kills
  // are recovered by the durable lease, not by an in-process timer.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const pdf = await task.promise;
        if (pdf.numPages < 1 || pdf.numPages > MAX_DOCUMENT_PAGES)
          throw new ExtractionError('INVALID_DOCUMENT');
        const pages: NonNullable<Extraction['pages']> = [];
        let size = 0;
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          const text = content.items
            .filter((item) => 'str' in item)
            .map((item) => item.str + (item.hasEOL ? '\n' : ''))
            .join('')
            .replaceAll('\0', '')
            .trim();
          size += new TextEncoder().encode(text).length;
          if (size > MAX_TEXT_BYTES) throw new ExtractionError('INVALID_DOCUMENT');
          if (analyzeLayout) {
            let reasons: string[];
            try {
              const operators = await page.getOperatorList();
              const names = operators.fnArray.map((op) => opNames.get(op) ?? 'unknown');
              reasons = (revision === 'legacy' ? legacyPageReasons : pageReasons)(
                content.items.filter((item) => 'str' in item),
                names,
                await page.getStructTree(),
                pageGraphics(names, operators.argsArray, page.view),
              );
            } catch {
              reasons = ['layout_uncertain'];
            }
            pages.push({ page: n, text, route: reasons.length ? 'visual' : 'local', reasons });
          } else pages.push({ page: n, text });
          page.cleanup();
        }
        // Empty pages retain their original indices, including scans without OCR.
        return { text: pages.map((page) => page.text).join('\n\n'), pages };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ExtractionError('INVALID_DOCUMENT')), 45000);
      }),
    ]);
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError('INVALID_DOCUMENT');
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}
