import { handler } from './index.ts';
import {
  BASE_ENV,
  USER_ID,
  isRest,
  isStripe,
  reply,
  sign,
  withMocks,
  type Call,
  type Router,
} from '../_shared/testing/stripe.ts';

const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  status: 'active',
  customer: 'cus_1',
  cancel_at_period_end: false,
  items: { data: [{ price: { id: 'price_server' }, current_period_end: 1_800_000_000 }] },
  metadata: { supabase_user_id: USER_ID },
  ...overrides,
});

const event = (type: string, object: Record<string, unknown>, id = 'evt_1') =>
  JSON.stringify({ id, type, data: { object } });

async function deliver(body: string, signature?: string | null) {
  const headers: Record<string, string> = {};
  const value =
    signature === undefined ? await sign(body, BASE_ENV.STRIPE_WEBHOOK_SECRET) : signature;
  if (value) headers['stripe-signature'] = value;
  return handler(new Request('http://localhost/stripe-webhook', { method: 'POST', headers, body }));
}

const writes = (calls: Call[], table: string) =>
  calls.filter((call) => isRest(call, table, 'POST'));

// Standard-Router: Event unbekannt, Customer bekannt, Platzhalter-Zeile vorhanden.
function router(
  options: {
    seen?: boolean;
    stripe?: () => Response;
    customerRow?: Record<string, unknown> | null;
    existing?: Record<string, unknown> | null;
  } = {},
): Router {
  return (call) => {
    if (isRest(call, 'stripe_events', 'GET'))
      return reply(options.seen ? [{ event_id: 'evt_1' }] : []);
    if (isRest(call, 'stripe_events', 'POST') || isRest(call, 'subscriptions', 'POST'))
      return new Response(null, { status: 201 });
    if (isRest(call, 'subscriptions', 'GET')) {
      const byCustomer = call.url.includes('stripe_customer_id=eq.');
      const row = byCustomer
        ? options.customerRow === undefined
          ? { user_id: USER_ID }
          : options.customerRow
        : options.existing === undefined
          ? { stripe_subscription_id: null, status: 'incomplete' }
          : options.existing;
      return reply(row ? [row] : []);
    }
    if (call.method === 'GET' && new URL(call.url).pathname.startsWith('/v1/subscriptions/'))
      return options.stripe ? options.stripe() : reply(subscription());
    return undefined;
  };
}

Deno.test('Nur POST, und ohne Secret wird nichts verarbeitet', async () => {
  const get = await handler(new Request('http://localhost/stripe-webhook'));
  if (get.status !== 405) throw new Error('GET zugelassen');
  await get.json();
  await withMocks(
    { ...BASE_ENV, STRIPE_WEBHOOK_SECRET: undefined },
    () => undefined,
    async (calls) => {
      const response = await deliver(event('invoice.paid', {}), 'x');
      const body = await response.json();
      if (response.status !== 500 || body.error.code !== 'WEBHOOK_NOT_CONFIGURED')
        throw new Error(String(response.status));
      if (calls.length) throw new Error('Zugriff ohne Secret');
    },
  );
});

Deno.test(
  'Fehlende, falsche, manipulierte und alte Signaturen: 400 ohne jeden Zugriff',
  async () => {
    await withMocks(
      BASE_ENV,
      () => undefined,
      async (calls) => {
        const body = event('customer.subscription.updated', subscription());
        const other = event('customer.subscription.updated', subscription({ status: 'canceled' }));
        const attempts: [string, string | null][] = [
          ['fehlend', null],
          ['leer', ''],
          ['falsches Secret', await sign(body, 'whsec_attacker')],
          ['Body ausgetauscht', await sign(other, BASE_ENV.STRIPE_WEBHOOK_SECRET)],
          [
            'abgelaufen',
            await sign(body, BASE_ENV.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600),
          ],
          ['Müll', 'v1=zzz,t=abc'],
        ];
        for (const [name, signature] of attempts) {
          const response = await deliver(body, signature);
          const json = await response.json();
          if (response.status !== 400 || json.error.code !== 'INVALID_SIGNATURE')
            throw new Error(`${name}: ${response.status}`);
        }
        if (calls.length) throw new Error('Datenbank/Stripe ohne gültige Signatur kontaktiert');
      },
    );
  },
);

