// Edge Function `delete-account`: Recht auf Löschung (Art. 17 DSGVO).
//
// Reihenfolge, jeder Schritt bricht bei einem Fehler ab:
// 1. JWT prüfen, dazu Passwort und Bestätigungstext. Ein gestohlenes Token reicht nicht.
// 2. Stripe: offene Checkouts verfallen lassen und alle nicht beendeten Abos sofort
//    kündigen. Scheitert das, wird nichts gelöscht, damit niemand ohne Konto weiterzahlt.
//    Der Customer bleibt bestehen (Rechnungen unterliegen der Aufbewahrungspflicht).
// 3. Storage: alles unter learning-files/<uid>/ entfernen, auch verwaiste Uploads.
// 4. Auth-Nutzer löschen. Der Rest läuft per Cascade; der Trigger auf public.files legt
//    dabei Cleanup-Jobs für bereits entfernte Objekte an, die files-cleanup als erledigt
//    verbucht.
// Ein erneuter Aufruf nach einem Fehler setzt beim fehlgeschlagenen Schritt wieder auf,
// weil bereits gekündigte Abos und gelöschte Objekte übersprungen werden.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { StripeApiError, stripeRequest } from '../_shared/stripe.ts';
import { TERMINAL_STATUSES, type StripeSubscription } from '../_shared/stripe-subscriptions.ts';

export const CONFIRMATION_TEXT = 'LÖSCHEN';
const BUCKET = 'learning-files';
const LIST_PAGE = 1000;
const REMOVE_BATCH = 100;
const MAX_DEPTH = 3;

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

class StepError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
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
    const body = JSON.parse(text + decoder.decode());
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

async function cancelStripe(admin: SupabaseClient, stripeKey: string | undefined, userId: string) {
  const { data: row, error } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new StepError('DATABASE_ERROR', 503);
  const customer = row?.stripe_customer_id;
  if (!customer) return;
  if (!stripeKey) {
    console.error('STRIPE_SECRET_KEY fehlt, Konto mit Stripe-Customer nicht löschbar');
    throw new StepError('CONFIGURATION_ERROR', 500);
  }
  // Ein offener Checkout könnte sonst nach dem Löschen noch ein Abo anlegen.
  const sessions = await stripeRequest<{ data: { id: string }[] }>(
    stripeKey,
    'GET',
    '/checkout/sessions',
    { customer, status: 'open', limit: 100 },
  );
  for (const session of sessions.data)
    await stripeRequest(stripeKey, 'POST', `/checkout/sessions/${session.id}/expire`);
  const subscriptions = await stripeRequest<{ data: StripeSubscription[] }>(
    stripeKey,
    'GET',
    '/subscriptions',
    { customer, status: 'all', limit: 100 },
  );
  for (const subscription of subscriptions.data) {
    if (TERMINAL_STATUSES.includes(subscription.status)) continue;
    await stripeRequest(stripeKey, 'DELETE', `/subscriptions/${subscription.id}`);
  }
}

// Sammelt rekursiv alle Objektpfade unter dem Präfix (Ordner haben keine id).
async function listObjects(admin: SupabaseClient, prefix: string, depth = 0): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new StepError('STORAGE_ERROR', 503);
    for (const entry of data) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) paths.push(path);
      else if (depth < MAX_DEPTH) paths.push(...(await listObjects(admin, path, depth + 1)));
    }
    if (data.length < LIST_PAGE) return paths;
  }
}

async function removeStorage(admin: SupabaseClient, userId: string) {
  const paths = await listObjects(admin, userId);
  for (let start = 0; start < paths.length; start += REMOVE_BATCH) {
    const { error } = await admin.storage
      .from(BUCKET)
      .remove(paths.slice(start, start + REMOVE_BATCH));
    if (error) throw new StepError('STORAGE_ERROR', 503);
  }
  return paths.length;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  const authorization = req.headers.get('authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) return fail('UNAUTHENTICATED', 401);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user) return fail('UNAUTHENTICATED', 401);

    const body = await readJson(req);
    if (!body || typeof body.password !== 'string' || !body.password || body.password.length > 1024)
      return fail('INVALID_REQUEST', 400);
    if (body.confirm !== CONFIRMATION_TEXT) return fail('CONFIRMATION_REQUIRED', 400);
    if (!user.email) return fail('PASSWORD_REQUIRED', 409);

    // Eigener Client ohne Nutzer-JWT, damit die Prüfung keine fremde Session berührt.
    const verifier = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signIn, error: signInError } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: body.password,
    });
    if (signInError?.status === 429) return fail('RATE_LIMITED', 429);
    if (signInError || signIn.user?.id !== user.id) return fail('INVALID_PASSWORD', 403);

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY fehlt');
      return fail('CONFIGURATION_ERROR', 500);
    }
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await cancelStripe(admin, Deno.env.get('STRIPE_SECRET_KEY'), user.id);
    const removedObjects = await removeStorage(admin, user.id);
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw new StepError('DELETE_FAILED', 503);

    console.log(JSON.stringify({ event: 'account_deleted', removed_objects: removedObjects }));
    return json({ deleted: true });
  } catch (error) {
    if (error instanceof StepError) return fail(error.code, error.status);
    if (error instanceof StripeApiError) {
      console.error(error.message);
      return fail('STRIPE_ERROR', 502);
    }
    return fail('SERVICE_UNAVAILABLE', 503);
  }
}
if (import.meta.main) Deno.serve(handler);
