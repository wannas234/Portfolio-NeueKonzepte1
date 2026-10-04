import { handler } from './index.ts';
import {
  BASE_ENV,
  USER_ID,
  isAuthUser,
  isRest,
  isStripe,
  reply,
  withMocks,
  type Call,
} from '../_shared/testing/stripe.ts';

const request = (body?: unknown) =>
  new Request('http://localhost/delete-account', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const valid = { password: 'richtig123', confirm: 'LÖSCHEN' };

const path = (call: Call) => new URL(call.url).pathname;
const isSignIn = (call: Call) => call.method === 'POST' && path(call) === '/auth/v1/token';
const isList = (call: Call) => path(call) === '/storage/v1/object/list/learning-files';
const isRemove = (call: Call) =>
  call.method === 'DELETE' && path(call) === '/storage/v1/object/learning-files';
const isDeleteUser = (call: Call) =>
  call.method === 'DELETE' && path(call) === `/auth/v1/admin/users/${USER_ID}`;

const session = (id: string) => ({
  access_token: 'new',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'r',
  user: { id, email: 'anna@example.com' },
});

type Options = {
  customer?: string | null;
  subscriptions?: { id: string; status: string }[];
  sessions?: string[];
  objects?: Record<string, { name: string; id: string | null }[]>;
  password?: string;
};

const router =
  ({
    customer = 'cus_own',
    subscriptions = [
      { id: 'sub_active', status: 'active' },
      { id: 'sub_old', status: 'canceled' },
    ],
    sessions = ['cs_open'],
    objects = {
      [USER_ID]: [{ name: 'course-1', id: null }],
      [`${USER_ID}/course-1`]: [
        { name: 'f1.pdf', id: 'o1' },
        { name: 'f2.pdf', id: 'o2' },
      ],
    },
    password = 'richtig123',
  }: Options = {}) =>
  (call: Call) => {
    if (isAuthUser(call)) return reply({ id: USER_ID, email: 'anna@example.com' });
    if (isSignIn(call))
      return JSON.parse(call.body).password === password
        ? reply(session(USER_ID))
        : reply({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 400);
    if (isRest(call, 'subscriptions', 'GET'))
      return reply(customer ? [{ stripe_customer_id: customer }] : []);
    if (isStripe(call, 'GET', '/checkout/sessions'))
      return reply({ data: sessions.map((id) => ({ id })) });
    if (call.method === 'POST' && /^\/v1\/checkout\/sessions\/cs_\w+\/expire$/.test(path(call)))
      return reply({ status: 'expired' });
    if (isStripe(call, 'GET', '/subscriptions')) return reply({ data: subscriptions });
    if (call.method === 'DELETE' && /^\/v1\/subscriptions\/sub_\w+$/.test(path(call)))
      return reply({ status: 'canceled' });
    if (isList(call)) return reply(objects[JSON.parse(call.body).prefix] ?? []);
    if (isRemove(call)) return reply([]);
    if (isDeleteUser(call)) return reply({});
    return undefined;
  };

Deno.test('Preflight, fehlender JWT und falsche Methode', async () => {
  const preflight = await handler(new Request('http://localhost/x', { method: 'OPTIONS' }));
  if (preflight.status !== 204) throw new Error('Preflight');
  for (const authorization of [undefined, 'Basic abc', 'Bearer ']) {
    const response = await handler(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: authorization ? { Authorization: authorization } : {},
      }),
    );
    if (response.status !== 401) throw new Error(`Ungültiger Header: ${authorization}`);
    await response.json();
  }
  const get = await handler(new Request('http://localhost/x'));
  if (get.status !== 405) throw new Error('GET zugelassen');
  await get.json();
});

Deno.test('Ohne Bestätigungstext oder mit falschem Passwort wird nichts gelöscht', async () => {
  for (const [body, status, code] of [
    [undefined, 400, 'INVALID_REQUEST'],
    [{ confirm: 'LÖSCHEN' }, 400, 'INVALID_REQUEST'],
    [{ password: 'richtig123', confirm: 'löschen' }, 400, 'CONFIRMATION_REQUIRED'],
    [{ password: 'falsch', confirm: 'LÖSCHEN' }, 403, 'INVALID_PASSWORD'],
  ] as const) {
    await withMocks(BASE_ENV, router(), async (calls) => {
      const response = await handler(request(body));
      const result = await response.json();
      if (response.status !== status || result.error.code !== code)
        throw new Error(`${JSON.stringify(body)} → ${response.status} ${result.error?.code}`);
      if (
        calls.some(
          (call) => call.url.includes('stripe.com') || isRemove(call) || isDeleteUser(call),
        )
      )
        throw new Error('Seiteneffekt ohne gültige Bestätigung');
    });
  }
});