Deno.test('Zu große oder ungültige Payloads werden abgewiesen', async () => {
  await withMocks(
    BASE_ENV,
    () => undefined,
    async (calls) => {
      const huge = 'x'.repeat(1_000_001);
      const tooLarge = await deliver(huge);
      if (tooLarge.status !== 413) throw new Error(String(tooLarge.status));
      await tooLarge.json();
      for (const body of ['kein json', '{}', '{"id":"evt_1","type":"x"}', 'null']) {
        const response = await deliver(body);
        const json = await response.json();
        if (response.status !== 400 || json.error.code !== 'INVALID_REQUEST')
          throw new Error(`${body}: ${response.status}`);
      }
      if (calls.length) throw new Error('Zugriff bei ungültigem Payload');
    },
  );
});

Deno.test(
  'checkout.session.completed verknüpft Customer und schreibt die Subscription',
  async () => {
    await withMocks(BASE_ENV, router(), async (calls) => {
      const response = await deliver(
        event('checkout.session.completed', {
          mode: 'subscription',
          subscription: 'sub_1',
          customer: 'cus_1',
          client_reference_id: USER_ID,
        }),
      );
      const body = await response.json();
      if (response.status !== 200 || body.received !== true)
        throw new Error(String(response.status));

      const [upsert] = writes(calls, 'subscriptions');
      if (!upsert.url.includes('on_conflict=user_id')) throw new Error('Upsert-Konflikt');
      const row = JSON.parse(upsert.body);
      const expected = {
        user_id: USER_ID,
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_1',
        status: 'active',
        price_id: 'price_server',
        current_period_end: '2027-01-15T08:00:00.000Z',
        cancel_at_period_end: false,
      };
      if (
        JSON.stringify(row, Object.keys(expected).sort()) !==
        JSON.stringify(expected, Object.keys(expected).sort())
      )
        throw new Error(`Zeile: ${upsert.body}`);
      // Schreibzugriffe nur mit Service-Key.
      if (upsert.headers.get('authorization') !== 'Bearer service')
        throw new Error('Kein Service-Key');
      // Der Zustand wird frisch bei Stripe geladen, nicht aus dem Event übernommen.
      if (!calls.some((call) => isStripe(call, 'GET', '/subscriptions/sub_1')))
        throw new Error('Kein Refetch');
      // Das Event wird erst nach erfolgreicher Verarbeitung vermerkt.
      const recorded = writes(calls, 'stripe_events');
      if (recorded.length !== 1 || JSON.parse(recorded[0].body).event_id !== 'evt_1')
        throw new Error('Event nicht vermerkt');
      if (calls.indexOf(recorded[0]) < calls.indexOf(upsert))
        throw new Error('Event zu früh vermerkt');
    });
  },
);

Deno.test('Checkout im Zahlungsmodus (kein Abo) wird bestätigt, aber ignoriert', async () => {
  await withMocks(BASE_ENV, router(), async (calls) => {
    const response = await deliver(
      event('checkout.session.completed', { mode: 'payment', customer: 'cus_1' }),
    );
    await response.json();
    if (response.status !== 200) throw new Error(String(response.status));
    if (writes(calls, 'subscriptions').length) throw new Error('Subscription geschrieben');
    if (calls.some((call) => call.url.includes('stripe.com'))) throw new Error('Stripe-Aufruf');
  });
});

Deno.test('Subscription-Lifecycle-Events übernehmen den aktuellen Stripe-Stand', async () => {
  const cases: [string, Record<string, unknown>][] = [
    ['customer.subscription.created', { status: 'active' }],
    ['customer.subscription.updated', { status: 'past_due' }],
    ['customer.subscription.updated', { status: 'active', cancel_at_period_end: true }],
    ['customer.subscription.deleted', { status: 'canceled' }],
    ['customer.subscription.paused', { status: 'paused' }],
    ['customer.subscription.resumed', { status: 'active' }],
  ];
  for (const [type, stripeState] of cases) {
    await withMocks(
      BASE_ENV,
      router({
        customerRow: { user_id: USER_ID },
        existing: { stripe_subscription_id: 'sub_1', status: 'active' },
        stripe: () => reply(subscription(stripeState)),
      }),
      async (calls) => {
        // Das Event trägt bewusst einen veralteten Stand ('incomplete').
        const response = await deliver(event(type, subscription({ status: 'incomplete' })));
        await response.json();
        if (response.status !== 200) throw new Error(`${type}: ${response.status}`);
        const row = JSON.parse(writes(calls, 'subscriptions')[0].body);
        if (
          row.status !== stripeState.status ||
          row.cancel_at_period_end !== (stripeState.cancel_at_period_end ?? false)
        )
          throw new Error(`${type}: ${JSON.stringify(row)}`);
      },
    );
  }
});

