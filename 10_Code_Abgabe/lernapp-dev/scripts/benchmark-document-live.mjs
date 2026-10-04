// Preparation is offline. --run additionally requires an explicit paid-call guard.
// Never run as part of test:tools; document transfers occur only in run().
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const profiles = JSON.parse(
  await readFile(new URL('../benchmarks/document-pipeline/profiles.json', import.meta.url), 'utf8'),
);
const profile = process.argv[2] ?? 'A';
if (!Object.hasOwn(profiles, profile)) throw new Error('Choose A, B, C, D or M');
const settings = profiles[profile];
const files = ['Benchmark_Lernskript_Energiesysteme.pdf', 'Neue Konzepte 2026 - VL1.pdf'];
const manifest = {
  profile,
  settings,
  model: 'gemini-3.6-flash',
  max_output_tokens: 16384,
  embedding_model: 'gemini-embedding-2',
  embedding_dimensions: 1536,
  documents: files,
  original_pages: 79,
  repetitions: 1,
  paid_calls_authorized: false,
};
if (!process.argv.includes('--run')) {
  console.log(JSON.stringify(manifest, null, 2));
  console.log('\n# Append to a PRIVATE benchmark-only functions env file (no keys below):');
  for (const [key, value] of Object.entries(settings))
    if (key !== 'dispatch_seconds') console.log(`${key}=${value}`);
  console.log(
    'GEMINI_DOCUMENT_MODEL=gemini-3.6-flash\nDOCUMENT_MAX_OUTPUT_TOKENS=16384\nDOCUMENT_WORKER_BUDGET_MS=75000',
  );
  console.log(
    `\n-- Isolated benchmark DB only; keep minute recovery schedules enabled:\nupdate cron.job set active=${profile === 'A' ? 'false' : 'true'} where jobname='learning-documents-dispatch';`,
  );
} else {
  if (!process.argv.includes('--approve-paid-model-calls'))
    throw new Error('Live execution requires --approve-paid-model-calls after user authorization');
  await run();
}
async function run() {
  const url = new URL(process.env.BENCHMARK_SUPABASE_URL ?? 'http://127.0.0.1:54321');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('Only an isolated local Supabase is permitted');
  const token = process.env.BENCHMARK_USER_TOKEN,
    key = process.env.BENCHMARK_ANON_KEY,
    admin = process.env.BENCHMARK_SERVICE_KEY,
    course = process.env.BENCHMARK_COURSE_ID;
  if (process.env.BENCHMARK_ISOLATED !== '1')
    throw new Error('Set BENCHMARK_ISOLATED=1 only for a dedicated benchmark instance');
  if (!token || !key || !admin || !course)
    throw new Error(
      'Set BENCHMARK_USER_TOKEN, BENCHMARK_ANON_KEY, BENCHMARK_SERVICE_KEY and BENCHMARK_COURSE_ID',
    );
  const root = process.env.BENCHMARK_ROOT ?? '/Users/adrian/Desktop/Benchmark';
  const output = resolve(process.env.BENCHMARK_OUTPUT ?? `tmp/benchmark-${profile}-${Date.now()}`);
  await mkdir(output, { recursive: true });
  const request = async (
    path,
    method = 'GET',
    body,
    privileged = false,
    mime = 'application/json',
  ) => {
    const response = await fetch(new URL(path, url), {
      method,
      redirect: 'error',
      headers: {
        apikey: key,
        Authorization: `Bearer ${privileged ? admin : token}`,
        'content-type': mime,
      },
      body:
        body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok)
      throw new Error(`Local benchmark HTTP ${response.status}: ${path.split('?')[0]}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const resume = process.argv.includes('--resume');
  const records = resume ? JSON.parse(await readFile(`${output}/documents.json`, 'utf8')) : [];
  if (!resume) {
    for (const queue of ['document_processing_jobs', 'document_indexing_jobs'])
      if (
        (await request(`/rest/v1/${queue}?select=document_id&limit=1`, 'GET', undefined, true))
          .length
      )
        throw new Error('Benchmark instance has existing jobs; refusing mixed workload');
  }
  if (!resume)
    await writeFile(
      `${output}/manifest.json`,
      JSON.stringify(
        { ...manifest, paid_calls_authorized: true, started_at: new Date().toISOString() },
        null,
        2,
      ),
    );
  else if (JSON.parse(await readFile(`${output}/manifest.json`, 'utf8')).profile !== profile)
    throw new Error('Resume requires the original profile');
  const reference = JSON.parse(
    await readFile(
      new URL('../benchmarks/document-pipeline/offline-results.json', import.meta.url),
      'utf8',
    ),
  );
  for (const filename of files) {
    const bytes = await readFile(resolve(root, filename));
    if (
      createHash('sha256').update(bytes).digest('hex') !==
      reference.documents.find((d) => d.file === filename)?.sha256
    )
      throw new Error('PDF differs from approved offline manifest');
  }
  // Upload both documents together to include cross-document contention in every profile.
  for (const filename of resume ? [] : files) {
    const bytes = await readFile(resolve(root, filename)),
      started = Date.now();
    const { file } = await request('/functions/v1/files', 'POST', {
      action: 'prepare',
      course_id: course,
      upload_key: randomUUID(),
      filename: basename(filename),
      mime_type: 'application/pdf',
      size_bytes: bytes.length,
    });
    await request(
      `/storage/v1/object/learning-files/${file.storage_path}`,
      'POST',
      bytes,
      false,
      'application/pdf',
    );
    const { source_document } = await request('/functions/v1/files', 'POST', {
      action: 'complete',
      file_id: file.id,
    });
    records.push({
      filename,
      id: source_document.id,
      file_id: file.id,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      started,
    });
    await writeFile(`${output}/documents.json`, JSON.stringify(records, null, 2));
  }
  const deadline = Date.now() + 90 * 60 * 1000;
  while (records.some((r) => !r.done) && Date.now() < deadline) {
    for (const r of records.filter((r) => !r.done)) {
      const [d] = await request(
        `/rest/v1/source_documents?id=eq.${r.id}&select=id,processing_status,indexing_status,error_code,indexing_error,page_count`,
      );
      if (d.processing_status === 'failed' || d.indexing_status === 'failed')
        throw new Error(`Document ${r.id} failed: ${d.error_code ?? d.indexing_error}`);
      if (d.indexing_status === 'ready') {
        r.done = true;
        r.observed_total_ms = Date.now() - r.started;
        for (const [name, path] of Object.entries({
          document: `source_documents?id=eq.${r.id}`,
          metrics: `document_worker_metrics?document_id=eq.${r.id}`,
          events: `document_worker_events?document_id=eq.${r.id}&order=occurred_at`,
          chunks: `document_chunks?document_id=eq.${r.id}&select=chunk_index,page_number,content,metadata&order=chunk_index`,
        })) {
          const data = await request(`/rest/v1/${path}`, 'GET', undefined, true);
          await writeFile(`${output}/${r.id}-${name}.json`, JSON.stringify(data, null, 2));
          if (name === 'events') {
            const config = data.find((e) => e.event === 'routing')?.detail.configuration;
            if (
              !config ||
              config.revision !== settings.DOCUMENT_PIPELINE_REVISION ||
              config.thinking !== settings.DOCUMENT_THINKING_LEVEL ||
              config.mediaResolution !== settings.DOCUMENT_MEDIA_RESOLUTION
            )
              throw new Error('Worker profile does not match manifest; reject comparison');
          }
        }
        console.log(`${profile}: ${r.filename} indexed; exported ${r.id}`);
      }
    }
    if (records.some((r) => !r.done)) await new Promise((r) => setTimeout(r, 2000));
  }
  await writeFile(`${output}/documents.json`, JSON.stringify(records, null, 2));
  if (records.some((r) => !r.done))
    throw new Error(
      'Bounded 90-minute benchmark deadline reached; jobs remain durable. Inspect before any retry.',
    );
  console.log(
    `Review all quality-checklist.json cases against ${output}. No automatic quality claim.`,
  );
}
