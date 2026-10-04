import { createClient } from '@supabase/supabase-js';
import { handler } from '../supabase/functions/flashcards/index.ts';
import { handler as worker } from '../supabase/functions/flashcards-process/index.ts';
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
Deno.test(
  'Course cards: automatic estimate, resumable generation, authorization and atomic idempotent save',
  async () => {
    const url = Deno.env.get('SUPABASE_URL')!;
    assert(new URL(url).hostname === '127.0.0.1', 'Local only');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const pending = await admin
      .from('flashcard_jobs')
      .select('id')
      .in('status', ['queued', 'processing']);
    assert(!pending.error && !pending.data.length, 'No active flashcard jobs before test');
    const users: string[] = [];
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = (input, init) => {
      if (String(input).startsWith('https://api.openai.com/')) {
        providerCalls++;
        const request = JSON.parse(String(init?.body));
        const payload = JSON.parse(request.messages[1].content);
        let result;
        if (request.messages[0].content.includes('nullbasierten')) {
          result = { indices: payload.map((_: unknown, i: number) => i) };
        } else if (Array.isArray(payload)) result = { cards: payload };
        else {
          result = {
            cards: [
              {
                question: 'Was lehrt ' + payload.source_ids[0] + '?',
                answer: 'Ein Lerninhalt.',
                source_ids: payload.source_ids,
              },
            ],
          };
        }
        return Promise.resolve(
          Response.json({
            model: 'deterministic-test-only',
            choices: [
              {
                finish_reason: 'stop',
                message: { content: JSON.stringify(result) },
              },
            ],
            usage: { prompt_tokens: 30, completion_tokens: 40 },
          }),
        );
      }
      assert(new URL(String(input)).hostname === '127.0.0.1', 'No external network');
      return originalFetch(input, init);
    };
    try {
      const user = async () => {
        const email = `summary-${crypto.randomUUID()}@example.com`;
        const password = 'Local-summary-test-123!';
        const created = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        assert(created.data.user && !created.error, 'Create fixture user');
        users.push(created.data.user.id);
        const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const login = await client.auth.signInWithPassword({ email, password });
        assert(login.data.session && !login.error, 'Login fixture user');
        return {
          id: created.data.user.id,
          token: login.data.session.access_token,
          client,
        };
      };
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
        const lease = await admin.rpc('claim_document_processing', {
          p_document_id: documentId,
        });
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
      const call = async (body: unknown, token = owner.token) => {
        const response = await handler(
          new Request(`${url}/functions/v1/flashcards`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          }),
        );
        return { status: response.status, data: await response.json() };
      };
      const available = await call({ action: 'documents', course_id: courseId });
      assert(
        available.status === 200 &&
          available.data.length === 2 &&
          available.data.every((d: { ready: boolean }) => d.ready),
        'Ready document selection',
      );
      const body = {
        action: 'analyze',
        course_id: courseId,
        document_ids: documents,
        request_id: crypto.randomUUID(),
        count: null,
      };
      const admitted = await Promise.all(Array.from({ length: 5 }, () => call(body)));
      assert(
        admitted.every((r) => r.status === 200 && r.data.id === admitted[0].data.id),
        'Concurrent admission deduplicated',
      );
      const id = admitted[0].data.id;
      assert((await call(body, other.token)).status === 404, 'Foreign course denied');
      assert(
        (await call({ action: 'status', job_id: id }, other.token)).status === 404,
        'Foreign job denied',
      );
      const direct = await owner.client.rpc('flashcard_action', {
        p_owner: other.id,
        p_body: body,
      });
      assert(!!direct.error, 'Owner RPC cannot be spoofed by authenticated users');
      assert(
        (await call({ ...body, count: 20 })).status === 409,
        'Same request with changed payload rejected',
      );
      assert(
        (await worker(new Request(url, { method: 'POST' }))).status === 401,
        'Worker requires secret',
      );
      const tick = async () => {
        const response = await worker(
          new Request(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}` },
          }),
        );
        assert(response.status === 200, 'Worker step succeeds');
      };
      for (let i = 0; i < 6; i++) {
        await tick();
        const state = await call({ action: 'status', job_id: id });
        if (state.data.status === 'estimated') break;
      }
      const estimate = await call({ action: 'status', job_id: id });
      assert(
        estimate.data.status === 'estimated' &&
          estimate.data.estimated_count === 2 &&
          estimate.data.cards.length === 0,
        'Content-driven estimate before generation',
      );
      const calls = providerCalls;
      await tick();
      assert(providerCalls === calls, 'Estimate waits for user confirmation');
      const resumed = await call({ action: 'list', course_id: courseId });
      assert(resumed.data[0].id === id, 'Job survives page change');
      await call({ action: 'generate', job_id: id });
      await tick();
      const review = await call({ action: 'status', job_id: id });
      assert(review.data.status === 'review' && review.data.cards.length === 2, 'Editable review');
      assert(
        review.data.sources.every(
          (s: { page: number; file_id: string }) => s.page === 1 && !!s.file_id,
        ),
        'Page and document provenance',
      );
      const save = {
        action: 'save',
        job_id: id,
        title: 'Reviewed cards',
        cards: review.data.cards.map((c: { id: string; question: string; answer: string }) => ({
          id: c.id,
          question: c.question,
          answer: c.answer,
        })),
      };
      const bad = await call({
        ...save,
        cards: [save.cards[0], { id: 'forged', question: 'Bad', answer: 'Bad' }],
      });
      assert(bad.status === 400, 'Unrecognized card rejected');
      const empty = await admin
        .from('materials')
        .select('id')
        .eq('course_id', courseId)
        .eq('type', 'flashcard_deck');
      assert(empty.data?.length === 0, 'Failed save rolls back material and deck');
      save.cards[0].answer = 'Edited before saving';
      const saves = await Promise.all([call(save), call(save)]);
      assert(
        saves.every((r) => r.status === 200 && r.data.status === 'completed') &&
          saves[0].data.material_id === saves[1].data.material_id,
        'Save idempotent',
      );
      const saved = await admin
        .from('flashcard_decks')
        .select('id,flashcards(id,question,answer,additional_content)')
        .eq('material_id', saves[0].data.material_id)
        .single();
      assert(
        saved.data?.flashcards.length === 2 &&
          saved.data.flashcards.some((c) => c.answer === 'Edited before saving'),
        'All edited cards saved together',
      );
      assert(
        saved.data.flashcards.every((c) => c.additional_content.sources.length > 0),
        'Provenance persisted',
      );
      const generatedCard = saved.data.flashcards[0].id;
      const reviewRequest = {
        p_card: generatedCard,
        p_known: true,
        p_request_id: crypto.randomUUID(),
      };
      const reviews = await Promise.all([
        owner.client.rpc('record_flashcard_review', reviewRequest),
        owner.client.rpc('record_flashcard_review', reviewRequest),
      ]);
      assert(
        reviews.every((r) => !r.error && r.data.repetition_count === 1),
        'Generated card review retries are idempotent',
      );
      const counts = await owner.client.rpc('learning_deck_progress_counts', {
        p_material_ids: [saves[0].data.material_id],
      });
      assert(
        !counts.error &&
          counts.data[0].total === 2 &&
          counts.data[0].new === 1 &&
          counts.data[0].known === 1,
        'Generated deck progress is counted',
      );
      const forbiddenReview = await other.client.rpc('record_flashcard_review', {
        ...reviewRequest,
        p_request_id: crypto.randomUUID(),
      });
      assert(forbiddenReview.error?.code === '42501', 'Foreign generated card review rejected');
      const renamed = await owner.client.rpc('update_learning_deck', {
        p_material: saves[0].data.material_id,
        p_title: 'Renamed generated deck',
        p_description: 'Study session',
      });
      assert(!renamed.error, 'Generated deck can be renamed through the shared RPC');
      const foreign = await other.client
        .from('flashcards')
        .select('id')
        .eq('deck_id', saved.data.id);
      assert(foreign.data?.length === 0, 'Saved cards isolated');
      const second = await call({
        ...body,
        request_id: crypto.randomUUID(),
        count: 20,
      });
      assert(second.status === 200, 'Manual count accepted');
      const changed = await admin
        .from('source_documents')
        .update({
          extracted_text: 'Changed',
        })
        .eq('id', documents[0]);
      assert(!changed.error, 'Mutate source');
      await tick();
      assert(
        (await call({ action: 'status', job_id: second.data.id })).data.error_code ===
          'SOURCE_CHANGED',
        'Changed sources cannot publish',
      );
      assert(
        (await call({ action: 'cancel', job_id: second.data.id })).data.status === 'cancelled',
        'Failed job can be discarded',
      );
      const third = await call({
        ...body,
        document_ids: [documents[1]],
        request_id: crypto.randomUUID(),
        count: 1,
      });
      assert(third.status === 200, 'Budget fixture admitted');
      const claimed = await admin.rpc('claim_flashcard_job');
      assert(!claimed.error && claimed.data.id === third.data.id, 'Worker lease acquired');
      const args = { p_job: third.data.id, p_lease: claimed.data.lease_token, p_tokens: 100 };
      const wrong = await admin.rpc('reserve_flashcard_call', {
        ...args,
        p_lease: crypto.randomUUID(),
      });
      assert(wrong.data === false, 'Wrong lease cannot spend');
      const reserved = await admin.rpc('reserve_flashcard_call', args);
      assert(reserved.data === true, 'Current lease reserves budget');
      const exceeded = await admin.rpc('reserve_flashcard_call', { ...args, p_tokens: 10000001 });
      assert(exceeded.data === false, 'Budget cannot be exceeded');
      const budgetState = await call({ action: 'status', job_id: third.data.id });
      assert(
        budgetState.data.error_code === 'BUDGET_EXCEEDED',
        'Budget failure is recoverable through a new selection',
      );
      const late = await admin.rpc('save_flashcard_step', {
        p_job: third.data.id,
        p_lease: claimed.data.lease_token,
        p_checkpoint: {},
        p_status: 'review',
      });
      assert(late.data === false, 'A failed lease cannot publish');
      assert(
        (await call({ action: 'retry', job_id: third.data.id })).status === 409,
        'Retry cannot reset a paid budget',
      );
    } finally {
      for (const id of users.reverse()) {
        const result = await admin.auth.admin.deleteUser(id);
        assert(!result.error, 'Remove fixture');
      }
      globalThis.fetch = originalFetch;
    }
  },
);
