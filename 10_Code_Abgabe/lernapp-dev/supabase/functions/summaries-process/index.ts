import { createClient } from '@supabase/supabase-js';
import { isWorkerRequest } from '../_shared/worker-auth.ts';
import { requestAnswer } from '../_shared/ai/answers.ts';
import {
  planSummary,
  summaryMessages,
  parseSummary,
  stepBudget,
  finalSummary,
  summaryProvider,
  type SummaryCheckpoint,
  type SummaryConfiguration,
  type SourceDocument,
} from '../_shared/summary-generation.ts';
import { json, fail } from '../_shared/summary-http.ts';

export interface SummaryJob {
  id: string;
  lease_token: string;
  kind: 'document' | 'course';
  sources: SourceDocument[];
  configuration: SummaryConfiguration;
  checkpoint: SummaryCheckpoint | null;
}
export async function processStep(
  job: SummaryJob,
  generate: typeof requestAnswer = requestAnswer,
  reserve: (tokens: number) => Promise<boolean> = () => Promise.resolve(true),
) {
  const started = performance.now();
  const checkpoint = job.checkpoint ?? planSummary(job.sources, job.kind);
  const messages = summaryMessages(checkpoint);
  const reserved = stepBudget(checkpoint, job.configuration, messages);
  const provider = summaryProvider(job.configuration);
  if (!(await reserve(reserved))) throw new Error('SUMMARY_RESERVATION_REJECTED');
  const result = await generate(messages, provider, AbortSignal.timeout(55000));
  const task = checkpoint.tasks[checkpoint.outputs.length];
  const output = parseSummary(result.answer, task.source_ids);
  checkpoint.outputs.push(output);
  checkpoint.reservedTokens += reserved;
  console.info(
    JSON.stringify({
      event: 'summary_step',
      duration_ms: Math.round(performance.now() - started),
      job_id: job.id,
      phase: task.phase,
      provider: result.provider,
      model: result.model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    }),
  );
  const done = checkpoint.outputs.length === checkpoint.tasks.length;
  return {
    p_checkpoint: checkpoint,
    p_completed: checkpoint.outputs.length,
    p_total: checkpoint.tasks.length,
    p_phase: done ? 'completed' : task.phase,
    p_content: done ? finalSummary(checkpoint) : null,
  };
}
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
    const claim = await admin.rpc('claim_summary');
    if (claim.error) throw claim.error;
    if (!claim.data) return json({ processed: false });
    const job = claim.data as SummaryJob;
    let step;
    try {
      step = await processStep(job, requestAnswer, async (tokens) => {
        const reservation = await admin.rpc('reserve_summary_call', {
          p_job_id: job.id,
          p_lease_token: job.lease_token,
          p_tokens: tokens,
        });
        if (reservation.error) throw reservation.error;
        return reservation.data === true;
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'BUDGET_EXCEEDED') throw error;
      step = {
        p_checkpoint: null,
        p_completed: 0,
        p_total: 0,
        p_phase: 'failed',
        p_error: 'BUDGET_EXCEEDED',
      };
    }
    const saved = await admin.rpc('save_summary_step', {
      p_job_id: job.id,
      p_lease_token: job.lease_token,
      ...step,
    });
    if (saved.error) throw saved.error;
    return json({ processed: saved.data === true });
    // On transient failures the durable lease expires; at most 3 attempts/step.
  } catch {
    return fail('SUMMARY_PROCESSING_UNAVAILABLE', 503);
  }
}
if (import.meta.main) Deno.serve(handler);