Deno.test(
  'invoice.paid und invoice.payment_failed lösen eine Synchronisation aus (altes und neues Format)',
  async () => {
    const invoices = [
      { subscription: 'sub_1', customer: 'cus_1' },
      { parent: { subscription_details: { subscription: 'sub_1' } }, customer: 'cus_1' },
    ];
    for (const type of ['invoice.paid', 'invoice.payment_failed']) {
      for (const invoice of invoices) {
        await withMocks(
          BASE_ENV,
          router({ stripe: () => reply(subscription({ status: 'past_due' })) }),
          async (calls) => {
            const response = await deliver(event(type, invoice));
            await response.json();
            if (response.status !== 200) throw new Error(`${type}: ${response.status}`);
            if (JSON.parse(writes(calls, 'subscriptions')[0].body).status !== 'past_due')
              throw new Error(`${type}: Status nicht übernommen`);
          },
        );
      }
    }
  },
);

Deno.test('Wiederholtes Event wird nicht erneut verarbeitet', async () => {
  await withMocks(BASE_ENV, router({ seen: true }), async (calls) => {
    const response = await deliver(event('customer.subscription.updated', subscription()));
    const body = await response.json();
    if (response.status !== 200 || body.duplicate !== true)
      throw new Error(String(response.status));
    if (writes(calls, 'subscriptions').length || writes(calls, 'stripe_events').length)
      throw new Error('Duplikat wurde verarbeitet');
    if (calls.some((call) => call.url.includes('stripe.com'))) throw new Error('Stripe-Aufruf');
  });
});

Deno.test(
  'Verspätetes Event einer beendeten Alt-Subscription überschreibt die aktuelle nicht',
  async () => {
    await withMocks(
      BASE_ENV,
      router({
        existing: { stripe_subscription_id: 'sub_new', status: 'active' },
        stripe: () => reply(subscription({ id: 'sub_old', status: 'canceled' })),
      }),
      async (calls) => {
        const response = await deliver(
          event('customer.subscription.deleted', subscription({ id: 'sub_old' })),
        );
        await response.json();
        if (response.status !== 200) throw new Error(String(response.status));
        if (writes(calls, 'subscriptions').length)
          throw new Error('Aktuelle Subscription überschrieben');
        if (writes(calls, 'stripe_events').length !== 1) throw new Error('Event nicht vermerkt');
      },
    );
  },
);

Deno.test(
  'Fehler bei der Verarbeitung: 500 und Event bleibt unvermerkt, damit Stripe erneut liefert',
  async () => {
    for (const failure of ['stripe', 'database']) {
      await withMocks(
        BASE_ENV,
        (call) => {
          if (failure === 'database' && isRest(call, 'subscriptions', 'POST'))
            return reply({ message: 'db unavailable' }, 503);
          return router(
            failure === 'stripe'
              ? { stripe: () => reply({ error: { code: 'api_error' } }, 500) }
              : {},
          )(call);
        },
        async (calls) => {
          const response = await deliver(event('customer.subscription.updated', subscription()));
          const body = await response.json();
          if (response.status !== 500 || body.error.code !== 'PROCESSING_FAILED')
            throw new Error(`${failure}: ${response.status}`);
          if (writes(calls, 'stripe_events').length)
            throw new Error(`${failure}: Event trotz Fehler vermerkt`);
        },
      );
    }
  },
);

