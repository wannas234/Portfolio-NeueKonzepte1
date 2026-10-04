import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { authUrls, loadAuthConfig, resolveConfig, templates } from './auth-config.mjs';

test('Eine Site-URL erzeugt alle Auth-Routen und normalisiert den abschließenden Slash', () => {
  assert.deepEqual(authUrls('https://lernapp.example/'), {
    site_url: 'https://lernapp.example',
    uri_allow_list:
      'https://lernapp.example/auth/callback,https://lernapp.example/auth/confirm,https://lernapp.example/auth/reset-password',
  });
  assert.match(authUrls('http://localhost:3000').uri_allow_list, /localhost:3000\/auth\/confirm/);
});

test('Optionale Redirects ergänzen die Pflicht-Routen ohne Duplikate', () => {
  const result = authUrls(
    'https://lernapp.example',
    ' https://lernapp.example/auth/confirm, http://localhost:3000/** ',
  );
  assert.equal(result.uri_allow_list.split(',').length, 4);
  assert.ok(result.uri_allow_list.endsWith('http://localhost:3000/**'));
});

test('Fehlende oder unsichere Basisadressen scheitern vor jedem API-Aufruf', () => {
  for (const address of [
    undefined,
    '',
    'https://example.com/path',
    'https://example.com/?next=evil',
    'https://example.com/#x',
    'https://user:pass@example.com',
    'https://*.example.com',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => authUrls(address));
  }
  for (const address of [
    'http://example.com',
    'https://localhost',
    'https://127.1',
    'https://[::1]',
  ]) {
    assert.throws(() => authUrls(address, '', 'production'));
  }
  assert.throws(() => authUrls('https://example.com', 'https://*.example.com/**', 'production'));
});

test('Versionierte Konfiguration benötigt keine zweite Domain-Variable und lädt echte Vorlagen', () => {
  const config = loadAuthConfig('development', { AUTH_SITE_URL: 'https://stage.example/' });
  assert.equal(config.site_url, 'https://stage.example');
  assert.match(config.uri_allow_list, /stage.example\/auth\/confirm/);
  assert.match(
    config.mailer_templates_confirmation_content,
    /\.SiteURL.*\/auth\/confirm\?token_hash=.*\.TokenHash.*type=email/,
  );
  assert.match(config.mailer_templates_recovery_content, /type=recovery/);
  assert.match(config.mailer_templates_email_change_content, /type=email_change/);
  assert.match(config.mailer_templates_email_change_content, /\.NewEmail/);
  assert.equal(config.mailer_autoconfirm, false);
  assert.equal(config.smtp_pass, undefined);
  assert.throws(() => resolveConfig({ site_url: 'template(confirmation)' }, {}, 'development'));
});

test('Jede versionierte Vorlage wird in beiden Umgebungen übertragen und hat einen Betreff', () => {
  for (const environment of ['development', 'production']) {
    const config = loadAuthConfig(environment, { AUTH_SITE_URL: 'https://app.example' });
    for (const name of templates) {
      const html = readFileSync(
        new URL(`../supabase/templates/${name}.html`, import.meta.url),
        'utf8',
      );
      assert.equal(config[`mailer_templates_${name}_content`], html);
      assert.match(config[`mailer_subjects_${name}`], /UniVerse/);
    }
    assert.equal(config.mailer_notifications_password_changed_enabled, true);
    assert.equal(config.mailer_notifications_email_changed_enabled, true);
  }
  assert.throws(
    () =>
      resolveConfig(
        { mailer_templates_recovery_content: 'template(unbekannt)' },
        {},
        'development',
      ),
    /Unbekannte E-Mail-Vorlage/,
  );
  assert.throws(() =>
    resolveConfig(
      { mailer_templates_recovery_content: 'template(confirmation)' },
      {},
      'development',
    ),
  );
});

