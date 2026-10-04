import type { SupabaseClient } from '@supabase/supabase-js';
import { stripeRequest, type FormValue } from './stripe.ts';
import {
  BLOCKING_STATUSES,
  TERMINAL_STATUSES,
  idOf,
  type StripeSubscription,
} from './stripe-subscriptions.ts';

type Session = {
  id: string;
  status: string;
  mode: string;
  url: string | null;
  subscription?: string | { id?: string } | null;
  metadata?: Record<string, string>;
};
type Attempt = {
  id: string;
  parameters: Record<string, FormValue>;
  stripe_session_id: string | null;
  created_at: string;
};

export class CheckoutError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

// Enumerate all pages: an active subscription must not hide behind canceled ones.
async function list<T extends { id: string }>(
  key: string,
  path: string,
  parameters: Record<string, FormValue>,
): Promise<T[]> {
  const result: T[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await stripeRequest<{ data: T[]; has_more?: boolean }>(key, 'GET', path, {
      ...parameters,
      limit: 100,
      starting_after: after,
    });
    result.push(...page.data);
    if (!page.has_more) return result;
    const last = page.data.at(-1)?.id;
    if (!last || last === after) throw new CheckoutError('STRIPE_ERROR', 502);
    after = last;
  }
}

export async function checkoutUrl(
  admin: SupabaseClient,
  key: string,
  userId: string,
  parameters: Record<string, FormValue>,
  requireWaiver: boolean,
): Promise<string> {
  let expired: string | null = null;
  for (let retry = 0; retry < 3; retry++) {
    // Adopt legacy sessions atomically with the reservation, never afterwards:
    // a concurrent caller may already have started creation under the shared key.
    const open = (
      await list<Session>(key, '/checkout/sessions', {
        customer: parameters.customer,
        status: 'open',
      })
    ).filter((s) => s.mode === 'subscription');
    if (open.length > 1) throw new CheckoutError('STRIPE_ERROR', 502);
    const reserved = await admin.rpc('reserve_checkout_attempt', {
      p_user_id: userId,
      p_parameters: parameters,
      p_expired_attempt: expired,
      p_open_session: open[0]?.id ?? null,
    });
    if (reserved.error || !reserved.data?.id) throw new CheckoutError('DATABASE_ERROR', 503);
    const attempt = reserved.data as Attempt;
    const customer = attempt.parameters.customer;
    const subscriptions = await list<StripeSubscription>(key, '/subscriptions', {
      customer,
      status: 'all',
    });
    if (subscriptions.some((s) => BLOCKING_STATUSES.includes(s.status)))
      throw new CheckoutError('ALREADY_SUBSCRIBED', 409);

    let session: Session;
    if (attempt.stripe_session_id) {
      session = await stripeRequest<Session>(
        key,
        'GET',
        `/checkout/sessions/${attempt.stripe_session_id}`,
      );
    } else {
      // Stripe may prune keys after 24h. An ambiguous old attempt must not be
      // retried with a fresh key: reconciliation is required instead.
      if (Date.now() - Date.parse(attempt.created_at) >= 23 * 60 * 60 * 1000)
        throw new CheckoutError('STRIPE_ERROR', 502);
      session = await stripeRequest<Session>(
        key,
        'POST',
        '/checkout/sessions',
        attempt.parameters,
        { idempotencyKey: `uniVerse-checkout-${attempt.id}` },
      );
      if (!/^cs_[A-Za-z0-9_]+$/.test(session.id)) throw new CheckoutError('STRIPE_ERROR', 502);
      const saved = await admin
        .from('checkout_attempts')
        .update({ stripe_session_id: session.id })
        .eq('user_id', userId)
        .eq('id', attempt.id);
      if (saved.error) throw new CheckoutError('DATABASE_ERROR', 503);
    }
    if (session.status === 'expired') {
      expired = attempt.id;
      continue;
    }
    if (session.status === 'complete') {
      // A completed checkout cannot be paid again. Permit a new subscription
      // only when Stripe also confirms that its old subscription has ended.
      const previous = subscriptions.find((s) => s.id === idOf(session.subscription));
      if (previous && TERMINAL_STATUSES.includes(previous.status)) {
        expired = attempt.id;
        continue;
      }
      throw new CheckoutError('ALREADY_SUBSCRIBED', 409);
    }
    if (requireWaiver && !session.metadata?.waiver_accepted_at)
      throw new CheckoutError('WAIVER_REQUIRED', 400);
    if (session.status !== 'open' || !session.url) throw new CheckoutError('STRIPE_ERROR', 502);
    return session.url;
  }
  throw new CheckoutError('SERVICE_UNAVAILABLE', 503);
}
