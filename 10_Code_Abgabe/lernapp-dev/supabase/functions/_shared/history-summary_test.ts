import { createClient } from '@supabase/supabase-js';
import { boundedHistory, buildMessages } from './answers.ts';
import { summaryBatch, updateHistorySummary, type SequencedTurn } from './history-summary.ts';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const turns = (count: number, size = 20): SequencedTurn[] =>
  Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    role: i % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(size),
  }));

Deno.test(
  'Summary batches keep a bounded contiguous prefix; recent history keeps both original limits',
  () => {
    assert(summaryBatch(turns(50)).length === 20, 'message budget');
    assert(summaryBatch(turns(4, 8000)).length === 2, 'character budget');
    assert(
      boundedHistory(turns(12))
        .map((t) => t.seq)
        .join() === '3,4,5,6,7,8,9,10,11,12',
      'recent message limit',
    );
    assert(
      boundedHistory(turns(4, 2000))
        .map((t) => t.seq)
        .join() === '2,3,4',
      'recent character limit',
    );
    assert(boundedHistory(turns(2, 8000)).length === 0, 'oversized latest message');
    const short = turns(2);
    assert(
      JSON.stringify(buildMessages(short, 'Frage', [])) ===
        JSON.stringify(buildMessages(short, 'Frage', [], '')),
      'short prompt changed',
    );
    const prompt = buildMessages(short, 'Frage', [], 'Früheres Thema');
    assert(prompt.at(-1)?.content.includes('Früheres Thema'), 'summary missing');
    assert(!prompt[0].content.includes('Früheres Thema'), 'untrusted summary elevated to system');
  },
);

Deno.test(
  'Summary update reuses persisted progress, bounds backlog, falls back and propagates cancellation',
  async () => {
    const original = globalThis.fetch;
    try {
      for (const scenario of [
        'short',
        'backlog',
        'incremental',
        'provider_failure',
        'existing_failure',
        'invalid',
        'save_failure',
        'gap',
        'cancelled',
        'gemini',
      ]) {
        let state = ['incremental', 'existing_failure'].includes(scenario)
          ? { content: 'Bisheriger Kontext', through_seq: 20 }
          : null;
        let generated = 0;
        let saved = 0;
        const abort = new AbortController();
        const records = turns(scenario === 'short' ? 2 : 50);
        globalThis.fetch = (input, init) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith('/chat_history_summaries'))
            return Promise.resolve(Response.json(state));
          if (url.pathname.endsWith('/chat_messages')) {
            assert(
              new Headers(init?.headers).get('authorization') === 'Bearer user-key',
              'history bypassed RLS',
            );
            const filters = url.searchParams.getAll('seq');
            const from = Number(filters.find((v) => v.startsWith('gt.'))?.slice(3));
            const to = Number(filters.find((v) => v.startsWith('lt.'))?.slice(3));
            let rows = records.filter((t) => t.seq > from && t.seq < to).slice(0, 20);
            if (scenario === 'gap') rows = rows.slice(1);
            return Promise.resolve(Response.json(rows));
          }
          if (url.host === 'api.openai.com' || url.host === 'generativelanguage.googleapis.com') {
            generated++;
            const body = JSON.parse(String(init?.body));
            assert(
              (body.max_completion_tokens ?? body.generationConfig.maxOutputTokens) === 600,
              'output budget',
            );
            if (scenario === 'incremental')
              assert(JSON.stringify(body).includes('Bisheriger Kontext'), 'old summary lost');
            if (scenario === 'cancelled') {
              abort.abort();
              return Promise.reject(new DOMException('aborted', 'AbortError'));
            }
            if (['provider_failure', 'existing_failure'].includes(scenario))
              return Promise.resolve(Response.json({}, { status: 429 }));
            const content = scenario === 'invalid' ? 'x'.repeat(2001) : 'Neuer Kontext [1]';
            return Promise.resolve(
              Response.json(
                scenario === 'gemini'
                  ? {
                      modelVersion: 'test',
                      candidates: [
                        { finishReason: 'STOP', content: { parts: [{ text: content }] } },
                      ],
                    }
                  : { model: 'test', choices: [{ finish_reason: 'stop', message: { content } }] },
              ),
            );
          }
          if (url.pathname.endsWith('/save_chat_history_summary')) {
            saved++;
            assert(
              new Headers(init?.headers).get('authorization') === 'Bearer service-key',
              'client summary write',
            );
            const body = JSON.parse(String(init?.body));
            assert(body.p_previous_seq === (state?.through_seq ?? 0), 'wrong previous cursor');
            assert(
              body.p_through_seq === (state?.through_seq ?? 0) + 20,
              'backlog skipped or exceeded budget',
            );
            if (scenario === 'save_failure') return Promise.resolve(Response.json(false));
            state = { content: body.p_content, through_seq: body.p_through_seq };
            return Promise.resolve(Response.json(true));
          }
          throw new Error(`Unexpected ${url}`);
        };
        const options = {
          client: createClient('http://db.test', 'user-key'),
          admin: createClient('http://db.test', 'service-key'),
          lease: { conversationId: 'conversation', requestId: 'request', token: 'lease' },
          userId: 'user',
          beforeSeq: scenario === 'short' ? 1 : 41,
          config: {
            provider: scenario === 'gemini' ? ('gemini' as const) : ('openai' as const),
            model: 'test',
            key: 'key',
            maxOutputTokens: 800,
            questionsPerMinute: 6,
            concurrentResponsesPerUser: 1,
          },
          signal: abort.signal,
        };
        if (scenario === 'cancelled') {
          let rejected = false;
          try {
            await updateHistorySummary(options);
          } catch {
            rejected = true;
          }
          assert(rejected && saved === 0, 'cancellation swallowed');
          continue;
        }
        const result = await updateHistorySummary(options);
        const success = ['backlog', 'incremental', 'gemini'].includes(scenario);
        assert(
          result ===
            (success
              ? 'Neuer Kontext'
              : scenario === 'existing_failure'
                ? 'Bisheriger Kontext'
                : ''),
          `${scenario}: incorrect fallback/result`,
        );
        assert(
          generated === (['short', 'gap'].includes(scenario) ? 0 : 1),
          `${scenario}: extra generation`,
        );
        assert(
          saved === (success || scenario === 'save_failure' ? 1 : 0),
          `${scenario}: invalid write`,
        );
        if (scenario === 'incremental') {
          assert(
            (await updateHistorySummary(options)) === 'Neuer Kontext',
            'persisted summary not reused',
          );
          assert(generated === 1, 'already summarized messages generated again');
        }
      }
    } finally {
      globalThis.fetch = original;
    }
  },
);
