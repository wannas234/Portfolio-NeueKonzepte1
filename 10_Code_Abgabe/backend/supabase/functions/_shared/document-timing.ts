import type { SupabaseClient } from '@supabase/supabase-js';

type Outcome = 'completed' | 'failed' | 'discarded';
type Phase = 'download' | 'text_extraction' | 'chunking' | 'embeddings' | 'persist';
type Measurement = {
  phase: Phase;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  status: 'completed' | 'failed';
};

/** One row per claimed extraction attempt or indexing batch, without lease secrets. */
export async function withDocumentTiming<T>(
  admin: SupabaseClient,
  documentId: string,
  worker: 'extraction' | 'indexing',
  batchStart: number | null,
  work: (timing: {
    measure: <R>(phase: Phase, operation: () => R | PromiseLike<R>) => Promise<R>;
    outcome: Outcome;
  }) => Promise<T>,
): Promise<T> {
  const id = crypto.randomUUID();
  const phases: Measurement[] = [];
  // Observability must not turn a successfully persisted document into a failed job.
  const save = async (operation: () => PromiseLike<{ error: unknown }>) => {
    try {
      if ((await operation()).error) console.warn('DOCUMENT_TIMING_WRITE_FAILED', id);
    } catch {
      console.warn('DOCUMENT_TIMING_WRITE_FAILED', id);
    }
  };
  await save(() =>
    admin.from('document_processing_runs').insert({
      id,
      document_id: documentId,
      worker,
      batch_start: batchStart,
      started_at: new Date().toISOString(),
    }),
  );
  const start = performance.now();
  const timing = {
    outcome: 'failed' as Outcome,
    async measure<R>(phase: Phase, operation: () => R | PromiseLike<R>): Promise<R> {
      const startedAt = new Date().toISOString();
      const phaseStart = performance.now();
      let status: Measurement['status'] = 'failed';
      try {
        const result = await operation();
        status = 'completed';
        return result;
      } finally {
        phases.push({
          phase,
          started_at: startedAt,
          completed_at: new Date().toISOString(),
          duration_ms: Math.max(0, performance.now() - phaseStart),
          status,
        });
      }
    },
  };
  try {
    return await work(timing);
  } finally {
    const durationMs = Math.max(0, performance.now() - start);
    await save(() =>
      admin
        .from('document_processing_runs')
        .update({
          completed_at: new Date().toISOString(),
          duration_ms: durationMs,
          status: timing.outcome,
          phases,
        })
        .eq('id', id),
    );
  }
}
