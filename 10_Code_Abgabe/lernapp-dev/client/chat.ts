import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.ts';

type Message = Database['public']['Tables']['chat_messages']['Row'];
type Source = Database['public']['Tables']['chat_message_sources']['Row'];

export interface ChatRequest {
  conversation_id: string;
  request_id: string;
  question: string;
  /** Omit for all indexed course materials; otherwise select 1–100 material IDs. */
  material_ids?: string[];
}

export interface ChatExchange {
  conversation_id: string;
  request_id: string;
  messages: [
    Pick<Message, 'id' | 'seq' | 'content' | 'created_at'> & { role: 'user' },
    Pick<
      Message,
      | 'id'
      | 'seq'
      | 'content'
      | 'created_at'
      | 'model'
      | 'provider'
      | 'input_tokens'
      | 'output_tokens'
      | 'helpful'
      | 'helpful_at'
    > & { role: 'assistant' },
  ];
  sources: Pick<
    Source,
    | 'citation_no'
    | 'chunk_id'
    | 'source_document_id'
    | 'material_id'
    | 'material_title'
    | 'page_number'
    | 'excerpt'
    | 'similarity'
  >[];
}

export interface ChatFailure {
  error: { code: string; retry_after_seconds?: number };
}

/** Rate an answer as helpful (`true`), not helpful (`false`) or unrated (`null`).
 * Only the rating itself is writable; its timestamp is set by the database. */
export function rateAnswer(
  client: SupabaseClient<Database>,
  messageId: string,
  helpful: boolean | null,
) {
  return client
    .from('chat_messages')
    .update({ helpful })
    .eq('id', messageId)
    .select('id,helpful,helpful_at')
    .maybeSingle();
}

/** Keep this exact request object for retries. The caller controls retry timing
 * and merges successful exchanges by message ID rather than appending twice. */
export function sendChat(client: SupabaseClient<Database>, request: ChatRequest) {
  return client.functions.invoke<ChatExchange>('chat', { body: request });
}
