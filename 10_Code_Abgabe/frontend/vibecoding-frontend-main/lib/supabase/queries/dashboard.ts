import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentPipelineState } from "../../../components/courses/documentIndexing";
import type { Database } from "../database.types";

// Read-only queries for the dashboard. They only use the signed-in user's own rows
// (RLS) and only select what the dashboard shows. Courses and calendar events reuse
// the existing query modules.

type Client = SupabaseClient<Database>;

export type DashboardDocument = {
  materialId: string;
  courseId: string;
  fileId: string;
  name: string;
  mimeType: string;
  /** When the document was confirmed and added to the course (the source material's creation). */
  addedAt: string;
  state: DocumentPipelineState;
};

type SourceState = {
  processing_status: string;
  error_code: string | null;
  indexing_status: string;
  indexing_error: string | null;
};

function mapState(row: SourceState): DocumentPipelineState {
  return {
    processingStatus: row.processing_status as DocumentPipelineState["processingStatus"],
    errorCode: row.error_code,
    indexingStatus: row.indexing_status as DocumentPipelineState["indexingStatus"],
    indexingError: row.indexing_error,
  };
}

/** Newest confirmed documents across all courses, with their processing and indexing state. */
export async function listRecentDocuments(client: Client, limit = 6): Promise<DashboardDocument[]> {
  const { data, error } = await client
    .from("materials")
    .select(
      "id, course_id, file_id, created_at, files!file_id(original_filename, mime_type), source_documents!source_documents_material_id_fkey(processing_status, error_code, indexing_status, indexing_error)"
    )
    .eq("type", "source_document")
    .not("file_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return data.flatMap((row) => {
    if (!row.file_id || !row.files || !row.source_documents) return [];
    return [
      {
        materialId: row.id,
        courseId: row.course_id,
        fileId: row.file_id,
        name: row.files.original_filename,
        mimeType: row.files.mime_type,
        addedAt: row.created_at,
        state: mapState(row.source_documents),
      },
    ];
  });
}

/** Documents whose processing or indexing is not finished or has failed, across all courses. */
export async function listUnfinishedDocuments(client: Client, limit = 20): Promise<DashboardDocument[]> {
  const { data, error } = await client
    .from("source_documents")
    .select(
      "processing_status, error_code, indexing_status, indexing_error, materials!source_documents_material_id_fkey!inner(id, course_id, file_id, created_at, files!file_id(original_filename, mime_type))"
    )
    .or("processing_status.neq.ready,indexing_status.neq.ready")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return data.flatMap((row) => {
    const material = row.materials;
    if (!material.file_id || !material.files) return [];
    return [
      {
        materialId: material.id,
        courseId: material.course_id,
        fileId: material.file_id,
        name: material.files.original_filename,
        mimeType: material.files.mime_type,
        addedAt: material.created_at,
        state: mapState(row),
      },
    ];
  });
}

/** The signed-in user's real profile name, or null when there is none. */
export async function getProfileName(client: Client): Promise<string | null> {
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Nicht angemeldet.");

  const { data, error } = await client
    .from("profiles")
    .select("name")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error) throw error;
  return data?.name ?? null;
}

/**
 * Number of flashcard reviews that are due now, across all of the user's decks. Same rule as
 * `learning_deck_progress_counts.due` (`due_at <= now`); RLS limits the rows to the user's own
 * progress, so the count needs no extra owner filter.
 */
export async function countDueFlashcards(client: Client, now: Date = new Date()): Promise<number> {
  const { count, error } = await client
    .from("flashcard_progress")
    .select("card_id", { count: "exact", head: true })
    .not("due_at", "is", null)
    .lte("due_at", now.toISOString());

  if (error) throw error;
  return count ?? 0;
}
