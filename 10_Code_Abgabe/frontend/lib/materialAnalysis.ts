import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Terminerkennung aus Unterlagen (Backend-Function `material-analysis`, Migration
// 20261003130000_material_analysis).
//
// Das Backend schlägt Termine vor, legt aber selbst keine an. Jeder Vorschlag muss vom
// Nutzer bestätigt werden; erst die `accept`-Aktion erzeugt den Kalendereintrag atomar.
// Das Frontend erfindet weder Termine noch Kalenderzeilen und schreibt nichts direkt.

export type AnalysisStatus = "processing" | "completed" | "failed";

/** Die Kalenderarten, die das Backend bei der Bestätigung akzeptiert. */
export type ConfirmableEventKind =
  | "lecture" | "exercise" | "study" | "presentation" | "exam" | "deadline" | "other";

export type AnalysisIssue = {
  code: string;
  /** Vom Backend gelieferte deutsche Erklärung. Untrusted: nur als Text anzeigen. */
  message: string;
};

export type CalendarSuggestion = {
  id: string;
  title: string;
  description: string | null;
  page: number | null;
  /** Originalzitat aus der Unterlage. Belegt die Fundstelle, nicht die Richtigkeit. */
  quote: string;
  reviewRequired: boolean;
  issues: AnalysisIssue[];
  kind: "event" | "deadline";
  date: string | null;
  time: string | null;
  endDate: string | null;
  endTime: string | null;
  timezone: string | null;
  location: string | null;
  submissionChannel: string | null;
};

export type AnalysisDecision = {
  itemId: string;
  status: "accepted" | "dismissed";
  calendarEventId: string | null;
};

export type MaterialAnalysis = {
  analysisId: string;
  materialId: string;
  status: AnalysisStatus;
  items: CalendarSuggestion[];
  warnings: AnalysisIssue[];
  errorCode: string | null;
  decisions: AnalysisDecision[];
};

export type AnalysisErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_REQUEST"
  | "TARGET_NOT_FOUND"
  | "ANALYSIS_NOT_FOUND"
  | "ITEM_NOT_FOUND"
  | "SOURCES_NOT_READY"
  | "REQUEST_CONFLICT"
  | "SOURCE_CHANGED"
  | "ANALYSIS_NOT_READY"
  | "ANALYSIS_EXPIRED"
  | "DECISION_CONFLICT"
  | "REQUEST_TOO_LARGE"
  | "SOURCE_LIMIT_EXCEEDED"
  | "ANALYSIS_RATE_LIMITED"
  | "ANSWERS_NOT_CONFIGURED"
  | "ANALYSIS_UNAVAILABLE"
  | "ANALYSIS_TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "UNKNOWN";

export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;
  constructor(code: AnalysisErrorCode) {
    super(code);
    this.name = "AnalysisError";
    this.code = code;
  }
}

const KNOWN_CODES = new Set<string>([
  "UNAUTHENTICATED", "INVALID_REQUEST", "TARGET_NOT_FOUND", "ANALYSIS_NOT_FOUND", "ITEM_NOT_FOUND",
  "SOURCES_NOT_READY", "REQUEST_CONFLICT", "SOURCE_CHANGED", "ANALYSIS_NOT_READY", "ANALYSIS_EXPIRED",
  "DECISION_CONFLICT", "REQUEST_TOO_LARGE", "SOURCE_LIMIT_EXCEEDED", "ANALYSIS_RATE_LIMITED",
  "ANSWERS_NOT_CONFIGURED", "ANALYSIS_UNAVAILABLE", "ANALYSIS_TIMEOUT",
]);

export function toAnalysisErrorCode(value: unknown): AnalysisErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value) ? (value as AnalysisErrorCode) : "UNKNOWN";
}

