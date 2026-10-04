import {
  StripeApiError,
  appBaseUrl,
  encodeForm,
  stripeRequest,
  verifyStripeSignature,
} from './stripe.ts';
import { BASE_ENV, reply, sign, withMocks } from './testing/stripe.ts';

Deno.test('encodeForm nutzt die Klammer-Notation von Stripe und lässt leere Werte weg', () => {
  const form = encodeForm({
    mode: 'subscription',
    line_items: [{ price: 'price_1', quantity: 1 }],
    metadata: { supabase_user_id: 'u1' },
    leer: undefined,
    nichts: null,
    flag: false,
  });
  const entries = Object.fromEntries(form);
  if (
    entries['line_items[0][price]'] !== 'price_1' ||
    entries['line_items[0][quantity]'] !== '1' ||
    entries['metadata[supabase_user_id]'] !== 'u1' ||
    entries.mode !== 'subscription' ||
    entries.flag !== 'false' ||
    'leer' in entries ||
    'nichts' in entries
  )
    throw new Error(`Falsche Kodierung: ${form}`);
});

Deno.test('Signaturprüfung akzeptiert nur gültige, frische Signaturen', async () => {
  const body = '{"id":"evt_1"}';
  const secret = 'whsec_test';
  const now = 1_800_000_000;
  const valid = await sign(body, secret, now);
  const ok = (header: string | null, payload = body, key = secret, at = now) =>
    verifyStripeSignature(payload, header, key, { nowSeconds: at });

  if (!(await ok(valid))) throw new Error('Gültige Signatur abgewiesen');
  if (await ok(valid, body + ' ')) throw new Error('Manipulierter Body akzeptiert');
  if (await ok(valid, body, 'whsec_other')) throw new Error('Falsches Secret akzeptiert');
  if (await ok(null)) throw new Error('Fehlender Header akzeptiert');
  if (await ok('')) throw new Error('Leerer Header akzeptiert');
  if (await ok('v1=abcd')) throw new Error('Header ohne Zeitstempel akzeptiert');
  if (await ok(`t=${now}`)) throw new Error('Header ohne Signatur akzeptiert');
  if (await ok(`t=${now},v1=nicht-hex`)) throw new Error('Ungültiges Hex akzeptiert');
  if (await ok(valid, body, secret, now + 301)) throw new Error('Zu alte Signatur akzeptiert');
  if (await ok(valid, body, secret, now - 301)) throw new Error('Zukünftige Signatur akzeptiert');
  if (!(await ok(valid, body, secret, now + 299))) throw new Error('Toleranz zu streng');
  // Stripe kann mehrere v1-Signaturen senden (Secret-Rotation): eine gültige genügt.
  const rotated = `${valid.split(',')[0]},v1=${'0'.repeat(64)},${valid.split(',')[1]}`;
  if (!(await ok(rotated))) throw new Error('Rotation mit mehreren v1 abgewiesen');
});

Deno.test(
  'stripeRequest sendet Bearer, Formular-Body und Idempotency-Key und meldet Fehlercodes',
  async () => {
    await withMocks(
      BASE_ENV,
      (call) =>
        call.url.endsWith('/v1/fail')
          ? reply({ error: { code: 'resource_missing' } }, 404)
          : reply({ id: 'cus_1' }),
      async (calls) => {
        const result = await stripeRequest<{ id: string }>(
          'sk_test_key',
          'POST',
          '/customers',
          { email: 'a@b.de', metadata: { k: 'v' } },
          { idempotencyKey: 'key-1' },
        );
        if (result.id !== 'cus_1') throw new Error('Antwort nicht durchgereicht');
        const [call] = calls;
        if (call.url !== 'https://api.stripe.com/v1/customers') throw new Error(call.url);
        if (call.headers.get('authorization') !== 'Bearer sk_test_key') throw new Error('Auth');
        if (call.headers.get('idempotency-key') !== 'key-1') throw new Error('Idempotency-Key');
        if (call.headers.get('content-type') !== 'application/x-www-form-urlencoded')
          throw new Error('Content-Type');
        if (call.body !== 'email=a%40b.de&metadata%5Bk%5D=v') throw new Error(call.body);

        await stripeRequest('sk_test_key', 'GET', '/subscriptions', { customer: 'cus_1' });
        if (
          calls[1].url !== 'https://api.stripe.com/v1/subscriptions?customer=cus_1' ||
          calls[1].body
        )
          throw new Error('GET muss Parameter in der URL senden');

        const error = await stripeRequest('sk_test_key', 'GET', '/fail').catch((e) => e);
        if (
          !(error instanceof StripeApiError) ||
          error.status !== 404 ||
          error.code !== 'resource_missing'
        )
          throw new Error('Stripe-Fehler nicht als StripeApiError gemeldet');
        if (error.message.includes('sk_test_key')) throw new Error('Secret in Fehlermeldung');
      },
    );
  },
);

Deno.test('appBaseUrl akzeptiert nur http(s) und entfernt den Schrägstrich am Ende', async () => {
  const cases: [string | undefined, string | null][] = [
    ['https://app.test/', 'https://app.test'],
    ['https://app.test/pfad//', 'https://app.test/pfad'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['javascript:alert(1)', null],
    ['kein url', null],
    [undefined, null],
  ];
  for (const [value, expected] of cases) {
    await withMocks(
      { APP_URL: value },
      () => undefined,
      () => {
        if (appBaseUrl() !== expected) throw new Error(`${value}: ${appBaseUrl()}`);
        return Promise.resolve();
      },
    );
  }
});
