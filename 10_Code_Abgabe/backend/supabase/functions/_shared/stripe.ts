// Schlanker Stripe-Zugriff auf Basis von fetch (wie die KI-Anbieter in _shared/,
// ohne SDK) und die Prüfung der Webhook-Signatur. Der Secret Key verlässt nie
// den Server.

const STRIPE_API = 'https://api.stripe.com/v1';

export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(`Stripe-API-Fehler (HTTP ${status}${code ? `, ${code}` : ''})`);
  }
}

export type FormValue =
  string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

// Stripe erwartet application/x-www-form-urlencoded mit Klammer-Notation:
// line_items[0][price]=price_123, metadata[key]=value.
export function encodeForm(params: Record<string, FormValue>): URLSearchParams {
  const form = new URLSearchParams();
  const add = (key: string, value: FormValue) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((item, index) => add(`${key}[${index}]`, item));
    else if (typeof value === 'object')
      for (const [name, item] of Object.entries(value)) add(`${key}[${name}]`, item);
    else form.append(key, String(value));
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return form;
}

export async function stripeRequest<T>(
  secretKey: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Record<string, FormValue> = {},
  options: { idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${secretKey}` };
  const form = encodeForm(params).toString();
  let url = `${STRIPE_API}${path}`;
  let body: string | undefined;
  if (method === 'GET' || method === 'DELETE') {
    if (form) url += `?${form}`;
  } else {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = form;
  }
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new StripeApiError(response.status, payload?.error?.code);
  return payload as T;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// Stripe-Signature: t=<unix>,v1=<hex-hmac>[,v1=...]. Signiert wird
// "<t>.<roher Request-Body>" mit HMAC-SHA256 und dem Webhook-Secret.
// Der Vergleich läuft über crypto.subtle.verify (zeitkonstant); ein zu altes
// oder zu neues Zeitstempel-Datum schützt vor Replay.
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  options: { toleranceSeconds?: number; nowSeconds?: number } = {},
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === 't') timestamp = value;
    else if (name === 'v1') signatures.push(value);
  }
  if (!/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;
  const now = options.nowSeconds ?? Date.now() / 1000;
  if (Math.abs(now - Number(timestamp)) > (options.toleranceSeconds ?? 300)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = encoder.encode(`${timestamp}.${payload}`);
  for (const signature of signatures) {
    const bytes = hexToBytes(signature);
    if (bytes && (await crypto.subtle.verify('HMAC', key, bytes, signed))) return true;
  }
  return false;
}

// Basis-URL der Web-App für Rücksprung-Links. Kommt aus einem Server-Secret,
// nie vom Client (kein Open Redirect über die Checkout-/Portal-Antwort).
export function appBaseUrl(): string | null {
  const value = Deno.env.get('APP_URL');
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}
