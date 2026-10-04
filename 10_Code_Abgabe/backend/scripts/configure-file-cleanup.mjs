import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from './environment.mjs';
import { planLimits } from './usage-limits.mjs';

// Called only by the deployment jobs, after deploying files-cleanup, documents-process and documents-index.
// Indexing reuses the document-processing Vault URL/key.
// Also pushes supabase/usage-limits.mjs into public.plan_limits on every deploy.
// Capture CLI output: API keys must never reach build logs.
export async function configureCleanup({
  projectRef,
  accessToken,
  run = spawnSync,
  fetcher = fetch,
}) {
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? ''))
    throw new Error('Cleanup deployment configuration missing');
  // Validate before touching the project: a typo must not leave a half-configured deploy.
  const limits = planLimits();
  const env = { ...process.env, ...(accessToken ? { SUPABASE_ACCESS_TOKEN: accessToken } : {}) };
  const result = run(
    `${root}node_modules/.bin/supabase`,
    ['projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'],
    {
      cwd: root,
      env,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) throw new Error('Could not retrieve cleanup credentials');
  let key;
  try {
    key = JSON.parse(result.stdout).find((entry) => entry.name === 'service_role')?.api_key;
  } catch {
    throw new Error('Invalid cleanup credential response');
  }
  if (!key) throw new Error('Legacy service_role key required for cleanup function JWT');
  // CLI requires a regular env file. Restrict access and remove it even on failure.
  const directory = mkdtempSync(join(tmpdir(), 'lernapp-worker-secret-'));
  try {
    const path = join(directory, '.env');
    writeFileSync(path, `WORKER_SERVICE_ROLE_KEY=${key}\n`, { mode: 0o600 });
    const configured = run(
      `${root}node_modules/.bin/supabase`,
      ['secrets', 'set', '--project-ref', projectRef, '--env-file', path],
      { cwd: root, env, encoding: 'utf8' },
    );
    if (configured.status !== 0) throw new Error('Could not configure worker authentication');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const url = `https://${projectRef}.supabase.co`;
  for (const rpc of ['configure_file_cleanup', 'configure_document_processing']) {
    const response = await fetcher(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_api_url: url, p_service_key: key }),
      signal: AbortSignal.timeout(30000),
    });
    await response.arrayBuffer();
    if (!response.ok)
      throw new Error(`Scheduler ${rpc} configuration failed: HTTP ${response.status}`);
  }
  const response = await fetcher(`${url}/rest/v1/rpc/configure_plan_limits`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_limits: limits }),
    signal: AbortSignal.timeout(30000),
  });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`Usage limit configuration failed: HTTP ${response.status}`);
}
if (import.meta.main) {
  try {
    await configureCleanup({
      projectRef: process.env.SUPABASE_PROJECT_REF,
      accessToken: process.env.SUPABASE_ACCESS_TOKEN,
    });
    console.log(
      'File cleanup (15 minutes), document processing and indexing (1 minute) and usage limits configured.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
