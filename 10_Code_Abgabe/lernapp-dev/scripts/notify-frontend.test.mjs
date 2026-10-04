import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Den tatsächlichen Inline-Code testen, ohne GitHub-Zugriff oder PAT.
const workflow = readFileSync(
  new URL('../.github/workflows/notify-frontend.yml', import.meta.url),
  'utf8',
);
const script = workflow.split('          script: |\n')[1].replace(/^ {12}/gm, '');
const runScript = new (Object.getPrototypeOf(async function () {}).constructor)(
  'github',
  'context',
  'core',
  'process',
  script,
);
const template = readFileSync(
  new URL('../.github/PULL_REQUEST_TEMPLATE.md', import.meta.url),
  'utf8',
);
const filled =
  '- [x] Notify Frontend\n\n### Feature\nKartensuche\n\n### Details / Zusätzliche Informationen\nGET /cards\n\n- Neuer Filter';

async function run(body = filled, options = {}) {
  const calls = [];
  const warnings = [];
  const failures = [];
  const api =
    (name, implementation = () => ({})) =>
    async (args) => {
      calls.push({ name, args });
      return implementation(args);
    };
  let labelReads = 0;
  const github = {
    rest: {
      issues: {
        listForRepo: 'listForRepo',
        getLabel: api('getLabel', () => {
          if (options.labelError && labelReads++ === 0) throw { status: options.labelError };
        }),
        createLabel: api('createLabel', () => {
          if (options.createLabelError) throw { status: options.createLabelError };
        }),
        create: api('create', () => ({
          data: { html_url: 'https://github.com/example/frontend/issues/1' },
        })),
      },
    },
    paginate: {
      iterator: async function* (route, args) {
        calls.push({ name: route, args });
        for (const data of options.pages ?? [[]]) yield { data };
      },
    },
  };
  await runScript(
    github,
    {
      repo: { owner: 'example', repo: 'backend' },
      payload: {
        pull_request: {
          number: 42,
          merged: options.merged ?? true,
          base: { ref: options.base ?? 'dev' },
          body,
          user: { login: 'developer' },
          html_url: 'https://github.com/example/backend/pull/42',
        },
      },
    },
    {
      info() {},
      warning: (message) => warnings.push(message),
      setFailed: (message) => failures.push(message),
    },
    {
      env: {
        FRONTEND_OWNER: 'example',
        FRONTEND_REPO: 'frontend',
        FRONTEND_REPO_PAT: 'fake-test-token',
        ...options.env,
      },
    },
  );
  return { calls, warnings, failures, issue: calls.find(({ name }) => name === 'create')?.args };
}

test('erstellt Issue mit Titel, Details, Autor, PR und Label', async () => {
  const { issue, warnings } = await run();
  assert.equal(issue.title, 'Neues Backend-Feature: Kartensuche');
  assert.deepEqual(issue.labels, ['backend-notification']);
  assert.equal(issue.owner, 'example');
  assert.equal(issue.repo, 'frontend');
  assert.match(issue.body, /Autor: @developer/);
  assert.match(issue.body, /https:\/\/github.com\/example\/backend\/pull\/42/);
  assert.match(issue.body, /GET \/cards\n\n- Neuer Filter/);
  assert.equal(warnings.length, 0);
});

test('überspringt ungefülltes Template, fehlenden Body und Checkbox-Beispiele ohne PAT', async () => {
  for (const body of [
    template,
    null,
    '<!-- - [x] Notify Frontend -->',
    '```md\n- [x] Notify Frontend\n```',
    '> - [x] Notify Frontend',
    '- [ ] Notify Frontend',
  ]) {
    const result = await run(body, { env: { FRONTEND_REPO_PAT: '' } });
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.failures, []);
  }
});

test('überspringt nicht gemergte PRs und andere Zielbranches', async () => {
  assert.deepEqual((await run(filled, { merged: false })).calls, []);
  assert.deepEqual((await run(filled, { base: 'main' })).calls, []);
});

test('akzeptiert Großschreibung, CRLF, Fettung, Doppelpunkte und zusätzliche Leerzeichen', async () => {
  const { issue } = await run(
    ' * [ X ] **Notify   Frontend**  \r\n\r\n ## **FEATURE** : \r\n Suche \r\n\r\n ## Details  / Zusätzliche   Informationen: \r\nAPI v2',
  );
  assert.equal(issue.title, 'Neues Backend-Feature: Suche');
  assert.match(issue.body, /API v2$/);
});

test('behält Markdown-Unterabschnitte und Code bei, beendet Feld bei nächstem Hauptabschnitt', async () => {
  const details = '#### Beispiel\n```md\n### Feature\nCode\n```\nWeiter';
  const { issue } = await run(`${filled}\n${details}\n### Tests\nNicht übernehmen`);
  assert.ok(issue.body.includes(details));
  assert.ok(!issue.body.includes('Nicht übernehmen'));
});

test('fehlende Felder und reine Template-Kommentare ergeben Platzhalter mit Warnung', async () => {
  for (const body of ['- [x] Notify Frontend', template.replace('[ ]', '[x]')]) {
    const result = await run(body);
    assert.match(result.issue.title, /Feature-Titel fehlt/);
    assert.match(result.issue.body, /Keine zusätzlichen Informationen/);
    assert.equal(result.warnings.length, 2);
  }
});

test('kürzt überlange Eingaben', async () => {
  const { issue, warnings } = await run(
    `- [x] Notify Frontend\n## Feature\n${'a'.repeat(300)}\n## Details\n${'b'.repeat(65000)}`,
  );
  assert.ok(issue.title.length <= 256);
  assert.ok(issue.body.length < 65536);
  assert.equal(warnings.length, 2);
});

test('fehlendes Secret oder Ziel meldet Fehler vor API-Zugriff', async () => {
  for (const env of [
    { FRONTEND_REPO_PAT: '' },
    { FRONTEND_OWNER: 'REPLACE_WITH_FRONTEND_OWNER' },
  ]) {
    const result = await run(filled, { env });
    assert.equal(result.failures.length, 1);
    assert.deepEqual(result.calls, []);
  }
});

test('legt fehlendes Label an und toleriert konkurrierendes Anlegen', async () => {
  for (const createLabelError of [undefined, 422]) {
    const result = await run(filled, { labelError: 404, createLabelError });
    assert.ok(result.issue);
    assert.ok(result.calls.some(({ name }) => name === 'createLabel'));
  }
});

test('verschluckt keine Berechtigungs- oder Label-API-Fehler', async () => {
  await assert.rejects(run(filled, { labelError: 403 }), { status: 403 });
  await assert.rejects(run(filled, { labelError: 404, createLabelError: 500 }), { status: 500 });
});

test('findet vorhandenes geschlossenes Issue auch auf späterer Seite', async () => {
  const result = await run(filled, {
    pages: [
      [],
      [
        {
          state: 'closed',
          body: '<!-- backend-notification:example/backend#42 -->',
          html_url: 'existing',
        },
      ],
    ],
  });
  assert.equal(result.issue, undefined);
  assert.deepEqual(
    result.calls.map(({ name }) => name),
    ['listForRepo'],
  );
});
