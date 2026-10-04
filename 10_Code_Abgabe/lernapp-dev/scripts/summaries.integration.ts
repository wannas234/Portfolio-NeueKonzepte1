import { createClient } from '@supabase/supabase-js';
import { handler } from '../supabase/functions/summaries/index.ts';
import { handler as worker } from '../supabase/functions/summaries-process/index.ts';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
Deno.test(
  'Concurrent admission, worker restarts, persisted results and user isolation',
  async () => {
    const url = Deno.env.get('SUPABASE_URL')!;
    assert(new URL(url).hostname === '127.0.0.1', 'Only local test database allowed');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const pending = await admin
      .from('summary_jobs')
      .select('id')
      .in('status', ['queued', 'processing'])
      .limit(1);
    assert(
      !pending.error && !pending.data?.length,
      'Run integration test with no active summary jobs',
    );
    const users: string[] = [];
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = (input, init) => {
      const target = String(input);
      if (target.startsWith('https://api.openai.com/')) {
        providerCalls++;
        const request = JSON.parse(String(init?.body));
        const payload = JSON.parse(request.messages[1].content);
        return Promise.resolve(
          Response.json({
            model: 'deterministic-test-only',
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    sections: [
                      {
                        heading: 'Überblick',
                        text: 'Die Inhalte beider Quellen werden zusammengeführt.',
                        source_ids: payload.allowed_source_ids,
                      },
                    ],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 30, completion_tokens: 40 },
          }),
        );
      }
      assert(new URL(target).hostname === '127.0.0.1', 'External network is forbidden');
      return originalFetch(input, init);
    };
    try {
      async function user() {
        const email = `summary-${crypto.randomUUID()}@example.com`;
        const password = 'Local-summary-test-123!';
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        assert(created.data.user && !created.error, 'Create fixture user');
        users.push(created.data.user.id);
        const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const login = await client.auth.signInWithPassword({ email, password });
        assert(login.data.session && !login.error, 'Login fixture user');
        return { id: created.data.user.id, token: login.data.session.access_token, client };
      }
      const owner = await user();
      const other = await user();
      const course = await admin
        .from('courses')
        .insert({ owner_id: owner.id, title: 'Summary integration' })
        .select('id')
        .single();
      assert(course.data && !course.error, 'Create course');
      const courseId = course.data.id;
      const documents: string[] = [];
      for (const name of ['one.txt', 'two.txt']) {
        const upload = await owner.client.rpc('prepare_file_upload', {
          p_course_id: courseId,
          p_upload_key: crypto.randomUUID(),
          p_filename: name,
          p_mime: 'text/plain',
          p_size: 5,
        });
        assert(!upload.error, 'Prepare upload');
        const files = await admin
          .from('files')
          .select('id')
          .eq('course_id', courseId)
          .eq('original_filename', name)
          .single();
        assert(files.data && !files.error, 'Read fixture file');
        const completed = await admin.rpc('complete_file_upload', {
          p_file_id: files.data.id,
          p_owner_id: owner.id,
        });
        assert(!completed.error, 'Complete fixture upload');
        const documentId = completed.data.source_document.id;
        documents.push(documentId);
        const lease = await admin.rpc('claim_document_processing', { p_document_id: documentId });
        assert(!lease.error && lease.data, 'Claim source extraction');
        const text = `${name}: Lerninhalt`;
        const finished = await admin.rpc('finish_document_processing', {
          p_document_id: documentId,
          p_lease_token: lease.data.lease_token,
          p_text: text,
          p_pages: [{ page: 1, text }],
        });
        assert(!finished.error && finished.data, 'Finish source extraction');
      }
      async function call(body: unknown, token = owner.token) {
        const response = await handler(
          new Request(`${url}/functions/v1/summaries`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
        return { status: response.status, data: await response.json() };
      }
      const target = { type: 'course', course_id: courseId };
      const requestId = crypto.randomUUID();
      const requests = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          call({ action: 'generate', request_id: i < 4 ? requestId : crypto.randomUUID(), target }),
        ),
      );
      assert(
        requests.every((r) => r.status === 202),
        'All concurrent requests accepted',
      );
      const jobId = requests[0].data.job_id;
      assert(
        requests.every((r) => r.data.job_id === jobId),
        'Exactly one job across real concurrent transactions',
      );
      assert(
        (await call({ action: 'status', job_id: jobId }, other.token)).status === 404,
        'Foreign status hidden',
      );
      assert(
        (
          await call({
            action: 'generate',
            request_id: requestId,
            target: { type: 'document', source_document_id: documents[0] },
          })
        ).status === 409,
        'Conflicting request rejected',
      );
      let state;
      for (let n = 0; n < 10; n++) {
        const response = await worker(
          new Request(`${url}/functions/v1/summaries-process`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}` },
          }),
        );
        assert(response.status === 200, 'Worker completed bounded step');
        await response.arrayBuffer();
        state = await call({ action: 'status', job_id: jobId });
        if (state.data.status === 'completed') break;
        assert(state.data.status === 'queued', 'Checkpoint released for a fresh worker invocation');
      }
      assert(state?.data.status === 'completed', 'Course completes across worker invocations');
      assert(providerCalls === state.data.total_steps, 'One provider call per persisted step');
      const summaryId = state.data.summary_id;
      const result = await call({ action: 'result', summary_id: summaryId });
      assert(result.status === 200 && !result.data.is_stale, 'Fresh result available');
      assert(
        result.data.content.sources.length === 2 && result.data.sources.length === 2,
        'Both documents retained',
      );
      assert(
        (await call({ action: 'result', summary_id: summaryId }, other.token)).status === 404,
        'Foreign result hidden',
      );
      const repeated = await call({ action: 'generate', request_id: crypto.randomUUID(), target });
      assert(
        repeated.status === 200 && repeated.data.summary_id === summaryId,
        'Cached result reused',
      );
      const individual = await call({
        action: 'generate',
        request_id: crypto.randomUUID(),
        target: { type: 'document', source_document_id: documents[0] },
      });
      assert(individual.status === 202, 'Document generation accepted');
      let documentState;
      for (let n = 0; n < 5; n++) {
        const response = await worker(
          new Request(`${url}/functions/v1/summaries-process`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}` },
          }),
        );
        assert(response.status === 200, 'Document worker succeeds');
        await response.arrayBuffer();
        documentState = await call({ action: 'status', job_id: individual.data.job_id });
        if (documentState.data.status === 'completed') break;
      }
      assert(documentState?.data.status === 'completed', 'Individual document completes');
      const documentResult = await call({
        action: 'result',
        summary_id: documentState.data.summary_id,
      });
      assert(
        documentResult.data.target.type === 'document' &&
          documentResult.data.content.sources.length === 1 &&
          documentResult.data.content.sources[0].page === 1,
        'Document result has a precise page reference',
      );
      const edit = await admin
        .from('source_documents')
        .update({ extracted_text: 'Changed source' })
        .eq('id', documents[0]);
      assert(!edit.error, 'Change source');
      assert(
        (await call({ action: 'result', summary_id: summaryId })).data.is_stale,
        'Source change visible',
      );
    } finally {
      for (const id of users.reverse()) {
        const result = await admin.auth.admin.deleteUser(id);
        assert(!result.error, 'Remove integration fixture');
      }
      globalThis.fetch = originalFetch;
    }
  },
);
