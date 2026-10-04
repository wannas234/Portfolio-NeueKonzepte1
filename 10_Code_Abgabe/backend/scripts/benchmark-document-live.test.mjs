import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const run = (args, env = {}) =>
  spawnSync(process.execPath, ['scripts/benchmark-document-live.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
test('Benchmark defaults to an offline plan and guards paid execution and remote targets', () => {
  const plan = run(['A']);
  assert.equal(plan.status, 0);
  assert.match(plan.stdout, /"paid_calls_authorized": false/);
  assert.match(plan.stdout, /DOCUMENT_VISUAL_MAX_PAGES=1/);
  const unapproved = run(['A', '--run']);
  assert.notEqual(unapproved.status, 0);
  assert.match(unapproved.stderr, /requires --approve-paid-model-calls/);
  const remote = run(['A', '--run', '--approve-paid-model-calls'], {
    BENCHMARK_SUPABASE_URL: 'https://example.invalid',
  });
  assert.notEqual(remote.status, 0);
  assert.match(remote.stderr, /Only an isolated local Supabase/);
});
