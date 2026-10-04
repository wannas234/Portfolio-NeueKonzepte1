import { createClient } from '@supabase/supabase-js';
import { summaryConfiguration, summaryProvider } from '../_shared/summary-generation.ts';
import {
  summaryHeaders,
  json,
  fail,
  uuid,
  readBody,
  databaseFailure,
} from '../_shared/summary-http.ts';

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: summaryHeaders });
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  const authorization = req.headers.get('authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) return fail('UNAUTHENTICATED', 401);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
      },
    };
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      ...options,
      global: { ...options.global, headers: { Authorization: authorization } },
    });
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error || !user) return fail('UNAUTHENTICATED', 401);
    const body = await readBody(req);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);
    let result;
    if (body.action === 'generate') {
      const target = body.target as
        { type?: unknown; source_document_id?: unknown; course_id?: unknown } | undefined;
      if (
        !uuid(body.request_id) ||
        !target ||
        !['document', 'course'].includes(String(target.type))
      )
        return fail('INVALID_REQUEST', 400);
      const id = target.type === 'document' ? target.source_document_id : target.course_id;
      if (
        !uuid(id) ||
        (target.type === 'document'
          ? target.course_id !== undefined
          : target.source_document_id !== undefined)
      )
        return fail('INVALID_REQUEST', 400);
      const config = summaryConfiguration();
      summaryProvider(config); // Fail before enqueuing work with unusable credentials/config.
      result = await admin.rpc('enqueue_summary', {
        p_owner_id: user.id,
        p_request_id: body.request_id,
        p_kind: target.type,
        p_target_id: id,
        p_configuration: config,
      });
    } else if (body.action === 'status' || body.action === 'retry') {
      if (!uuid(body.job_id)) return fail('INVALID_REQUEST', 400);
      result = await admin.rpc(body.action === 'retry' ? 'retry_summary' : 'read_summary', {
        p_owner_id: user.id,
        p_job_id: body.job_id,
      });
    } else if (body.action === 'result') {
      if (!uuid(body.summary_id)) return fail('INVALID_REQUEST', 400);
      result = await admin.rpc('read_summary', {
        p_owner_id: user.id,
        p_summary_id: body.summary_id,
      });
    } else return fail('INVALID_REQUEST', 400);
    if (result.error) return databaseFailure(result.error);
    return json(
      result.data,
      ['generate', 'retry'].includes(String(body.action)) &&
        ['queued', 'processing'].includes(result.data.status)
        ? 202
        : 200,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (['INVALID_REQUEST', 'REQUEST_TOO_LARGE'].includes(code))
      return fail(code, code === 'REQUEST_TOO_LARGE' ? 413 : 400);
    if (['SUMMARIES_NOT_CONFIGURED', 'ANSWERS_NOT_CONFIGURED'].includes(code))
      return fail('SUMMARIES_NOT_CONFIGURED', 503);
    return fail('SUMMARIES_UNAVAILABLE', 503);
  }
}
if (import.meta.main) Deno.serve(handler);
