import { consumeUsage, recordUsageTokens } from './usage.ts';

const client = (data: unknown, error: unknown = null, calls: unknown[] = []) => ({
  rpc: (fn: string, args: Record<string, unknown>) => {
    calls.push([fn, args]);
    return Promise.resolve({ data, error });
  },
});

Deno.test('consumeUsage übergibt Nutzer, Art und Schlüssel an die Datenbank', async () => {
  const calls: unknown[] = [];
  const decision = await consumeUsage(
    client({ allowed: true, used: 1 }, null, calls),
    'u1',
    'chat',
    'k1',
  );
  if (!decision.allowed) throw new Error('Erlaubte Buchung abgelehnt');
  if (
    JSON.stringify(calls) !==
    JSON.stringify([['consume_usage', { p_user_id: 'u1', p_kind: 'chat', p_key: 'k1' }]])
  )
    throw new Error(JSON.stringify(calls));
});

Deno.test('consumeUsage meldet Kontingent und Rate-Limit', async () => {
  const quota = await consumeUsage(
    client({ allowed: false, code: 'QUOTA_EXCEEDED' }),
    'u',
    'search',
    'k',
  );
  if (quota.allowed || quota.code !== 'QUOTA_EXCEEDED') throw new Error('Kontingent');
  const rate = await consumeUsage(
    client({ allowed: false, code: 'RATE_LIMITED', retry_after_seconds: 7 }),
    'u',
    'search',
    'k',
  );
  if (rate.allowed || rate.code !== 'RATE_LIMITED' || rate.retryAfterSeconds !== 7)
    throw new Error('Rate-Limit');
  const fallback = await consumeUsage(
    client({ allowed: false, code: 'RATE_LIMITED', retry_after_seconds: 'x' }),
    'u',
    'search',
    'k',
  );
  if (fallback.allowed || fallback.code !== 'RATE_LIMITED' || fallback.retryAfterSeconds !== 60)
    throw new Error('Rate-Limit-Fallback');
});

Deno.test('consumeUsage lässt bei Fehlern oder unbekannter Antwort nichts durch', async () => {
  for (const fake of [client(null, new Error('db')), client({ allowed: 'yes' }), client(null)]) {
    let failed = false;
    try {
      await consumeUsage(fake, 'u', 'chat', 'k');
    } catch {
      failed = true;
    }
    if (!failed) throw new Error('Unklare Antwort darf nicht als erlaubt gelten');
  }
});

Deno.test('recordUsageTokens wirft nie', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    await recordUsageTokens(client(null, new Error('db')), 'u', 'chat', 'k', 1, 2);
    await recordUsageTokens(
      { rpc: () => Promise.reject(new Error('net')) },
      'u',
      'chat',
      'k',
      null,
      undefined,
    );
  } finally {
    console.error = original;
  }
});
