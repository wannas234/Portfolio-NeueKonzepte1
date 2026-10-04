import type { Metadata } from "next";
import FlashcardDeckDetail from "@/components/flashcards/FlashcardDeckDetail";

export const metadata: Metadata = {
  title: "Karteikarten | UniVerse",
  description: "Deine eigenen Karteikarten in diesem Deck.",
};

export default async function FlashcardDeckPage(
  props: PageProps<"/courses/[courseId]/flashcards/[deckId]">
) {
  const { courseId, deckId } = await props.params;

  return <FlashcardDeckDetail courseId={courseId} materialId={deckId} />;
}
