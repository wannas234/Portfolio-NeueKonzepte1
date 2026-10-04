import { WAIVER_VERSION, handler } from './index.ts';
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
  type Router,
} from '../_shared/testing/stripe.ts';

const request = (body?: unknown) =>
  new Request('http://localhost/create-checkout-session', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// Router mit Standardantworten; `existing` ist die per RLS gelesene eigene Zeile.
function router(options: {
  existing?: Record<string, unknown> | null;
  liveSubscriptions?: { id: string; status: string }[];
  customerRow?: Record<string, unknown>;
}): Router {
  let reads = 0;
  return (call: Call) => {
    if (isAuthUser(call)) return reply({ id: USER_ID, email: 'anna@example.com' });
    if (isRest(call, 'subscriptions', 'GET')) {
      reads++;
      if (reads === 1) return reply(options.existing ? [options.existing] : []);
      return reply([options.customerRow ?? { stripe_customer_id: 'cus_new' }]);
    }
    if (isRest(call, 'subscriptions', 'POST') || isRest(call, 'subscriptions', 'PATCH'))
      return new Response(null, { status: 201 });
    if (isStripe(call, 'POST', '/customers')) return reply({ id: 'cus_new' });
    if (isStripe(call, 'GET', '/subscriptions'))
      return reply({ data: options.liveSubscriptions ?? [] });
    if (isRest(call, 'rpc/reserve_checkout_attempt', 'POST'))
      return reply({
        id: 'attempt-1',
        parameters: JSON.parse(call.body).p_parameters,
        stripe_session_id: null,
        created_at: new Date().toISOString(),
      });
    if (isRest(call, 'checkout_attempts', 'PATCH')) return reply(null);
    if (isStripe(call, 'GET', '/checkout/sessions')) return reply({ data: [] });
    if (isStripe(call, 'POST', '/checkout/sessions'))
      return reply({
        id: 'cs_1',
        status: 'open',
        mode: 'subscription',
        metadata: { waiver_accepted_at: form(call)['metadata[waiver_accepted_at]'] },
        url: 'https://checkout.stripe.test/cs_1',
      });
    return undefined;
  };
}

Deno.test('Preflight, fehlender JWT und falsche Methode', async () => {
  const preflight = await handler(new Request('http://localhost/x', { method: 'OPTIONS' }));
  if (preflight.status !== 204) throw new Error('Preflight');
  if (preflight.headers.get('access-control-allow-origin') !== '*') throw new Error('CORS');

  for (const authorization of [undefined, 'Basic abc', 'Bearer ', 'Bearer one two']) {
    const response = await handler(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: authorization ? { Authorization: authorization } : {},
      }),
    );
    if (response.status !== 401) throw new Error(`Ungültiger Header: ${authorization}`);
    if (response.headers.get('cache-control') !== 'no-store') throw new Error('no-store');
    if (!response.headers.has('access-control-allow-origin')) throw new Error('CORS bei Fehler');
    await response.json();
  }
  const get = await handler(new Request('http://localhost/x', { method: 'GET' }));
  if (get.status !== 405) throw new Error('GET zugelassen');
  await get.json();
});

Deno.test('Ungültiger JWT wird abgewiesen, ohne Stripe zu kontaktieren', async () => {
  await withMocks(
    BASE_ENV,
    (call) => (isAuthUser(call) ? reply({ message: 'invalid JWT' }, 401) : undefined),
    async (calls) => {
      const response = await handler(request());
      if (response.status !== 401) throw new Error(String(response.status));
      await response.json();
      if (calls.some((call) => call.url.includes('stripe.com'))) throw new Error('Stripe-Aufruf');
    },
  );
});

Deno.test('Fehlende Stripe-Konfiguration liefert einen generischen 500 ohne Details', async () => {
  for (const missing of ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID', 'APP_URL']) {
    await withMocks({ ...BASE_ENV, [missing]: undefined }, router({}), async () => {
      const response = await handler(request());
      const body = await response.json();
      if (response.status !== 500 || body.error.code !== 'CONFIGURATION_ERROR')
        throw new Error(`${missing}: ${response.status}`);
    });
  }
});

