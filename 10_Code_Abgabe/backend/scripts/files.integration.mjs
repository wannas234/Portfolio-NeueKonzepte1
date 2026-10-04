import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { cliEnvironment, root } from './environment.mjs';
import { pdfFixture } from '../supabase/functions/_shared/testing/pdf.ts';

test('File lifecycle through Auth, Functions, Postgres and Storage', async (t) => {
  const status = spawnSync(`${root}node_modules/.bin/supabase`, ['status', '-o', 'json'], {
    cwd: root,
    env: cliEnvironment(),
    encoding: 'utf8',
  });
  assert.equal(status.status, 0, 'Start local Supabase');
  const { API_URL: url, ANON_KEY: key, SERVICE_ROLE_KEY: admin } = JSON.parse(status.stdout);
  assert.equal(new URL(url).hostname, '127.0.0.1');
  const users = [];
  const paths = new Set();
  async function request(path, token, body, method = 'POST', extraHeaders = {}) {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        apikey: key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
        ...extraHeaders,
      },
      body:
        body === undefined
          ? undefined
          : typeof body === 'string' || body instanceof Uint8Array
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, ok: response.ok, data };
  }
  function success(result) {
    assert.ok(result.ok, JSON.stringify(result));
    return result.data;
  }
  function error(result, code, status) {
    assert.equal(result.status, status, JSON.stringify(result));
    assert.equal(result.data.error.code, code);
  }
  const call = (token, body) => request('/functions/v1/files', token, body);
  const cleanup = () => request('/functions/v1/files-cleanup', admin, {});
  async function prepare(user, options = {}) {
    const body = {
      action: 'prepare',
      course_id: user.course,
      upload_key: randomUUID(),
      filename: 'notes.txt',
      mime_type: 'text/plain',
      size_bytes: 5,
      ...options,
    };
    const file = success(await call(user.token, body)).file;
    paths.add(file.storage_path);
    return { file, body };
  }
  const upload = (user, file, bytes = 'Hallo') =>
    request(`/storage/v1/object/learning-files/${file.storage_path}`, user.token, bytes, 'POST', {
      'content-type': file.mime_type,
    });
  const read = (file) =>
    request(
      `/storage/v1/object/authenticated/learning-files/${file.storage_path}`,
      admin,
      undefined,
      'GET',
    );
  try {
    for (let i = 0; i < 2; i++) {
      const email = `files-${randomUUID()}@example.com`;
      const password = `Files-${randomUUID()}!`;
      const account = success(
        await request('/auth/v1/admin/users', admin, { email, password, email_confirm: true }),
      );
      const user = { id: account.id, course: randomUUID() };
      users.push(user);
      user.token = success(
        await request('/auth/v1/token?grant_type=password', undefined, { email, password }),
      ).access_token;
      success(
        await request('/rest/v1/courses', user.token, {
          id: user.course,
          owner_id: user.id,
          title: 'Files lifecycle',
        }),
      );
    }
    const [anna, ben] = users;
    await t.test(
      'Prepare, concurrent retry, missing upload, complete, listing and download',
      async () => {
        const { file, body } = await prepare(anna);
        assert.equal(file.status, 'pending');
        const retries = await Promise.all([call(anna.token, body), call(anna.token, body)]);
        for (const result of retries) assert.equal(success(result).file.id, file.id);
        error(await call(anna.token, { ...body, size_bytes: 6 }), 'UPLOAD_KEY_CONFLICT', 409);
        error(
          await call(anna.token, { action: 'complete', file_id: file.id }),
          'UPLOAD_MISSING',
          503,
        );
        error(
          await call(anna.token, { action: 'download', file_id: file.id }),
          'FILE_NOT_READY',
          409,
        );
        success(await upload(anna, file));
        const before = await request(
          `/storage/v1/object/authenticated/learning-files/${file.storage_path}`,
          anna.token,
          undefined,
          'GET',
        );
        assert.equal(before.ok, false, 'Pending bytes are not publicly available');
        const completions = await Promise.all([
          call(anna.token, { action: 'complete', file_id: file.id }),
          call(anna.token, { action: 'complete', file_id: file.id }),
        ]);
        for (const result of completions) assert.equal(success(result).file.status, 'ready');
        const source = success(completions[0]).source_document;
        assert.equal(source.processing_status, 'uploaded');
        for (const result of completions) {
          assert.equal(success(result).source_document.id, source.id);
          assert.equal(success(result).material_id, success(completions[0]).material_id);
        }
        const repeated = success(await call(anna.token, { action: 'complete', file_id: file.id }));
        assert.equal(repeated.source_document.id, source.id);
        const sourcePath = `/rest/v1/source_documents?id=eq.${source.id}`;
        const materials = success(
          await request(
            `/rest/v1/materials?id=eq.${repeated.material_id}&select=id,title,source_documents!source_documents_material_id_fkey(id,processing_status)`,
            anna.token,
            undefined,
            'GET',
          ),
        );
        assert.equal(materials[0].source_documents.id, source.id);
        assert.equal(success(await request(sourcePath, anna.token, undefined, 'GET')).length, 1);
        assert.deepEqual(success(await request(sourcePath, ben.token, undefined, 'GET')), []);
        const rpc = (name, token, body) => request(`/rest/v1/rpc/${name}`, token, body);
        assert.equal(
          (
            await rpc('claim_document_processing', anna.token, {
              p_document_id: source.id,
            })
          ).ok,
          false,
        );
        const claims = await Promise.all(
          [0, 1].map(() =>
            rpc('claim_document_processing', admin, {
              p_document_id: source.id,
            }),
          ),
        );
        const claimed = claims.map(success).filter(Boolean);
        assert.equal(claimed.length, 1, 'Concurrent workers receive one lease');
        const busy = await request('/functions/v1/documents-process', anna.token, {
          document_id: source.id,
        });
        assert.equal(busy.status, 202);
        assert.equal(busy.data.source_document.processing_status, 'processing');

        assert.equal(
          success(
            await rpc('finish_document_processing', admin, {
              p_document_id: source.id,
              p_lease_token: claimed[0].lease_token,
              p_text: 'Hallo',
              p_pages: [{ page: 1, text: 'Hallo' }],
            }),
          ),
          true,
        );
        const processed = success(await request(sourcePath, anna.token, undefined, 'GET'))[0];
        assert.equal(processed.processing_status, 'ready');
        assert.equal(processed.extracted_text, 'Hallo');
        assert.equal(processed.page_count, 1);
        assert.equal(
          success(await call(anna.token, { action: 'complete', file_id: file.id })).source_document
            .processing_status,
          'ready',
        );
        const link = success(
          await call(anna.token, { action: 'download', file_id: file.id, download: true }),
        );
        const downloaded = await fetch(new URL(link.path, url));
        assert.equal(downloaded.status, 200);
        assert.equal(await downloaded.text(), 'Hallo');
        const listing = success(
          await request(`/rest/v1/files?course_id=eq.${anna.course}`, anna.token, undefined, 'GET'),
        );
        assert.equal(listing.find((entry) => entry.id === file.id).status, 'ready');
        for (const action of ['complete', 'download'])
          error(await call(ben.token, { action, file_id: file.id }), 'FILE_NOT_FOUND', 404);
        success(await call(ben.token, { action: 'delete', file_id: file.id }));
        assert.equal((await read(file)).ok, true, 'Foreign delete is a no-op');
        success(await call(anna.token, { action: 'delete', file_id: file.id }));
        success(await call(anna.token, { action: 'delete', file_id: file.id }));
        assert.equal((await read(file)).ok, false);
        error(await call(anna.token, body), 'UPLOAD_DELETED', 409);
        success(await cleanup());
      },
    );
    await t.test(
      'Real PDF and TXT upload reach extracted results through the processing worker',
      async () => {
        assert.equal(
          (await request('/functions/v1/documents-process', anna.token, {})).status,
          400,
        );
        for (const [filename, mime_type, bytes, expectedPages] of [
          [
            'lecture.pdf',
            'application/pdf',
            pdfFixture(['Demand elasticity', '', 'Final page'], deflateSync),
            3,
          ],
          [
            'lecture.txt',
            'text/plain',
            new TextEncoder().encode('Grüße aus dem Lernmaterial'),
            null,
          ],
          [
            'broken.pdf',
            'application/pdf',
            new TextEncoder().encode('%PDF-1.7\nbroken\n%%EOF'),
            'failed',
          ],
        ]) {
          const { file } = await prepare(anna, { filename, mime_type, size_bytes: bytes.length });
          success(await upload(anna, file, bytes));
          const source = success(
            await call(anna.token, { action: 'complete', file_id: file.id }),
          ).source_document;

          const foreign = await request('/functions/v1/documents-process', ben.token, {
            document_id: source.id,
          });
          error(foreign, 'DOCUMENT_NOT_FOUND', 404);
          const manual = await request('/functions/v1/documents-process', anna.token, {
            document_id: source.id,
          });
          assert.equal(manual.status, 200, JSON.stringify(manual));
          assert.equal(manual.data.source_document.id, source.id);
          const document = success(
            await request(
              `/rest/v1/source_documents?id=eq.${source.id}`,
              anna.token,
              undefined,
              'GET',
            ),
          )[0];

          if (expectedPages === 'failed') {
            assert.equal(document.processing_status, 'failed');
            assert.equal(document.error_code, 'INVALID_DOCUMENT');
            assert.equal(document.extracted_text, null);
          } else {
            assert.equal(document.processing_status, 'ready', JSON.stringify(document));
            assert.equal(document.page_count, expectedPages);
            if (expectedPages === 3) {
              assert.deepEqual(document.pages, [
                { page: 1, text: 'Demand elasticity', route: 'local', reasons: [] },
                { page: 2, text: '', route: 'local', reasons: [] },
                { page: 3, text: 'Final page', route: 'local', reasons: [] },
              ]);
            } else {
              assert.equal(document.extracted_text, 'Grüße aus dem Lernmaterial');
              assert.equal(document.pages, null);
            }
          }
          const repeated = success(
            await request('/functions/v1/documents-process', anna.token, {
              document_id: source.id,
            }),
          );
          assert.equal(repeated.completed, 0, 'Terminal documents are not reprocessed');
          assert.equal(repeated.source_document.processing_status, document.processing_status);
          success(await call(anna.token, { action: 'delete', file_id: file.id }));
        }
        success(await request('/functions/v1/documents-process', admin, {}));
      },
    );
    await t.test(
      'Invalid metadata, content, sizes, repeated uploads and direct status changes',
      async () => {
        error(
          await call(anna.token, {
            action: 'prepare',
            course_id: anna.course,
            upload_key: randomUUID(),
            filename: 'bad.exe',
            mime_type: 'application/pdf',
            size_bytes: 5,
          }),
          'INVALID_FILE',
          400,
        );
        error(
          await call(anna.token, {
            action: 'prepare',
            course_id: anna.course,
            upload_key: randomUUID(),
            filename: 'big.txt',
            mime_type: 'text/plain',
            size_bytes: 52428801,
          }),
          'FILE_TOO_LARGE',
          413,
        );
        error(
          await call(ben.token, {
            action: 'prepare',
            course_id: anna.course,
            upload_key: randomUUID(),
            filename: 'notes.txt',
            mime_type: 'text/plain',
            size_bytes: 5,
          }),
          'COURSE_NOT_FOUND',
          404,
        );
        const { file } = await prepare(anna, { filename: 'bad.pdf', mime_type: 'application/pdf' });
        success(await upload(anna, file, 'Hallo'));
        assert.equal((await upload(anna, file, 'Hallo')).ok, false);
        error(
          await call(anna.token, { action: 'complete', file_id: file.id }),
          'INVALID_CONTENT',
          422,
        );
        error(
          await call(anna.token, { action: 'complete', file_id: file.id }),
          'UPLOAD_NOT_PENDING',
          409,
        );
        assert.equal(
          (
            await request(
              `/rest/v1/files?id=eq.${file.id}`,
              anna.token,
              { status: 'ready' },
              'PATCH',
            )
          ).ok,
          false,
        );
        const mismatch = (await prepare(anna, { size_bytes: 4 })).file;
        success(await upload(anna, mismatch));
        error(
          await call(anna.token, { action: 'complete', file_id: mismatch.id }),
          'INVALID_CONTENT',
          422,
        );
        const sameName = (await prepare(anna)).file;
        const sameNameAgain = (await prepare(anna)).file;
        assert.notEqual(
          sameName.id,
          sameNameAgain.id,
          'Same names with different keys are allowed',
        );
        for (const item of [file, mismatch, sameName, sameNameAgain])
          success(await call(anna.token, { action: 'delete', file_id: item.id }));
        assert.equal((await request('/functions/v1/files-cleanup', anna.token, {})).status, 401);
      },
    );
    await t.test(
      'Maximum-size text upload completes without proxying bytes through Functions',
      async () => {
        const { file } = await prepare(anna, { size_bytes: 50 * 1024 * 1024 });
        success(await upload(anna, file, 'x'.repeat(file.size_bytes)));
        assert.equal(
          success(await call(anna.token, { action: 'complete', file_id: file.id })).file.status,
          'ready',
        );
        success(await call(anna.token, { action: 'delete', file_id: file.id }));
      },
    );
    await t.test('Raw deletion and course cascade leave durable cleanup jobs', async () => {
      const first = (await prepare(anna)).file;
      success(await upload(anna, first));
      success(await request(`/rest/v1/files?id=eq.${first.id}`, anna.token, undefined, 'DELETE'));
      assert.equal((await read(first)).ok, true, 'Blob remains until worker executes');
      success(await cleanup());
      assert.equal((await read(first)).ok, false);
      const second = (await prepare(ben)).file;
      success(await upload(ben, second));
      success(
        await request(`/rest/v1/courses?id=eq.${ben.course}`, ben.token, undefined, 'DELETE'),
      );
      success(await cleanup());
      assert.equal((await read(second)).ok, false);
      success(await cleanup());
    });
  } finally {
    const failures = [];
    async function attempt(work) {
      try {
        success(await work());
      } catch (error) {
        failures.push(error);
      }
    }
    if (paths.size)
      await attempt(() =>
        request('/storage/v1/object/learning-files', admin, { prefixes: [...paths] }, 'DELETE'),
      );
    for (const user of users) {
      await attempt(() =>
        request(`/rest/v1/courses?id=eq.${user.course}`, admin, undefined, 'DELETE'),
      );
      await attempt(() => request(`/auth/v1/admin/users/${user.id}`, admin, undefined, 'DELETE'));
      await attempt(() =>
        request(`/rest/v1/file_cleanup_jobs?owner_id=eq.${user.id}`, admin, undefined, 'DELETE'),
      );
    }
    if (failures.length) throw new AggregateError(failures, 'Files integration cleanup failed');
  }
});
