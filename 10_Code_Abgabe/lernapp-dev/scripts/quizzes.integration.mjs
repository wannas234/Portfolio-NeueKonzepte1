import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { cliEnvironment, root } from './environment.mjs';

test('Quiz HTTP handlers, real local PostgreSQL and deterministic AI provider', () => {
  const status = spawnSync(`${root}node_modules/.bin/supabase`, ['status', '-o', 'json'], {
    cwd: root,
    env: cliEnvironment(),
    encoding: 'utf8',
  });
  assert.equal(status.status, 0, 'Local Supabase must be running');
  const { API_URL, SERVICE_ROLE_KEY, ANON_KEY } = JSON.parse(status.stdout);
  assert.equal(new URL(API_URL).hostname, '127.0.0.1');
  const result = spawnSync(
    `${root}node_modules/.bin/deno`,
    [
      'test',
      '--allow-env',
      '--allow-net=127.0.0.1',
      '--config',
      'supabase/functions/deno.json',
      'scripts/quizzes.integration.ts',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: API_URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
        WORKER_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
        SUPABASE_ANON_KEY: ANON_KEY,
        ANSWER_PROVIDER: 'openai',
        OPENAI_API_KEY: 'deterministic-test-only',
        SUMMARY_MODEL: 'deterministic-test-only',
      },
    },
  );
  // No keys in child output; assertions use public status codes and fixed text.
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
