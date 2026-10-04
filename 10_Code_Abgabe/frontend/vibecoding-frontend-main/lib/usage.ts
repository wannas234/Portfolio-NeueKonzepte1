import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseUsage, type UsageOverview } from "./usage-format";

export { parseUsage } from "./usage-format";
export type { UsageEntry, UsageOverview } from "./usage-format";

// Nutzungskontingente (Backend-Migrationen 20261004120000 und 20261004150000).
//
// Durchgesetzt werden die Grenzen ausschließlich in der Datenbank — `get_my_usage()`
// liefert nur den Stand zur Anzeige. Das Frontend darf daraus niemals eine Erlaubnis
// ableiten: eine Aktion wird versucht und kann serverseitig mit QUOTA_EXCEEDED enden,
// auch wenn die Anzeige noch Luft zeigt.

/** Der eigene Verbrauch. Der Nutzer wird serverseitig allein aus dem JWT bestimmt. */
export async function loadUsage(client: SupabaseClient<Database>): Promise<UsageOverview> {
  const { data, error } = await client.rpc("get_my_usage");
  if (error) throw error;
  return parseUsage(data);
}
