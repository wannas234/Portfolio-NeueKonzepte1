import { createClient } from "@/lib/supabase/browser";
import type { Tables } from "@/lib/supabase/database.types";

export type Course = {
  id: string;
  title: string;
  description: string;
  /** Freitext wie "WS 2026/27"; `null`, solange nichts gesetzt ist. */
  semester: string | null;
  lecturer: string | null;
  /** Zielnote 1,0–5,0 mit zwei Nachkommastellen. */
  targetGrade: number | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

type CourseRow = Tables<"courses">;

const COLUMNS = "id, title, description, semester, lecturer, target_grade, owner_id, created_at, updated_at";

function mapCourse(row: CourseRow): Course {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    semester: row.semester,
    lecturer: row.lecturer,
    targetGrade: row.target_grade,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCourses(): Promise<Course[]> {
  const { data, error } = await createClient()
    .from("courses")
    .select(COLUMNS)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data.map(mapCourse);
}

export async function getCourse(id: string): Promise<Course | null> {
  const { data, error } = await createClient()
    .from("courses")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCourse(data) : null;
}

/**
 * Optionale Kursangaben. Leere Eingaben werden zu `null`, weil das Backend leere oder
 * reine Leerzeichen-Werte für Semester und Dozent zurückweist.
 */
export type CourseDetails = {
  semester?: string | null;
  lecturer?: string | null;
  targetGrade?: number | null;
};

function detailColumns(details: CourseDetails) {
  const row: { semester?: string | null; lecturer?: string | null; target_grade?: number | null } = {};
  if ("semester" in details) row.semester = details.semester?.trim() || null;
  if ("lecturer" in details) row.lecturer = details.lecturer?.trim() || null;
  if ("targetGrade" in details) row.target_grade = details.targetGrade ?? null;
  return row;
}

export async function createCourse(input: {
  title: string;
  description: string;
} & CourseDetails): Promise<Course> {
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Nicht angemeldet.");

  const { data, error } = await supabase
    .from("courses")
    .insert({
      owner_id: userData.user.id,
      title: input.title,
      description: input.description,
      ...detailColumns(input),
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapCourse(data);
}

export async function updateCourse(
  id: string,
  input: { title?: string; description?: string } & CourseDetails
): Promise<Course> {
  const { data, error } = await createClient()
    .from("courses")
    .update({
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...detailColumns(input),
    })
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapCourse(data);
}

export async function deleteCourse(id: string): Promise<void> {
  const { error } = await createClient().from("courses").delete().eq("id", id);
  if (error) throw error;
}
