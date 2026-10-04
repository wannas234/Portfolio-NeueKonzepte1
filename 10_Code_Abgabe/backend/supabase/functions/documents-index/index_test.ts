import { handler } from './index.ts';

Deno.test(
  'Index worker handles batches, provider failure, stale leases and configuration',
  async () => {
    const names = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'GEMINI_API_KEY',
      'WORKER_SERVICE_ROLE_KEY',
    ];
    const previous = names.map((n) => Deno.env.get(n));
    const original = globalThis.fetch;
    Deno.env.set('WORKER_SERVICE_ROLE_KEY', 'scheduler-key');
    Deno.env.set(names[0], 'http://supabase.test');
    Deno.env.set(names[1], 'service-key');
    const request = () =>
      new Request('http://local', {
        method: 'POST',
        headers: { Authorization: 'Bearer scheduler-key' },
      });
    try {
      if ((await handler(new Request('http://local', { method: 'POST' }))).status !== 401)
        throw new Error('Anonymous worker');
      Deno.env.delete(names[2]);
      globalThis.fetch = () => {
        throw new Error('Must not claim without configuration');
      };
      if ((await handler(request())).status !== 503) throw new Error('Missing key ignored');
      Deno.env.set(names[2], 'test-key');
      for (const scenario of [
        'success',
        'resume',
        'empty',
        'provider',
        'database',
        'stale',
        'leased',
      ]) {
        let finish: Record<string, unknown> | undefined;
        let providerCalls = 0;
        globalThis.fetch = (input, init) => {
          const url = String(input);
          if (url.includes('/document_worker_events'))
            return Promise.resolve(new Response(null, { status: 201 }));
          if (url.includes('/acquire_document_provider_slot'))
            return Promise.resolve(Response.json('slot'));
          if (
            url.includes('/release_document_provider_slot') ||
            url.includes('/yield_document_work')
          )
            return Promise.resolve(Response.json(true));
          if (url.includes('/document_indexing_jobs'))
            return Promise.resolve(Response.json([{ document_id: 'doc' }]));
          if (url.includes('/rpc/claim_document_indexing'))
            return Promise.resolve(
              Response.json(
                scenario === 'leased'
                  ? null
                  : {
                      lease_token: 'token',
                      next_index: scenario === 'resume' ? 32 : 0,
                      text:
                        scenario === 'empty'
                          ? ' \n'
                          : 'x'.repeat(scenario === 'resume' ? 53000 : 10),
                      pages: null,
                    },
              ),
            );
          if (
            url ===
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents'
          ) {
            providerCalls++;
            if (scenario === 'provider')
              return Promise.resolve(
                new Response(null, { status: 429, headers: { 'retry-after': '120' } }),
              );
            const body = JSON.parse(String(init?.body));
            return Promise.resolve(
              Response.json({
                embeddings: body.requests.map(() => ({
                  values: [1, ...new Array(1535).fill(0)],
                })),
              }),
            );
          }
          if (url.includes('/rpc/finish_document_indexing_batch')) {
            finish = JSON.parse(String(init?.body));
            return Promise.resolve(
              scenario === 'database'
                ? Response.json({ message: 'outage' }, { status: 503 })
                : Response.json(scenario !== 'stale'),
            );
          }
          throw new Error(`Unexpected ${url}`);
        };
        const response = await handler(request());
        const body = await response.json();
        if (scenario === 'provider' || scenario === 'database') {
          if (response.status !== 503 || (scenario === 'provider' && finish))
            throw new Error('Transient failure published');
        } else if (scenario === 'leased') {
          if (finish || providerCalls) throw new Error('Unclaimed work processed');
        } else if (scenario === 'stale') {
          if (body.stored !== 0 || !body.discarded)
            throw new Error('Stale work reported as stored');
        } else {
          if (response.status !== 200 || !body.completed || !finish)
            throw new Error(`Incomplete ${scenario}`);
          const chunks = finish.p_chunks as { chunk_index: number }[];
          if (scenario === 'empty' && (chunks.length || providerCalls))
            throw new Error('Empty text embedded');
          if (scenario === 'resume' && chunks[0].chunk_index !== 32)
            throw new Error('Cursor ignored');
        }
      }
    } finally {
      globalThis.fetch = original;
      names.forEach((n, i) =>
        previous[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, previous[i]!),
      );
    }
  },
);

Deno.test(
  'Index worker drains consecutive batches, yields at configured bound and resumes persisted cursor',
  async () => {
    const names = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'WORKER_SERVICE_ROLE_KEY',
      'GEMINI_API_KEY',
      'DOCUMENT_INDEX_MAX_BATCHES',
    ];
    const previous = names.map((n) => Deno.env.get(n)),
      original = globalThis.fetch;
    let cursor = 0,
      calls = 0,
      finished = false;
    try {
      names.forEach((n, i) =>
        Deno.env.set(n, ['http://supabase.test', 'service', 'worker', 'fake', '2'][i]),
      );
      globalThis.fetch = (input, init) => {
        const url = String(input);
        if (url.includes('/document_worker_events'))
          return Promise.resolve(new Response(null, { status: 201 }));
        if (url.includes('/document_indexing_jobs'))
          return Promise.resolve(Response.json(finished ? [] : [{ document_id: 'doc' }]));
        if (url.includes('/claim_document_indexing'))
          return Promise.resolve(
            Response.json({
              lease_token: 'lease',
              next_index: cursor,
              text: 'x'.repeat(120000),
              pages: null,
            }),
          );
        if (url.includes('/acquire_document_provider_slot'))
          return Promise.resolve(Response.json('slot'));
        if (url.includes('/release_document_provider_slot'))
          return Promise.resolve(Response.json(null));
        if (url.includes(':batchEmbedContents')) {
          calls++;
          const body = JSON.parse(String(init?.body));
          if (body.requests.length > 32) throw new Error('Batch exceeds contract');
          return Promise.resolve(
            Response.json({
              embeddings: body.requests.map(() => ({ values: [1, ...Array(1535).fill(0)] })),
            }),
          );
        }
        if (url.includes('/finish_document_indexing_batch')) {
          const body = JSON.parse(String(init?.body));
          if (body.p_chunks[0].chunk_index !== cursor)
            throw new Error('Repeated persisted embedding');
          cursor += body.p_chunks.length;
          finished = cursor === body.p_total_chunks;
          return Promise.resolve(Response.json(true));
        }
        throw new Error('Unexpected endpoint');
      };
      const run = () =>
        handler(
          new Request('http://local', {
            method: 'POST',
            headers: { Authorization: 'Bearer worker' },
          }),
        );
      const first = await (await run()).json();
      if (calls !== 2 || cursor !== 64 || first.completed)
        throw new Error('Did not process exactly two batches');
      const second = await (await run()).json();
      if (Number(calls) !== 3 || !second.completed || !finished)
        throw new Error('Did not resume last batch');
    } finally {
      globalThis.fetch = original;
      names.forEach((n, i) =>
        previous[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, previous[i]!),
      );
    }
  },
);
