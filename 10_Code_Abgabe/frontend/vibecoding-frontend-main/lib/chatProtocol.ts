export type ChatCourse = { id: string; title: string };
export type Conversation = { id: string; course_id: string; title: string; updated_at: string };
export type ChatSource = {
  citation_no: number;
  material_title: string;
  page_number: number | null;
  excerpt: string;
};
export type ChatMessage = {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  request_id?: string;
  // Own rating of an assistant answer: null/undefined = not rated. `helpful_at` is server-owned.
  helpful?: boolean | null;
  helpful_at?: string | null;
  chat_message_sources: ChatSource[];
};
// `material_ids` is the backend's optional material scope: omitted means the whole
// course; present means retrieval is limited to exactly these materials. The backend
// rejects an empty list and treats it as part of the request identity, so a retry of a
// request must carry the same scope.
export type ChatRequest = {
  conversation_id: string;
  request_id: string;
  question: string;
  material_ids?: [string, ...string[]];
};
export type ChatExchange = {
  conversation_id: string;
  request_id: string;
  messages: [Omit<ChatMessage, "chat_message_sources">, Omit<ChatMessage, "chat_message_sources">];
  sources: ChatSource[];
};

export class ChatError extends Error {
  code: string;
  retryAfter: number;
  constructor(code: string, retryAfter = 0) {
    super(chatErrorMessage(code));
    this.code = code;
    this.retryAfter = Math.max(0, Number.isFinite(retryAfter) ? retryAfter : 0);
  }
}

export function chatErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
    INVALID_REQUEST: "Bitte gib eine Frage mit höchstens 1800 Zeichen ein.",
    CONVERSATION_NOT_FOUND: "Dieser Chat ist nicht mehr verfügbar. Bitte wähle einen anderen Chat.",
    NO_INDEXED_MATERIAL: "Für diesen Kurs sind noch keine durchsuchbaren Unterlagen verfügbar. Die Unterlagen müssen im Backend hochgeladen und fertig indexiert sein.",
    NO_RELEVANT_MATERIAL: "In den Kursunterlagen wurde keine passende Textstelle gefunden. Formuliere deine Frage genauer.",
    REQUEST_ID_CONFLICT: "Die Anfrage konnte nicht eindeutig zugeordnet werden. Bitte lade den Chat neu.",
    REQUEST_IN_PROGRESS: "Deine Frage wird noch verarbeitet. Du kannst die Antwort nach der Wartezeit erneut abrufen.",
    CONVERSATION_BUSY: "In diesem Chat wird bereits eine Frage beantwortet. Bitte warte kurz.",
    REQUEST_LEASE_EXPIRED: "Die Verarbeitung wurde unterbrochen. Bitte wiederhole dieselbe Anfrage.",
    RATE_LIMITED: "Zu viele Fragen in kurzer Zeit. Bitte warte vor dem nächsten Versuch.",
    CONCURRENCY_LIMIT: "Eine andere Frage wird noch beantwortet. Bitte warte kurz.",
    ANSWERS_NOT_CONFIGURED: "Die Antwortgenerierung ist auf Staging noch nicht konfiguriert.",
    EMBEDDINGS_NOT_CONFIGURED: "Die Dokumentensuche ist auf Staging noch nicht konfiguriert.",
    EMBEDDING_CONTRACT_MISMATCH: "Die Dokumentensuche auf Staging ist nicht passend konfiguriert.",
    INVALID_CITATION: "Die Antwort enthielt ungültige Quellen. Bitte versuche dieselbe Anfrage erneut.",
    INCOMPLETE_ANSWER: "Die Antwort konnte nicht vollständig erzeugt werden. Bitte versuche es erneut.",
    INVALID_ANSWER_RESPONSE: "Es wurde keine gültige Antwort geliefert. Bitte versuche es erneut.",
    FEEDBACK_FAILED: "Feedback konnte nicht gespeichert werden.",
    UNUSABLE_AI_OUTPUT: "Die KI-Antwort konnte nicht vollständig verarbeitet werden. Bitte versuche es erneut.",
    REQUEST_CANCELLED: "Die Verarbeitung wurde unterbrochen. Bitte versuche es erneut.",
    CHAT_UNAVAILABLE: "Der Chat ist vorübergehend nicht verfügbar. Bitte versuche es erneut.",
    NETWORK_ERROR: "Die Verbindung wurde unterbrochen. Die Anfrage könnte bereits verarbeitet sein. Mit Wiederholen rufst du dieselbe Anfrage ab.",
    LOAD_FAILED: "Die Chatdaten konnten nicht geladen werden. Prüfe die Verbindung und ob die Chat-Tabellen auf Staging verfügbar sind.",
  };
  return messages[code] ?? messages.CHAT_UNAVAILABLE;
}

export function validateQuestion(question: string): boolean {
  return question.length <= 1800 && question.trim().length > 0;
}

// Only these failures establish that the user can safely change the question.
export function canDiscardRequest(code: string): boolean {
  return ["INVALID_REQUEST", "CONVERSATION_NOT_FOUND", "NO_INDEXED_MATERIAL", "NO_RELEVANT_MATERIAL"].includes(code);
}

/** Limits a request to a single material, e.g. the document that is currently open. */
export function withMaterialScope(request: ChatRequest, materialId: string): ChatRequest {
  return { ...request, material_ids: [materialId] };
}

/** Only persisted assistant answers can be rated; the backend enforces this again. */
export function canRate(message: Pick<ChatMessage, "id" | "role">): boolean {
  return message.role === "assistant" && message.id.length > 0;
}

/** Clicking the current rating withdraws it (the backend accepts `null`), otherwise it switches. */
export function nextFeedback(current: boolean | null, clicked: boolean): boolean | null {
  return current === clicked ? null : clicked;
}

export function withFeedback(messages: ChatMessage[], id: string, helpful: boolean | null): ChatMessage[] {
  return messages.map((message) => (message.id === id ? { ...message, helpful } : message));
}

export function mergeExchange(history: ChatMessage[], exchange: ChatExchange): ChatMessage[] {
  const messages = new Map(history.map((message) => [message.id, message]));
  exchange.messages.forEach((message) => messages.set(message.id, {
    ...message,
    request_id: exchange.request_id,
    chat_message_sources: message.role === "assistant" ? exchange.sources : [],
  }));
  return [...messages.values()].sort((a, b) => a.seq - b.seq);
}

/** Material readiness is advisory: only the backend can authoritatively check it at send time. */
export function sendBlockedReason(state: {
  courseId: string; busy: boolean; pending: boolean; loadFailed: boolean; waitSeconds: number; question: string;
}): string | null {
  if (!state.courseId) return "Wähle zuerst einen Kurs aus.";
  if (state.busy) return "Bitte warte, bis der aktuelle Vorgang abgeschlossen ist.";
  if (state.loadFailed) return "Die Chatdaten konnten nicht geladen werden. Klicke auf Aktualisieren.";
  if (state.pending) return "Eine Anfrage ist noch offen. Klicke auf Anfrage wiederholen.";
  if (state.waitSeconds > 0) return `Bitte warte noch ${state.waitSeconds} Sekunden.`;
  if (!validateQuestion(state.question)) return "Gib eine Frage mit 1 bis 1800 Zeichen ein.";
  return null;
}
