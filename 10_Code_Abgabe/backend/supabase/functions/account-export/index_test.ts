import { handler, publicUrl } from './index.ts';
import {
  BASE_ENV,
  USER_ID,
  isAuthUser,
  reply,
  withMocks,
  type Call,
} from '../_shared/testing/stripe.ts';

const request = (method = 'GET') =>
  new Request('http://localhost/account-export', {
    method,
    headers: { Authorization: 'Bearer user-token' },
  });

const isRpc = (call: Call) =>
  call.method === 'POST' && new URL(call.url).pathname === '/rest/v1/rpc/export_my_data';
const isSign = (call: Call) =>
  call.method === 'POST' && new URL(call.url).pathname === '/storage/v1/object/sign/learning-files';

const files = [
  { id: 'f1', status: 'ready', original_filename: 'a.pdf', storage_path: `${USER_ID}/c/f1.pdf` },
  { id: 'f2', status: 'pending', original_filename: 'b.pdf', storage_path: `${USER_ID}/c/f2.pdf` },
];

const router = (rpc: unknown) => (call: Call) => {
  if (isAuthUser(call))
    return reply({ id: USER_ID, email: 'anna@example.com', created_at: '2026-09-01T00:00:00Z' });
  if (isRpc(call)) return reply(rpc);
  if (isSign(call)) {
    const { paths } = JSON.parse(call.body) as { paths: string[] };
    return reply(
      paths.map((path) => ({
        path,
        signedURL: `/object/sign/learning-files/${path}?token=t`,
        error: null,
      })),
    );
  }
  return undefined;
};

Deno.test('Preflight, fehlender JWT und falsche Methode', async () => {
  const preflight = await handler(new Request('http://localhost/x', { method: 'OPTIONS' }));
  if (preflight.status !== 204) throw new Error('Preflight');
  for (const authorization of [undefined, 'Basic abc', 'Bearer ']) {
    const response = await handler(
      new Request('http://localhost/x', {
        headers: authorization ? { Authorization: authorization } : {},
      }),
    );
    if (response.status !== 401) throw new Error(`Ungültiger Header: ${authorization}`);
    await response.json();
  }
  const post = await handler(request('POST'));
  if (post.status !== 405) throw new Error('POST zugelassen');
  await post.json();
});

Deno.test('Export enthält Konto, Daten und nur für fertige Dateien Download-Links', async () => {
  await withMocks(
    { ...BASE_ENV, PUBLIC_SUPABASE_URL: 'https://public.test' },
    router({ allowed: true, data: { courses: [{ id: 'c' }], files } }),
    async (calls) => {
      const response = await handler(request());
      const body = await response.json();
      if (response.status !== 200) throw new Error(String(response.status));
      if (!response.headers.get('content-disposition')?.includes('universe-export-'))
        throw new Error('content-disposition');
      if (body.export_version !== 1 || body.account.email !== 'anna@example.com')
        throw new Error('Kopf');
      if (body.courses[0].id !== 'c') throw new Error('Daten');
      const [ready, pending] = body.files;
      if (!ready.download_url?.startsWith('https://public.test/storage/v1/object/sign/'))
        throw new Error(`URL: ${ready.download_url}`);
      if (!ready.download_expires_at) throw new Error('Ablaufzeit');
      if (pending.download_url !== null) throw new Error('Link für unfertige Datei');
      if (JSON.stringify(body).includes('storage_path')) throw new Error('storage_path geleakt');
      // Daten und Signaturen laufen mit dem Nutzer-JWT, nicht mit dem Service-Key.
      for (const call of calls.filter((call) => isRpc(call) || isSign(call)))
        if (call.headers.get('authorization') !== 'Bearer user-token') throw new Error('RLS');
      const sign = JSON.parse(calls.find(isSign)!.body);
      if (sign.paths.length !== 1 || sign.expiresIn !== 86400) throw new Error('Signatur');
    },
  );
});

Deno.test('Rate-Limit liefert 429 mit Retry-After', async () => {
  await withMocks(
    BASE_ENV,
    router({ allowed: false, code: 'RATE_LIMITED', retry_after_seconds: 120 }),
    async (calls) => {
      const response = await handler(request());
      const body = await response.json();
      if (response.status !== 429 || body.error.code !== 'RATE_LIMITED')
        throw new Error(String(response.status));
      if (response.headers.get('retry-after') !== '120') throw new Error('Retry-After');
      if (calls.some(isSign)) throw new Error('Signatur trotz Limit');
    },
  );
});

Deno.test('Datenbank- und Storage-Fehler bleiben generisch', async () => {
  await withMocks(
    BASE_ENV,
    (call) => (isRpc(call) ? reply({ message: 'boom' }, 500) : router(null)(call)),
    async () => {
      const response = await handler(request());
      if (response.status !== 503) throw new Error(String(response.status));
      await response.json();
    },
  );
  await withMocks(
    BASE_ENV,
    (call) =>
      isSign(call)
        ? reply({ message: 'boom' }, 500)
        : router({ allowed: true, data: { files } })(call),
    async () => {
      const response = await handler(request());
      const body = await response.json();
      if (response.status !== 503 || body.error.code !== 'STORAGE_ERROR')
        throw new Error(String(response.status));
    },
  );
});

Deno.test('publicUrl ersetzt nur die Basis', () => {
  const url = publicUrl(
    'http://kong:8000/storage/v1/object/sign/x/y.pdf?token=a&download=',
    'http://127.0.0.1:54321',
  );
  if (url !== 'http://127.0.0.1:54321/storage/v1/object/sign/x/y.pdf?token=a&download=')
    throw new Error(url);
});
