import { createClient } from "@/lib/supabase/browser";
import * as core from "./flashcard-review-core";

// Bindet den Browser-Client an die Abfragen aus `flashcard-review-core.ts`. Die Logik und
// ihre Tests liegen dort.

export { blankProgress, cardStatusLabel } from "./flashcard-review-core";
export type { CardProgress, CardStatus, DeckProgressCounts } from "./flashcard-review-core";

export const listCardProgress = (cardIds: string[]) => core.listCardProgress(createClient(), cardIds);

export const recordFlashcardReview = (cardId: string, known: boolean, requestId: string) =>
  core.recordFlashcardReview(createClient(), cardId, known, requestId);

export const markCardSeen = (cardId: string) => core.markCardSeen(createClient(), cardId);

export const setCardStarred = (cardId: string, starred: boolean) => core.setCardStarred(createClient(), cardId, starred);

export const listDeckProgressCounts = (materialIds: string[]) => core.listDeckProgressCounts(createClient(), materialIds);
