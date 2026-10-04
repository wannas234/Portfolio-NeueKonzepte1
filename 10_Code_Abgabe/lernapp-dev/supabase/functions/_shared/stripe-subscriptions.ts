// Reine Logik rund um Stripe-Subscriptions, ohne Netzwerk und Datenbank.

// Eine Subscription in diesen Status existiert bei Stripe weiter und darf nicht
// durch einen zweiten Checkout verdoppelt werden (past_due/unpaid: Zahlung
// über das Kundenportal nachholen).
export const BLOCKING_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'paused',
  'incomplete',
];
export const TERMINAL_STATUSES = ['canceled', 'incomplete_expired'];

export type StripeSubscription = {
  id: string;
  status: string;
  customer?: string | { id?: string } | null;
  cancel_at_period_end?: boolean;
  // Ältere API-Versionen: am Subscription-Objekt, neuere: am Item.
  current_period_end?: number;
  items?: { data?: { price?: { id?: string }; current_period_end?: number }[] };
  metadata?: Record<string, string>;
};

export type SubscriptionFields = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string;
  status: string;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Stripe liefert verknüpfte Objekte je nach Expand als ID oder als Objekt.
export function idOf(value: string | { id?: string } | null | undefined): string | null {
  const id = typeof value === 'string' ? value : value?.id;
  return typeof id === 'string' && id ? id : null;
}

export function toSubscriptionFields(subscription: StripeSubscription): SubscriptionFields {
  const item = subscription.items?.data?.[0];
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;
  return {
    stripe_customer_id: idOf(subscription.customer),
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    price_id: item?.price?.id ?? null,
    current_period_end:
      typeof periodEnd === 'number' ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: subscription.cancel_at_period_end === true,
  };
}

// Verhindert, dass ein verspätetes Event einer alten, beendeten Subscription
// die aktuelle Subscription des Nutzers überschreibt.
export function shouldApply(
  existing: { stripe_subscription_id: string | null; status: string } | null,
  incoming: { stripe_subscription_id: string; status: string },
): boolean {
  if (!existing?.stripe_subscription_id) return true;
  if (existing.stripe_subscription_id === incoming.stripe_subscription_id) return true;
  if (TERMINAL_STATUSES.includes(existing.status)) return true;
  return !TERMINAL_STATUSES.includes(incoming.status);
}
