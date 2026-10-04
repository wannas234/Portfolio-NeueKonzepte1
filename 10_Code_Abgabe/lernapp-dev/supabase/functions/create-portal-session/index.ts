// Edge Function `create-portal-session`: öffnet das Stripe-Kundenportal
// (Kündigen, Zahlungsmittel, Rechnungen) für den angemeldeten Nutzer.
//
// Den Stripe-Customer liefert ausschließlich die eigene Zeile in
// `subscriptions` (per RLS gelesen). Der Client kann keinen Customer vorgeben.

import { createClient } from '@supabase/supabase-js';
import { StripeApiError, appBaseUrl, stripeRequest } from '../_shared/stripe.ts';

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

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  const authorization = req.headers.get('authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) return fail('UNAUTHENTICATED', 401);
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user) return fail('UNAUTHENTICATED', 401);

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const appUrl = appBaseUrl();
    if (!stripeKey || !appUrl) {
      console.error('Stripe-Konfiguration unvollständig (STRIPE_SECRET_KEY, APP_URL)');
      return fail('CONFIGURATION_ERROR', 500);
    }

    const { data: subscription, error } = await client
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return fail('DATABASE_ERROR', 503);
    if (!subscription?.stripe_customer_id) return fail('NO_SUBSCRIPTION', 404);

    const session = await stripeRequest<{ url?: string }>(
      stripeKey,
      'POST',
      '/billing_portal/sessions',
      { customer: subscription.stripe_customer_id, return_url: `${appUrl}/billing` },
    );
    if (!session.url) return fail('STRIPE_ERROR', 502);
    return json({ url: session.url });
  } catch (error) {
    if (error instanceof StripeApiError) {
      console.error(error.message);
      return fail('STRIPE_ERROR', 502);
    }
    return fail('SERVICE_UNAVAILABLE', 503);
  }
}
if (import.meta.main) Deno.serve(handler);
