import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.ts';

/** Einmal pro Browser-App erstellen. Für SSR einen requestgebundenen @supabase/ssr-Client verwenden. */
export function createLernappClient(url: string, publicKey: string) {
  if (!url || !publicKey) throw new Error('Supabase-URL und öffentlicher Key fehlen');
  return createClient<Database>(url, publicKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
