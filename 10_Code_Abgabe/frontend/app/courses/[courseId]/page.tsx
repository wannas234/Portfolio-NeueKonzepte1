import CourseDetailClient from "@/components/courses/CourseDetailClient";

export default async function CourseDetailPage(
  props: PageProps<"/courses/[courseId]">
) {
  const { courseId } = await props.params;
  return <CourseDetailClient courseId={courseId} />;
}
