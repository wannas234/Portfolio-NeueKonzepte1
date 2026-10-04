import { createClient } from "@/lib/supabase/browser";

export type Flashcard = {
  id: string;
  question: string;
  answer: string;
};

export type FlashcardDeck = {
  materialId: string;
  deckId: string;
  title: string;
  description: string;
  cards: Flashcard[];
};

// Grenzen aus `update_learning_deck` (Backend-Migration 20261003140000).
export const DECK_TITLE_MAX = 200;
export const DECK_DESCRIPTION_MAX = 2000;

export type FlashcardDeckSummary = {
  materialId: string;
  deckId: string;
  title: string;
  cardCount: number;
  createdAt: string;
};

type MaterialWithDeckRow = {
  id: string;
  title: string;
  description?: string | null;
  created_at: string;
  flashcard_decks: {
    id: string;
    flashcards: { id: string; question: string; answer: string }[];
  } | null;
};

export async function listCourseDecks(courseId: string): Promise<FlashcardDeckSummary[]> {
  const { data, error } = await createClient()
    .from("materials")
    .select("id, title, created_at, flashcard_decks!material_id(id, flashcards(id, question, answer))")
    .eq("course_id", courseId)
    .eq("type", "flashcard_deck")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data as MaterialWithDeckRow[])
    .filter((row) => row.flashcard_decks)
    .map((row) => ({
      materialId: row.id,
      deckId: row.flashcard_decks!.id,
      title: row.title,
      cardCount: row.flashcard_decks!.flashcards.length,
      createdAt: row.created_at,
    }));
}

export async function getDeck(materialId: string): Promise<FlashcardDeck | null> {
  const { data, error } = await createClient()
    .from("materials")
    .select("id, title, description, flashcard_decks!material_id(id, flashcards(id, question, answer))")
    .eq("id", materialId)
    .eq("type", "flashcard_deck")
    .maybeSingle();

  if (error) throw error;
  const row = data as MaterialWithDeckRow | null;
  if (!row || !row.flashcard_decks) return null;

  return {
    materialId: row.id,
    deckId: row.flashcard_decks.id,
    title: row.title,
    description: row.description ?? "",
    cards: row.flashcard_decks.flashcards,
  };
}

/**
 * Legt ein leeres Deck an.
 *
 * Seit Backend-Migration 20261003140000 übernimmt das der RPC `create_manual_deck`:
 * Material und Deck entstehen in einer Transaktion, statt wie zuvor in zwei Schritten
 * mit manuellem Aufräumen, wenn der zweite scheitert.
 *
 * `requestId` macht den Aufruf wiederholbar: derselbe Wert mit demselben Titel liefert
 * dasselbe Deck statt eines zweiten. Der Aufrufer muss sie deshalb über Wiederholungen
 * desselben Versuchs hinweg festhalten (siehe `CreateDeckDialog`) — mit einem anderen
 * Titel weist das Backend dieselbe ID als REQUEST_CONFLICT ab.
 */
export async function createDeck(
  courseId: string,
  title: string,
  requestId: string
): Promise<{ materialId: string; deckId: string; title: string }> {
  const { data, error } = await createClient().rpc("create_manual_deck", {
    p_course: courseId,
    p_title: title.trim(),
    p_request_id: requestId,
  });
  if (error) throw error;

  const row = data as { material_id?: unknown; deck_id?: unknown } | null;
  if (typeof row?.material_id !== "string" || typeof row.deck_id !== "string") {
    throw new Error("Unerwartete Antwort beim Anlegen des Decks.");
  }
  return { materialId: row.material_id, deckId: row.deck_id, title: title.trim() };
}

/**
 * Ändert Titel und Beschreibung von Deck und zugehörigem Material gemeinsam; gilt auch für
 * generierte Decks.
 *
 * Der RPC setzt immer beide Felder. Die Beschreibung ist deshalb Pflicht: wer nur den Titel
 * ändern will, gibt die bestehende Beschreibung mit, sonst würde sie geleert.
 */
export async function updateDeck(
  materialId: string,
  input: { title: string; description: string }
): Promise<void> {
  const { error } = await createClient().rpc("update_learning_deck", {
    p_material: materialId,
    p_title: input.title.trim(),
    p_description: input.description.trim(),
  });
  if (error) throw error;
}

export async function deleteDeck(materialId: string): Promise<void> {
  const { error } = await createClient().from("materials").delete().eq("id", materialId);
  if (error) throw error;
}

export async function addFlashcard(
  deckId: string,
  input: { question: string; answer: string }
): Promise<Flashcard> {
  const { data, error } = await createClient()
    .from("flashcards")
    .insert({ deck_id: deckId, question: input.question, answer: input.answer })
    .select("id, question, answer")
    .single();

  if (error) throw error;
  return data as Flashcard;
}

/** Ändert Frage und Antwort einer Karte. Der Lernfortschritt der Karte bleibt erhalten. */
export async function updateFlashcard(
  id: string,
  input: { question: string; answer: string }
): Promise<Flashcard> {
  const { data, error } = await createClient()
    .from("flashcards")
    .update({ question: input.question, answer: input.answer })
    .eq("id", id)
    .select("id, question, answer")
    .single();

  if (error) throw error;
  return data as Flashcard;
}

export async function deleteFlashcard(id: string): Promise<void> {
  const { error } = await createClient().from("flashcards").delete().eq("id", id);
  if (error) throw error;
}
