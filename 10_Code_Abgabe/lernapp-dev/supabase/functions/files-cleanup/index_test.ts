import { handler } from './index.ts';
Deno.test('Cleanup retries Storage faults and records only confirmed deletion', async () => {
  const original = globalThis.fetch;
  const oldWorkerKey = Deno.env.get('WORKER_SERVICE_ROLE_KEY');
  Deno.env.set('WORKER_SERVICE_ROLE_KEY', 'scheduler-key');
  const oldKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const oldUrl = Deno.env.get('SUPABASE_URL');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'admin');
  Deno.env.set('SUPABASE_URL', 'http://supabase.test');
  try {
    const denied = await handler(
      new Request('http://localhost/cleanup', {
        method: 'POST',
        headers: { Authorization: 'Bearer user' },
      }),
    );
    if (denied.status !== 401) throw new Error('Client reached worker');
    for (const fail of [true, false]) {
      let recorded: Record<string, unknown> = {};
      globalThis.fetch = (input, init) => {
        const url = String(input);
        if (url.includes('/rpc/expire_file_uploads'))
          return Promise.resolve(new Response(null, { status: 204 }));
        if (url.includes('/file_cleanup_jobs') && init?.method === 'PATCH') {
          recorded = JSON.parse(String(init.body));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (url.includes('/file_cleanup_jobs'))
          return Promise.resolve(
            Response.json([{ file_id: 'id', storage_path: 'owner/course/file.txt', attempts: 0 }]),
          );
        if (url.includes('/storage/v1/object'))
          return Promise.resolve(
            Response.json(fail ? { message: 'unavailable' } : [], { status: fail ? 503 : 200 }),
          );
        throw new Error('Unexpected fetch');
      };
      const result = await handler(
        new Request('http://localhost/cleanup', {
          method: 'POST',
          headers: { Authorization: 'Bearer scheduler-key' },
        }),
      );
      if (result.status !== (fail ? 503 : 200)) throw new Error('Wrong cleanup status');
      await result.json();
      if (recorded.attempts !== 1) throw new Error('Attempt not recorded');
      if (fail && (recorded.completed_at || !recorded.next_attempt_at))
        throw new Error('Failed cleanup lost retry');
      if (!fail && !recorded.completed_at) throw new Error('Successful cleanup not acknowledged');
    }
  } finally {
    globalThis.fetch = original;
    if (oldWorkerKey === undefined) Deno.env.delete('WORKER_SERVICE_ROLE_KEY');
    else Deno.env.set('WORKER_SERVICE_ROLE_KEY', oldWorkerKey);
    if (oldKey === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
    else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', oldKey);
    if (oldUrl === undefined) Deno.env.delete('SUPABASE_URL');
    else Deno.env.set('SUPABASE_URL', oldUrl);
  }
});
