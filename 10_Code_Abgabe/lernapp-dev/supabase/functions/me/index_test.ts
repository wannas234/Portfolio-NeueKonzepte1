import { handler } from './index.ts';

Deno.test('Browser-Preflight benötigt keinen JWT und erlaubt die Client-Header', async () => {
  const response = await handler(
    new Request('http://localhost/me', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,apikey,content-type,x-client-info',
      },
    }),
  );
  if (response.status !== 204) throw new Error(`Preflight: ${response.status}`);
  if (response.headers.get('access-control-allow-origin') !== '*') throw new Error('Origin fehlt');
  for (const header of ['authorization', 'apikey', 'content-type', 'x-client-info']) {
    if (!response.headers.get('access-control-allow-headers')?.includes(header)) {
      throw new Error(`Header fehlt: ${header}`);
    }
  }
});

Deno.test('Fehlender JWT bleibt 401 und ist für den Browser lesbar', async () => {
  const response = await handler(new Request('http://localhost/me'));
  if (response.status !== 401) throw new Error('Nicht authentifizierter Zugriff wurde zugelassen');
  if (!response.headers.has('access-control-allow-origin'))
    throw new Error('CORS bei Fehler fehlt');
  if (response.headers.get('cache-control') !== 'no-store')
    throw new Error('Auth-Antwort darf nicht gecacht werden');
  await response.json();
});

Deno.test('Ungültiges Authorization-Schema wird ohne Datenbankzugriff abgewiesen', async () => {
  for (const authorization of ['Basic abc', 'Bearer ', 'Bearer one two']) {
    const response = await handler(
      new Request('http://localhost/me', {
        headers: { Authorization: authorization },
      }),
    );
    if (response.status !== 401) throw new Error('Ungültiger Header wurde akzeptiert');
    await response.json();
  }
});

Deno.test('Nicht unterstützte HTTP-Methoden werden abgewiesen', async () => {
  const response = await handler(new Request('http://localhost/me', { method: 'DELETE' }));
  if (response.status !== 405) throw new Error('DELETE wurde nicht abgewiesen');
  await response.json();
});