Deno.test('Reihenfolge: Stripe, dann Storage, dann Auth-Nutzer', async () => {
  await withMocks(BASE_ENV, router(), async (calls) => {
    const response = await handler(request(valid));
    const body = await response.json();
    if (response.status !== 200 || body.deleted !== true) throw new Error(String(response.status));
    const index = (predicate: (call: Call) => boolean) => calls.findIndex(predicate);
    const expire = index((call) => path(call) === '/v1/checkout/sessions/cs_open/expire');
    const cancel = index(
      (call) => call.method === 'DELETE' && path(call) === '/v1/subscriptions/sub_active',
    );
    const remove = index(isRemove);
    const deleteUser = index(isDeleteUser);
    if (!(expire >= 0 && expire < cancel && cancel < remove && remove < deleteUser))
      throw new Error(`Reihenfolge: ${expire} ${cancel} ${remove} ${deleteUser}`);
    if (calls.some((call) => path(call) === '/v1/subscriptions/sub_old'))
      throw new Error('Beendetes Abo erneut gekündigt');
    const removed = JSON.parse(calls[remove].body).prefixes;
    if (removed.join() !== `${USER_ID}/course-1/f1.pdf,${USER_ID}/course-1/f2.pdf`)
      throw new Error(`Objekte: ${removed}`);
    // Storage und Löschen laufen mit dem Service-Key, die Prüfung ohne Nutzer-JWT.
    if (calls[deleteUser].headers.get('authorization') !== 'Bearer service')
      throw new Error('Admin-Client');
    const signIn = calls.find(isSignIn)!;
    if (signIn.headers.get('authorization') === 'Bearer user-token')
      throw new Error('Passwortprüfung mit Nutzer-JWT');
  });
});

Deno.test('Stripe-Fehler bricht vor Storage und Auth ab', async () => {
  await withMocks(
    BASE_ENV,
    (call) =>
      call.method === 'DELETE' && path(call).startsWith('/v1/subscriptions/')
        ? reply({ error: { code: 'api_error', message: 'sk_test_secret' } }, 500)
        : router()(call),
    async (calls) => {
      const response = await handler(request(valid));
      const text = await response.text();
      if (response.status !== 502 || text.includes('sk_test')) throw new Error(text);
      if (calls.some((call) => isList(call) || isRemove(call) || isDeleteUser(call)))
        throw new Error('Gelöscht trotz Stripe-Fehler');
    },
  );
});

Deno.test('Ohne Stripe-Customer und ohne Dateien wird direkt gelöscht', async () => {
  await withMocks(
    { ...BASE_ENV, STRIPE_SECRET_KEY: undefined },
    router({ customer: null, objects: {} }),
    async (calls) => {
      const response = await handler(request(valid));
      if (response.status !== 200) throw new Error(String(response.status));
      await response.json();
      if (calls.some((call) => call.url.includes('stripe.com') || isRemove(call)))
        throw new Error('Unnötiger Aufruf');
      if (!calls.some(isDeleteUser)) throw new Error('Nicht gelöscht');
    },
  );
});

Deno.test('Customer ohne Stripe-Key wird nicht gelöscht', async () => {
  await withMocks({ ...BASE_ENV, STRIPE_SECRET_KEY: undefined }, router(), async (calls) => {
    const response = await handler(request(valid));
    const body = await response.json();
    if (response.status !== 500 || body.error.code !== 'CONFIGURATION_ERROR')
      throw new Error(String(response.status));
    if (calls.some(isDeleteUser)) throw new Error('Gelöscht');
  });
});

Deno.test(
  'Storage- und Auth-Fehler liefern 503, Storage-Fehler verhindert das Löschen',
  async () => {
    await withMocks(
      BASE_ENV,
      (call) => (isRemove(call) ? reply({ message: 'boom' }, 500) : router()(call)),
      async (calls) => {
        const response = await handler(request(valid));
        const body = await response.json();
        if (response.status !== 503 || body.error.code !== 'STORAGE_ERROR')
          throw new Error(String(response.status));
        if (calls.some(isDeleteUser)) throw new Error('Gelöscht trotz Storage-Fehler');
      },
    );
    await withMocks(
      BASE_ENV,
      (call) => (isDeleteUser(call) ? reply({ msg: 'boom' }, 500) : router()(call)),
      async () => {
        const response = await handler(request(valid));
        const body = await response.json();
        if (response.status !== 503 || body.error.code !== 'DELETE_FAILED')
          throw new Error(String(response.status));
      },
    );
  },
);

Deno.test('Storage-Listing blättert seitenweise', async () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ name: `f${i}.pdf`, id: `o${i}` }));
  await withMocks(
    BASE_ENV,
    (call) => {
      if (isList(call)) {
        const { prefix, offset } = JSON.parse(call.body);
        if (prefix === USER_ID) return reply([{ name: 'c', id: null }]);
        return reply(offset === 0 ? many : [{ name: 'last.pdf', id: 'x' }]);
      }
      return router({ customer: null })(call);
    },
    async (calls) => {
      const response = await handler(request(valid));
      if (response.status !== 200) throw new Error(String(response.status));
      await response.json();
      const removed = calls
        .filter(isRemove)
        .flatMap((call) => JSON.parse(call.body).prefixes as string[]);
      if (removed.length !== 1001 || !removed.includes(`${USER_ID}/c/last.pdf`))
        throw new Error(`Entfernt: ${removed.length}`);
      if (calls.filter(isRemove).some((call) => JSON.parse(call.body).prefixes.length > 100))
        throw new Error('Batch zu groß');
    },
  );
});
