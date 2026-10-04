import { idOf, isUuid, shouldApply, toSubscriptionFields } from './stripe-subscriptions.ts';

Deno.test('toSubscriptionFields liest den Zeitraum aus altem und neuem API-Format', () => {
  const old = toSubscriptionFields({
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    current_period_end: 1_800_000_000,
    cancel_at_period_end: true,
    items: { data: [{ price: { id: 'price_1' } }] },
  });
  const current = toSubscriptionFields({
    id: 'sub_1',
    status: 'trialing',
    customer: { id: 'cus_1' },
    items: { data: [{ price: { id: 'price_1' }, current_period_end: 1_800_000_000 }] },
  });
  if (old.current_period_end !== '2027-01-15T08:00:00.000Z') throw new Error(String(old));
  if (current.current_period_end !== old.current_period_end) throw new Error('Neues Format');
  if (!old.cancel_at_period_end || current.cancel_at_period_end)
    throw new Error('cancel_at_period_end falsch');
  if (old.stripe_customer_id !== 'cus_1' || current.stripe_customer_id !== 'cus_1')
    throw new Error('Customer-ID');
  if (old.price_id !== 'price_1' || old.status !== 'active') throw new Error('Felder');

  const bare = toSubscriptionFields({ id: 'sub_2', status: 'canceled' });
  if (
    bare.current_period_end !== null ||
    bare.price_id !== null ||
    bare.stripe_customer_id !== null
  )
    throw new Error('Fehlende Felder müssen null sein');
});

Deno.test('shouldApply schützt die aktuelle Subscription vor Events alter Subscriptions', () => {
  const live = { stripe_subscription_id: 'sub_new', status: 'active' };
  const checks: [string, boolean, Parameters<typeof shouldApply>][] = [
    ['keine Zeile', true, [null, { stripe_subscription_id: 'sub_1', status: 'active' }]],
    [
      'Platzhalter ohne Subscription',
      true,
      [
        { stripe_subscription_id: null, status: 'incomplete' },
        { stripe_subscription_id: 'sub_1', status: 'active' },
      ],
    ],
    [
      'gleiche Subscription',
      true,
      [live, { stripe_subscription_id: 'sub_new', status: 'canceled' }],
    ],
    [
      'alte beendete Subscription',
      false,
      [live, { stripe_subscription_id: 'sub_old', status: 'canceled' }],
    ],
    [
      'alte abgelaufene Subscription',
      false,
      [live, { stripe_subscription_id: 'sub_old', status: 'incomplete_expired' }],
    ],
    [
      'neue Subscription nach beendeter',
      true,
      [
        { stripe_subscription_id: 'sub_old', status: 'canceled' },
        { stripe_subscription_id: 'sub_new', status: 'active' },
      ],
    ],
  ];
  for (const [name, expected, args] of checks)
    if (shouldApply(...args) !== expected) throw new Error(name);
});

Deno.test('idOf und isUuid', () => {
  if (idOf('cus_1') !== 'cus_1' || idOf({ id: 'cus_2' }) !== 'cus_2') throw new Error('idOf');
  if (idOf(null) !== null || idOf(undefined) !== null || idOf({}) !== null || idOf('') !== null)
    throw new Error('idOf leer');
  if (!isUuid('11111111-1111-1111-1111-111111111111')) throw new Error('UUID');
  for (const bad of ['', 'x', 123, null, "11111111-1111-1111-1111-11111111111'; drop"])
    if (isUuid(bad)) throw new Error(`Ungültige UUID akzeptiert: ${bad}`);
});
