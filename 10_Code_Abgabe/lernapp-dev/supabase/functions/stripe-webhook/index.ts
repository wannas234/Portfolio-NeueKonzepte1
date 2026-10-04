// Edge Function `stripe-webhook`: Source of Truth für den Abo-Status.
//
// Stripe ruft den Endpoint ohne Nutzer-JWT auf (config.toml: verify_jwt = false).
// Die Authentizität kommt allein aus der Stripe-Signatur über den ROHEN Body und
// STRIPE_WEBHOOK_SECRET. Ohne gültige Signatur wird nichts gelesen oder geschrieben.
//
// Reihenfolge-/Wiederholungssicherheit:
// - Zustand wird bei jedem Event frisch von Stripe geladen (statt dem Payload zu
//   vertrauen). Verspätete oder doppelte Events schreiben damit stets den
//   aktuellen Stand.
// - `stripe_events` merkt sich verarbeitete Events. Die Zeile wird erst NACH
//   erfolgreicher Verarbeitung geschrieben; bei einem Fehler antworten wir 500
//   und Stripe liefert erneut.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { StripeApiError, stripeRequest, verifyStripeSignature } from '../_shared/stripe.ts';
import {
  idOf,
  isUuid,
  shouldApply,
  toSubscriptionFields,
  type StripeSubscription,
} from '../_shared/stripe-subscriptions.ts';

const MAX_BODY_BYTES = 1_000_000;
const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const fail = (code: string, status: number) => json({ error: { code } }, status);

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

async function readBody(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

type Context = { admin: SupabaseClient; stripeKey: string };

// Lädt die Subscription frisch von Stripe und schreibt sie für den passenden Nutzer.
async function syncSubscription(
  ctx: Context,
  input: {
    subscriptionId: string | null;
    customerId: string | null;
    userId: string | null;
    fallback?: StripeSubscription;
  },
): Promise<void> {
  if (!input.subscriptionId || !/^sub_[A-Za-z0-9]+$/.test(input.subscriptionId)) return;
  let subscription: StripeSubscription;
  try {
    subscription = await stripeRequest<StripeSubscription>(
      ctx.stripeKey,
      'GET',
      `/subscriptions/${input.subscriptionId}`,
    );
  } catch (error) {
    if (error instanceof StripeApiError && error.status === 404 && input.fallback)
      subscription = input.fallback;
    else throw error;
  }
  const fields = toSubscriptionFields(subscription);
  const customerId = fields.stripe_customer_id ?? input.customerId;

  // Zuordnung: bekannter Customer in der DB, sonst die von uns gesetzte User-ID.
  let userId: string | null = null;
  if (customerId) {
    const { data, error } = await ctx.admin
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (error) throw error;
    userId = data?.user_id ?? null;
  }
  userId ??= [input.userId, subscription.metadata?.supabase_user_id].find(isUuid) ?? null;
  if (!userId) {
    console.warn(`Subscription ${subscription.id} keinem Nutzer zuordenbar, ignoriert`);
    return;
  }

  const { data: existing, error: readError } = await ctx.admin
    .from('subscriptions')
    .select('stripe_subscription_id, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (readError) throw readError;
  if (!shouldApply(existing, fields)) {
    console.warn(`Event zu beendeter Alt-Subscription ${subscription.id} ignoriert`);
    return;
  }

  const { error } = await ctx.admin
    .from('subscriptions')
    .upsert(
      { ...fields, stripe_customer_id: customerId, user_id: userId },
      { onConflict: 'user_id' },
    );
  // 23503: Nutzer inzwischen gelöscht (delete-account). Erneutes Zustellen hilft nicht.
  if (error?.code === '23503') {
    console.warn(`Subscription ${subscription.id} gehört zu gelöschtem Konto, ignoriert`);
    return;
  }
  if (error) throw error;
}

async function processEvent(ctx: Context, event: StripeEvent): Promise<void> {
  const object = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      if (object.mode !== 'subscription') return;
      const metadata = object.metadata as Record<string, string> | undefined;
      return await syncSubscription(ctx, {
        subscriptionId: idOf(object.subscription as string | { id?: string } | null),
        customerId: idOf(object.customer as string | { id?: string } | null),
        userId: [object.client_reference_id, metadata?.supabase_user_id].find(isUuid) ?? null,
      });
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      const subscription = object as unknown as StripeSubscription;
      return await syncSubscription(ctx, {
        subscriptionId: subscription.id,
        customerId: idOf(subscription.customer),
        userId: null,
        fallback: subscription,
      });
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      // Neue API-Versionen: invoice.parent.subscription_details.subscription.
      const parent = object.parent as
        { subscription_details?: { subscription?: string | { id?: string } } } | undefined;
      return await syncSubscription(ctx, {
        subscriptionId: idOf(
          (object.subscription as string | { id?: string } | undefined) ??
            parent?.subscription_details?.subscription,
        ),
        customerId: idOf(object.customer as string | { id?: string } | null),
        userId: null,
      });
    }
    default:
      return; // Nicht relevant: bestätigen, damit Stripe nicht erneut sendet.
  }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET fehlt');
    return fail('WEBHOOK_NOT_CONFIGURED', 500);
  }
  try {
    const raw = await readBody(req);
    if (raw === null) return fail('PAYLOAD_TOO_LARGE', 413);
    if (!(await verifyStripeSignature(raw, req.headers.get('stripe-signature'), secret)))
      return fail('INVALID_SIGNATURE', 400);

    let event: StripeEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      return fail('INVALID_REQUEST', 400);
    }
    if (
      typeof event?.id !== 'string' ||
      typeof event.type !== 'string' ||
      !event.data?.object ||
      typeof event.data.object !== 'object'
    )
      return fail('INVALID_REQUEST', 400);

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!stripeKey || !serviceKey) {
      console.error('STRIPE_SECRET_KEY oder SUPABASE_SERVICE_ROLE_KEY fehlt');
      return fail('CONFIGURATION_ERROR', 500);
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const seen = await admin
      .from('stripe_events')
      .select('event_id')
      .eq('event_id', event.id)
      .maybeSingle();
    if (seen.error) throw seen.error;
    if (seen.data) return json({ received: true, duplicate: true });

    await processEvent({ admin, stripeKey }, event);

    const recorded = await admin
      .from('stripe_events')
      .upsert(
        { event_id: event.id, event_type: event.type },
        { onConflict: 'event_id', ignoreDuplicates: true },
      );
    if (recorded.error) throw recorded.error;
    return json({ received: true });
  } catch (error) {
    // 5xx: Stripe wiederholt die Zustellung mit Backoff.
    console.error(
      'Webhook-Verarbeitung fehlgeschlagen',
      error instanceof Error ? error.message : error,
    );
    return fail('PROCESSING_FAILED', 500);
  }
}
if (import.meta.main) Deno.serve(handler);