export function analysisErrorMessage(error: unknown): string {
  const code = error instanceof AnalysisError ? error.code : "UNKNOWN";
  switch (code) {
    case "UNAUTHENTICATED":
      return "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.";
    case "SOURCES_NOT_READY":
      return "Diese Unterlage wird noch verarbeitet. Warte, bis die Textextraktion fertig ist.";
    case "SOURCE_CHANGED":
      return "Die Unterlage hat sich während der Analyse geändert. Starte die Suche neu.";
    case "REQUEST_TOO_LARGE":
    case "SOURCE_LIMIT_EXCEEDED":
      return "Diese Unterlage ist für die Terminsuche zu umfangreich.";
    case "ANALYSIS_RATE_LIMITED":
      return "Du hast gerade zu viele Analysen gestartet. Bitte warte einen Moment.";
    case "ANALYSIS_TIMEOUT":
      return "Die Analyse hat zu lange gedauert. Starte sie erneut.";
    case "ANSWERS_NOT_CONFIGURED":
      return "Die Terminsuche ist auf diesem Server noch nicht eingerichtet.";
    case "ANALYSIS_UNAVAILABLE":
      return "Der Dienst ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.";
    case "DECISION_CONFLICT":
      return "Über diesen Vorschlag wurde bereits entschieden. Lade die Analyse neu.";
    case "ANALYSIS_EXPIRED":
      return "Diese Analyse ist nicht mehr gültig. Starte die Terminsuche neu.";
    case "REQUEST_CONFLICT":
      return "Für diese Anfrage liegt bereits eine andere Analyse vor. Starte die Suche neu.";
    case "TARGET_NOT_FOUND":
    case "ANALYSIS_NOT_FOUND":
    case "ITEM_NOT_FOUND":
      return "Nicht gefunden. Möglicherweise wurde die Unterlage oder der Vorschlag gelöscht.";
    case "NETWORK_ERROR":
      return "Keine Verbindung zum Server. Prüfe deine Internetverbindung.";
    default:
      return "Die Terminsuche ist fehlgeschlagen. Bitte versuche es erneut.";
  }
}

// --- Vorschlag -> Formular -------------------------------------------------

/**
 * Das Backend unterscheidet nur `event` und `deadline`. Alles Genauere (Prüfung, Übung …)
 * entscheidet der Nutzer im Bestätigungsformular — eine Kalenderart aus dem Titel zu raten
 * wäre erfunden.
 */
export function defaultEventKind(kind: "event" | "deadline"): ConfirmableEventKind {
  return kind === "deadline" ? "deadline" : "other";
}

export type SuggestionFormValues = {
  title: string;
  description: string;
  kind: ConfirmableEventKind;
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
};

/**
 * Vorbelegung des Bestätigungsformulars. Ein Vorschlag ohne Uhrzeit wird als ganztägig
 * vorgeschlagen — so steht im Kalender keine erfundene Uhrzeit.
 */
export function suggestionFormValues(suggestion: CalendarSuggestion): SuggestionFormValues {
  const allDay = suggestion.time === null;
  return {
    title: suggestion.title,
    description: suggestion.description ?? "",
    kind: defaultEventKind(suggestion.kind),
    date: suggestion.date ?? "",
    time: suggestion.time ? suggestion.time.slice(0, 5) : "09:00",
    endDate: suggestion.endDate ?? "",
    endTime: suggestion.endTime ? suggestion.endTime.slice(0, 5) : "",
    allDay,
  };
}

/** Die Zeitzone, in der diese App Termine anlegt: die des Browsers. */
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Weicht die erkannte Zeitzone von der des Browsers ab, wird der Termin in Browserzeit
 * angelegt — das muss der Nutzer sehen, statt dass stillschweigend verschoben wird.
 */
export function timezoneMismatch(suggestion: CalendarSuggestion, browser = browserTimezone()): string | null {
  if (!suggestion.timezone || suggestion.timezone === browser) return null;
  return `In der Unterlage steht die Zeitzone ${suggestion.timezone}, dein Kalender arbeitet in ${browser}. Prüfe die Uhrzeit.`;
}

// --- Antworten lesen -------------------------------------------------------

function parseIssues(value: unknown): AnalysisIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as { code?: unknown; message?: unknown };
    if (typeof row.message !== "string") return [];
    return [{ code: typeof row.code === "string" ? row.code : "", message: row.message }];
  });
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseSuggestion(entry: unknown): CalendarSuggestion[] {
  const row = (entry ?? {}) as {
    id?: unknown; type?: unknown; title?: unknown; description?: unknown;
    source?: { page?: unknown; quote?: unknown };
    review?: { required?: unknown; issues?: unknown };
    data?: Record<string, unknown>;
  };
  // Version 1 kennt nur `calendar_entry`; spätere Typen werden still übersprungen,
  // statt sie als Termin zu deuten.
  if (typeof row.id !== "string" || row.type !== "calendar_entry") return [];
  if (typeof row.title !== "string") return [];
  const data = row.data ?? {};
  const kind = data.kind === "deadline" ? "deadline" : "event";
  return [{
    id: row.id,
    title: row.title,
    description: text(row.description),
    page: typeof row.source?.page === "number" ? row.source.page : null,
    quote: typeof row.source?.quote === "string" ? row.source.quote : "",
    reviewRequired: row.review?.required === true,
    issues: parseIssues(row.review?.issues),
    kind,
    date: text(data.date),
    time: text(data.time),
    endDate: text(data.end_date),
    endTime: text(data.end_time),
    timezone: text(data.timezone),
    location: text(data.location),
    submissionChannel: text(data.submission_channel),
  }];
}

