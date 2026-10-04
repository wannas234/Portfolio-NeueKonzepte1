import { handler } from './index.ts';
function assert(value: unknown): asserts value {
  if (!value) throw new Error('assertion failed');
}
Deno.test(
  'Material analysis rejects unauthenticated requests and unsupported methods',
  async () => {
    assert((await handler(new Request('http://local', { method: 'OPTIONS' }))).status === 204);
    assert((await handler(new Request('http://local'))).status === 405);
    assert((await handler(new Request('http://local', { method: 'POST' }))).status === 401);
  },
);

Deno.test(
  'Material analysis authenticates owner, validates provider output and persists full description',
  async () => {
    const original = globalThis.fetch;
    const names = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'OPENAI_API_KEY',
      'ANSWER_PROVIDER',
    ];
    const previous = names.map((name) => Deno.env.get(name));
    const values = ['http://local', 'anon-test', 'service-test', 'test-key', 'openai'];
    names.forEach((name, i) => Deno.env.set(name, values[i]));
    const material = '90000000-0000-0000-0000-000000000001';
    const analysis = '90000000-0000-0000-0000-000000000002';
    const owner = '90000000-0000-0000-0000-000000000003';
    const quote = 'Abgabe am 15. November 2026 bis 18 Uhr. Als PDF im Lernportal einreichen.';
    let saved: Record<string, unknown> | undefined;
    let generate = true;
    let invalid = false;
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      await Promise.resolve();
      const url = String(input);
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: owner });
      if (url.endsWith('/rpc/begin_material_analysis')) {
        assert(payload.p_owner_id === owner && payload.p_material_id === material);
        return Response.json(
          generate
            ? {
                run: true,
                analysis_id: analysis,
                lease_token: analysis,
                source: { text: quote, pages: null },
              }
            : { run: false, result: { status: 'completed', items: [] } },
        );
      }
      if (url.includes('api.openai.com')) {
        calls++;
        const output = {
          items: [
            {
              type: 'calendar_entry',
              title: 'Projektarbeit abgeben',
              description: 'Als PDF im Lernportal einreichen.',
              source: { page: null, quote: invalid ? 'halluziniert' : quote },
              issue_codes: [],
              data: {
                kind: 'deadline',
                date: '2026-11-15',
                time: '18:00:00',
                end_date: null,
                end_time: null,
                timezone: null,
                location: null,
                submission_channel: 'Lernportal',
              },
            },
          ],
        };
        return Response.json({
          model: 'test-model',
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
        });
      }
      if (url.endsWith('/rpc/finish_material_analysis')) {
        saved = payload;
        return Response.json({
          status: payload.p_error ? 'failed' : 'completed',
          items: payload.p_items,
          error_code: payload.p_error,
        });
      }
      if (url.endsWith('/rpc/record_usage_tokens')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const request = () =>
      new Request('http://local', {
        method: 'POST',
        headers: { authorization: 'Bearer user-token' },
        body: JSON.stringify({ action: 'analyze', request_id: analysis, material_id: material }),
      });
    try {
      const result = await (await handler(request())).json();
      assert(
        result.status === 'completed' &&
          result.items[0].description === 'Als PDF im Lernportal einreichen.',
      );
      assert(saved?.p_owner_id === owner && saved.p_analysis_id === analysis);
      generate = false;
      assert((await handler(request())).status === 200 && calls === 1);
      generate = true;
      invalid = true;
      const failed = await (await handler(request())).json();
      assert(
        failed.status === 'failed' &&
          failed.items.length === 0 &&
          failed.error_code === 'INVALID_ANALYSIS_SOURCE',
      );
    } finally {
      globalThis.fetch = original;
      names.forEach((name, i) =>
        previous[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[i]!),
      );
    }
  },
);
