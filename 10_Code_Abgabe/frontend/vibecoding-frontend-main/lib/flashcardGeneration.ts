import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Generierte Karteikarten (Backend-Function `flashcards`, Migration
// 20261003120000_course_flashcard_generation).
//
// Ablauf: Dokumente wählen -> `analyze` schätzt die Zahl sinnvoller Lernpunkte -> der
// Nutzer bestätigt -> `generate` erzeugt die Karten -> im Review kann er sie bearbeiten
// oder abwählen -> `save` legt Material, Deck und Karten in einer Transaktion an.
// Vor dem Speichern entsteht nichts Dauerhaftes; der Job lebt im Backend, nicht im Browser.

export type FlashcardJobStatus =
  | "queued" | "processing" | "estimated" | "review" | "completed" | "failed" | "cancelled";
export type FlashcardJobPhase = "analyze" | "generate";

export type FlashcardSourceRef = {
  documentId: string | null;
  title: string;
  page: number | null;
};

export type GeneratedCard = {
  id: string;
  question: string;
  answer: string;
  sourceIds: string[];
};

export type FlashcardJob = {
  id: string;
  status: FlashcardJobStatus;
  phase: FlashcardJobPhase;
  errorCode: string | null;
  materialId: string | null;
  requestedCount: number | null;
  /** Fertig analysierte Textabschnitte von insgesamt `total`. */
  analyzed: number;
  total: number;
  /** Zahl der ausgewählten Lernpunkte — die geschätzte Kartenzahl. */
  estimatedCount: number;
  generated: number;
  /** Nur im Status `review` gefüllt. */
  cards: GeneratedCard[];
  sources: FlashcardSourceRef[];
};

export type SelectableDocument = {
  id: string;
  title: string;
  /** Nur fertig verarbeitete Dokumente dürfen in die Auswahl. */
  ready: boolean;
};

export type FlashcardErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_REQUEST"
  | "REQUEST_TOO_LARGE"
  | "TARGET_NOT_FOUND"
  | "REQUEST_CONFLICT"
  | "SOURCES_NOT_READY"
  | "SOURCE_CHANGED"
  | "SOURCE_LIMIT_EXCEEDED"
  | "RATE_LIMITED"
  | "NEW_REQUEST_REQUIRED"
  | "FLASHCARDS_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "UNKNOWN";

export class FlashcardGenerationError extends Error {
  readonly code: FlashcardErrorCode;
  constructor(code: FlashcardErrorCode) {
    super(code);
    this.name = "FlashcardGenerationError";
    this.code = code;
  }
}

const KNOWN_CODES = new Set<string>([
  "UNAUTHENTICATED", "INVALID_REQUEST", "REQUEST_TOO_LARGE", "TARGET_NOT_FOUND", "REQUEST_CONFLICT",
  "SOURCES_NOT_READY", "SOURCE_CHANGED", "SOURCE_LIMIT_EXCEEDED", "RATE_LIMITED",
  "NEW_REQUEST_REQUIRED", "FLASHCARDS_UNAVAILABLE",
]);

export function toFlashcardErrorCode(value: unknown): FlashcardErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value) ? (value as FlashcardErrorCode) : "UNKNOWN";
}

export function flashcardErrorMessage(error: unknown): string {
  const code = error instanceof FlashcardGenerationError ? error.code : "UNKNOWN";
  switch (code) {
    case "UNAUTHENTICATED":
      return "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.";
    case "SOURCES_NOT_READY":
      return "Mindestens eine gewählte Unterlage wird noch verarbeitet. Warte, bis sie fertig ist.";
    case "SOURCE_CHANGED":
      return "Die Unterlagen haben sich während der Generierung geändert. Starte sie neu.";
    case "SOURCE_LIMIT_EXCEEDED":
    case "REQUEST_TOO_LARGE":
      return "Die Auswahl ist zu umfangreich. Wähle weniger Unterlagen auf einmal.";
    case "RATE_LIMITED":
      return "Du hast gerade zu viele Kartensätze erzeugt. Es sind höchstens vier offene Aufträge gleichzeitig möglich.";
    case "NEW_REQUEST_REQUIRED":
    case "REQUEST_CONFLICT":
      return "Dieser Auftrag lässt sich nicht fortsetzen. Starte die Generierung neu.";
    case "TARGET_NOT_FOUND":
      return "Nicht gefunden. Möglicherweise wurde der Kurs oder die Unterlage gelöscht.";
    case "FLASHCARDS_UNAVAILABLE":
      return "Der Dienst ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.";
    case "NETWORK_ERROR":
      return "Keine Verbindung zum Server. Prüfe deine Internetverbindung.";
    default:
      return "Die Karteikarten konnten nicht erzeugt werden. Bitte versuche es erneut.";
  }
}

