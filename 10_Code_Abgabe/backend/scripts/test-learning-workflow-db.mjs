// Requires Docker already running. Never mutates the source/development DB.
// Schema only; no user data, vault secrets or cron.job rows are copied.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
const target = 'lernapp-learning-test';
const source = process.env.LEARNING_SCHEMA_SOURCE ?? 'supabase_db_lernapp';
if (source === target) throw new Error('Source must differ from isolated target');
const docker = (args, input) =>
  execFileSync('docker', args, { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const sql = (input) =>
  docker(
    [
      'exec',
      '-i',
      target,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
    ],
    input,
  );
const existing = spawnSync('docker', ['inspect', target], { encoding: 'utf8' });
if (existing.status !== 0) {
  const image = docker(['inspect', '--format', '{{.Config.Image}}', source]).trim();
  docker([
    'run',
    '-d',
    '--name',
    target,
    '--network',
    'none',
    '-e',
    'POSTGRES_PASSWORD=postgres',
    image,
  ]);
}
const inspect = JSON.parse(docker(['inspect', target]))[0];
if (inspect.HostConfig.NetworkMode !== 'none') throw new Error('Test DB must use --network none');
if (!inspect.State.Running) docker(['start', target]);
// During first-start init the entrypoint runs a temporary socket-only server while
// the image's migrate.sh creates roles and event triggers. Probing TCP waits for the
// final server, so the snapshot replay cannot race the image initialisation.
let ready = false;
for (let attempt = 0; attempt < 120; attempt++) {
  if (
    spawnSync('docker', ['exec', target, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], {
      stdio: 'ignore',
    }).status === 0
  ) {
    ready = true;
    break;
  }
  await setTimeout(1000);
}
if (!ready) throw new Error('Isolated test database did not become ready');

sql(
  "do $$ begin if not exists(select 1 from pg_roles where rolname='supabase_functions_admin') then create role supabase_functions_admin; end if; end $$;",
);
// Recreate only the isolated test schema; omit unrelated partitioned Realtime tables.
const schema = docker([
  'exec',
  source,
  'pg_dump',
  '-U',
  'postgres',
  '--schema-only',
  '--clean',
  '--if-exists',
  '--no-owner',
  '--exclude-schema=realtime',
  // pg_graphql owns dependencies of graphql_public.graphql; replaying its
  // DROP FUNCTION before DROP EXTENSION fails on stacks with GraphQL enabled.
  // GraphQL is unrelated to application SQL tests and stays in the test image.
  '--exclude-schema=graphql_public',
]);
sql(
  'drop schema if exists embedding_archive cascade; drop schema public cascade; create schema public authorization postgres;',
);
sql(schema);
// Keep only Supabase infrastructure from the snapshot; recreate application schema
// from the checkout, so local branch drift and copied ACL defaults cannot affect tests.
sql(`drop schema if exists embedding_archive cascade; drop schema public cascade; create schema public authorization postgres;
 grant usage on schema public to anon,authenticated,service_role;
 grant all on schema public to postgres,service_role;
 alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
 alter default privileges for role supabase_admin revoke execute on functions from anon,authenticated;
 alter default privileges for role supabase_admin in schema public revoke execute on functions from anon,authenticated;
 alter default privileges for role supabase_admin in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges for role supabase_admin in schema public grant all on sequences to anon,authenticated,service_role;`);
for (const name of readdirSync('supabase/migrations')
  .filter((n) => n.endsWith('.sql'))
  .sort()) {
  sql(readFileSync(`supabase/migrations/${name}`, 'utf8'));
}
sql(readFileSync('supabase/seed.sql', 'utf8'));
let assertions = 0;
for (const file of [
  'learning_workflow',
  'generated_summaries',
  'quiz_generation',
  'checkout_attempts',
]) {
  const output = sql(readFileSync(`supabase/tests/database/${file}.test.sql`, 'utf8'));
  if (/not ok|Looks like you failed|ERROR:/.test(output)) throw new Error(`${file}\n${output}`);
  const count = (output.match(/^ok \d+/gm) ?? []).length;
  assertions += count;
  console.log(`${file}: ${count} passed`);
}
const result = spawnSync(
  process.execPath,
  [
    '--test',
    'scripts/learning-workflow-concurrency.test.mjs',
    'scripts/checkout-concurrency.test.mjs',
  ],
  { env: { ...process.env, LEARNING_DB_TEST: '1' }, stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  `${assertions} SQL assertions passed; test data rolled back/removed. Container retained for inspection.`,
);
