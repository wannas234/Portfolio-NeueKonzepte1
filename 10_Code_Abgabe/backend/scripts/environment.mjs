import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

export function readEnvironment(name) {
  if (!['development', 'production'].includes(name)) {
    throw new Error('Umgebung muss development oder production sein.');
  }
  // Kein Shell-source: Passwörter mit $ oder Backticks bleiben wörtliche Werte.
  const values = parseEnv(readFileSync(`${root}.env.${name}`, 'utf8'));
  if (!/^[a-z]{20}$/.test(values.SUPABASE_PROJECT_REF ?? '')) {
    throw new Error(`Gültige SUPABASE_PROJECT_REF in .env.${name} erforderlich.`);
  }
  return values;
}

export function cliEnvironment(values = {}) {
  // Geerbte CLI-Ziele und Profile dürfen die explizite Auswahl nicht verändern.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('SUPABASE_')),
  );
  for (const key of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']) {
    if (values[key]) env[key] = values[key];
  }
  return env;
}