Deno.test('Neuer Nutzer: Customer wird angelegt, Preis und Nutzer kommen vom Server', async () => {
  await withMocks(BASE_ENV, router({}), async (calls) => {
    // Der Client versucht, Preis und Nutzer vorzugeben: beides muss ignoriert werden.
    const response = await handler(
      request({ price_id: 'price_evil', user_id: '22222222-2222-2222-2222-222222222222' }),
    );
    const body = await response.json();
    if (response.status !== 200 || body.url !== 'https://checkout.stripe.test/cs_1')
      throw new Error(`${response.status} ${JSON.stringify(body)}`);

    const customer = calls.find((call) => isStripe(call, 'POST', '/customers'))!;
    if (customer.headers.get('idempotency-key') !== `uniVerse-customer-${USER_ID}`)
      throw new Error('Idempotency-Key fehlt');
    if (form(customer)['metadata[supabase_user_id]'] !== USER_ID)
      throw new Error('Customer-Metadaten');

    const placeholder = calls.find((call) => isRest(call, 'subscriptions', 'POST'))!;
    if (
      JSON.stringify(JSON.parse(placeholder.body)) !==
      JSON.stringify({ user_id: USER_ID, stripe_customer_id: 'cus_new', status: 'incomplete' })
    )
      throw new Error(`Platzhalter: ${placeholder.body}`);
    if (!placeholder.url.includes('on_conflict=user_id')) throw new Error('Upsert-Konflikt');

    const session = form(calls.find((call) => isStripe(call, 'POST', '/checkout/sessions'))!);
    const expected = {
      mode: 'subscription',
      customer: 'cus_new',
      client_reference_id: USER_ID,
      'line_items[0][price]': 'price_server',
      'line_items[0][quantity]': '1',
      success_url: 'https://app.test/billing/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://app.test/billing/cancel',
      'metadata[supabase_user_id]': USER_ID,
      'subscription_data[metadata][supabase_user_id]': USER_ID,
    };
    for (const [key, value] of Object.entries(expected))
      if (session[key] !== value) throw new Error(`${key}: ${session[key]}`);

    const stripeBodies = calls.filter((call) => call.url.includes('stripe.com')).map((c) => c.body);
    if (stripeBodies.some((text) => text.includes('price_evil') || text.includes('2222')))
      throw new Error('Client-Wert gelangte zu Stripe');
    if (
      calls.some(
        (call) =>
          JSON.stringify(call.body).includes('sk_test_secret') && !call.url.includes('stripe.com'),
      )
    )
      throw new Error('Secret an Dritte gesendet');
  });
});

Deno.test('Vorhandener Customer wird wiederverwendet, kein zweiter wird angelegt', async () => {
  await withMocks(
    BASE_ENV,
    router({
      existing: {
        stripe_customer_id: 'cus_existing',
        stripe_subscription_id: 'sub_old',
        status: 'canceled',
      },
      liveSubscriptions: [{ id: 'sub_old', status: 'canceled' }],
    }),
    async (calls) => {
      const response = await handler(request());
      await response.json();
      if (response.status !== 200) throw new Error(String(response.status));
      if (calls.some((call) => isStripe(call, 'POST', '/customers')))
        throw new Error('Doppelter Customer');
      const session = form(calls.find((call) => isStripe(call, 'POST', '/checkout/sessions'))!);
      if (session.customer !== 'cus_existing') throw new Error(session.customer);
    },
  );
});

Deno.test('Bereits aktives Abo laut Datenbank: 409 ohne Stripe-Aufruf', async () => {
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']) {
    await withMocks(
      BASE_ENV,
      router({
        existing: { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status },
      }),
      async (calls) => {
        const response = await handler(request());
        const body = await response.json();
        if (response.status !== 409 || body.error.code !== 'ALREADY_SUBSCRIBED')
          throw new Error(`${status}: ${response.status}`);
        if (calls.some((call) => call.url.includes('stripe.com'))) throw new Error('Stripe-Aufruf');
      },
    );
  }
});

