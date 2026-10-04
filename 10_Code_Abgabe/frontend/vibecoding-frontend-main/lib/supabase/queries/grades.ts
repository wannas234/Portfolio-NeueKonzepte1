import { createClient } from "@/lib/supabase/browser";
import { mapAssessment, type Assessment, type AssessmentInput } from "./grades-map";

export type { Assessment, AssessmentInput, AssessmentKind, AssessmentStatus } from "./grades-map";

const COLUMNS =
  "id, course_id, title, kind, status, ects_credits, grade, assessment_date, points_earned, points_max, notes, created_at, updated_at";

export async function listCourseAssessments(courseId: string): Promise<Assessment[]> {
  const { data, error } = await createClient()
    .from("grade_assessments")
    .select(COLUMNS)
    .eq("course_id", courseId)
    .order("assessment_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data.map(mapAssessment);
}

export async function createAssessment(courseId: string, input: AssessmentInput): Promise<Assessment> {
  const { data, error } = await createClient()
    .from("grade_assessments")
    .insert({
      course_id: courseId,
      title: input.title,
      kind: input.kind,
      status: input.status,
      ects_credits: input.ectsCredits,
      grade: input.grade,
      assessment_date: input.assessmentDate,
      points_earned: input.pointsEarned,
      points_max: input.pointsMax,
      notes: input.notes || null,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapAssessment(data);
}

export async function updateAssessment(id: string, input: AssessmentInput): Promise<Assessment> {
  const { data, error } = await createClient()
    .from("grade_assessments")
    .update({
      title: input.title,
      kind: input.kind,
      status: input.status,
      ects_credits: input.ectsCredits,
      grade: input.grade,
      assessment_date: input.assessmentDate,
      points_earned: input.pointsEarned,
      points_max: input.pointsMax,
      notes: input.notes || null,
    })
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapAssessment(data);
}

export async function deleteAssessment(id: string): Promise<void> {
  // Without .select(), a delete that matches zero rows (wrong id, or the row
  // is hidden by RLS) still reports no error - it would silently look like
  // success. Request the deleted row back and fail loudly if none came back.
  const { data, error } = await createClient()
    .from("grade_assessments")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Kein Datensatz gelöscht.");
}
