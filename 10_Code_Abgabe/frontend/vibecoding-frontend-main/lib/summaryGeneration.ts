import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Generierte Zusammenfassungen (Backend-Function `summaries`, Migrationen
// 20261003110000_generated_summaries und 20261003111000_summary_call_budgets).
//
// Die Generierung läuft im Hintergrund weiter, auch wenn der Browser zu ist: der Client
// stößt sie an, pollt den Jobstatus und liest am Ende das Ergebnis. Das Frontend erzeugt
// keine Inhalte und schreibt nichts in `summaries` — generierte Zeilen sind per RLS
// schreibgeschützt. Alles läuft über das JWT des angemeldeten Nutzers.

export type SummaryTarget =
  | { type: "course"; courseId: string }
  | { type: "document"; sourceDocumentId: string };

export type SummaryJobState = "queued" | "processing" | "completed" | "failed";
export type SummaryJobPhase = "queued" | "sections" | "document" | "course" | "completed" | "failed";

export type SummaryJob = {
  jobId: string;
  status: SummaryJobState;
  phase: SummaryJobPhase;
  completedSteps: number;
  totalSteps: number;
  summaryId: string | null;
  errorCode: string | null;
};

export type SummarySource = {
  id: string;
  sourceDocumentId: string;
  materialId: string;
  title: string;
  page: number | null;
};

export type SummarySection = {
  heading: string;
  text: string;
  sourceIds: string[];
};

export type GeneratedSummary = {
  summaryId: string;
  materialId: string;
  text: string;
  sections: SummarySection[];
  sources: SummarySource[];
  createdAt: string;
  /** Quellen haben sich seit der Generierung geändert — Ergebnis ist veraltet. */
  isStale: boolean;
};

/**
 * Fehlercodes des Backend-Vertrags plus zwei Transportfälle des Clients.
 * Unbekannte Backend-Codes werden als `UNKNOWN` geführt, nicht verschluckt.
 */
export type SummaryErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_REQUEST"
  | "REQUEST_TOO_LARGE"
  | "TARGET_NOT_FOUND"
  | "SUMMARY_NOT_FOUND"
  | "REQUEST_CONFLICT"
  | "NO_SOURCES"
  | "SOURCES_NOT_READY"
  | "SOURCE_LIMIT_EXCEEDED"
  | "SUMMARY_RATE_LIMITED"
  | "SOURCE_CHANGED"
  | "NEW_REQUEST_REQUIRED"
  | "BUDGET_EXCEEDED"
  | "SUMMARY_PROCESSING_FAILED"
  | "SUMMARIES_NOT_CONFIGURED"
  | "SUMMARIES_UNAVAILABLE"
  | "RESULT_DELETED"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "UNKNOWN";

export class SummaryError extends Error {
  readonly code: SummaryErrorCode;
  /** Bei SOURCES_NOT_READY nennt das Backend die betroffenen Dokumente. */
  readonly sourceDocumentIds: string[];
  constructor(code: SummaryErrorCode, sourceDocumentIds: string[] = []) {
    super(code);
    this.name = "SummaryError";
    this.code = code;
    this.sourceDocumentIds = sourceDocumentIds;
  }
}

const KNOWN_CODES = new Set<string>([
  "UNAUTHENTICATED",
  "INVALID_REQUEST",
  "REQUEST_TOO_LARGE",
  "TARGET_NOT_FOUND",
  "SUMMARY_NOT_FOUND",
  "REQUEST_CONFLICT",
  "NO_SOURCES",
  "SOURCES_NOT_READY",
  "SOURCE_LIMIT_EXCEEDED",
  "SUMMARY_RATE_LIMITED",
  "SOURCE_CHANGED",
  "NEW_REQUEST_REQUIRED",
  "BUDGET_EXCEEDED",
  "SUMMARY_PROCESSING_FAILED",
  "SUMMARIES_NOT_CONFIGURED",
  "SUMMARIES_UNAVAILABLE",
  "RESULT_DELETED",
]);

/** Macht aus einem Backend-Code einen bekannten Code dieses Moduls. */
export function toSummaryErrorCode(value: unknown): SummaryErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value) ? (value as SummaryErrorCode) : "UNKNOWN";
}

