import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { cliEnvironment, root } from './environment.mjs';

// Ausschließlich der lokale Stack; weder Env-Dateien noch Remote-/Admin-Keys verwenden.
test('Login, RLS, Token-Refresh und Logout gegen Supabase', async () => {
  const status = spawnSync(`${root}node_modules/.bin/supabase`, ['status', '-o', 'json'], {
    cwd: root,
    env: cliEnvironment(),
    encoding: 'utf8',
  });
  assert.equal(status.status, 0, 'Lokalen Stack mit npm run db:start starten');
  const { API_URL: url, ANON_KEY: key } = JSON.parse(status.stdout);
  assert.equal(new URL(url).hostname, '127.0.0.1');
  assert.ok(key, 'Öffentlicher lokaler Key fehlt');

  async function request(path, { token, body, method = 'GET' } = {}) {
    return fetch(`${url}${path}`, {
      method,
      headers: {
        apikey: key,
        'content-type': 'application/json',
        Prefer: 'return=representation',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  }
  const invalid = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: 'anna@example.com', password: 'wrong-password' },
  });
  assert.equal(invalid.status, 400, 'Falsches Passwort wird abgewiesen');
  await invalid.arrayBuffer();
  const anonymous = await request('/rest/v1/profiles?select=id');
  assert.equal(anonymous.status, 401, 'Ohne Login keine Profile');
  await anonymous.arrayBuffer();

  const login = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: 'anna@example.com', password: 'password123' },
  });
  assert.equal(login.status, 200, 'Login erfolgreich');
  let session = await login.json();
  try {
    const me = await request('/functions/v1/me', { token: session.access_token });
    assert.equal(me.status, 200, 'Geschützte Function akzeptiert gültigen Nutzer-JWT');
    assert.equal((await me.json()).profile.id, '11111111-1111-1111-1111-111111111111');
    assert.equal(me.headers.get('cache-control'), 'no-store');
    const forged = await request('/functions/v1/me', { token: 'invalid.jwt.signature' });
    assert.equal(forged.status, 401, 'Geschützte Function weist ungültigen JWT ab');
    await forged.arrayBuffer();
    const profiles = await request('/rest/v1/profiles?select=id', { token: session.access_token });
    assert.equal(profiles.status, 200);
    assert.deepEqual(await profiles.json(), [{ id: '11111111-1111-1111-1111-111111111111' }]);
    const foreign = await request('/rest/v1/profiles?id=eq.22222222-2222-2222-2222-222222222222', {
      method: 'PATCH',
      token: session.access_token,
      body: { name: 'Ben' },
    });
    assert.equal(foreign.status, 200);
    assert.deepEqual(await foreign.json(), [], 'Fremdes Profil wird nicht geändert');
    const own = await request('/rest/v1/profiles?id=eq.11111111-1111-1111-1111-111111111111', {
      method: 'PATCH',
      token: session.access_token,
      body: { name: 'Anna' },
    });
    assert.equal(own.status, 200);
    assert.equal((await own.json()).length, 1, 'Eigenes Profil ist änderbar');
    const refresh = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: session.refresh_token },
    });
    assert.equal(refresh.status, 200, 'Session wird erneuert');
    session = await refresh.json();
    const logout = await request('/auth/v1/logout?scope=local', {
      method: 'POST',
      token: session.access_token,
    });
    assert.equal(logout.status, 204);
    const revoked = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: session.refresh_token },
    });
    assert.equal(revoked.status, 400, 'Logout sperrt den Refresh-Token');
    await revoked.arrayBuffer();
  } finally {
    const cleanup = await request('/auth/v1/logout?scope=local', {
      method: 'POST',
      token: session.access_token,
    });
    await cleanup.arrayBuffer();
  }
});

test('Registrierung erstellt genau ein Profil, auch mit ungültigen Metadaten', async (t) => {
  const status = spawnSync(`${root}node_modules/.bin/supabase`, ['status', '-o', 'json'], {
    cwd: root,
    env: cliEnvironment(),
    encoding: 'utf8',
  });
  assert.equal(status.status, 0, 'Lokalen Stack mit npm run db:start starten');
  const { API_URL: url, ANON_KEY: key, SERVICE_ROLE_KEY: adminKey } = JSON.parse(status.stdout);
  assert.equal(new URL(url).origin, 'http://127.0.0.1:54321');
  assert.ok(key, 'Öffentlicher lokaler Key fehlt');
  assert.ok(adminKey, 'Lokaler Service-Key für Prüfung und Testdatenbereinigung fehlt');

  // Registrierung mit öffentlichem Key. Admin-Zugriffe ausschließlich lokal:
  // Profil vor E-Mail-Bestätigung prüfen und selbst erzeugte Testkonten entfernen.
  async function request(path, { admin = false, method = 'GET', body } = {}) {
    return fetch(`${url}${path}`, {
      method,
      headers: {
        apikey: admin ? adminKey : key,
        Authorization: `Bearer ${admin ? adminKey : key}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  }

  for (const { label, data, name } of [
    { label: 'gültiger Name', data: { display_name: '  Anna  ' }, name: 'Anna' },
    { label: 'fehlender Name', data: {}, name: 'Lernende Person' },
    {
      label: 'ungültiger Name',
      data: { display_name: { invalid: true } },
      name: 'Lernende Person',
    },
  ]) {
    await t.test(label, async () => {
      const signup = await request('/auth/v1/signup', {
        method: 'POST',
        body: { email: `profile-test-${randomUUID()}@example.com`, password: randomUUID(), data },
      });
      assert.equal(signup.status, 200, 'Registrierung erfolgreich');
      const result = await signup.json();
      const user = result.user ?? result;
      assert.match(user.id ?? '', /^[0-9a-f-]{36}$/i, 'Auth-Nutzer wurde erstellt');
      try {
        const response = await request(`/rest/v1/profiles?id=eq.${user.id}&select=*`, {
          admin: true,
        });
        assert.equal(response.status, 200);
        const profiles = await response.json();
        assert.equal(profiles.length, 1, 'Genau ein Profil existiert direkt nach Registrierung');
        const profile = profiles[0];
        assert.equal(profile.id, user.id);
        assert.equal(profile.user_id, user.id);
        assert.equal(profile.name, name);
        assert.equal(profile.avatar_url, null);
        assert.ok(Number.isFinite(Date.parse(profile.created_at)), 'Erstellungszeit vorhanden');
        assert.ok(Number.isFinite(Date.parse(profile.updated_at)), 'Änderungszeit vorhanden');
        assert.equal(
          profile.created_at,
          profile.updated_at,
          'Zeitstempel bei Erstellung identisch',
        );
      } finally {
        const cleanup = await request(`/auth/v1/admin/users/${user.id}`, {
          admin: true,
          method: 'DELETE',
        });
        await cleanup.arrayBuffer();
        assert.equal(cleanup.status, 200, 'Testkonto wird entfernt');
        const remaining = await request(`/rest/v1/profiles?id=eq.${user.id}&select=id`, {
          admin: true,
        });
        assert.equal(remaining.status, 200);
        assert.deepEqual(await remaining.json(), [], 'Profil wird durch Auth-Cascade entfernt');
      }
    });
  }
});
