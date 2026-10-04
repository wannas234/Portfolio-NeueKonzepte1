import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { root } from './environment.mjs';

// Explicitly local Docker targets; no remote URL or credentials accepted.
const project = readFileSync(`${root}supabase/config.toml`, 'utf8').match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
if (!project) throw new Error('Lokale Supabase-Projekt-ID fehlt.');
const runtime = `supabase_edge_runtime_${project}`;
const database = `supabase_db_${project}`;
const inspect = spawnSync('docker', ['inspect', runtime], { encoding: 'utf8' });
if (inspect.status !== 0) throw new Error('Lokaler Edge-Runtime-Container nicht erreichbar.');
const entries = JSON.parse(inspect.stdout)[0].Config.Env;
const env = Object.fromEntries(
  entries.map((entry) => {
    const separator = entry.indexOf('=');
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }),
);
const key = env.WORKER_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error('Lokaler Worker-Service-Key fehlt.');
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const url = `http://supabase_kong_${project}:8000/functions/v1/documents-process`;
const sql = `
begin;
do $configure$
declare secret_id uuid;
begin
  select id into secret_id from vault.secrets where name = 'document_processing_url';
  if secret_id is null then
    perform vault.create_secret(${quote(url)}, 'document_processing_url');
  else
    perform vault.update_secret(secret_id, ${quote(url)});
  end if;
  select id into secret_id from vault.secrets where name = 'document_processing_service_key';
  if secret_id is null then
    perform vault.create_secret(${quote(key)}, 'document_processing_service_key');
  else
    perform vault.update_secret(secret_id, ${quote(key)});
  end if;
end;
$configure$;
commit;
`;
// Credentials only via stdin, never command arguments or printed SQL/error context.
const result = spawnSync(
  'docker',
  ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8' },
);
if (result.status !== 0) throw new Error('Lokale Vault-Konfiguration fehlgeschlagen.');
console.log('Lokale Dokument-Worker konfiguriert. Cron startet fällige Jobs minütlich.');
if (!env.GEMINI_API_KEY)
  console.warn('GEMINI_API_KEY fehlt in der lokalen Runtime; Indexierung ist noch nicht möglich.');
