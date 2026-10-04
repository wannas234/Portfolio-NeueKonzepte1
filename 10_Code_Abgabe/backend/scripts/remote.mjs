import { spawnSync } from 'node:child_process';
import { cliEnvironment, readEnvironment, root } from './environment.mjs';

try {
  const [environment, command, ...extra] = process.argv.slice(2);
  if (command !== 'migrations' || extra.length) {
    throw new Error('Nur migrations ohne zusätzliche Argumente ist erlaubt.');
  }
  const values = readEnvironment(environment);
  console.log(`Migrationsstand ${environment}: ${values.SUPABASE_PROJECT_REF}`);
  const result = spawnSync(
    `${root}node_modules/.bin/supabase`,
    ['migration', 'list', '--project-ref', values.SUPABASE_PROJECT_REF],
    { cwd: root, env: cliEnvironment(values), stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
