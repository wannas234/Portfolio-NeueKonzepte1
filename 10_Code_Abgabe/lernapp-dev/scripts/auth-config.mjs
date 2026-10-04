import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { readEnvironment, root } from './environment.mjs';

// Bewusst begrenzter Umfang. Neue Felder anhand der Management-API ergänzen.
const fields = {
  site_url: 'string',
  uri_allow_list: 'string',
  disable_signup: 'boolean',
  external_email_enabled: 'boolean',
  external_anonymous_users_enabled: 'boolean',
  mailer_autoconfirm: 'boolean',
  mailer_secure_email_change_enabled: 'boolean',
  security_update_password_require_reauthentication: 'boolean',
  password_min_length: 'number',
  password_required_characters: 'string',
  jwt_exp: 'number',
  external_google_enabled: 'boolean',
  external_google_client_id: 'string',
  external_google_secret: 'string',
  external_github_enabled: 'boolean',
  external_github_client_id: 'string',
  external_github_secret: 'string',
  smtp_host: 'string',
  smtp_port: 'string',
  smtp_user: 'string',
  smtp_pass: 'string',
  smtp_admin_email: 'string',
  smtp_sender_name: 'string',
  mailer_subjects_confirmation: 'string',
  mailer_subjects_recovery: 'string',
  mailer_templates_confirmation_content: 'string',
  mailer_templates_recovery_content: 'string',
  mailer_subjects_email_change: 'string',
  mailer_templates_email_change_content: 'string',
  mailer_notifications_password_changed_enabled: 'boolean',
  mailer_subjects_password_changed_notification: 'string',
  mailer_templates_password_changed_notification_content: 'string',
  mailer_notifications_email_changed_enabled: 'boolean',
  mailer_subjects_email_changed_notification: 'string',
  mailer_templates_email_changed_notification_content: 'string',
};
// Versionierte Vorlagen unter supabase/templates/; der Name bestimmt das Auth-Feld.
export const templates = [
  'confirmation',
  'recovery',
  'email_change',
  'password_changed_notification',
  'email_changed_notification',
];
const isSecret = (key) => /secret|smtp_pass/.test(key);

// Eine Basisadresse pro Umgebung; zusätzliche Redirects sind optional.
export function authUrls(site, additional = '', environment = 'development') {
  if (!site?.trim()) throw new Error('AUTH_SITE_URL fehlt in der Env-Datei.');
  const url = new URL(site);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    /[*?{}\[\]]/.test(url.hostname)
  ) {
    throw new Error('AUTH_SITE_URL muss eine Basisadresse ohne Pfad, Query oder Wildcards sein.');
  }
  const redirects = ['/auth/callback', '/auth/confirm', '/auth/reset-password'].map(
    (path) => new URL(path, url).href,
  );
  redirects.push(
    ...additional
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const result = { site_url: url.origin, uri_allow_list: [...new Set(redirects)].join(',') };
  // Dieselben Regeln für automatisch erzeugte und explizite URLs.
  return resolveConfig(result, {}, environment);
}

export function loadAuthConfig(environment, values) {
  if (!['development', 'production'].includes(environment)) throw new Error('Ungültige Umgebung.');
  const config = JSON.parse(
    readFileSync(`${root}supabase/environments/${environment}.auth.json`, 'utf8'),
  );
  // Lokales Feature-Flag, kein Feld der Supabase Management API.
  // Zugangsdaten alleine aktivieren SMTP nicht; das gilt für beide Umgebungen.
  const smtpEnabled = values.AUTH_SMTP_ENABLED?.trim() || 'false';
  if (!['true', 'false'].includes(smtpEnabled)) {
    throw new Error('AUTH_SMTP_ENABLED muss true oder false sein.');
  }
  if (smtpEnabled === 'true') {
    for (const suffix of ['HOST', 'PORT', 'USER', 'PASS', 'ADMIN_EMAIL', 'SENDER_NAME']) {
      config[`smtp_${suffix.toLowerCase()}`] = `env(AUTH_SMTP_${suffix})`;
    }
  }
  return resolveConfig(config, values, environment);
}