/** Grenzen aus dem Backend-Vertrag; das Formular soll sie nicht erst serverseitig erfahren. */
export const MAX_SELECTED_DOCUMENTS = 200;
export const MIN_REQUESTED_CARDS = 1;
export const MAX_REQUESTED_CARDS = 300;
export const MAX_QUESTION_LENGTH = 500;
export const MAX_ANSWER_LENGTH = 2000;
export const MAX_DECK_TITLE_LENGTH = 200;
export const FLASHCARD_POLL_INTERVAL_MS = 3000;

const RUNNING: FlashcardJobStatus[] = ["queued", "processing"];
export function isFlashcardJobRunning(job: FlashcardJob): boolean {
  return RUNNING.includes(job.status);
}

export type FlashcardProgress = { label: string; indeterminate: boolean; percent: number | null };

export function flashcardProgress(job: FlashcardJob): FlashcardProgress {
  if (job.phase === "generate") {
    if (job.estimatedCount <= 0) return { label: "Karten werden erstellt", indeterminate: true, percent: null };
    const percent = Math.round(Math.min(1, job.generated / job.estimatedCount) * 100);
    return { label: "Karten werden erstellt", indeterminate: false, percent };
  }
  if (job.total <= 0) return { label: "Unterlagen werden gelesen", indeterminate: true, percent: null };
  const percent = Math.round(Math.min(1, job.analyzed / job.total) * 100);
  return { label: "Unterlagen werden gelesen", indeterminate: false, percent };
}

/** Eine Karte ist speicherbar, wenn beide Seiten gefüllt und innerhalb der Backend-Grenzen sind. */
export function isCardValid(card: { question: string; answer: string }): boolean {
  const question = card.question.trim();
  const answer = card.answer.trim();
  return (
    question.length >= 1 && question.length <= MAX_QUESTION_LENGTH &&
    answer.length >= 1 && answer.length <= MAX_ANSWER_LENGTH
  );
}

export type DeckValidation = { ok: true } | { ok: false; message: string };

/** Prüft die Auswahl vor dem Speichern gegen dieselben Regeln wie das Backend. */
export function validateDeckSave(title: string, cards: { question: string; answer: string }[]): DeckValidation {
  const trimmed = title.trim();
  if (trimmed.length < 1) return { ok: false, message: "Gib dem Kartensatz einen Namen." };
  if (trimmed.length > MAX_DECK_TITLE_LENGTH) {
    return { ok: false, message: `Der Name darf höchstens ${MAX_DECK_TITLE_LENGTH} Zeichen haben.` };
  }
  if (cards.length < 1) return { ok: false, message: "Wähle mindestens eine Karte aus." };
  if (cards.length > MAX_REQUESTED_CARDS) {
    return { ok: false, message: `Es lassen sich höchstens ${MAX_REQUESTED_CARDS} Karten auf einmal speichern.` };
  }
  if (!cards.every(isCardValid)) {
    return { ok: false, message: "Jede Karte braucht eine Frage und eine Antwort." };
  }
  return { ok: true };
}

// --- Antworten lesen -------------------------------------------------------

const STATUSES: FlashcardJobStatus[] = [
  "queued", "processing", "estimated", "review", "completed", "failed", "cancelled",
];

function parseCards(value: unknown): GeneratedCard[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as { id?: unknown; question?: unknown; answer?: unknown; source_ids?: unknown };
    if (typeof row.id !== "string" || typeof row.question !== "string" || typeof row.answer !== "string") return [];
    return [{
      id: row.id,
      question: row.question,
      answer: row.answer,
      sourceIds: Array.isArray(row.source_ids) ? row.source_ids.filter((id): id is string => typeof id === "string") : [],
    }];
  });
}

