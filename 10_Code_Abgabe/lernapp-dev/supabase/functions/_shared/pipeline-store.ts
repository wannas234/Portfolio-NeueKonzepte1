import type { SupabaseClient } from '@supabase/supabase-js';
import { ProviderError } from './pipeline-runtime.ts';
export function pipelineStore(
  admin: SupabaseClient,
  documentId: string,
  lease: string,
  worker: 'visual' | 'embedding',
) {
  const run = crypto.randomUUID();
  const started = performance.now();
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const result = await admin.rpc(name, args);
    if (result.error) throw new Error('PIPELINE_PERSISTENCE_FAILED');
    return result.data;
  };
  return {
    async event(event: string, detail: Record<string, unknown> = {}) {
      try {
        const { error } = await admin.from('document_worker_events').insert({
          document_id: documentId,
          worker,
          run_id: run,
          event,
          detail,
        });
        if (error) console.warn('PIPELINE_TELEMETRY_FAILED', run);
      } catch {
        console.warn('PIPELINE_TELEMETRY_FAILED', run);
      }
    },
    duration: () => performance.now() - started,
    async acquire(): Promise<string | null> {
      return await rpc('acquire_document_provider_slot', {
        p_provider: worker,
        p_document_id: documentId,
        p_lease_token: lease,
      });
    },
    async release(token: string, error?: unknown) {
      await rpc('release_document_provider_slot', {
        p_token: token,
        p_retry_ms:
          error instanceof ProviderError ? Math.ceil(Math.min(86400000, error.retryAfterMs)) : 0,
      });
    },
    async yield(error?: unknown, progress = false) {
      return await rpc('yield_document_work', {
        p_provider: worker,
        p_document_id: documentId,
        p_lease_token: lease,
        p_delay_ms: error
          ? Math.ceil(
              Math.min(
                86400000,
                Math.max(1000, error instanceof ProviderError ? error.retryAfterMs : 5000),
              ),
            )
          : 1000,
        p_failed: error ? true : progress ? false : null,
      });
    },
  };
}
export function errorKind(error: unknown): string {
  if (error instanceof SyntaxError) return 'invalid_json';
  if (error instanceof ProviderError) return `http_${error.status}`;
  if (error instanceof DOMException) return error.name === 'TimeoutError' ? 'timeout' : 'aborted';
  if (
    error instanceof Error &&
    [
      'INCOMPLETE_VISUAL_RESULT',
      'INVALID_VISUAL_RESULT',
      'INCOMPLETE_TABLE',
      'VISUAL_RESULT_TOO_LARGE',
      'PIPELINE_PERSISTENCE_FAILED',
      'STALE_PROCESSING_LEASE',
      'INVALID_EMBEDDING_RESPONSE',
      'STORAGE_UNAVAILABLE',
      'EXTRACTION_CHECKPOINT_MISMATCH',
    ].includes(error.message)
  )
    return error.message.toLowerCase();
  // Never store provider bodies, document contents, keys or arbitrary exception messages.
  return 'processing_or_persistence';
}
