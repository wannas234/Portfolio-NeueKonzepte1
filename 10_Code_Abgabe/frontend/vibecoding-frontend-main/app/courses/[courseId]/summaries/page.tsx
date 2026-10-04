import type { Metadata } from "next";
import CourseSummaryEditor from "@/components/summaries/CourseSummaryEditor";

export const metadata: Metadata = {
  title: "Zusammenfassung | UniVerse",
  description: "Deine eigene Zusammenfassung für diesen Kurs.",
};

export default async function CourseSummariesPage(
  props: PageProps<"/courses/[courseId]/summaries">
) {
  const { courseId } = await props.params;
  return <CourseSummaryEditor courseId={courseId} />;
}
