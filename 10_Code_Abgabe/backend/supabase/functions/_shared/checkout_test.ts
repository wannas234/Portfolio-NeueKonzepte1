import { createClient } from '@supabase/supabase-js';
import { checkoutUrl, CheckoutError } from './checkout.ts';
import { BASE_ENV, USER_ID, withMocks, reply, isRest, isStripe, form } from './testing/stripe.ts';

const parameters = {
  customer: 'cus_1',
  mode: 'subscription',
  metadata: { waiver_accepted_at: '2026-10-04' },
};
const client = () =>
  createClient(BASE_ENV.SUPABASE_URL, BASE_ENV.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

Deno.test(
  'Concurrent checkouts, lost responses and retries share immutable Stripe parameters',
  async () => {
    let attempt: {
      id: string;
      parameters: unknown;
      stripe_session_id: string | null;
      created_at: string;
    } | null = null;
    let generation = 0;
    let loseResponse = true;
    const subscriptions: { id: string; status: string }[] = [];
    const stripe = new Map<
      string,
      {
        body: string;
        session: {
          id: string;
          status: string;
          subscription?: string;
          mode: string;
          url: string;
          metadata: { waiver_accepted_at: string };
        };
      }
    >();
    await withMocks(
      BASE_ENV,
      (call) => {
        if (isRest(call, 'rpc/reserve_checkout_attempt', 'POST')) {
          const body = JSON.parse(call.body);
          if (!attempt || (attempt.id === body.p_expired_attempt && attempt.stripe_session_id))
            attempt = {
              id: `attempt-${++generation}`,
              parameters: body.p_parameters,
              stripe_session_id: null,
              created_at: new Date().toISOString(),
            };
          return reply(attempt);
        }
        if (isRest(call, 'checkout_attempts', 'PATCH')) {
          attempt!.stripe_session_id = JSON.parse(call.body).stripe_session_id;
          return reply(null);
        }
        if (isStripe(call, 'GET', '/subscriptions')) return reply({ data: subscriptions });
        // Simulate list visibility lag and a lost HTTP response. Only Stripe's
        // idempotency key can protect these concurrent requests, not a list check.
        if (isStripe(call, 'GET', '/checkout/sessions')) return reply({ data: [] });
        if (isStripe(call, 'POST', '/checkout/sessions')) {
          const key = call.headers.get('idempotency-key');
          if (!key) throw new Error('Missing Stripe key');
          if (stripe.has(key) && stripe.get(key)!.body !== call.body)
            throw new Error('Payload drift');
          if (!stripe.has(key))
            stripe.set(key, {
              body: call.body,
              session: {
                id: `cs_${stripe.size + 1}`,
                status: 'open',
                mode: 'subscription',
                url: `https://checkout.stripe.test/${stripe.size + 1}`,
                metadata: { waiver_accepted_at: form(call)['metadata[waiver_accepted_at]'] },
              },
            });
          if (loseResponse) {
            loseResponse = false;
            throw new Error('Lost response after Stripe creation');
          }
          return reply(stripe.get(key)!.session);
        }
        const session = [...stripe.values()].find((v) =>
          isStripe(call, 'GET', `/checkout/sessions/${v.session.id}`),
        );
        if (session) return reply(session.session);
        return undefined;
      },
      async () => {
        const results = await Promise.allSettled([
          checkoutUrl(client(), 'key', USER_ID, parameters, true),
          checkoutUrl(
            client(),
            'key',
            USER_ID,
            { ...parameters, metadata: { waiver_accepted_at: 'later' } },
            true,
          ),
        ]);
        if (!results.some((r) => r.status === 'fulfilled') || stripe.size !== 1)
          throw new Error('Duplicate session');
        const resumed = await checkoutUrl(client(), 'key', USER_ID, parameters, true);
        if (resumed !== 'https://checkout.stripe.test/1' || stripe.size !== 1)
          throw new Error('Retry created checkout');
        stripe.values().next().value!.session.status = 'complete';
        try {
          await checkoutUrl(client(), 'key', USER_ID, parameters, true);
          throw new Error('Completed session reused');
        } catch (e) {
          if (!(e instanceof CheckoutError) || e.code !== 'ALREADY_SUBSCRIBED') throw e;
        }
        stripe.values().next().value!.session.subscription = 'sub_old';
        subscriptions.push({ id: 'sub_old', status: 'canceled' });
        const renewed = await Promise.all([
          checkoutUrl(client(), 'key', USER_ID, parameters, true),
          checkoutUrl(client(), 'key', USER_ID, parameters, true),
        ]);
        if (new Set(renewed).size !== 1 || Number(stripe.size) !== 2 || generation !== 2)
          throw new Error('Ended subscription must rotate exactly once');
        [...stripe.values()].at(-1)!.session.status = 'expired';
        const afterExpiry = await checkoutUrl(client(), 'key', USER_ID, parameters, true);
        if (!afterExpiry.endsWith('/3') || Number(stripe.size) !== 3)
          throw new Error('Expired session did not rotate');
      },
    );
  },
);

Deno.test(
  'Existing open checkouts are reused; ambiguous legacy and old attempts fail closed',
  async () => {
    for (const scenario of ['legacy', 'multiple', 'old', 'database', 'active_later_page']) {
      let pages = 0;
      await withMocks(
        BASE_ENV,
        (call) => {
          if (isRest(call, 'rpc/reserve_checkout_attempt', 'POST'))
            return scenario === 'database'
              ? reply({ message: 'unavailable' }, 503)
              : reply({
                  id: 'attempt',
                  parameters,
                  stripe_session_id: scenario === 'legacy' ? 'cs_0' : null,
                  created_at:
                    scenario === 'old' ? '2000-01-01T00:00:00Z' : new Date().toISOString(),
                });
          if (isRest(call, 'checkout_attempts', 'PATCH')) return reply(null);
          if (isStripe(call, 'GET', '/checkout/sessions/cs_0'))
            return reply({
              id: 'cs_0',
              status: 'open',
              mode: 'subscription',
              url: 'https://checkout.stripe.test/legacy',
              metadata: parameters.metadata,
            });
          if (isStripe(call, 'GET', '/subscriptions')) {
            pages++;
            return reply(
              scenario === 'active_later_page'
                ? {
                    data: [{ id: `sub_${pages}`, status: pages === 1 ? 'canceled' : 'active' }],
                    has_more: pages === 1,
                  }
                : { data: [] },
            );
          }
          if (isStripe(call, 'GET', '/checkout/sessions'))
            return reply({
              data:
                scenario === 'old'
                  ? []
                  : Array.from({ length: scenario === 'multiple' ? 2 : 1 }, (_, i) => ({
                      id: `cs_${i}`,
                      status: 'open',
                      mode: 'subscription',
                      url: 'https://checkout.stripe.test/legacy',
                      metadata: parameters.metadata,
                    })),
            });
          return undefined;
        },
        async (calls) => {
          try {
            const url = await checkoutUrl(client(), 'key', USER_ID, parameters, true);
            if (scenario !== 'legacy' || !url.endsWith('/legacy'))
              throw new Error('Expected rejection');
          } catch (e) {
            if (scenario === 'legacy' || !(e instanceof CheckoutError)) throw e;
          }
          if (calls.some((c) => isStripe(c, 'POST', '/checkout/sessions')))
            throw new Error('Unsafe checkout');
          if (scenario === 'active_later_page' && pages !== 2)
            throw new Error('Pagination missing');
        },
      );
    }
  },
);
