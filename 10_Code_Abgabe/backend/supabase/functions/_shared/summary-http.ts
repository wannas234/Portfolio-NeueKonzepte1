export const summaryHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
};
export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: summaryHeaders });
export const fail = (code: string, status: number, details?: unknown) =>
  json({ error: { code, ...(details ? { details } : {}) } }, status);
export const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function readBody(
  req: Request,
  maximumBytes = 4096,
): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('INVALID_REQUEST');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximumBytes) throw new Error('REQUEST_TOO_LARGE');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch {
    throw new Error('INVALID_REQUEST');
  }
}
export function databaseFailure(error: { message: string; details?: string }): Response {
  const status: Record<string, number> = {
    TARGET_NOT_FOUND: 404,
    SUMMARY_NOT_FOUND: 404,
    INVALID_REQUEST: 400,
    REQUEST_CONFLICT: 409,
    NO_SOURCES: 422,
    SOURCES_NOT_READY: 409,
    SOURCE_LIMIT_EXCEEDED: 413,
    SUMMARY_RATE_LIMITED: 429,
    QUOTA_EXCEEDED: 429,
    NEW_REQUEST_REQUIRED: 409,
    SOURCE_CHANGED: 409,
  };
  if (!status[error.message]) return fail('SUMMARIES_UNAVAILABLE', 503);
  let details;
  if (error.message === 'SOURCES_NOT_READY') {
    try {
      details = { source_document_ids: JSON.parse(error.details ?? '[]') };
    } catch {
      /* no internal details */
    }
  }
  return fail(error.message, status[error.message], details);
}
