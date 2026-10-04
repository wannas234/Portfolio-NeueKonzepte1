import { createClient } from '@supabase/supabase-js';
import { canonicalFile, MAX_FILE_SIZE, validContent } from '../_shared/file-validation.ts';

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'content-type': 'application/json',
  'cache-control': 'no-store',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const fail = (code: string, status: number) => json({ error: { code } }, status);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  const authorization = req.headers.get('authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) return fail('UNAUTHENTICATED', 401);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user) return fail('UNAUTHENTICATED', 401);
    // Metadata only; file bytes go directly to Storage.
    const reader = req.body?.getReader();
    let text = '';
    let length = 0;
    const decoder = new TextDecoder();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 8192) {
          await reader.cancel();
          return fail('INVALID_REQUEST', 413);
        }
        text += decoder.decode(value, { stream: true });
      }
    }
    let body;
    try {
      body = JSON.parse(text + decoder.decode());
    } catch {
      return fail('INVALID_REQUEST', 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return fail('INVALID_REQUEST', 400);
    if (body.action === 'prepare') {
      if (
        !uuid(body.course_id) ||
        !uuid(body.upload_key) ||
        typeof body.filename !== 'string' ||
        typeof body.mime_type !== 'string' ||
        !Number.isSafeInteger(body.size_bytes)
      )
        return fail('INVALID_FILE', 400);
      if (body.size_bytes > MAX_FILE_SIZE) return fail('FILE_TOO_LARGE', 413);
      const { data, error } = await client.rpc('prepare_file_upload', {
        p_course_id: body.course_id,
        p_upload_key: body.upload_key,
        p_filename: body.filename,
        p_mime: body.mime_type,
        p_size: body.size_bytes,
      });
      if (error) {
        // Kontingente setzt ein Trigger auf public.files durch (auch bei direktem RPC-Aufruf).
        if (error.message === 'QUOTA_EXCEEDED') return fail('QUOTA_EXCEEDED', 429);
        if (error.message === 'STORAGE_QUOTA_EXCEEDED') return fail('STORAGE_QUOTA_EXCEEDED', 413);
        if (error.code === '42501') return fail('COURSE_NOT_FOUND', 404);
        if (error.code === '22023') return fail('INVALID_FILE', 400);
        if (error.code === '23505')
          return fail(
            error.message === 'UPLOAD_DELETED' ? 'UPLOAD_DELETED' : 'UPLOAD_KEY_CONFLICT',
            409,
          );
        return fail('DATABASE_ERROR', 503);
      }
      return json({ file: data });
    }
    if (!['complete', 'download', 'delete'].includes(body.action) || !uuid(body.file_id))
      return fail('INVALID_REQUEST', 400);
    // Establish authorization with RLS before any privileged operation.
    const { data: file, error } = await client
      .from('files')
      .select('*')
      .eq('id', body.file_id)
      .maybeSingle();
    if (error) return fail('DATABASE_ERROR', 503);
    if (!file)
      return body.action === 'delete' ? json({ deleted: true }) : fail('FILE_NOT_FOUND', 404);
    if (file.uploaded_by !== user.id) return fail('FILE_NOT_FOUND', 404);
    if (!canonicalFile(file)) return fail('LEGACY_FILE_REQUIRES_REVIEW', 409);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (body.action === 'download') {
      if (file.status !== 'ready') return fail('FILE_NOT_READY', 409);
      const { data, error } = await client.storage
        .from('learning-files')
        .createSignedUrl(file.storage_path, 60, {
          download: body.download === true ? file.original_filename : false,
        });
      if (error) return fail('STORAGE_ERROR', 503);
      const signed = new URL(data.signedUrl);
      return json({ path: signed.pathname + signed.search, expires_in: 60 });
    }
    if (body.action === 'delete') {
      const marked = await admin
        .from('files')
        .update({ status: 'deleting' })
        .eq('id', file.id)
        .eq('uploaded_by', user.id);
      if (marked.error) return fail('DATABASE_ERROR', 503);
      const removed = await admin.storage.from('learning-files').remove([file.storage_path]);
      if (removed.error) return fail('STORAGE_ERROR', 503);
      const deleted = await admin.from('files').delete().eq('id', file.id).eq('status', 'deleting');
      if (deleted.error) return fail('DATABASE_ERROR', 503);
      // The trigger's job deliberately remains as a second, idempotent cleanup pass.
      return json({ deleted: true });
    }
    const complete = async () => {
      const { data, error } = await admin.rpc('complete_file_upload', {
        p_file_id: file.id,
        p_owner_id: user.id,
      });
      if (error) {
        if (error.code === 'P0002') return fail('FILE_NOT_FOUND', 404);
        if (error.code === '55000') return fail('UPLOAD_NOT_PENDING', 409);
        return fail('DATABASE_ERROR', 503);
      }
      return json(data);
    };
    if (file.status === 'ready') return await complete();
    if (!['pending', 'unverified'].includes(file.status)) return fail('UPLOAD_NOT_PENDING', 409);
    // Use HTTP streaming rather than buffering an unbounded object via the SDK.
    const stored = await fetch(
      `${url}/storage/v1/object/authenticated/learning-files/${file.storage_path}`,
      {
        headers: {
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
          apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!stored.ok) {
      await stored.body?.cancel();
      return fail(
        stored.status === 404 || stored.status === 400 ? 'UPLOAD_MISSING' : 'STORAGE_ERROR',
        503,
      );
    }
    const bytes = new Uint8Array(file.size_bytes);
    let offset = 0;
    let matches = stored.headers.get('content-type')?.split(';')[0].trim() === file.mime_type;
    const stream = stored.body!.getReader();
    while (true) {
      const { done, value } = await stream.read();
      if (done) break;
      if (offset + value.length > bytes.length) {
        matches = false;
        await stream.cancel();
        break;
      }
      bytes.set(value, offset);
      offset += value.length;
    }
    if (!matches || offset !== bytes.length || !validContent(bytes, file.mime_type)) {
      const failed = await admin
        .from('files')
        .update({ status: 'failed', error_code: 'INVALID_CONTENT' })
        .eq('id', file.id)
        .eq('status', file.status);
      return failed.error ? fail('DATABASE_ERROR', 503) : fail('INVALID_CONTENT', 422);
    }
    return await complete();
  } catch {
    return fail('SERVICE_UNAVAILABLE', 503);
  }
}
if (import.meta.main) Deno.serve(handler);
