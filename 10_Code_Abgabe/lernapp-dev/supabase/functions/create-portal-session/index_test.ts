import { handler } from './index.ts';
import {
  BASE_ENV,
  USER_ID,
  form,
  isAuthUser,
  isRest,
  isStripe,
  reply,
  withMocks,
  type Call,
} from '../_shared/testing/stripe.ts';

const request = (body?: unknown) =>
  new Request('http://localhost/create-portal-session', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const router = (row: Record<string, unknown> | null) => (call: Call) => {
  if (isAuthUser(call)) return reply({ id: USER_ID, email: 'anna@example.com' });
  if (isRest(call, 'subscriptions', 'GET')) return reply(row ? [row] : []);
  if (isStripe(call, 'POST', '/billing_portal/sessions'))
    return reply({ url: 'https://billing.stripe.test/session' });
  return undefined;
};

Deno.test('Preflight, fehlender JWT und falsche Methode', async () => {
  const preflight = await handler(new Request('http://localhost/x', { method: 'OPTIONS' }));
  if (preflight.status !== 204) throw new Error('Preflight');
  for (const authorization of [undefined, 'Basic abc', 'Bearer ']) {
    const response = await handler(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: authorization ? { Authorization: authorization } : {},
      }),
    );
    if (response.status !== 401) throw new Error(`Ungültiger Header: ${authorization}`);
    if (response.headers.get('cache-control') !== 'no-store') throw new Error('no-store');
    await response.json();
  }
  const get = await handler(new Request('http://localhost/x'));
  if (get.status !== 405) throw new Error('GET zugelassen');
  await get.json();
});

Deno.test('Ohne Subscription-Zeile gibt es kein Portal (404, kein Stripe-Aufruf)', async () => {
  await withMocks(BASE_ENV, router(null), async (calls) => {
    const response = await handler(request());
    const body = await response.json();
    if (response.status !== 404 || body.error.code !== 'NO_SUBSCRIPTION')
      throw new Error(String(response.status));
    if (calls.some((call) => call.url.includes('stripe.com'))) throw new Error('Stripe-Aufruf');
  });
});

Deno.test('Customer kommt aus der eigenen Zeile, nicht vom Client', async () => {
  await withMocks(BASE_ENV, router({ stripe_customer_id: 'cus_own' }), async (calls) => {
    const response = await handler(
      request({ customer: 'cus_foreign', customer_id: 'cus_foreign' }),
    );
    const body = await response.json();
    if (response.status !== 200 || body.url !== 'https://billing.stripe.test/session')
      throw new Error(`${response.status}`);
    const portal = calls.find((call) => isStripe(call, 'POST', '/billing_portal/sessions'))!;
    const sent = form(portal);
    if (sent.customer !== 'cus_own') throw new Error(`Customer: ${sent.customer}`);
    if (sent.return_url !== 'https://app.test/billing')
      throw new Error(`return_url: ${sent.return_url}`);
    if (portal.body.includes('cus_foreign')) throw new Error('Client-Wert gelangte zu Stripe');
    // Die Zeile wird mit dem Nutzer-JWT (RLS) gelesen, nicht mit dem Service-Key.
    const read = calls.find((call) => isRest(call, 'subscriptions', 'GET'))!;
    if (read.headers.get('authorization') !== 'Bearer user-token') throw new Error('RLS-Client');
  });
});

Deno.test('Fehlende Konfiguration und Stripe-Fehler bleiben generisch', async () => {
  await withMocks(
    { ...BASE_ENV, APP_URL: undefined },
    router({ stripe_customer_id: 'cus_own' }),
    async () => {
      const response = await handler(request());
      const body = await response.json();
      if (response.status !== 500 || body.error.code !== 'CONFIGURATION_ERROR')
        throw new Error(String(response.status));
    },
  );
  await withMocks(
    BASE_ENV,
    (call) =>
      isStripe(call, 'POST', '/billing_portal/sessions')
        ? reply({ error: { code: 'invalid_request_error', message: 'sk_test_secret' } }, 400)
        : router({ stripe_customer_id: 'cus_own' })(call),
    async () => {
      const response = await handler(request());
      const text = await response.text();
      if (response.status !== 502 || text.includes('sk_test')) throw new Error(text);
    },
  );
});
