// Test-Hilfen für die Stripe-Functions: Env setzen, fetch abfangen, Webhooks signieren.

export type Call = { method: string; url: string; body: string; headers: Headers };
export type Router = (call: Call) => Response | Promise<Response> | undefined;

export const BASE_ENV = {
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  STRIPE_SECRET_KEY: 'sk_test_secret',
  STRIPE_PRICE_ID: 'price_server',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  APP_URL: 'https://app.test/',
};

export const USER_ID = '11111111-1111-1111-1111-111111111111';

export async function withMocks(
  env: Record<string, string | undefined>,
  router: Router,
  run: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  const previous = Object.keys(env).map((name) => [name, Deno.env.get(name)] as const);
  for (const [name, value] of Object.entries(env))
    value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
  const calls: Call[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const call = {
      method: request.method,
      url: request.url,
      body: await request.text(),
      headers: request.headers,
    };
    calls.push(call);
    const response = await router(call);
    if (!response) throw new Error(`Unerwartete Anfrage ${call.method} ${call.url}`);
    return response;
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
    for (const [name, value] of previous)
      value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
  }
}

export const reply = (value: unknown, status = 200) => Response.json(value, { status });
export const isRest = (call: Call, table: string, method: string) =>
  call.method === method && new URL(call.url).pathname === `/rest/v1/${table}`;
export const isStripe = (call: Call, method: string, path: string) =>
  call.method === method && new URL(call.url).pathname === `/v1${path}`;
export const isAuthUser = (call: Call) => new URL(call.url).pathname === '/auth/v1/user';
export const form = (call: Call) => Object.fromEntries(new URLSearchParams(call.body));

export async function sign(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}
