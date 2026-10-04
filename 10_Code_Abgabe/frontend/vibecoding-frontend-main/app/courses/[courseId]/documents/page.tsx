import type { Metadata } from "next";
import CourseDocuments from "@/components/courses/CourseDocuments";

export const metadata: Metadata = {
  title: "Unterlagen | UniVerse",
  description: "Vorlesungsmaterial für diesen Kurs verwalten und hochladen.",
};

export default async function CourseDocumentsPage(
  props: PageProps<"/courses/[courseId]/documents">
) {
  const { courseId } = await props.params;
  const { lecture } = await props.searchParams;
  return <CourseDocuments courseId={courseId} initialLecture={typeof lecture === "string" ? lecture : null} />;
}
