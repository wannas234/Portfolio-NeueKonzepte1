import { FunctionsHttpError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";
export type QuizJob = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  phase: "analyze" | "generate";
  requested_count: number;
  generated_count: number;
  quiz_id: string | null;
  error_code: string | null;
  analyzed: number;
  total: number;
};
const errors: Record<string, string> = {
  SOURCES_NOT_READY: "Die Unterlage wird noch verarbeitet.",
  SOURCE_CHANGED:
    "Die Unterlage wurde verändert. Bitte erstelle einen neuen Test.",
  NO_LEARNING_CONTENT: "Die Unterlage enthält keine geeigneten Lerninhalte.",
  SOURCE_LIMIT_EXCEEDED: "Die Unterlage ist für einen einzelnen Test zu groß.",
  QUOTA_EXCEEDED: "Dein monatliches Quiz-Kontingent ist aufgebraucht.",
  RATE_LIMITED: "Zu viele Aufträge. Bitte versuche es später erneut.",
  BUDGET_EXCEEDED: "Die Verarbeitung hat ihr Kostenlimit erreicht.",
  POINT_LIMIT_EXCEEDED:
    "Die Unterlage enthält zu viele Lernpunkte. Verwende einen kleineren Abschnitt.",
  NEW_REQUEST_REQUIRED:
    "Dieser Auftrag kann nicht fortgesetzt werden. Bitte erstelle einen neuen Test.",
  UNAUTHENTICATED: "Bitte melde dich erneut an.",
  REQUEST_CONFLICT: "Diese Anfrage gehört bereits zu einer anderen Erstellung.",
  TARGET_NOT_FOUND: "Die Unterlage oder der Auftrag ist nicht mehr verfügbar.",
  PROCESSING_FAILED:
    "Der Test konnte nicht erstellt werden. Du kannst den Auftrag erneut versuchen.",
};
export function quizError(code: string | null) {
  return (
    errors[code ?? ""] ??
    "Der Quizdienst ist vorübergehend nicht erreichbar. Bitte erneut versuchen."
  );
}
function parseJob(value: unknown): QuizJob {
  const j = value as QuizJob | null;
  if (
    !j ||
    typeof j.id !== "string" ||
    !["queued", "processing", "completed", "failed", "cancelled"].includes(
      j.status,
    ) ||
    !["analyze", "generate"].includes(j.phase) ||
    !Number.isInteger(j.requested_count) ||
    !Number.isInteger(j.generated_count)
  )
    throw new Error("Ungültige Antwort des Quizdienstes.");
  return j;
}
async function call(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await createClient().functions.invoke("quizzes", {
    body,
  });
  if (error instanceof FunctionsHttpError) {
    let code = "";
    try {
      code = (await error.context.json()).error?.code;
    } catch {
      /* use fallback */
    }
    throw new Error(quizError(code));
  }
  if (error) throw new Error(quizError(null));
  return data;
}
export async function listQuizJobs(materialId: string) {
  const data = await call({ action: "list", source_material_id: materialId });
  if (!Array.isArray(data)) throw new Error("Ungültige Auftragsliste.");
  return data.map(parseJob);
}
export async function generateQuiz(
  materialId: string,
  count: number,
  requestId: string,
) {
  return parseJob(
    await call({
      action: "generate",
      source_material_id: materialId,
      count,
      request_id: requestId,
    }),
  );
}
export async function changeQuizJob(action: "retry" | "cancel", id: string) {
  return parseJob(await call({ action, job_id: id }));
}