Deno.test('Nicht zuordenbare Subscription wird bestätigt, aber nicht gespeichert', async () => {
  await withMocks(
    BASE_ENV,
    router({
      customerRow: null,
      stripe: () => reply(subscription({ metadata: {} })),
    }),
    async (calls) => {
      const response = await deliver(
        event('customer.subscription.created', subscription({ metadata: {} })),
      );
      await response.json();
      if (response.status !== 200) throw new Error(String(response.status));
      if (writes(calls, 'subscriptions').length)
        throw new Error('Unzuordenbare Subscription gespeichert');
    },
  );
});

Deno.test('Event zu gelöschtem Konto wird bestätigt statt endlos wiederholt', async () => {
  const base = router({ customerRow: null, existing: null });
  await withMocks(
    BASE_ENV,
    (call) =>
      isRest(call, 'subscriptions', 'POST')
        ? reply({ code: '23503', message: 'violates foreign key constraint' }, 409)
        : base(call),
    async (calls) => {
      const response = await deliver(event('customer.subscription.deleted', subscription()));
      await response.json();
      if (response.status !== 200) throw new Error(String(response.status));
      if (!writes(calls, 'stripe_events').length) throw new Error('Event nicht verbucht');
    },
  );
});

Deno.test(
  'Metadaten-User-ID ordnet eine neue Subscription zu, wenn der Customer noch unbekannt ist',
  async () => {
    await withMocks(BASE_ENV, router({ customerRow: null }), async (calls) => {
      const response = await deliver(event('customer.subscription.created', subscription()));
      await response.json();
      if (JSON.parse(writes(calls, 'subscriptions')[0].body).user_id !== USER_ID)
        throw new Error('Zuordnung über Metadaten fehlgeschlagen');
    });
  },
);

Deno.test('Manipulierte Metadaten können keinen fremden Nutzer überschreiben', async () => {
  // Customer ist bereits Nutzer A zugeordnet; Metadaten nennen Nutzer B.
  await withMocks(
    BASE_ENV,
    router({
      customerRow: { user_id: USER_ID },
      stripe: () =>
        reply(
          subscription({ metadata: { supabase_user_id: '22222222-2222-2222-2222-222222222222' } }),
        ),
    }),
    async (calls) => {
      const response = await deliver(event('customer.subscription.updated', subscription()));
      await response.json();
      if (JSON.parse(writes(calls, 'subscriptions')[0].body).user_id !== USER_ID)
        throw new Error('Customer-Zuordnung muss Vorrang vor Metadaten haben');
    },
  );
});

Deno.test(
  'Subscription bei Stripe nicht abrufbar (404): Payload des Events dient als Rückfall',
  async () => {
    await withMocks(
      BASE_ENV,
      router({ stripe: () => reply({ error: { code: 'resource_missing' } }, 404) }),
      async (calls) => {
        const response = await deliver(
          event('customer.subscription.deleted', subscription({ status: 'canceled' })),
        );
        await response.json();
        if (response.status !== 200) throw new Error(String(response.status));
        if (JSON.parse(writes(calls, 'subscriptions')[0].body).status !== 'canceled')
          throw new Error('Rückfall auf Event-Payload fehlt');
      },
    );
  },
);

Deno.test(
  'Irrelevante Events werden bestätigt und vermerkt, ohne Stripe oder Subscriptions anzufassen',
  async () => {
    await withMocks(BASE_ENV, router(), async (calls) => {
      const response = await deliver(event('charge.succeeded', { id: 'ch_1' }));
      await response.json();
      if (response.status !== 200) throw new Error(String(response.status));
      if (writes(calls, 'subscriptions').length) throw new Error('Subscription geschrieben');
      if (calls.some((call) => call.url.includes('stripe.com'))) throw new Error('Stripe-Aufruf');
      if (writes(calls, 'stripe_events').length !== 1) throw new Error('Event nicht vermerkt');
    });
  },
);

Deno.test('Ungültige Subscription-IDs werden nicht in Stripe-URLs eingesetzt', async () => {
  await withMocks(BASE_ENV, router(), async (calls) => {
    const response = await deliver(
      event('customer.subscription.updated', subscription({ id: '../customers/cus_1' })),
    );
    await response.json();
    if (response.status !== 200) throw new Error(String(response.status));
    if (calls.some((call) => call.url.includes('stripe.com')))
      throw new Error('Stripe-Aufruf mit Pfad-Injection');
  });
});
