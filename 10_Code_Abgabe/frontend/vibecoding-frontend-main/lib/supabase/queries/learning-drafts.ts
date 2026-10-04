import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";

// Entwürfe für noch nicht gespeicherte Lerninhalte (Backend-Migration 20261003141000).
//
// Ein Entwurf hängt im Backend immer an genau einem Quelldokument (`source_material_id`)
// und hat eine Art (`summary` oder `flashcards`). Geschrieben wird nur über
// `save_learning_draft` mit der zuletzt bekannten Revision: hat inzwischen ein anderer Tab
// gespeichert, antwortet das Backend mit DRAFT_CONFLICT, statt dessen Stand zu überschreiben.
//
// Nimmt den Client als Parameter und hat nur relative Importe, damit es ohne Browser
// testbar bleibt.

type Client = SupabaseClient<Database>;

export type DraftKind = "summary" | "flashcards";

/** Ein anderer Tab hat den Entwurf inzwischen weitergeschrieben. */
export class DraftConflictError extends Error {
  constructor() {
    super("DRAFT_CONFLICT");
    this.name = "DraftConflictError";
  }
}

type RpcError = { code?: string; message?: string };

function isConflict(error: RpcError): boolean {
  return error.code === "40001" || (error.message ?? "").includes("DRAFT_CONFLICT");
}

export type StoredDraft = { payload: unknown; revision: number };

export async function loadDraft(client: Client, sourceMaterialId: string, kind: DraftKind): Promise<StoredDraft | null> {
  const { data, error } = await client
    .from("learning_drafts")
    .select("payload, revision")
    .eq("source_material_id", sourceMaterialId)
    .eq("kind", kind)
    .maybeSingle();

  if (error) throw error;
  return data ? { payload: data.payload, revision: data.revision } : null;
}

/**
 * Speichert den Entwurf und liefert die neue Revision. `expectedRevision` ist die zuletzt
 * geladene oder gespeicherte Revision, beim ersten Speichern `0`.
 */
export async function saveDraft(
  client: Client,
  sourceMaterialId: string,
  kind: DraftKind,
  payload: Json,
  expectedRevision: number
): Promise<number> {
  const { data, error } = await client.rpc("save_learning_draft", {
    p_source_material: sourceMaterialId,
    p_kind: kind,
    p_payload: payload,
    p_expected_revision: expectedRevision,
  });

  if (error) throw isConflict(error) ? new DraftConflictError() : error;
  return data;
}

/**
 * Löscht den Entwurf nach dem endgültigen Speichern. Hat ein anderer Tab inzwischen
 * weitergeschrieben, bleibt dessen Entwurf bewusst erhalten — das ist kein Fehler.
 */
export async function deleteDraft(
  client: Client,
  sourceMaterialId: string,
  kind: DraftKind,
  expectedRevision: number
): Promise<void> {
  const { error } = await client.rpc("save_learning_draft", {
    p_source_material: sourceMaterialId,
    p_kind: kind,
    p_payload: null,
    p_expected_revision: expectedRevision,
  });

  if (error && !isConflict(error)) throw error;
}

/** Das Material eines Quelldokuments (`source_documents.id` → `materials.id`). */
export async function sourceMaterialOf(client: Client, documentId: string): Promise<string | null> {
  const { data, error } = await client
    .from("source_documents")
    .select("material_id")
    .eq("id", documentId)
    .maybeSingle();

  if (error) throw error;
  return data?.material_id ?? null;
}

/**
 * Ein Entwurf braucht genau ein Quelldokument. Stammen die Inhalte aus mehreren Dokumenten
 * (oder ist keines bekannt), gibt es keinen Ort dafür und damit keinen Entwurf.
 */
export function singleSourceDocumentId(sources: { documentId: string | null }[]): string | null {
  const ids = new Set(sources.map((source) => source.documentId));
  const [only] = ids;
  return ids.size === 1 && only ? only : null;
}

// --- Karteikarten-Entwurf: bearbeitete, noch nicht gespeicherte generierte Karten

export const DRAFT_MAX_CARDS = 300;
export const DRAFT_MAX_QUESTION = 1000;
export const DRAFT_MAX_ANSWER = 4000;

export type DraftCard = { id: string; question: string; answer: string; keep: boolean };

export type FlashcardDraft = {
  /** Der Generierungsauftrag, zu dem die Karten gehören. */
  jobId: string;
  title: string;
  cards: DraftCard[];
};

/** Ob das Backend diesen Entwurf annehmen würde; sonst wird er gar nicht erst gesendet. */
export function fitsDraftLimits(draft: FlashcardDraft): boolean {
  return (
    draft.cards.length <= DRAFT_MAX_CARDS &&
    draft.cards.every((card) => card.question.length <= DRAFT_MAX_QUESTION && card.answer.length <= DRAFT_MAX_ANSWER)
  );
}

function isDraftCard(value: unknown): value is DraftCard {
  if (typeof value !== "object" || value === null) return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.id === "string" &&
    typeof card.question === "string" &&
    typeof card.answer === "string" &&
    typeof card.keep === "boolean"
  );
}

/**
 * Liest einen gespeicherten Karteikarten-Entwurf. `null`, wenn er zu einem anderen Auftrag
 * gehört oder nicht die erwartete Form hat — dann wird er nicht übernommen.
 */
export function parseFlashcardDraft(payload: unknown, jobId: string): FlashcardDraft | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = payload as Record<string, unknown>;
  if (raw.jobId !== jobId || typeof raw.title !== "string" || !Array.isArray(raw.cards)) return null;
  if (!raw.cards.every(isDraftCard)) return null;
  return {
    jobId,
    title: raw.title,
    cards: raw.cards.map(({ id, question, answer, keep }) => ({ id, question, answer, keep })),
  };
}

/**
 * Überträgt die Bearbeitungen eines Entwurfs auf die Karten des Auftrags. Maßgeblich bleibt
 * die Kartenliste des Auftrags: Karten, die der Entwurf nicht kennt, bleiben unverändert.
 */
export function applyFlashcardDraft<T extends DraftCard>(cards: T[], draft: FlashcardDraft): T[] {
  const edits = new Map(draft.cards.map((card) => [card.id, card]));
  return cards.map((card) => {
    const edit = edits.get(card.id);
    return edit ? { ...card, question: edit.question, answer: edit.answer, keep: edit.keep } : card;
  });
}
