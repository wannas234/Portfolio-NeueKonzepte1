import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

// Lernfortschritt für Karteikarten (Backend-Migration 20261003140000).
//
// Ersetzt die frühere Ablage in der Browser-Sitzung, die nur den geöffneten Tab
// überlebt hat. Den Wiederholungsrhythmus bestimmt ausschließlich der Server: ein richtiger
// Review startet bei einem Tag und verdoppelt das Intervall bis maximal 365 Tage, ein
// falscher setzt es zurück. Das Frontend rechnet hier nichts selbst aus.
//
// Diese Datei nimmt den Client als Parameter und hat nur relative Importe, damit sie sich
// ohne Browser testen lässt; `flashcardReview.ts` bindet den Browser-Client daran.

type Client = SupabaseClient<Database>;

export type CardProgress = {
  cardId: string;
  /** `null`, solange die Karte nie beantwortet wurde. */
  known: boolean | null;
  starred: boolean;
  intervalDays: number;
  repetitionCount: number;
  reviewedAt: string | null;
  dueAt: string | null;
};

export type DeckProgressCounts = {
  materialId: string;
  total: number;
  /** Karten ohne Review, einschließlich nur markierter. Getrennt von `due`. */
  new: number;
  reviewed: number;
  known: number;
  /** Fällige Wiederholungen; kann sich mit `known` überschneiden. */
  due: number;
};

type ProgressRow = {
  card_id: string;
  known: boolean | null;
  starred: boolean;
  interval_days: number;
  repetition_count: number;
  reviewed_at: string | null;
  due_at: string | null;
};

function mapProgress(row: ProgressRow): CardProgress {
  return {
    cardId: row.card_id,
    known: row.known,
    starred: row.starred,
    intervalDays: row.interval_days,
    repetitionCount: row.repetition_count,
    reviewedAt: row.reviewed_at,
    dueAt: row.due_at,
  };
}

/** Eine noch nie beantwortete, nicht markierte Karte. */
export function blankProgress(cardId: string): CardProgress {
  return { cardId, known: null, starred: false, intervalDays: 0, repetitionCount: 0, reviewedAt: null, dueAt: null };
}

export type CardStatus = "Gewusst" | "Nochmal" | "Gesehen" | "Neu";

/**
 * Status einer Karte. „Gesehen“ hat kein eigenes Feld im Backend: eine Fortschrittszeile
 * ohne Review bedeutet, dass die Karte aufgedeckt (oder markiert), aber nie beantwortet wurde.
 */
export function cardStatusLabel(progress: CardProgress | undefined): CardStatus {
  if (!progress) return "Neu";
  if (progress.known === true) return "Gewusst";
  if (progress.known === false) return "Nochmal";
  return "Gesehen";
}

const COLUMNS = "card_id, known, starred, interval_days, repetition_count, reviewed_at, due_at";

async function currentUserId(client: Client): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw error ?? new Error("Nicht angemeldet.");
  return data.user.id;
}

/** Fortschritt zu bestimmten Karten. RLS liefert nur die Zeilen des angemeldeten Nutzers. */
export async function listCardProgress(client: Client, cardIds: string[]): Promise<Map<string, CardProgress>> {
  if (cardIds.length === 0) return new Map();
  const { data, error } = await client
    .from("flashcard_progress")
    .select(COLUMNS)
    .in("card_id", cardIds);

  if (error) throw error;
  return new Map((data as ProgressRow[]).map((row) => [row.card_id, mapProgress(row)]));
}

/**
 * Speichert eine Antwort. `requestId` bleibt über Wiederholungen desselben Klicks gleich —
 * ein Retry zählt dann nicht als zweiter Review.
 */
export async function recordFlashcardReview(
  client: Client,
  cardId: string,
  known: boolean,
  requestId: string
): Promise<CardProgress | null> {
  const { data, error } = await client.rpc("record_flashcard_review", {
    p_card: cardId,
    p_known: known,
    p_request_id: requestId,
  });

  if (error) throw error;
  const row = data as ProgressRow | null;
  return row && typeof row.card_id === "string" ? mapProgress(row) : null;
}

/**
 * Merkt sich dauerhaft, dass eine Karte aufgedeckt wurde: legt die Fortschrittszeile an,
 * falls es noch keine gibt. Eine vorhandene Zeile bleibt unverändert.
 */
export async function markCardSeen(client: Client, cardId: string): Promise<void> {
  const userId = await currentUserId(client);
  const { error } = await client
    .from("flashcard_progress")
    .upsert({ user_id: userId, card_id: cardId }, { onConflict: "user_id,card_id", ignoreDuplicates: true });

  if (error) throw error;
}

/**
 * Markiert eine Karte oder nimmt die Markierung zurück.
 *
 * Clients dürfen auf `flashcard_progress` nur `starred` ändern; Termine und der
 * Bekannt-Status gehören dem Review-RPC. Deshalb erst ein Update genau dieser Spalte und
 * nur ohne vorhandene Zeile ein Insert — ein Upsert würde auch die Schlüsselspalten
 * überschreiben wollen, wofür es kein Update-Recht gibt.
 */
export async function setCardStarred(client: Client, cardId: string, starred: boolean): Promise<void> {
  const userId = await currentUserId(client);
  const { data, error } = await client
    .from("flashcard_progress")
    .update({ starred })
    .eq("user_id", userId)
    .eq("card_id", cardId)
    .select("card_id");

  if (error) throw error;
  if (data.length > 0) return;

  const { error: insertError } = await client
    .from("flashcard_progress")
    .insert({ user_id: userId, card_id: cardId, starred });

  if (insertError) throw insertError;
}

/** Zählerstände je Deck, serverseitig berechnet. Fremde Decks liefert das Backend nicht. */
export async function listDeckProgressCounts(client: Client, materialIds: string[]): Promise<Map<string, DeckProgressCounts>> {
  if (materialIds.length === 0) return new Map();
  const { data, error } = await client.rpc("learning_deck_progress_counts", {
    p_material_ids: materialIds,
  });

  if (error) throw error;
  return new Map(
    (data ?? []).map((row) => [
      row.material_id,
      {
        materialId: row.material_id,
        total: row.total,
        new: row.new,
        reviewed: row.reviewed,
        known: row.known,
        due: row.due,
      },
    ])
  );
}
