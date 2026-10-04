// Edge Function `create-checkout-session`: startet den Stripe-Checkout für
// das Abo „UniVerse Pro“ und liefert die Checkout-URL.
//
// Der Client schickt nichts Relevantes: Nutzer kommt aus dem JWT, Preis aus dem
// Secret STRIPE_PRICE_ID, Rücksprung-URLs aus APP_URL. Aus dem Request-Body wird
// allein `waiver_accepted` gelesen. Der Abo-Status wird nie hier gesetzt, das macht
// allein der Webhook `stripe-webhook`.
//
// Widerrufsrecht (§ 356 Abs. 4/5 BGB): Mit `waiver_accepted: true` verlangt der Nutzer
// den sofortigen Leistungsbeginn und bestätigt, dass er damit sein Widerrufsrecht
// verliert. Zeitpunkt (vom Server) und Version des Textes landen als Nachweis in den
// Metadaten von Checkout-Session und Subscription. Pflicht wird die Zustimmung mit
// CHECKOUT_REQUIRE_WAIVER=true, sobald das Frontend die Checkbox mitschickt.

import { createClient } from '@supabase/supabase-js';
import { StripeApiError, appBaseUrl, stripeRequest } from '../_shared/stripe.ts';
import { BLOCKING_STATUSES } from '../_shared/stripe-subscriptions.ts';
import { checkoutUrl, CheckoutError } from '../_shared/checkout.ts';

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'content-type': 'application/json',
  'cache-control': 'no-store',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const fail = (code: string, status: number) => json({ error: { code } }, status);

// Bei einer inhaltlichen Änderung des Zustimmungstexts im Frontend hochzählen.
export const WAIVER_VERSION = '2026-10-04';

// Fehlender oder unlesbarer Body zählt als „keine Zustimmung“, nicht als Fehler.
async function readWaiver(req: Request): Promise<boolean | null> {
  const reader = req.body?.getReader();
  if (!reader) return false;
  const decoder = new TextDecoder();
  let text = '';
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 4096) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode())?.waiver_accepted === true;
  } catch {
    return false;
  }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  const authorization = req.headers.get('authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) return fail('UNAUTHENTICATED', 401);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user) return fail('UNAUTHENTICATED', 401);

    const waiverAccepted = await readWaiver(req);
    if (waiverAccepted === null) return fail('INVALID_REQUEST', 413);
    if (!waiverAccepted && Deno.env.get('CHECKOUT_REQUIRE_WAIVER') === 'true')
      return fail('WAIVER_REQUIRED', 400);

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const priceId = Deno.env.get('STRIPE_PRICE_ID');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const appUrl = appBaseUrl();
    if (!stripeKey || !priceId || !serviceKey || !appUrl) {
      console.error(
        'Stripe-Konfiguration unvollständig (STRIPE_SECRET_KEY, STRIPE_PRICE_ID, APP_URL)',
      );
      return fail('CONFIGURATION_ERROR', 500);
    }

    // Eigene Zeile über RLS lesen.
    const { data: existing, error: readError } = await client
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, status')
      .eq('user_id', user.id)
      .maybeSingle();
    if (readError) return fail('DATABASE_ERROR', 503);
    if (existing?.stripe_subscription_id && BLOCKING_STATUSES.includes(existing.status))
      return fail('ALREADY_SUBSCRIBED', 409);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let customerId: string | null = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      // Der Idempotency-Key verhindert doppelte Customer bei parallelen Klicks.
      const customer = await stripeRequest<{ id: string }>(
        stripeKey,
        'POST',
        '/customers',
        { email: user.email, metadata: { supabase_user_id: user.id } },
        { idempotencyKey: `uniVerse-customer-${user.id}` },
      );
      // Platzhalter-Zeile, damit der Customer wiederverwendet wird und der
      // Webhook das Abo dem Nutzer zuordnen kann. 'incomplete' = noch nicht bezahlt.
      const saved = existing
        ? await admin
            .from('subscriptions')
            .update({ stripe_customer_id: customer.id })
            .eq('user_id', user.id)
            .is('stripe_customer_id', null)
        : await admin
            .from('subscriptions')
            .upsert(
              { user_id: user.id, stripe_customer_id: customer.id, status: 'incomplete' },
              { onConflict: 'user_id', ignoreDuplicates: true },
            );
      if (saved.error) return fail('DATABASE_ERROR', 503);
      // Maßgeblich ist, was in der DB steht (ein paralleler Request kann gewonnen haben).
      const { data: row, error } = await admin
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error || !row?.stripe_customer_id) return fail('DATABASE_ERROR', 503);
      customerId = row.stripe_customer_id;
    }

    const metadata = {
      supabase_user_id: user.id,
      ...(waiverAccepted
        ? { waiver_accepted_at: new Date().toISOString(), waiver_version: WAIVER_VERSION }
        : {}),
    };
    const checkoutParameters = {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/billing/cancel`,
      metadata,
      subscription_data: { metadata },
    };
    const checkout = await checkoutUrl(
      admin,
      stripeKey,
      user.id,
      checkoutParameters,
      Deno.env.get('CHECKOUT_REQUIRE_WAIVER') === 'true',
    );
    return json({ url: checkout });
  } catch (error) {
    if (error instanceof CheckoutError) return fail(error.code, error.status);
    if (error instanceof StripeApiError) {
      console.error(error.message);
      return fail('STRIPE_ERROR', 502);
    }
    return fail('SERVICE_UNAVAILABLE', 503);
  }
}
if (import.meta.main) Deno.serve(handler);
