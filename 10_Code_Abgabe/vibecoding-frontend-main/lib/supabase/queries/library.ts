import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentPipelineState, FileProgressStatus } from "../../../components/courses/documentIndexing";
import type { Database } from "../database.types";

// One query for the global document library: every confirmed document of the signed-in
// user (RLS), across all courses, with its file, its course and lecture title and its processing and
// indexing state. Confirmed means the upload was completed, so a source material exists;
// unfinished or failed uploads have no document yet and are not part of the library.

type Client = SupabaseClient<Database>;

/** Newest documents that are loaded. The library tells the user when this cap is reached. */
export const LIBRARY_LIMIT = 500;

export type LibraryDocument = {
  /** `source_documents.id`, needed for the processing/indexing retry. */
  documentId: string;
  materialId: string;
  /** `files.id`, the id of the document detail route. */
  fileId: string;
  courseId: string;
  courseTitle: string;
  /** Title of the assigned lecture (`materials.lecture_id`), or null when there is none. */
  lectureTitle: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** When the file was uploaded (`files.created_at`). */
  uploadedAt: string;
  fileStatus: FileProgressStatus;
  state: DocumentPipelineState;
};

type LibraryRow = {
  id: string;
  course_id: string;
  file_id: string | null;
  courses: { title: string } | null;
  lectures: { title: string } | null;
  files: { original_filename: string; mime_type: string; size_bytes: number; status: string; created_at: string } | null;
  source_documents: {
    id: string;
    processing_status: string;
    error_code: string | null;
    indexing_status: string;
    indexing_error: string | null;
  } | null;
};

/** Joins the embedded records. Rows without a file, course or source document cannot be shown and are skipped. */
export function mapLibraryRows(rows: LibraryRow[]): LibraryDocument[] {
  return rows.flatMap((row) => {
    const { file_id: fileId, files: file, courses: course, source_documents: source } = row;
    if (!fileId || !file || !course || !source) return [];
    return [
      {
        documentId: source.id,
        materialId: row.id,
        fileId,
        courseId: row.course_id,
        courseTitle: course.title,
        lectureTitle: row.lectures?.title ?? null,
        name: file.original_filename,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        uploadedAt: file.created_at,
        fileStatus: file.status as FileProgressStatus,
        state: {
          processingStatus: source.processing_status as DocumentPipelineState["processingStatus"],
          errorCode: source.error_code,
          indexingStatus: source.indexing_status as DocumentPipelineState["indexingStatus"],
          indexingError: source.indexing_error,
        },
      },
    ];
  });
}

export async function listLibraryDocuments(client: Client): Promise<LibraryDocument[]> {
  const { data, error } = await client
    .from("materials")
    .select(
      "id, course_id, file_id, courses!course_id(title), lectures!lecture_id(title), files!file_id(original_filename, mime_type, size_bytes, status, created_at), source_documents!source_documents_material_id_fkey(id, processing_status, error_code, indexing_status, indexing_error)"
    )
    .eq("type", "source_document")
    .not("file_id", "is", null)
    .order("created_at", { ascending: false })
    .range(0, LIBRARY_LIMIT - 1);

  if (error) throw error;
  return mapLibraryRows(data);
}