export function summaryErrorMessage(error: unknown): string {
  const code = error instanceof SummaryError ? error.code : "UNKNOWN";
  switch (code) {
    case "UNAUTHENTICATED":
      return "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.";
    case "NO_SOURCES":
      return "Dieser Kurs enthält noch keine verarbeiteten Unterlagen. Lade zuerst Vorlesungsmaterial hoch.";
    case "SOURCES_NOT_READY":
      return "Mindestens eine Unterlage wird noch verarbeitet. Warte, bis die Textextraktion fertig ist, und versuche es dann erneut.";
    case "SOURCE_LIMIT_EXCEEDED":
    case "REQUEST_TOO_LARGE":
      return "Der Kurs ist für eine Zusammenfassung zu umfangreich. Fasse weniger Unterlagen auf einmal zusammen.";
    case "SUMMARY_RATE_LIMITED":
      return "Du hast gerade zu viele Zusammenfassungen angefordert. Bitte warte einen Moment.";
    case "SOURCE_CHANGED":
      return "Die Unterlagen haben sich während der Generierung geändert. Starte die Zusammenfassung neu.";
    case "BUDGET_EXCEEDED":
      return "Das Verarbeitungsbudget für diese Zusammenfassung ist aufgebraucht. Starte sie mit weniger Unterlagen neu.";
    case "SUMMARY_PROCESSING_FAILED":
      return "Die Generierung ist mehrfach fehlgeschlagen. Du kannst es später erneut versuchen.";
    case "SUMMARIES_NOT_CONFIGURED":
      return "Zusammenfassungen sind auf diesem Server noch nicht eingerichtet.";
    case "SUMMARIES_UNAVAILABLE":
      return "Der Dienst ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.";
    case "RESULT_DELETED":
      return "Dieses Ergebnis wurde entfernt. Starte eine neue Zusammenfassung.";
    case "NEW_REQUEST_REQUIRED":
    case "REQUEST_CONFLICT":
      return "Dieser Auftrag lässt sich nicht fortsetzen. Starte eine neue Zusammenfassung.";
    case "TARGET_NOT_FOUND":
    case "SUMMARY_NOT_FOUND":
      return "Nicht gefunden. Möglicherweise wurde der Kurs oder das Ergebnis gelöscht.";
    case "NETWORK_ERROR":
      return "Keine Verbindung zum Server. Prüfe deine Internetverbindung.";
    default:
      return "Die Zusammenfassung konnte nicht erstellt werden. Bitte versuche es erneut.";
  }
}

/** Nur diese Fehler lassen sich mit demselben Auftrag erneut versuchen. */
export function isRetryableSummaryError(code: SummaryErrorCode): boolean {
  return code === "SUMMARY_PROCESSING_FAILED" || code === "SUMMARIES_UNAVAILABLE";
}

const PHASE_LABELS: Record<SummaryJobPhase, string> = {
  queued: "Wird eingereiht",
  sections: "Abschnitte werden gelesen",
  document: "Dokumente werden verdichtet",
  course: "Kurs wird zusammengeführt",
  completed: "Fertig",
  failed: "Fehlgeschlagen",
};

export type SummaryProgress = {
  label: string;
  /** Vor dem ersten fertigen Schritt kennt das Backend die Gesamtzahl noch nicht. */
  indeterminate: boolean;
  /** Anteil erledigter Arbeitsschritte (0–1), keine Zeitschätzung. */
  ratio: number | null;
  percent: number | null;
};

export function summaryProgress(job: SummaryJob): SummaryProgress {
  const label = PHASE_LABELS[job.phase] ?? "Wird verarbeitet";
  if (job.totalSteps <= 0 || job.completedSteps < 0) {
    return { label, indeterminate: true, ratio: null, percent: null };
  }
  const ratio = Math.min(1, job.completedSteps / job.totalSteps);
  return { label, indeterminate: false, ratio, percent: Math.round(ratio * 100) };
}

export function isSummaryJobFinished(job: SummaryJob): boolean {
  return job.status === "completed" || job.status === "failed";
}

/** Das Backend empfiehlt 3–5 Sekunden; bei Endzustand oder Navigation stoppen. */
export const SUMMARY_POLL_INTERVAL_MS = 4000;

const SOURCE_MARKER = /\[S\d{1,3}\]/g;

/**
 * Entfernt die Quellenmarker aus angezeigtem Text. Die Marker werden stattdessen über
 * `section.sourceIds` als eigene Quellenangaben dargestellt.
 */
export function stripSourceMarkers(text: string): string {
  return text.replace(SOURCE_MARKER, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,;:!?])/g, "$1").trim();
}

// --- Aufrufe ---------------------------------------------------------------

type InvokeResult<T> = { data: T | null; error: unknown };