function parseSources(value: unknown): FlashcardSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as { id?: unknown; document_id?: unknown; title?: unknown; page?: unknown };
    const title = typeof row.title === "string" ? row.title : null;
    if (!title) return [];
    return [{
      documentId: typeof row.document_id === "string" ? row.document_id : null,
      title,
      page: typeof row.page === "number" ? row.page : null,
    }];
  });
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function parseFlashcardJob(payload: unknown): FlashcardJob {
  const raw = (payload ?? {}) as Record<string, unknown>;
  if (typeof raw.id !== "string") throw new FlashcardGenerationError("INVALID_RESPONSE");
  const status = STATUSES.find((value) => value === raw.status);
  if (!status) throw new FlashcardGenerationError("INVALID_RESPONSE");
  return {
    id: raw.id,
    status,
    phase: raw.phase === "generate" ? "generate" : "analyze",
    errorCode: typeof raw.error_code === "string" ? raw.error_code : null,
    materialId: typeof raw.material_id === "string" ? raw.material_id : null,
    requestedCount: typeof raw.requested_count === "number" ? raw.requested_count : null,
    analyzed: count(raw.analyzed),
    total: count(raw.total),
    estimatedCount: count(raw.estimated_count),
    generated: count(raw.generated),
    cards: parseCards(raw.cards),
    sources: parseSources(raw.sources),
  };
}

export function parseSelectableDocuments(payload: unknown): SelectableDocument[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entry) => {
    const row = entry as { id?: unknown; title?: unknown; ready?: unknown };
    if (typeof row.id !== "string") return [];
    return [{
      id: row.id,
      title: typeof row.title === "string" ? row.title : "Unbenannte Unterlage",
      ready: row.ready === true,
    }];
  });
}

// --- Aufrufe ---------------------------------------------------------------

async function call(client: SupabaseClient<Database>, body: Record<string, unknown>): Promise<unknown> {
  const result = await client.functions.invoke("flashcards", { body });
  if (result.error instanceof FunctionsHttpError) {
    const response = result.error.context as Response;
    let parsed: { error?: { code?: unknown } } | undefined;
    try {
      parsed = await response.json();
    } catch {
      /* Kein JSON-Body: unten allgemein behandelt. */
    }
    throw new FlashcardGenerationError(
      response.status === 401 ? "UNAUTHENTICATED" : toFlashcardErrorCode(parsed?.error?.code)
    );
  }
  if (result.error) throw new FlashcardGenerationError("NETWORK_ERROR");
  if (result.data === null || result.data === undefined) {
    throw new FlashcardGenerationError("INVALID_RESPONSE");
  }
  return result.data;
}

export async function listSelectableDocuments(
  client: SupabaseClient<Database>,
  courseId: string
): Promise<SelectableDocument[]> {
  return parseSelectableDocuments(await call(client, { action: "documents", course_id: courseId }));
}

/** Noch offene Aufträge dieses Kurses — damit ein Reload den Stand wiederfindet. */
export async function listUnfinishedJobs(
  client: SupabaseClient<Database>,
  courseId: string
): Promise<FlashcardJob[]> {
  const data = await call(client, { action: "list", course_id: courseId });
  return Array.isArray(data) ? data.map(parseFlashcardJob) : [];
}

/** `count: null` überlässt dem Backend die Zahl der Karten (automatischer Umfang). */
export async function startFlashcardAnalysis(
  client: SupabaseClient<Database>,
  requestId: string,
  courseId: string,
  documentIds: string[],
  requestedCount: number | null
): Promise<FlashcardJob> {
  return parseFlashcardJob(await call(client, {
    action: "analyze",
    request_id: requestId,
    course_id: courseId,
    document_ids: documentIds,
    count: requestedCount,
  }));
}

export async function fetchFlashcardJob(client: SupabaseClient<Database>, jobId: string): Promise<FlashcardJob> {
  return parseFlashcardJob(await call(client, { action: "status", job_id: jobId }));
}

/** Setzt einen geschätzten Auftrag fort und erzeugt die Karten. */
export async function continueFlashcardJob(client: SupabaseClient<Database>, jobId: string): Promise<FlashcardJob> {
  return parseFlashcardJob(await call(client, { action: "generate", job_id: jobId }));
}

export async function retryFlashcardJob(client: SupabaseClient<Database>, jobId: string): Promise<FlashcardJob> {
  return parseFlashcardJob(await call(client, { action: "retry", job_id: jobId }));
}

export async function cancelFlashcardJob(client: SupabaseClient<Database>, jobId: string): Promise<FlashcardJob> {
  return parseFlashcardJob(await call(client, { action: "cancel", job_id: jobId }));
}

/** Legt Material, Deck und die ausgewählten Karten in einer Transaktion an. */
export async function saveGeneratedDeck(
  client: SupabaseClient<Database>,
  jobId: string,
  title: string,
  cards: GeneratedCard[]
): Promise<FlashcardJob> {
  return parseFlashcardJob(await call(client, {
    action: "save",
    job_id: jobId,
    title: title.trim(),
    cards: cards.map((card) => ({ id: card.id, question: card.question.trim(), answer: card.answer.trim() })),
  }));
}
