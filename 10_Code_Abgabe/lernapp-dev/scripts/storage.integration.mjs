import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { cliEnvironment, root } from './environment.mjs';

// No env files or remote credentials: test only the running local stack.
test('Privater Storage: Nutzertrennung, Pfade und Upload-Limits', async (t) => {
  const status = spawnSync(`${root}node_modules/.bin/supabase`, ['status', '-o', 'json'], {
    cwd: root,
    env: cliEnvironment(),
    encoding: 'utf8',
  });
  assert.equal(status.status, 0, 'Lokalen Stack mit npm run db:start starten');
  const { API_URL: url, ANON_KEY: key, SERVICE_ROLE_KEY: admin } = JSON.parse(status.stdout);
  assert.equal(new URL(url).hostname, '127.0.0.1');
  assert.ok(key && admin, 'Lokale Keys fehlen');
  const bucket = 'learning-files';
  const users = [];
  const objects = new Set();
  const courses = [];

  async function request(path, { token, method = 'GET', json, body, headers = {} } = {}) {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        apikey: key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: json === undefined ? body : JSON.stringify(json),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text };
  }
  function success(result) {
    assert.ok(result.ok, `HTTP ${result.status}: ${result.text}`);
    return result.text ? JSON.parse(result.text) : null;
  }
  function denied(result) {
    assert.ok(
      result.status >= 400 && result.status < 500,
      `Erwartete Ablehnung, HTTP ${result.status}: ${result.text}`,
    );
  }
  function pathFor(user, course, ext = 'pdf') {
    return `${user.id}/${course}/${randomUUID()}.${ext}`;
  }
  async function upload(
    path,
    token,
    mime = 'application/pdf',
    body = '%PDF-1.7\nStorage test\n',
    upsert = false,
  ) {
    // Prepare metadata fixtures; this suite tests Storage policies, not content validation.
    const user = users.find((entry) => entry.token === token);
    const parts = path.split('/');
    const [id, ext] = (parts[2] ?? '').split('.');
    const mimeByExt = {
      pdf: 'application/pdf',
      txt: 'text/plain',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    if (
      user &&
      parts.length === 3 &&
      parts[0] === user.id &&
      parts[1] === user.course &&
      /^[0-9a-f-]{36}$/.test(id) &&
      mimeByExt[ext] &&
      !objects.has(path)
    ) {
      success(
        await request('/rest/v1/files', {
          token,
          method: 'POST',
          json: {
            id,
            course_id: user.course,
            uploaded_by: user.id,
            storage_bucket: bucket,
            storage_path: path,
            original_filename: `test.${ext}`,
            mime_type: mimeByExt[ext],
            size_bytes: Math.min(Buffer.byteLength(body), 50 * 1024 * 1024),
          },
        }),
      );
    }
    objects.add(path);
    const result = await request(`/storage/v1/object/${bucket}/${path}`, {
      token,
      method: 'POST',
      body,
      headers: { 'content-type': mime, 'x-upsert': String(upsert) },
    });
    if (result.ok)
      success(
        await request(`/rest/v1/files?id=eq.${id}`, {
          token: admin,
          method: 'PATCH',
          json: { status: 'ready' },
        }),
      );
    return result;
  }
  function download(path, token) {
    return request(`/storage/v1/object/authenticated/${bucket}/${path}`, { token });
  }
  function remove(paths, token) {
    return request(`/storage/v1/object/${bucket}`, {
      token,
      method: 'DELETE',
      json: { prefixes: paths },
    });
  }

  try {
    // Dedicated accounts isolate these checks from auth tests and developer sessions.
    for (let i = 0; i < 2; i++) {
      const email = `storage-${randomUUID()}@example.com`;
      const password = `Storage-${randomUUID()}!`;
      const created = success(
        await request('/auth/v1/admin/users', {
          token: admin,
          method: 'POST',
          json: { email, password, email_confirm: true },
        }),
      );
      const user = { id: created.id };
      users.push(user);
      const session = success(
        await request('/auth/v1/token?grant_type=password', {
          method: 'POST',
          json: { email, password },
        }),
      );
      user.token = session.access_token;
      user.course = randomUUID();
      success(
        await request('/rest/v1/courses', {
          token: user.token,
          method: 'POST',
          json: { id: user.course, owner_id: user.id, title: 'Storage integration' },
        }),
      );
      courses.push(user.course);
    }
    const [anna, ben] = users;
    const own = pathFor(anna, anna.course);
    const original = '%PDF-1.7\nPrivate Lernunterlagen\n';

    await t.test('Eigener Upload und Download fuer alle erlaubten MIME-Typen', async () => {
      success(await upload(own, anna.token, 'application/pdf', original));
      const result = await download(own, anna.token);
      assert.equal(result.status, 200);
      assert.equal(result.text, original);
      for (const [ext, mime] of [
        ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
        ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        ['txt', 'text/plain'],
      ]) {
        const path = pathFor(anna, anna.course, ext);
        success(await upload(path, anna.token, mime, 'Storage test'));
        assert.equal((await download(path, anna.token)).text, 'Storage test');
      }
      const benPath = pathFor(ben, ben.course);
      success(await upload(benPath, ben.token));
      assert.equal((await download(benPath, ben.token)).status, 200);
      denied(await download(benPath, anna.token));
    });

    await t.test('Fremde und anonyme Nutzer koennen weder lesen noch loeschen', async () => {
      for (const token of [ben.token, undefined]) {
        denied(await download(own, token));
        const deletion = await remove([own], token);
        // Storage may report success with an empty list for rows hidden by RLS.
        if (deletion.ok) assert.deepEqual(success(deletion), []);
        else denied(deletion);
        assert.equal((await download(own, anna.token)).text, original);
        const listed = success(
          await request(`/storage/v1/object/list/${bucket}`, {
            token,
            method: 'POST',
            json: { prefix: `${anna.id}/${anna.course}`, limit: 100 },
          }),
        );
        assert.deepEqual(listed, []);
      }
      denied(await request(`/storage/v1/object/public/${bucket}/${own}`));
    });

    await t.test('Fremde Ordner, fremde/fehlende Kurse und ungueltige Pfade gesperrt', async () => {
      const invalidPaths = [
        pathFor(ben, ben.course),
        pathFor(anna, ben.course),
        pathFor(anna, randomUUID()),
        `${anna.id}/not-a-uuid/${randomUUID()}.pdf`,
        `${anna.id}/${anna.course}/original.pdf`,
        `${anna.id}/${anna.course}/nested/${randomUUID()}.pdf`,
        `${anna.id}/${anna.course}/${randomUUID()}.exe`,
        `${anna.id}/${anna.course}/${randomUUID()}.pdf/extra`,
        `${randomUUID()}.pdf`,
      ];
      for (const path of invalidPaths) denied(await upload(path, anna.token));
      denied(await upload(pathFor(anna, anna.course), undefined));
    });

    await t.test('MIME-Type und 50-MiB-Limit werden von Storage durchgesetzt', async () => {
      denied(await upload(pathFor(anna, anna.course), anna.token, 'application/octet-stream'));
      const tooLarge = await upload(
        pathFor(anna, anna.course, 'txt'),
        anna.token,
        'text/plain',
        Buffer.alloc(50 * 1024 * 1024 + 1, 65),
      );
      denied(tooLarge);
      assert.match(tooLarge.text, /size|large|limit/i, 'Ablehnung muss am Groessenlimit liegen');
    });

    await t.test('Ueberschreiben und Verschieben gesperrt', async () => {
      denied(await upload(own, anna.token, 'application/pdf', 'replacement', true));
      const moved = pathFor(anna, anna.course);
      objects.add(moved);
      denied(
        await request('/storage/v1/object/move', {
          token: anna.token,
          method: 'POST',
          json: { bucketId: bucket, sourceKey: own, destinationKey: moved },
        }),
      );
      assert.equal((await download(own, anna.token)).text, original);
    });

    await t.test('Kursloeschung sperrt Downloads und hinterlaesst einen Cleanup-Job', async () => {
      success(
        await request(`/rest/v1/courses?id=eq.${anna.course}`, {
          token: anna.token,
          method: 'DELETE',
        }),
      );
      denied(await download(own, anna.token));
      const jobs = success(
        await request(`/rest/v1/file_cleanup_jobs?storage_path=eq.${own}`, { token: admin }),
      );
      assert.equal(jobs.length, 1);
      const deleted = success(await remove([own], admin));
      assert.equal(deleted.length, 1);
      denied(await download(own, anna.token));
      denied(
        await request(`/storage/v1/object/${bucket}/${pathFor(anna, anna.course)}`, {
          token: anna.token,
          method: 'POST',
          body: original,
          headers: { 'content-type': 'application/pdf' },
        }),
      );
    });
  } finally {
    // Only this test's objects/accounts; admin is used solely for setup and cleanup.
    const errors = [];
    async function cleanup(action) {
      try {
        success(await action());
      } catch (error) {
        errors.push(error);
      }
    }
    if (objects.size) await cleanup(() => remove([...objects], admin));
    for (const course of courses)
      await cleanup(() =>
        request(`/rest/v1/courses?id=eq.${course}`, { token: admin, method: 'DELETE' }),
      );
    for (const user of users)
      await cleanup(() =>
        request(`/auth/v1/admin/users/${user.id}`, { token: admin, method: 'DELETE' }),
      );
    for (const user of users)
      await cleanup(() =>
        request(`/rest/v1/file_cleanup_jobs?owner_id=eq.${user.id}`, {
          token: admin,
          method: 'DELETE',
        }),
      );
    if (errors.length)
      throw new AggregateError(
        errors,
        'Storage-Testdaten konnten nicht vollstaendig entfernt werden',
      );
  }
});
