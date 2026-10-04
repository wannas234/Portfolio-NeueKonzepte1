import { handler } from './index.ts';
import {
  BASE_ENV,
  USER_ID,
  withMocks,
  reply,
  isAuthUser,
  isRest,
} from '../_shared/testing/stripe.ts';

Deno.test(
  'Reused client request IDs cannot bypass search quota or buy uncounted embeddings',
  async () => {
    const keys = new Set<string>();
    let embeddings = 0;
    await withMocks(
      { ...BASE_ENV, GEMINI_API_KEY: 'mock' },
      (call) => {
        if (isAuthUser(call)) return reply({ id: USER_ID });
        if (isRest(call, 'courses', 'GET')) return reply({ id: USER_ID });
        if (isRest(call, 'rpc/consume_usage', 'POST')) {
          const key = JSON.parse(call.body).p_key;
          // Model the real database's replay bypass, including a one-unit quota.
          if (keys.has(key)) return reply({ allowed: true, replay: true });
          keys.add(key);
          return reply(
            keys.size === 1 ? { allowed: true } : { allowed: false, code: 'QUOTA_EXCEEDED' },
          );
        }
        if (call.url.includes(':batchEmbedContents')) {
          embeddings++;
          return reply({ embeddings: [{ values: [1, ...Array(1535).fill(0)] }] });
        }
        if (isRest(call, 'rpc/search_document_chunks', 'POST')) return reply([]);
        return undefined;
      },
      async () => {
        const responses = await Promise.all(
          ['first query', 'different query', 'first query'].map((query) =>
            handler(
              new Request('http://local', {
                method: 'POST',
                headers: { Authorization: 'Bearer user' },
                body: JSON.stringify({ course_id: USER_ID, request_id: USER_ID, query }),
              }),
            ),
          ),
        );
        const statuses = responses.map((r) => r.status).sort();
        await Promise.all(responses.map((r) => r.json()));
        if (JSON.stringify(statuses) !== '[200,429,429]' || embeddings !== 1 || keys.size !== 3)
          throw new Error(`Quota bypass: ${statuses}, embeddings=${embeddings}, keys=${keys.size}`);
      },
    );
  },
);

Deno.test(
  'Search validates input, checks course access and quota before embedding, and retrieves with user RLS',
  async () => {
    const names = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'GEMINI_API_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ];
    const previous = names.map((n) => Deno.env.get(n));
    const original = globalThis.fetch;
    Deno.env.set(names[0], 'http://supabase.test');
    Deno.env.set(names[1], 'anon-key');
    Deno.env.set(names[2], 'test-key');
    Deno.env.set(names[3], 'service-key');
    const course = '11111111-1111-1111-1111-111111111111';
    try {
      if ((await handler(new Request('http://local', { method: 'OPTIONS' }))).status !== 204)
        throw new Error('Preflight blocked');
      if ((await handler(new Request('http://local', { method: 'POST' }))).status !== 401)
        throw new Error('Anonymous search');
      for (const scenario of [
        'success',
        'foreign',
        'invalid',
        'oversized',
        'unauthenticated',
        'provider',
        'quota',
        'rate',
      ]) {
        let embedded = false;
        let booked = 0;
        globalThis.fetch = (input, init) => {
          const url = String(input);
          if (url.includes('/auth/v1/user'))
            return Promise.resolve(
              scenario === 'unauthenticated'
                ? Response.json({ message: 'invalid' }, { status: 401 })
                : Response.json({ id: course }),
            );
          if (url.includes('/rest/v1/courses'))
            return Promise.resolve(Response.json(scenario === 'foreign' ? null : { id: course }));
          if (url.includes('/rpc/consume_usage')) {
            if (new Headers(init?.headers).get('authorization') !== 'Bearer service-key')
              throw new Error('Usage must be booked server-side');
            const body = JSON.parse(String(init?.body));
            if (body.p_user_id !== course || body.p_kind !== 'search' || !body.p_key)
              throw new Error('Usage booking lost its scope');
            booked++;
            return Promise.resolve(
              Response.json(
                scenario === 'quota'
                  ? { allowed: false, code: 'QUOTA_EXCEEDED' }
                  : scenario === 'rate'
                    ? { allowed: false, code: 'RATE_LIMITED', retry_after_seconds: 12 }
                    : { allowed: true },
              ),
            );
          }
          if (
            url ===
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents'
          ) {
            embedded = true;
            return Promise.resolve(
              scenario === 'provider'
                ? new Response(null, { status: 503 })
                : Response.json({
                    embeddings: [{ values: [1, ...new Array(1535).fill(0)] }],
                  }),
            );
          }
          if (url.includes('/rpc/search_document_chunks')) {
            if (new Headers(init?.headers).get('authorization') !== 'Bearer user-jwt')
              throw new Error('RLS bypass');
            const body = JSON.parse(String(init?.body));
            if (body.p_course_id !== course || body.p_limit !== 10 || body.p_query !== 'Frage')
              throw new Error('Scope or lexical query lost');
            return Promise.resolve(Response.json([{ content: 'Relevant', page_number: 3 }]));
          }
          throw new Error(`Unexpected ${url}`);
        };
        const response = await handler(
          new Request('http://local', {
            method: 'POST',
            headers: { Authorization: 'Bearer user-jwt' },
            body: JSON.stringify({
              course_id: course,
              query:
                scenario === 'invalid'
                  ? ''
                  : scenario === 'oversized'
                    ? 'x'.repeat(11000)
                    : 'Frage',
            }),
          }),
        );
        const expected = {
          success: 200,
          foreign: 404,
          invalid: 400,
          oversized: 413,
          unauthenticated: 401,
          provider: 503,
          quota: 429,
          rate: 429,
        }[scenario];
        if (response.status !== expected)
          throw new Error(`Unexpected ${scenario}: ${response.status}`);
        if (!['success', 'provider'].includes(scenario) && embedded)
          throw new Error('Unauthorized spend');
        if (booked !== (['success', 'provider', 'quota', 'rate'].includes(scenario) ? 1 : 0))
          throw new Error(`Unexpected usage bookings for ${scenario}: ${booked}`);
        if (scenario === 'rate' && response.headers.get('retry-after') !== '12')
          throw new Error('Retry-After lost');
        if (scenario === 'quota' && (await response.json()).error.code !== 'QUOTA_EXCEEDED')
          throw new Error('Quota code lost');
        if (scenario === 'success' && (await response.json()).matches[0].page_number !== 3)
          throw new Error('References lost');
      }
    } finally {
      globalThis.fetch = original;
      names.forEach((n, i) =>
        previous[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, previous[i]!),
      );
    }
  },
);
