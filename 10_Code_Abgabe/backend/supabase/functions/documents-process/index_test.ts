import { handler } from './index.ts';
import { pdfFixture } from '../_shared/testing/pdf.ts';
import { extractDocument } from '../_shared/document-extraction.ts';
import type { DocumentPage } from '../_shared/document-structure.ts';

Deno.test('Worker protects access and preserves leases on infrastructure failure', async (t) => {
  const names = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'WORKER_SERVICE_ROLE_KEY',
    'GEMINI_API_KEY',
    'DOCUMENT_EXTRACTION_PROVIDER',
    'GEMINI_DOCUMENT_MODEL',
    'DOCUMENT_MAX_OUTPUT_TOKENS',
  ];
  const previous = names.map((name) => Deno.env.get(name));
  const original = globalThis.fetch;
  Deno.env.set('WORKER_SERVICE_ROLE_KEY', 'scheduler-key');
  Deno.env.set('GEMINI_API_KEY', 'test-key');
  Deno.env.set('DOCUMENT_EXTRACTION_PROVIDER', 'gemini');
  Deno.env.set('GEMINI_DOCUMENT_MODEL', 'gemini-3.6-flash');
  Deno.env.set('DOCUMENT_MAX_OUTPUT_TOKENS', '16384');
  const owner = '11111111-1111-1111-1111-111111111111';
  const course = '22222222-2222-2222-2222-222222222222';
  const id = '33333333-3333-3333-3333-333333333333';
  Deno.env.set(names[0], 'http://supabase.test');
  Deno.env.set(names[2], 'service-key');
  try {
    const denied = await handler(new Request('http://local/worker', { method: 'POST' }));
    if (denied.status !== 401) throw new Error('Anonymous worker access');
    const method = await handler(
      new Request('http://local/worker', { headers: { Authorization: 'Bearer scheduler-key' } }),
    );
    if (method.status !== 405) throw new Error('GET worker access');
    for (const scenario of [
      'storage-failure',
      'database-failure',
      'oversized-stream',
      'stale-lease',
      'success',
    ]) {
      await t.step(scenario, async () => {
        let finishBody: Record<string, unknown> | undefined;
        globalThis.fetch = (input, init) => {
          const url = String(input);
          if (url.includes('/document_worker_events'))
            return Promise.resolve(new Response(null, { status: 201 }));
          if (url.includes('/document_processing_jobs'))
            return Promise.resolve(Response.json([{ document_id: id }]));
          if (url.includes('/rpc/claim_document_processing'))
            return Promise.resolve(
              Response.json({
                lease_token: id,
                file: {
                  id,
                  uploaded_by: owner,
                  course_id: course,
                  status: 'ready',
                  storage_bucket: 'learning-files',
                  storage_path: `${owner}/${course}/${id}.txt`,
                  mime_type: 'text/plain',
                  size_bytes: 5,
                },
              }),
            );
          if (url.includes('/storage/')) {
            if (scenario === 'storage-failure')
              return Promise.resolve(new Response(null, { status: 503 }));
            return Promise.resolve(
              new Response(scenario === 'oversized-stream' ? 'Too long' : 'Hallo', {
                headers: { 'content-type': 'text/plain' },
              }),
            );
          }
          if (url.includes('/rpc/finish_document_processing')) {
            finishBody = JSON.parse(String(init?.body));
            return Promise.resolve(
              scenario === 'database-failure'
                ? Response.json({ message: 'unavailable' }, { status: 503 })
                : Response.json(scenario !== 'stale-lease'),
            );
          }
          return Promise.reject(new Error(`Unexpected ${url}`));
        };
        const response = await handler(
          new Request('http://local/worker', {
            method: 'POST',
            headers: { Authorization: 'Bearer scheduler-key' },
          }),
        );
        const result = await response.json();
        if (scenario.endsWith('failure')) {
          if (response.status !== 503) throw new Error('Infrastructure failure hidden');
          if (scenario === 'storage-failure' && finishBody)
            throw new Error('Transient failure became permanent');
        } else if (scenario === 'oversized-stream') {
          if (finishBody?.p_error_code !== 'INVALID_DOCUMENT' || result.failed !== 1)
            throw new Error('Unbounded input accepted');
        } else if (scenario === 'stale-lease') {
          if (!result.discarded || result.completed !== 0)
            throw new Error('Stale output reported as stored');
        } else if (
          finishBody?.p_text !== 'Hallo' ||
          finishBody?.p_pages !== null ||
          result.completed !== 1
        ) {
          throw new Error('Text not persisted');
        }
      });
    }
  } finally {
    globalThis.fetch = original;
    names.forEach((name, i) =>
      previous[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[i]!),
    );
  }
});