function parseDecisions(value: unknown): AnalysisDecision[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = entry as { item_id?: unknown; status?: unknown; calendar_event_id?: unknown };
    if (typeof row.item_id !== "string") return [];
    if (row.status !== "accepted" && row.status !== "dismissed") return [];
    return [{
      itemId: row.item_id,
      status: row.status,
      calendarEventId: typeof row.calendar_event_id === "string" ? row.calendar_event_id : null,
    }];
  });
}

const STATUSES: AnalysisStatus[] = ["processing", "completed", "failed"];

export function parseAnalysisResult(payload: unknown): MaterialAnalysis {
  const raw = (payload ?? {}) as Record<string, unknown>;
  if (typeof raw.analysis_id !== "string") throw new AnalysisError("INVALID_RESPONSE");
  const status = STATUSES.find((value) => value === raw.status);
  if (!status) throw new AnalysisError("INVALID_RESPONSE");
  return {
    analysisId: raw.analysis_id,
    materialId: typeof raw.material_id === "string" ? raw.material_id : "",
    status,
    items: Array.isArray(raw.items) ? raw.items.flatMap(parseSuggestion) : [],
    warnings: parseIssues(raw.warnings),
    errorCode: typeof raw.error_code === "string" ? raw.error_code : null,
    decisions: parseDecisions(raw.decisions),
  };
}

export function parseDecision(payload: unknown): AnalysisDecision {
  const parsed = parseDecisions([payload]);
  if (parsed.length === 0) throw new AnalysisError("INVALID_RESPONSE");
  return parsed[0];
}

// --- Aufrufe ---------------------------------------------------------------

async function unwrap<T>(result: { data: T | null; error: unknown }): Promise<T> {
  if (result.error instanceof FunctionsHttpError) {
    const response = result.error.context as Response;
    let body: { error?: { code?: unknown } } | undefined;
    try {
      body = await response.json();
    } catch {
      /* Kein JSON-Body: unten allgemein behandelt. */
    }
    throw new AnalysisError(response.status === 401 ? "UNAUTHENTICATED" : toAnalysisErrorCode(body?.error?.code));
  }
  if (result.error) throw new AnalysisError("NETWORK_ERROR");
  if (!result.data) throw new AnalysisError("INVALID_RESPONSE");
  return result.data;
}

/**
 * Startet die Terminsuche für ein Material. `requestId` bei Netzwerk-Wiederholungen
 * beibehalten; nach einem Fehlschlag braucht ein bewusster neuer Versuch eine neue ID.
 *
 * `referenceDate` ist bewusst optional und wird nirgends automatisch mit dem Upload-Datum
 * belegt — das Backend-Dokument verbietet das ausdrücklich, weil daraus falsche Jahre
 * abgeleitet würden.
 */
export async function analyzeMaterial(
  client: SupabaseClient<Database>,
  requestId: string,
  materialId: string,
  options: { referenceDate?: string | null } = {}
): Promise<MaterialAnalysis> {
  const result = await client.functions.invoke("material-analysis", {
    body: {
      action: "analyze",
      request_id: requestId,
      material_id: materialId,
      context: { reference_date: options.referenceDate ?? null, timezone: browserTimezone() },
    },
  });
  return parseAnalysisResult(await unwrap(result));
}

export async function fetchAnalysis(
  client: SupabaseClient<Database>,
  analysisId: string
): Promise<MaterialAnalysis> {
  const result = await client.functions.invoke("material-analysis", {
    body: { action: "result", analysis_id: analysisId },
  });
  return parseAnalysisResult(await unwrap(result));
}

export type CalendarConfirmation = {
  title: string;
  description: string | null;
  kind: ConfirmableEventKind;
  /** ISO 8601 mit Sekunden und explizitem Offset bzw. `Z`. */
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
};

/** Das Backend verlangt Sekundengenauigkeit ohne Bruchteile; `toISOString()` liefert `.000Z`. */
function withoutFraction(iso: string): string {
  return iso.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/, "");
}

export async function acceptSuggestion(
  client: SupabaseClient<Database>,
  analysisId: string,
  itemId: string,
  event: CalendarConfirmation
): Promise<AnalysisDecision> {
  const result = await client.functions.invoke("material-analysis", {
    body: {
      action: "accept",
      analysis_id: analysisId,
      item_id: itemId,
      event: {
        title: event.title,
        description: event.description,
        kind: event.kind,
        starts_at: withoutFraction(event.startsAt),
        ends_at: event.endsAt === null ? null : withoutFraction(event.endsAt),
        all_day: event.allDay,
      },
    },
  });
  return parseDecision(await unwrap(result));
}

export async function dismissSuggestion(
  client: SupabaseClient<Database>,
  analysisId: string,
  itemId: string
): Promise<AnalysisDecision> {
  const result = await client.functions.invoke("material-analysis", {
    body: { action: "dismiss", analysis_id: analysisId, item_id: itemId },
  });
  return parseDecision(await unwrap(result));
}
