// Edge Function `me`: liefert das Profil des aufrufenden Nutzers.
//
// Referenz-Implementierung für dieses Projekt. Wichtig ist das Muster:
// Der Authorization-Header des Requests wird an den Supabase-Client
// weitergereicht, damit RLS greift – die Function umgeht die Policies nicht.
//
// Lokal testen:
//   npm run functions:serve
//   curl -i http://127.0.0.1:54321/functions/v1/me -H "Authorization: Bearer <JWT>"

import { createClient } from '@supabase/supabase-js';

// Keine Cookie-Credentials: Zugriff bleibt an den validierten Bearer-JWT gebunden.
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (!['GET', 'POST'].includes(req.method)) {
    return json({ error: 'Methode nicht erlaubt' }, 405);
  }
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !/^Bearer\s+\S+$/i.test(authHeader)) {
    return json({ error: 'Authorization-Header fehlt' }, 401);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return json({ error: 'Nicht authentifiziert' }, 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, user_id, name, avatar_url, created_at, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError) {
    return json({ error: 'Profil konnte nicht geladen werden' }, 500);
  }
  if (!profile) return json({ error: 'Profil nicht gefunden' }, 404);

  return json({ profile });
}

if (import.meta.main) Deno.serve(handler);
