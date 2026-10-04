import { createClient } from '@supabase/supabase-js';
import { configuration } from '../_shared/quiz-generation.ts';
import { summaryProvider } from '../_shared/summary-generation.ts';
import { fail, json, readBody, summaryHeaders, uuid } from '../_shared/summary-http.ts';

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: summaryHeaders });
  }
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  const authorization = req.headers.get('authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) {
    return fail('UNAUTHENTICATED', 401);
  }
  try {
    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
      },
    };
    const url = Deno.env.get('SUPABASE_URL')!;
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      ...options,
      global: { ...options.global, headers: { Authorization: authorization } },
    });
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error || !user) return fail('UNAUTHENTICATED', 401);
    const body = await readBody(req, 900000);
    if (!['list', 'status', 'generate', 'retry', 'cancel'].includes(String(body.action)))
      return fail('INVALID_REQUEST', 400);
    if (
      !uuid(
        ['list', 'generate'].includes(String(body.action)) ? body.source_material_id : body.job_id,
      )
    )
      return fail('INVALID_REQUEST', 400);
    let config;
    if (body.action === 'generate') {
      if (
        !uuid(body.request_id) ||
        !Number.isInteger(body.count) ||
        Number(body.count) < 1 ||
        Number(body.count) > 10
      )
        return fail('INVALID_REQUEST', 400);
      config = configuration();
      summaryProvider({ ...config, version: 'summary-v1' });
    }
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);
    const result = await admin.rpc('quiz_action', {
      p_owner: user.id,
      p_body: body,
      p_configuration: config ?? null,
    });
    if (result.error) {
      const codes: Record<string, number> = {
        TARGET_NOT_FOUND: 404,
        INVALID_REQUEST: 400,
        REQUEST_CONFLICT: 409,
        SOURCES_NOT_READY: 409,
        SOURCE_CHANGED: 409,
        SOURCE_LIMIT_EXCEEDED: 413,
        RATE_LIMITED: 429,
        NO_LEARNING_CONTENT: 422,
        QUOTA_EXCEEDED: 429,
        NEW_REQUEST_REQUIRED: 409,
      };
      return fail(
        codes[result.error.message] ? result.error.message : 'QUIZZES_UNAVAILABLE',
        codes[result.error.message] ?? 503,
      );
    }
    return json(result.data);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (['INVALID_REQUEST', 'REQUEST_TOO_LARGE'].includes(code)) {
      return fail(code, 400);
    }
    return fail('QUIZZES_UNAVAILABLE', 503);
  }
}
if (import.meta.main) Deno.serve(handler);
