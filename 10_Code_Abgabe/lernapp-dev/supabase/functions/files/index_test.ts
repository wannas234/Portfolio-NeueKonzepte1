import { handler } from './index.ts';

const file = {
  id: '11111111-1111-1111-1111-111111111111',
  uploaded_by: '22222222-2222-2222-2222-222222222222',
  course_id: '33333333-3333-3333-3333-333333333333',
  storage_bucket: 'learning-files',
  storage_path:
    '22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/11111111-1111-1111-1111-111111111111.txt',
  mime_type: 'text/plain',
  size_bytes: 5,
  status: 'pending',
};
const req = (action: string) =>
  new Request('http://localhost/files', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token' },
    body: JSON.stringify({ action, file_id: file.id }),
  });
const response = (value: unknown, status = 200) => Response.json(value, { status });

Deno.test(
  'Storage and database faults leave retryable state without premature success',
  async (t) => {
    const original = globalThis.fetch;
    const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
    const previous = names.map((name) => Deno.env.get(name));
    Deno.env.set(names[0], 'http://supabase.test');
    Deno.env.set(names[1], 'anon');
    Deno.env.set(names[2], 'admin');
    try {
      for (const scenario of [
        'download-network',
        'storage-delete',
        'db-delete',
        'db-complete',
        'concurrent-delete',
      ]) {
        await t.step(scenario, async () => {
          const operations: string[] = [];
          globalThis.fetch = (input, init) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            if (url.includes('/auth/v1/user'))
              return Promise.resolve(response({ id: file.uploaded_by }));
            if (url.includes('/rest/v1/files') && method === 'GET')
              return Promise.resolve(response(file));
            if (url.includes('/rest/v1/rpc/complete_file_upload')) {
              operations.push('ready');
              return Promise.resolve(
                scenario === 'concurrent-delete'
                  ? response({ code: '55000', message: 'UPLOAD_NOT_PENDING' }, 400)
                  : response({ message: 'db unavailable' }, 503),
              );
            }
            if (url.includes('/rest/v1/files') && method === 'PATCH') {
              const patch = JSON.parse(String(init?.body));
              operations.push(patch.status);
              if (scenario === 'db-complete')
                return Promise.resolve(response({ message: 'db unavailable' }, 503));
              if (scenario === 'concurrent-delete') return Promise.resolve(response(null));
              return Promise.resolve(response({ ...file, ...patch }));
            }
            if (url.includes('/rest/v1/files') && method === 'DELETE') {
              operations.push('delete-record');
              return Promise.resolve(response({ message: 'db unavailable' }, 503));
            }
            if (url.includes('/storage/v1/object') && method === 'DELETE') {
              operations.push('delete-object');
              return Promise.resolve(
                scenario === 'storage-delete'
                  ? response({ message: 'storage unavailable' }, 503)
                  : response([]),
              );
            }
            if (url.includes('/storage/v1/object')) {
              if (scenario === 'download-network')
                return Promise.reject(new TypeError('Network interrupted'));
              return Promise.resolve(
                new Response('Hallo', { headers: { 'content-type': 'text/plain' } }),
              );
            }
            return Promise.reject(new Error(`Unexpected request ${method} ${url}`));
          };
          const result = await handler(
            req(
              scenario.includes('delete') && scenario !== 'concurrent-delete'
                ? 'delete'
                : 'complete',
            ),
          );
          if (result.status !== (scenario === 'concurrent-delete' ? 409 : 503))
            throw new Error(`${scenario}: ${result.status} ${await result.text()}`);
          await result.json();
          if (scenario === 'storage-delete' && operations.includes('delete-record'))
            throw new Error('Metadata removed before Storage succeeded');
          if (scenario === 'download-network' && operations.includes('ready'))
            throw new Error('Unverified file became ready');
          if (
            scenario === 'db-delete' &&
            operations.join(',') !== 'deleting,delete-object,delete-record'
          )
            throw new Error('Unsafe deletion order');
        });
      }
    } finally {
      globalThis.fetch = original;
      names.forEach((name, i) =>
        previous[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[i]!),
      );
    }
  },
);

Deno.test('File endpoint preflight and unauthenticated requests', async () => {
  const preflight = await handler(new Request('http://localhost/files', { method: 'OPTIONS' }));
  if (preflight.status !== 204) throw new Error('Preflight failed');
  const anonymous = await handler(new Request('http://localhost/files', { method: 'POST' }));
  if (anonymous.status !== 401) throw new Error('Anonymous access allowed');
  await anonymous.json();
});

Deno.test('Prepare reports upload and storage quotas from the database trigger', async () => {
  const original = globalThis.fetch;
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previous = names.map((name) => Deno.env.get(name));
  Deno.env.set(names[0], 'http://supabase.test');
  Deno.env.set(names[1], 'anon');
  Deno.env.set(names[2], 'admin');
  try {
    for (const [message, code, status] of [
      ['QUOTA_EXCEEDED', 'QUOTA_EXCEEDED', 429],
      ['STORAGE_QUOTA_EXCEEDED', 'STORAGE_QUOTA_EXCEEDED', 413],
    ] as const) {
      globalThis.fetch = (input) => {
        const url = String(input);
        if (url.includes('/auth/v1/user'))
          return Promise.resolve(response({ id: file.uploaded_by }));
        if (url.includes('/rest/v1/rpc/prepare_file_upload'))
          return Promise.resolve(response({ code: 'P0001', message }, 400));
        throw new Error(`Unexpected ${url}`);
      };
      const result = await handler(
        new Request('http://localhost/files', {
          method: 'POST',
          headers: { Authorization: 'Bearer user-token' },
          body: JSON.stringify({
            action: 'prepare',
            course_id: file.course_id,
            upload_key: file.id,
            filename: 'notes.txt',
            mime_type: 'text/plain',
            size_bytes: 5,
          }),
        }),
      );
      if (result.status !== status || (await result.json()).error.code !== code)
        throw new Error(`Quota ${message} not reported`);
    }
  } finally {
    globalThis.fetch = original;
    names.forEach((name, index) =>
      previous[index] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[index]!),
    );
  }
});
