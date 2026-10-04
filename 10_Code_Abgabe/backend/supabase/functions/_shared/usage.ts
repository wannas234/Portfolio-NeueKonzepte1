// Verbrauchskonto (public.usage_events) für Wege, die nicht über einen Job-Trigger laufen:
// Chat und direkte Suche. Grenzwerte und Tarif bestimmt allein die Datenbank
// (plan_limits aus supabase/usage-limits.mjs, Tarif aus subscriptions).

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type UsageKind = 'chat' | 'search';
export type UsageDecision =
  | { allowed: true }
  | { allowed: false; code: 'QUOTA_EXCEEDED' }
  | { allowed: false; code: 'RATE_LIMITED'; retryAfterSeconds: number };

// Bucht eine Einheit, bevor der Provider etwas kostet. Derselbe Schlüssel zählt nur einmal.
export async function consumeUsage(
  admin: RpcClient,
  userId: string,
  kind: UsageKind,
  key: string,
): Promise<UsageDecision> {
  const { data, error } = await admin.rpc('consume_usage', {
    p_user_id: userId,
    p_kind: kind,
    p_key: key,
  });
  if (error) throw error;
  const result = data as { allowed?: unknown; code?: unknown; retry_after_seconds?: unknown };
  if (result?.allowed === true) return { allowed: true };
  if (result?.code === 'QUOTA_EXCEEDED') return { allowed: false, code: 'QUOTA_EXCEEDED' };
  if (result?.code === 'RATE_LIMITED') {
    const wait = Number(result.retry_after_seconds);
    return {
      allowed: false,
      code: 'RATE_LIMITED',
      retryAfterSeconds: Number.isSafeInteger(wait) && wait > 0 ? wait : 60,
    };
  }
  throw new Error('USAGE_UNAVAILABLE');
}

// Nur Auswertung: Ein Fehler hier darf eine bereits erzeugte Antwort nicht verwerfen.
export async function recordUsageTokens(
  admin: RpcClient,
  userId: string,
  kind: 'chat' | 'material_analysis',
  key: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): Promise<void> {
  try {
    const { error } = await admin.rpc('record_usage_tokens', {
      p_user_id: userId,
      p_kind: kind,
      p_key: key,
      p_input_tokens: inputTokens ?? null,
      p_output_tokens: outputTokens ?? null,
    });
    if (error) throw error;
  } catch {
    console.error(JSON.stringify({ event: 'usage_tokens_failed', kind, key }));
  }
}
