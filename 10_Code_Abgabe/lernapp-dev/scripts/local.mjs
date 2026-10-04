import { spawnSync } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import { cliEnvironment, root } from './environment.mjs';
import { configureLocalWorkers } from './configure-local-workers.mjs';

export function localArgs(command, extra) {
  const commands = {
    start: ['start'],
    stop: ['stop'],
    status: ['status'],
    reset: ['db', 'reset', '--local'],
    apply: ['migration', 'up', '--local'],
    lint: ['db', 'lint', '--local', '--level', 'warning', '--fail-on', 'warning'],
    test: ['test', 'db', '--local'],
    types: ['gen', 'types', 'typescript', '--local'],
    serve: ['functions', 'serve'],
    new: ['migration', 'new'],
    diff: ['db', 'diff', '--local'],
  };
  if (!Object.hasOwn(commands, command)) throw new Error('Unbekannter lokaler Befehl.');
  if (command === 'new' || command === 'diff') {
    if (extra.length !== 1 || !/^[a-z][a-z0-9_]*$/.test(extra[0])) {
      throw new Error('Genau einen Migrationsnamen angeben, z. B. lernkarten_tabelle.');
    }
    return [...commands[command], ...(command === 'diff' ? ['-f'] : []), extra[0]];
  }
  if (extra.length) throw new Error('Dieser Befehl akzeptiert keine zusätzlichen Argumente.');
  return commands[command];
}

if (import.meta.main) {
  try {
    const args = localArgs(process.argv[2], process.argv.slice(3));
    const result = spawnSync(`${root}node_modules/.bin/supabase`, args, {
      cwd: root,
      // CLI 2.116 requires the local password for the postgres-meta type generator.
      env: cliEnvironment(process.argv[2] === 'types' ? { SUPABASE_DB_PASSWORD: 'postgres' } : {}),
      stdio: process.argv[2] === 'types' ? ['inherit', 'pipe', 'inherit'] : 'inherit',
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (process.argv[2] === 'types' && result.status === 0) {
      const target = `${root}types/database.types.ts`;
      const temporary = `${target}.${process.pid}.tmp`;
      writeFileSync(temporary, result.stdout);
      renameSync(temporary, target);
    }
    // Frische Datenbanken haben leeren Vault; ohne Einträge rufen die Cronjobs keine Worker auf.
    if (['start', 'reset'].includes(process.argv[2]) && result.status === 0) {
      configureLocalWorkers();
      console.log('Lokale Worker-Scheduler konfiguriert.');
    }
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
