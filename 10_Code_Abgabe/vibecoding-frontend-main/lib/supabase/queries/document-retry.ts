import type { SupabaseClient } from "@supabase/supabase-js";
import type { RetryStage } from "../../../components/courses/documentIndexing";
import type { Database } from "../database.types";

// Restarts a failed document through the existing backend RPCs (no direct status
// writes). `retry_document_processing` re-queues text extraction,
// `retry_document_indexing` re-queues indexing. Both only act on a failed document
// that belongs to the caller and return the current row unchanged otherwise, so a
// repeated or parallel call cannot restart a running or finished document. The
// backend worker picks the re-queued job up on its own schedule; nothing else is
// called from the browser.

const FAILURE_MESSAGES: Record<string, string> = {
  DOCUMENT_NOT_FOUND: "Dieses Dokument wurde nicht gefunden. Lade die Seite neu.",
  FILE_NOT_READY: "Die Datei ist noch nicht bereit für eine neue Verarbeitung.",
};
const GENERIC_FAILURE = "Die Verarbeitung konnte nicht neu gestartet werden. Bitte versuche es erneut.";

/** Maps a PostgREST error to a known backend code (by message, then SQLSTATE). */
export function retryFailureCode(error: { message?: string; code?: string }): string {
  if (error.message && Object.hasOwn(FAILURE_MESSAGES, error.message)) return error.message;
  if (error.code === "P0002") return "DOCUMENT_NOT_FOUND";
  if (error.code === "55000") return "FILE_NOT_READY";
  return "RETRY_FAILED";
}

export function retryFailureMessage(code: string): string {
  return Object.hasOwn(FAILURE_MESSAGES, code) ? FAILURE_MESSAGES[code] : GENERIC_FAILURE;
}

export async function retryDocument(
  client: Pick<SupabaseClient<Database>, "rpc">,
  documentId: string,
  stage: RetryStage
): Promise<void> {
  const { error } = await (stage === "processing"
    ? client.rpc("retry_document_processing", { p_document_id: documentId })
    : client.rpc("retry_document_indexing", { p_document_id: documentId }));
  if (error) throw new Error(retryFailureCode(error));
}
