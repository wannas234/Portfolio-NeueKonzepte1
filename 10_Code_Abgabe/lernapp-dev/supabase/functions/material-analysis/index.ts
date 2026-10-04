import { createClient } from '@supabase/supabase-js';
import { answerConfiguration } from '../_shared/ai/config.ts';
import { requestAnswer, type AnswerResult } from '../_shared/ai/answers.ts';
import { recordUsageTokens } from '../_shared/usage.ts';
import { summaryHeaders, json, fail, uuid, readBody } from '../_shared/summary-http.ts';
import {
  analysisContext,
  analysisMessages,
  parseAnalysis,
  sourcePages,
  validateCalendarConfirmation,
  type AnalysisSource,
} from '../_shared/material-analysis.ts';

const statuses: Record<string, number> = {
  INVALID_REQUEST: 400,
  REQUEST_TOO_LARGE: 413,
  TARGET_NOT_FOUND: 404,
  ANALYSIS_NOT_FOUND: 404,
  ITEM_NOT_FOUND: 404,
  SOURCES_NOT_READY: 409,
  SOURCE_LIMIT_EXCEEDED: 413,
  REQUEST_CONFLICT: 409,
  SOURCE_CHANGED: 409,
  ANALYSIS_RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  ANALYSIS_NOT_READY: 409,
  ANALYSIS_EXPIRED: 409,
  DECISION_CONFLICT: 409,
  ANSWERS_NOT_CONFIGURED: 503,
};
function failure(error: unknown) {
  const code =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  return fail(statuses[code] ? code : 'ANALYSIS_UNAVAILABLE', statuses[code] ?? 503);
}
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
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
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
    const body = await readBody(req, 12000);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);
    if (body.action === 'analyze') {
      if (!uuid(body.request_id) || !uuid(body.material_id)) return fail('INVALID_REQUEST', 400);
      let context;
      try {
        context = analysisContext(body.context);
      } catch {
        return fail('INVALID_REQUEST', 400);
      }
      const config = { ...answerConfiguration(), maxOutputTokens: 8192 };
      const start = await admin.rpc('begin_material_analysis', {
        p_owner_id: user.id,
        p_request_id: body.request_id,
        p_material_id: body.material_id,
        p_context: context,
      });
      if (start.error) return failure(start.error);
      if (!start.data.run)
        return json(start.data.result, start.data.result.status === 'processing' ? 202 : 200);
      const job = start.data as {
        analysis_id: string;
        lease_token: string;
        source: AnalysisSource;
      };
      let items: Awaited<ReturnType<typeof parseAnalysis>> = [];
      let errorCode: string | null = null;
      let result: AnswerResult | undefined;
      try {
        result = await requestAnswer(
          analysisMessages(job.source, context),
          config,
          AbortSignal.timeout(55000),
          60000,
        );
        items = await parseAnalysis(result.answer, job.source, context);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        errorCode = [
          'INVALID_ANALYSIS_OUTPUT',
          'INVALID_ANALYSIS_SOURCE',
          'RESULT_LIMIT_EXCEEDED',
          'INCOMPLETE_ANSWER',
        ].includes(message)
          ? message
          : 'ANALYSIS_PROVIDER_UNAVAILABLE';
      }
      const warnings =
        sourcePages(job.source)[0]?.page === null
          ? [
              {
                code: 'page_references_unavailable',
                message: 'Für dieses Material sind keine verlässlichen Seitenangaben verfügbar.',
              },
            ]
          : [];
      const saved = await admin.rpc('finish_material_analysis', {
        p_owner_id: user.id,
        p_analysis_id: job.analysis_id,
        p_lease_token: job.lease_token,
        p_items: items,
        p_warnings: warnings,
        p_error: errorCode,
      });
      if (result)
        await recordUsageTokens(
          admin,
          user.id,
          'material_analysis',
          job.analysis_id,
          result.inputTokens,
          result.outputTokens,
        );
      if (saved.error) return failure(saved.error);
      return json(saved.data);
    }
    if (!uuid(body.analysis_id)) return fail('INVALID_REQUEST', 400);
    if (body.action === 'result') {
      const result = await admin.rpc('read_material_analysis', {
        p_owner_id: user.id,
        p_analysis_id: body.analysis_id,
      });
      return result.error
        ? failure(result.error)
        : json(result.data, result.data.status === 'processing' ? 202 : 200);
    }
    if (body.action === 'accept' || body.action === 'dismiss') {
      if (typeof body.item_id !== 'string' || !/^[a-f0-9]{64}$/.test(body.item_id))
        return fail('INVALID_REQUEST', 400);
      let event = null;
      if (body.action === 'accept') {
        try {
          event = validateCalendarConfirmation(body.event);
        } catch {
          return fail('INVALID_REQUEST', 400);
        }
      }
      const result = await admin.rpc('decide_material_analysis', {
        p_owner_id: user.id,
        p_analysis_id: body.analysis_id,
        p_item_id: body.item_id,
        p_action: body.action,
        p_event: event,
      });
      return result.error ? failure(result.error) : json(result.data);
    }
    return fail('INVALID_REQUEST', 400);
  } catch (error) {
    return failure(error);
  }
}
if (import.meta.main) Deno.serve(handler);
