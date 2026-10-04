import { handler } from './index.ts';
import { handler as worker } from '../summaries-process/index.ts';
import { readBody, databaseFailure } from '../_shared/summary-http.ts';
function assert(value: unknown): asserts value {
  if (!value) throw new Error('assertion failed');
}
Deno.test('Summary HTTP rejects unauthorized requests and unsupported methods', async () => {
  assert((await handler(new Request('http://local', { method: 'OPTIONS' }))).status === 204);
  assert((await handler(new Request('http://local'))).status === 405);
  assert((await handler(new Request('http://local', { method: 'POST' }))).status === 401);
  assert((await worker(new Request('http://local', { method: 'POST' }))).status === 401);
});
Deno.test('Summary request reader bounds bodies and rejects invalid JSON', async () => {
  for (const body of ['[]', 'null', 'no JSON', 'x'.repeat(4097)]) {
    let failed = false;
    try {
      await readBody(new Request('http://local', { method: 'POST', body }));
    } catch {
      failed = true;
    }
    assert(failed);
  }
  assert(
    (await readBody(new Request('http://local', { method: 'POST', body: '{"action":"status"}' })))
      .action === 'status',
  );
});
Deno.test('Summary errors expose only public codes and selected document IDs', async () => {
  const hidden = await databaseFailure({
    message: 'secret internal error',
    details: 'sensitive',
  }).text();
  assert(!hidden.includes('secret') && !hidden.includes('sensitive'));
  const response = databaseFailure({ message: 'SOURCES_NOT_READY', details: '["document-id"]' });
  assert(response.status === 409 && (await response.text()).includes('document-id'));
});
