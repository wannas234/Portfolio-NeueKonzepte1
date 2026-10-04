import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractDocument } from './document-extraction.ts';
import { chunkDocument } from './document-chunks.ts';
import {
  createVisualExtractor,
  normalizeVisualResult,
  singlePagePdf,
  visualConfiguration,
  resumeVisualConfiguration,
  visualFailureMetrics,
} from './visual-extraction.ts';
import type { DocumentPage } from './document-structure.ts';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}
export async function mixedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('LOCAL TEXT ONLY', { font, x: 40, y: 700, size: 12 });
  const chart = pdf.addPage();
  chart.drawText('DIAGRAM PAGE', { font, x: 40, y: 700, size: 12 });
  for (let i = 0; i < 3; i++)
    chart.drawLine({ start: { x: 40, y: 100 + i * 15 }, end: { x: 200, y: 200 + i * 15 } });
  const table = pdf.addPage();
  for (const [text, x, y] of [
    ['Year', 40, 700],
    ['Value', 200, 700],
    ['2026', 40, 680],
    ['42', 200, 680],
  ] as const)
    table.drawText(text, { font, x, y, size: 12 });
  pdf.addPage();
  const scan = pdf.addPage();
  const image = await pdf.embedPng(
    Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=',
      ),
      (c) => c.charCodeAt(0),
    ),
  );
  scan.drawImage(image, { x: 0, y: 0, width: 500, height: 700 });
  const formula = pdf.addPage();
  formula.drawText('E = mc^2', { font, x: 40, y: 700, size: 12 });
  return await pdf.save();
}
const original: DocumentPage = {
  page: 2,
  text: 'native comparison',
  route: 'visual',
  reasons: ['table_candidate'],
};
export function visualResponse() {
  return {
    complete: true,
    warnings: [],
    blocks: [
      { kind: 'heading', content: 'Messwerte', row_count: 0, column_count: 0, cells: [] },
      {
        kind: 'table',
        content: 'Temperatur in °C',
        row_count: 41,
        column_count: 2,
        cells: Array.from({ length: 82 }, (_, i) => ({
          row: Math.floor(i / 2),
          column: i % 2,
          row_span: 1,
          column_span: 1,
          header: i < 2,
          text: i === 0 ? 'Jahr' : i === 1 ? 'Temperatur' : String(i),
        })),
      },
      { kind: 'formula', content: 'E = mc^2', row_count: 0, column_count: 0, cells: [] },
      {
        kind: 'figure',
        content:
          'Abgelesen: y-Achse in °C. Interpretation: ansteigender Verlauf. Keine exakten Kurvenwerte ablesbar.',
        row_count: 0,
        column_count: 0,
        cells: [],
      },
    ],
  };
}
Deno.test(
  'PDF routing distinguishes prose/blank pages from vectors, borderless tables, scans and formulas',
  async () => {
    const result = await extractDocument(await mixedPdf(), 'application/pdf', true);
    assert(result.pages);
    assert(
      JSON.stringify(result.pages.map((p) => p.route)) ===
        JSON.stringify(['local', 'visual', 'visual', 'local', 'visual', 'visual']),
      JSON.stringify(result.pages),
    );
    const selected = await singlePagePdf(await mixedPdf(), 2);
    const read = await extractDocument(selected, 'application/pdf');
    assert(read.pages?.length === 1 && read.text === 'DIAGRAM PAGE', 'Unselected pages leaked');
  },
);
Deno.test(
  'Structured tables and formulas survive chunking with exact offsets and header context',
  () => {
    const page = normalizeVisualResult(visualResponse(), original);
    const chunks = chunkDocument('', [page]);
    assert(chunks.filter((c) => c.metadata.block_kind === 'table').length >= 1);
    for (const c of chunks) {
      assert(c.content.length <= 1800);
      assert(c.content === page.text.slice(c.metadata.start, c.metadata.end));
      assert(c.page_number === 2);
      if (c.metadata.block_kind === 'table') {
        assert(c.content.includes('Jahr:') && c.content.includes('Temperatur:'));
        assert(!c.content.endsWith('\n'));
        assert(!c.content.includes('Tabelle 2'), 'Internal id presented as source label');
      }
    }
    assert(chunks.some((c) => c.metadata.block_kind === 'formula' && c.content === 'E = mc^2'));
    assert(page.blocks?.[1].cells?.length === 82);
    assert(page.text.split('Temperatur in °C').length === 2, 'Repeated table context');
    assert(page.native_text === original.text);
  },
);
Deno.test('Provider-reported incomplete pages keep readable blocks, empty ones fail', () => {
  const partial = visualResponse();
  partial.complete = false;
  partial.warnings = ['Overlay covers part of the table'] as never[];
  const page = normalizeVisualResult(partial, original);
  assert(page.text.includes('Messwerte') && page.text.includes('Temperatur in °C'));
  for (const result of [
    { complete: false, warnings: [], blocks: [] },
    { ...visualResponse(), complete: undefined },
  ]) {
    let threw = false;
    try {
      normalizeVisualResult(result, original);
    } catch {
      threw = true;
    }
    assert(threw, 'Empty or unflagged extraction accepted');
  }
});
Deno.test('Invalid, missing and overlapping cells fail closed', () => {
  for (const mutate of [
    (r: ReturnType<typeof visualResponse>) => {
      r.blocks[1].cells.pop();
    },
    (r: ReturnType<typeof visualResponse>) => {
      r.blocks[1].cells[2].row = 0;
    },
    (r: ReturnType<typeof visualResponse>) => {
      r.blocks[1].cells[2].row_span = 500;
    },
  ]) {
    const result = visualResponse();
    mutate(result);
    let threw = false;
    try {
      normalizeVisualResult(result, original);
    } catch {
      threw = true;
    }
    assert(threw, 'Invalid extraction accepted');
  }
  const page = normalizeVisualResult(
    {
      complete: true,
      warnings: [],
      blocks: [
        { kind: 'formula', content: 'x'.repeat(1801), row_count: 0, column_count: 0, cells: [] },
      ],
    },
    original,
  );
  let threw = false;
  try {
    chunkDocument('', [page]);
  } catch {
    threw = true;
  }
  assert(threw, 'Oversized formula was silently cut');
});
Deno.test(
  'Gemini adapter sends only selected PDF, requires complete JSON and records separate thinking usage',
  async () => {
    const fetch = globalThis.fetch;
    const bytes = await mixedPdf();
    try {
      let finishReason = 'STOP';
      let complete = true;
      globalThis.fetch = async (url, init) => {
        assert(String(url).includes('/gemini-3.6-flash:generateContent'));
        const body = JSON.parse(String(init?.body));
        const data = body.contents[0].parts[0].inlineData;
        assert(data.mimeType === 'application/pdf');
        const sent = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0));
        const read = await extractDocument(sent, 'application/pdf');
        assert(read.pages?.length === 1 && read.text === 'DIAGRAM PAGE');
        assert(
          body.generationConfig.thinkingConfig.thinkingLevel === 'LOW' &&
            body.generationConfig.mediaResolution === 'MEDIA_RESOLUTION_MEDIUM' &&
            body.generationConfig.responseJsonSchema &&
            body.generationConfig.maxOutputTokens === 16384,
        );
        return Response.json({
          candidates: [
            {
              finishReason,
              content: { parts: [{ text: JSON.stringify({ ...visualResponse(), complete }) }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 200,
            thoughtsTokenCount: 50,
          },
        });
      };
      const adapter = createVisualExtractor({
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        key: 'fake',
        maxOutputTokens: 16384,
        thinking: 'LOW',
        mediaResolution: 'MEDIUM',
        revision: 'pipeline-v2',
      });
      const page = await adapter.extract(bytes, original);
      assert(page.extraction?.usage.output === 200 && page.extraction.usage.thinking === 50);
      assert(page.extraction.incomplete === undefined);
      complete = false;
      const partial = await adapter.extract(bytes, original);
      assert(partial.extraction?.incomplete === true && partial.text.includes('Messwerte'));
      complete = true;
      for (const reason of ['MAX_TOKENS', 'SAFETY']) {
        finishReason = reason;
        let threw = false;
        try {
          await adapter.extract(bytes, original);
        } catch (error) {
          threw = true;
          assert(
            (visualFailureMetrics(error).usage as { thinking: number }).thinking === 50,
            'Failure usage missing',
          );
        }
        assert(threw, 'Incomplete output accepted');
      }
    } finally {
      globalThis.fetch = fetch;
    }
  },
);
Deno.test(
  'Visual configuration is independent of chat and rejects unimplemented Mistral adapter',
  () => {
    const names = [
      'GEMINI_API_KEY',
      'DOCUMENT_EXTRACTION_PROVIDER',
      'GEMINI_DOCUMENT_MODEL',
      'DOCUMENT_MAX_OUTPUT_TOKENS',
    ];
    const previous = names.map((n) => Deno.env.get(n));
    try {
      names.forEach((n) => Deno.env.delete(n));
      Deno.env.set('GEMINI_API_KEY', 'fake');
      assert(visualConfiguration().model === 'gemini-3.6-flash');
      Deno.env.set('DOCUMENT_EXTRACTION_PROVIDER', 'mistral');
      let threw = false;
      try {
        visualConfiguration();
      } catch {
        threw = true;
      }
      assert(threw);
    } finally {
      names.forEach((n, i) =>
        previous[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, previous[i]!),
      );
    }
  },
);

Deno.test(
  'Checkpoint pins configuration, keeps legacy defaults and rejects unknown revisions',
  () => {
    const old = resumeVisualConfiguration('rotated', { model: 'gemini-3.6-flash' });
    assert(
      old.thinking === 'DEFAULT' && old.revision === 'legacy' && old.maxOutputTokens === 16384,
    );
    const pinned = resumeVisualConfiguration('new-key', {
      model: 'gemini-3.6-flash',
      configuration: {
        ...old,
        key: undefined,
        thinking: 'HIGH',
        mediaResolution: 'HIGH',
        revision: 'pipeline-v2',
        maxOutputTokens: 24576,
      } as Omit<typeof old, 'key'>,
    });
    assert(
      pinned.key === 'new-key' && pinned.thinking === 'HIGH' && pinned.maxOutputTokens === 24576,
    );
    let threw = false;
    try {
      resumeVisualConfiguration('key', {
        model: 'gemini-3.6-flash',
        configuration: { ...old, revision: 'future' } as unknown as Omit<typeof old, 'key'>,
      });
    } catch {
      threw = true;
    }
    assert(threw, 'Unknown configuration version resumed');
  },
);

Deno.test(
  'Table hierarchy, units, spans, source label and separate footnote survive serialization',
  () => {
    const cell = (
      row: number,
      column: number,
      text: string,
      header = false,
      row_span = 1,
      column_span = 1,
    ) => ({ row, column, text, header, row_span, column_span });
    const page = normalizeVisualResult(
      {
        complete: true,
        warnings: [],
        blocks: [
          {
            kind: 'table',
            content: 'Tabelle 7: Anlagenleistungen',
            row_count: 4,
            column_count: 3,
            cells: [
              cell(0, 0, 'Jahr', true, 2),
              cell(0, 1, 'Leistung (MW)', true, 1, 2),
              cell(1, 1, 'Wind', true),
              cell(1, 2, 'PV', true),
              cell(2, 0, '2025'),
              cell(2, 1, '4,2', false, 2),
              cell(2, 2, '1,0'),
              cell(3, 0, '2026'),
              cell(3, 2, '2,0'),
            ],
          },
          { kind: 'text', content: '* vorläufig', row_count: 0, column_count: 0, cells: [] },
        ],
      },
      original,
    );
    assert(page.text.split('Tabelle 7: Anlagenleistungen').length === 2);
    assert(page.text.includes('Leistung (MW) / Wind: "4,2"'));
    assert(page.blocks?.[0].cells?.[5].row_span === 2 && page.blocks[0].cells[1].column_span === 2);
    assert(
      page.blocks?.[1].kind === 'text' &&
        page.text.slice(page.blocks[1].start, page.blocks[1].end) === '* vorläufig',
    );
    for (const c of chunkDocument('', [page]))
      assert(c.content === page.text.slice(c.metadata.start, c.metadata.end));
  },
);
