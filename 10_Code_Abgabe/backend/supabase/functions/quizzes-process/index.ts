import { createClient } from '@supabase/supabase-js';
import { isWorkerRequest } from '../_shared/worker-auth.ts';
import { requestAnswer } from '../_shared/ai/answers.ts';
import { type SummaryConfiguration, summaryProvider } from '../_shared/summary-generation.ts';
import {
  apply,
  type Checkpoint,
  type Snapshot,
  messages,
  plan,
} from '../_shared/quiz-generation.ts';
import { fail, json } from '../_shared/summary-http.ts';

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  if (!isWorkerRequest(req)) return fail('UNAUTHENTICATED', 401);
  try {
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
    const claim = await admin.rpc('claim_quiz_job');
    if (claim.error) throw claim.error;
    if (!claim.data) return json({ processed: false });
    const job = claim.data as {
      id: string;
      lease_token: string;
      sources: Snapshot;
      checkpoint: Checkpoint | null;
      configuration: SummaryConfiguration;
      phase: 'analyze' | 'generate';
      requested_count: number;
    };
    const cp = job.checkpoint ?? plan(job.sources);
    let status: string;
    let errorCode: string | null = null;
    try {
      if (job.phase === 'analyze' && cp.analyzed === cp.chunks.length && !cp.points.length)
        throw new Error('NO_LEARNING_CONTENT');
      const prompt = messages(cp, job.phase, job.requested_count);
      const tokens =
        (new TextEncoder().encode(JSON.stringify(prompt)).length +
          job.configuration.maxOutputTokens +
          256) *
        2;
      const reservation = await admin.rpc('reserve_quiz_call', {
        p_job: job.id,
        p_lease: job.lease_token,
        p_tokens: tokens,
      });
      if (reservation.error) throw reservation.error;
      if (!reservation.data) return json({ processed: false });
      const answer = await requestAnswer(
        prompt,
        summaryProvider({ ...job.configuration, version: 'summary-v1' }),
        AbortSignal.timeout(55000),
      );
      status = apply(cp, job.phase, answer.answer, job.requested_count);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (!['POINT_LIMIT_EXCEEDED', 'NO_LEARNING_CONTENT'].includes(code)) {
        throw error;
      }
      status = 'failed';
      errorCode = code;
    }
    const result = await admin.rpc('save_quiz_step', {
      p_job: job.id,
      p_lease: job.lease_token,
      p_checkpoint: cp,
      p_status: status,
      p_error: errorCode,
    });
    if (result.error) throw result.error;
    return json({ processed: result.data === true });
  } catch {
    return fail('QUIZZES_PROCESSING_UNAVAILABLE', 503);
  }
}
if (import.meta.main) Deno.serve(handler);
