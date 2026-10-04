import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { configureCleanup } from './configure-file-cleanup.mjs';
import { planLimits } from './usage-limits.mjs';

test('Cleanup deploy validates target and keeps credentials out of errors', async () => {
  await assert.rejects(
    configureCleanup({ projectRef: 'invalid', accessToken: 'token' }),
    /configuration missing/,
  );
  const secretPaths = [];
  const options = {
    projectRef: 'abcdefghijklmnopqrst',
    accessToken: 'token',
    run: (_command, args, config) => {
      assert.ok(!args.join(' ').includes('private-key'));
      if (args.includes('secrets')) {
        assert.equal(args[2], '--project-ref');
        assert.equal(args[3], 'abcdefghijklmnopqrst');
        const path = args[5];
        secretPaths.push(path);
        assert.equal(readFileSync(path, 'utf8'), 'WORKER_SERVICE_ROLE_KEY=private-key\n');
        assert.equal(statSync(path).mode & 0o777, 0o600);
        return { status: 0 };
      }
      return {
        status: 0,
        stdout: JSON.stringify([{ name: 'service_role', api_key: 'private-key' }]),
      };
    },
  };
  const configured = [];
  await assert.rejects(
    configureCleanup({
      ...options,
      run: (command, args, config) => {
        const result = options.run(command, args, config);
        return args.includes('secrets') ? { status: 1, stderr: 'private-key' } : result;
      },
      fetcher: () => {
        throw new Error('Vault must not change when secret provisioning fails');
      },
    }),
    { message: 'Could not configure worker authentication' },
  );
  assert.ok(secretPaths.every((path) => !existsSync(path)));
  await configureCleanup({
    ...options,
    fetcher: async (url, request) => {
      configured.push(url);
      assert.equal(request.headers.Authorization, 'Bearer private-key');
      if (url.endsWith('/rpc/configure_plan_limits')) {
        assert.deepEqual(JSON.parse(request.body), { p_limits: planLimits() });
        return new Response(null, { status: 204 });
      }
      assert.ok(
        ['configure_file_cleanup', 'configure_document_processing'].some(
          (rpc) => url === `https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/${rpc}`,
        ),
      );
      assert.equal(JSON.parse(request.body).p_service_key, 'private-key');
      return new Response(null, { status: 204 });
    },
  });
  assert.ok(secretPaths.every((path) => !existsSync(path)));
  assert.deepEqual(
    configured,
    ['configure_file_cleanup', 'configure_document_processing', 'configure_plan_limits'].map(
      (rpc) => `https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/${rpc}`,
    ),
  );
  await assert.rejects(
    configureCleanup({
      ...options,
      fetcher: async () => new Response('private-key', { status: 500 }),
    }),
    { message: 'Scheduler configure_file_cleanup configuration failed: HTTP 500' },
  );
  await assert.rejects(
    configureCleanup({
      ...options,
      fetcher: async (url) =>
        new Response(null, {
          status: url.endsWith('configure_document_processing') ? 503 : 204,
        }),
    }),
    { message: 'Scheduler configure_document_processing configuration failed: HTTP 503' },
  );
  await assert.rejects(
    configureCleanup({
      ...options,
      fetcher: async (url) =>
        new Response(null, { status: url.endsWith('configure_plan_limits') ? 400 : 204 }),
    }),
    { message: 'Usage limit configuration failed: HTTP 400' },
  );
});
