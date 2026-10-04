import { providerFetch } from './pipeline-runtime.ts';
export const EMBEDDING_PROVIDER = 'gemini';
export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const EMBEDDING_DIMENSIONS = 1536;

/** Must match the Gemini index migration; changing only secrets is not a migration. */
export function assertEmbeddingConfiguration(): void {
  if (
    (Deno.env.get('EMBEDDING_PROVIDER')?.trim() ?? EMBEDDING_PROVIDER) !== EMBEDDING_PROVIDER ||
    (Deno.env.get('EMBEDDING_MODEL')?.trim() ?? EMBEDDING_MODEL) !== EMBEDDING_MODEL ||
    (Deno.env.get('EMBEDDING_DIMENSIONS')?.trim() ?? String(EMBEDDING_DIMENSIONS)) !==
      String(EMBEDDING_DIMENSIONS)
  )
    throw new Error('EMBEDDING_CONTRACT_MISMATCH');
}

export const embeddingContract = {
  p_embedding_provider: EMBEDDING_PROVIDER,
  p_embedding_model: EMBEDDING_MODEL,
  p_embedding_dimensions: EMBEDDING_DIMENSIONS,
};

export async function embedTexts(
  inputs: string[],
  key: string,
  signal?: AbortSignal,
  purpose: 'document' | 'query' = 'document',
  metrics?: (value: {
    request_duration_ms: number;
    retry_wait_ms: number;
    attempts: { duration_ms: number; status: number }[];
  }) => void,
): Promise<number[][]> {
  assertEmbeddingConfiguration();
  if (inputs.length === 0) return [];
  if (inputs.length > 32 || inputs.some((s) => !s.trim() || s.length > 1800))
    throw new Error('INVALID_EMBEDDING_INPUT');
  const attempts: { duration_ms: number; status: number }[] = [];
  let retryWaitMs = 0;
  const report = () =>
    metrics?.({
      request_duration_ms: attempts.reduce((sum, a) => sum + a.duration_ms, 0),
      retry_wait_ms: retryWaitMs,
      attempts,
    });
  const response = await providerFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: inputs.map((text) => ({
          model: `models/${EMBEDDING_MODEL}`,
          content: {
            parts: [
              {
                text:
                  purpose === 'query'
                    ? `task: search result | query: ${text}`
                    : `title: none | text: ${text}`,
              },
            ],
          },
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000),
      redirect: 'error',
    },
    {
      onAttempt: (duration_ms, status) => {
        attempts.push({ duration_ms, status });
        report();
      },
      onBackoff: (ms) => {
        retryWaitMs += ms;
        report();
      },
    },
  );
  const bodyStart = performance.now();
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('EMBEDDINGS_UNAVAILABLE');
  }
  let body;
  try {
    body = await response.json();
  } finally {
    attempts[attempts.length - 1].duration_ms += performance.now() - bodyStart;
    report();
  }
  if (!Array.isArray(body.embeddings) || body.embeddings.length !== inputs.length)
    throw new Error('INVALID_EMBEDDING_RESPONSE');
  // Gemini returns one embedding per request, in request order. Each chunk is a
  // separate Content, so it cannot accidentally become one aggregated vector.
  return body.embeddings.map((item: { values?: unknown }) => {
    const vector = item?.values;
    if (
      !Array.isArray(vector) ||
      vector.length !== EMBEDDING_DIMENSIONS ||
      !vector.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))
    )
      throw new Error('INVALID_EMBEDDING_RESPONSE');
    const norm = Math.hypot(...vector);
    if (!Number.isFinite(norm) || norm === 0) throw new Error('INVALID_EMBEDDING_RESPONSE');
    return vector.map((n: number) => n / norm);
  });
}
