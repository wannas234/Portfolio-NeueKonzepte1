import { createClient } from "@/lib/supabase/browser";
import { countByLecture } from "@/components/courses/lectureFilter";

// Vorlesungen eines Kurses (Backend-Migration 20261004090000_course_structure_and_notes).
//
// Damit entsteht die Ebene Kurs → Vorlesung → Dokument. Die Zuordnung liegt auf
// `materials.lecture_id` und ist optional: ein Dokument kann zu genau einer Vorlesung
// desselben Kurses gehören oder zu keiner. Nur der Kursbesitzer hat Zugriff; das
// erzwingt RLS, nicht dieser Code.

export type Lecture = {
  id: string;
  courseId: string;
  title: string;
  /** Datum der Vorlesung als `YYYY-MM-DD`, falls bekannt. */
  heldOn: string | null;
  createdAt: string;
};

const COLUMNS = "id, course_id, title, held_on, created_at";

/** Backend-Grenzen; das Formular soll sie nicht erst serverseitig erfahren. */
export const LECTURE_TITLE_MAX = 200;

type LectureRow = {
  id: string;
  course_id: string;
  title: string;
  held_on: string | null;
  created_at: string;
};

function mapLecture(row: LectureRow): Lecture {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    heldOn: row.held_on,
    createdAt: row.created_at,
  };
}

/** Nach Termin sortiert, Vorlesungen ohne Datum zuletzt. */
export async function listLectures(courseId: string): Promise<Lecture[]> {
  const { data, error } = await createClient()
    .from("lectures")
    .select(COLUMNS)
    .eq("course_id", courseId)
    .order("held_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data.map(mapLecture);
}

/** Anzahl Unterlagen je Vorlesung des Kurses (nur Vorlesungen mit mindestens einer Unterlage). */
export async function countLectureDocuments(courseId: string): Promise<Map<string, number>> {
  const { data, error } = await createClient()
    .from("materials")
    .select("lecture_id")
    .eq("course_id", courseId)
    .eq("type", "source_document")
    .not("lecture_id", "is", null);

  if (error) throw error;
  return countByLecture(data.map((row) => ({ lectureId: row.lecture_id })));
}

export async function createLecture(
  courseId: string,
  input: { title: string; heldOn: string | null }
): Promise<Lecture> {
  const { data, error } = await createClient()
    .from("lectures")
    .insert({ course_id: courseId, title: input.title.trim(), held_on: input.heldOn || null })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapLecture(data);
}

/** Nach dem Anlegen sind laut Backend nur Titel und Datum änderbar. */
export async function updateLecture(
  id: string,
  input: { title?: string; heldOn?: string | null }
): Promise<Lecture> {
  const { data, error } = await createClient()
    .from("lectures")
    .update({
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.heldOn === undefined ? {} : { held_on: input.heldOn || null }),
    })
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return mapLecture(data);
}

/** Entfernt nur die Vorlesung; zugeordnete Unterlagen und Notizen bleiben erhalten. */
export async function deleteLecture(id: string): Promise<void> {
  const { error } = await createClient().from("lectures").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Ordnet eine Unterlage einer Vorlesung zu oder löst die Zuordnung mit `null`.
 * Eine fremde oder kursfremde Vorlesung weist das Backend mit `LECTURE_NOT_FOUND` ab.
 */
export async function assignMaterialToLecture(
  materialId: string,
  lectureId: string | null
): Promise<void> {
  const { error } = await createClient()
    .from("materials")
    .update({ lecture_id: lectureId })
    .eq("id", materialId);

  if (error) throw error;
}