Deno.test(
  'Visual worker checkpoints each selected page, resumes after provider and finish failures, and never sends local pages',
  async () => {
    const names = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'WORKER_SERVICE_ROLE_KEY',
      'GEMINI_API_KEY',
      'DOCUMENT_EXTRACTION_PROVIDER',
      'GEMINI_DOCUMENT_MODEL',
      'DOCUMENT_MAX_OUTPUT_TOKENS',
    ];
    const previous = names.map((n) => Deno.env.get(n));
    const fetch = globalThis.fetch;
    const owner = '11111111-1111-1111-1111-111111111111';
    const course = '22222222-2222-2222-2222-222222222222';
    const id = '33333333-3333-3333-3333-333333333333';
    const pdf = pdfFixture(['LOCAL', 'CHART', 'TABLE'], undefined, [
      '',
      '\n0 0 m 200 200 l S 0 10 m 200 210 l S 0 20 m 200 220 l S',
      '\n0 0 m 200 200 l S 0 10 m 200 210 l S 0 20 m 200 220 l S',
    ]);
    let checkpoint: { pages: DocumentPage[] } | null = null;
    let calls = 0;
    let finished = false;
    let providerFailure = true;
    let finishFailure = false;
    let published: { p_pages: DocumentPage[]; p_text: string } | undefined;
    const run = () =>
      handler(
        new Request('http://local/worker', {
          method: 'POST',
          headers: { Authorization: 'Bearer scheduler' },
        }),
      );
    try {
      names.forEach((n) => Deno.env.delete(n));
      Deno.env.set('SUPABASE_URL', 'http://supabase.test');
      Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service');
      Deno.env.set('WORKER_SERVICE_ROLE_KEY', 'scheduler');
      Deno.env.set('GEMINI_API_KEY', 'fake');
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('/document_worker_events')) return new Response(null, { status: 201 });
        if (url.includes('/acquire_document_provider_slot'))
          return Response.json(crypto.randomUUID());
        if (url.includes('/release_document_provider_slot') || url.includes('/yield_document_work'))
          return Response.json(true);
        if (url.includes('/save_document_processing_page')) {
          const page = JSON.parse(String(init?.body)).p_page;
          if (!checkpoint) throw new Error('No initial checkpoint');
          checkpoint.pages[page.page - 1] = page;
          return Response.json(true);
        }
        if (url.includes('/document_processing_jobs'))
          return Response.json(finished ? [] : [{ document_id: id }]);
        if (url.includes('/rpc/claim_document_processing'))
          return Response.json({
            lease_token: id,
            checkpoint,
            file: {
              id,
              uploaded_by: owner,
              course_id: course,
              status: 'ready',
              storage_bucket: 'learning-files',
              storage_path: `${owner}/${course}/${id}.pdf`,
              mime_type: 'application/pdf',
              size_bytes: pdf.length,
            },
          });
        if (url.includes('/storage/'))
          return new Response(pdf.slice().buffer, {
            headers: { 'content-type': 'application/pdf' },
          });
        if (url.includes('/save_document_processing_checkpoint')) {
          checkpoint = JSON.parse(String(init?.body)).p_checkpoint;
          return Response.json(true);
        }
        if (url.includes('generativelanguage.googleapis.com')) {
          calls++;
          const body = JSON.parse(String(init?.body));
          const selected = Uint8Array.from(atob(body.contents[0].parts[0].inlineData.data), (c) =>
            c.charCodeAt(0),
          );
          const read = await extractDocument(selected, 'application/pdf');
          if (providerFailure && read.text === 'TABLE')
            return new Response(null, { status: 429, headers: { 'retry-after': '120' } });
          if (read.pages?.length !== 1 || !['CHART', 'TABLE'].includes(read.text))
            throw new Error('Local pages sent');
          return Response.json({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        complete: true,
                        warnings: [],
                        blocks: [
                          {
                            kind: 'figure',
                            content: read.text,
                            row_count: 0,
                            column_count: 0,
                            cells: [],
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          });
        }
        if (url.includes('/finish_document_processing')) {
          if (finishFailure) return Response.json({ message: 'unavailable' }, { status: 503 });
          published = JSON.parse(String(init?.body));
          finished = true;
          return Response.json(true);
        }
        throw new Error(`Unexpected ${url}`);
      };
      let response = await run();
      if (response.status !== 503 || calls !== 2 || finished)
        throw new Error('Partial failure must retain successful concurrent page and not publish');
      providerFailure = false;
      finishFailure = true;
      response = await run();
      if (response.status !== 503 || Number(calls) !== 3)
        throw new Error('Successful page repeated');
      finishFailure = false;
      response = await run();
      if (response.status !== 200 || (await response.json()).completed !== 1 || Number(calls) !== 3)
        throw new Error('Successful paid pages repeated after DB failure');
      if (
        !published ||
        published.p_pages.length !== 3 ||
        published.p_pages[0].text !== 'LOCAL' ||
        published.p_pages[1].extraction?.provider !== 'gemini' ||
        published.p_pages[2].page !== 3
      )
        throw new Error('Source mapping or provenance lost');
      Deno.env.delete('GEMINI_API_KEY');
      if ((await run()).status !== 503 || Number(calls) !== 3)
        throw new Error('Missing configuration spent work');
    } finally {
      globalThis.fetch = fetch;
      names.forEach((n, i) =>
        previous[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, previous[i]!),
      );
    }
  },
);
