import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

// Offene Seitennotizen über Unterlagen hinweg — für Dashboard und Kursseite. Das ist die
// Liste „noch nicht geklärt“ aus dem Lernablauf; die einzelne Unterlage zeigt ihre Notizen
// selbst (`documentNotes.ts`).
//
// Nimmt den Client als Parameter und hat nur relative Importe, damit es ohne Browser
// testbar bleibt. RLS liefert nur die Notizen des angemeldeten Nutzers.

type Client = SupabaseClient<Database>;

export type OpenNote = {
  id: string;
  courseId: string;
  /** `null`, wenn das Material keine Datei (mehr) hat; dann gibt es keine Dokumentansicht. */
  fileId: string | null;
  materialTitle: string;
  pageNumber: number;
  kind: "note" | "highlight";
  /** Der Notiztext; bei einer Markierung ohne Kommentar der markierte Originaltext. */
  text: string;
  createdAt: string;
};

export type OpenNotes = {
  items: OpenNote[];
  /** Alle offenen Notizen, auch die über `limit` hinaus. */
  total: number;
};

/** Neueste offene Notizen, optional auf einen Kurs begrenzt. */
export async function listOpenNotes(
  client: Client,
  options: { courseId?: string; limit?: number } = {}
): Promise<OpenNotes> {
  let query = client
    .from("document_notes")
    .select(
      "id, page_number, kind, body, quote, created_at, materials!document_notes_material_id_fkey!inner(course_id, file_id, title)",
      { count: "exact" }
    )
    .eq("status", "open");
  if (options.courseId) query = query.eq("materials.course_id", options.courseId);

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 5);

  if (error) throw error;

  const items = (data ?? []).map((row): OpenNote => ({
    id: row.id,
    courseId: row.materials.course_id,
    fileId: row.materials.file_id,
    materialTitle: row.materials.title,
    pageNumber: row.page_number,
    kind: row.kind === "highlight" ? "highlight" : "note",
    text: row.body.trim() || (row.quote ?? "").trim(),
    createdAt: row.created_at,
  }));
  return { items, total: count ?? items.length };
}

/** Ziel einer offenen Notiz: der Notizen-Tab ihrer Unterlage, sonst der Kurs. */
export function openNoteHref(note: Pick<OpenNote, "courseId" | "fileId">): string {
  return note.fileId
    ? `/courses/${note.courseId}/documents/${note.fileId}?tab=notes`
    : `/courses/${note.courseId}`;
}
