import { createClient } from '@supabase/supabase-js';
import { isWorkerRequest } from '../_shared/worker-auth.ts';

export async function handler(req: Request): Promise<Response> {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || !isWorkerRequest(req)) return new Response(null, { status: 401 });
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
      },
    });
    const expired = await admin.rpc('expire_file_uploads');
    if (expired.error) throw expired.error;
    const { data: jobs, error } = await admin
      .from('file_cleanup_jobs')
      .select('*')
      .is('completed_at', null)
      .lte('next_attempt_at', new Date().toISOString())
      .order('next_attempt_at')
      .limit(50);
    if (error) throw error;
    let completed = 0;
    let failed = 0;
    const deadline = Date.now() + 30000;
    for (const job of jobs) {
      if (Date.now() > deadline) break;
      const result = await admin.storage.from('learning-files').remove([job.storage_path]);
      const attempts = job.attempts + 1;
      const update = await admin
        .from('file_cleanup_jobs')
        .update(
          result.error
            ? {
                attempts,
                last_error: 'STORAGE_ERROR',
                next_attempt_at: new Date(
                  Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(attempts, 6)),
                ).toISOString(),
              }
            : { attempts, completed_at: new Date().toISOString(), last_error: null },
        )
        .eq('file_id', job.file_id)
        .is('completed_at', null);
      if (update.error) throw update.error;
      if (result.error) failed++;
      else completed++;
    }
    return Response.json({ completed, failed }, { status: failed ? 503 : 200 });
  } catch {
    return Response.json({ error: { code: 'CLEANUP_FAILED' } }, { status: 503 });
  }
}
if (import.meta.main) Deno.serve(handler);
