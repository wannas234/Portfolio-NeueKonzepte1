import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { cliEnvironment, root } from './environment.mjs';
import { planLimitsSql } from './usage-limits.mjs';

// Lokales Gegenstück zu configure-file-cleanup.mjs: Die Configure-RPCs akzeptieren
// nur https://*.supabase.co, und db:reset leert Vault. Ohne diese Einträge laufen
// die Cronjobs erfolgreich, senden aber keinen HTTP-Aufruf an die Worker.
// Spielt außerdem supabase/usage-limits.mjs in public.plan_limits ein.
const secrets = { document_processing: 'documents-process', file_cleanup: 'files-cleanup' };

export function projectId(config) {
  const id = /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m.exec(config)?.[1];
  if (!id) throw new Error('project_id in supabase/config.toml nicht gefunden.');
  return id;
}

export function workerSql(id, key) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Ungültige project_id.');
  // Nur JWT-Zeichen: Der Key wird als SQL-Literal eingebettet.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key ?? '')) {
    throw new Error('Lokaler SERVICE_ROLE_KEY fehlt. Läuft der Stack (npm run db:start)?');
  }
  // Cron läuft im DB-Container und erreicht die Functions über das Docker-Netz.
  const base = `http://supabase_kong_${id}:8000/functions/v1`;
  const values = Object.entries(secrets).flatMap(([name, path]) => [
    [`${name}_url`, `${base}/${path}`],
    [`${name}_service_key`, key],
  ]);
  return `do $$
declare s record; secret_id uuid;
begin
  for s in select * from (values ${values.map(([n, v]) => `('${n}', '${v}')`).join(', ')}) as t(name, value) loop
    select id into secret_id from vault.secrets where name = s.name;
    if secret_id is null then perform vault.create_secret(s.value, s.name);
    else perform vault.update_secret(secret_id, s.value); end if;
  end loop;
end;
$$;
`;
}

export function configureLocalWorkers({ run = spawnSync } = {}) {
  const id = projectId(readFileSync(`${root}supabase/config.toml`, 'utf8'));
  const status = run(`${root}node_modules/.bin/supabase`, ['status', '-o', 'env'], {
    cwd: root,
    env: cliEnvironment(),
    encoding: 'utf8',
  });
  if (status.status !== 0) throw new Error('Lokaler Stack nicht erreichbar (npm run db:start).');
  const key = parseEnv(status.stdout).SERVICE_ROLE_KEY;
  const sql = workerSql(id, key) + planLimitsSql();
  // SQL über stdin, damit der Key nicht in der Prozessliste erscheint.
  const result = run(
    'docker',
    [
      'exec',
      '-i',
      `supabase_db_${id}`,
      'psql',
      '-U',
      'postgres',
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: sql, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `Vault-Konfiguration fehlgeschlagen: ${(result.stderr ?? '').replaceAll(key, '***')}`,
    );
  }
}

if (import.meta.main) {
  try {
    configureLocalWorkers();
    console.log(
      'Lokale Worker-Scheduler (Dokumente, Indexierung, Datei-Cleanup) und Nutzungslimits konfiguriert.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