test('Vorlagen sind eigenständiges HTML ohne externe Ressourcen und nutzen nur bekannte Variablen', () => {
  // Erlaubte Variablen je Vorlage; ein Tippfehler bliebe sonst bis zur echten Mail unbemerkt.
  const variables = {
    confirmation: ['SiteURL', 'TokenHash'],
    recovery: ['SiteURL', 'TokenHash'],
    email_change: ['SiteURL', 'TokenHash', 'Email', 'NewEmail'],
    password_changed_notification: ['SiteURL', 'Email'],
    email_changed_notification: ['Email', 'OldEmail'],
  };
  const linkType = { confirmation: 'email', recovery: 'recovery', email_change: 'email_change' };
  for (const name of templates) {
    const html = readFileSync(
      new URL(`../supabase/templates/${name}.html`, import.meta.url),
      'utf8',
    );
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<html lang="de">/);
    // Mail-Clients blockieren oder verfolgen Nachgeladenes; alles steht inline.
    assert.doesNotMatch(html, /<(script|link|img|style)\b/i);
    assert.doesNotMatch(html, /https?:\/\//);
    // Kein Umbruch in einer Variable oder im sichtbaren Link: er landete sonst im kopierten Link.
    assert.doesNotMatch(html, /\{\{[^}]*\n/);
    const used = [...html.matchAll(/\{\{\s*\.(\w+)\s*\}\}/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(used)].sort(), [...variables[name]].sort(), name);
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    if (linkType[name]) {
      // Schaltfläche und kopierbarer Link führen beide in den Bestätigungsablauf des Frontends.
      assert.equal(links.length, 2, name);
      for (const link of links) {
        assert.equal(
          link,
          `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${linkType[name]}`,
        );
      }
    } else {
      // Benachrichtigungen enthalten kein Token.
      assert.doesNotMatch(html, /TokenHash/);
      for (const link of links) assert.equal(link, '{{ .SiteURL }}/login');
    }
  }
});

test('SMTP ist in beiden Umgebungen standardmäßig aus; Zugangsdaten aktivieren es nicht', () => {
  for (const environment of ['development', 'production']) {
    for (const flag of [undefined, '', 'false']) {
      const config = loadAuthConfig(environment, {
        AUTH_SITE_URL: 'https://app.example',
        AUTH_SMTP_ENABLED: flag,
        AUTH_SMTP_HOST: 'smtp.example',
        AUTH_SMTP_PASS: 'vorbereitet-aber-inaktiv',
      });
      assert.ok(Object.keys(config).every((key) => !key.startsWith('smtp_')));
      assert.equal(config.mailer_autoconfirm, false);
      assert.equal(config.external_email_enabled, true);
      assert.match(config.uri_allow_list, /app.example\/auth\/confirm/);
    }
  }
});

test('Nur das aktivierte SMTP-Flag verlangt in beiden Umgebungen vollständige Zugangsdaten', () => {
  const values = { AUTH_SITE_URL: 'https://app.example' };
  const smtp = {
    AUTH_SMTP_HOST: 'smtp.example',
    AUTH_SMTP_PORT: '587',
    AUTH_SMTP_USER: 'mailer',
    AUTH_SMTP_PASS: '$literal`secret',
    AUTH_SMTP_ADMIN_EMAIL: 'hello@example.com',
    AUTH_SMTP_SENDER_NAME: 'Lernapp',
  };
  for (const environment of ['development', 'production']) {
    assert.throws(() => loadAuthConfig(environment, { ...values, AUTH_SMTP_ENABLED: 'true' }));
    assert.throws(() =>
      loadAuthConfig(environment, {
        ...values,
        AUTH_SMTP_ENABLED: 'true',
        AUTH_SMTP_HOST: 'smtp.example',
      }),
    );
    const config = loadAuthConfig(environment, { ...values, ...smtp, AUTH_SMTP_ENABLED: 'true' });
    assert.equal(config.smtp_pass, smtp.AUTH_SMTP_PASS);
    assert.equal(config.smtp_host, smtp.AUTH_SMTP_HOST);
    assert.equal(Object.keys(config).filter((key) => key.startsWith('smtp_')).length, 6);
    assert.equal(config.AUTH_SMTP_ENABLED, undefined);
  }
});

test('Tippfehler im SMTP-Flag führen zu einem verständlichen Fehler', () => {
  for (const environment of ['development', 'production']) {
    for (const flag of ['yes', '1', 'treu']) {
      assert.throws(
        () =>
          loadAuthConfig(environment, {
            AUTH_SITE_URL: 'https://app.example',
            AUTH_SMTP_ENABLED: flag,
          }),
        /AUTH_SMTP_ENABLED muss true oder false sein/,
      );
    }
  }
});
