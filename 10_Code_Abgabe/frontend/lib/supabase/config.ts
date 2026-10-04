export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publicKey) {
    throw new Error(
      "Supabase ist nicht konfiguriert. NEXT_PUBLIC_SUPABASE_URL und ein öffentlicher Supabase-Key fehlen."
    );
  }

  return { url, publicKey };
}
