import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cliEnvironment } from './environment.mjs';
import { localArgs } from './local.mjs';
import { projectId, workerSql } from './configure-local-workers.mjs';
import { resolveConfig, syncAuth } from './auth-config.mjs';

test('Lokale Datenbankbefehle erzwingen ihr Ziel', () => {
  for (const command of ['reset', 'apply', 'lint', 'test', 'types']) {
    assert.ok(localArgs(command, []).includes('--local'));
  }
  for (const command of ['reset', 'start', 'stop', 'status', 'types', 'serve', 'test']) {
    for (const flag of [
      '--linked',
      '--project-ref=abcdefghijklmnopqrst',
      '--db-url=postgres://remote',
    ]) {
      assert.throws(() => localArgs(command, [flag]));
    }
  }
  assert.throws(() => localArgs('push', []));
  assert.throws(() => localArgs('new', ['--linked']));
  assert.throws(() => localArgs('diff', ['table', '--linked']));
  assert.deepEqual(localArgs('diff', ['lernkarten']), [
    'db',
    'diff',
    '--local',
    '-f',
    'lernkarten',
  ]);
  assert.ok(localArgs('lint', []).includes('--fail-on'));
});

test('Geerbte Supabase-Ziele und Credentials werden nicht übernommen', (t) => {
  const old = process.env.SUPABASE_PROJECT_REF;
  process.env.SUPABASE_PROJECT_REF = 'falsches-projekt';
  t.after(() => {
    if (old === undefined) delete process.env.SUPABASE_PROJECT_REF;
    else process.env.SUPABASE_PROJECT_REF = old;
  });
  const env = cliEnvironment({ SUPABASE_ACCESS_TOKEN: 'aus-der-env-datei' });
  assert.equal(env.SUPABASE_PROJECT_REF, undefined);
  assert.equal(env.SUPABASE_ACCESS_TOKEN, 'aus-der-env-datei');
});

test('Auth-Konfiguration validiert Felder, Typen, Secrets und Produktions-URLs', () => {
  assert.throws(() => resolveConfig({ unknown: true }, {}, 'development'));
  assert.throws(() => resolveConfig({ disable_signup: 'false' }, {}, 'development'));
  assert.throws(() => resolveConfig({ smtp_pass: 'nicht-ins-repo' }, {}, 'development'));
  assert.throws(() => resolveConfig({ smtp_pass: 'env(SMTP_PASS)' }, {}, 'development'));
  assert.throws(() => resolveConfig({ site_url: 'http://localhost:3000' }, {}, 'production'));
  assert.deepEqual(
    resolveConfig({ smtp_pass: 'env(SMTP_PASS)' }, { SMTP_PASS: '$literal`' }, 'development'),
    {
      smtp_pass: '$literal`',
    },
  );
});

const values = {
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  SUPABASE_ACCESS_TOKEN: 'test-token',
};
function fakeApi(states, status = 200) {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, ...options });
      return Response.json(states.shift() ?? {}, { status });
    },
  };
}
const base = { environment: 'development', values, desired: { disable_signup: true } };

test('Plan liest nur; leere Konfiguration benötigt keinen Request', async () => {
  const api = fakeApi([{ disable_signup: false }]);
  await syncAuth({
    ...base,
    ...api,
    mode: 'plan',
    confirm: () => assert.fail('Keine Bestätigung im Plan'),
  });
  assert.deepEqual(
    api.calls.map((c) => c.method),
    ['GET'],
  );
  assert.equal(
    api.calls[0].url,
    'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth',
  );
  await syncAuth({ ...base, desired: {}, ...api, mode: 'push' });
  assert.equal(api.calls.length, 1);
});

test('Abgelehnte Bestätigung verhindert Schreiben', async () => {
  const api = fakeApi([{ disable_signup: false }]);
  await assert.rejects(
    syncAuth({ ...base, ...api, mode: 'push', confirm: async () => false }),
    /Abgebrochen/,
  );
  assert.deepEqual(
    api.calls.map((c) => c.method),
    ['GET'],
  );
});

test('Push überträgt nur geänderte, ausdrücklich ausgewählte Felder', async () => {
  const current = { disable_signup: false, jwt_exp: 3600, site_url: 'https://bestehend.example' };
  const api = fakeApi([current, current, {}]);
  await syncAuth({
    ...base,
    ...api,
    desired: { disable_signup: true, jwt_exp: 3600 },
    mode: 'push',
    confirm: async (name) => {
      assert.equal(name, 'development');
      return true;
    },
  });
  assert.deepEqual(
    api.calls.map((c) => c.method),
    ['GET', 'GET', 'PATCH'],
  );
  assert.deepEqual(JSON.parse(api.calls[2].body), { disable_signup: true });
});

test('Zwischenzeitliche Änderung stoppt den Push', async () => {
  const api = fakeApi([{ disable_signup: false }, { disable_signup: true }]);
  await assert.rejects(
    syncAuth({ ...base, ...api, mode: 'push', confirm: async () => true }),
    /inzwischen/,
  );
  assert.deepEqual(
    api.calls.map((c) => c.method),
    ['GET', 'GET'],
  );
});

test('API-Fehler werden nicht als Erfolg behandelt oder mit Secret-Inhalt ausgegeben', async () => {
  const api = fakeApi([{ message: 'geheimes-passwort' }], 403);
  await assert.rejects(syncAuth({ ...base, ...api, mode: 'push', confirm: async () => true }), {
    message: 'Auth-Konfiguration: HTTP 403 (GET).',
  });
});

test('Lokale Worker-Konfiguration zielt auf das Docker-Netz und prüft den Key', () => {
  assert.equal(projectId('[x]\nproject_id = "lernapp"\n'), 'lernapp');
  assert.throws(() => projectId('name = "x"'));
  const key = 'aaa.bbb.ccc';
  const sql = workerSql('lernapp', key);
  assert.match(
    sql,
    /'document_processing_url', 'http:\/\/supabase_kong_lernapp:8000\/functions\/v1\/documents-process'/,
  );
  assert.match(
    sql,
    /'file_cleanup_url', 'http:\/\/supabase_kong_lernapp:8000\/functions\/v1\/files-cleanup'/,
  );
  assert.match(sql, /'document_processing_service_key', 'aaa\.bbb\.ccc'/);
  for (const bad of [undefined, '', "a.b.c'; drop table x; --", 'kein-jwt']) {
    assert.throws(() => workerSql('lernapp', bad));
  }
  assert.throws(() => workerSql("x'; --", key));
});
