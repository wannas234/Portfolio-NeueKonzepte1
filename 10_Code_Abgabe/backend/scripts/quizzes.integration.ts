import { createClient } from '@supabase/supabase-js';
import { handler } from '../supabase/functions/quizzes/index.ts';
import { handler as worker } from '../supabase/functions/quizzes-process/index.ts';
function assert(v: unknown, message: string): asserts v {
  if (!v) throw new Error(message);
}
Deno.test(
  'Quiz HTTP: isolated owner fixtures, full generation, provenance, attempts and idempotency',
  async () => {
    const url = Deno.env.get('SUPABASE_URL')!;
    assert(new URL(url).hostname === '127.0.0.1', 'Local only');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const users: string[] = [];
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (input, init) => {
      if (String(input).startsWith('https://api.openai.com/')) {
        calls++;
        const request = JSON.parse(String(init?.body));
        const payload = JSON.parse(request.messages[1].content);
        const content = request.messages[0].content;
        const result = content.includes('nullbasierten')
          ? { indices: [0] }
          : content.includes('Selbstlerntest')
            ? {
                questions: payload.map((p: { source_ids: string[] }) => ({
                  question: 'Was ist X?',
                  options: ['A', 'B', 'C', 'D'],
                  correctIndex: 1,
                  explanation: 'X ist B.',
                  source_chunk_ids: p.source_ids,
                })),
              }
            : { cards: [{ question: 'Was ist X?', answer: 'B', source_ids: payload.source_ids }] };
        return Promise.resolve(
          Response.json({
            model: 'deterministic-test-only',
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
            usage: { prompt_tokens: 30, completion_tokens: 40 },
          }),
        );
      }
      assert(new URL(String(input)).hostname === '127.0.0.1', 'No external network');
      return original(input, init);
    };
    try {
      const pending = await admin
        .from('quiz_generation_jobs')
        .select('id')
        .in('status', ['queued', 'processing']);
      assert(!pending.error && !pending.data.length, 'No active jobs');
      const user = async () => {
        const email = `quiz-${crypto.randomUUID()}@example.com`,
          password = 'Local-quiz-test-123!';
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        assert(created.data.user && !created.error, 'Create user');
        users.push(created.data.user.id);
        const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const login = await client.auth.signInWithPassword({ email, password });
        assert(login.data.session, 'Login');
        return { id: created.data.user.id, token: login.data.session.access_token, client };
      };
      const owner = await user(),
        other = await user();
      const course = await admin
        .from('courses')
        .insert({ owner_id: owner.id, title: 'Quiz HTTP' })
        .select('id')
        .single();
      assert(course.data, 'Course');
      const upload = await owner.client.rpc('prepare_file_upload', {
        p_course_id: course.data.id,
        p_upload_key: crypto.randomUUID(),
        p_filename: 'quiz.txt',
        p_mime: 'text/plain',
        p_size: 10,
      });
      assert(!upload.error, 'Upload');
      const file = await admin.from('files').select('id').eq('course_id', course.data.id).single();
      assert(file.data, 'File');
      const complete = await admin.rpc('complete_file_upload', {
        p_file_id: file.data.id,
        p_owner_id: owner.id,
      });
      assert(!complete.error, 'Complete upload');
      const doc = complete.data.source_document;
      const lease = await admin.rpc('claim_document_processing', { p_document_id: doc.id });
      assert(lease.data, 'Extraction lease');
      const extracted = await admin.rpc('finish_document_processing', {
        p_document_id: doc.id,
        p_lease_token: lease.data.lease_token,
        p_text: 'X ist B.',
        p_pages: [{ page: 1, text: 'X ist B.' }],
      });
      assert(!extracted.error && extracted.data, 'Extracted: ' + extracted.error?.message);
      const indexLease = await admin.rpc('claim_document_indexing', { p_document_id: doc.id });
      assert(indexLease.data, 'Index lease');
      const indexed = await admin.rpc('finish_document_indexing_batch', {
        p_document_id: doc.id,
        p_lease_token: indexLease.data.lease_token,
        p_total_chunks: 1,
        p_embedding_provider: 'gemini',
        p_embedding_model: 'gemini-embedding-2',
        p_embedding_dimensions: 1536,
        p_chunks: [
          {
            chunk_index: 0,
            content: 'X ist B.',
            page_number: 1,
            metadata: {},
            embedding: Array(1536).fill(0.1),
          },
        ],
      });
      assert(!indexed.error && indexed.data, 'Indexed: ' + indexed.error?.message);
      const chunk = await admin
        .from('document_chunks')
        .select('id')
        .eq('document_id', doc.id)
        .single();
      assert(chunk.data, 'Chunk');
      const invoke = (body: unknown, token = owner.token) =>
        handler(
          new Request(url + '/functions/v1/quizzes', {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
      const body = {
        action: 'generate',
        source_material_id: complete.data.material_id,
        count: 5,
        request_id: crypto.randomUUID(),
      };
      assert((await invoke(body, other.token)).status === 404, 'Foreign source denied');
      assert((await handler(new Request(url, { method: 'POST' }))).status === 401, 'Auth required');
      const replies = await Promise.all([invoke(body), invoke(body), invoke(body)]);
      const jobs = await Promise.all(replies.map((r) => r.json()));
      assert(
        replies.every((r) => r.status === 200) && jobs.every((j) => j.id === jobs[0].id),
        'Concurrent admission idempotent',
      );
      const jobId = jobs[0].id;
      for (let i = 0; i < 3; i++) {
        const result = await worker(
          new Request(url + '/functions/v1/quizzes-process', {
            method: 'POST',
            headers: { authorization: `Bearer ${key}` },
          }),
        );
        assert(result.status === 200, 'Worker step');
      }
      const status = await (await invoke({ action: 'status', job_id: jobId })).json();
      assert(
        status.status === 'completed' && status.generated_count === 1,
        'Completed with fewer questions',
      );
      assert(calls === 3, 'Analysis, planning, generation');
      const quiz = await owner.client
        .from('learning_quizzes')
        .select('*')
        .eq('id', status.quiz_id)
        .single();
      assert(
        quiz.data &&
          quiz.data.questions[0].explanation === 'X ist B.' &&
          quiz.data.questions[0].sources[0].chunk_id === chunk.data.id,
        'Explanation and provenance',
      );
      const hidden = await other.client
        .from('learning_quizzes')
        .select('id')
        .eq('id', status.quiz_id);
      assert(!hidden.data?.length, 'Quiz RLS');
      const attempt = await owner.client.rpc('start_learning_quiz_attempt', {
        p_quiz: status.quiz_id,
        p_request_id: crypto.randomUUID(),
      });
      assert(!attempt.error, 'Start attempt');
      const partial = await owner.client.rpc('save_learning_quiz_attempt', {
        p_attempt: attempt.data.attempt_id,
        p_answers: [1],
        p_expected_revision: 1,
        p_submit: false,
      });
      assert(!partial.error, 'Autosave');
      const saved = await owner.client.rpc('save_learning_quiz_attempt', {
        p_attempt: attempt.data.attempt_id,
        p_answers: [1],
        p_expected_revision: partial.data.revision,
        p_submit: true,
      });
      assert(!saved.error && saved.data.score === 1, 'Server score');
      const usage = await owner.client.rpc('get_my_usage');
      assert(
        usage.data.usage.quizzes.used === 1 && usage.data.usage.chat.used === 0,
        'One quiz unit, no chat charge',
      );
      const replay = await (await invoke(body)).json();
      assert(replay.quiz_id === status.quiz_id && calls === 3, 'Completed replay');
    } finally {
      globalThis.fetch = original;
      for (const id of users) await admin.auth.admin.deleteUser(id);
    }
  },
);
