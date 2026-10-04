// Edge Function `account-export`: Datenexport nach Art. 15/20 DSGVO.
//
// Die Daten liefert export_my_data() mit dem Nutzer-JWT; die Datenbank bestimmt den
// Nutzer allein über auth.uid() und begrenzt die Exporte (3 pro 24 h). Hier kommen nur
// die Konto-E-Mail und Signed URLs auf die Original-Dateien dazu. Die URLs signiert
// ebenfalls der Nutzer-Client, die Storage-Policies greifen also auch hier.
//
// Die Links müssen außerhalb der App funktionieren. Lokal zeigt SUPABASE_URL im Edge
// Runtime auf das interne Gateway; dafür gibt es PUBLIC_SUPABASE_URL (optional).

import { createClient } from '@supabase/supabase-js';

export const EXPORT_VERSION = 1;
export const FILE_URL_TTL_SECONDS = 24 * 60 * 60;
const SIGN_BATCH = 100;

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-expose-headers': 'content-disposition, retry-after',
  'content-type': 'application/json',
  'cache-control': 'no-store',
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
const fail = (code: string, status: number, extra?: Record<string, string>) =>
  json({ error: { code } }, status, extra);

// Signed URL mit öffentlicher Basis, Pfad und Token bleiben unverändert.
export function publicUrl(signedUrl: string, base: string): string {
  const signed = new URL(signedUrl);
  return new URL(signed.pathname + signed.search, base).href;
}

type ExportFile = { id: string; status: string; storage_path?: string } & Record<string, unknown>;

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405);
  const authorization = req.headers.get('authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) return fail('UNAUTHENTICATED', 401);
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user) return fail('UNAUTHENTICATED', 401);

    const { data: result, error } = await client.rpc('export_my_data');
    if (error) return fail('DATABASE_ERROR', 503);
    if (result?.allowed !== true) {
      if (result?.code !== 'RATE_LIMITED') return fail('DATABASE_ERROR', 503);
      const wait = Number(result.retry_after_seconds);
      return fail('RATE_LIMITED', 429, {
        'retry-after': String(Number.isSafeInteger(wait) && wait > 0 ? wait : 3600),
      });
    }

    const base = Deno.env.get('PUBLIC_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
    const files = (result.data.files ?? []) as ExportFile[];
    const ready = files.filter((file) => file.status === 'ready' && file.storage_path);
    const urls = new Map<string, string>();
    for (let start = 0; start < ready.length; start += SIGN_BATCH) {
      const paths = ready.slice(start, start + SIGN_BATCH).map((file) => file.storage_path!);
      const { data: signed, error: signError } = await client.storage
        .from('learning-files')
        .createSignedUrls(paths, FILE_URL_TTL_SECONDS, { download: true });
      if (signError) return fail('STORAGE_ERROR', 503);
      for (const entry of signed ?? [])
        if (entry.path && entry.signedUrl && !entry.error)
          urls.set(entry.path, publicUrl(entry.signedUrl, base));
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + FILE_URL_TTL_SECONDS * 1000).toISOString();
    result.data.files = files.map(({ storage_path, ...file }) => {
      const url = storage_path ? urls.get(storage_path) : undefined;
      return { ...file, download_url: url ?? null, download_expires_at: url ? expiresAt : null };
    });

    const body = {
      export_version: EXPORT_VERSION,
      exported_at: now.toISOString(),
      account: { id: user.id, email: user.email ?? null, created_at: user.created_at },
      ...result.data,
    };
    return json(body, 200, {
      'content-disposition': `attachment; filename="universe-export-${now.toISOString().slice(0, 10)}.json"`,
    });
  } catch {
    return fail('SERVICE_UNAVAILABLE', 503);
  }
}
if (import.meta.main) Deno.serve(handler);