export function resolveConfig(config, values, environment) {
  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error('Auth-Konfiguration muss ein JSON-Objekt sein.');
  }
  // Die bestehende env(AUTH_REDIRECT_URLS)-Referenz bleibt kompatibel, wird aber
  // standardmäßig aus AUTH_SITE_URL ergänzt, statt eine zweite Pflichtvariable zu sein.
  if (config.uri_allow_list === 'env(AUTH_REDIRECT_URLS)') {
    const urls = authUrls(values.AUTH_SITE_URL, values.AUTH_REDIRECT_URLS, environment);
    values = { ...values, AUTH_SITE_URL: urls.site_url, AUTH_REDIRECT_URLS: urls.uri_allow_list };
  }
  return Object.fromEntries(
    Object.entries(config).map(([key, input]) => {
      if (!Object.hasOwn(fields, key)) throw new Error(`Nicht unterstütztes Auth-Feld: ${key}`);
      const variable = typeof input === 'string' && /^env\(([A-Z][A-Z0-9_]*)\)$/.exec(input);
      if (isSecret(key) && !variable) {
        throw new Error(`${key} muss eine env(NAME)-Referenz sein.`);
      }
      const template = typeof input === 'string' && /^template\(([a-z_]+)\)$/.exec(input);
      if (template && !templates.includes(template[1])) {
        throw new Error(`Unbekannte E-Mail-Vorlage: ${template[1]}`);
      }
      if (template && key !== `mailer_templates_${template[1]}_content`) {
        throw new Error('E-Mail-Vorlage passt nicht zum Auth-Feld.');
      }
      const value = template
        ? readFileSync(`${root}supabase/templates/${template[1]}.html`, 'utf8')
        : variable
          ? values[variable[1]]
          : input;
      if (typeof value !== fields[key]) throw new Error(`Ungültiger oder fehlender Wert: ${key}`);
      if (fields[key] === 'number' && (!Number.isInteger(value) || value < 1)) {
        throw new Error(`${key} muss eine positive ganze Zahl sein.`);
      }
      if (variable && value === '') throw new Error(`Leere Umgebungsvariable für ${key}.`);
      if (key === 'site_url' || key === 'uri_allow_list') {
        for (const address of key === 'site_url' ? [value] : value.split(',').filter(Boolean)) {
          const url = new URL(address.trim());
          if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.hash
          ) {
            throw new Error(`Ungültige Web-URL in ${key}.`);
          }
          if (
            environment === 'production' &&
            (url.protocol !== 'https:' ||
              /^(localhost\.?|127\..*|\[::1\])$/.test(url.hostname) ||
              /[*?{}\[\]]/.test(address))
          ) {
            throw new Error(`Produktion benötigt öffentliche HTTPS-URLs in ${key}.`);
          }
        }
      }
      return [key, value];
    }),
  );
}

export function changesFor(current, desired) {
  return Object.fromEntries(
    Object.entries(desired).filter(([key, value]) => current[key] !== value),
  );
}

export async function syncAuth({ environment, mode, values, desired, request = fetch, confirm }) {
  if (!['plan', 'push'].includes(mode)) throw new Error('Modus muss plan oder push sein.');
  if (!values.SUPABASE_ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN fehlt.');
  const url = `https://api.supabase.com/v1/projects/${values.SUPABASE_PROJECT_REF}/config/auth`;
  const headers = {
    Authorization: `Bearer ${values.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
  async function call(method, body) {
    const response = await request(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    // API-Fehlertexte können eingegebene Secrets enthalten: nicht ausgeben.
    if (!response.ok) throw new Error(`Auth-Konfiguration: HTTP ${response.status} (${method}).`);
    return response.json();
  }
  if (!Object.keys(desired).length) {
    console.log('Keine Auth-Felder konfiguriert; nichts zu übertragen.');
    return;
  }
  const current = await call('GET');
  const changes = changesFor(current, desired);
  console.log(`Auth-Konfiguration → ${environment} (${values.SUPABASE_PROJECT_REF})`);
  for (const [key, value] of Object.entries(changes)) {
    console.log(
      isSecret(key)
        ? `${key}: [geheim] → [geheim; API-Werte können maskiert sein]`
        : `${key}: ${JSON.stringify(current[key])} → ${JSON.stringify(value)}`,
    );
  }
  if (!Object.keys(changes).length) {
    console.log('Keine Änderungen.');
    return;
  }
  if (mode === 'plan') return;
  if (!(await confirm(environment))) throw new Error('Abgebrochen; keine Änderungen übertragen.');
  // Zwischen Vorschau und Bestätigung könnten Dashboard-Änderungen erfolgt sein.
  const latest = await call('GET');
  if (Object.keys(desired).some((key) => current[key] !== latest[key])) {
    throw new Error('Remote-Konfiguration wurde inzwischen geändert. Bitte erneut planen.');
  }
  await call('PATCH', changes);
  console.log('Angezeigte Auth-Änderungen übertragen.');
}

if (import.meta.main) {
  try {
    const [environment, mode, ...extra] = process.argv.slice(2);
    if (extra.length || !['plan', 'push'].includes(mode))
      throw new Error('Aufruf: Umgebung plan|push');
    const values = readEnvironment(environment);
    const desired = loadAuthConfig(environment, values);
    if (!Object.hasOwn(desired, 'smtp_host')) {
      console.log(
        'Eigene SMTP-Konfiguration deaktiviert; vorhandene Remote-Mailkonfiguration bleibt unverändert.',
      );
    }
    await syncAuth({
      environment,
      mode,
      values,
      desired,
      confirm: async (name) => {
        if (!process.stdin.isTTY) throw new Error('Auth-Push benötigt ein interaktives Terminal.');
        const terminal = createInterface({ input: process.stdin, output: process.stdout });
        try {
          return (await terminal.question(`Zum Übertragen '${name}' eintippen: `)) === name;
        } finally {
          terminal.close();
        }
      },
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
