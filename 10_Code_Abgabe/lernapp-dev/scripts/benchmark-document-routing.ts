// Offline only. No env or network permission required; never imports a model adapter.
import { extractDocument } from '../supabase/functions/_shared/document-extraction.ts';
import { chunkDocument } from '../supabase/functions/_shared/document-chunks.ts';
const root = Deno.args[0] ?? '/Users/adrian/Desktop/Benchmark';
const files = ['Benchmark_Lernskript_Energiesysteme.pdf', 'Neue Konzepte 2026 - VL1.pdf'];
const sha = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
  )
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
const documents = [];
for (const file of files) {
  const bytes = await Deno.readFile(`${root}/${file}`);
  const before = await extractDocument(bytes, 'application/pdf', true, 'legacy');
  const after = await extractDocument(bytes, 'application/pdf', true, 'pipeline-v2');
  for (const [page, route] of (file === files[0]
    ? [
        [6, 'visual'],
        [8, 'visual'],
        [11, 'visual'],
      ]
    : [
        [32, 'visual'],
        [46, 'visual'],
        [50, 'visual'],
        [57, 'local'],
        [62, 'local'],
      ]) as [number, string][]) {
    if (after.pages?.[page - 1].route !== route)
      throw new Error(`${file} page ${page}: router regression`);
  }
  const nativeChunks = chunkDocument(after.text, after.pages);
  documents.push({
    file,
    sha256: await sha(bytes),
    bytes: bytes.length,
    pages: after.pages!.length,
    before_visual: before.pages!.filter((p) => p.route === 'visual').length,
    after_visual: after.pages!.filter((p) => p.route === 'visual').length,
    native_chunks: nativeChunks.length,
    native_chunks_under_200: nativeChunks.filter((c) => c.content.length < 200).length,
    routing: after.pages!.map((p) => ({ page: p.page, route: p.route, reasons: p.reasons })),
  });
}
const references = [];
for (const path of [
  'unpdf/Benchmark-Energie/extract.md',
  'unpdf/Neue_Konzepte/extract.md',
  'Gemini-OCR/Benchmark-Energie/Extract.md',
  'Doclin-OCR/Benchmark-Energie/extract.md',
  'Doclin-OCR/Neue Konzepte/extract.md',
  'Gemini-OCR/timing.md',
]) {
  const bytes = await Deno.readFile(`${root}/${path}`);
  references.push({
    path,
    sha256: await sha(bytes),
    bytes: bytes.length,
    characters: new TextDecoder().decode(bytes).length,
  });
}
console.log(
  JSON.stringify(
    {
      kind: 'offline-router-regression',
      baseline_commit: 'e6efcea2806dea293f37f2f8a94dc75c19a837d5',
      documents,
      references,
      note: 'No new model calls. Selection counts are not quality or latency measurements. Prior Markdown exports lack structured checkpoints; production chunk counts cannot be reconstructed reliably.',
    },
    null,
    2,
  ),
);
