import { handler } from './index.ts';

const conversation = '11111111-1111-1111-1111-111111111111';
const course = '22222222-2222-2222-2222-222222222222';
const material = '55555555-5555-5555-5555-555555555555';
const secondMaterial = '66666666-6666-6666-6666-666666666666';
const request = '33333333-3333-3333-3333-333333333333';
const exchange = {
  conversation_id: conversation,
  messages: [
    { id: 'q', seq: 1, role: 'user', content: 'Was bedeutet Preiselastizität?' },
    { id: 'a', seq: 2, role: 'assistant', content: 'Sie misst die Mengenreaktion [1].' },
  ],
  sources: [{ citation_no: 1, material_title: 'Vorlesung 03', page_number: 17 }],
};

Deno.test(
  'Chat answers with citations, replays retries and never spends unauthorised',
  async () => {
    const names = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'OPENAI_API_KEY',
      'ANSWER_PROVIDER',
      'GEMINI_API_KEY',
      'GEMINI_ANSWER_MODEL',
      'EMBEDDING_PROVIDER',
    ];
    const previous = names.map((name) => Deno.env.get(name));
    const original = globalThis.fetch;
    Deno.env.set(names[0], 'http://supabase.test');
    Deno.env.set(names[1], 'anon-key');
    Deno.env.set(names[2], 'service-key');
    Deno.env.set(names[3], 'test-key');
    Deno.env.set('GEMINI_API_KEY', 'gemini-key');
    Deno.env.set('GEMINI_ANSWER_MODEL', 'gemini-test');
    const usageKeys = new Set<string>();
    try {
      if ((await handler(new Request('http://local', { method: 'OPTIONS' }))).status !== 204)
        throw new Error('Preflight blocked');
      if ((await handler(new Request('http://local', { method: 'POST' }))).status !== 401)
        throw new Error('Anonymous chat');
      for (const scenario of [
        'scope_single',
        'scope_multiple',
        'scope_foreign',
        'scope_empty',
        'scope_invalid',
        'scope_null',
        'scope_too_many',
        'scope_no_material',
        'scope_replay_conflict',
        'success',
        'summary_count',
        'summary_characters',
        'summary_oversized',
        'summary_failure',
        'replay',
        'foreign',
        'invalid',
        'oversized',
        'unauthenticated',
        'no_material',
        'provider',
        'busy',
        'rate',
        'invalid_citation',
        'expired',
        'gemini',
        'embedding_mismatch',
        'replay_conflict',
        'cancelled',
        'persist_outage',
        'quota',
      ]) {
        Deno.env.set('ANSWER_PROVIDER', scenario === 'gemini' ? 'gemini' : 'openai');
        Deno.env.set('EMBEDDING_PROVIDER', scenario === 'embedding_mismatch' ? 'openai' : 'gemini');
        const scope =
          scenario === 'scope_single' ||
          scenario === 'scope_no_material' ||
          scenario === 'scope_replay_conflict'
            ? [material]
            : scenario === 'scope_multiple' || scenario === 'scope_foreign'
              ? [secondMaterial, material, material]
              : scenario === 'scope_empty'
                ? []
                : scenario === 'scope_invalid'
                  ? ['invalid']
                  : scenario === 'scope_null'
                    ? null
                    : scenario === 'scope_too_many'
                      ? Array(101).fill(material)
                      : undefined;
        const normalizedScope = scope ? [...new Set(scope)].sort() : null;
        const cancellation = new AbortController();
        let reserved = false;
        let failed = false;
        let embedded = false;
        let completed = false;
        let booked = 0;
        let usageKey: string | undefined;
        let tokens: Record<string, unknown> | undefined;
        let stored: Record<string, unknown> | undefined;
        let summaryCalls = 0;
        let summarySaved = false;
        const summarizing = scenario.startsWith('summary_');
        const messageCount = scenario === 'summary_count' ? 12 : 4;
        const oldTurns = Array.from({ length: messageCount }, (_, i) => ({
          seq: i + 1,
          role: i % 2 ? 'assistant' : 'user',
          content: 'x'.repeat(
            scenario === 'summary_oversized' ? 8000 : scenario === 'summary_count' ? 20 : 2000,
          ),
        }));
        globalThis.fetch = (input, init) => {
          const url = String(input);
          const authorization = new Headers(init?.headers).get('authorization');
          if (url.includes('/auth/v1/user'))
            return Promise.resolve(
              scenario === 'unauthenticated'
                ? Response.json({ message: 'invalid' }, { status: 401 })
                : Response.json({ id: 'user' }),
            );
          if (url.includes('/rest/v1/chat_history_summaries'))
            return Promise.resolve(Response.json(null));
          if (url.includes('/rest/v1/chat_conversations'))
            return Promise.resolve(
              Response.json(
                scenario === 'foreign' ? null : { id: conversation, course_id: course },
              ),
            );
          if (url.includes('/rpc/chat_exchange')) {
            if (
              JSON.stringify(JSON.parse(String(init?.body)).p_material_ids) !==
              JSON.stringify(normalizedScope)
            )
              throw new Error('Replay scope lost');
            if (scenario === 'scope_replay_conflict')
              return Promise.resolve(
                Response.json({ code: '22023', message: 'REQUEST_ID_CONFLICT' }, { status: 400 }),
              );
            return Promise.resolve(
              Response.json(['replay', 'replay_conflict'].includes(scenario) ? exchange : null),
            );
          }
          if (url.includes('/rpc/reserve_chat_request')) {
            if (
              JSON.stringify(JSON.parse(String(init?.body)).p_material_ids) !==
              JSON.stringify(normalizedScope)
            )
              throw new Error('Reservation scope lost');
            reserved = true;
            return Promise.resolve(
              Response.json(
                scenario === 'busy'
                  ? { code: 'REQUEST_IN_PROGRESS', retry_after_seconds: 2 }
                  : scenario === 'rate'
                    ? { code: 'RATE_LIMITED', retry_after_seconds: 60 }
                    : { lease_token: '44444444-4444-4444-4444-444444444444' },
              ),
            );
          }
          if (url.includes('/rpc/consume_usage')) {
            if (authorization !== 'Bearer service-key') throw new Error('Usage not server-booked');
            const body = JSON.parse(String(init?.body));
            if (
              body.p_user_id !== 'user' ||
              body.p_kind !== 'chat' ||
              !body.p_key ||
              body.p_key === request
            )
              throw new Error('Usage booking lost its identity');
            if (usageKeys.has(body.p_key))
              throw new Error('A new provider execution reused a usage key');
            usageKeys.add(body.p_key);
            usageKey = body.p_key;
            booked++;
            return Promise.resolve(
              Response.json(
                scenario === 'quota'
                  ? { allowed: false, code: 'QUOTA_EXCEEDED', limit: 100, used: 100 }
                  : { allowed: true },
              ),
            );
          }
          if (url.includes('/rpc/record_usage_tokens')) {
            if (authorization !== 'Bearer service-key')
              throw new Error('Tokens not server-written');
            tokens = JSON.parse(String(init?.body));
            return Promise.resolve(new Response(null, { status: 204 }));
          }
          if (url.includes('/rpc/fail_chat_request')) {
            failed = true;
            if (
              scenario === 'quota' &&
              JSON.parse(String(init?.body)).p_error_code !== 'QUOTA_EXCEEDED'
            )
              throw new Error('Quota failure not recorded');
            return Promise.resolve(Response.json(true));
          }
          if (url.includes('/rest/v1/source_documents')) {
            if (
              scope &&
              new URL(url).searchParams.get('material_id') !== `in.(${normalizedScope!.join(',')})`
            )
              throw new Error('Index check scope lost');
            return Promise.resolve(
              Response.json(
                ['no_material', 'scope_no_material'].includes(scenario) ? [] : [{ id: 'document' }],
              ),
            );
          }
          if (url.includes('/rest/v1/chat_messages')) {
            const params = new URL(url).searchParams;
            const before = params.getAll('seq').find((v) => v.startsWith('lt.'));
            return Promise.resolve(
              Response.json(
                !summarizing
                  ? []
                  : before
                    ? oldTurns.filter((t) => t.seq < Number(before.slice(3)))
                    : oldTurns.slice(-10).reverse(),
              ),
            );
          }
          if (url.includes('/rpc/save_chat_history_summary')) {
            summarySaved = true;
            const body = JSON.parse(String(init?.body));
            const expected =
              scenario === 'summary_count' || scenario === 'summary_oversized' ? 2 : 1;
            if (body.p_through_seq !== expected) throw new Error('Wrong summary boundary');
            return Promise.resolve(Response.json(true));
          }
          if (
            url ===
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents'
          ) {
            embedded = true;
            return Promise.resolve(
              Response.json({
                embeddings: [{ values: [1, ...new Array(1535).fill(0)] }],
              }),
            );
          }
          if (url.includes('/rpc/search_document_chunks')) {
            if (authorization !== 'Bearer user-jwt') throw new Error('RLS bypass');
            const body = JSON.parse(String(init?.body));
            if (
              body.p_embedding_provider !== 'gemini' ||
              body.p_embedding_model !== 'gemini-embedding-2' ||
              body.p_query !== 'Was bedeutet Preiselastizität?' ||
              body.p_course_id !== course ||
              JSON.stringify(body.p_material_ids) !== JSON.stringify(normalizedScope)
            )
              throw new Error('Scope lost');
            return Promise.resolve(
              Response.json(
                scenario === 'no_material'
                  ? []
                  : [
                      {
                        id: 'chunk',
                        document_id: 'document',
                        material_id: material,
                        chunk_index: 0,
                        content: 'Die Preiselastizität misst die Mengenreaktion.',
                        page_number: 17,
                        metadata: {},
                        similarity: 0.83,
                      },
                    ],
              ),
            );
          }
          if (url.includes('/rest/v1/materials')) {
            if (new URL(url).searchParams.get('select') === 'id') {
              if (
                authorization !== 'Bearer user-jwt' ||
                new URL(url).searchParams.get('course_id') !== `eq.${course}`
              )
                throw new Error('Scope access check bypassed');
              return Promise.resolve(
                Response.json(
                  scenario === 'scope_foreign'
                    ? [{ id: material }]
                    : normalizedScope!.map((id) => ({ id })),
                ),
              );
            }
            return Promise.resolve(Response.json([{ id: material, title: 'Vorlesung 03' }]));
          }
          if (url.includes('generativelanguage.googleapis.com')) {
            completed = true;
            if (scenario !== 'gemini') throw new Error('Wrong answer provider');
            return Promise.resolve(
              Response.json({
                modelVersion: 'gemini-test-resolved',
                candidates: [
                  { finishReason: 'STOP', content: { parts: [{ text: 'Antwort [1].' }] } },
                ],
                usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
              }),
            );
          }
          if (url === 'https://api.openai.com/v1/chat/completions') {
            const body = JSON.parse(String(init?.body));
            if (body.max_completion_tokens === 600) {
              summaryCalls++;
              if (scenario === 'summary_failure')
                return Promise.resolve(Response.json({}, { status: 429 }));
              return Promise.resolve(
                Response.json({
                  model: 'test',
                  choices: [{ finish_reason: 'stop', message: { content: 'Vorheriger Kontext' } }],
                }),
              );
            }
            if (body.messages.some((m: Record<string, unknown>) => 'seq' in m))
              throw new Error('Internal sequence leaked into provider message');
            if (
              summarizing &&
              scenario !== 'summary_failure' &&
              !body.messages.at(-1).content.includes('Vorheriger Kontext')
            )
              throw new Error('Summary missing from answer prompt');
            completed = true;
            if (scenario === 'cancelled') {
              cancellation.abort();
              throw new DOMException('Cancelled', 'AbortError');
            }
            if (scenario === 'provider')
              return Promise.resolve(new Response(null, { status: 503 }));
            return Promise.resolve(
              Response.json({
                model: 'gpt-4o-mini-2026-01-01',
                usage: { prompt_tokens: 20, completion_tokens: 5 },
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      content:
                        scenario === 'invalid_citation'
                          ? 'Falsch [9].'
                          : 'Sie misst die Mengenreaktion [1].',
                    },
                  },
                ],
              }),
            );
          }
          if (url.includes('/rpc/complete_chat_request')) {
            if (authorization !== 'Bearer service-key')
              throw new Error('Answers not server-written');
            stored = JSON.parse(String(init?.body));
            return Promise.resolve(
              scenario === 'persist_outage'
                ? Response.json({ message: 'outage' }, { status: 503 })
                : scenario === 'expired'
                  ? Response.json(
                      { code: 'P0001', message: 'REQUEST_LEASE_EXPIRED' },
                      { status: 400 },
                    )
                  : Response.json(exchange),
            );
          }
          throw new Error(`Unexpected ${url}`);
        };
        const response = await handler(
          new Request('http://local', {
            method: 'POST',
            headers: { Authorization: 'Bearer user-jwt' },
            signal: cancellation.signal,
            body: JSON.stringify({
              conversation_id: scenario === 'gemini' ? secondMaterial : conversation,
              request_id: request,
              material_ids: scope,
              question:
                scenario === 'replay_conflict'
                  ? 'Andere Frage'
                  : scenario === 'invalid'
                    ? '   '
                    : scenario === 'oversized'
                      ? 'x'.repeat(11000)
                      : 'Was bedeutet Preiselastizität?',
            }),
          }),
        );
        if (summaryCalls !== (summarizing ? 1 : 0)) throw new Error('Unexpected summary cost');
        if (summarySaved !== (summarizing && scenario !== 'summary_failure'))
          throw new Error('Unexpected summary persistence');
        const expected = {
          scope_single: 200,
          scope_multiple: 200,
          scope_foreign: 404,
          scope_empty: 400,
          scope_invalid: 400,
          scope_null: 400,
          scope_too_many: 400,
          scope_no_material: 409,
          scope_replay_conflict: 409,
          success: 200,
          summary_count: 200,
          summary_characters: 200,
          summary_oversized: 200,
          summary_failure: 200,
          replay: 200,
          foreign: 404,
          invalid: 400,
          oversized: 413,
          unauthenticated: 401,
          no_material: 409,
          provider: 503,
          busy: 409,
          rate: 429,
          invalid_citation: 503,
          expired: 409,
          gemini: 200,
          embedding_mismatch: 503,
          replay_conflict: 409,
          cancelled: 503,
          persist_outage: 503,
          quota: 429,
        }[scenario];
        if (response.status !== expected)
          throw new Error(`Unexpected ${scenario}: ${response.status}`);
        // A retry and every rejected request must stay free of provider calls.
        if (
          embedded !==
          [
            'scope_single',
            'scope_multiple',
            'success',
            'summary_count',
            'summary_characters',
            'summary_oversized',
            'summary_failure',
            'provider',
            'invalid_citation',
            'expired',
            'gemini',
            'cancelled',
            'persist_outage',
          ].includes(scenario)
        )
          throw new Error(`Unauthorised embedding in ${scenario}`);
        if (
          completed !==
          [
            'scope_single',
            'scope_multiple',
            'success',
            'summary_count',
            'summary_characters',
            'summary_oversized',
            'summary_failure',
            'provider',
            'invalid_citation',
            'expired',
            'gemini',
            'cancelled',
            'persist_outage',
          ].includes(scenario)
        )
          throw new Error(`Unauthorised completion in ${scenario}`);
        if (scenario === 'embedding_mismatch' && reserved)
          throw new Error('Incompatible index reserved');
        if (['busy', 'rate'].includes(scenario) && (failed || !response.headers.get('retry-after')))
          throw new Error('Admission outcome invalid');
        if (
          [
            'invalid_citation',
            'expired',
            'provider',
            'no_material',
            'cancelled',
            'persist_outage',
            'quota',
          ].includes(scenario) &&
          !failed
        )
          throw new Error('Lease not released');
        // Exactly one booking right before the first paid call, none for free rejections.
        if (booked !== (embedded || scenario === 'quota' ? 1 : 0))
          throw new Error(`Unexpected usage bookings in ${scenario}: ${booked}`);
        if (scenario === 'quota' && (await response.clone().json()).error.code !== 'QUOTA_EXCEEDED')
          throw new Error('Quota code lost');
        if (
          (tokens !== undefined) !==
          [
            'scope_single',
            'scope_multiple',
            'success',
            'summary_count',
            'summary_characters',
            'summary_oversized',
            'summary_failure',
            'gemini',
          ].includes(scenario)
        )
          throw new Error(`Unexpected token record in ${scenario}`);
        if (
          scenario === 'success' &&
          (tokens?.p_key !== usageKey ||
            tokens?.p_input_tokens !== 20 ||
            tokens?.p_output_tokens !== 5)
        )
          throw new Error('Token usage lost');
        if (scenario === 'invalid_citation' && stored)
          throw new Error('Invalid citation persisted');
        if (
          scenario === 'gemini' &&
          (stored?.p_model !== 'gemini-test-resolved' || stored?.p_output_tokens !== 5)
        )
          throw new Error('Gemini metadata lost');
        if (scenario === 'replay' && (await response.json()).messages[1].seq !== 2)
          throw new Error('Replay lost the stored exchange');
        if (['success', 'scope_single', 'scope_multiple'].includes(scenario)) {
          if ((await response.json()).sources[0].page_number !== 17)
            throw new Error('References lost');
          const sources = stored?.p_sources as { citation_no: number; excerpt: string }[];
          if (stored?.p_request_id !== request || stored?.p_model !== 'gpt-4o-mini-2026-01-01')
            throw new Error('Exchange identity or model lost');
          if (
            sources.length !== 1 ||
            sources[0].citation_no !== 1 ||
            (stored?.p_sources as { material_id: string; page_number: number }[])[0].material_id !==
              material ||
            (stored?.p_sources as { page_number: number }[])[0].page_number !== 17
          )
            throw new Error('Citation not persisted');
        }
      }
    } finally {
      globalThis.fetch = original;
      names.forEach((name, index) =>
        previous[index] === undefined
          ? Deno.env.delete(name)
          : Deno.env.set(name, previous[index]!),
      );
    }
  },
);
