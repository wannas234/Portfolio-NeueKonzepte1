import { WorkBudget, boundedPages, setting, ProviderError } from '../_shared/pipeline-runtime.ts';
import { pipelineStore, errorKind } from '../_shared/pipeline-store.ts';
import { createClient } from '@supabase/supabase-js';
import { isWorkerRequest } from '../_shared/worker-auth.ts';
import { canonicalFile } from '../_shared/file-validation.ts';
import {
  extractDocument,
  ExtractionError,
  MAX_DOCUMENT_BYTES,
} from '../_shared/document-extraction.ts';
import {
  createVisualExtractor,
  visualConfiguration,
  publicVisualConfiguration,
  visualFailureMetrics,
  resumeVisualConfiguration,
  type VisualConfiguration,
} from '../_shared/visual-extraction.ts';
import {
  EXTRACTION_VERSION,
  pendingVisualPages,
  type DocumentPage,
} from '../_shared/document-structure.ts';

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const fail = (code: string, status: number) => json({ error: { code } }, status);

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = req.headers.get('authorization');
  if (!key || !authorization?.match(/^Bearer\s+\S+$/i)) return fail('UNAUTHENTICATED', 401);
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  let visualConfig: VisualConfiguration;
  try {
    visualConfig = visualConfiguration();
  } catch {
    return fail('DOCUMENT_EXTRACTION_NOT_CONFIGURED', 503);
  }
  try {
    const budget = new WorkBudget();
    const concurrency = setting('DOCUMENT_VISUAL_CONCURRENCY', 3, 1, 3);
    const maxPages = setting('DOCUMENT_VISUAL_MAX_PAGES', 100, 1, 100);
    const url = Deno.env.get('SUPABASE_URL')!;
    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([AbortSignal.timeout(10000), budget.rpcSignal()]),
          }),
      },
    };
    const admin = createClient(url, key, options);
    let jobs: { document_id: string }[];
    let documentId: string | undefined;
    const worker = isWorkerRequest(req);
    const client = worker
      ? admin
      : createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
          ...options,
          global: { ...options.global, headers: { Authorization: authorization } },
        });
    const readDocument = () =>
      client
        .from('source_documents')
        .select('id, processing_status, error_code, page_count')
        .eq('id', documentId!)
        .maybeSingle();
    const respond = async (counts: { completed: number; failed: number; discarded: boolean }) => {
      if (!documentId) return json(counts);
      const current = await readDocument();
      if (current.error) throw current.error;
      if (!current.data) return fail('DOCUMENT_NOT_FOUND', 404);
      return json(
        { ...counts, source_document: current.data },
        ['uploaded', 'processing'].includes(current.data.processing_status) ? 202 : 200,
      );
    };
    if (worker) {
      // The scheduler alone may choose arbitrary jobs from the private queue.
      const now = new Date().toISOString();
      const selected = await admin
        .from('document_processing_jobs')
        .select('document_id')
        .lte('available_at', now)
        .or(`lease_until.is.null,lease_until.lte.${now}`)
        .order('available_at')
        .limit(10);
      if (selected.error) throw selected.error;
      jobs = selected.data;
    } else {
      const {
        data: { user },
        error,
      } = await client.auth.getUser();
      if (error || !user) return fail('UNAUTHENTICATED', 401);
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
            if (size > 1024) return fail('INVALID_REQUEST', 413);
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
        typeof body.document_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.document_id)
      )
        return fail('INVALID_REQUEST', 400);
      documentId = body.document_id;
      // Resolve access with the user's JWT/RLS before any privileged claim.
      const document = await readDocument();
      if (document.error) throw document.error;
      if (!document.data) return fail('DOCUMENT_NOT_FOUND', 404);
      jobs = [{ document_id: documentId! }];
    }
    for (const job of jobs) {
      const claim = await admin.rpc('claim_document_processing', {
        p_document_id: job.document_id,
      });
      if (claim.error) throw claim.error;
      if (!claim.data) continue;
      const { file, lease_token } = claim.data;
      const store = pipelineStore(admin, job.document_id, lease_token, 'visual');
      await store.event('started');
      let outcome = 'failed';
      let runError: string | undefined;
      try {
        let result;
        let failure: string | undefined;
        try {
          if (
            !canonicalFile(file) ||
            !Number.isSafeInteger(file.size_bytes) ||
            file.status !== 'ready'
          )
            throw new ExtractionError('INVALID_DOCUMENT');
          if (!['application/pdf', 'text/plain'].includes(file.mime_type))
            throw new ExtractionError('UNSUPPORTED_FORMAT');
          if (file.size_bytes > MAX_DOCUMENT_BYTES) throw new ExtractionError('INVALID_DOCUMENT');
          const response = await fetch(
            `${url}/storage/v1/object/authenticated/learning-files/${file.storage_path}`,
            {
              headers: { Authorization: `Bearer ${key}`, apikey: key },
              signal: AbortSignal.any([AbortSignal.timeout(20000), budget.rpcSignal()]),
              redirect: 'error',
            },
          );
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error('STORAGE_UNAVAILABLE');
          }
          const reader = response.body?.getReader();
          if (!reader) throw new Error('STORAGE_UNAVAILABLE');
          const bytes = new Uint8Array(file.size_bytes);
          let offset = 0;
          try {
            if (response.headers.get('content-type')?.split(';')[0].trim() !== file.mime_type)
              throw new ExtractionError('INVALID_DOCUMENT');
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (offset + value.length > bytes.length)
                throw new ExtractionError('INVALID_DOCUMENT');
              bytes.set(value, offset);
              offset += value.length;
            }
          } finally {
            await reader.cancel();
          }
          if (offset !== bytes.length) throw new ExtractionError('INVALID_DOCUMENT');
          const checkpoint = claim.data.checkpoint as
            | {
                version: string;
                model: string;
                pages: DocumentPage[];
                configuration?: Omit<VisualConfiguration, 'key'>;
              }
            | null
            | undefined;
          if (checkpoint) {
            if (
              file.mime_type !== 'application/pdf' ||
              checkpoint.version !== EXTRACTION_VERSION ||
              !Array.isArray(checkpoint.pages)
            )
              throw new Error('EXTRACTION_CHECKPOINT_MISMATCH');
            // Resume with the pinned configuration, including legacy defaults. Never mix versions.
            visualConfig = resumeVisualConfiguration(visualConfig.key, checkpoint);
            result = {
              pages: checkpoint.pages,
              text: checkpoint.pages.map((p) => p.text).join('\n\n'),
            };
          } else result = await extractDocument(bytes, file.mime_type, true, visualConfig.revision);
          if (!checkpoint)
            await store.event('routing', {
              configuration: publicVisualConfiguration(visualConfig),
              pages:
                result.pages?.map((p) => ({ page: p.page, route: p.route, reasons: p.reasons })) ??
                [],
            });
          if (result.pages && pendingVisualPages(result.pages).length) {
            const save = async (release: boolean) => {
              const saved = await admin.rpc('save_document_processing_checkpoint', {
                p_document_id: job.document_id,
                p_lease_token: lease_token,
                p_checkpoint: {
                  version: EXTRACTION_VERSION,
                  model: visualConfig.model,
                  configuration: publicVisualConfiguration(visualConfig),
                  pages: result!.pages,
                },
                p_release: release,
              });
              if (saved.error) throw saved.error;
              return saved.data === true;
            };
            // Save local analysis before the first paid call, retaining the lease.
            if (!checkpoint && !(await save(false)))
              return await respond({ completed: 0, failed: 0, discarded: true });
            const extractor = createVisualExtractor(visualConfig);
            let savedPages = 0;
            try {
              await boundedPages(
                pendingVisualPages(result.pages).slice(0, maxPages),
                concurrency,
                budget,
                async (pending) => {
                  const token = await store.acquire();
                  if (!token) return false;
                  if (!budget.canStart()) {
                    await store.release(token);
                    return false;
                  }
                  let pageError: unknown;
                  let providerMetrics: Record<string, unknown> = {};
                  const started = performance.now();
                  try {
                    const extracted = await extractor.extract(bytes, pending, budget.signal());
                    providerMetrics = {
                      configuration: extracted.extraction?.configuration,
                      duration_ms: extracted.extraction?.request_duration_ms,
                      retry_wait_ms: extracted.extraction?.retry_wait_ms,
                      usage: extracted.extraction?.usage,
                      attempts: extracted.extraction?.attempts,
                    };
                    const saved = await admin.rpc('save_document_processing_page', {
                      p_document_id: job.document_id,
                      p_lease_token: lease_token,
                      p_page: extracted,
                    });
                    if (saved.error) throw new Error('PIPELINE_PERSISTENCE_FAILED');
                    if (saved.data !== true) throw new Error('STALE_PROCESSING_LEASE');
                    result!.pages![pending.page - 1] = extracted;
                    savedPages++;
                    await store.event('request', {
                      page: pending.page,
                      configuration: extracted.extraction?.configuration,
                      duration_ms: extracted.extraction?.request_duration_ms,
                      retry_wait_ms: extracted.extraction?.retry_wait_ms,
                      usage: extracted.extraction?.usage,
                      attempts: extracted.extraction?.attempts,
                      incomplete: extracted.extraction?.incomplete === true,
                      status: 'completed',
                    });
                    return true;
                  } catch (error) {
                    pageError = error;
                    await store.event('request', {
                      page: pending.page,
                      duration_ms: performance.now() - started,
                      status: 'failed',
                      error: errorKind(error),
                      attempts: error instanceof ProviderError ? error.attempts : [],
                      ...providerMetrics,
                      ...visualFailureMetrics(error),
                    });
                    throw error;
                  } finally {
                    await store.release(token, pageError);
                  }
                },
              );
            } catch (error) {
              // Other lanes have finished and individually persisted before releasing the document.
              await store.yield(error);
              throw error;
            }
            result.text = result.pages.map((p) => p.text).join('\n\n');
            if (new TextEncoder().encode(result.text).length > 5 * 1024 * 1024)
              throw new ExtractionError('INVALID_DOCUMENT');
            if (pendingVisualPages(result.pages).length) {
              const saved = await store.yield(undefined, savedPages > 0);
              outcome = saved ? 'yielded' : 'discarded';
              return await respond({ completed: 0, failed: 0, discarded: !saved });
            }
          }
        } catch (error) {
          if (!(error instanceof ExtractionError)) throw error;
          failure = error.code;
        }
        // Transient network/database errors leave the lease for a later attempt.
        const finished = await admin.rpc('finish_document_processing', {
          p_document_id: job.document_id,
          p_lease_token: lease_token,
          ...(failure
            ? { p_error_code: failure }
            : { p_text: result!.text, p_pages: result!.pages }),
        });
        if (finished.error) throw finished.error;
        outcome = finished.data === true ? (failure ? 'failed' : 'completed') : 'discarded';
        return await respond({
          completed: finished.data === true && !failure ? 1 : 0,
          failed: finished.data === true && failure ? 1 : 0,
          discarded: finished.data !== true,
        });
      } catch (error) {
        runError = errorKind(error);
        throw error;
      } finally {
        await store.event('finished', { duration_ms: store.duration(), outcome, error: runError });
      }
    }
    return await respond({ completed: 0, failed: 0, discarded: false });
  } catch {
    return fail('PROCESSING_UNAVAILABLE', 503);
  }
}
if (import.meta.main) Deno.serve(handler);
