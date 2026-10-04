import { createClient } from "@/lib/supabase/browser";
import type {
  DocumentPipelineState,
  IndexingStatus,
  ProcessingStatus,
} from "@/components/courses/documentIndexing";

// Read-only status view of the backend document pipeline
// (see ../lernapp_backend/docs/documents.md and docs/rag.md). Clients may read
// `source_documents` through their own materials but never write processing or
// indexing state. The extracted text is deliberately not selected here: it can
// be large and is not needed for a status list.

export type CourseDocumentStatus = DocumentPipelineState & {
  documentId: string;
  materialId: string;
  /** Titel des Materials — zur Anzeige, welche Unterlage eine Generierung blockiert. */
  title: string;
  /** Zugeordnete Vorlesung desselben Kurses, oder `null`. */
  lectureId: string | null;
  fileId: string | null;
  updatedAt: string;
};

type MaterialWithSourceRow = {
  id: string;
  title: string;
  lecture_id: string | null;
  file_id: string | null;
  source_documents: {
    id: string;
    processing_status: string;
    error_code: string | null;
    indexing_status: string;
    indexing_error: string | null;
    updated_at: string;
  } | null;
};

/**
 * Entfernt eine Lerneinheit, deren Datei nicht mehr existiert.
 *
 * Das Löschen einer Datei setzt `materials.file_id` im Backend nur auf `null`; die
 * Lerneinheit und ihr `source_document` bleiben bestehen und zählen weiter als Quelle
 * des Kurses — eine nie fertige Quelle blockiert dann jede Kurszusammenfassung. Die
 * RLS-Policy `materials_delete_owned` erlaubt das Löschen eigener Materialien
 * ausdrücklich, solange `file_id is null` ist; genau diesen Fall räumt das hier auf.
 * Die abhängigen Zeilen verschwinden per Fremdschlüssel-Kaskade.
 */
export async function deleteOrphanedDocument(materialId: string): Promise<void> {
  const { error } = await createClient().from("materials").delete().eq("id", materialId);
  if (error) throw error;
}

export async function listCourseDocumentStatuses(
  courseId: string
): Promise<CourseDocumentStatus[]> {
  const { data, error } = await createClient()
    .from("materials")
    .select(
      "id, title, lecture_id, file_id, source_documents!source_documents_material_id_fkey(id, processing_status, error_code, indexing_status, indexing_error, updated_at)"
    )
    .eq("course_id", courseId)
    .eq("type", "source_document")
    .order("created_at", { ascending: false })
    .range(0, 49);

  if (error) throw error;

  return (data as MaterialWithSourceRow[])
    .filter((row) => row.source_documents !== null)
    .map((row) => ({
      documentId: row.source_documents!.id,
      materialId: row.id,
      title: row.title,
      lectureId: row.lecture_id,
      fileId: row.file_id,
      processingStatus: row.source_documents!.processing_status as ProcessingStatus,
      errorCode: row.source_documents!.error_code,
      indexingStatus: row.source_documents!.indexing_status as IndexingStatus,
      indexingError: row.source_documents!.indexing_error,
      updatedAt: row.source_documents!.updated_at,
    }));
}

/** Status by file id, so a file row can look up its own document. */
export function indexDocumentStatusesByFile(
  statuses: CourseDocumentStatus[]
): Map<string, CourseDocumentStatus> {
  const byFile = new Map<string, CourseDocumentStatus>();
  for (const status of statuses) {
    if (status.fileId) byFile.set(status.fileId, status);
  }
  return byFile;
}
