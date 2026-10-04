import { createClient } from '@supabase/supabase-js';
import {
  embedTexts,
  assertEmbeddingConfiguration,
  embeddingContract,
} from '../_shared/embeddings.ts';
import { consumeUsage } from '../_shared/usage.ts';

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
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const authorization = req.headers.get('authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) return fail('UNAUTHENTICATED', 401);
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: authorization },
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
      },
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
      !uuid(body.course_id) ||
      (body.request_id !== undefined && !uuid(body.request_id)) ||
      typeof body.query !== 'string' ||
      !body.query.trim() ||
      body.query.length > 1800 ||
      (body.limit !== undefined &&
        (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 50)) ||
      (body.min_similarity !== undefined &&
        (typeof body.min_similarity !== 'number' ||
          !Number.isFinite(body.min_similarity) ||
          body.min_similarity < -1 ||
          body.min_similarity > 1))
    )
      return fail('INVALID_REQUEST', 400);
    // Check access before generating a paid query embedding, then retrieve with
    // the same user JWT so RLS also applies if ownership changes in between.
    const course = await client.from('courses').select('id').eq('id', body.course_id).maybeSingle();
    if (course.error) throw course.error;
    if (!course.data) return fail('COURSE_NOT_FOUND', 404);
    assertEmbeddingConfiguration();
    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) return fail('EMBEDDINGS_NOT_CONFIGURED', 503);
    // Jeder neue Provider-Aufruf kostet eine Einheit. Client-IDs sind keine
    // Verbrauchsschluessel: ohne Ergebnis-Cache ist auch ein Retry neue Arbeit.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input: RequestInfo | URL, init?: RequestInit) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
        },
      },
    );
    const usage = await consumeUsage(admin, user.data.user.id, 'search', crypto.randomUUID());
    if (!usage.allowed)
      return usage.code === 'RATE_LIMITED'
        ? fail('RATE_LIMITED', 429, usage.retryAfterSeconds)
        : fail('QUOTA_EXCEEDED', 429);
    const [vector] = await embedTexts([body.query.trim()], key, undefined, 'query');
    const matches = await client.rpc('search_document_chunks', {
      ...embeddingContract,
      p_course_id: body.course_id,
      p_query: body.query.trim(),
      p_embedding: JSON.stringify(vector),
      p_limit: body.limit ?? 10,
      p_min_similarity: body.min_similarity ?? 0,
    });
    if (matches.error) throw matches.error;
    return json({ matches: matches.data });
  } catch {
    return fail('SEARCH_UNAVAILABLE', 503);
  }
}
if (import.meta.main) Deno.serve(handler);