Deno.test(
  'Aktives Abo bei Stripe, DB hinkt hinterher: 409 und keine Checkout-Session',
  async () => {
    await withMocks(
      BASE_ENV,
      router({
        existing: {
          stripe_customer_id: 'cus_1',
          stripe_subscription_id: null,
          status: 'incomplete',
        },
        liveSubscriptions: [{ id: 'sub_1', status: 'active' }],
      }),
      async (calls) => {
        const response = await handler(request());
        const body = await response.json();
        if (response.status !== 409 || body.error.code !== 'ALREADY_SUBSCRIBED')
          throw new Error(String(response.status));
        if (calls.some((call) => isStripe(call, 'POST', '/checkout/sessions')))
          throw new Error('Zweite Session erzeugt');
      },
    );
  },
);

Deno.test('Stripe-Fehler werden als 502 ohne Details gemeldet', async () => {
  await withMocks(
    BASE_ENV,
    (call) =>
      isStripe(call, 'POST', '/customers')
        ? reply({ error: { code: 'api_key_expired', message: 'sk_test_secret abgelaufen' } }, 401)
        : router({})(call),
    async () => {
      const response = await handler(request());
      const text = await response.text();
      if (response.status !== 502) throw new Error(String(response.status));
      if (text.includes('sk_test') || text.includes('abgelaufen'))
        throw new Error('Stripe-Detail geleakt');
    },
  );
});

Deno.test('Datenbankfehler beim Speichern des Customers bricht vor dem Checkout ab', async () => {
  await withMocks(
    BASE_ENV,
    (call) =>
      isRest(call, 'subscriptions', 'POST')
        ? reply({ message: 'db unavailable' }, 503)
        : router({})(call),
    async (calls) => {
      const response = await handler(request());
      await response.json();
      if (response.status !== 503) throw new Error(String(response.status));
      if (calls.some((call) => isStripe(call, 'POST', '/checkout/sessions')))
        throw new Error('Checkout trotz DB-Fehler');
    },
  );
});

Deno.test('Widerrufs-Zustimmung landet mit Server-Zeitstempel in den Metadaten', async () => {
  await withMocks(BASE_ENV, router({}), async (calls) => {
    const response = await handler(
      request({ waiver_accepted: true, waiver_accepted_at: '2000-01-01T00:00:00Z' }),
    );
    if (response.status !== 200) throw new Error(String(response.status));
    await response.json();
    const session = form(calls.find((call) => isStripe(call, 'POST', '/checkout/sessions'))!);
    for (const prefix of ['metadata', 'subscription_data[metadata]']) {
      const at = session[`${prefix}[waiver_accepted_at]`];
      if (!at || at.startsWith('2000') || Math.abs(Date.parse(at) - Date.now()) > 60_000)
        throw new Error(`${prefix}: ${at}`);
      if (session[`${prefix}[waiver_version]`] !== WAIVER_VERSION)
        throw new Error(`${prefix}: Version`);
    }
  });
});

Deno.test('Ohne Zustimmung: Metadaten ohne Nachweis, mit Pflicht-Flag 400', async () => {
  await withMocks(BASE_ENV, router({}), async (calls) => {
    const response = await handler(request({ waiver_accepted: 'true' }));
    if (response.status !== 200) throw new Error(String(response.status));
    await response.json();
    const session = form(calls.find((call) => isStripe(call, 'POST', '/checkout/sessions'))!);
    if (Object.keys(session).some((key) => key.includes('waiver')))
      throw new Error('Nachweis ohne echte Zustimmung');
  });
  await withMocks({ ...BASE_ENV, CHECKOUT_REQUIRE_WAIVER: 'true' }, router({}), async (calls) => {
    for (const body of [undefined, {}, { waiver_accepted: false }]) {
      const response = await handler(request(body));
      const result = await response.json();
      if (response.status !== 400 || result.error.code !== 'WAIVER_REQUIRED')
        throw new Error(`${JSON.stringify(body)} → ${response.status}`);
    }
    if (calls.some((call) => call.url.includes('stripe.com'))) throw new Error('Stripe-Aufruf');
    const ok = await handler(request({ waiver_accepted: true }));
    if (ok.status !== 200) throw new Error(String(ok.status));
    await ok.json();
  });
});
