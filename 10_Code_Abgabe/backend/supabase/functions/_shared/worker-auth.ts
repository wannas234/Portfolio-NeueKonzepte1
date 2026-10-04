// The platform's internal service JWT need not equal the project's external
// service_role key used by cron. Deployment synchronizes this key with Vault.
export function isWorkerRequest(req: Request): boolean {
  const key = Deno.env.get('WORKER_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  return !!key && req.headers.get('authorization') === `Bearer ${key}`;
}
