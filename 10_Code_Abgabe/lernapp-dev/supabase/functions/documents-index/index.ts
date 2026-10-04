import { WorkBudget, ProviderError, setting } from '../_shared/pipeline-runtime.ts';
import { pipelineStore, errorKind } from '../_shared/pipeline-store.ts';
import { createClient } from '@supabase/supabase-js';
import { isWorkerRequest } from '../_shared/worker-auth.ts';
import { chunkDocument } from '../_shared/document-chunks.ts';
import {
  embedTexts,
  assertEmbeddingConfiguration,
  embeddingContract,
} from '../_shared/embeddings.ts';

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
export async function handler(req: Request): Promise<Response> {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || !isWorkerRequest(req)) return json({ error: { code: 'UNAUTHENTICATED' } }, 401);
  if (req.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405);
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  // Missing configuration must not consume attempts or alter document status.
  if (!apiKey) return json({ error: { code: 'EMBEDDINGS_NOT_CONFIGURED' } }, 503);
  try {
    assertEmbeddingConfiguration();
    const budget = new WorkBudget();
    let stored = 0;
    const maxBatches = setting('DOCUMENT_INDEX_MAX_BATCHES', 313, 1, 313);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([AbortSignal.timeout(10000), budget.rpcSignal()]),
          }),
      },
    });
    const now = new Date().toISOString();
    const jobs = await admin
      .from('document_indexing_jobs')
      .select('document_id')
      .lte('available_at', now)
      .or(`lease_until.is.null,lease_until.lte.${now}`)
      .order('available_at')
      .limit(10);
    if (jobs.error) throw jobs.error;
    for (const job of jobs.data ?? []) {
      for (let iteration = 0; iteration < maxBatches && budget.canStart(); iteration++) {
        const claim = await admin.rpc('claim_document_indexing', {
          p_document_id: job.document_id,
        });
        if (claim.error) throw claim.error;
        if (!claim.data) break;
        const store = pipelineStore(admin, job.document_id, claim.data.lease_token, 'embedding');
        await store.event('started', { batch_start: claim.data.next_index });
        let outcome = 'failed';
        try {
          let chunks;
          try {
            chunks = chunkDocument(claim.data.text, claim.data.pages);
          } catch {
            const failed = await admin.rpc('finish_document_indexing_batch', {
              ...embeddingContract,
              p_document_id: job.document_id,
              p_lease_token: claim.data.lease_token,
              p_error_code: 'INVALID_INDEXING_INPUT',
            });
            if (failed.error) throw failed.error;
            return json({ failed: failed.data === true, discarded: failed.data !== true });
          }
          const batch = chunks.slice(claim.data.next_index, claim.data.next_index + 32);
          const token = batch.length ? await store.acquire() : null;
          if (batch.length && (!token || !budget.canStart())) {
            if (token) await store.release(token);
            await store.yield();
            outcome = 'yielded';
            break;
          }
          let vectors: number[][];
          const requestStarted = performance.now();
          let requestError: unknown;
          let metrics: Record<string, unknown> = {};
          try {
            vectors = await embedTexts(
              batch.map((c) => c.content),
              apiKey,
              budget.signal(),
              'document',
              (value) => (metrics = value),
            );
            await store.event('request', {
              ...metrics,
              duration_ms: metrics.request_duration_ms ?? performance.now() - requestStarted,
              batch_start: claim.data.next_index,
              chunks: batch.length,
              model: embeddingContract.p_embedding_model,
              status: 'completed',
            });
          } catch (error) {
            requestError = error;
            await store.event('request', {
              ...metrics,
              duration_ms: metrics.request_duration_ms ?? performance.now() - requestStarted,
              status: 'failed',
              error: errorKind(error),
              attempts: error instanceof ProviderError ? error.attempts : (metrics.attempts ?? []),
            });
            await store.yield(error);
            throw error;
          } finally {
            if (token) await store.release(token, requestError);
          }
          const finished = await admin.rpc('finish_document_indexing_batch', {
            ...embeddingContract,
            p_document_id: job.document_id,
            p_lease_token: claim.data.lease_token,
            p_total_chunks: chunks.length,
            p_chunks: batch.map((c, i) => ({ ...c, embedding: vectors[i] })),
          });
          if (finished.error) throw finished.error;
          if (finished.data !== true) {
            outcome = 'discarded';
            return json({ stored, completed: false, discarded: true });
          }
          stored += batch.length;
          outcome = 'completed';
          if (claim.data.next_index + batch.length === chunks.length)
            return json({ stored, completed: true, discarded: false });
          // Finish committed the cursor and released the lease. Reclaim before another batch;
          // a competing worker may win, in which case this invocation stops.
        } finally {
          await store.event('finished', { duration_ms: store.duration(), outcome });
        }
      }
    }
    return json({ stored, completed: false, discarded: false });
  } catch {
    // Rate limits, provider and DB outages are retried after the lease expires.
    return json({ error: { code: 'INDEXING_UNAVAILABLE' } }, 503);
  }
}
if (import.meta.main) Deno.serve(handler);
