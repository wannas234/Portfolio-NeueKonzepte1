import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  embedTexts,
  assertEmbeddingConfiguration,
  embeddingContract,
} from '../_shared/embeddings.ts';
import {
  boundedHistory,
  buildMessages,
  citedSources,
  MAX_EXCERPT_LENGTH,
  MAX_HISTORY_MESSAGES,
  MAX_QUESTION_LENGTH,
  type Passage,
  retrievalQuery,
} from '../_shared/answers.ts';

import { requestAnswer, type AnswerResult } from '../_shared/ai/answers.ts';
import { updateHistorySummary, type SequencedTurn } from '../_shared/history-summary.ts';
import { answerConfiguration } from '../_shared/ai/config.ts';
import { consumeUsage, recordUsageTokens } from '../_shared/usage.ts';

const RETRIEVAL_LIMIT = 8;
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const fail = (code: string, status: number, retryAfter?: number) => {
  const response = json(
    { error: { code, ...(retryAfter ? { retry_after_seconds: retryAfter } : {}) } },
    status,
  );
  if (retryAfter) response.headers.set('retry-after', String(retryAfter));
  return response;
};
const failures: Record<string, number> = {
  REQUEST_ID_CONFLICT: 409,
  REQUEST_IN_PROGRESS: 409,
  CONVERSATION_BUSY: 409,
  REQUEST_LEASE_EXPIRED: 409,
  RATE_LIMITED: 429,
  CONCURRENCY_LIMIT: 429,
  QUOTA_EXCEEDED: 429,
  CONVERSATION_NOT_FOUND: 404,
  MATERIAL_NOT_FOUND: 404,
  NO_INDEXED_MATERIAL: 409,
  NO_RELEVANT_MATERIAL: 409,
  ANSWERS_NOT_CONFIGURED: 503,
  ANSWERS_UNAVAILABLE: 503,
  EMBEDDINGS_NOT_CONFIGURED: 503,
  EMBEDDING_CONTRACT_MISMATCH: 503,
  INVALID_CITATION: 503,
  INCOMPLETE_ANSWER: 503,
  INVALID_ANSWER_RESPONSE: 503,
  REQUEST_CANCELLED: 503,
};
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const authorization = req.headers.get('authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) return fail('UNAUTHENTICATED', 401);
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  let lease: { conversationId: string; requestId: string; token: string } | undefined;
  let admin: SupabaseClient | undefined;
  let result: AnswerResult | undefined;
  let stage = 'reserved';
  const started = performance.now();
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(120000)]);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const timeout = (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization }, fetch: timeout },
    });
    const user = await client.auth.getUser();
    if (user.error || !user.data.user) return fail('UNAUTHENTICATED', 401);
    const reader = req.body?.getReader();
    let text = '';
    let size = 0;
    const decoder = new TextDecoder();
    if (reader) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 10000) return fail('INVALID_REQUEST', 413);
          text += decoder.decode(value, { stream: true });
        }
      } finally {
        await reader.cancel();
      }
    }
    let body;
    try {
      body = JSON.parse(text + decoder.decode());
    } catch {
      return fail('INVALID_REQUEST', 400);
    }
    if (
      !body ||
      !uuid(body.conversation_id) ||
      !uuid(body.request_id) ||
      typeof body.question !== 'string' ||
      !body.question.trim() ||
      body.question.length > MAX_QUESTION_LENGTH ||
      (body.material_ids !== undefined &&
        (!Array.isArray(body.material_ids) ||
          body.material_ids.length === 0 ||
          body.material_ids.length > 100 ||
          !body.material_ids.every(uuid)))
    )
      return fail('INVALID_REQUEST', 400);

    const materialIds: string[] | null =
      body.material_ids === undefined
        ? null
        : [...new Set<string>(body.material_ids.map((id: string) => id.toLowerCase()))].sort();

    // Establish access before anything is paid for, then keep using the same
    // user JWT so RLS still applies if ownership changes in between.
    const conversation = await client
      .from('chat_conversations')
      .select('id,course_id')
      .eq('id', body.conversation_id)
      .maybeSingle();
    if (conversation.error) throw conversation.error;
    if (!conversation.data) return fail('CONVERSATION_NOT_FOUND', 404);

    // A lost response must not cost a second answer. The unique index alone
    // would only reject the duplicate after both calls were billed.
    const replay = await client.rpc('chat_exchange', {
      p_conversation_id: body.conversation_id,
      p_request_id: body.request_id,
      p_material_ids: materialIds,
    });
    if (replay.error) {
      if (replay.error.message === 'REQUEST_ID_CONFLICT') return fail('REQUEST_ID_CONFLICT', 409);
      throw replay.error;
    }
    const question = body.question.trim();
    if (replay.data) {
      if (replay.data.messages?.[0]?.content !== question) return fail('REQUEST_ID_CONFLICT', 409);
      return json(replay.data);
    }
    if (materialIds) {
      const selected = await client
        .from('materials')
        .select('id')
        .eq('course_id', conversation.data.course_id)
        .in('id', materialIds);
      if (selected.error) throw selected.error;
      if (selected.data?.length !== materialIds.length) return fail('MATERIAL_NOT_FOUND', 404);
    }
    assertEmbeddingConfiguration();
    const config = answerConfiguration();
    const key = Deno.env.get('GEMINI_API_KEY')?.trim();
    if (!key) return fail('EMBEDDINGS_NOT_CONFIGURED', 503);
    // Cleanup must work even after the request deadline/client disconnect.
    admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
      },
    });
    signal.throwIfAborted();
    const reserved = await admin.rpc('reserve_chat_request', {
      p_user_id: user.data.user.id,
      p_conversation_id: body.conversation_id,
      p_request_id: body.request_id,
      p_question: question,
      p_material_ids: materialIds,
      p_provider: config.provider,
      p_model: config.model,
      p_questions_per_minute: config.questionsPerMinute,
      p_concurrent_responses: config.concurrentResponsesPerUser,
    });
    if (reserved.error) {
      if (reserved.error.code === 'P0002') throw new Error('CONVERSATION_NOT_FOUND');
      throw reserved.error;
    }
    if (reserved.data?.exchange) return json(reserved.data.exchange);
    if (reserved.data?.code)
      return fail(
        reserved.data.code,
        failures[reserved.data.code] ?? 503,
        reserved.data.retry_after_seconds,
      );
    if (!uuid(reserved.data?.lease_token)) throw new Error('CHAT_UNAVAILABLE');
    lease = {
      conversationId: body.conversation_id,
      requestId: body.request_id,
      token: reserved.data.lease_token,
    };
    signal.throwIfAborted();
    stage = 'history';

    const previous = await client
      .from('chat_messages')
      .select('seq,role,content')
      .eq('conversation_id', body.conversation_id)
      .order('seq', { ascending: false })
      .limit(MAX_HISTORY_MESSAGES);
    if (previous.error) throw previous.error;
    const history = boundedHistory(([...(previous.data ?? [])] as SequencedTurn[]).reverse());

    let indexedQuery = client
      .from('source_documents')
      .select('id,materials!source_documents_material_id_fkey!inner(course_id)')
      .eq('materials.course_id', conversation.data.course_id)
      .eq('indexing_status', 'ready')
      .limit(1);
    if (materialIds) indexedQuery = indexedQuery.in('material_id', materialIds);
    const indexed = await indexedQuery;
    if (indexed.error) throw indexed.error;
    if (!indexed.data?.length) throw new Error('NO_INDEXED_MATERIAL');
    // Gespeicherte Antworten wurden oben bereits ohne Provider-Aufruf zurueckgegeben.
    // Jede neue Ausfuehrung wird separat gezaehlt, auch nach Fehlern oder Chat-Loeschung.
    const usageKey = crypto.randomUUID();
    const usage = await consumeUsage(admin, user.data.user.id, 'chat', usageKey);
    if (!usage.allowed) throw new Error('QUOTA_EXCEEDED');
    stage = 'embedding';
    signal.throwIfAborted();
    const [vector] = await embedTexts([retrievalQuery(history, question)], key, signal, 'query');
    stage = 'retrieval';
    const matches = await client.rpc('search_document_chunks', {
      ...embeddingContract,
      p_course_id: conversation.data.course_id,
      p_query: question,
      p_material_ids: materialIds,
      p_embedding: JSON.stringify(vector),
      p_limit: RETRIEVAL_LIMIT,
      p_min_similarity: 0,
    });
    if (matches.error) throw matches.error;
    if (!matches.data?.length) throw new Error('NO_RELEVANT_MATERIAL');

    // Titles come from the material, the page from the chunk: "Vorlesung 03, S. 17".
    const titles = await client
      .from('materials')
      .select('id,title')
      .in('id', [
        ...new Set(matches.data.map((match: { material_id: string }) => match.material_id)),
      ]);
    if (titles.error) throw titles.error;
    const titleById = new Map<string, string>(
      (titles.data ?? []).map((material: { id: string; title: string }) => [
        material.id,
        material.title,
      ]),
    );
    const passages: Passage[] = [];
    for (const match of matches.data) {
      const title = titleById.get(match.material_id);
      if (!title) continue;
      passages.push({
        citation_no: passages.length + 1,
        chunk_id: match.id,
        source_document_id: match.document_id,
        material_id: match.material_id,
        material_title: title,
        page_number: match.page_number,
        excerpt: match.content.slice(0, MAX_EXCERPT_LENGTH),
        similarity: match.similarity,
      });
    }
    if (!passages.length) throw new Error('NO_RELEVANT_MATERIAL');

    stage = 'history';
    const summary = await updateHistorySummary({
      client,
      admin,
      lease,
      userId: user.data.user.id,
      config,
      signal,
      beforeSeq: history[0]?.seq ?? (previous.data?.[0]?.seq ?? 0) + 1,
    });
    stage = 'answer';
    signal.throwIfAborted();
    result = await requestAnswer(
      buildMessages(history, question, passages, summary),
      config,
      signal,
    );
    stage = 'citations';
    const sources = citedSources(result.answer, passages);
    stage = 'persist';
    signal.throwIfAborted();
    const stored = await admin.rpc('complete_chat_request', {
      p_user_id: user.data.user.id,
      p_conversation_id: lease.conversationId,
      p_request_id: lease.requestId,
      p_lease_token: lease.token,
      p_question: question,
      p_answer: result.answer,
      p_model: result.model,
      p_input_tokens: result.inputTokens,
      p_output_tokens: result.outputTokens,
      p_sources: sources,
    });
    if (stored.error) {
      if (stored.error.code === 'P0002') throw new Error('CONVERSATION_NOT_FOUND');
      if (stored.error.code === 'P0001') throw new Error('REQUEST_LEASE_EXPIRED');
      throw stored.error;
    }
    await recordUsageTokens(
      admin,
      user.data.user.id,
      'chat',
      usageKey,
      result.inputTokens,
      result.outputTokens,
    );
    console.info(
      JSON.stringify({
        event: 'chat_completed',
        request_id: lease.requestId,
        provider: result.provider,
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        duration_ms: Math.round(performance.now() - started),
        source_count: sources.length,
      }),
    );
    return json(stored.data);
  } catch (error) {
    const code = req.signal.aborted
      ? 'REQUEST_CANCELLED'
      : error instanceof Error && Object.hasOwn(failures, error.message)
        ? error.message
        : 'CHAT_UNAVAILABLE';
    if (admin && lease) {
      try {
        const failed = await admin.rpc('fail_chat_request', {
          p_conversation_id: lease.conversationId,
          p_request_id: lease.requestId,
          p_lease_token: lease.token,
          p_error_code: code,
          p_stage: stage,
          p_cancelled: req.signal.aborted,
          p_input_tokens: result?.inputTokens ?? null,
          p_output_tokens: result?.outputTokens ?? null,
        });
        if (failed.error) throw failed.error;
      } catch {
        console.error(
          JSON.stringify({ event: 'chat_cleanup_failed', request_id: lease.requestId }),
        );
      }
    }
    console.error(
      JSON.stringify({
        event: 'chat_failed',
        request_id: lease?.requestId,
        code,
        stage,
        error_type: error instanceof Error ? error.name : typeof error,
        duration_ms: Math.round(performance.now() - started),
      }),
    );
    return fail(code, failures[code] ?? 503, code === 'REQUEST_LEASE_EXPIRED' ? 2 : undefined);
  }
}
if (import.meta.main) Deno.serve(handler);
