import type { Metadata } from "next";
import CourseFlashcardDecks from "@/components/flashcards/CourseFlashcardDecks";

export const metadata: Metadata = {
  title: "Karteikarten | UniVerse",
  description: "Deine Karteikarten-Decks für diesen Kurs.",
};

export default async function CourseFlashcardsPage(
  props: PageProps<"/courses/[courseId]/flashcards">
) {
  const { courseId } = await props.params;
  return <CourseFlashcardDecks courseId={courseId} />;
}