async function unwrap<T>(result: InvokeResult<T>): Promise<T> {
  if (result.error instanceof FunctionsHttpError) {
    const response = result.error.context as Response;
    let body: { error?: { code?: unknown; details?: { source_document_ids?: unknown } } } | undefined;
    try {
      body = await response.json();
    } catch {
      /* Kein JSON-Body: unten als unbekannter Fehler behandelt. */
    }
    const code = response.status === 401 ? "UNAUTHENTICATED" : toSummaryErrorCode(body?.error?.code);
    const ids = body?.error?.details?.source_document_ids;
    throw new SummaryError(code, Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  }
  if (result.error) throw new SummaryError("NETWORK_ERROR");
  if (!result.data) throw new SummaryError("INVALID_RESPONSE");
  return result.data;
}

type JobPayload = {
  job_id?: unknown;
  status?: unknown;
  phase?: unknown;
  completed_steps?: unknown;
  total_steps?: unknown;
  summary_id?: unknown;
  error_code?: unknown;
};

const JOB_STATES: SummaryJobState[] = ["queued", "processing", "completed", "failed"];
const JOB_PHASES: SummaryJobPhase[] = ["queued", "sections", "document", "course", "completed", "failed"];

export function parseSummaryJob(payload: unknown): SummaryJob {
  const raw = (payload ?? {}) as JobPayload;
  if (typeof raw.job_id !== "string") throw new SummaryError("INVALID_RESPONSE");
  const status = JOB_STATES.find((value) => value === raw.status);
  if (!status) throw new SummaryError("INVALID_RESPONSE");
  const phase = JOB_PHASES.find((value) => value === raw.phase) ?? "queued";
  return {
    jobId: raw.job_id,
    status,
    phase,
    completedSteps: typeof raw.completed_steps === "number" ? raw.completed_steps : 0,
    totalSteps: typeof raw.total_steps === "number" ? raw.total_steps : 0,
    summaryId: typeof raw.summary_id === "string" ? raw.summary_id : null,
    errorCode: typeof raw.error_code === "string" ? raw.error_code : null,
  };
}

function targetBody(target: SummaryTarget) {
  return target.type === "course"
    ? { type: "course", course_id: target.courseId }
    : { type: "document", source_document_id: target.sourceDocumentId };
}

/**
 * Startet eine Generierung. `requestId` muss über Netzwerk-Wiederholungen hinweg gleich
 * bleiben, sonst entsteht ein zweiter Auftrag; ein neuer Quellenstand braucht eine neue ID.
 */
export async function startSummaryGeneration(
  client: SupabaseClient<Database>,
  requestId: string,
  target: SummaryTarget
): Promise<SummaryJob> {
  const result = await client.functions.invoke("summaries", {
    body: { action: "generate", request_id: requestId, target: targetBody(target) },
  });
  return parseSummaryJob(await unwrap(result));
}

export async function fetchSummaryJob(client: SupabaseClient<Database>, jobId: string): Promise<SummaryJob> {
  const result = await client.functions.invoke("summaries", { body: { action: "status", job_id: jobId } });
  return parseSummaryJob(await unwrap(result));
}

export async function retrySummaryGeneration(client: SupabaseClient<Database>, jobId: string): Promise<SummaryJob> {
  const result = await client.functions.invoke("summaries", { body: { action: "retry", job_id: jobId } });
  return parseSummaryJob(await unwrap(result));
}

type ResultPayload = {
  summary_id?: unknown;
  material_id?: unknown;
  created_at?: unknown;
  is_stale?: unknown;
  content?: {
    text?: unknown;
    sections?: unknown;
    sources?: unknown;
  };
};

function parseSections(value: unknown): SummarySection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as { heading?: unknown; text?: unknown; source_ids?: unknown };
    if (typeof row.text !== "string") return [];
    return [{
      heading: typeof row.heading === "string" ? row.heading : "",
      text: row.text,
      sourceIds: Array.isArray(row.source_ids) ? row.source_ids.filter((id): id is string => typeof id === "string") : [],
    }];
  });
}

function parseSources(value: unknown): SummarySource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as {
      id?: unknown; source_document_id?: unknown; material_id?: unknown; title?: unknown; page?: unknown;
    };
    if (typeof row.id !== "string") return [];
    return [{
      id: row.id,
      sourceDocumentId: typeof row.source_document_id === "string" ? row.source_document_id : "",
      materialId: typeof row.material_id === "string" ? row.material_id : "",
      title: typeof row.title === "string" ? row.title : "Unbenannte Unterlage",
      page: typeof row.page === "number" ? row.page : null,
    }];
  });
}

export function parseSummaryResult(payload: unknown): GeneratedSummary {
  const raw = (payload ?? {}) as ResultPayload;
  if (typeof raw.summary_id !== "string") throw new SummaryError("INVALID_RESPONSE");
  return {
    summaryId: raw.summary_id,
    materialId: typeof raw.material_id === "string" ? raw.material_id : "",
    text: typeof raw.content?.text === "string" ? raw.content.text : "",
    sections: parseSections(raw.content?.sections),
    sources: parseSources(raw.content?.sources),
    createdAt: typeof raw.created_at === "string" ? raw.created_at : "",
    isStale: raw.is_stale === true,
  };
}

export async function fetchSummaryResult(
  client: SupabaseClient<Database>,
  summaryId: string
): Promise<GeneratedSummary> {
  const result = await client.functions.invoke("summaries", {
    body: { action: "result", summary_id: summaryId },
  });
  return parseSummaryResult(await unwrap(result));
}
